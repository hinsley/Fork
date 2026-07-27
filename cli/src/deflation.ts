import {
  EquilibriumDeflationConfig,
  EquilibriumDeflationTargetConfig,
  EquilibriumObject
} from './types';

export const DEFAULT_DEFLATION_EXPONENT = 2;
export const DEFAULT_DEFLATION_SHIFT = 1;

export function equilibriumDeflationTargets(
  config: EquilibriumDeflationConfig | undefined
): EquilibriumDeflationTargetConfig[] {
  if (!config) return [];
  if (Array.isArray(config.targets)) {
    return config.targets.map(target => ({ ...target }));
  }
  return (config.targetObjectNames ?? []).map(targetObjectName => ({
    targetObjectName,
    exponent: config.exponent ?? DEFAULT_DEFLATION_EXPONENT,
    shift: config.shift ?? DEFAULT_DEFLATION_SHIFT
  }));
}

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
