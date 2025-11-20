import inquirer from 'inquirer';
import chalk from 'chalk';
import { Storage } from './storage';
import { SystemConfig, OrbitObject } from './types';
import { WasmBridge } from './wasm';

const NAME_REGEX = /^[a-zA-Z0-9_]+$/;

function isValidName(name: string): boolean | string {
    if (!name || name.length === 0) return "Name cannot be empty.";
    if (!NAME_REGEX.test(name)) return "Name must contain only alphanumeric characters and underscores (no spaces).";
    return true;
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
            // Reload system in case name changed (though name change might break flow here, see below)
        } else if (action === 'Duplicate System') {
            const { newName } = await inquirer.prompt({
                name: 'newName',
                message: 'New System Name:',
                default: `${sys.name}_copy`,
                validate: isValidName
            });
            
            const newSys: SystemConfig = { ...sys, name: newName };
            Storage.saveSystem(newSys);
            console.log(chalk.green(`System duplicated as ${newName}`));
            sysName = newName; // Switch context to duplicated system
            console.log(chalk.cyan(`Switching to duplicated system: ${sysName}`));
            continue; // Restart loop with new system context
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
                return; // Exit context since system is gone
            }
        } else if (action === 'Objects') {
            await objectsListMenu(sysName);
        }
    }
}

async function createSystem() {
    const meta = await inquirer.prompt([
      { name: 'name', message: 'System Name:', validate: isValidName },
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
        name: meta.name,
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
        // Only allow changing solver if it's a flow
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
            // If name changed, delete old file (note: this is trickier with folder structure now)
            if (sys.name !== originalName) {
                Storage.deleteSystem(originalName);
            }
            Storage.saveSystem(sys);
            console.log(chalk.green("System saved."));
            // If name changed, we should probably exit to main menu to avoid confusion or update sysName in parent
            if (sys.name !== originalName) {
                 console.log(chalk.yellow("System name changed. Returning to main menu."));
                 process.exit(0); // Brute force reset for now, or we can throw an exception to catch in main loop
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
        
        // "Create New Object" option first
        choices.push({ name: 'Create New Object', value: 'CREATE' });

        if (objects.length > 0) {
             choices.push(new inquirer.Separator());
             objects.forEach(name => {
                 const obj = Storage.loadObject(sysName, name);
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
                choices: ['Orbit', 'Back']
            });

            if (objType === 'Back') continue;

            if (objType === 'Orbit') {
                await createOrbit(sysName);
            }
        } else {
             const obj = Storage.loadObject(sysName, objName);
             await manageObject(sysName, obj);
        }
    }
}

async function createOrbit(sysName: string) {
    const sysConfig = Storage.loadSystem(sysName);
    
    // Prompt ICs
    const ic = [];
    for (const v of sysConfig.varNames) {
        const { val } = await inquirer.prompt({ name: 'val', message: `Initial ${v}:`, default: '0' });
        ic.push(parseFloat(val));
    }

    const isMap = sysConfig.type === 'map';
    const durationLabel = isMap ? 'Iterations (n):' : 'Duration (t):';
    const defaultDuration = isMap ? '1000' : '100';

    const simPrompts: any[] = [
        { name: 't_end', message: durationLabel, default: defaultDuration },
        { name: 'name', message: 'Name for this Orbit Object:', validate: isValidName }
    ];
    
    // Only prompt for dt if it's NOT a map
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
        
        // Save initial state
        let current_t = 0;
        data.push([current_t, ...ic]);

        const spinner = ['|', '/', '-', '\\'];
        process.stdout.write("Simulating... ");

        const updateInterval = isMap ? 10000 : 1000; // Maps are faster, update less often

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
            name: sim.name,
            systemName: sysConfig.name,
            data,
            t_start: 0,
            t_end: current_t,
            dt
        };

        Storage.saveObject(sysName, orbit);
        console.log(chalk.green(`Orbit ${orbit.name} saved with ${data.length} points.`));

        // Navigate to object management menu
        await manageObject(sysName, orbit);
    } catch (e) {
        console.error(chalk.red("Simulation Failed:"), e);
    }
}

