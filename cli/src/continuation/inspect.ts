/**
 * Branch Inspection Module
 * 
 * Handles browsing and inspecting continuation branch data,
 * displaying point details, and navigating branch summaries.
 */

import inquirer from 'inquirer';
import chalk from 'chalk';
import { Storage } from '../storage';
import { WasmBridge } from '../wasm';
import { ContinuationObject, ContinuationPoint } from '../types';
import { NavigationRequest } from '../navigation';
import { MENU_PAGE_SIZE } from '../menu';
import {
  extractLCProfile,
  computeLCMetrics,
  interpretLCStability
} from './metrics';
import {
  ensureBranchIndices,
  buildSortedArrayOrder,
  getBranchParams,
  formatNumber,
  formatNumberFullPrecision,
  formatNumberSafe,
  formatArray,
  summarizeEigenvalues
} from './utils';
import { initiateLCFromHopf, initiateLCBranchFromPoint, initiateLCFromPD } from './initiate-lc';
import { initiateEquilibriumBranchFromPoint } from './initiate-eq';
import { initiateFoldCurve, initiateHopfCurve, initiateLPCCurve, initiatePDCurve, initiateNSCurve } from './initiate-codim1';
import { printProgress, printProgressComplete } from '../format';

type BranchDetailResult = 'SUMMARY' | 'EXIT' | NavigationRequest;
const DETAIL_PAGE_SIZE = 10;

/**
 * Displays a paginated list of branch points for detailed inspection.
 * 
 * Allows navigation via pagination, jumping to specific logical indices,
 * and selecting individual points for detailed view with action options.
 * 
 * @param sysName - Name of the dynamical system
 * @param branch - The continuation branch to browse
 * @param indices - Logical index mapping for points
 * @param focusArrayIdx - Initial point to focus on
 * @param sortedOrder - Array indices sorted by logical order
 * @returns Navigation result indicating user action
 */
