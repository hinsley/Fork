import inquirer from 'inquirer';
import chalk from 'chalk';
import { Storage } from './storage';
import {
    AnalysisObject,
    ComplexValue,
    CovariantLyapunovData,
    EquilibriumObject,
    EquilibriumRunSummary,
    EquilibriumSolverParams,
    SystemConfig,
    OrbitObject
} from './types';
import { WasmBridge, CovariantLyapunovResponse } from './wasm';
import { continuationMenu } from './continuation';
import {
    ConfigEntry,
    MENU_PAGE_SIZE,
    formatUnset,
    parseFloatOrDefault,
    parseIntOrDefault,
    parseListInput,
    runConfigMenu
} from './menu';
import {
    printHeader,
    printField,
    printArray,
    printSuccess,
    printError,
    printInfo,
    printDivider,
    printBlank
} from './format';

const NAME_REGEX = /^[a-zA-Z0-9_]+$/;

function isValidName(name: string): boolean | string {
    if (!name || name.length === 0) return "Name cannot be empty.";
    if (!NAME_REGEX.test(name)) return "Name must contain only alphanumeric characters and underscores (no spaces).";
    return true;
}

function systemExists(name: string): boolean {
    return Storage.listSystems().includes(name);
}

function objectExists(sysName: string, objectName: string): boolean {
    return Storage.listObjects(sysName).includes(objectName);
}

async function mainMenu() {
    while (true) {
        const systems = Storage.listSystems();

        const choices = [];
        choices.push({ name: 'Create New System', value: 'CREATE' });

        if (systems.length > 0) {
            choices.push(new inquirer.Separator());
            systems.forEach(name => {
                const sys = Storage.loadSystem(name);
                const typeLabel = sys.type ? `(${sys.type})` : '(unknown)';
                choices.push({ name: `${name} ${typeLabel}`, value: name });
            });
        }

        choices.push(new inquirer.Separator());
        choices.push({ name: 'Exit', value: 'EXIT' });

        const { systemSelection } = await inquirer.prompt([{
            type: 'rawlist',
            name: 'systemSelection',
            message: 'Select a system',
            choices: choices,
            pageSize: MENU_PAGE_SIZE
        }]);

        if (systemSelection === 'EXIT') process.exit(0);

        if (systemSelection === 'CREATE') {
            await createSystem();
        } else {
            await systemContext(systemSelection);
        }
    }
}

async function systemContext(initialSysName: string) {
    let sysName = initialSysName;

    while (true) {
        const sys = Storage.loadSystem(sysName);
        const typeLabel = sys.type || 'flow';
        printHeader(sysName, `${typeLabel} system`);

        const choices = [
            { name: 'Objects', value: 'Objects' },
            { name: 'Continuation', value: 'Continuation' },
            new inquirer.Separator(),
            { name: 'Edit System', value: 'Edit System' },
            { name: 'Duplicate System', value: 'Duplicate System' },
            { name: 'Delete System', value: 'Delete System' },
            new inquirer.Separator(),
            { name: 'Back', value: 'Back' }
        ];

        const { action } = await inquirer.prompt([{
            type: 'rawlist',
            name: 'action',
            message: 'System Menu',
            choices: choices,
            pageSize: MENU_PAGE_SIZE
        }]);

        if (action === 'Back') return;

        if (action === 'Edit System') {
            const updatedName = await editSystem(sys);
            if (updatedName) {
                sysName = updatedName;
            }
        } else if (action === 'Duplicate System') {
            const { newName } = await inquirer.prompt({
                name: 'newName',
                message: 'New System Name:',
                default: `${sys.name}_copy`,
                validate: isValidName
            });

            if (systemExists(newName)) {
                console.error(chalk.red(`System "${newName}" already exists.`));
                continue;
            }

            const newSys: SystemConfig = { ...sys, name: newName };
            Storage.saveSystem(newSys);
            console.log(chalk.green(`System duplicated as ${newName}`));
            sysName = newName;
            console.log(chalk.cyan(`Switching to duplicated system: ${sysName}`));
            continue;
        } else if (action === 'Delete System') {
            const { confirm } = await inquirer.prompt({
                type: 'confirm',
                name: 'confirm',
                message: `Are you sure you want to delete ${sysName}?`,
                default: false
            });

            if (confirm) {
                Storage.deleteSystem(sysName);
                console.log(chalk.green(`System ${sysName} deleted.`));
                return;
            }
        } else if (action === 'Objects') {
            await objectsListMenu(sysName);
        } else if (action === 'Continuation') {
            await continuationMenu(sysName);
        }
    }
}

async function createSystem() {
    const { name } = await inquirer.prompt([
        { name: 'name', message: 'System Name:', validate: isValidName }
    ]);

    if (systemExists(name)) {
        console.error(chalk.red(`System "${name}" already exists.`));
        return;
    }

    let typeChoice = 'Flow';
    let varsInput = 'x';
    let paramsInput = '';

    const metaEntries: ConfigEntry[] = [
        {
            id: 'typeChoice',
            label: 'System Type',
            getDisplay: () => typeChoice,
            edit: async () => {
                const { value } = await inquirer.prompt({
                    type: 'rawlist',
                    name: 'value',
                    message: 'System Type (Flow = ODE, Map = Iterated Function):',
                    choices: ['Flow', 'Map'],
                    default: typeChoice
                });
                typeChoice = value;
            }
        },
        {
            id: 'vars',
            label: 'Variables (comma separated)',
            getDisplay: () => varsInput.trim().length > 0 ? varsInput : '(none)',
            edit: async () => {
                const { value } = await inquirer.prompt({
                    name: 'value',
                    message: 'Variables (comma separated, e.g. x,y,z):',
                    default: varsInput
                });
                varsInput = value;
            }
        },
        {
            id: 'params',
            label: 'Parameters (comma separated)',
            getDisplay: () => paramsInput.trim().length > 0 ? paramsInput : '(none)',
            edit: async () => {
                const { value } = await inquirer.prompt({
                    name: 'value',
                    message: 'Parameters (comma separated, e.g. r,s,b):',
                    default: paramsInput
                });
                paramsInput = value;
            }
        }
    ];

    const metaResult = await runConfigMenu('System Metadata', metaEntries);
    if (metaResult === 'back') {
        return;
    }

    const type = typeChoice.toLowerCase() as 'flow' | 'map';

    let defaultSolver = 'rk4';
    if (type === 'map') {
        defaultSolver = 'discrete';
    } else {
        const { solver } = await inquirer.prompt({
            name: 'solver',
            type: 'rawlist',
            choices: ['rk4', 'tsit5'],
            message: 'Default Solver:',
            pageSize: MENU_PAGE_SIZE
        });
        defaultSolver = solver;
    }

    const varNames = parseListInput(varsInput);
    const paramNames = parseListInput(paramsInput);

    const equations = varNames.map(() => '');

    if (varNames.length > 0) {
        const equationEntries: ConfigEntry[] = varNames.map((varName, idx) => {
            const prefix = type === 'map' ? `${varName}_{n+1}` : `d${varName}/dt`;
            return {
                id: `eq_${idx}`,
                label: `${prefix} equation`,
                getDisplay: () => formatUnset(equations[idx]),
                edit: async () => {
                    const { eq } = await inquirer.prompt({
                        name: 'eq',
                        message: `${prefix} = `,
                        default: equations[idx]
                    });
                    equations[idx] = eq;
                }
            };
        });

        const equationResult = await runConfigMenu('Define Equations', equationEntries);
        if (equationResult === 'back') {
            return;
        }
    }

    const paramValuesInput = paramNames.map(() => '0');

    if (paramNames.length > 0) {
        const paramEntries: ConfigEntry[] = paramNames.map((paramName, idx) => ({
            id: `param_${idx}`,
            label: `Default value for ${paramName}`,
            getDisplay: () => formatUnset(paramValuesInput[idx]),
            edit: async () => {
                const { value } = await inquirer.prompt({
                    name: 'value',
                    message: `Default value for ${paramName}:`,
                    default: paramValuesInput[idx],
                    validate: (input: string) => {
                        if (input.trim().length === 0) {
                            return true;
                        }
                        return Number.isFinite(parseFloat(input)) ? true : 'Please enter a number.';
                    }
                });
                paramValuesInput[idx] = value;
            }
        }));

        const paramsResult = await runConfigMenu('Parameter Defaults', paramEntries);
        if (paramsResult === 'back') {
            return;
        }
    }

    const paramValues = paramValuesInput.map(value => parseFloatOrDefault(value, 0));

    const config: SystemConfig = {
        name: name,
        type: type,
        equations,
        params: paramValues,
        paramNames,
        varNames,
        solver: defaultSolver
    };

    Storage.saveSystem(config);
    console.log(chalk.green(`System ${config.name} (${config.type}) saved!`));
}

