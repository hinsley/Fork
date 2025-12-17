import inquirer from 'inquirer';
import chalk from 'chalk';
import { Storage } from './storage';
import { WasmBridge } from './wasm';
import {
    ContinuationBranchData,
    ContinuationObject,
    ContinuationPoint,
    ContinuationEigenvalue,
    EquilibriumObject,
    SystemConfig
} from './types';
import {
    ConfigEntry,
    MENU_PAGE_SIZE,
    formatUnset,
    parseFloatOrDefault,
    parseIntOrDefault,
    runConfigMenu
} from './menu';
import {
    printHeader,
    printField,
    printSuccess,
    printError,
    printInfo
} from './format';

const NAME_REGEX = /^[a-zA-Z0-9_]+$/;

function isValidName(name: string): boolean | string {
    if (!name || name.length === 0) return "Name cannot be empty.";
    if (!NAME_REGEX.test(name)) return "Name must contain only alphanumeric characters and underscores (no spaces).";
    return true;
}

// ============== Limit Cycle Metrics ==============

interface LimitCycleMetrics {
    period: number;
    ranges: { min: number; max: number; range: number }[];
    means: number[];
    rmsAmplitudes: number[];
}

/**
 * Extract profile points from flat LC state.
 * Flat state format: [profile_0, profile_1, ..., profile_N, period]
 * Returns array of state vectors and the period.
 */
function extractLCProfile(
    flatState: number[],
    dim: number,
    ntst: number,
    ncol: number
): { profilePoints: number[][]; period: number } {
    const profilePointCount = ntst * ncol + 1;
    const period = flatState[flatState.length - 1];
    const profilePoints: number[][] = [];

    for (let i = 0; i < profilePointCount; i++) {
        const offset = i * dim;
        profilePoints.push(flatState.slice(offset, offset + dim));
    }

    return { profilePoints, period };
}

/**
 * Compute interpretable metrics from LC profile points.
 */
function computeLCMetrics(profilePoints: number[][], period: number): LimitCycleMetrics {
    const dim = profilePoints[0]?.length || 0;
    const n = profilePoints.length;

    const ranges: { min: number; max: number; range: number }[] = [];
    const means: number[] = [];
    const rmsAmplitudes: number[] = [];

    for (let d = 0; d < dim; d++) {
        const values = profilePoints.map(pt => pt[d]);
        const min = Math.min(...values);
        const max = Math.max(...values);
        const mean = values.reduce((a, b) => a + b, 0) / n;

        // RMS amplitude from mean
        const rms = Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n);

        ranges.push({ min, max, range: max - min });
        means.push(mean);
        rmsAmplitudes.push(rms);
    }

    return { period, ranges, means, rmsAmplitudes };
}

/**
 * Interpret Floquet multipliers into a simple stability label.
 */
function interpretLCStability(eigenvalues: ContinuationEigenvalue[] | undefined): string {
    if (!eigenvalues || eigenvalues.length === 0) return 'unknown';

    // Floquet multipliers: stable if all |λ| < 1 (except trivial λ=1)
    let unstableCount = 0;
    let hasNeimarkSacker = false;

    for (const eig of eigenvalues) {
        const magnitude = Math.sqrt(eig.re * eig.re + eig.im * eig.im);

        // Skip trivial multiplier (≈1)
        if (Math.abs(magnitude - 1.0) < 0.01 && Math.abs(eig.im) < 0.01) continue;

        if (magnitude > 1.0 + 1e-6) {
            unstableCount++;
            // Complex pair with |λ| > 1 indicates Neimark-Sacker
            if (Math.abs(eig.im) > 1e-6) hasNeimarkSacker = true;
        }
    }

    if (unstableCount === 0) return 'stable';
    if (hasNeimarkSacker) return `unstable (torus)`;
    return `unstable (${unstableCount}D)`;
}


/**
 * Get the best available parameter values for a branch.
 * If the branch has params stored, use those.
 * Otherwise, try to get from the source equilibrium object.
 * Falls back to sysConfig.params as last resort.
 */
function getBranchParams(
    sysName: string,
    branch: ContinuationObject,
    sysConfig: SystemConfig
): number[] {
    // If branch has params stored, use those
    if (branch.params && branch.params.length === sysConfig.params.length) {
        return [...branch.params];
    }

    // Try to get params from the source equilibrium object
    // The startObject field contains the name of the equilibrium or parent branch
    if (branch.startObject) {
        try {
            // First check if it's an equilibrium object
            const eqObj = Storage.loadObject(sysName, branch.startObject);
            if (eqObj && eqObj.type === 'equilibrium' && eqObj.parameters) {
                if (eqObj.parameters.length === sysConfig.params.length) {
                    return [...eqObj.parameters];
                }
            }

            // Check if it's a parent branch
            const parentBranch = Storage.loadContinuation(sysName, branch.startObject);
            if (parentBranch && parentBranch.type === 'continuation') {
                // Recursively get params from parent
                return getBranchParams(sysName, parentBranch, sysConfig);
            }
        } catch {
            // Object doesn't exist or can't be loaded, fall through to default
        }
    }

    // Last resort: use current system config
    return [...sysConfig.params];
}

export async function continuationMenu(sysName: string) {
    while (true) {
        const branchNames = Storage.listContinuations(sysName);
        const branches = branchNames
            .map(name => Storage.loadContinuation(sysName, name))
            .filter((obj): obj is ContinuationObject => obj.type === 'continuation');

        const choices = [];
        choices.push({ name: 'Create New Branch', value: 'CREATE' });

        if (branches.length > 0) {
            choices.push(new inquirer.Separator());
            branches.forEach(branch => {
                choices.push({
                    name: `${branch.name} (Param: ${branch.parameterName}, Pts: ${branch.data.points.length})`,
                    value: branch.name
                });
            });
        }

        choices.push(new inquirer.Separator());
        choices.push({ name: 'Back', value: 'BACK' });

        const { selection } = await inquirer.prompt({
            type: 'rawlist',
            name: 'selection',
            message: 'Continuation Menu',
            choices,
            pageSize: MENU_PAGE_SIZE
        });

        if (selection === 'BACK') return;

        if (selection === 'CREATE') {
            await createBranch(sysName);
        } else {
            const branch = Storage.loadContinuation(sysName, selection) as ContinuationObject;
            await manageBranch(sysName, branch);
        }
    }
}