async function manageObject(sysName: string, obj: any) { // Typed as any for now to support merging OrbitObject with others later
    const originalName = obj.name;

    console.log(chalk.blue(`Loaded Object: ${obj.name} (${obj.type})`));
    console.log(`System: ${obj.systemName}`);
    console.log(`Points: ${obj.data.length}`);

    const { action } = await inquirer.prompt([{
        type: 'list',
        name: 'action',
        message: 'Object Actions',
        choices: [
            { name: 'Inspect Data', value: 'Inspect Data' },
            { name: 'Extend Orbit', value: 'Extend Orbit' },
            new inquirer.Separator(),
            { name: 'Rename Object', value: 'Rename Object' },
            { name: 'Delete Object', value: 'Delete Object' },
            new inquirer.Separator(),
            { name: 'Back', value: 'Back' }
        ]
    }]);

    if (action === 'Back') return;

    if (action === 'Rename Object') {
        const { newName } = await inquirer.prompt({ 
            name: 'newName', 
            message: 'New Object Name:', 
            default: obj.name,
            validate: isValidName
        });
        
        if (newName !== originalName) {
            Storage.deleteObject(sysName, originalName);
            obj.name = newName;
            Storage.saveObject(sysName, obj);
            console.log(chalk.green(`Object renamed to ${newName}`));
        }
        await manageObject(sysName, obj);
    }

    if (action === 'Delete Object') {
         const { confirm } = await inquirer.prompt({
            type: 'confirm',
            name: 'confirm',
            message: `Are you sure you want to delete ${originalName}?`,
            default: false
        });

        if (confirm) {
            Storage.deleteObject(sysName, originalName);
            console.log(chalk.green(`Object ${originalName} deleted.`));
            return; // Return to previous menu
        }
         await manageObject(sysName, obj);
    }

    if (action === 'Inspect Data') {
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
        
        await inquirer.prompt({ type: 'input', name: 'cont', message: 'Press enter to continue...' });
        await manageObject(sysName, obj); // Recursively call to keep menu open
    }

    if (action === 'Extend Orbit') {
        // To extend, we need to load the system and hydrate the WASM from the last point.
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

            // Allow changing dt for flows during extension
            if (!isMap) {
                prompts.push({ 
                    name: 'dt', 
                    message: 'Step size (dt):', 
                    default: obj.dt ? obj.dt.toString() : '0.01' 
                });
            }

            const ans = await inquirer.prompt(prompts);
            const t_add = parseFloat(ans.duration);
            
            // If map, dt is 1. If flow, use new dt or fallback to old one.
            const dt = isMap ? 1 : (parseFloat(ans.dt) || obj.dt || 0.01);
            
            // Update object dt if it changed (this technically changes the "resolution" of the tail)
            // We don't necessarily need to overwrite obj.dt unless we want to persist it as the new default.
            // Let's persist it so future extensions use this new rate.
            obj.dt = dt;

            const steps = Math.ceil(t_add / dt);

            process.stdout.write("Extending... ");
            const updateInterval = isMap ? 10000 : 1000;

            for (let i = 0; i < steps; i++) {
                bridge.step(dt);
                const t = bridge.get_t();
                obj.data.push([t, ...bridge.get_state()]);
                
                if (i % updateInterval === 0) {
                     process.stdout.write(`\rExtending... ${(i/steps*100).toFixed(0)}%`);
                }
            }
            console.log("Done!");
            
            obj.t_end = bridge.get_t();
            Storage.saveObject(sysName, obj);
            console.log(chalk.green("Orbit extended and saved."));

        } catch (e) {
            console.error(chalk.red("Extension Failed:"), e);
        }
        await manageObject(sysName, obj); // Recursively call to keep menu open
    }
}

mainMenu().catch(console.error);