async function editSystem(sys: SystemConfig): Promise<string | undefined> {
    const originalName = sys.name;

    while (true) {
        printHeader(`Edit: ${sys.name}`, `${sys.type || 'flow'} system`);
        printField('Solver', sys.solver);
        printField('Variables', sys.varNames.join(', '));
        console.log(chalk.dim('  Equations:'));
        sys.varNames.forEach((v, i) => {
            const prefix = sys.type === 'map' ? `${v}_{n+1}` : `d${v}/dt`;
            console.log(`    ${chalk.cyan(prefix)} = ${sys.equations[i]}`);
        });
        console.log(chalk.dim('  Parameters:'));
        sys.paramNames.forEach((p, i) => console.log(`    ${chalk.cyan(p)} = ${sys.params[i]}`));

        const choices: any[] = [
            { name: 'Edit Name', value: 'Edit Name' },
            { name: 'Edit Equations', value: 'Edit Equations' },
            { name: 'Edit Parameters', value: 'Edit Parameters' },
        ];
        if (!sys.type || sys.type === 'flow') {
            choices.push({ name: 'Change Solver', value: 'Change Solver' });
        }
        choices.push(new inquirer.Separator());
        choices.push({ name: 'Save & Back', value: 'Save & Back' });
        choices.push({ name: 'Cancel', value: 'Cancel' });

        const { action } = await inquirer.prompt([{
            type: 'rawlist',
            name: 'action',
            message: 'Edit Options',
            choices,
            pageSize: MENU_PAGE_SIZE
        }]);

        if (action === 'Cancel') {
            return undefined;
        }
        if (action === 'Save & Back') {
            if (sys.name !== originalName) {
                Storage.deleteSystem(originalName);
            }
            Storage.saveSystem(sys);
            console.log(chalk.green("System saved."));
            if (sys.name !== originalName) {
                console.log(chalk.yellow("System name changed. Returning to system menu."));
            }
            return sys.name;
        }

        if (action === 'Edit Name') {
            const { name } = await inquirer.prompt({
                name: 'name',
                message: 'New System Name:',
                default: sys.name,
                validate: isValidName
            });
            if (name !== sys.name && systemExists(name)) {
                console.error(chalk.red(`System "${name}" already exists.`));
                continue;
            }
            sys.name = name;
        } else if (action === 'Edit Equations') {
            while (true) {
                const choices: any[] = sys.varNames.map((v, i) => {
                    const prefix = sys.type === 'map' ? `${v}_{n+1}` : `d${v}/dt`;
                    return { name: `${prefix} = ${sys.equations[i]}`, value: i };
                });
                choices.push(new inquirer.Separator());
                choices.push({ name: 'Back', value: -1 });

                const { eqIdx } = await inquirer.prompt({
                    type: 'rawlist',
                    name: 'eqIdx',
                    message: 'Select Equation to Edit:',
                    choices,
                    pageSize: MENU_PAGE_SIZE
                });

                if (eqIdx === -1) break;

                const v = sys.varNames[eqIdx];
                const prefix = sys.type === 'map' ? `${v}_{n+1}` : `d${v}/dt`;
                const { eq } = await inquirer.prompt({
                    name: 'eq',
                    message: `${prefix} = `,
                    default: sys.equations[eqIdx]
                });
                sys.equations[eqIdx] = eq;
            }
        } else if (action === 'Edit Parameters') {
            while (true) {
                const choices: any[] = sys.paramNames.map((p, i) => {
                    return { name: `${p} = ${sys.params[i]}`, value: i };
                });
                choices.push(new inquirer.Separator());
                choices.push({ name: 'Back', value: -1 });

                const { paramIdx } = await inquirer.prompt({
                    type: 'rawlist',
                    name: 'paramIdx',
                    message: 'Select Parameter to Edit:',
                    choices,
                    pageSize: MENU_PAGE_SIZE
                });

                if (paramIdx === -1) break;

                const p = sys.paramNames[paramIdx];
                const { val } = await inquirer.prompt({
                    name: 'val',
                    message: `Value for ${p}:`,
                    default: sys.params[paramIdx].toString()
                });
                sys.params[paramIdx] = parseFloat(val);
            }
        } else if (action === 'Change Solver') {
            const { solver } = await inquirer.prompt({
                type: 'rawlist',
                name: 'solver',
                message: 'Select Solver:',
                choices: ['rk4', 'tsit5'],
                default: sys.solver,
                pageSize: MENU_PAGE_SIZE
            });
            sys.solver = solver;
        }
    }
}