async function createBranch(sysName: string) {
    const sysConfig = Storage.loadSystem(sysName);

    const objects = Storage.listObjects(sysName)
        .map(name => Storage.loadObject(sysName, name))
        .filter((obj): obj is EquilibriumObject => obj.type === 'equilibrium' && !!obj.solution);

    if (objects.length === 0) {
        console.log(chalk.red("No converged equilibrium objects found. Create and solve an equilibrium first."));
        return;
    }

    if (sysConfig.paramNames.length === 0) {
        console.log(chalk.red("System has no parameters to continue. Add at least one parameter first."));
        return;
    }

    let selectedEqName = objects[0]?.name ?? '';
    let selectedParamName = sysConfig.paramNames[0] ?? '';
    let branchName = '';

    let stepSizeInput = '0.01';
    let maxStepsInput = '100';
    let minStepSizeInput = '1e-5';
    let maxStepSizeInput = '0.1';
    let directionForward = true;
    let correctorStepsInput = '4';
    let correctorToleranceInput = '1e-6';
    let stepToleranceInput = '1e-6';

    const directionLabel = (forward: boolean) =>
        forward ? 'Forward (Increasing Param)' : 'Backward (Decreasing Param)';

    const entries: ConfigEntry[] = [
        {
            id: 'equilibrium',
            label: 'Starting equilibrium',
            section: 'Branch Settings',
            getDisplay: () => selectedEqName || '(required)',
            edit: async () => {
                const { value } = await inquirer.prompt({
                    type: 'rawlist',
                    name: 'value',
                    message: 'Select Starting Equilibrium:',
                    choices: objects.map(o => ({
                        name: `${o.name} (${o.solution ? 'solved' : 'unsolved'})`,
                        value: o.name
                    })),
                    default: selectedEqName,
                    pageSize: MENU_PAGE_SIZE
                });
                selectedEqName = value;
            }
        },
        {
            id: 'parameter',
            label: 'Continuation parameter',
            section: 'Branch Settings',
            getDisplay: () => selectedParamName || '(required)',
            edit: async () => {
                const { value } = await inquirer.prompt({
                    type: 'rawlist',
                    name: 'value',
                    message: 'Select Continuation Parameter:',
                    choices: sysConfig.paramNames,
                    default: selectedParamName,
                    pageSize: MENU_PAGE_SIZE
                });
                selectedParamName = value;
            }
        },
        {
            id: 'branchName',
            label: 'Branch name',
            section: 'Branch Settings',
            getDisplay: () => formatUnset(branchName),
            edit: async () => {
                const { value } = await inquirer.prompt({
                    name: 'value',
                    message: 'Name for this Continuation Branch:',
                    default: branchName || `${selectedEqName || 'branch'}_${selectedParamName || 'param'}`,
                    validate: (val: string) => {
                        const valid = isValidName(val);
                        if (valid !== true) return valid;
                        if (Storage.listContinuations(sysName).includes(val)) return "Branch name already exists.";
                        return true;
                    }
                });
                branchName = value;
            }
        },
        {
            id: 'stepSize',
            label: 'Initial step size',
            section: 'Predictor Settings',
            getDisplay: () => formatUnset(stepSizeInput),
            edit: async () => {
                const { value } = await inquirer.prompt({
                    name: 'value',
                    message: 'Initial Step Size:',
                    default: stepSizeInput
                });
                stepSizeInput = value;
            }
        },
        {
            id: 'maxSteps',
            label: 'Max points',
            section: 'Predictor Settings',
            getDisplay: () => formatUnset(maxStepsInput),
            edit: async () => {
                const { value } = await inquirer.prompt({
                    name: 'value',
                    message: 'Max Points:',
                    default: maxStepsInput
                });
                maxStepsInput = value;
            }
        },
        {
            id: 'minStep',
            label: 'Min step size',
            section: 'Predictor Settings',
            getDisplay: () => formatUnset(minStepSizeInput),
            edit: async () => {
                const { value } = await inquirer.prompt({
                    name: 'value',
                    message: 'Min Step Size:',
                    default: minStepSizeInput
                });
                minStepSizeInput = value;
            }
        },
        {
            id: 'maxStep',
            label: 'Max step size',
            section: 'Predictor Settings',
            getDisplay: () => formatUnset(maxStepSizeInput),
            edit: async () => {
                const { value } = await inquirer.prompt({
                    name: 'value',
                    message: 'Max Step Size:',
                    default: maxStepSizeInput
                });
                maxStepSizeInput = value;
            }
        },
        {
            id: 'direction',
            label: 'Direction',
            section: 'Predictor Settings',
            getDisplay: () => directionLabel(directionForward),
            edit: async () => {
                const { value } = await inquirer.prompt({
                    type: 'rawlist',
                    name: 'value',
                    message: 'Direction:',
                    choices: [
                        { name: 'Forward (Increasing Param)', value: true },
                        { name: 'Backward (Decreasing Param)', value: false }
                    ],
                    default: directionForward,
                    pageSize: MENU_PAGE_SIZE
                });
                directionForward = value;
            }
        },
        {
            id: 'correctorSteps',
            label: 'Corrector steps',
            section: 'Corrector Settings',
            getDisplay: () => formatUnset(correctorStepsInput),
            edit: async () => {
                const { value } = await inquirer.prompt({
                    name: 'value',
                    message: 'Corrector steps:',
                    default: correctorStepsInput,
                    validate: (input: string) => {
                        const parsed = parseInt(input, 10);
                        if (!Number.isFinite(parsed) || parsed <= 0) {
                            return 'Enter a positive integer.';
                        }
                        return true;
                    }
                });
                correctorStepsInput = value;
            }
        },
        {
            id: 'correctorTolerance',
            label: 'Corrector tolerance',
            section: 'Corrector Settings',
            getDisplay: () => formatUnset(correctorToleranceInput),
            edit: async () => {
                const { value } = await inquirer.prompt({
                    name: 'value',
                    message: 'Corrector tolerance:',
                    default: correctorToleranceInput,
                    validate: (input: string) => {
                        const parsed = parseFloat(input);
                        if (!Number.isFinite(parsed) || parsed <= 0) {
                            return 'Enter a positive number.';
                        }
                        return true;
                    }
                });
                correctorToleranceInput = value;
            }
        },
        {
            id: 'stepTolerance',
            label: 'Step tolerance',
            section: 'Corrector Settings',
            getDisplay: () => formatUnset(stepToleranceInput),
            edit: async () => {
                const { value } = await inquirer.prompt({
                    name: 'value',
                    message: 'Step tolerance:',
                    default: stepToleranceInput,
                    validate: (input: string) => {
                        const parsed = parseFloat(input);
                        if (!Number.isFinite(parsed) || parsed <= 0) {
                            return 'Enter a positive number.';
                        }
                        return true;
                    }
                });
                stepToleranceInput = value;
            }
        }
    ];

    while (true) {
        const result = await runConfigMenu('Create Continuation Branch', entries);
        if (result === 'back') {
            return;
        }

        if (!selectedEqName) {
            console.error(chalk.red('Please select a starting equilibrium.'));
            continue;
        }

        if (!selectedParamName) {
            console.error(chalk.red('Please select a continuation parameter.'));
            continue;
        }

        if (!branchName) {
            console.error(chalk.red('Please provide a branch name.'));
            continue;
        }

        if (Storage.listContinuations(sysName).includes(branchName)) {
            console.error(chalk.red(`Branch "${branchName}" already exists.`));
            continue;
        }

        break;
    }

    const eqObj = objects.find(o => o.name === selectedEqName);
    if (!eqObj) {
        console.error(chalk.red('Selected equilibrium could not be found. Aborting.'));
        return;
    }

    const continuationSettings = {
        step_size: Math.max(parseFloatOrDefault(stepSizeInput, 0.01), 1e-9),
        min_step_size: Math.max(parseFloatOrDefault(minStepSizeInput, 1e-5), 1e-12),
        max_step_size: Math.max(parseFloatOrDefault(maxStepSizeInput, 0.1), 1e-9),
        max_steps: Math.max(parseIntOrDefault(maxStepsInput, 100), 1),
        corrector_steps: Math.max(parseIntOrDefault(correctorStepsInput, 4), 1),
        corrector_tolerance: Math.max(parseFloatOrDefault(correctorToleranceInput, 1e-6), Number.EPSILON),
        step_tolerance: Math.max(parseFloatOrDefault(stepToleranceInput, 1e-6), Number.EPSILON)
    };

    const forward = directionForward;

    // 5. Run
    console.log(chalk.cyan("Running Continuation..."));
    try {
        // IMPORTANT: Restore parameters from the equilibrium object if available
        // This ensures we start from the state the equilibrium was found at.
        const runConfig = { ...sysConfig };
        if (eqObj.parameters && eqObj.parameters.length === sysConfig.params.length) {
            runConfig.params = [...eqObj.parameters];
        }

        const bridge = new WasmBridge(runConfig);
        const branchData = normalizeBranchEigenvalues(bridge.compute_continuation(
            eqObj.solution!.state,
            selectedParamName,
            continuationSettings,
            forward
        ));

        const branch: ContinuationObject = {
            type: 'continuation',
            name: branchName,
            systemName: sysName,
            parameterName: selectedParamName,
            startObject: selectedEqName,
            branchType: 'equilibrium',
            data: branchData,
            settings: continuationSettings,
            timestamp: new Date().toISOString(),
            params: [...runConfig.params]  // Store full parameter snapshot
        };

        Storage.saveContinuation(sysName, branch);
        console.log(chalk.green(`Continuation successful! Generated ${branchData.points.length} points.`));

        await inspectBranch(sysName, branch);

    } catch (e) {
        console.error(chalk.red("Continuation Failed:"), e);
    }
}

