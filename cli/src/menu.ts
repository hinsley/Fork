import inquirer from 'inquirer';

export const MENU_PAGE_SIZE = 32;

export type ConfigMenuResult = 'continue' | 'back';

export type ConfigEntry = {
    id: string;
    label: string;
    getDisplay: () => string;
    edit: () => Promise<void>;
    section?: string;
};

const CONFIG_CONTINUE_VALUE = '__CONFIG_CONTINUE__';
const CONFIG_BACK_VALUE = '__CONFIG_BACK__';

export async function runConfigMenu(
    title: string,
    entries: ConfigEntry[]
): Promise<ConfigMenuResult> {
    while (true) {
        const choices: Array<{ name: string; value: string } | inquirer.Separator> = [];

        if (entries.length > 0) {
            let lastSection: string | null = null;
            for (const entry of entries) {
                const section = entry.section ?? '';
                if (section !== lastSection) {
                    const label = section.length > 0 ? `== ${section} ==` : '== Settings ==';
                    choices.push(new inquirer.Separator(label));
                    lastSection = section;
                }
                choices.push({
                    name: `${entry.label}: ${entry.getDisplay()}`,
                    value: entry.id
                });
            }
        } else {
            choices.push(new inquirer.Separator('== Settings =='));
        }

        choices.push(new inquirer.Separator());
        choices.push({ name: 'Continue', value: CONFIG_CONTINUE_VALUE });
        choices.push({ name: 'Back', value: CONFIG_BACK_VALUE });

        const { selection } = await inquirer.prompt({
            type: 'rawlist',
            name: 'selection',
            message: title,
            choices,
            pageSize: MENU_PAGE_SIZE
        });

        if (selection === CONFIG_CONTINUE_VALUE) {
            return 'continue';
        }
        if (selection === CONFIG_BACK_VALUE) {
            return 'back';
        }

        const entry = entries.find(e => e.id === selection);
        if (entry) {
            await entry.edit();
        }
    }
}

export function parseListInput(input: string): string[] {
    return input
        .split(',')
        .map(item => item.trim())
        .filter(item => item.length > 0);
}

export function formatUnset(value: string): string {
    return value.trim().length > 0 ? value : '(unset)';
}

export function parseFloatOrDefault(value: string, fallback: number): number {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

export function parseIntOrDefault(value: string, fallback: number): number {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