async function objectsListMenu(sysName: string) {
    while (true) {
        const objects = Storage.listObjects(sysName);
        const choices = [];

        choices.push({ name: 'Create New Object', value: 'CREATE' });

        if (objects.length > 0) {
            choices.push(new inquirer.Separator());
            objects.forEach(name => {
                const obj = Storage.loadObject(sysName, name);
                if (obj.type === 'continuation') return; // Filter out continuation branches
                choices.push({ name: `${name} (${obj.type})`, value: name });
            });
        }

        choices.push(new inquirer.Separator());
        choices.push({ name: 'Back', value: 'BACK' });

        const { objName } = await inquirer.prompt({
            type: 'rawlist',
            name: 'objName',
            message: 'Select Object to Manage',
            choices: choices,
            pageSize: MENU_PAGE_SIZE
        });

        if (objName === 'BACK') return;

        if (objName === 'CREATE') {
            const { objType } = await inquirer.prompt({
                type: 'rawlist',
                name: 'objType',
                message: 'Select Object Type:',
                choices: [
                    { name: 'Orbit', value: 'Orbit' },
                    { name: 'Equilibrium', value: 'Equilibrium' },
                    new inquirer.Separator(),
                    { name: 'Back', value: 'Back' }
                ],
            });

            if (objType === 'Back') continue;

            if (objType === 'Orbit') {
                await createOrbit(sysName);
            } else if (objType === 'Equilibrium') {
                await createEquilibrium(sysName);
            }
        } else {
            const obj = Storage.loadObject(sysName, objName) as AnalysisObject;
            // Should not happen due to filter, but safety check
            if (obj.type !== 'continuation') {
                await manageObject(sysName, obj);
            }
        }
    }
}

async function createOrbit(sysName: string) {
    const sysConfig = Storage.loadSystem(sysName);

    const { objName } = await inquirer.prompt({
        name: 'objName',
        message: 'Name for this Orbit Object:',
        validate: isValidName
    });

    if (objectExists(sysName, objName)) {
        console.error(chalk.red(`Object "${objName}" already exists.`));
        return;
    }

    const initialStateInputs = sysConfig.varNames.map(() => '0');

    if (initialStateInputs.length > 0) {
        const initialEntries: ConfigEntry[] = sysConfig.varNames.map((varName, idx) => ({
            id: `ic_${idx}`,
            label: `Initial ${varName}`,
            getDisplay: () => formatUnset(initialStateInputs[idx]),
            edit: async () => {
                const { value } = await inquirer.prompt({
                    name: 'value',
                    message: `Initial ${varName}:`,
                    default: initialStateInputs[idx],
                    validate: (input: string) => {
                        if (input.trim().length === 0) {
                            return true;
                        }
                        return Number.isFinite(parseFloat(input)) ? true : 'Please enter a number.';
                    }
                });
                initialStateInputs[idx] = value;
            }
        }));

        const initResult = await runConfigMenu('Initial Conditions', initialEntries);
        if (initResult === 'back') {
            return;
        }
    }

    const ic = initialStateInputs.map(val => parseFloatOrDefault(val, 0));

    const isMap = sysConfig.type === 'map';
    const durationLabel = isMap ? 'Iterations (n)' : 'Duration (t)';
    const defaultDurationValue = isMap ? 1000 : 100;
    const defaultDtValue = isMap ? 1 : 0.01;
    let durationInput = defaultDurationValue.toString();
    let dtInput = defaultDtValue.toString();

    const simEntries: ConfigEntry[] = [
        {
            id: 'duration',
            label: durationLabel,
            getDisplay: () => formatUnset(durationInput),
            edit: async () => {
                const { value } = await inquirer.prompt({
                    name: 'value',
                    message: `${durationLabel}:`,
                    default: durationInput,
                    validate: (input: string) => {
                        if (input.trim().length === 0) {
                            return true;
                        }
                        return Number.isFinite(parseFloat(input)) ? true : 'Please enter a number.';
                    }
                });
                durationInput = value;
            }
        }
    ];

    if (!isMap) {
        simEntries.push({
            id: 'dt',
            label: 'Step size (dt)',
            getDisplay: () => formatUnset(dtInput),
            edit: async () => {
                const { value } = await inquirer.prompt({
                    name: 'value',
                    message: 'Step size (dt):',
                    default: dtInput,
                    validate: (input: string) => {
                        if (input.trim().length === 0) {
                            return true;
                        }
                        return Number.isFinite(parseFloat(input)) ? true : 'Please enter a number.';
                    }
                });
                dtInput = value;
            }
        });
    }

    const simResult = await runConfigMenu('Simulation Settings', simEntries);
    if (simResult === 'back') {
        return;
    }

    const t_end = parseFloatOrDefault(durationInput, defaultDurationValue);
    const dt = isMap ? defaultDtValue : parseFloatOrDefault(dtInput, defaultDtValue);

    console.log(chalk.cyan("Initializing WASM Engine..."));

    try {
        const bridge = new WasmBridge(sysConfig);
        bridge.set_state(ic);

        const steps = Math.ceil(t_end / dt);
        const data = [];

        let current_t = 0;
        data.push([current_t, ...ic]);

        const spinner = ['|', '/', '-', '\\'];
        process.stdout.write("Simulating... ");

        const updateInterval = isMap ? 10000 : 1000;

        for (let i = 0; i < steps; i++) {
            bridge.step(dt);
            current_t += dt;
            data.push([current_t, ...bridge.get_state()]);

            if (i % updateInterval === 0) {
                process.stdout.write(`\rSimulating... ${spinner[(i / updateInterval) % 4]} ${(i / steps * 100).toFixed(0)}%`);
            }
        }
        console.log(`\rSimulating... Done!   `);

        const orbit: OrbitObject = {
            type: 'orbit',
            name: objName,
            systemName: sysConfig.name,
            parameters: [...sysConfig.params],
            data,
            t_start: 0,
            t_end: current_t,
            dt
        };

        Storage.saveObject(sysName, orbit);
        console.log(chalk.green(`Orbit ${orbit.name} saved with ${data.length} points.`));

        await manageObject(sysName, orbit);
    } catch (e) {
        console.error(chalk.red("Simulation Failed:"), e);
    }
}

async function createEquilibrium(sysName: string) {
    const sysConfig = Storage.loadSystem(sysName);
    const { name } = await inquirer.prompt({
        name: 'name',
        message: 'Name for this Equilibrium Object:',
        validate: isValidName
    });

    if (objectExists(sysName, name)) {
        console.error(chalk.red(`Object "${name}" already exists.`));
        return;
    }

    const defaultParams: EquilibriumSolverParams = {
        initialGuess: sysConfig.varNames.map(() => 0),
        maxSteps: 25,
        dampingFactor: 1
    };

    const eq: EquilibriumObject = {
        type: 'equilibrium',
        name,
        systemName: sysConfig.name,
        parameters: [...sysConfig.params],
        lastSolverParams: defaultParams
    };

    Storage.saveObject(sysName, eq);
    console.log(chalk.green(`Equilibrium ${name} created.`));

    await manageEquilibrium(sysName, eq);
}

async function manageObject(sysName: string, obj: AnalysisObject) {
    if (obj.type === 'orbit') {
        await manageOrbit(sysName, obj as OrbitObject);
    } else if (obj.type === 'equilibrium') {
        await manageEquilibrium(sysName, obj as EquilibriumObject);
    }
}