export async function browseBranchPoints(
  sysName: string,
  branch: ContinuationObject,
  indices: number[],
  focusArrayIdx: number,
  sortedOrder: number[]
): Promise<BranchDetailResult> {
  const pts = branch.data.points;
  const total = pts.length;
  const bifurcationSet = new Set(branch.data.bifurcations);
  const logicalToSorted = new Map<number, number>();
  sortedOrder.forEach((arrayIdx, sortedIdx) => {
    logicalToSorted.set(indices[arrayIdx], sortedIdx);
  });

  const fallbackArrayIdx = Math.min(Math.max(focusArrayIdx, 0), total - 1);
  let currentFocusArrayIdx = fallbackArrayIdx;
  let currentFocusSortedIdx = sortedOrder.findIndex(idx => idx === currentFocusArrayIdx);
  if (currentFocusSortedIdx === -1) {
    currentFocusSortedIdx = 0;
    currentFocusArrayIdx = sortedOrder[0];
  }

  let page = Math.floor(currentFocusSortedIdx / DETAIL_PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(total / DETAIL_PAGE_SIZE));

  while (true) {
    const start = page * DETAIL_PAGE_SIZE;
    const end = Math.min(total, start + DETAIL_PAGE_SIZE);
    const headerText = `Points ${start + 1}-${end} of ${total}`;
    const choices: any[] = [
      new inquirer.Separator(headerText),
    ];

    // Only show pagination options when they're actually usable
    if (page > 0) {
      choices.push({ name: '◀ Previous Page', value: 'PREV_PAGE' });
    }
    if (page < totalPages - 1) {
      choices.push({ name: 'Next Page ▶', value: 'NEXT_PAGE' });
    }

    choices.push({ name: 'Jump to Logical Index...', value: 'JUMP_INDEX' });
    choices.push(new inquirer.Separator());
    choices.push({ name: 'Back to Summary', value: 'SUMMARY' });
    choices.push({ name: chalk.red('Exit Branch Viewer'), value: 'EXIT' });
    choices.push(new inquirer.Separator());

    for (let sortedIdx = start; sortedIdx < end; sortedIdx++) {
      const arrayIdx = sortedOrder[sortedIdx];
      const row = formatPointRow(
        branch,
        indices,
        arrayIdx,
        bifurcationSet,
        currentFocusArrayIdx
      );
      choices.push({ name: row, value: `POINT:${arrayIdx}` });
    }

    const { selection } = await inquirer.prompt({
      type: 'rawlist',
      name: 'selection',
      message: 'Inspect Branch Points',
      choices,
      pageSize: MENU_PAGE_SIZE
    });

    if (selection === 'PREV_PAGE') {
      if (page > 0) {
        page -= 1;
        currentFocusSortedIdx = page * DETAIL_PAGE_SIZE;
        currentFocusArrayIdx = sortedOrder[currentFocusSortedIdx];
      }
      continue;
    }

    if (selection === 'NEXT_PAGE') {
      if (page < totalPages - 1) {
        page += 1;
        currentFocusSortedIdx = Math.min(page * DETAIL_PAGE_SIZE, sortedOrder.length - 1);
        currentFocusArrayIdx = sortedOrder[currentFocusSortedIdx];
      }
      continue;
    }

    if (selection === 'JUMP_INDEX') {
      const { target } = await inquirer.prompt({
        type: 'input',
        name: 'target',
        message: 'Enter logical index:',
        validate: (input: string) => {
          const value = Number(input);
          if (!Number.isInteger(value)) return 'Enter an integer.';
          if (!logicalToSorted.has(value)) return 'Index not found in branch.';
          return true;
        }
      });
      const logicalIdx = Number(target);
      const sortedIdx = logicalToSorted.get(logicalIdx)!;
      currentFocusSortedIdx = sortedIdx;
      currentFocusArrayIdx = sortedOrder[sortedIdx];
      page = Math.floor(currentFocusSortedIdx / DETAIL_PAGE_SIZE);
      continue;
    }

    if (selection === 'SUMMARY') {
      return 'SUMMARY';
    }

    if (selection === 'EXIT') {
      return 'EXIT';
    }

    if (typeof selection === 'string' && selection.startsWith('POINT:')) {
      const arrayIdx = parseInt(selection.split(':')[1], 10);
      currentFocusArrayIdx = arrayIdx;
      currentFocusSortedIdx = sortedOrder.findIndex(idx => idx === arrayIdx);
      if (currentFocusSortedIdx === -1) currentFocusSortedIdx = 0;
      page = Math.floor(currentFocusSortedIdx / DETAIL_PAGE_SIZE);
      const pointResult = await showPointDetails(sysName, branch, indices, arrayIdx, bifurcationSet.has(arrayIdx));
      if (pointResult !== 'BACK') {
        return pointResult;
      }
    }
  }
}

/**
 * Displays a summary view of a branch showing start point, bifurcations, and end point.
 * 
 * Acts as the main entry point for branch inspection, highlighting
 * important points (bifurcations) and allowing navigation to detailed views.
 * 
 * @param sysName - Name of the dynamical system
 * @param branch - The continuation branch to summarize
 * @param indices - Logical index mapping for points
 * @returns Navigation result indicating user action
 */
export async function browseBranchSummary(
  sysName: string,
  branch: ContinuationObject,
  indices: number[]
): Promise<NavigationRequest | void> {
  const sortedOrder = buildSortedArrayOrder(indices);
  while (true) {
    const summaryChoices = buildSummaryChoices(branch, indices, sortedOrder);
    const choices: any[] = [...summaryChoices];
    choices.push(new inquirer.Separator());
    choices.push({ name: chalk.red('Exit Branch Viewer'), value: 'EXIT' });

    const { selection } = await inquirer.prompt({
      type: 'rawlist',
      name: 'selection',
      message: 'Branch Summary',
      choices,
      pageSize: MENU_PAGE_SIZE
    });

    if (selection === 'EXIT') {
      return;
    }

    if (typeof selection === 'string' && selection.startsWith('POINT:')) {
      const targetIdx = parseInt(selection.split(':')[1], 10);
      const detailResult = await browseBranchPoints(sysName, branch, indices, targetIdx, sortedOrder);
      if (detailResult === 'EXIT') {
        return;
      }
      if (detailResult !== 'SUMMARY') {
        return detailResult;
      }
    }
  }
}

