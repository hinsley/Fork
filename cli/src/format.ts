import chalk from 'chalk';

/**
 * Terminal output formatting utilities for consistent, readable CLI output.
 */

// Box drawing characters for headers
const BOX = {
  topLeft: '╭',
  topRight: '╮',
  bottomLeft: '╰',
  bottomRight: '╯',
  horizontal: '─',
  vertical: '│'
};

/**
 * Print a section header with a box border
 */
export function printHeader(title: string, subtitle?: string): void {
  const width = Math.max(title.length, subtitle?.length || 0) + 4;
  const line = BOX.horizontal.repeat(width);

  console.log('');
  console.log(chalk.cyan(`${BOX.topLeft}${line}${BOX.topRight}`));
  console.log(chalk.cyan(`${BOX.vertical}  ${chalk.bold(title)}${' '.repeat(width - title.length - 2)}${BOX.vertical}`));
  if (subtitle) {
    console.log(chalk.cyan(`${BOX.vertical}  ${chalk.dim(subtitle)}${' '.repeat(width - subtitle.length - 2)}${BOX.vertical}`));
  }
  console.log(chalk.cyan(`${BOX.bottomLeft}${line}${BOX.bottomRight}`));
}

/**
 * Print a simple section divider
 */
export function printDivider(): void {
  console.log(chalk.dim('─'.repeat(40)));
}

/**
 * Print a labeled value with consistent formatting
 */
export function printField(label: string, value: string | number, options?: { color?: 'green' | 'yellow' | 'cyan' | 'dim' }): void {
  const coloredValue = options?.color
    ? chalk[options.color](value)
    : value;
  console.log(`  ${chalk.dim(label + ':')} ${coloredValue}`);
}

/**
 * Print a list of labeled values in a compact format
 */
export function printFieldRow(items: Array<{ label: string; value: string | number }>): void {
  const formatted = items.map(item => `${chalk.dim(item.label + ':')} ${item.value}`);
  console.log(`  ${formatted.join('  │  ')}`);
}

/**
 * Print an array of values with a label
 */
export function printArray(label: string, values: number[], precision: number = 4): void {
  const formatted = values.map(v => v.toPrecision(precision)).join(', ');
  console.log(`  ${chalk.dim(label + ':')} [${formatted}]`);
}

/**
 * Print a success message
 */
export function printSuccess(message: string): void {
  console.log(chalk.green(`✓ ${message}`));
}

/**
 * Print an error message
 */
export function printError(message: string): void {
  console.error(chalk.red(`✗ ${message}`));
}

/**
 * Print a warning message
 */
export function printWarning(message: string): void {
  console.log(chalk.yellow(`⚠ ${message}`));
}

/**
 * Print an info message
 */
export function printInfo(message: string): void {
  console.log(chalk.cyan(`ℹ ${message}`));
}

/**
 * Print a progress indicator (for simulations, etc.)
 */
export function printProgress(current: number, total: number, label?: string): void {
  const percent = Math.round((current / total) * 100);
  const barWidth = 20;
  const filled = Math.round((current / total) * barWidth);
  const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);
  const labelText = label ? `${label} ` : '';
  process.stdout.write(`\r${labelText}[${bar}] ${percent}%`);
}

/**
 * Complete a progress indicator
 */
export function printProgressComplete(label?: string): void {
  const labelText = label ? `${label} ` : '';
  console.log(`\r${labelText}[${chalk.green('█'.repeat(20))}] ${chalk.green('Done!')}`);
}

/**
 * Print a blank line for spacing
 */
export function printBlank(): void {
  console.log('');
}

/**
 * Format a number for display (handles scientific notation for very large/small values)
 */
export function formatNum(value: number, precision: number = 4): string {
  if (!Number.isFinite(value)) return value.toString();
  const absVal = Math.abs(value);
  if ((absVal !== 0 && absVal < 1e-3) || absVal >= 1e4) {
    return value.toExponential(precision);
  }
  return value.toPrecision(precision);
}