async function manageBranch(sysName: string, branch: ContinuationObject) {
    while (true) {
        printHeader(branch.name, `${branch.branchType || 'equilibrium'} continuation`);
        printField('Parameter', branch.parameterName);
        printField('Points', branch.data.points.length.toLocaleString());
        printField('Bifurcations', branch.data.bifurcations.length.toString());
        console.log('');

        const { action } = await inquirer.prompt({
            type: 'rawlist',
            name: 'action',
            message: 'Branch Actions',
            choices: [
                { name: 'Inspect Data', value: 'Inspect Data' },
                { name: 'Extend Branch', value: 'Extend Branch' },
                new inquirer.Separator(),
                { name: 'Delete Branch', value: 'Delete Branch' },
                new inquirer.Separator(),
                { name: 'Back', value: 'Back' }
            ],
            pageSize: MENU_PAGE_SIZE
        });

        if (action === 'Back') return;

        if (action === 'Inspect Data') {
            const result = await inspectBranch(sysName, branch);
            // If a branch was initiated from a point, exit to continuation menu
            if (result === 'INITIATED_LC' || result === 'INITIATED_BRANCH') {
                return;
            }
        } else if (action === 'Extend Branch') {
            await extendBranch(sysName, branch);
        } else if (action === 'Delete Branch') {
            const { confirm } = await inquirer.prompt({
                type: 'confirm',
                name: 'confirm',
                message: `Delete branch ${branch.name}?`,
                default: false
            });
            if (confirm) {
                Storage.deleteContinuation(sysName, branch.name);
                return;
            }
        }
    }
}

async function extendBranch(sysName: string, branch: ContinuationObject) {
    const sysConfig = Storage.loadSystem(sysName);
    const defaults = branch.settings || {};

    // State for config menu
    let directionForward = true;
    let maxStepsInput = '50';
    let stepSizeInput = defaults.step_size?.toString() || '0.01';

    const directionLabel = (forward: boolean) =>
        forward ? 'Forward (Append)' : 'Backward (Prepend)';

    const entries: ConfigEntry[] = [
        {
            id: 'direction',
            label: 'Direction',
            section: 'Extension Settings',
            getDisplay: () => directionLabel(directionForward),
            edit: async () => {
                const { value } = await inquirer.prompt({
                    type: 'rawlist',
                    name: 'value',
                    message: 'Extension Direction:',
                    choices: [
                        { name: 'Forward (Append)', value: true },
                        { name: 'Backward (Prepend)', value: false }
                    ],
                    default: directionForward ? 0 : 1,
                    pageSize: MENU_PAGE_SIZE
                });
                directionForward = value;
            }
        },
        {
            id: 'maxSteps',
            label: 'Max points to add',
            section: 'Extension Settings',
            getDisplay: () => formatUnset(maxStepsInput),
            edit: async () => {
                const { value } = await inquirer.prompt({
                    name: 'value',
                    message: 'Max Points to Add:',
                    default: maxStepsInput
                });
                maxStepsInput = value;
            }
        },
        {
            id: 'stepSize',
            label: 'Step size',
            section: 'Extension Settings',
            getDisplay: () => formatUnset(stepSizeInput),
            edit: async () => {
                const { value } = await inquirer.prompt({
                    name: 'value',
                    message: 'Step Size:',
                    default: stepSizeInput
                });
                stepSizeInput = value;
            }
        }
    ];

    const result = await runConfigMenu(`Extend Branch: ${branch.name}`, entries);
    if (result === 'back') {
        return;
    }

    const continuationSettings = {
        step_size: parseFloatOrDefault(stepSizeInput, 0.01),
        min_step_size: defaults.min_step_size || 1e-5,
        max_step_size: defaults.max_step_size || 0.1,
        max_steps: parseIntOrDefault(maxStepsInput, 50),
        corrector_steps: defaults.corrector_steps || 4,
        corrector_tolerance: defaults.corrector_tolerance || 1e-6,
        step_tolerance: defaults.step_tolerance || 1e-6
    };

    console.log(chalk.cyan(`Extending Branch ${directionForward ? 'Forward' : 'Backward'}...`));

    try {
        const bridge = new WasmBridge(sysConfig);

        // If indices are missing, fill them (migration)
        if (!branch.data.indices) {
            branch.data.indices = branch.data.points.map((_, i) => i);
        }

        const updatedData = bridge.extend_continuation(
            serializeBranchDataForWasm(branch.data),
            branch.parameterName,
            continuationSettings,
            directionForward
        );

        branch.data = normalizeBranchEigenvalues(updatedData);
        branch.settings = continuationSettings;

        Storage.saveContinuation(sysName, branch);
        printSuccess(`Extension successful! Total points: ${branch.data.points.length}`);

        await inspectBranch(sysName, branch);

    } catch (e) {
        printError(`Extension Failed: ${e}`);
    }
}

type BranchDetailResult = 'SUMMARY' | 'EXIT' | 'INITIATED_LC' | 'INITIATED_BRANCH';
const DETAIL_PAGE_SIZE = 10;