/**
 * Builds the menu choices for the branch summary view.
 * 
 * Creates entries for start point, all bifurcations, and end point
 * with color-coded labels indicating their type.
 * 
 * @param branch - The continuation branch
 * @param indices - Logical index mapping
 * @param sortedOrder - Array indices in logical order
 * @returns Array of menu choice objects
 */
export function buildSummaryChoices(branch: ContinuationObject, indices: number[], sortedOrder: number[]) {
  const pts = branch.data.points;
  const choices: Array<{ name: string; value: string }> = [];
  const startArrayIdx = sortedOrder[0];
  const endArrayIdx = sortedOrder[sortedOrder.length - 1];
  const pName = branch.parameterName;
  const formatEntry = (label: string, arrayIdx: number) => {
    const logicalIdx = indices[arrayIdx];
    const paramVal = formatNumber(pts[arrayIdx].param_value);
    const stability = pts[arrayIdx].stability;
    const text = `${label} • Index ${logicalIdx} • ${pName}=${paramVal} • ${stability}`;
    return { name: text, value: `POINT:${arrayIdx}` };
  };

  choices.push({
    name: chalk.cyan(formatEntry('Start Point', startArrayIdx).name),
    value: `POINT:${startArrayIdx}`
  });

  const bifEntries = branch.data.bifurcations
    .map(arrayIdx => ({
      arrayIdx,
      logicalIdx: indices[arrayIdx],
      param: formatNumber(pts[arrayIdx].param_value),
      stability: pts[arrayIdx].stability
    }))
    .sort((a, b) => a.logicalIdx - b.logicalIdx);

  bifEntries.forEach((entry, idx) => {
    const label = chalk.red(
      `Bifurcation ${idx + 1} • Index ${entry.logicalIdx} • ${pName}=${entry.param} • ${entry.stability}`
    );
    choices.push({ name: label, value: `POINT:${entry.arrayIdx}` });
  });

  if (endArrayIdx !== startArrayIdx) {
    choices.push({
      name: chalk.cyan(formatEntry('End Point', endArrayIdx).name),
      value: `POINT:${endArrayIdx}`
    });
  }

  return choices;
}

/**
 * Formats a single point row for display in the point browser.
 * 
 * Shows logical index, parameter value, eigenvalue summary, and stability.
 * Uses color coding: cyan for focused point, red for bifurcations.
 * 
 * @param branch - The continuation branch
 * @param indices - Logical index mapping
 * @param arrayIdx - Array index of the point
 * @param bifurcationSet - Set of bifurcation array indices
 * @param focusIdx - Currently focused point index
 * @returns Formatted and color-coded label string
 */
export function formatPointRow(
  branch: ContinuationObject,
  indices: number[],
  arrayIdx: number,
  bifurcationSet: Set<number>,
  focusIdx: number
) {
  const pt = branch.data.points[arrayIdx];
  const logicalIdx = indices[arrayIdx];
  const descriptor = summarizeEigenvalues(pt, branch.branchType);
  const typeLabel = pt.stability && pt.stability !== 'None' ? ` [${pt.stability}]` : '';

  // Format parameter display based on branch type
  let paramDisplay: string;
  if (branch.branchType === 'fold_curve' || branch.branchType === 'hopf_curve') {
    // Two-parameter branch: show both p1 and p2
    const p1Val = formatNumber(pt.param_value);
    const p2Val = pt.param2_value !== undefined ? formatNumber(pt.param2_value) : '?';
    const branchTypeData = branch.data.branch_type as { param1_name?: string; param2_name?: string } | undefined;
    const p1Name = branchTypeData?.param1_name ?? 'p1';
    const p2Name = branchTypeData?.param2_name ?? 'p2';
    paramDisplay = `${p1Name}=${p1Val}, ${p2Name}=${p2Val}`;
  } else {
    // Single-parameter branch
    const paramVal = formatNumber(pt.param_value);
    paramDisplay = `${branch.parameterName}=${paramVal}`;
  }

  const prefix = bifurcationSet.has(arrayIdx) ? '*' : ' ';
  let label = `${prefix} Index ${logicalIdx} | ${paramDisplay} | ${descriptor}${typeLabel}`;

  if (arrayIdx === focusIdx) {
    label = chalk.cyan(label);
  } else if (bifurcationSet.has(arrayIdx)) {
    label = chalk.red(label);
  }

  return label;
}

