/**
 * Shared utility functions for continuation module.
 */

import { Storage } from '../storage';
import {
  ContinuationObject,
  ContinuationPoint,
  SystemConfig
} from '../types';

import { isValidName as isValidNameShared } from '../naming';

/**
 * Validates a branch or object name.
 * 
 * Names must be alphanumeric with underscores only (no spaces or special characters).
 * 
 * @param name - The name to validate
 * @returns true if valid, or an error message string if invalid
 */
export const isValidName = isValidNameShared;

/**
 * Get the best available parameter values for a branch.
 * If the branch has params stored, use those.
 * Otherwise, try to get from the source equilibrium object.
 * Falls back to sysConfig.params as last resort.
 */
export function getBranchParams(
  sysName: string,
  branch: ContinuationObject,
  sysConfig: SystemConfig
): number[] {
  // If branch has params stored, use those
  if (branch.params && branch.params.length === sysConfig.params.length) {
    return [...branch.params];
  }

  // Try to get params from the parent object.
  try {
    const obj = Storage.loadObject(sysName, branch.parentObject) as any;
    const customParams = obj?.customParameters as number[] | undefined;
    if (Array.isArray(customParams) && customParams.length === sysConfig.params.length) {
      return [...customParams];
    }
    const params = obj?.parameters as number[] | undefined;
    if (Array.isArray(params) && params.length === sysConfig.params.length) {
      return [...params];
    }
  } catch {
    // Fall through to default.
  }

  // Last resort: use current system config
  return [...sysConfig.params];
}

/**
 * Ensures branch has valid indices array, creating if necessary.
 * 
 * The indices array maps array positions to logical indices, which may differ
 * when points are prepended during backward extension.
 * 
 * @param branch - The continuation branch (mutated if indices are missing)
 * @returns The indices array (may be newly created)
 */
export function ensureBranchIndices(branch: ContinuationObject): number[] {
  const pts = branch.data.points;
  if (!branch.data.indices || branch.data.indices.length !== pts.length) {
    branch.data.indices = pts.map((_, i) => i);
  }
  return branch.data.indices;
}

/**
 * Creates sorted order mapping from logical indices.
 * 
 * Returns array indices sorted by their logical index values,
 * allowing iteration in parameter order rather than storage order.
 * 
 * @param indices - Array of logical indices
 * @returns Array indices sorted by logical order
 */
export function buildSortedArrayOrder(indices: number[]): number[] {
  return indices
    .map((logicalIdx, arrayIdx) => ({ logicalIdx, arrayIdx }))
    .sort((a, b) => a.logicalIdx - b.logicalIdx)
    .map(entry => entry.arrayIdx);
}

/**
 * Formats a number for display with appropriate precision.
 * 
 * Uses exponential notation for very small (< 1e-3) or large (>= 1e4) values,
 * otherwise uses 3 decimal places.
 * 
 * @param value - Number to format
 * @returns Formatted string representation
 */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return value.toString();
  }
  const absVal = Math.abs(value);
  if ((absVal !== 0 && absVal < 1e-3) || absVal >= 1e4) {
    return value.toExponential(4);
  }
  return value.toFixed(3);
}

/**
 * Formats a number with full precision for detailed displays.
 * 
 * Uses more significant figures than formatNumber for when precision matters.
 * 
 * @param value - Number to format
 * @returns Formatted string representation with high precision
 */
export function formatNumberFullPrecision(value: number): string {
  if (!Number.isFinite(value)) {
    return value.toString();
  }
  const absVal = Math.abs(value);
  if ((absVal !== 0 && absVal < 1e-6) || absVal >= 1e6) {
    return value.toExponential(10);
  }
  // Use toPrecision for consistent significant figures
  return value.toPrecision(12).replace(/\.?0+$/, '');
}

/**
 * Formats a number safely, handling undefined/NaN values.
 * 
 * Returns 'NaN' for non-finite or undefined inputs.
 * 
 * @param value - Number to format (may be undefined)
 * @returns Formatted string or 'NaN'
 */
export function formatNumberSafe(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'NaN';
  }
  return formatNumber(value);
}

/**
 * Formats an array of numbers for display.
 * 
 * Wraps values in brackets with comma separation.
 * 
 * @param values - Array of numbers to format
 * @returns Formatted string like "[1.234, 5.678]"
 */
export function formatArray(values: number[]): string {
  if (!values || values.length === 0) {
    return '[]';
  }
  return `[${values.map(formatNumber).join(', ')}]`;
}

/**
 * Summarizes eigenvalues/multipliers for display in a point row.
 * 
 * Shows first 3 values in re+im format with ellipsis for additional values.
 * Uses "Multipliers" for limit cycle branches, "Eigenvalues" for equilibrium.
 * 
 * @param point - Continuation point containing eigenvalues
 * @param branchType - Type of branch ('equilibrium' or 'limit_cycle')
 * @returns Summary string like "Eigenvalues: 0.123+0.456i, ..." or "Multipliers: ..."
 */
export function summarizeEigenvalues(point: ContinuationPoint, branchType?: string): string {
  const eigenvalues = point.eigenvalues || [];
  const label = (
    branchType === 'limit_cycle' ||
    branchType === 'isochrone_curve' ||
    branchType === 'lpc_curve' ||
    branchType === 'pd_curve' ||
    branchType === 'ns_curve'
  )
    ? 'Multipliers'
    : 'Eigenvalues';
  if (eigenvalues.length === 0) {
    return `${label}: []`;
  }
  const formatted = eigenvalues
    .slice(0, 3)
    .map(ev => `${formatNumberSafe(ev.re)}+${formatNumberSafe(ev.im)}i`);
  const suffix = eigenvalues.length > 3 ? ' …' : '';
  return `${label}: ${formatted.join(', ')}${suffix}`;
}