async function inspectBranch(sysName: string, branch: ContinuationObject): Promise<'EXIT' | 'INITIATED_LC' | 'INITIATED_BRANCH' | void> {
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

function ensureBranchIndices(branch: ContinuationObject): number[] {
    const pts = branch.data.points;
    if (!branch.data.indices || branch.data.indices.length !== pts.length) {
        branch.data.indices = pts.map((_, i) => i);
    }
    return branch.data.indices;
}

async function hydrateEigenvalues(sysName: string, branch: ContinuationObject) {
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

    console.log(chalk.yellow(`Hydrating eigenvalues for ${missingIndices.length} continuation points...`));
    const sysConfig = Storage.loadSystem(sysName);
    const bridge = new WasmBridge(sysConfig);

    missingIndices.forEach(idx => {
        const pt = branch.data.points[idx];
        pt.eigenvalues = bridge.computeEigenvalues(pt.state, branch.parameterName, pt.param_value);
    });

    Storage.saveContinuation(sysName, branch);
}

function buildSortedArrayOrder(indices: number[]): number[] {
    return indices
        .map((logicalIdx, arrayIdx) => ({ logicalIdx, arrayIdx }))
        .sort((a, b) => a.logicalIdx - b.logicalIdx)
        .map(entry => entry.arrayIdx);
}

async function browseBranchSummary(sysName: string, branch: ContinuationObject, indices: number[]): Promise<'EXIT' | 'INITIATED_LC' | 'INITIATED_BRANCH' | void> {
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
            return 'EXIT';
        }

        if (typeof selection === 'string' && selection.startsWith('POINT:')) {
            const targetIdx = parseInt(selection.split(':')[1], 10);
            const detailResult = await browseBranchPoints(sysName, branch, indices, targetIdx, sortedOrder);
            if (detailResult === 'EXIT' || detailResult === 'INITIATED_LC' || detailResult === 'INITIATED_BRANCH') {
                return detailResult;
            }
        }
    }
}

function buildSummaryChoices(branch: ContinuationObject, indices: number[], sortedOrder: number[]) {
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

async function browseBranchPoints(
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
            if (pointResult === 'INITIATED_LC' || pointResult === 'INITIATED_BRANCH') {
                return pointResult;
            }
        }
    }
}

function formatPointRow(
    branch: ContinuationObject,
    indices: number[],
    arrayIdx: number,
    bifurcationSet: Set<number>,
    focusIdx: number
) {
    const pt = branch.data.points[arrayIdx];
    const logicalIdx = indices[arrayIdx];
    const paramVal = formatNumber(pt.param_value);
    const descriptor = summarizeEigenvalues(pt);
    const typeLabel = pt.stability && pt.stability !== 'None' ? ` [${pt.stability}]` : '';

    const prefix = bifurcationSet.has(arrayIdx) ? '*' : ' ';
    let label = `${prefix} Index ${logicalIdx} | ${branch.parameterName}=${paramVal} | ${descriptor}${typeLabel}`;

    if (arrayIdx === focusIdx) {
        label = chalk.cyan(label);
    } else if (bifurcationSet.has(arrayIdx)) {
        label = chalk.red(label);
    }

    return label;
}

function summarizeEigenvalues(point: ContinuationPoint) {
    const eigenvalues = point.eigenvalues || [];
    if (eigenvalues.length === 0) {
        return 'Eigenvalues: []';
    }
    const formatted = eigenvalues
        .slice(0, 3)
        .map(ev => `${formatNumberSafe(ev.re)}+${formatNumberSafe(ev.im)}i`);
    const suffix = eigenvalues.length > 3 ? ' …' : '';
    return `Eigenvalues: ${formatted.join(', ')}${suffix}`;
}

/**
 * Initiates limit cycle continuation from a Hopf bifurcation point.
 */