/**
 * Computes missing eigenvalues for points that lack them.
 * 
 * Lazily hydrates eigenvalue data by detecting points with missing
 * or invalid eigenvalues and computing them via the WASM bridge.
 * Saves the updated branch data after computation.
 * 
 * @param sysName - Name of the dynamical system
 * @param branch - The continuation branch to hydrate (mutated in place)
 */
export async function hydrateEigenvalues(sysName: string, branch: ContinuationObject) {
  // Skip hydration for codim-1 curves - they have two parameters and different eigenvalue semantics
  if (branch.branchType === 'fold_curve' || branch.branchType === 'hopf_curve') {
    return;
  }

  const missingIndices = branch.data.points
    .map((pt, idx) =>
      !pt.eigenvalues || pt.eigenvalues.length === 0 || isNaN(pt.eigenvalues[0]?.re ?? NaN)
        ? idx
        : -1
    )
    .filter(idx => idx !== -1) as number[];

  if (missingIndices.length === 0) {
    return;
  }

  const total = missingIndices.length;
  const updateInterval = Math.max(1, Math.floor(total / 100));
  printProgress(0, total, 'Hydrating eigenvalues');
  const sysConfig = Storage.loadSystem(sysName);
  const runConfig = { ...sysConfig };
  runConfig.params = getBranchParams(sysName, branch, sysConfig);
  const bridge = new WasmBridge(runConfig);

  missingIndices.forEach((idx, position) => {
    const pt = branch.data.points[idx];
    pt.eigenvalues = bridge.computeEigenvalues(pt.state, branch.parameterName, pt.param_value);
    const current = position + 1;
    if (current % updateInterval === 0 || current === total) {
      printProgress(current, total, 'Hydrating eigenvalues');
    }
  });

  printProgressComplete('Hydrating eigenvalues');
  Storage.saveBranch(sysName, branch.parentObject, branch);
}

/**
 * Main entry point for inspecting a continuation branch.
 * 
 * Hydrates missing eigenvalues, then displays the branch summary view.
 * Handles edge case of empty branches gracefully.
 * 
 * @param sysName - Name of the dynamical system
 * @param branch - The continuation branch to inspect
 * @returns Navigation result indicating how the user exited
 */
export async function inspectBranch(
  sysName: string,
  branch: ContinuationObject
): Promise<NavigationRequest | void> {
  await hydrateEigenvalues(sysName, branch);
  const points = branch.data.points;

  if (points.length === 0) {
    console.log(chalk.yellow("Continuation Data:"));
    console.log("No points.");
    return;
  }

  const indices = ensureBranchIndices(branch);
  return await browseBranchSummary(sysName, branch, indices);
}

/**
 * Displays detailed information for a single continuation point.
 * 
 * For equilibrium points: shows state vector, eigenvalues, stability.
 * For limit cycle points: shows period, Floquet multipliers, amplitude ranges, means.
 * 
 * Offers context-sensitive actions:
 * - Equilibrium: create new branch, initiate LC from Hopf
 * - Limit cycle: create new LC branch with different parameter
 * 
 * @param sysName - Name of the dynamical system
 * @param branch - Parent continuation branch
 * @param indices - Logical index mapping
 * @param arrayIdx - Array index of the point to display
 * @param isBifurcation - Whether this point is a bifurcation
 * @returns Navigation result indicating user action
 */
