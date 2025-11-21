import inquirer from 'inquirer';
import chalk from 'chalk';
import { Storage } from './storage';
import { WasmBridge } from './wasm';
import { ContinuationBranchData, ContinuationObject, EquilibriumObject, SystemConfig } from './types';
import {
    ConfigEntry,
    MENU_PAGE_SIZE,
    formatUnset,
    parseFloatOrDefault,
    parseIntOrDefault,
    runConfigMenu
} from './menu';

const NAME_REGEX = /^[a-zA-Z0-9_]+$/;

function isValidName(name: string): boolean | string {
    if (!name || name.length === 0) return "Name cannot be empty.";
    if (!NAME_REGEX.test(name)) return "Name must contain only alphanumeric characters and underscores (no spaces).";
    return true;
}

export async function continuationMenu(sysName: string) {
    while (true) {
        const objects = Storage.listObjects(sysName);
        const branches = objects
            .map(name => Storage.loadObject(sysName, name))
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
            type: 'list',
            name: 'selection',
            message: 'Continuation Menu',
            choices,
            pageSize: MENU_PAGE_SIZE
        });

        if (selection === 'BACK') return;

        if (selection === 'CREATE') {
            await createBranch(sysName);
        } else {
            const branch = Storage.loadObject(sysName, selection) as ContinuationObject;
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
                    type: 'list',
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
                    type: 'list',
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
                        if (Storage.listObjects(sysName).includes(val)) return "Object name already exists.";
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
                    type: 'list',
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

        if (Storage.listObjects(sysName).includes(branchName)) {
            console.error(chalk.red(`Object "${branchName}" already exists.`));
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
        const branchData = bridge.compute_continuation(
            eqObj.solution!.state,
            selectedParamName,
            continuationSettings,
            forward
        );

        const branch: ContinuationObject = {
            type: 'continuation',
            name: branchName,
            systemName: sysName,
            parameterName: selectedParamName,
            startObject: selectedEqName,
            data: branchData,
            settings: continuationSettings,
            timestamp: new Date().toISOString()
        };

        Storage.saveObject(sysName, branch);
        console.log(chalk.green(`Continuation successful! Generated ${branchData.points.length} points.`));
        
        await inspectBranch(sysName, branch);

    } catch (e) {
        console.error(chalk.red("Continuation Failed:"), e);
    }
}

async function manageBranch(sysName: string, branch: ContinuationObject) {
    while (true) {
        console.log(chalk.blue(`Branch: ${branch.name}`));
        console.log(`Parameter: ${branch.parameterName}`);
        console.log(`Points: ${branch.data.points.length}`);
        
        const { action } = await inquirer.prompt({
            type: 'list',
            name: 'action',
            message: 'Branch Actions',
            choices: [
                { name: 'Inspect Data', value: 'Inspect Data' },
                { name: 'Extend Branch', value: 'Extend Branch' },
                { name: 'Delete Branch', value: 'Delete Branch' },
                { name: 'Back', value: 'Back' }
            ],
            pageSize: MENU_PAGE_SIZE
        });

        if (action === 'Back') return;

        if (action === 'Inspect Data') {
            await inspectBranch(sysName, branch);
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
                Storage.deleteObject(sysName, branch.name);
                return;
            }
        }
    }
}

async function extendBranch(sysName: string, branch: ContinuationObject) {
    const sysConfig = Storage.loadSystem(sysName);
    
    const { direction } = await inquirer.prompt({
        type: 'list',
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
            branch.data,
            branch.parameterName,
            continuationSettings,
            direction
        );

        branch.data = updatedData;
        branch.settings = continuationSettings; // Update last used settings
        
        Storage.saveObject(sysName, branch);
        console.log(chalk.green(`Extension successful! Total points: ${branch.data.points.length}`));
        
        await inspectBranch(sysName, branch);

    } catch (e) {
        console.error(chalk.red("Extension Failed:"), e);
    }
}

async function inspectBranch(sysName: string, branch: ContinuationObject) {
    console.log(chalk.yellow("Continuation Data:"));
    const pts = branch.data.points;
    const indices = branch.data.indices || pts.map((_, i) => i); // Fallback if indices missing
    
    if (pts.length === 0) {
        console.log("No points.");
        return;
    }

    const pName = branch.parameterName;
    
    // Print header
    console.log(`Index | ${pName.padEnd(10)} | Stability | Fold Test | Hopf Test | Neutral Test`);
    
    // Sort by index to show in order
    const sortedMap = pts.map((p, i) => ({ p, idx: indices[i], originalIdx: i }))
                         .sort((a, b) => a.idx - b.idx);

    // Show first few, bifurcations, and last few
    // But with arbitrary indices, we just want the extremes and special points.
    const itemsToShow = new Set<number>();
    
    // First 5
    for(let i=0; i<Math.min(5, sortedMap.length); i++) itemsToShow.add(i);
    // Last 5
    for(let i=Math.max(0, sortedMap.length-5); i<sortedMap.length; i++) itemsToShow.add(i);
    
    // Bifurcations (these indices in `data.bifurcations` are array indices, not logical indices)
    branch.data.bifurcations.forEach(arrayIdx => {
        // We need to find where this arrayIdx ended up in sortedMap?
        // No, arrayIdx refers to `branch.data.points[arrayIdx]`.
        // We want to show this point.
        // Find `k` such that `sortedMap[k].originalIdx == arrayIdx`.
        const k = sortedMap.findIndex(item => item.originalIdx === arrayIdx);
        if (k !== -1) itemsToShow.add(k);
    });

    const sortedShowIndices = Array.from(itemsToShow).sort((a,b) => a-b);

    let lastPos = -1;
    for (const i of sortedShowIndices) {
        if (lastPos !== -1 && i > lastPos + 1) {
            console.log("...");
        }
        const item = sortedMap[i];
        const pt = item.p;
        const tests = pt.test_function_values ?? {
            fold: pt.test_function_value ?? 0,
            hopf: 0,
            neutral_saddle: 0
        };
        const stab = branch.data.bifurcations.includes(item.originalIdx) ? chalk.red(pt.stability) : pt.stability;
        const foldVal = tests.fold.toPrecision(4).padEnd(10);
        const hopfVal = tests.hopf.toPrecision(4).padEnd(10);
        const neutralVal = tests.neutral_saddle.toPrecision(4).padEnd(13);
        const line = `${item.idx.toString().padEnd(5)} | ${pt.param_value.toPrecision(5).padEnd(10)} | ${stab.toString().padEnd(9)} | ${foldVal} | ${hopfVal} | ${neutralVal}`;
        console.log(line);
        lastPos = i;
    }

    if (branch.data.bifurcations.length > 0) {
        console.log(chalk.yellow("\nBifurcations Detected:"));
        branch.data.bifurcations.forEach(arrayIdx => {
            const pt = branch.data.points[arrayIdx];
            const idx = indices[arrayIdx];
            console.log(`  Index ${idx}: ${pt.stability} at ${pName} = ${pt.param_value}`);
        });
    }

    await inquirer.prompt({ type: 'input', name: 'cont', message: 'Press enter to continue...' });
}