async function initiateLCFromHopf(
    sysName: string,
    branch: ContinuationObject,
    hopfPoint: ContinuationPoint
) {
    const sysConfig = Storage.loadSystem(sysName);

    // Configuration defaults - use lc_ prefix on source branch name (no need to add param again)
    let branchName = `lc_${branch.name}`;
    let amplitudeInput = '0.1';
    let ntstInput = '20';
    let ncolInput = '4';
    let stepSizeInput = '0.01';
    let maxStepsInput = '50';
    let minStepSizeInput = '1e-5';
    let maxStepSizeInput = '0.1';
    let directionForward = true;
    let correctorStepsInput = '10';
    let correctorToleranceInput = '1e-6';
    let stepToleranceInput = '1e-6';

    const directionLabel = (forward: boolean) =>
        forward ? 'Forward (Increasing Param)' : 'Backward (Decreasing Param)';

    const entries: ConfigEntry[] = [
        {
            id: 'branchName',
            label: 'Branch name',
            section: 'Branch Settings',
            getDisplay: () => branchName || '(required)',
            edit: async () => {
                const { value } = await inquirer.prompt({
                    name: 'value',
                    message: 'Name for this Limit Cycle Branch:',
                    default: branchName,
                    validate: (val: string) => {
                        const valid = isValidName(val);
                        if (valid !== true) return valid;
                        if (Storage.listContinuations(sysName).includes(val)) return "Branch name already exists.";
                        return true;
                    }
                });
                branchName = value;
            }
        },
        {
            id: 'amplitude',
            label: 'Initial amplitude',
            section: 'Hopf Initialization',
            getDisplay: () => formatUnset(amplitudeInput),
            edit: async () => {
                const { value } = await inquirer.prompt({
                    name: 'value',
                    message: 'Initial amplitude (perturbation from equilibrium):',
                    default: amplitudeInput
                });
                amplitudeInput = value;
            }
        },
        {
            id: 'ntst',
            label: 'Mesh intervals (ntst)',
            section: 'Collocation Mesh',
            getDisplay: () => formatUnset(ntstInput),
            edit: async () => {
                const { value } = await inquirer.prompt({
                    name: 'value',
                    message: 'Number of mesh intervals:',
                    default: ntstInput
                });
                ntstInput = value;
            }
        },
        {
            id: 'ncol',
            label: 'Collocation points (ncol)',
            section: 'Collocation Mesh',
            getDisplay: () => formatUnset(ncolInput),
            edit: async () => {
                const { value } = await inquirer.prompt({
                    name: 'value',
                    message: 'Collocation points per interval (2-7):',
                    default: ncolInput
                });
                ncolInput = value;
            }
        },
        {
            id: 'stepSize',
            label: 'Initial step size',
            section: 'Predictor Settings',
            getDisplay: () => formatUnset(stepSizeInput),
            edit: async () => {
                const { value } = await inquirer.prompt({
                    name: 'value',
                    message: 'Initial Step Size:',
                    default: stepSizeInput
                });
                stepSizeInput = value;
            }
        },
        {
            id: 'maxSteps',
            label: 'Max points',
            section: 'Predictor Settings',
            getDisplay: () => formatUnset(maxStepsInput),
            edit: async () => {
                const { value } = await inquirer.prompt({
                    name: 'value',
                    message: 'Max Points:',
                    default: maxStepsInput
                });
                maxStepsInput = value;
            }
        },
        {
            id: 'direction',
            label: 'Direction',
            section: 'Predictor Settings',
            getDisplay: () => directionLabel(directionForward),
            edit: async () => {
                const { value } = await inquirer.prompt({
                    type: 'rawlist',
                    name: 'value',
                    message: 'Direction:',
                    choices: [
                        { name: 'Forward (Increasing Param)', value: true },
                        { name: 'Backward (Decreasing Param)', value: false }
                    ],
                    default: directionForward,
                    pageSize: MENU_PAGE_SIZE
                });
                directionForward = value;
            }
        },
        {
            id: 'correctorSteps',
            label: 'Corrector steps',
            section: 'Corrector Settings',
            getDisplay: () => formatUnset(correctorStepsInput),
            edit: async () => {
                const { value } = await inquirer.prompt({
                    name: 'value',
                    message: 'Corrector steps:',
                    default: correctorStepsInput
                });
                correctorStepsInput = value;
            }
        },
        {
            id: 'correctorTolerance',
            label: 'Corrector tolerance',
            section: 'Corrector Settings',
            getDisplay: () => formatUnset(correctorToleranceInput),
            edit: async () => {
                const { value } = await inquirer.prompt({
                    name: 'value',
                    message: 'Corrector tolerance:',
                    default: correctorToleranceInput
                });
                correctorToleranceInput = value;
            }
        }
    ];

    while (true) {
        const result = await runConfigMenu('Initiate Limit Cycle from Hopf', entries);
        if (result === 'back') {
            return;
        }

        if (!branchName) {
            console.error(chalk.red('Please provide a branch name.'));
            continue;
        }

        if (Storage.listContinuations(sysName).includes(branchName)) {
            console.error(chalk.red(`Branch "${branchName}" already exists.`));
            continue;
        }

        break;
    }

    const amplitude = parseFloatOrDefault(amplitudeInput, 0.1);
    const ntst = parseIntOrDefault(ntstInput, 20);
    const ncol = parseIntOrDefault(ncolInput, 4);

    const continuationSettings = {
        step_size: Math.max(parseFloatOrDefault(stepSizeInput, 0.01), 1e-9),
        min_step_size: Math.max(parseFloatOrDefault(minStepSizeInput, 1e-5), 1e-12),
        max_step_size: Math.max(parseFloatOrDefault(maxStepSizeInput, 0.1), 1e-9),
        max_steps: Math.max(parseIntOrDefault(maxStepsInput, 50), 1),
        corrector_steps: Math.max(parseIntOrDefault(correctorStepsInput, 10), 1),
        corrector_tolerance: Math.max(parseFloatOrDefault(correctorToleranceInput, 1e-6), Number.EPSILON),
        step_tolerance: Math.max(parseFloatOrDefault(stepToleranceInput, 1e-6), Number.EPSILON)
    };

    console.log(chalk.cyan("Initializing limit cycle from Hopf bifurcation..."));

    try {
        // Build system config with the parameter values from the source branch
        const runConfig = { ...sysConfig };

        // Get params from branch, falling back to source equilibrium if needed
        runConfig.params = getBranchParams(sysName, branch, sysConfig);

        // Update the source branch's continuation parameter to the Hopf point's value
        const sourceParamIdx = sysConfig.paramNames.indexOf(branch.parameterName);
        if (sourceParamIdx >= 0) {
            runConfig.params[sourceParamIdx] = hopfPoint.param_value;
        }

        const bridge = new WasmBridge(runConfig);

        // Initialize LC guess from Hopf point
        const guess = bridge.initLCFromHopf(
            hopfPoint.state,
            branch.parameterName,
            hopfPoint.param_value,
            amplitude,
            ntst,
            ncol
        );

        console.log(chalk.cyan("Running limit cycle continuation..."));

        // Run continuation
        const branchData = normalizeBranchEigenvalues(bridge.continueLimitCycle(
            guess,
            branch.parameterName,
            continuationSettings,
            ntst,
            ncol,
            directionForward
        ));

        const newBranch: ContinuationObject = {
            type: 'continuation',
            name: branchName,
            systemName: sysName,
            parameterName: branch.parameterName,
            startObject: branch.name,
            branchType: 'limit_cycle',
            data: branchData,
            settings: continuationSettings,
            timestamp: new Date().toISOString(),
            params: [...runConfig.params]  // Store full parameter snapshot
        };

        Storage.saveContinuation(sysName, newBranch);
        console.log(chalk.green(`Limit cycle continuation successful! Generated ${branchData.points.length} points.`));

        await inspectBranch(sysName, newBranch);

    } catch (e) {
        console.error(chalk.red("Limit Cycle Continuation Failed:"), e);
    }
}


/**
 * Initiates a new equilibrium continuation branch from a point on an existing branch.
 * Allows switching the continuation parameter.
 */
