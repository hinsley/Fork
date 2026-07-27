import { EquilibriumObject } from './types';

export const DEFAULT_DEFLATION_EXPONENT = 2;
export const DEFAULT_DEFLATION_SHIFT = 1;

export function equilibriumMapIterations(object: EquilibriumObject): number {
  const value =
    object.lastSolverParams?.mapIterations ??
    object.solution?.cycle_points?.length ??
    1;
  return Number.isFinite(value) ? Math.max(1, Math.trunc(value)) : 1;
}

export function isCompatibleMapCycleTarget(
  object: EquilibriumObject,
  solveIterations: number
): boolean {
  if (!object.solution) return false;
  const targetIterations = equilibriumMapIterations(object);
  return (
    solveIterations > 1 &&
    targetIterations > 1 &&
    solveIterations % targetIterations === 0 &&
    (object.solution.cycle_points?.length ?? 0) > 1
  );
}

export function flattenDeflationRoots(roots: number[][]): number[] {
  return roots.flatMap(root => root);
}
