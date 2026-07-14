export type HomoclinicDiscretization = 'collocation' | 'shooting';

export const DEFAULT_HOMOCLINIC_SHOOTING_INTERVALS = 8;
export const DEFAULT_HOMOCLINIC_INTEGRATION_STEPS_PER_SEGMENT = 64;

export function homoclinicExtraSelectionError(
  freeTime: boolean,
  freeEps0: boolean,
  freeEps1: boolean
): string | null {
  const selected = Number(freeTime) + Number(freeEps0) + Number(freeEps1);
  if (selected === 0) {
    return 'At least one of T, eps0, or eps1 must be free.';
  }
  if (selected > 2) {
    return 'At most two of T, eps0, or eps1 may be free.';
  }
  return null;
}

export function homoclinicShootingSettingsError(
  discretization: HomoclinicDiscretization,
  shootingIntervals: number,
  integrationStepsPerSegment: number
): string | null {
  if (discretization !== 'shooting') return null;
  if (!Number.isInteger(shootingIntervals) || shootingIntervals < 1) {
    return 'Shooting intervals must be a positive integer.';
  }
  if (!Number.isInteger(integrationStepsPerSegment) || integrationStepsPerSegment < 1) {
    return 'Integration steps per segment must be a positive integer.';
  }
  return null;
}