async function initiateEquilibriumBranchFromPoint(
    sysName: string,
    sourceBranch: ContinuationObject,
    point: ContinuationPoint
): Promise<boolean> {
    const sysConfig = Storage.loadSystem(sysName);

    if (sysConfig.paramNames.length === 0) {
        printError("System has no parameters to continue. Add at least one parameter first.");
        return false;
    }

    // Default to a different parameter than the source branch if possible
    let selectedParamName = sysConfig.paramNames.find(p => p !== sourceBranch.parameterName)
        || sysConfig.paramNames[0];
    let branchName = '';
    let stepSizeInput = '0.01';
    let maxStepsInput = '100';
    let minStepSizeInput = '1e-5';
    let maxStepSizeInput = '0.1';
    let directionForward = true;
    let correctorStepsInput = '4';
    let correctorToleranceInput = '1e-6';
    let stepToleranceInput = '1e-6';

    const directionLabel = (forward: boolean) =>
        forward ? 'Forward (Increasing Param)' : 'Backward (Decreasing Param)';

    const entries: ConfigEntry[] = [
        {
            id: 'parameter',
            label: 'Continuation parameter',
            section: 'Branch Settings',
            getDisplay: () => {
                const isSame = selectedParamName === sourceBranch.parameterName;
                return isSame ? `${selectedParamName} (same as source)` : selectedParamName;
            },
            edit: async () => {
                const choices = sysConfig.paramNames.map(p => ({
                    name: p === sourceBranch.parameterName ? `${p} (current branch param)` : p,
                    value: p
                }));
                const { value } = await inquirer.prompt({
                    type: 'rawlist',
                    name: 'value',
                    message: 'Select Continuation Parameter:',
                    choices,
                    default: selectedParamName,
                    pageSize: MENU_PAGE_SIZE
                });
                selectedParamName = value;
            }
        },
        {
            id: 'branchName',
            label: 'Branch name',
            section: 'Branch Settings',
            getDisplay: () => formatUnset(branchName),
            edit: async () => {
                const { value } = await inquirer.prompt({
                    name: 'value',
                    message: 'Name for this Continuation Branch:',
                    default: branchName || `${sourceBranch.name}_${selectedParamName}`,
                    validate: (val: string) => {
                        const valid = isValidName(val);
                        if (valid !== true) return valid;
                        if (Storage.listContinuations(sysName).includes(val)) return "Branch name already exists.";
                        return true;
                    }
                });
                branchName = value;
            }
        },
        {
            id: 'direction',
            label: 'Direction',
            section: 'Predictor Settings',
            getDisplay: () => directionLabel(directionForward),
            edit: async () => {
                const { value } = await inquirer.prompt({
                    type: 'rawlist',
                    name: 'value',
                    message: 'Direction:',
                    choices: [
                        { name: 'Forward (Increasing Param)', value: true },
                        { name: 'Backward (Decreasing Param)', value: false }
                    ],
                    default: directionForward,
                    pageSize: MENU_PAGE_SIZE
                });
                directionForward = value;
            }
        },
        {
            id: 'stepSize',
            label: 'Initial step size',
            section: 'Predictor Settings',
            getDisplay: () => formatUnset(stepSizeInput),
            edit: async () => {
                const { value } = await inquirer.prompt({
                    name: 'value',
                    message: 'Initial Step Size:',
                    default: stepSizeInput
                });
                stepSizeInput = value;
            }
        },
        {
            id: 'maxSteps',
            label: 'Max points',
            section: 'Predictor Settings',
            getDisplay: () => formatUnset(maxStepsInput),
            edit: async () => {
                const { value } = await inquirer.prompt({
                    name: 'value',
                    message: 'Max Points:',
                    default: maxStepsInput
                });
                maxStepsInput = value;
            }
        },
        {
            id: 'minStep',
            label: 'Min step size',
            section: 'Predictor Settings',
            getDisplay: () => formatUnset(minStepSizeInput),
            edit: async () => {
                const { value } = await inquirer.prompt({
                    name: 'value',
                    message: 'Min Step Size:',
                    default: minStepSizeInput
                });
                minStepSizeInput = value;
            }
        },
        {
            id: 'maxStep',
            label: 'Max step size',
            section: 'Predictor Settings',
            getDisplay: () => formatUnset(maxStepSizeInput),
            edit: async () => {
                const { value } = await inquirer.prompt({
                    name: 'value',
                    message: 'Max Step Size:',
                    default: maxStepSizeInput
                });
                maxStepSizeInput = value;
            }
        },
        {
            id: 'correctorSteps',
            label: 'Corrector steps',
            section: 'Corrector Settings',
            getDisplay: () => formatUnset(correctorStepsInput),
            edit: async () => {
                const { value } = await inquirer.prompt({
                    name: 'value',
                    message: 'Corrector steps:',
                    default: correctorStepsInput
                });
                correctorStepsInput = value;
            }
        },
        {
            id: 'correctorTolerance',
            label: 'Corrector tolerance',
            section: 'Corrector Settings',
            getDisplay: () => formatUnset(correctorToleranceInput),
            edit: async () => {
                const { value } = await inquirer.prompt({
                    name: 'value',
                    message: 'Corrector tolerance:',
                    default: correctorToleranceInput
                });
                correctorToleranceInput = value;
            }
        },
        {
            id: 'stepTolerance',
            label: 'Step tolerance',
            section: 'Corrector Settings',
            getDisplay: () => formatUnset(stepToleranceInput),
            edit: async () => {
                const { value } = await inquirer.prompt({
                    name: 'value',
                    message: 'Step tolerance:',
                    default: stepToleranceInput
                });
                stepToleranceInput = value;
            }
        }
    ];

    while (true) {
        const result = await runConfigMenu('Create Equilibrium Branch from Point', entries);
        if (result === 'back') {
            return false;
        }

        if (!branchName) {
            printError('Please provide a branch name.');
            continue;
        }

        if (Storage.listContinuations(sysName).includes(branchName)) {
            printError(`Branch "${branchName}" already exists.`);
            continue;
        }

        break;
    }

    const continuationSettings = {
        step_size: Math.max(parseFloatOrDefault(stepSizeInput, 0.01), 1e-9),
        min_step_size: Math.max(parseFloatOrDefault(minStepSizeInput, 1e-5), 1e-12),
        max_step_size: Math.max(parseFloatOrDefault(maxStepSizeInput, 0.1), 1e-9),
        max_steps: Math.max(parseIntOrDefault(maxStepsInput, 100), 1),
        corrector_steps: Math.max(parseIntOrDefault(correctorStepsInput, 4), 1),
        corrector_tolerance: Math.max(parseFloatOrDefault(correctorToleranceInput, 1e-6), Number.EPSILON),
        step_tolerance: Math.max(parseFloatOrDefault(stepToleranceInput, 1e-6), Number.EPSILON)
    };

    printInfo("Running Continuation...");

    try {
        // Build system config with the parameter values from the source branch
        const runConfig = { ...sysConfig };

        // Get params from branch, falling back to source equilibrium if needed
        runConfig.params = getBranchParams(sysName, sourceBranch, sysConfig);

        // Update the source branch's continuation parameter to the value at this point
        const sourceParamIdx = sysConfig.paramNames.indexOf(sourceBranch.parameterName);
        if (sourceParamIdx >= 0) {
            runConfig.params[sourceParamIdx] = point.param_value;
        }

        const bridge = new WasmBridge(runConfig);
        const branchData = normalizeBranchEigenvalues(bridge.compute_continuation(
            point.state,
            selectedParamName,
            continuationSettings,
            directionForward
        ));

        const newBranch: ContinuationObject = {
            type: 'continuation',
            name: branchName,
            systemName: sysName,
            parameterName: selectedParamName,
            startObject: sourceBranch.name,
            branchType: 'equilibrium',
            data: branchData,
            settings: continuationSettings,
            timestamp: new Date().toISOString(),
            params: [...runConfig.params]  // Store full parameter snapshot
        };

        Storage.saveContinuation(sysName, newBranch);
        printSuccess(`Continuation successful! Generated ${branchData.points.length} points.`);

        await inspectBranch(sysName, newBranch);
        return true;

    } catch (e) {
        printError(`Continuation Failed: ${e}`);
        return false;
    }
}

/**
 * Initiates a new limit cycle continuation branch from a point on an existing LC branch.
 * Allows switching the continuation parameter.
 */