async function manageOrbit(sysName: string, obj: OrbitObject) {
    while (true) {
        printHeader(obj.name, 'orbit');
        printField('System', obj.systemName);
        if (obj.parameters) {
            printArray('Parameters', obj.parameters);
        }
        printField('Data Points', obj.data.length.toLocaleString());
        printBlank();

        const { action } = await inquirer.prompt([{
            type: 'rawlist',
            name: 'action',
            message: 'Object Actions',
            choices: [
                { name: 'Inspect Data', value: 'Inspect Data' },
                { name: 'Extend Orbit', value: 'Extend Orbit' },
                { name: 'Oseledets Solver', value: 'Oseledets Solver' },
                new inquirer.Separator(),
                { name: 'Rename Object', value: 'Rename Object' },
                { name: 'Delete Object', value: 'Delete Object' },
                new inquirer.Separator(),
                { name: 'Back', value: 'Back' }
            ],
            pageSize: MENU_PAGE_SIZE
        }]);

        if (action === 'Back') {
            return;
        }

        if (action === 'Rename Object') {
            const { newName } = await inquirer.prompt({
                name: 'newName',
                message: 'New Object Name:',
                default: obj.name,
                validate: isValidName
            });

            if (newName !== obj.name && objectExists(sysName, newName)) {
                console.error(chalk.red(`Object "${newName}" already exists.`));
                continue;
            }

            if (newName !== obj.name) {
                Storage.deleteObject(sysName, obj.name);
                obj.name = newName;
                Storage.saveObject(sysName, obj);
                console.log(chalk.green(`Object renamed to ${newName}.`));
            }
            continue;
        }

        if (action === 'Delete Object') {
            const targetName = obj.name;
            const { confirm } = await inquirer.prompt({
                type: 'confirm',
                name: 'confirm',
                message: `Are you sure you want to delete ${targetName}?`,
                default: false
            });

            if (confirm) {
                Storage.deleteObject(sysName, targetName);
                console.log(chalk.green(`Object ${targetName} deleted.`));
                return;
            }
            continue;
        }

        if (action === 'Inspect Data') {
            await inspectOrbitData(sysName, obj);
            continue;
        }

        if (action === 'Oseledets Solver') {
            await oseledetsSolverMenu(sysName, obj);
            continue;
        }

        if (action === 'Extend Orbit') {
            const sysConfig = Storage.loadSystem(obj.systemName);
            const isMap = sysConfig.type === 'map';

            try {
                const bridge = new WasmBridge(sysConfig);
                const lastPoint = obj.data[obj.data.length - 1];
                const lastT = lastPoint[0];
                const lastState = lastPoint.slice(1);

                bridge.set_t(lastT);
                bridge.set_state(lastState);

                const durationMessage = isMap
                    ? 'Extend by how many iterations?'
                    : 'Extend by how much time?';
                const durationLabel = isMap ? 'Iterations to add' : 'Time to add';
                const defaultDurationValue = isMap ? 1000 : 50;
                const fallbackDt = obj.dt ?? 0.01;
                let durationInput = defaultDurationValue.toString();
                let dtInput = fallbackDt.toString();

                const extendEntries: ConfigEntry[] = [
                    {
                        id: 'duration',
                        label: durationLabel,
                        getDisplay: () => formatUnset(durationInput),
                        edit: async () => {
                            const { value } = await inquirer.prompt({
                                name: 'value',
                                message: durationMessage,
                                default: durationInput,
                                validate: (input: string) => {
                                    if (input.trim().length === 0) {
                                        return true;
                                    }
                                    return Number.isFinite(parseFloat(input)) ? true : 'Please enter a number.';
                                }
                            });
                            durationInput = value;
                        }
                    }
                ];

                if (!isMap) {
                    extendEntries.push({
                        id: 'dt',
                        label: 'Step size (dt)',
                        getDisplay: () => formatUnset(dtInput),
                        edit: async () => {
                            const { value } = await inquirer.prompt({
                                name: 'value',
                                message: 'Step size (dt):',
                                default: dtInput,
                                validate: (input: string) => {
                                    if (input.trim().length === 0) {
                                        return true;
                                    }
                                    return Number.isFinite(parseFloat(input)) ? true : 'Please enter a number.';
                                }
                            });
                            dtInput = value;
                        }
                    });
                }

                const extendResult = await runConfigMenu('Extend Orbit Settings', extendEntries);
                if (extendResult === 'back') {
                    continue;
                }

                const t_add = parseFloatOrDefault(durationInput, defaultDurationValue);
                const dt = isMap ? 1 : parseFloatOrDefault(dtInput, fallbackDt);
                obj.dt = dt;

                const steps = Math.ceil(t_add / dt);

                process.stdout.write("Extending... ");
                const updateInterval = isMap ? 10000 : 1000;

                for (let i = 0; i < steps; i++) {
                    bridge.step(dt);
                    const t = bridge.get_t();
                    obj.data.push([t, ...bridge.get_state()]);

                    if (i % updateInterval === 0) {
                        process.stdout.write(`\rExtending... ${(i / steps * 100).toFixed(0)}%`);
                    }
                }
                console.log("\rExtending... Done!   ");

                obj.t_end = bridge.get_t();
                Storage.saveObject(sysName, obj);
                console.log(chalk.green("Orbit extended and saved."));
            } catch (e) {
                console.error(chalk.red("Extension Failed:"), e);
            }
        }
    }
}

async function oseledetsSolverMenu(sysName: string, obj: OrbitObject) {
    while (true) {
        const { task } = await inquirer.prompt([{
            type: 'rawlist',
            name: 'task',
            message: 'Oseledets Solver',
            choices: [
                { name: 'Lyapunov Exponents', value: 'Lyapunov Exponents' },
                { name: 'Covariant Lyapunov Vectors', value: 'Covariant Lyapunov Vectors' },
                new inquirer.Separator(),
                { name: 'Back', value: 'Back' }
            ],
            pageSize: MENU_PAGE_SIZE
        }]);

        if (task === 'Back') {
            return;
        }

        if (task === 'Lyapunov Exponents') {
            await runLyapunovExponents(sysName, obj);
        } else if (task === 'Covariant Lyapunov Vectors') {
            await runCovariantLyapunovVectors(sysName, obj);
        }
    }
}

