import { EquilibriumObject } from './types';

export const DEFAULT_DEFLATION_EXPONENT = 2;
export const DEFAULT_DEFLATION_SHIFT = 1;

export function mapCycleDeflationStates(object: EquilibriumObject): number[][] {
  if (!object.solution) return [];
  const cyclePoints = object.solution.cycle_points;
  return cyclePoints && cyclePoints.length > 0
    ? cyclePoints
    : [object.solution.state];
}

export function flattenDeflationRoots(roots: number[][]): number[] {
  return roots.flatMap(root => root);
}
