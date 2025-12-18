import inquirer from 'inquirer';
import { Storage } from './storage';
import { ContinuationObject } from './types';
import { MENU_PAGE_SIZE } from './menu';
import { printHeader, printField } from './format';

// Import functions from continuation submodules
import { createBranch } from './continuation/create';
import { extendBranch } from './continuation/extend';
import { inspectBranch } from './continuation/inspect';

/**
 * Main entry point for continuation analysis.
 * 
 * Displays a menu of existing branches and allows users to:
 * - Create new equilibrium continuation branches
 * - Select and manage existing branches
 * 
 * @param sysName - Name of the dynamical system
 */
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

/**
 * Manages an individual continuation branch.
 * 
 * Displays branch summary (parameter, points, bifurcations) and provides actions:
 * - Inspect: browse points, view details, initiate new branches
 * - Extend: add points in forward or backward direction
 * - Delete: remove the branch from storage
 * 
 * @param sysName - Name of the dynamical system  
 * @param branch - The continuation branch to manage
 */
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