async function initiateLCBranchFromPoint(
    sysName: string,
    sourceBranch: ContinuationObject,
    point: ContinuationPoint,
    arrayIdx: number
): Promise<boolean> {
    const sysConfig = Storage.loadSystem(sysName);

    if (sysConfig.paramNames.length === 0) {
        printError("System has no parameters to continue. Add at least one parameter first.");
        return false;
    }

    // Get LC metadata from the source branch's branch_type
    const branchTypeData = sourceBranch.data.branch_type;
    let sourceNtst = 20;
    let sourceNcol = 4;
    if (branchTypeData && typeof branchTypeData === 'object' && 'type' in branchTypeData) {
        const bt = branchTypeData as { type: string; ntst?: number; ncol?: number };
        if (bt.type === 'LimitCycle' && bt.ntst && bt.ncol) {
            sourceNtst = bt.ntst;
            sourceNcol = bt.ncol;
        }
    }

    let ntstInput = sourceNtst.toString();
    let ncolInput = sourceNcol.toString();


    // Default to a different parameter than the source branch if possible
    let selectedParamName = sysConfig.paramNames.find(p => p !== sourceBranch.parameterName)
        || sysConfig.paramNames[0];
    let branchName = '';
    let stepSizeInput = '0.01';
    let maxStepsInput = '50';
    let minStepSizeInput = '1e-5';
    let maxStepSizeInput = '0.1';
    let directionForward = true;
    let correctorStepsInput = '10';
    let correctorToleranceInput = '1e-6';
    let stepToleranceInput = '1e-6';

    const directionLabel = (forward: boolean) =>
        forward ? 'Forward (Increasing Param)' : 'Backward (Decreasing Param)';

    const entries: ConfigEntry[] = [
        {
            id: 'parameter',
            label: 'Continuation parameter',
            section: 'Branch Settings',
            getDisplay: () => {
                const isSame = selectedParamName === sourceBranch.parameterName;
                return isSame ? `${selectedParamName} (same as source)` : selectedParamName;
            },
            edit: async () => {
                const choices = sysConfig.paramNames.map(p => ({
                    name: p === sourceBranch.parameterName ? `${p} (current branch param)` : p,
                    value: p
                }));
                const { value } = await inquirer.prompt({
                    type: 'rawlist',
                    name: 'value',
                    message: 'Select Continuation Parameter:',
                    choices,
                    default: selectedParamName,
                    pageSize: MENU_PAGE_SIZE
                });
                selectedParamName = value;
            }
        },
        {
            id: 'branchName',
            label: 'Branch name',
            section: 'Branch Settings',
            getDisplay: () => formatUnset(branchName),
            edit: async () => {
                const { value } = await inquirer.prompt({
                    name: 'value',
                    message: 'Name for this Limit Cycle Branch:',
                    default: branchName || `${sourceBranch.name}_${selectedParamName}`,
                    validate: (val: string) => {
                        const valid = isValidName(val);
                        if (valid !== true) return valid;
                        if (Storage.listContinuations(sysName).includes(val)) return "Branch name already exists.";
                        return true;
                    }
                });
                branchName = value;
            }
        },
        {
            id: 'ntst',
            label: 'Mesh intervals (ntst)',
            section: 'Collocation Mesh',
            getDisplay: () => formatUnset(ntstInput),
            edit: async () => {
                const { value } = await inquirer.prompt({
                    name: 'value',
                    message: 'Number of mesh intervals:',
                    default: ntstInput
                });
                ntstInput = value;
            }
        },
        {
            id: 'ncol',
            label: 'Collocation points (ncol)',
            section: 'Collocation Mesh',
            getDisplay: () => formatUnset(ncolInput),
            edit: async () => {
                const { value } = await inquirer.prompt({
                    name: 'value',
                    message: 'Collocation points per interval (2-7):',
                    default: ncolInput
                });
                ncolInput = value;
            }
        },
        {
            id: 'direction',
            label: 'Direction',
            section: 'Predictor Settings',
            getDisplay: () => directionLabel(directionForward),
            edit: async () => {
                const { value } = await inquirer.prompt({
                    type: 'rawlist',
                    name: 'value',
                    message: 'Direction:',
                    choices: [
                        { name: 'Forward (Increasing Param)', value: true },
                        { name: 'Backward (Decreasing Param)', value: false }
                    ],
                    default: directionForward,
                    pageSize: MENU_PAGE_SIZE
                });
                directionForward = value;
            }
        },
        {
            id: 'stepSize',
            label: 'Initial step size',
            section: 'Predictor Settings',
            getDisplay: () => formatUnset(stepSizeInput),
            edit: async () => {
                const { value } = await inquirer.prompt({
                    name: 'value',
                    message: 'Initial Step Size:',
                    default: stepSizeInput
                });
                stepSizeInput = value;
            }
        },
        {
            id: 'maxSteps',
            label: 'Max points',
            section: 'Predictor Settings',
            getDisplay: () => formatUnset(maxStepsInput),
            edit: async () => {
                const { value } = await inquirer.prompt({
                    name: 'value',
                    message: 'Max Points:',
                    default: maxStepsInput
                });
                maxStepsInput = value;
            }
        },
        {
            id: 'correctorSteps',
            label: 'Corrector steps',
            section: 'Corrector Settings',
            getDisplay: () => formatUnset(correctorStepsInput),
            edit: async () => {
                const { value } = await inquirer.prompt({
                    name: 'value',
                    message: 'Corrector steps:',
                    default: correctorStepsInput
                });
                correctorStepsInput = value;
            }
        },
        {
            id: 'correctorTolerance',
            label: 'Corrector tolerance',
            section: 'Corrector Settings',
            getDisplay: () => formatUnset(correctorToleranceInput),
            edit: async () => {
                const { value } = await inquirer.prompt({
                    name: 'value',
                    message: 'Corrector tolerance:',
                    default: correctorToleranceInput
                });
                correctorToleranceInput = value;
            }
        }
    ];

    while (true) {
        const result = await runConfigMenu('Create Limit Cycle Branch from Point', entries);
        if (result === 'back') {
            return false;
        }

        if (!branchName) {
            printError('Please provide a branch name.');
            continue;
        }

        if (Storage.listContinuations(sysName).includes(branchName)) {
            printError(`Branch "${branchName}" already exists.`);
            continue;
        }

        break;
    }

    const ntst = parseIntOrDefault(ntstInput, 20);
    const ncol = parseIntOrDefault(ncolInput, 4);

    const continuationSettings = {
        step_size: Math.max(parseFloatOrDefault(stepSizeInput, 0.01), 1e-9),
        min_step_size: Math.max(parseFloatOrDefault(minStepSizeInput, 1e-5), 1e-12),
        max_step_size: Math.max(parseFloatOrDefault(maxStepSizeInput, 0.1), 1e-9),
        max_steps: Math.max(parseIntOrDefault(maxStepsInput, 50), 1),
        corrector_steps: Math.max(parseIntOrDefault(correctorStepsInput, 10), 1),
        corrector_tolerance: Math.max(parseFloatOrDefault(correctorToleranceInput, 1e-6), Number.EPSILON),
        step_tolerance: Math.max(parseFloatOrDefault(stepToleranceInput, 1e-6), Number.EPSILON)
    };

    printInfo("Running Limit Cycle Continuation...");

    try {
        // Build system config with the parameter values from the source branch
        const runConfig = { ...sysConfig };

        // Get params from branch, falling back to source equilibrium if needed
        runConfig.params = getBranchParams(sysName, sourceBranch, sysConfig);

        // Update the source branch's continuation parameter to the value at this point
        const sourceParamIdx = sysConfig.paramNames.indexOf(sourceBranch.parameterName);
        if (sourceParamIdx >= 0) {
            runConfig.params[sourceParamIdx] = point.param_value;
        }

        const bridge = new WasmBridge(runConfig);

        // For LC continuation from a point, we need to construct an LC guess from the point data
        // The point.state for LC points is flattened: [mesh_states..., stage_states..., period]
        // Unflatten using source branch's ntst/ncol (not the user-input values, since we're reading existing data)

        const dim = sysConfig.equations.length;
        const flatState = point.state;

        // Extract period from the end of the flat state
        const period = flatState[flatState.length - 1];

        // Calculate sizes based on source branch parameters
        // profile_states expects ntst*ncol + 1 profile points
        const profilePointCount = sourceNtst * sourceNcol + 1;

        // Extract profile_states: profilePointCount arrays of dim floats each
        // The flat state is [profile_point_0, ..., profile_point_N, period]
        const profileStates: number[][] = [];
        for (let i = 0; i < profilePointCount; i++) {
            const offset = i * dim;
            profileStates.push(flatState.slice(offset, offset + dim));
        }

        // Get the NEW continuation parameter's current value from runConfig
        const newParamIdx = sysConfig.paramNames.indexOf(selectedParamName);
        const newParamValue = newParamIdx >= 0 ? runConfig.params[newParamIdx] : point.param_value;

        const lcGuess = {
            param_value: newParamValue,  // Use NEW param's value, not old param's value
            period: period,
            profile_states: profileStates,
            upoldp: sourceBranch.data.upoldp || []
        };

        const branchData = normalizeBranchEigenvalues(bridge.continueLimitCycle(
            lcGuess,
            selectedParamName,
            continuationSettings,
            ntst,
            ncol,
            directionForward
        ));

        const newBranch: ContinuationObject = {
            type: 'continuation',
            name: branchName,
            systemName: sysName,
            parameterName: selectedParamName,
            startObject: sourceBranch.name,
            branchType: 'limit_cycle',
            data: branchData,
            settings: continuationSettings,
            timestamp: new Date().toISOString(),
            params: [...runConfig.params]  // Store full parameter snapshot
        };

        Storage.saveContinuation(sysName, newBranch);
        printSuccess(`Limit cycle continuation successful! Generated ${branchData.points.length} points.`);

        await inspectBranch(sysName, newBranch);
        return true;

    } catch (e) {
        printError(`Limit Cycle Continuation Failed: ${e}`);
        return false;
    }
}



