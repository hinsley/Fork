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
    LimitCycleMeta,
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

const NAME_REGEX = /^[a-zA-Z0-9_]+$/;

function isValidName(name: string): boolean | string {
    if (!name || name.length === 0) return "Name cannot be empty.";
    if (!NAME_REGEX.test(name)) return "Name must contain only alphanumeric characters and underscores (no spaces).";
    return true;
}

type LimitCycleBranchConfig = {
    branchName: string;
    amplitude: number;
    meshPoints: number;
    degree: number;
    directionForward: boolean;
    continuationSettings: {
        step_size: number;
        min_step_size: number;
        max_step_size: number;
        max_steps: number;
        corrector_steps: number;
        corrector_tolerance: number;
        step_tolerance: number;
    };
};

export async function continuationMenu(sysName: string) {
    while (true) {
        const objects = Storage.listObjects(sysName);
        const branches = objects
            .map(name => Storage.loadObject(sysName, name))
            .filter((obj): obj is ContinuationObject => obj.type === 'continuation');

        const choices: any[] = [
            { name: 'Create Equilibrium Branch', value: 'CREATE_EQ' },
            new inquirer.Separator()
        ];

        if (branches.length > 0) {
            branches.forEach(branch => {
                const kind = branch.branchKind ?? 'equilibrium';
                const tag =
                    kind === 'limitCycle'
                        ? chalk.magenta('[LC]')
                        : chalk.cyan('[EQ]');
                choices.push({
                    name: `${tag} ${branch.name} (Param: ${branch.parameterName}, Pts: ${branch.data.points.length})`,
                    value: branch.name
                });
            });
            choices.push(new inquirer.Separator());
        }

        choices.push({ name: 'Back', value: 'BACK' });

        const { selection } = await inquirer.prompt({
            type: 'list',
            name: 'selection',
            message: 'Continuation Menu',
            choices,
            pageSize: MENU_PAGE_SIZE
        });

        if (selection === 'BACK') return;

        if (selection === 'CREATE_EQ') {
            await createEquilibriumBranch(sysName);
        } else {
            const branch = Storage.loadObject(sysName, selection) as ContinuationObject;
            await manageBranch(sysName, branch);
        }
    }
}

