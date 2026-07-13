import type { ComputedNormalForm, NormalFormComplex } from '../../../../compute/normalFormTypes'

export type NormalFormSummaryRow = {
  label: string
  value: string
}

function number(value: number): string {
  if (!Number.isFinite(value)) return String(value)
  if (value === 0) return '0'
  const magnitude = Math.abs(value)
  return magnitude >= 1e4 || magnitude < 1e-4
    ? value.toExponential(4)
    : value.toPrecision(6)
}

function complex(value: NormalFormComplex): string {
  const sign = value.im < 0 ? '-' : '+'
  return `${number(value.re)} ${sign} ${number(Math.abs(value.im))}i`
}

function diagnosticsRows(values: Record<string, number>): NormalFormSummaryRow[] {
  return Object.entries(values).map(([name, value]) => ({
    label: name.replaceAll('_', ' '),
    value: number(value),
  }))
}

export function normalFormSummaryRows(
  normalForm: ComputedNormalForm
): NormalFormSummaryRow[] {
  if (normalForm.type === 'ZeroHopf') {
    return [
      { label: 'Type', value: 'Zero-Hopf' },
      { label: 'Frequency', value: number(normalForm.frequency) },
      { label: 'g200', value: number(normalForm.g200) },
      { label: 'g011', value: number(normalForm.g011) },
      { label: 'g110', value: complex(normalForm.g110) },
      { label: 'g111', value: complex(normalForm.g111) },
      { label: 'g021', value: complex(normalForm.g021) },
      { label: 'Reduced g021', value: complex(normalForm.reduced_g021) },
      { label: 'NS target', value: normalForm.has_neimark_sacker ? 'Available' : 'Unavailable' },
      ...diagnosticsRows(normalForm.diagnostics),
    ]
  }
  if (normalForm.type === 'HopfHopf') {
    return [
      { label: 'Type', value: 'Hopf-Hopf' },
      { label: 'Frequency 1', value: number(normalForm.frequency1) },
      { label: 'Frequency 2', value: number(normalForm.frequency2) },
      { label: 'g2100', value: complex(normalForm.g2100) },
      { label: 'g0021', value: complex(normalForm.g0021) },
      { label: 'g1110', value: complex(normalForm.g1110) },
      { label: 'g1011', value: complex(normalForm.g1011) },
      {
        label: 'NS predictors',
        value: normalForm.neimark_sacker_predictors
          .map((predictor) => `mode ${predictor.periodic_mode}`)
          .join(', ') || 'Unavailable',
      },
      ...diagnosticsRows(normalForm.diagnostics),
    ]
  }
  if (normalForm.type === 'BranchPoint') {
    return [
      {
        label: 'Type',
        value: normalForm.kind === 'Fold'
          ? 'Saddle-node (+1 multiplier)'
          : normalForm.kind === 'LimitPointCycle'
            ? 'Limit point of cycles (+1 multiplier)'
            : 'Generic +1 branch point',
      },
      { label: 'Kind', value: normalForm.kind },
      { label: 'Constant-param coefficient', value: number(normalForm.constant_parameter_coefficient) },
      { label: 'Linear-param coefficient', value: number(normalForm.linear_parameter_coefficient) },
      { label: 'Quadratic coefficient', value: number(normalForm.quadratic_coefficient) },
      { label: 'Cubic coefficient', value: number(normalForm.cubic_coefficient) },
      ...diagnosticsRows(normalForm.conditioning),
    ]
  }
  if (normalForm.type === 'PeriodDoubling') {
    return [
      { label: 'Type', value: 'Period doubling' },
      { label: 'Criticality', value: normalForm.criticality },
      ...('multiplier' in normalForm
        ? [{ label: 'Multiplier', value: number(normalForm.multiplier) }]
        : []),
      { label: 'Parameter coefficient', value: number(normalForm.parameter_coefficient) },
      { label: 'Cubic coefficient', value: number(normalForm.cubic_coefficient) },
      ...diagnosticsRows(normalForm.conditioning),
    ]
  }
  return [
    { label: 'Type', value: 'Neimark-Sacker' },
    { label: 'Criticality', value: normalForm.criticality },
    { label: 'Angle', value: number(normalForm.angle) },
    { label: 'Multiplier', value: complex(normalForm.multiplier) },
    { label: 'Parameter coefficient', value: complex(normalForm.parameter_coefficient) },
    { label: 'Cubic coefficient', value: complex(normalForm.cubic_coefficient) },
    ...diagnosticsRows(normalForm.conditioning),
  ]
}

export function supportsNormalFormWorkflow(
  systemType: 'flow' | 'map',
  branchType: string,
  stability: string,
  codim2Type?: string
): boolean {
  if (codim2Type === 'ZeroHopf' || codim2Type === 'DoubleHopf') return systemType === 'flow'
  if (systemType === 'map' && branchType === 'equilibrium') {
    return stability === 'Fold' || stability === 'BranchPoint' || stability === 'PeriodDoubling' || stability === 'NeimarkSacker'
  }
  if (systemType === 'flow' && branchType === 'limit_cycle') {
    return stability === 'BranchPoint' || stability === 'CycleFold' || stability === 'PeriodDoubling' || stability === 'NeimarkSacker'
  }
  return false
}