async function runLyapunovExponents(sysName: string, obj: OrbitObject) {
    const sysConfig = Storage.loadSystem(obj.systemName);
    const duration = obj.t_end - obj.t_start;
    if (duration <= 0) {
        console.error(chalk.red("Orbit has no duration to analyze."));
        return;
    }

    console.log(
        chalk.cyan(
            `Trajectory duration: ${duration.toFixed(6)} (t = ${obj.t_start.toFixed(
                6
            )} → ${obj.t_end.toFixed(6)})`
        )
    );

    const dt = obj.dt || (sysConfig.type === 'map' ? 1 : 0.01);
    if (dt <= 0) {
        console.error(chalk.red("Invalid step size detected for this orbit."));
        return;
    }

    let transientInput = '0';
    let qrInput = '1';

    const lyapunovEntries: ConfigEntry[] = [
        {
            id: 'transient',
            label: 'Transient time to discard',
            getDisplay: () => formatUnset(transientInput),
            edit: async () => {
                const { value } = await inquirer.prompt({
                    name: 'value',
                    message: 'Transient time to discard:',
                    default: transientInput,
                    validate: (input: string) => {
                        const val = parseFloat(input);
                        if (!Number.isFinite(val)) {
                            return "Please enter a number.";
                        }
                        if (val < 0 || val > duration) {
                            return `Value must be between 0 and ${duration.toFixed(6)}.`;
                        }
                        return true;
                    }
                });
                transientInput = value;
            }
        },
        {
            id: 'qr',
            label: 'Steps between QR decompositions',
            getDisplay: () => formatUnset(qrInput),
            edit: async () => {
                const { value } = await inquirer.prompt({
                    name: 'value',
                    message: 'Steps between QR decompositions:',
                    default: qrInput,
                    validate: (input: string) => {
                        const n = parseInt(input, 10);
                        if (!Number.isFinite(n) || n <= 0) {
                            return "Enter a positive integer.";
                        }
                        return true;
                    }
                });
                qrInput = value;
            }
        }
    ];

    const lyapunovResult = await runConfigMenu('Lyapunov Parameters', lyapunovEntries);
    if (lyapunovResult === 'back') {
        return;
    }

    const transient = Math.min(
        Math.max(parseFloatOrDefault(transientInput, 0), 0),
        duration
    );
    const targetTime = obj.t_start + transient;

    let startIndex = obj.data.length - 1;
    for (let i = 0; i < obj.data.length; i++) {
        if (obj.data[i][0] >= targetTime) {
            startIndex = i;
            break;
        }
    }

    if (startIndex >= obj.data.length - 1) {
        console.error(chalk.red("Transient leaves no data to analyze."));
        return;
    }

    const steps = obj.data.length - startIndex - 1;
    const qrStride = Math.max(parseIntOrDefault(qrInput, 1), 1);

    const startState = obj.data[startIndex].slice(1);
    const startTime = obj.data[startIndex][0];

    try {
        const bridge = new WasmBridge(sysConfig);
        console.log(chalk.yellow("Computing..."));
        const exponents = bridge.computeLyapunovExponents(
            startState,
            startTime,
            steps,
            dt,
            qrStride
        );
        obj.lyapunovExponents = exponents;
        Storage.saveObject(sysName, obj);
        console.log(chalk.green("Lyapunov exponents computed and stored."));
        await inspectOrbitData(sysName, obj);
    } catch (err) {
        const message = err instanceof Error ? err.message : `${err}`;
        console.error(chalk.red("Lyapunov computation failed:"), message);
    }
}

async function runCovariantLyapunovVectors(sysName: string, obj: OrbitObject) {
    const sysConfig = Storage.loadSystem(obj.systemName);
    const duration = obj.t_end - obj.t_start;
    if (duration <= 0) {
        console.error(chalk.red("Orbit has no duration to analyze."));
        return;
    }

    console.log(
        chalk.cyan(
            `Trajectory duration: ${duration.toFixed(6)} (t = ${obj.t_start.toFixed(
                6
            )} → ${obj.t_end.toFixed(6)})`
        )
    );

    const dt = obj.dt || (sysConfig.type === 'map' ? 1 : 0.01);
    if (dt <= 0) {
        console.error(chalk.red("Invalid step size detected for this orbit."));
        return;
    }

    let transientInput = '0';
    let forwardInput = '0';
    let backwardInput = '0';
    let qrInput = '1';

    const entries: ConfigEntry[] = [
        {
            id: 'transient',
            label: 'Transient time to discard',
            getDisplay: () => formatUnset(transientInput),
            edit: async () => {
                const { value } = await inquirer.prompt({
                    name: 'value',
                    message: 'Transient time to discard:',
                    default: transientInput,
                    validate: (input: string) => {
                        const val = parseFloat(input);
                        if (!Number.isFinite(val) || val < 0 || val > duration) {
                            return `Value must be between 0 and ${duration.toFixed(6)}.`;
                        }
                        return true;
                    }
                });
                transientInput = value;
            }
        },
        {
            id: 'forward',
            label: 'Forward transient (pre-window)',
            getDisplay: () => formatUnset(forwardInput),
            edit: async () => {
                const { value } = await inquirer.prompt({
                    name: 'value',
                    message: 'Forward transient (pre-window):',
                    default: forwardInput,
                    validate: (input: string) => {
                        const val = parseFloat(input);
                        if (!Number.isFinite(val) || val < 0) {
                            return "Enter a non-negative number.";
                        }
                        const transient = Math.max(parseFloatOrDefault(transientInput, 0), 0);
                        const remaining = duration - transient;
                        if (val >= remaining) {
                            return `Value must be less than ${remaining.toFixed(6)} to leave time for the window.`;
                        }
                        return true;
                    }
                });
                forwardInput = value;
            }
        },
        {
            id: 'backward',
            label: 'Backward transient (post-window)',
            getDisplay: () => formatUnset(backwardInput),
            edit: async () => {
                const { value } = await inquirer.prompt({
                    name: 'value',
                    message: 'Backward transient (post-window):',
                    default: backwardInput,
                    validate: (input: string) => {
                        const val = parseFloat(input);
                        if (!Number.isFinite(val) || val < 0) {
                            return "Enter a non-negative number.";
                        }
                        return true;
                    }
                });
                backwardInput = value;
            }
        },
        {
            id: 'qr',
            label: 'Steps between QR decompositions',
            getDisplay: () => formatUnset(qrInput),
            edit: async () => {
                const { value } = await inquirer.prompt({
                    name: 'value',
                    message: 'Steps between QR decompositions:',
                    default: qrInput,
                    validate: (input: string) => {
                        const n = parseInt(input, 10);
                        if (!Number.isFinite(n) || n <= 0) {
                            return "Enter a positive integer.";
                        }
                        return true;
                    }
                });
                qrInput = value;
            }
        }
    ];

    let selection:
        | {
            transient: number;
            totalAvailable: number;
            forwardTime: number;
            backwardTime: number;
            qrStride: number;
        }
        | null = null;

    while (!selection) {
        const result = await runConfigMenu('Covariant Lyapunov Parameters', entries);
        if (result === 'back') {
            return;
        }

        const transient = Math.min(
            Math.max(parseFloatOrDefault(transientInput, 0), 0),
            duration
        );
        const totalAvailable = duration - transient;
        if (totalAvailable <= 0) {
            console.error(chalk.red("Transient leaves no data to analyze. Reduce it and try again."));
            continue;
        }

        const forwardTime = Math.max(
            Math.min(parseFloatOrDefault(forwardInput, 0), totalAvailable - dt),
            0
        );
        const backwardTime = Math.max(parseFloatOrDefault(backwardInput, 0), 0);
        const qrStride = Math.max(parseIntOrDefault(qrInput, 1), 1);

        const transientSum = transient + forwardTime + backwardTime;
        if (transientSum >= duration) {
            console.error(
                chalk.red(
                    `Combined transient durations (${transientSum.toFixed(
                        6
                    )}) exceed the trajectory duration (${duration.toFixed(
                        6
                    )}). Adjust the values and try again.`
                )
            );
            continue;
        }

        selection = { transient, totalAvailable, forwardTime, backwardTime, qrStride };
    }

    const { transient, totalAvailable, forwardTime, backwardTime, qrStride } = selection;
    const remainingAfterForward = totalAvailable - forwardTime;
    if (remainingAfterForward <= 0) {
        console.error(chalk.red("Forward transient consumes all available time."));
        return;
    }
    const targetTime = obj.t_start + transient;

    let startIndex = obj.data.length - 1;
    for (let i = 0; i < obj.data.length; i++) {
        if (obj.data[i][0] >= targetTime) {
            startIndex = i;
            break;
        }
    }
    if (startIndex >= obj.data.length - 1) {
        console.error(chalk.red("Transient leaves no data to analyze."));
        return;
    }

    const stepsAvailable = obj.data.length - startIndex - 1;
    if (stepsAvailable <= 0) {
        console.error(chalk.red("Not enough samples beyond the transient point."));
        return;
    }

    const forwardSteps = Math.min(
        Math.max(Math.floor(forwardTime / dt), 0),
        Math.max(stepsAvailable - 1, 0)
    );
    if (forwardSteps >= stepsAvailable) {
        console.error(chalk.red("Forward transient exceeds available samples."));
        return;
    }

    const maxWindowSteps = Math.max(stepsAvailable - forwardSteps, 0);
    if (maxWindowSteps === 0) {
        console.error(chalk.red("No samples remain for the analysis window."));
        return;
    }

    const windowSteps = maxWindowSteps;

    const backwardSteps = Math.max(Math.floor(backwardTime / dt), 0);
    const startState = obj.data[startIndex].slice(1);
    const startTime = obj.data[startIndex][0];

    try {
        const bridge = new WasmBridge(sysConfig);
        console.log(chalk.yellow("Computing covariant Lyapunov vectors..."));
        const payload = bridge.computeCovariantLyapunovVectors(
            startState,
            startTime,
            windowSteps,
            dt,
            qrStride,
            forwardSteps,
            backwardSteps
        );

        if (!payload.checkpoints || payload.vectors.length === 0) {
            console.error(chalk.red("No covariant vectors returned by the solver."));
            return;
        }

        const covariantData = reshapeCovariantVectors(payload);
        obj.covariantVectors = covariantData;
        Storage.saveObject(sysName, obj);
        console.log(
            chalk.green(
                `Stored ${covariantData.vectors.length} covariant Lyapunov vector sets (dimension ${covariantData.dim}).`
            )
        );
        await inspectOrbitData(sysName, obj);
    } catch (err) {
        const message = err instanceof Error ? err.message : `${err}`;
        console.error(chalk.red("Covariant Lyapunov computation failed:"), message);
    }
}