async function showPointDetails(
    sysName: string,
    branch: ContinuationObject,
    indices: number[],
    arrayIdx: number,
    isBifurcation: boolean
): Promise<'BACK' | 'INITIATED_LC' | 'INITIATED_BRANCH'> {
    const pt = branch.data.points[arrayIdx];
    const logicalIdx = indices[arrayIdx];
    const branchType = branch.branchType || 'equilibrium';

    console.log('');
    const headerSuffix = isBifurcation ? ' [Bifurcation]' : '';
    const typeLabel = branchType === 'limit_cycle' ? ' [Limit Cycle]' : '';
    console.log(chalk.yellow(`Point ${logicalIdx} (Array ${arrayIdx})${headerSuffix}${typeLabel}`));

    // Show all parameters, highlighting the continuation parameter
    const sysConfig = Storage.loadSystem(sysName);
    const paramNames = sysConfig.paramNames;

    // Build current parameter values from branch.params (if available) + point.param_value for continuation param
    const currentParams: number[] = branch.params && branch.params.length === paramNames.length
        ? [...branch.params]
        : [...sysConfig.params];

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
        console.log(color(`  ${paramNames[i]}: ${formatNumber(currentParams[i])}${marker}`));
    }


    if (branchType === 'limit_cycle') {
        // Enhanced LC display
        const dim = sysConfig.equations.length;
        const varNames = sysConfig.varNames;

        // Get ntst/ncol from branch_type
        const branchTypeData = branch.data.branch_type;
        let ntst = 20, ncol = 4;
        if (branchTypeData && typeof branchTypeData === 'object' && 'type' in branchTypeData) {
            const bt = branchTypeData as { type: string; ntst?: number; ncol?: number };
            if (bt.type === 'LimitCycle' && bt.ntst && bt.ncol) {
                ntst = bt.ntst;
                ncol = bt.ncol;
            }
        }

        // Extract profile and compute metrics
        const { profilePoints, period } = extractLCProfile(pt.state, dim, ntst, ncol);
        const metrics = computeLCMetrics(profilePoints, period);
        const stabilityLabel = interpretLCStability(pt.eigenvalues);

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
                const isTrivial = Math.abs(mag - 1.0) < 0.01 && Math.abs(eig.im) < 0.01;
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

        // For Hopf points, also offer limit cycle continuation
        if (pt.stability === 'Hopf') {
            choices.push({ name: 'Initiate Limit Cycle Continuation', value: 'INITIATE_LC' });
        }
    } else if (branchType === 'limit_cycle') {
        // For limit cycle branches, offer to create a new limit cycle branch
        choices.push({ name: 'Create New Limit Cycle Branch', value: 'NEW_LC_BRANCH' });
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
        const result = await initiateEquilibriumBranchFromPoint(sysName, branch, pt);
        return result ? 'INITIATED_BRANCH' : 'BACK';
    }

    if (action === 'INITIATE_LC') {
        await initiateLCFromHopf(sysName, branch, pt);
        return 'INITIATED_LC';
    }

    if (action === 'NEW_LC_BRANCH') {
        const result = await initiateLCBranchFromPoint(sysName, branch, pt, arrayIdx);
        return result ? 'INITIATED_BRANCH' : 'BACK';
    }

    return 'BACK';
}


function formatArray(values: number[]) {
    if (!values || values.length === 0) {
        return '[]';
    }
    return `[${values.map(formatNumber).join(', ')}]`;
}

function formatNumber(value: number) {
    if (!Number.isFinite(value)) {
        return value.toString();
    }
    const absVal = Math.abs(value);
    if ((absVal !== 0 && absVal < 1e-3) || absVal >= 1e4) {
        return value.toExponential(4);
    }
    return value.toFixed(3);
}

function formatNumberSafe(value: number | undefined) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return 'NaN';
    }
    return formatNumber(value);
}

type EigenvalueWire = [number, number];

function serializeBranchDataForWasm(data: ContinuationBranchData): any {
    return {
        ...data,
        points: data.points.map(pt => ({
            ...pt,
            eigenvalues: (pt.eigenvalues as any[] | undefined)?.map(ev => {
                if (Array.isArray(ev)) {
                    return ev as EigenvalueWire;
                }
                return [ev?.re ?? 0, ev?.im ?? 0] as EigenvalueWire;
            }) ?? []
        })) as any
    };
}

function normalizeBranchEigenvalues(data: ContinuationBranchData): ContinuationBranchData {
    return {
        ...data,
        points: data.points.map(pt => ({
            ...pt,
            eigenvalues: normalizeEigenvalueArray(pt.eigenvalues as any)
        }))
    };
}

function normalizeEigenvalueArray(raw: any): ContinuationEigenvalue[] {
    if (!raw) return [];
    if (Array.isArray(raw)) {
        return raw.map((val: any) => {
            if (Array.isArray(val)) {
                return { re: val[0] ?? 0, im: val[1] ?? 0 };
            }
            return {
                re: typeof val?.re === 'number' ? val.re : Number(val?.re ?? 0),
                im: typeof val?.im === 'number' ? val.im : Number(val?.im ?? 0)
            };
        });
    }
    return [];
}
