import inquirer from 'inquirer';
import chalk from 'chalk';
import { Storage } from './storage';
import {
    AnalysisObject,
    ComplexValue,
    EquilibriumObject,
    EquilibriumRunSummary,
    EquilibriumSolverParams,
    SystemConfig,
    OrbitObject
} from './types';
import { WasmBridge } from './wasm';
import { continuationMenu } from './continuation';

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
      type: 'list',
      name: 'systemSelection',
      message: 'Select a system',
      choices: choices,
      pageSize: 10
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
        const typeLabel = sys.type ? `(${sys.type})` : '(unknown)';
        console.log(chalk.magenta(`\nActive System: ${sysName} ${typeLabel}`));

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
            type: 'list',
            name: 'action',
            message: 'System Menu',
            choices: choices
        }]);

        if (action === 'Back') return;

        if (action === 'Edit System') {
            await editSystem(sys);
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

    const meta = await inquirer.prompt([
      { 
        name: 'typeChoice', 
        type: 'list', 
        choices: ['Flow', 'Map'], 
        message: 'System Type (Flow = ODE, Map = Iterated Function):' 
      },
      { name: 'vars', message: 'Variables (comma separated, e.g. x,y,z):' },
      { name: 'params', message: 'Parameters (comma separated, e.g. r,s,b):' }
    ]);

    const type = meta.typeChoice.toLowerCase();

    let defaultSolver = 'rk4';
    if (type === 'map') {
        defaultSolver = 'discrete';
    } else {
        const { solver } = await inquirer.prompt({
            name: 'solver',
            type: 'list',
            choices: ['rk4', 'tsit5'],
            message: 'Default Solver:'
        });
        defaultSolver = solver;
    }

    const varNames = meta.vars.split(',').map((s: string) => s.trim()).filter((s: string) => s.length > 0);
    const paramNames = meta.params.split(',').map((s: string) => s.trim()).filter((s: string) => s.length > 0);
    
    const equations = [];
    for (const v of varNames) {
      const promptMsg = type === 'flow' ? `d${v}/dt = ` : `${v}_{n+1} = `;
      const { eq } = await inquirer.prompt({ name: 'eq', message: promptMsg });
      equations.push(eq);
    }

    const paramValues = [];
    for (const p of paramNames) {
        const { val } = await inquirer.prompt({ name: 'val', message: `Default value for ${p}:` });
        paramValues.push(parseFloat(val));
    }

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

async function editSystem(sys: SystemConfig) {
    const originalName = sys.name;
    
    while (true) {
        console.log(chalk.cyan(`Editing System: ${sys.name} (${sys.type || 'flow'})`));
        console.log(`Solver: ${sys.solver}`);
        console.log(`Variables: ${sys.varNames.join(', ')}`);
        console.log(`Equations:`);
        sys.varNames.forEach((v, i) => {
            const prefix = sys.type === 'map' ? `${v}_{n+1}` : `d${v}/dt`;
            console.log(`  ${prefix} = ${sys.equations[i]}`);
        });
        console.log(`Parameters:`);
        sys.paramNames.forEach((p, i) => console.log(`  ${p} = ${sys.params[i]}`));

        const choices = ['Edit Name', 'Edit Equations', 'Edit Parameters', 'Save & Back', 'Cancel'];
        if (!sys.type || sys.type === 'flow') {
            choices.splice(3, 0, 'Change Solver');
        }

        const { action } = await inquirer.prompt([{
            type: 'list',
            name: 'action',
            message: 'Edit Options',
            choices
        }]);

        if (action === 'Cancel') return;
        if (action === 'Save & Back') {
            if (sys.name !== originalName) {
                Storage.deleteSystem(originalName);
            }
            Storage.saveSystem(sys);
            console.log(chalk.green("System saved."));
            if (sys.name !== originalName) {
                 console.log(chalk.yellow("System name changed. Returning to main menu."));
                 process.exit(0); 
            }
            return;
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
                const choices = sys.varNames.map((v, i) => {
                    const prefix = sys.type === 'map' ? `${v}_{n+1}` : `d${v}/dt`;
                    return { name: `${prefix} = ${sys.equations[i]}`, value: i };
                });
                choices.push({ name: 'Back', value: -1 });

                const { eqIdx } = await inquirer.prompt({
                    type: 'list',
                    name: 'eqIdx',
                    message: 'Select Equation to Edit:',
                    choices
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
                const choices = sys.paramNames.map((p, i) => {
                    return { name: `${p} = ${sys.params[i]}`, value: i };
                });
                choices.push({ name: 'Back', value: -1 });

                const { paramIdx } = await inquirer.prompt({
                    type: 'list',
                    name: 'paramIdx',
                    message: 'Select Parameter to Edit:',
                    choices
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
                type: 'list',
                name: 'solver', 
                message: 'Select Solver:', 
                choices: ['rk4', 'tsit5'],
                default: sys.solver
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
            type: 'list',
            name: 'objName',
            message: 'Select Object to Manage',
            choices: choices,
            pageSize: 10
        });

        if (objName === 'BACK') return;
        
        if (objName === 'CREATE') {
            const { objType } = await inquirer.prompt({
                type: 'list',
                name: 'objType',
                message: 'Select Object Type to Create:',
                choices: ['Orbit', 'Equilibrium', 'Back']
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
    
    const ic = [];
    for (const v of sysConfig.varNames) {
        const { val } = await inquirer.prompt({ name: 'val', message: `Initial ${v}:`, default: '0' });
        ic.push(parseFloat(val));
    }

    const isMap = sysConfig.type === 'map';
    const durationLabel = isMap ? 'Iterations (n):' : 'Duration (t):';
    const defaultDuration = isMap ? '1000' : '100';

    const simPrompts: any[] = [
        { name: 't_end', message: durationLabel, default: defaultDuration }
    ];
    
    if (!isMap) {
        simPrompts.splice(1, 0, { name: 'dt', message: 'Step size (dt):', default: '0.01' });
    }

    const sim = await inquirer.prompt(simPrompts);

    const t_end = parseFloat(sim.t_end);
    const dt = isMap ? 1 : parseFloat(sim.dt);

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
                process.stdout.write(`\rSimulating... ${spinner[(i / updateInterval) % 4]} ${(i/steps*100).toFixed(0)}%`);
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
        console.log(chalk.blue(`Loaded Object: ${obj.name} (${obj.type})`));
        console.log(`System: ${obj.systemName}`);
        if (obj.parameters) {
             console.log(`Parameters: [${obj.parameters.map(p => p.toPrecision(4)).join(', ')}]`);
        }
        console.log(`Points: ${obj.data.length}`);

        const { action } = await inquirer.prompt([{
            type: 'list',
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
            ]
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

                const durationLabel = isMap ? 'Extend by how many iterations?' : 'Extend by how much time?';
                const defaultDuration = isMap ? '1000' : '50';

                const prompts: any[] = [
                    { name: 'duration', message: durationLabel, default: defaultDuration }
                ];

                if (!isMap) {
                    prompts.push({
                        name: 'dt',
                        message: 'Step size (dt):',
                        default: obj.dt ? obj.dt.toString() : '0.01'
                    });
                }

                const ans = await inquirer.prompt(prompts);
                const t_add = parseFloat(ans.duration);
                const dt = isMap ? 1 : (parseFloat(ans.dt) || obj.dt || 0.01);
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
            type: 'list',
            name: 'task',
            message: 'Oseledets Solver',
            choices: [
                { name: 'Lyapunov Exponents', value: 'Lyapunov Exponents' },
                {
                    name: 'Covariant Lyapunov Exponents',
                    value: 'Covariant Lyapunov Exponents',
                    disabled: 'Coming soon'
                },
                new inquirer.Separator(),
                { name: 'Back', value: 'Back' }
            ]
        }]);

        if (task === 'Back') {
            return;
        }

        if (task === 'Lyapunov Exponents') {
            await runLyapunovExponents(sysName, obj);
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

    const { transientInput } = await inquirer.prompt([{
        name: 'transientInput',
        message: 'Transient time to discard:',
        default: '0',
        validate: (value: string) => {
            const val = parseFloat(value);
            if (Number.isNaN(val)) return "Please enter a number.";
            if (val < 0 || val > duration) {
                return `Value must be between 0 and ${duration.toFixed(6)}.`;
            }
            return true;
        }
    }]);

    const transient = Math.min(
        Math.max(parseFloat(transientInput) || 0, 0),
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

    const { qrInput } = await inquirer.prompt([{
        name: 'qrInput',
        message: 'Steps between QR decompositions:',
        default: '1',
        validate: (value: string) => {
            const n = parseInt(value, 10);
            if (!Number.isFinite(n) || n <= 0) {
                return "Enter a positive integer.";
            }
            return true;
        }
    }]);
    const qrStride = Math.max(parseInt(qrInput, 10) || 1, 1);

    const startState = obj.data[startIndex].slice(1);
    const startTime = obj.data[startIndex][0];
    const dt = obj.dt || (sysConfig.type === 'map' ? 1 : 0.01);

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

async function manageEquilibrium(sysName: string, obj: EquilibriumObject) {
    while (true) {
        console.log(chalk.blue(`Loaded Object: ${obj.name} (${obj.type})`));
        console.log(`System: ${obj.systemName}`);
        if (obj.parameters) {
             console.log(`Parameters: [${obj.parameters.map(p => p.toPrecision(4)).join(', ')}]`);
        }
        console.log(`Solution: ${obj.solution ? 'available' : 'not yet computed'}`);

        const { action } = await inquirer.prompt([{
            type: 'list',
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
            ]
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

    const prompts: any[] = sysConfig.varNames.map((v, idx) => ({
        name: `var_${idx}`,
        message: `Initial ${v}:`,
        default: baseGuess[idx]?.toString() ?? '0'
    }));

    const defaultMaxSteps = obj.lastSolverParams?.maxSteps ?? 25;
    const defaultDamping = obj.lastSolverParams?.dampingFactor ?? 1;

    prompts.push({
        name: 'maxSteps',
        message: 'Maximum Newton steps:',
        default: defaultMaxSteps.toString()
    });

    prompts.push({
        name: 'damping',
        message: 'Damping factor:',
        default: defaultDamping.toString()
    });

    const answers = await inquirer.prompt(prompts);

    const initialGuess = sysConfig.varNames.map((_, idx) => {
        const value = parseFloat(answers[`var_${idx}`]);
        return Number.isFinite(value) ? value : baseGuess[idx] ?? 0;
    });

    const maxStepsRaw = parseInt(answers.maxSteps, 10);
    const dampingRaw = parseFloat(answers.damping);

    const solverParams: EquilibriumSolverParams = {
        initialGuess: [...initialGuess],
        maxSteps: Number.isFinite(maxStepsRaw) && maxStepsRaw > 0 ? maxStepsRaw : defaultMaxSteps,
        dampingFactor:
            Number.isFinite(dampingRaw) && dampingRaw > 0 ? dampingRaw : defaultDamping
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
