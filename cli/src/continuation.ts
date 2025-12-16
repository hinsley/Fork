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
            timestamp: new Date().toISOString()
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
            // If an LC branch was initiated from a Hopf point, exit to continuation menu
            if (result === 'INITIATED_LC') {
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

    const { direction } = await inquirer.prompt({
        type: 'rawlist',
        name: 'direction',
        message: 'Extension Direction:',
        choices: [
            { name: 'Forward (Append)', value: true },
            { name: 'Backward (Prepend)', value: false }
        ],
        pageSize: MENU_PAGE_SIZE
    });

    const defaults = branch.settings || {};

    const settings = await inquirer.prompt([
        { name: 'max_steps', message: 'Max Points to Add:', default: '50' },
        { name: 'step_size', message: 'Step Size:', default: defaults.step_size?.toString() || '0.01' },
        // Reuse other settings from object if possible, or prompts?
        // For simplicity, reusing old critical settings or prompts if missing.
    ]);

    const continuationSettings = {
        step_size: parseFloat(settings.step_size),
        min_step_size: defaults.min_step_size || 1e-5,
        max_step_size: defaults.max_step_size || 0.1,
        max_steps: parseInt(settings.max_steps),
        corrector_steps: defaults.corrector_steps || 4,
        corrector_tolerance: defaults.corrector_tolerance || 1e-6,
        step_tolerance: defaults.step_tolerance || 1e-6
    };

    console.log(chalk.cyan(`Extending Branch ${direction ? 'Forward' : 'Backward'}...`));

    try {
        // Need to ensure we use the correct system parameters? 
        // For continuation, we typically want the params to be what they were.
        // But continuation traces a parameter change.
        // The `extend_continuation` will pick up from the last point's state/param.
        // However, other fixed parameters must be correct.

        // We don't have a snapshot of *all* parameters in the branch object currently, 
        // only `settings`. 
        // Ideally we should have saved `parameters` in `ContinuationObject`.
        // Since we didn't, we fall back to `sysConfig.params`. 
        // If the user changed params since branch creation, this might be inconsistent.
        // TODO: Add parameters snapshot to ContinuationObject in future refactor.
        // For now, we assume system params haven't drastically changed or user wants current params.

        const bridge = new WasmBridge(sysConfig);

        // If indices are missing, fill them (migration)
        if (!branch.data.indices) {
            branch.data.indices = branch.data.points.map((_, i) => i);
        }

        const updatedData = bridge.extend_continuation(
            serializeBranchDataForWasm(branch.data),
            branch.parameterName,
            continuationSettings,
            direction
        );

        branch.data = normalizeBranchEigenvalues(updatedData);
        branch.settings = continuationSettings; // Update last used settings

        Storage.saveContinuation(sysName, branch);
        console.log(chalk.green(`Extension successful! Total points: ${branch.data.points.length}`));

        await inspectBranch(sysName, branch);

    } catch (e) {
        console.error(chalk.red("Extension Failed:"), e);
    }
}

type BranchDetailResult = 'SUMMARY' | 'EXIT' | 'INITIATED_LC';
const DETAIL_PAGE_SIZE = 10;

async function inspectBranch(sysName: string, branch: ContinuationObject): Promise<'EXIT' | 'INITIATED_LC' | void> {
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

async function browseBranchSummary(sysName: string, branch: ContinuationObject, indices: number[]): Promise<'EXIT' | 'INITIATED_LC' | void> {
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
            if (detailResult === 'EXIT' || detailResult === 'INITIATED_LC') {
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
            if (pointResult === 'INITIATED_LC') {
                return 'INITIATED_LC';
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

    // Configuration defaults
    let branchName = `lc_${branch.name}_${branch.parameterName}`;
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
        const bridge = new WasmBridge(sysConfig);

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
            timestamp: new Date().toISOString()
        };

        Storage.saveContinuation(sysName, newBranch);
        console.log(chalk.green(`Limit cycle continuation successful! Generated ${branchData.points.length} points.`));

        await inspectBranch(sysName, newBranch);

    } catch (e) {
        console.error(chalk.red("Limit Cycle Continuation Failed:"), e);
    }
}


async function showPointDetails(
    sysName: string,
    branch: ContinuationObject,
    indices: number[],
    arrayIdx: number,
    isBifurcation: boolean
): Promise<'BACK' | 'INITIATED_LC'> {
    const pt = branch.data.points[arrayIdx];
    const logicalIdx = indices[arrayIdx];

    console.log('');
    const headerSuffix = isBifurcation ? ' [Bifurcation]' : '';
    console.log(chalk.yellow(`Point ${logicalIdx} (Array ${arrayIdx})${headerSuffix}`));
    console.log(`Stability: ${pt.stability}`);
    console.log(`Parameter (${branch.parameterName}): ${formatNumber(pt.param_value)}`);
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

    // For Hopf bifurcations, show action menu
    if (pt.stability === 'Hopf') {
        const choices = [
            { name: 'Initiate Limit Cycle Continuation', value: 'INITIATE_LC' },
            new inquirer.Separator(),
            { name: 'Back', value: 'BACK' }
        ];

        const { action } = await inquirer.prompt({
            type: 'rawlist',
            name: 'action',
            message: 'Hopf Point Actions',
            choices,
            pageSize: MENU_PAGE_SIZE
        });

        if (action === 'INITIATE_LC') {
            await initiateLCFromHopf(sysName, branch, pt);
            return 'INITIATED_LC';
        }
        return 'BACK';
    }

    await inquirer.prompt({ type: 'input', name: 'cont', message: 'Press enter to return...' });
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
