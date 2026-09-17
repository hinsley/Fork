import chalk from 'chalk';
import type { CalculationDiagnostic } from './types';

export function calculationDiagnostic(error: unknown): CalculationDiagnostic | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const candidate = 'diagnostic' in error ? error.diagnostic : error;
  if (!candidate || typeof candidate !== 'object' ||
    !('kind' in candidate) || typeof candidate.kind !== 'string' ||
    !('message' in candidate) || typeof candidate.message !== 'string') return undefined;
  const diagnostic: CalculationDiagnostic = { kind: candidate.kind, message: candidate.message };
  if ('suggestion' in candidate && typeof candidate.suggestion === 'string') diagnostic.suggestion = candidate.suggestion;
  const numericKeys = ['iterations', 'max_iterations', 'residual_norm', 'tolerance', 'step_size', 'min_step_size'] as const;
  for (const key of numericKeys) {
    const value: unknown = Object.getOwnPropertyDescriptor(candidate, key)?.value;
    if (typeof value === 'number' && Number.isFinite(value)) diagnostic[key] = value;
  }
  return diagnostic;
}

export function formatError(error: unknown): string {
  const diagnostic = calculationDiagnostic(error);
  if (diagnostic) {
    const metrics: string[] = [];
    if (diagnostic.iterations !== undefined) metrics.push(`iterations ${diagnostic.iterations}${diagnostic.max_iterations !== undefined ? `/${diagnostic.max_iterations}` : ''}`);
    if (diagnostic.residual_norm !== undefined) metrics.push(`residual ${formatNum(diagnostic.residual_norm)}`);
    if (diagnostic.tolerance !== undefined) metrics.push(`tolerance ${formatNum(diagnostic.tolerance)}`);
    if (diagnostic.step_size !== undefined) metrics.push(`step ${formatNum(diagnostic.step_size)}`);
    if (diagnostic.min_step_size !== undefined) metrics.push(`minimum ${formatNum(diagnostic.min_step_size)}`);
    return [diagnostic.message, metrics.length ? `  ${metrics.join(' · ')}` : '', diagnostic.suggestion ? `  Try: ${diagnostic.suggestion}` : ''].filter(Boolean).join('\n');
  }
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return 'Calculation failed without further details.';
}

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