async function inspectOrbitData(sysName: string, obj: OrbitObject) {
    console.log(chalk.yellow("Data Points:"));
    const head = obj.data.slice(0, 5);
    head.forEach((pt: number[]) => {
        console.log(`  t=${pt[0].toFixed(3)}: [${pt.slice(1).map(x => x.toFixed(4)).join(', ')}]`);
    });

    if (obj.data.length > 10) {
        console.log(chalk.gray("  ..."));
    }

    const tail = obj.data.slice(-5);
    if (obj.data.length > 5) {
        tail.forEach((pt: number[]) => {
            console.log(`  t=${pt[0].toFixed(3)}: [${pt.slice(1).map(x => x.toFixed(4)).join(', ')}]`);
        });
    }

    console.log('');
    if (obj.lyapunovExponents && obj.lyapunovExponents.length > 0) {
        console.log(chalk.yellow('Lyapunov Exponents:'));
        obj.lyapunovExponents.forEach((lambda, idx) => {
            console.log(`  λ${idx + 1}: ${lambda.toFixed(6)}`);
        });
        const dimension = kaplanYorkeDimension(obj.lyapunovExponents);
        if (dimension !== null) {
            console.log(chalk.cyan(`Lyapunov Dimension: ${dimension.toFixed(6)}`));
        }
    } else {
        console.log(chalk.gray('Lyapunov exponents not computed yet. Use the Oseledets Solver to compute them.'));
    }

    if (obj.covariantVectors && obj.covariantVectors.vectors.length > 0) {
        console.log(chalk.yellow('Covariant Lyapunov Vectors:'));
        console.log(`  Checkpoints: ${obj.covariantVectors.vectors.length}`);
        const firstTime = obj.covariantVectors.times[0];
        const lastTime = obj.covariantVectors.times[obj.covariantVectors.times.length - 1];
        if (Number.isFinite(firstTime) && Number.isFinite(lastTime)) {
            console.log(`  Time span: ${firstTime.toFixed(3)} → ${lastTime.toFixed(3)}`);
        }
        const preview = obj.covariantVectors.vectors[0];
        if (preview) {
            console.log(chalk.cyan('  First set:'));
            preview.forEach((vec, idx) => {
                console.log(`    v${idx + 1}: [${vec.map(v => v.toFixed(4)).join(', ')}]`);
            });
        }
    } else {
        console.log(chalk.gray('Covariant Lyapunov vectors not computed yet. Use the Oseledets Solver to compute them.'));
    }

    await inquirer.prompt({ type: 'input', name: 'cont', message: 'Press enter to continue...' });
}

function kaplanYorkeDimension(exponents: number[]): number | null {
    if (!exponents.length) {
        return null;
    }
    const sorted = [...exponents].sort((a, b) => b - a);
    let partial = 0;
    for (let i = 0; i < sorted.length; i++) {
        const lambda = sorted[i];
        const newSum = partial + lambda;
        if (newSum >= 0) {
            partial = newSum;
            if (i === sorted.length - 1) {
                return sorted.length;
            }
            continue;
        }

        if (Math.abs(lambda) < Number.EPSILON) {
            return i;
        }
        return i + partial / Math.abs(lambda);
    }
    return sorted.length;
}

function reshapeCovariantVectors(payload: CovariantLyapunovResponse): CovariantLyapunovData {
    const { dimension, checkpoints, vectors, times } = payload;
    if (dimension <= 0) {
        throw new Error("Invalid dimension for covariant Lyapunov vectors.");
    }
    if (checkpoints <= 0) {
        throw new Error("No checkpoints returned for covariant Lyapunov vectors.");
    }
    const expected = dimension * dimension * checkpoints;
    if (vectors.length < expected) {
        throw new Error("Covariant Lyapunov payload is incomplete.");
    }

    const shaped: number[][][] = [];
    for (let step = 0; step < checkpoints; step++) {
        const base = step * dimension * dimension;
        const stepVectors: number[][] = [];
        for (let vecIdx = 0; vecIdx < dimension; vecIdx++) {
            const vec: number[] = [];
            for (let component = 0; component < dimension; component++) {
                const index = base + component * dimension + vecIdx;
                vec.push(vectors[index]);
            }
            stepVectors.push(vec);
        }
        shaped.push(stepVectors);
    }

    return {
        dim: dimension,
        times: times.slice(0, checkpoints),
        vectors: shaped
    };
}