async function createEquilibriumBranch(sysName: string) {
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

async function startLimitCycleBranch(
    sysName: string,
    sourceBranch: ContinuationObject,
    pointIndex: number
) {
    const sysConfig = Storage.loadSystem(sysName);
    const point = sourceBranch.data.points[pointIndex];
    if (!point || point.stability !== 'Hopf') {
        console.log(chalk.red('Selected point is not a Hopf bifurcation.'));
        return;
    }

    const config = await configureLimitCycleBranch(sysName, sourceBranch, pointIndex);
    if (!config) {
        return;
    }

    const methodRequest = {
        meshPoints: config.meshPoints,
        degree: config.degree!,
    };

    console.log(chalk.cyan('Computing limit cycle branch...'));

    try {
        const bridge = new WasmBridge(sysConfig);
        const response = bridge.compute_limit_cycle_from_hopf(
            point.state,
            point.param_value,
            sourceBranch.parameterName,
            methodRequest,
            config.amplitude,
            config.continuationSettings,
            config.directionForward
        );

        const normalized = normalizeBranchEigenvalues(response.branch);
        const limitCycleMeta: LimitCycleMeta = {
            method: 'collocation',
            meshPoints: response.meta.meshPoints ?? config.meshPoints,
            degree: response.meta.degree ?? config.degree!,
            phaseAnchor: response.meta.phaseAnchor,
            phaseDirection: response.meta.phaseDirection
        };

        const newBranch: ContinuationObject = {
            type: 'continuation',
            name: config.branchName,
            systemName: sysName,
            parameterName: sourceBranch.parameterName,
            startObject: `${sourceBranch.name}#${pointIndex}`,
            data: normalized,
            settings: config.continuationSettings,
            timestamp: new Date().toISOString(),
            branchKind: 'limitCycle',
            limitCycleMeta
        };

        Storage.saveObject(sysName, newBranch);
        console.log(
            chalk.green(
                `Limit cycle continuation successful! Generated ${newBranch.data.points.length} points.`
            )
        );
        await inspectBranch(sysName, newBranch);
    } catch (e) {
        console.error(chalk.red('Limit cycle continuation failed:'), e);
    }
}

async function configureLimitCycleBranch(
    sysName: string,
    branch: ContinuationObject,
    pointIndex: number
): Promise<LimitCycleBranchConfig | null> {
    let branchName = `${branch.name}_LC_${pointIndex}`;
    let amplitudeInput = '0.05';
    let meshPointsInput = '60';
    let degreeInput = '5';
    let directionForward = true;

    let stepSizeInput = '0.01';
    let minStepInput = '1e-5';
    let maxStepInput = '0.1';
    let maxPointsInput = '200';
    let correctorStepsInput = '4';
    let correctorToleranceInput = '1e-6';
    let stepToleranceInput = '1e-6';

    const entries: ConfigEntry[] = [
        {
            id: 'branchName',
            label: 'Branch name',
            section: 'General',
            getDisplay: () => formatUnset(branchName),
            edit: async () => {
                const { value } = await inquirer.prompt({
                    name: 'value',
                    message: 'Name for this Limit Cycle Branch:',
                    default: branchName,
                    validate: (val: string) => {
                        const valid = isValidName(val);
                        if (valid !== true) return valid;
                        return true;
                    }
                });
                branchName = value;
            }
        },
        {
            id: 'amplitude',
            label: 'Initial amplitude',
            section: 'General',
            getDisplay: () => formatUnset(amplitudeInput),
            edit: async () => {
                const { value } = await inquirer.prompt({
                    name: 'value',
                    message: 'Initial amplitude perturbation:',
                    default: amplitudeInput,
                    validate: (val: string) => {
                        const parsed = parseFloat(val);
                        if (!Number.isFinite(parsed) || parsed <= 0) {
                            return 'Enter a positive number.';
                        }
                        return true;
                    }
                });
                amplitudeInput = value;
            }
        },
        {
            id: 'meshPoints',
            label: 'Mesh points',
            section: 'Method',
            getDisplay: () => formatUnset(meshPointsInput),
            edit: async () => {
                const { value } = await inquirer.prompt({
                    name: 'value',
                    message: 'Mesh points (sampling of orbit):',
                    default: meshPointsInput,
                    validate: (val: string) => {
                        const parsed = parseInt(val, 10);
                        if (!Number.isFinite(parsed) || parsed < 3) {
                            return 'Enter an integer ≥ 3.';
                        }
                        return true;
                    }
                });
                meshPointsInput = value;
            }
        },
        {
            id: 'degree',
            label: 'Collocation degree',
            section: 'Method',
            getDisplay: () => formatUnset(degreeInput),
            edit: async () => {
                const { value } = await inquirer.prompt({
                    name: 'value',
                    message: 'Collocation degree:',
                    default: degreeInput,
                    validate: (val: string) => {
                        const parsed = parseInt(val, 10);
                        if (!Number.isFinite(parsed) || parsed < 2) {
                            return 'Enter an integer ≥ 2.';
                        }
                        return true;
                    }
                });
                degreeInput = value;
            }
        },
        {
            id: 'direction',
            label: 'Direction',
            section: 'Predictor Settings',
            getDisplay: () =>
                directionForward ? 'Forward (Increasing Param)' : 'Backward (Decreasing Param)',
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
            id: 'stepSize',
            label: 'Initial step size',
            section: 'Predictor Settings',
            getDisplay: () => formatUnset(stepSizeInput),
            edit: async () => {
                const { value } = await inquirer.prompt({
                    name: 'value',
                    message: 'Initial step size:',
                    default: stepSizeInput
                });
                stepSizeInput = value;
            }
        },
        {
            id: 'maxSteps',
            label: 'Max points',
            section: 'Predictor Settings',
            getDisplay: () => formatUnset(maxPointsInput),
            edit: async () => {
                const { value } = await inquirer.prompt({
                    name: 'value',
                    message: 'Max points:',
                    default: maxPointsInput
                });
                maxPointsInput = value;
            }
        },
        {
            id: 'minStep',
            label: 'Min step size',
            section: 'Predictor Settings',
            getDisplay: () => formatUnset(minStepInput),
            edit: async () => {
                const { value } = await inquirer.prompt({
                    name: 'value',
                    message: 'Min step size:',
                    default: minStepInput
                });
                minStepInput = value;
            }
        },
        {
            id: 'maxStep',
            label: 'Max step size',
            section: 'Predictor Settings',
            getDisplay: () => formatUnset(maxStepInput),
            edit: async () => {
                const { value } = await inquirer.prompt({
                    name: 'value',
                    message: 'Max step size:',
                    default: maxStepInput
                });
                maxStepInput = value;
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
        const result = await runConfigMenu('Configure Limit Cycle Branch', entries);
        if (result === 'back') {
            return null;
        }

        if (!branchName) {
            console.error(chalk.red('Please provide a branch name.'));
            continue;
        }

        const existing = new Set(Storage.listObjects(sysName));
        if (existing.has(branchName)) {
            console.error(chalk.red(`Object "${branchName}" already exists.`));
            continue;
        }

        const amplitude = parseFloat(amplitudeInput);
        const meshPoints = parseInt(meshPointsInput, 10);
        const degree = parseInt(degreeInput, 10);

        if (!Number.isFinite(amplitude) || amplitude <= 0) {
            console.error(chalk.red('Amplitude must be positive.'));
            continue;
        }
        if (!Number.isFinite(meshPoints) || meshPoints < 3) {
            console.error(chalk.red('Mesh points must be an integer ≥ 3.'));
            continue;
        }
        if (!Number.isFinite(degree) || degree < 2) {
            console.error(chalk.red('Collocation degree must be an integer ≥ 2.'));
            continue;
        }

        return {
            branchName,
            amplitude,
            meshPoints,
            degree,
            directionForward,
            continuationSettings: {
                step_size: Math.max(parseFloatOrDefault(stepSizeInput, 0.01), 1e-9),
                min_step_size: Math.max(parseFloatOrDefault(minStepInput, 1e-5), 1e-12),
                max_step_size: Math.max(parseFloatOrDefault(maxStepInput, 0.1), 1e-9),
                max_steps: Math.max(parseIntOrDefault(maxPointsInput, 200), 1),
                corrector_steps: Math.max(parseIntOrDefault(correctorStepsInput, 4), 1),
                corrector_tolerance: Math.max(
                    parseFloatOrDefault(correctorToleranceInput, 1e-6),
                    Number.EPSILON
                ),
                step_tolerance: Math.max(
                    parseFloatOrDefault(stepToleranceInput, 1e-6),
                    Number.EPSILON
                )
            }
        };
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
    const kind = branch.branchKind ?? 'equilibrium';
    if (kind === 'limitCycle') {
        await extendLimitCycleBranch(sysName, branch);
    } else {
        await extendEquilibriumBranch(sysName, branch);
    }
}

async function extendEquilibriumBranch(sysName: string, branch: ContinuationObject) {
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
            serializeBranchDataForWasm(branch.data),
            branch.parameterName,
            continuationSettings,
            direction
        );

        branch.data = normalizeBranchEigenvalues(updatedData);
        branch.settings = continuationSettings; // Update last used settings
        
        Storage.saveObject(sysName, branch);
        console.log(chalk.green(`Extension successful! Total points: ${branch.data.points.length}`));
        
        await inspectBranch(sysName, branch);

    } catch (e) {
        console.error(chalk.red("Extension Failed:"), e);
    }
}

async function extendLimitCycleBranch(sysName: string, branch: ContinuationObject) {
    const sysConfig = Storage.loadSystem(sysName);
    const meta = branch.limitCycleMeta;
    if (!meta) {
        console.log(chalk.red("This branch is missing limit cycle metadata and cannot be extended."));
        return;
    }

    if (!meta.phaseAnchor || !meta.phaseDirection) {
        console.log(chalk.red("Incomplete limit cycle metadata; cannot extend branch."));
        return;
    }

    const defaults = branch.settings || {};
    const answers = await inquirer.prompt([
        { name: 'max_steps', message: 'Max Points to Add (forward only):', default: '50' },
        { name: 'step_size', message: 'Step Size:', default: defaults.step_size?.toString() || '0.01' }
    ]);

    const continuationSettings = {
        step_size: parseFloat(answers.step_size),
        min_step_size: defaults.min_step_size || 1e-5,
        max_step_size: defaults.max_step_size || 0.1,
        max_steps: parseInt(answers.max_steps, 10),
        corrector_steps: defaults.corrector_steps || 4,
        corrector_tolerance: defaults.corrector_tolerance || 1e-6,
        step_tolerance: defaults.step_tolerance || 1e-6
    };

    console.log(chalk.cyan("Extending Limit Cycle Branch (forward only)..."));

    try {
        const bridge = new WasmBridge(sysConfig);
        if (!branch.data.indices || branch.data.indices.length !== branch.data.points.length) {
            branch.data.indices = branch.data.points.map((_, i) => i);
        }

        const response = bridge.extend_limit_cycle_branch(
            serializeBranchDataForWasm(branch.data),
            branch.parameterName,
            meta,
            continuationSettings,
            true
        );

        branch.data = normalizeBranchEigenvalues(response.branch);
        branch.limitCycleMeta = response.meta;
        branch.settings = continuationSettings;

        Storage.saveObject(sysName, branch);
        console.log(chalk.green(`Extension successful! Total points: ${branch.data.points.length}`));
        await inspectBranch(sysName, branch);
    } catch (e) {
        console.error(chalk.red("Limit cycle extension failed:"), e);
    }
}

type BranchDetailResult = 'SUMMARY' | 'EXIT';
const DETAIL_PAGE_SIZE = 10;

async function inspectBranch(sysName: string, branch: ContinuationObject) {
    await hydrateEigenvalues(sysName, branch);
    const points = branch.data.points;
    const kind = branch.branchKind ?? 'equilibrium';
    console.log(chalk.blue(`Branch type: ${kind === 'limitCycle' ? 'Limit Cycle' : 'Equilibrium'}`));
    if (kind === 'limitCycle' && branch.limitCycleMeta) {
        const meta = branch.limitCycleMeta;
        console.log(
            chalk.blue(
                `Method: ${meta.method}, mesh=${meta.meshPoints ?? 'n/a'}, degree=${meta.degree ?? 'n/a'}`
            )
        );
    }
    
    if (points.length === 0) {
        console.log(chalk.yellow("Continuation Data:"));
        console.log("No points.");
        return;
    }

    const indices = ensureBranchIndices(branch);
    await browseBranchSummary(sysName, branch, indices);
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

    Storage.saveObject(sysName, branch);
}

function buildSortedArrayOrder(indices: number[]): number[] {
    return indices
        .map((logicalIdx, arrayIdx) => ({ logicalIdx, arrayIdx }))
        .sort((a, b) => a.logicalIdx - b.logicalIdx)
        .map(entry => entry.arrayIdx);
}

async function browseBranchSummary(
    sysName: string,
    branch: ContinuationObject,
    indices: number[]
) {
    const sortedOrder = buildSortedArrayOrder(indices);
    while (true) {
        const summaryChoices = buildSummaryChoices(branch, indices, sortedOrder);
        const choices: any[] = [
            {
                name: chalk.green('Browse all points (pagination)'),
                value: 'BROWSE_ALL'
            },
            ...summaryChoices
        ];
        choices.push(new inquirer.Separator());
        choices.push({ name: chalk.red('Exit Branch Viewer'), value: 'EXIT' });

        const { selection } = await inquirer.prompt({
            type: 'list',
            name: 'selection',
            message: 'Branch Summary',
            choices,
            pageSize: MENU_PAGE_SIZE
        });

        if (selection === 'EXIT') {
            return;
        }

        if (selection === 'BROWSE_ALL') {
            const detailResult = await browseBranchPoints(
                sysName,
                branch,
                indices,
                sortedOrder[0],
                sortedOrder
            );
            if (detailResult === 'EXIT') {
                return;
            }
            continue;
        }

        if (typeof selection === 'string' && selection.startsWith('POINT:')) {
            const targetIdx = parseInt(selection.split(':')[1], 10);
            const detailResult = await browseBranchPoints(
                sysName,
                branch,
                indices,
                targetIdx,
                sortedOrder
            );
            if (detailResult === 'EXIT') {
                return;
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
            {
                name: page === 0 ? chalk.gray('◀ Previous Page') : '◀ Previous Page',
                value: 'PREV_PAGE',
                disabled: page === 0
            },
            {
                name: page >= totalPages - 1 ? chalk.gray('Next Page ▶') : 'Next Page ▶',
                value: 'NEXT_PAGE',
                disabled: page >= totalPages - 1
            },
            { name: 'Jump to Logical Index...', value: 'JUMP_INDEX' },
            { name: 'Back to Summary', value: 'SUMMARY' },
            { name: chalk.red('Exit Branch Viewer'), value: 'EXIT' },
            new inquirer.Separator()
        ];

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
            type: 'list',
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
            await showPointDetails(
                sysName,
                branch,
                indices,
                arrayIdx,
                bifurcationSet.has(arrayIdx)
            );
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
    const descriptor = summarizeSpectralSummary(
        pt,
        (branch.branchKind ?? 'equilibrium') === 'limitCycle'
    );
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

function summarizeSpectralSummary(point: ContinuationPoint, isLimitCycle: boolean) {
    const eigenvalues = point.eigenvalues || [];
    const label = isLimitCycle ? 'Floquet multipliers' : 'Eigenvalues';
    if (eigenvalues.length === 0) {
        return `${label}: []`;
    }
    const formatted = eigenvalues
        .slice(0, 3)
        .map(ev => `${formatNumberSafe(ev.re)}+${formatNumberSafe(ev.im)}i`);
    const suffix = eigenvalues.length > 3 ? ' …' : '';
    return `${label}: ${formatted.join(', ')}${suffix}`;
}

async function showPointDetails(
    sysName: string,
    branch: ContinuationObject,
    indices: number[],
    arrayIdx: number,
    isBifurcation: boolean
) {
    const pt = branch.data.points[arrayIdx];
    const logicalIdx = indices[arrayIdx];
    const isLimitCycle = (branch.branchKind ?? 'equilibrium') === 'limitCycle';

    console.log('');
    const headerSuffix = isBifurcation ? ' [Bifurcation]' : '';
    console.log(chalk.yellow(`Point ${logicalIdx} (Array ${arrayIdx})${headerSuffix}`));
    console.log(`Stability: ${pt.stability}`);
    console.log(`Parameter (${branch.parameterName}): ${formatNumber(pt.param_value)}`);
    console.log(isLimitCycle ? 'Floquet multipliers:' : 'Eigenvalues:');
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

    while (true) {
        const actions: Array<{ name: string; value: string }> = [
            { name: 'Back', value: 'BACK' }
        ];
        const isEquilibriumBranch = (branch.branchKind ?? 'equilibrium') === 'equilibrium';
        if (isEquilibriumBranch && pt.stability === 'Hopf') {
            actions.unshift({
                name: 'Switch to Limit Cycle Branch from this Hopf point',
                value: 'LC'
            });
        }

        const { action } = await inquirer.prompt({
            type: 'list',
            name: 'action',
            message: 'Point Actions',
            choices: actions,
            pageSize: MENU_PAGE_SIZE
        });

        if (action === 'BACK') {
            return;
        }

        if (action === 'LC') {
            await startLimitCycleBranch(sysName, branch, arrayIdx);
            return;
        }
    }
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
