import inquirer from 'inquirer';
import { ConfigEntry, formatUnset } from '../menu';

export interface CollocationAdaptivityInputs {
  enabled: boolean;
  redistributionEnabled: boolean;
  defectTolerance: string;
  maxRefinements: string;
  maxMeshPoints: string;
}

export function defaultCollocationAdaptivityInputs(): CollocationAdaptivityInputs {
  return {
    enabled: true,
    redistributionEnabled: true,
    defectTolerance: '0.025',
    maxRefinements: '3',
    maxMeshPoints: '512',
  };
}

export function isUniformNormalizedCollocationMesh(mesh: number[]): boolean {
  const intervals = mesh.length - 1;
  if (intervals < 1) return false;
  return mesh.every(
    (coordinate, index) => Math.abs(coordinate - index / intervals) <= 1e-12
  );
}

export function collocationAdaptivityEntries(
  inputs: CollocationAdaptivityInputs
): ConfigEntry[] {
  return [
    {
      id: 'adaptiveCollocationEnabled',
      label: 'Adaptive collocation mesh',
      section: 'Collocation Adaptivity',
      getDisplay: () => (inputs.enabled ? 'Enabled' : 'Disabled'),
      edit: async () => {
        const { value } = await inquirer.prompt({
          type: 'confirm',
          name: 'value',
          message: 'Adapt the collocation mesh after rejected corrections?',
          default: inputs.enabled,
        });
        inputs.enabled = value;
      },
    },
    {
      id: 'adaptiveRedistributionEnabled',
      label: 'Redistribute before refinement',
      section: 'Collocation Adaptivity',
      getDisplay: () => (inputs.redistributionEnabled ? 'Enabled' : 'Disabled'),
      edit: async () => {
        const { value } = await inquirer.prompt({
          type: 'confirm',
          name: 'value',
          message: 'Redistribute the existing mesh before adding intervals?',
          default: inputs.redistributionEnabled,
        });
        inputs.redistributionEnabled = value;
      },
    },
    {
      id: 'adaptiveDefectTolerance',
      label: 'Defect tolerance',
      section: 'Collocation Adaptivity',
      getDisplay: () => formatUnset(inputs.defectTolerance),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Scaled collocation-defect tolerance:',
          default: inputs.defectTolerance,
          validate: (candidate: string) => {
            const parsed = Number(candidate.trim());
            return candidate.trim().length > 0 && Number.isFinite(parsed) && parsed > 0
              ? true
              : 'Enter a positive finite number.';
          },
        });
        inputs.defectTolerance = value;
      },
    },
    {
      id: 'adaptiveMaxRefinements',
      label: 'Max mesh adaptations',
      section: 'Collocation Adaptivity',
      getDisplay: () => formatUnset(inputs.maxRefinements),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Maximum mesh adaptations:',
          default: inputs.maxRefinements,
          validate: (candidate: string) => {
            const parsed = Number(candidate.trim());
            return candidate.trim().length > 0 && Number.isInteger(parsed) && parsed >= 0
              ? true
              : 'Enter a nonnegative integer.';
          },
        });
        inputs.maxRefinements = value;
      },
    },
    {
      id: 'adaptiveMaxMeshPoints',
      label: 'Max mesh intervals',
      section: 'Collocation Adaptivity',
      getDisplay: () => formatUnset(inputs.maxMeshPoints),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Maximum mesh intervals:',
          default: inputs.maxMeshPoints,
          validate: (candidate: string) => {
            const parsed = Number(candidate.trim());
            return candidate.trim().length > 0 && Number.isInteger(parsed) && parsed >= 2
              ? true
              : 'Enter an integer of at least 2.';
          },
        });
        inputs.maxMeshPoints = value;
      },
    },
  ];
}

export function conditionalCollocationAdaptivityEntries(
  inputs: CollocationAdaptivityInputs,
  isActive: () => boolean
): ConfigEntry[] {
  return collocationAdaptivityEntries(inputs).map((entry) => {
    const getDisplay = entry.getDisplay;
    const edit = entry.edit;
    return {
      ...entry,
      getDisplay: () =>
        isActive() ? getDisplay() : `${getDisplay()} (inactive for standard shooting)`,
      edit: async () => {
        if (!isActive()) return;
        await edit();
      },
    };
  });
}

export function buildCollocationAdaptivitySettings(inputs: CollocationAdaptivityInputs) {
  if (!inputs.enabled) {
    return {
      enabled: false,
      redistribution_enabled: inputs.redistributionEnabled,
      defect_tolerance: 0.025,
      max_refinements: 3,
      max_mesh_points: 512,
    };
  }
  const defectToleranceText = inputs.defectTolerance.trim();
  const maxRefinementsText = inputs.maxRefinements.trim();
  const maxMeshPointsText = inputs.maxMeshPoints.trim();
  const defectTolerance = defectToleranceText ? Number(defectToleranceText) : Number.NaN;
  const maxRefinements = maxRefinementsText ? Number(maxRefinementsText) : Number.NaN;
  const maxMeshPoints = maxMeshPointsText ? Number(maxMeshPointsText) : Number.NaN;
  if (!Number.isFinite(defectTolerance) || defectTolerance <= 0) {
    throw new Error('Collocation defect tolerance must be a positive finite number.');
  }
  if (!Number.isInteger(maxRefinements) || maxRefinements < 0) {
    throw new Error('Maximum mesh adaptations must be a nonnegative integer.');
  }
  if (!Number.isInteger(maxMeshPoints) || maxMeshPoints < 2) {
    throw new Error('Maximum mesh intervals must be an integer of at least 2.');
  }
  return {
    enabled: true,
    redistribution_enabled: inputs.redistributionEnabled,
    defect_tolerance: defectTolerance,
    max_refinements: maxRefinements,
    max_mesh_points: maxMeshPoints,
  };
}