async function manageEquilibrium(sysName: string, obj: EquilibriumObject) {
    while (true) {
        printHeader(obj.name, 'equilibrium');
        printField('System', obj.systemName);
        if (obj.parameters) {
            printArray('Parameters', obj.parameters);
        }
        const solutionStatus = obj.solution ? chalk.green('✓ solved') : chalk.yellow('○ not computed');
        printField('Solution', solutionStatus);
        printBlank();

        const { action } = await inquirer.prompt([{
            type: 'rawlist',
            name: 'action',
            message: 'Object Actions',
            choices: [
                { name: 'Inspect Data', value: 'Inspect Data' },
                { name: 'Equilibrium Solver', value: 'Equilibrium Solver' },
                new inquirer.Separator(),
                { name: 'Rename Object', value: 'Rename Object' },
                { name: 'Delete Object', value: 'Delete Object' },
                new inquirer.Separator(),
                { name: 'Back', value: 'Back' }
            ],
            pageSize: MENU_PAGE_SIZE
        }]);

        if (action === 'Back') {
            return;
        }

        if (action === 'Rename Object') {
            const { newName } = await inquirer.prompt({
                name: 'newName',
                message: 'New Object Name:',
                default: obj.name,
                validate: isValidName
            });

            if (newName !== obj.name && objectExists(sysName, newName)) {
                console.error(chalk.red(`Object "${newName}" already exists.`));
                continue;
            }

            if (newName !== obj.name) {
                Storage.deleteObject(sysName, obj.name);
                obj.name = newName;
                Storage.saveObject(sysName, obj);
                console.log(chalk.green(`Object renamed to ${newName}.`));
            }
            continue;
        }

        if (action === 'Delete Object') {
            const targetName = obj.name;
            const { confirm } = await inquirer.prompt({
                type: 'confirm',
                name: 'confirm',
                message: `Are you sure you want to delete ${targetName}?`,
                default: false
            });

            if (confirm) {
                Storage.deleteObject(sysName, targetName);
                console.log(chalk.green(`Object ${targetName} deleted.`));
                return;
            }
            continue;
        }

        if (action === 'Inspect Data') {
            const sysConfig = Storage.loadSystem(sysName);
            updateEquilibriumMetadata(sysName, obj, sysConfig);
            await inspectEquilibriumData(sysName, obj, sysConfig);
            continue;
        }

        if (action === 'Equilibrium Solver') {
            const sysConfig = Storage.loadSystem(sysName);
            updateEquilibriumMetadata(sysName, obj, sysConfig);
            const converged = await executeEquilibriumSolver(sysName, obj, sysConfig);
            if (converged) {
                await inspectEquilibriumData(sysName, obj, sysConfig);
            }
            continue;
        }
    }
}

async function executeEquilibriumSolver(
    sysName: string,
    obj: EquilibriumObject,
    sysConfig: SystemConfig
): Promise<boolean> {
    const defaultGuessSource =
        obj.lastSolverParams?.initialGuess ??
        obj.solution?.state ??
        sysConfig.varNames.map(() => 0);
    const baseGuess =
        defaultGuessSource.length === sysConfig.varNames.length
            ? defaultGuessSource
            : sysConfig.varNames.map((_, idx) => defaultGuessSource[idx] ?? 0);

    const initialGuessInputs = sysConfig.varNames.map((_, idx) =>
        baseGuess[idx]?.toString() ?? '0'
    );

    const defaultMaxSteps = obj.lastSolverParams?.maxSteps ?? 25;
    const defaultDamping = obj.lastSolverParams?.dampingFactor ?? 1;
    let maxStepsInput = defaultMaxSteps.toString();
    let dampingInput = defaultDamping.toString();

    const solverEntries: ConfigEntry[] = [
        ...sysConfig.varNames.map((varName, idx) => ({
            id: `var_${idx}`,
            label: `Initial ${varName}`,
            getDisplay: () => formatUnset(initialGuessInputs[idx]),
            edit: async () => {
                const { value } = await inquirer.prompt({
                    name: 'value',
                    message: `Initial ${varName}:`,
                    default: initialGuessInputs[idx],
                    validate: (input: string) => {
                        if (input.trim().length === 0) {
                            return true;
                        }
                        return Number.isFinite(parseFloat(input)) ? true : 'Please enter a number.';
                    }
                });
                initialGuessInputs[idx] = value;
            }
        })),
        {
            id: 'maxSteps',
            label: 'Maximum Newton steps',
            getDisplay: () => formatUnset(maxStepsInput),
            edit: async () => {
                const { value } = await inquirer.prompt({
                    name: 'value',
                    message: 'Maximum Newton steps:',
                    default: maxStepsInput,
                    validate: (input: string) => {
                        const parsed = parseInt(input, 10);
                        if (!Number.isFinite(parsed) || parsed <= 0) {
                            return 'Enter a positive integer.';
                        }
                        return true;
                    }
                });
                maxStepsInput = value;
            }
        },
        {
            id: 'damping',
            label: 'Damping factor',
            getDisplay: () => formatUnset(dampingInput),
            edit: async () => {
                const { value } = await inquirer.prompt({
                    name: 'value',
                    message: 'Damping factor:',
                    default: dampingInput,
                    validate: (input: string) => {
                        if (input.trim().length === 0) {
                            return true;
                        }
                        return Number.isFinite(parseFloat(input)) && parseFloat(input) > 0
                            ? true
                            : 'Enter a positive number.';
                    }
                });
                dampingInput = value;
            }
        }
    ];

    const solverMenuResult = await runConfigMenu('Equilibrium Solver Parameters', solverEntries);
    if (solverMenuResult === 'back') {
        return false;
    }

    const initialGuess = sysConfig.varNames.map((_, idx) => {
        return parseFloatOrDefault(
            initialGuessInputs[idx],
            baseGuess[idx] ?? 0
        );
    });

    const maxSteps = Math.max(parseIntOrDefault(maxStepsInput, defaultMaxSteps), 1);
    const damping = parseFloatOrDefault(dampingInput, defaultDamping);

    const solverParams: EquilibriumSolverParams = {
        initialGuess: [...initialGuess],
        maxSteps,
        dampingFactor: damping > 0 ? damping : defaultDamping
    };

    obj.lastSolverParams = {
        initialGuess: [...solverParams.initialGuess],
        maxSteps: solverParams.maxSteps,
        dampingFactor: solverParams.dampingFactor
    };

    const runRecord: EquilibriumRunSummary = {
        timestamp: new Date().toISOString(),
        success: false
    };

    try {
        console.log(chalk.cyan("Running equilibrium solver..."));
        const bridge = new WasmBridge(sysConfig);
        const result = bridge.solve_equilibrium(
            solverParams.initialGuess,
            solverParams.maxSteps,
            solverParams.dampingFactor
        );

        obj.solution = result;
        runRecord.success = true;
        runRecord.residual_norm = result.residual_norm;
        runRecord.iterations = result.iterations;
        console.log(chalk.green("Equilibrium found and saved."));
    } catch (err) {
        const message = err instanceof Error ? err.message : `${err}`;
        console.error(chalk.red("Equilibrium solve failed:"), message);
    } finally {
        obj.lastRun = runRecord;
        Storage.saveObject(sysName, obj);
    }

    return runRecord.success;
}