export async function showPointDetails(
  sysName: string,
  branch: ContinuationObject,
  indices: number[],
  arrayIdx: number,
  isBifurcation: boolean
): Promise<'BACK' | NavigationRequest> {
  const pt = branch.data.points[arrayIdx];
  const logicalIdx = indices[arrayIdx];
  const branchType = branch.branchType || 'equilibrium';

  console.log('');
  const headerSuffix = isBifurcation
    ? ` [Bifurcation${pt.stability && pt.stability !== 'None' ? ': ' + pt.stability : ''}]`
    : '';
  const typeLabel = branchType === 'limit_cycle' ? ' [Limit Cycle]' : '';
  console.log(chalk.yellow(`Point ${logicalIdx} (Array ${arrayIdx})${headerSuffix}${typeLabel}`));

  // Show all parameters, highlighting the continuation parameter
  const sysConfig = Storage.loadSystem(sysName);
  const paramNames = sysConfig.paramNames;

  // Build current parameter values from branch.params (if available) + point.param_value for continuation param
  const currentParams: number[] = branch.params && branch.params.length === paramNames.length
    ? [...branch.params]
    : [...sysConfig.params];

  // Handle two-parameter branches (fold_curve, hopf_curve) specially
  if (branchType === 'fold_curve' || branchType === 'hopf_curve') {
    // Get param names from branch_type
    const branchTypeData = branch.data.branch_type as { param1_name?: string; param2_name?: string } | undefined;
    const p1Name = branchTypeData?.param1_name ?? 'p1';
    const p2Name = branchTypeData?.param2_name ?? 'p2';

    // Update parameters from the point's values
    const p1Idx = paramNames.indexOf(p1Name);
    const p2Idx = paramNames.indexOf(p2Name);
    if (p1Idx >= 0) currentParams[p1Idx] = pt.param_value;
    if (p2Idx >= 0 && pt.param2_value !== undefined) currentParams[p2Idx] = pt.param2_value;

    console.log(chalk.white('Parameters:'));
    for (let i = 0; i < paramNames.length; i++) {
      const isContParam = paramNames[i] === p1Name || paramNames[i] === p2Name;
      const marker = isContParam ? ' ← continuation' : '';
      const color = isContParam ? chalk.cyan : (x: string) => x;
      console.log(color(`  ${paramNames[i]}: ${formatNumberFullPrecision(currentParams[i])}${marker}`));
    }
  } else {
    // Standard single-parameter branch handling
    // Override the continuation parameter with the point's value
    const contParamIdx = paramNames.indexOf(branch.parameterName);
    if (contParamIdx >= 0) {
      currentParams[contParamIdx] = pt.param_value;
    }

    console.log(chalk.white('Parameters:'));
    for (let i = 0; i < paramNames.length; i++) {
      const isContParam = paramNames[i] === branch.parameterName;
      const marker = isContParam ? ' ← continuation' : '';
      const color = isContParam ? chalk.cyan : (x: string) => x;
      console.log(color(`  ${paramNames[i]}: ${formatNumberFullPrecision(currentParams[i])}${marker}`));
    }
  }


  // All LC-based branches (limit_cycle plus codim1 LC curves) get enhanced LC display
  const lcBasedBranches = ['limit_cycle', 'pd_curve', 'lpc_curve', 'ns_curve'];
  if (lcBasedBranches.includes(branchType)) {
    // Enhanced LC display
    const dim = sysConfig.equations.length;
    const varNames = sysConfig.varNames;

    // Get ntst/ncol from branch_type
    const branchTypeData = branch.data.branch_type;
    let ntst = 20, ncol = 4;
    if (branchTypeData && typeof branchTypeData === 'object' && 'type' in branchTypeData) {
      const bt = branchTypeData as { type: string; ntst?: number; ncol?: number };
      // Handle LimitCycle and all codim1 LC curve types
      const lcTypes = ['LimitCycle', 'PDCurve', 'LPCCurve', 'NSCurve'];
      if (lcTypes.includes(bt.type) && bt.ntst && bt.ncol) {
        ntst = bt.ntst;
        ncol = bt.ncol;
      }
    }

    // Extract profile and compute metrics
    const { profilePoints, period } = extractLCProfile(pt.state, dim, ntst, ncol);
    const metrics = computeLCMetrics(profilePoints, period);
    let stabilityLabel = interpretLCStability(pt.eigenvalues);
    if (pt.stability && pt.stability !== 'None') {
      stabilityLabel = pt.stability;
    }

    console.log(chalk.cyan(`Period: ${formatNumber(metrics.period)}`));
    console.log(chalk.cyan(`Stability: ${stabilityLabel}`));

    console.log('');
    console.log(chalk.white('Amplitude (min → max):'));
    for (let d = 0; d < dim; d++) {
      const name = varNames[d] || `x${d}`;
      const r = metrics.ranges[d];
      console.log(`  ${name}: ${formatNumber(r.min)} → ${formatNumber(r.max)}  (range: ${formatNumber(r.range)})`);
    }

    console.log('');
    console.log(chalk.white('Mean position & RMS amplitude:'));
    for (let d = 0; d < dim; d++) {
      const name = varNames[d] || `x${d}`;
      console.log(`  ${name}: mean=${formatNumber(metrics.means[d])}, rms=${formatNumber(metrics.rmsAmplitudes[d])}`);
    }

    // Show Floquet multipliers
    console.log('');
    console.log(chalk.white('Floquet Multipliers:'));
    if (pt.eigenvalues?.length) {
      pt.eigenvalues.forEach((eig, idx) => {
        const mag = Math.sqrt(eig.re * eig.re + eig.im * eig.im);
        const isTrivial = Math.abs(eig.re - 1.0) < 0.05 && Math.abs(eig.im) < 0.05;
        const label = isTrivial ? ' (trivial)' : '';
        console.log(
          `  μ${idx}: ${formatNumberSafe(eig.re)} + ${formatNumberSafe(eig.im)}i  |μ|=${formatNumber(mag)}${label}`
        );
      });
    } else {
      console.log('  (none)');
    }
  } else {
    // Equilibrium display (unchanged)
    console.log(`Stability: ${pt.stability}`);
    console.log('Eigenvalues:');
    if (pt.eigenvalues?.length) {
      pt.eigenvalues.forEach((eig, idx) => {
        console.log(
          `  λ${idx}: ${formatNumberSafe(eig.re)} + ${formatNumberSafe(eig.im)}i`
        );
      });
    } else {
      console.log('  (none)');
    }
    console.log(`State: ${formatArray(pt.state)}`);
  }

  // Build action menu based on branch type and point type
  const choices: any[] = [];

  if (branchType === 'equilibrium') {
    // For equilibrium branches, always offer to create a new equilibrium branch
    choices.push({ name: 'Create New Equilibrium Branch', value: 'NEW_EQ_BRANCH' });

    // For Hopf points, also offer limit cycle continuation and Hopf curve continuation
    if (pt.stability === 'Hopf') {
      choices.push({ name: 'Initiate Limit Cycle Continuation', value: 'INITIATE_LC' });
      choices.push({ name: 'Continue Hopf Curve (2-parameter)', value: 'CONTINUE_HOPF_CURVE' });
    }

    // For Fold points, offer fold curve continuation
    if (pt.stability === 'Fold') {
      choices.push({ name: 'Continue Fold Curve (2-parameter)', value: 'CONTINUE_FOLD_CURVE' });
    }
  } else if (branchType === 'limit_cycle') {
    // For limit cycle branches, offer to create a new limit cycle branch
    choices.push({ name: 'Create New Limit Cycle Branch', value: 'NEW_LC_BRANCH' });

    // For Period Doubling points, offer to branch to double period or continue PD curve
    if (pt.stability === 'PeriodDoubling') {
      choices.push({ name: 'Branch to Period-Doubled Limit Cycle', value: 'BRANCH_PD' });
      choices.push({ name: 'Continue PD Curve (2-parameter)', value: 'CONTINUE_PD_CURVE' });
    }

    // For Cycle Fold (LPC) points, offer LPC curve continuation
    if (pt.stability === 'CycleFold') {
      choices.push({ name: 'Continue LPC Curve (2-parameter)', value: 'CONTINUE_LPC_CURVE' });
    }

    // For Neimark-Sacker points, offer NS curve continuation
    if (pt.stability === 'NeimarkSacker') {
      choices.push({ name: 'Continue NS Curve (2-parameter)', value: 'CONTINUE_NS_CURVE' });
    }
  }

  choices.push(new inquirer.Separator());
  choices.push({ name: 'Back', value: 'BACK' });

  const menuTitle = pt.stability === 'Hopf' ? 'Hopf Point Actions' : 'Point Actions';

  const { action } = await inquirer.prompt({
    type: 'rawlist',
    name: 'action',
    message: menuTitle,
    choices,
    pageSize: MENU_PAGE_SIZE
  });

  if (action === 'NEW_EQ_BRANCH') {
    const newBranch = await initiateEquilibriumBranchFromPoint(sysName, branch, pt);
    if (!newBranch) return 'BACK';
    return {
      kind: 'OPEN_BRANCH',
      objectName: newBranch.parentObject,
      branchName: newBranch.name,
      autoInspect: true,
    };
  }

  if (action === 'INITIATE_LC') {
    const newBranch = await initiateLCFromHopf(sysName, branch, pt, logicalIdx);
    if (!newBranch) return 'BACK';
    return {
      kind: 'OPEN_BRANCH',
      objectName: newBranch.parentObject,
      branchName: newBranch.name,
      autoInspect: true,
    };
  }

  if (action === 'NEW_LC_BRANCH') {
    const newBranch = await initiateLCBranchFromPoint(sysName, branch, pt, arrayIdx);
    if (!newBranch) return 'BACK';
    return {
      kind: 'OPEN_BRANCH',
      objectName: newBranch.parentObject,
      branchName: newBranch.name,
      autoInspect: true,
    };
  }

  if (action === 'BRANCH_PD') {
    const newBranch = await initiateLCFromPD(sysName, branch, pt, arrayIdx);
    if (!newBranch) return 'BACK';
    return {
      kind: 'OPEN_BRANCH',
      objectName: newBranch.parentObject,
      branchName: newBranch.name,
      autoInspect: true,
    };
  }

  // Codim-1 curve continuation handlers
  if (action === 'CONTINUE_FOLD_CURVE') {
    const newBranch = await initiateFoldCurve(sysName, branch, pt, arrayIdx);
    if (newBranch) {
      return {
        kind: 'OPEN_BRANCH' as const,
        objectName: newBranch.parentObject,
        branchName: newBranch.name,
        autoInspect: true,
      };
    }
    return 'BACK';
  }

  if (action === 'CONTINUE_HOPF_CURVE') {
    const newBranch = await initiateHopfCurve(sysName, branch, pt, arrayIdx);
    if (newBranch) {
      return {
        kind: 'OPEN_BRANCH' as const,
        objectName: newBranch.parentObject,
        branchName: newBranch.name,
        autoInspect: true,
      };
    }
    return 'BACK';
  }

  // LC codim-1 curve continuation handlers
  if (action === 'CONTINUE_LPC_CURVE') {
    const newBranch = await initiateLPCCurve(sysName, branch, pt, arrayIdx);
    if (newBranch) {
      return {
        kind: 'OPEN_BRANCH' as const,
        objectName: newBranch.parentObject,
        branchName: newBranch.name,
        autoInspect: true,
      };
    }
    return 'BACK';
  }

  if (action === 'CONTINUE_PD_CURVE') {
    const newBranch = await initiatePDCurve(sysName, branch, pt, arrayIdx);
    if (newBranch) {
      return {
        kind: 'OPEN_BRANCH' as const,
        objectName: newBranch.parentObject,
        branchName: newBranch.name,
        autoInspect: true,
      };
    }
    return 'BACK';
  }

  if (action === 'CONTINUE_NS_CURVE') {
    const newBranch = await initiateNSCurve(sysName, branch, pt, arrayIdx);
    if (newBranch) {
      return {
        kind: 'OPEN_BRANCH' as const,
        objectName: newBranch.parentObject,
        branchName: newBranch.name,
        autoInspect: true,
      };
    }
    return 'BACK';
  }

  return 'BACK';
}