async function inspectEquilibriumData(
    sysName: string,
    obj: EquilibriumObject,
    sysConfig?: SystemConfig
) {
    const config = sysConfig ?? Storage.loadSystem(sysName);
    renderEquilibriumData(obj, config);
    await inquirer.prompt({ type: 'input', name: 'cont', message: 'Press enter to continue...' });
}

function renderEquilibriumData(obj: EquilibriumObject, sysConfig: SystemConfig) {
    console.log('');
    console.log(chalk.yellow('Equilibrium Summary'));

    if (!obj.solution) {
        console.log('  No stored equilibrium solution yet.');
    } else {
        console.log(chalk.cyan('  Coordinates:'));
        sysConfig.varNames.forEach((name, idx) => {
            const value = obj.solution!.state[idx];
            const display = value !== undefined ? value.toPrecision(6) : 'n/a';
            console.log(`    ${name}: ${display}`);
        });

        console.log(chalk.cyan('  Residual & Iterations:'));
        console.log(`    Residual: ${obj.solution.residual_norm.toExponential(6)}`);
        console.log(`    Iterations: ${obj.solution.iterations}`);

        if (obj.solution.eigenpairs.length > 0) {
            console.log(chalk.cyan('  Eigenpairs:'));
            obj.solution.eigenpairs.forEach((pair, idx) => {
                console.log(`    λ${idx + 1}: ${formatComplexValue(pair.value)}`);
                pair.vector.forEach((entry, vIdx) => {
                    const label = sysConfig.varNames[vIdx] || `v${idx + 1}_${vIdx + 1}`;
                    console.log(`      ${label}: ${formatComplexValue(entry)}`);
                });
            });
        }
    }

    console.log('');
    console.log(chalk.yellow('Last Solver Attempt'));
    if (!obj.lastRun) {
        console.log('  Solver has not been run yet.');
    } else {
        console.log(`  Timestamp : ${obj.lastRun.timestamp}`);
        console.log(`  Result    : ${obj.lastRun.success ? 'Success' : 'Failed'}`);
        if (obj.lastRun.residual_norm !== undefined) {
            console.log(`  Residual  : ${obj.lastRun.residual_norm.toExponential(6)}`);
        }
        if (obj.lastRun.iterations !== undefined) {
            console.log(`  Iterations: ${obj.lastRun.iterations}`);
        }
    }

    if (obj.lastSolverParams) {
        console.log('');
        console.log(chalk.yellow('Cached Solver Parameters'));
        console.log(`  Steps   : ${obj.lastSolverParams.maxSteps}`);
        console.log(`  Damping : ${obj.lastSolverParams.dampingFactor}`);
        const guessPreview = obj.lastSolverParams.initialGuess
            .map((val, idx) => `${sysConfig.varNames[idx] || `x${idx + 1}`}:${val.toPrecision(4)}`)
            .join(', ');
        console.log(`  Initial : ${guessPreview || 'n/a'}`);
    }

    console.log('');
}

function formatComplexValue(value: ComplexValue): string {
    const re = value.re.toFixed(4);
    const imAbs = Math.abs(value.im).toFixed(4);
    const sign = value.im >= 0 ? '+' : '-';
    return `${re} ${sign} ${imAbs}i`;
}

function updateEquilibriumMetadata(
    sysName: string,
    obj: EquilibriumObject,
    sysConfig: SystemConfig
) {
    const mutated =
        migrateLegacyEquilibriumData(obj) ||
        harmonizeSolverParams(obj, sysConfig) ||
        removeLegacyNoteField(obj);

    if (mutated) {
        Storage.saveObject(sysName, obj);
    }
}

function migrateLegacyEquilibriumData(obj: EquilibriumObject): boolean {
    type LegacyRun = {
        timestamp?: string;
        parameters?: EquilibriumSolverParams;
        success?: boolean;
        residual_norm?: number;
        iterations?: number;
        message?: string;
    };

    const legacyRuns = (obj as unknown as { solverRuns?: LegacyRun[] }).solverRuns;
    if (Array.isArray(legacyRuns) && legacyRuns.length > 0) {
        const last = legacyRuns[legacyRuns.length - 1];
        if (last?.parameters) {
            obj.lastSolverParams = {
                initialGuess: [...(last.parameters.initialGuess ?? [])],
                maxSteps: last.parameters.maxSteps ?? 25,
                dampingFactor: last.parameters.dampingFactor ?? 1
            };
        }
        obj.lastRun = {
            timestamp: last.timestamp ?? new Date().toISOString(),
            success: !!last.success,
            residual_norm: last.residual_norm,
            iterations: last.iterations
        };

        delete (obj as unknown as { solverRuns?: LegacyRun[] }).solverRuns;
        return true;
    }

    if ((obj as unknown as { solverRuns?: LegacyRun[] }).solverRuns) {
        delete (obj as unknown as { solverRuns?: LegacyRun[] }).solverRuns;
        return true;
    }

    return false;
}

function harmonizeSolverParams(
    obj: EquilibriumObject,
    sysConfig: SystemConfig
): boolean {
    const desiredLength = sysConfig.varNames.length;
    let mutated = false;

    if (!obj.lastSolverParams) {
        obj.lastSolverParams = {
            initialGuess:
                obj.solution?.state?.length === desiredLength
                    ? [...obj.solution.state]
                    : sysConfig.varNames.map(() => 0),
            maxSteps: 25,
            dampingFactor: 1
        };
        return true;
    }

    if (obj.lastSolverParams.initialGuess.length !== desiredLength) {
        const source =
            obj.solution?.state?.length === desiredLength
                ? obj.solution.state
                : obj.lastSolverParams.initialGuess;
        obj.lastSolverParams.initialGuess = sysConfig.varNames.map(
            (_, idx) => source[idx] ?? 0
        );
        mutated = true;
    }

    return mutated;
}

function removeLegacyNoteField(obj: EquilibriumObject): boolean {
    const run = obj.lastRun as (EquilibriumRunSummary & { message?: string }) | undefined;
    if (run && Object.prototype.hasOwnProperty.call(run, 'message')) {
        delete (run as { message?: string }).message;
        return true;
    }
    return false;
}

mainMenu().catch(console.error);
