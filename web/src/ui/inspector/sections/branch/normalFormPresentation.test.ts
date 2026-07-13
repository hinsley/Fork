import { describe, expect, it } from 'vitest'
import { normalFormSummaryRows, supportsNormalFormWorkflow } from './normalFormPresentation'

describe('normal-form Inspector presentation', () => {
  it('exposes map, periodic, Zero-Hopf, and Hopf-Hopf sources only at supported points', () => {
    expect(supportsNormalFormWorkflow('map', 'equilibrium', 'PeriodDoubling')).toBe(true)
    expect(supportsNormalFormWorkflow('map', 'equilibrium', 'Fold')).toBe(true)
    expect(supportsNormalFormWorkflow('flow', 'limit_cycle', 'NeimarkSacker')).toBe(true)
    expect(supportsNormalFormWorkflow('flow', 'hopf_curve', 'None', 'ZeroHopf')).toBe(true)
    expect(supportsNormalFormWorkflow('flow', 'fold_curve', 'None', 'DoubleHopf')).toBe(true)
    expect(supportsNormalFormWorkflow('flow', 'equilibrium', 'Hopf')).toBe(false)
  })

  it('shows coefficients, criticality, and conditioning in a map PD readout', () => {
    const rows = normalFormSummaryRows({
      type: 'PeriodDoubling',
      parameter_coefficient: 1.5,
      cubic_coefficient: -0.25,
      criticality: 'Supercritical',
      conditioning: {
        eigenvector_pairing: 0.9,
        right_residual: 1e-10,
        left_residual: 2e-10,
        homological_residual: 3e-9,
      },
    })
    expect(rows).toEqual(expect.arrayContaining([
      { label: 'Criticality', value: 'Supercritical' },
      { label: 'Cubic coefficient', value: '-0.250000' },
      { label: 'homological residual', value: '3.0000e-9' },
    ]))
  })

  it('reports Hopf-Hopf target modes and resonance diagnostics', () => {
    const rows = normalFormSummaryRows({
      type: 'HopfHopf',
      state: [0, 0, 0, 0],
      param1_index: 0,
      param2_index: 1,
      param1_value: 0,
      param2_value: 0,
      frequency1: 1,
      frequency2: 1.7,
      g2100: { re: 1, im: 0 },
      g0021: { re: -1, im: 0 },
      g1110: { re: 0.1, im: 0.2 },
      g1011: { re: 0.2, im: -0.1 },
      gamma: [[{ re: 1, im: 0 }, { re: 0, im: 0 }], [{ re: 0, im: 0 }, { re: 1, im: 0 }]],
      neimark_sacker_predictors: [{
        periodic_mode: 2,
        parameter_quadratic: [1, 2],
        frequency1_quadratic: 0,
        frequency2_quadratic: 0,
      }],
      diagnostics: {
        jacobian_condition_number: 10,
        unfolding_condition_number: 12,
        minimum_eigenvector_pairing: 0.8,
        max_eigen_residual: 1e-9,
        max_homological_residual: 2e-8,
        resonance_distance: 0.03,
      },
    })
    expect(rows).toEqual(expect.arrayContaining([
      { label: 'NS predictors', value: 'mode 2' },
      { label: 'resonance distance', value: '0.0300000' },
    ]))
  })

  it('labels the periodic +1 fold as a limit point of cycles', () => {
    const rows = normalFormSummaryRows({
      type: 'BranchPoint',
      kind: 'LimitPointCycle',
      constant_parameter_coefficient: 1,
      linear_parameter_coefficient: 0,
      quadratic_coefficient: 1,
      cubic_coefficient: 0,
      critical_mode: [1],
      conditioning: {
        eigenvector_pairing: 1,
        right_residual: 0,
        left_residual: 0,
        homological_residual: 0,
        return_map_residual: 0,
        section_residual: 0,
        return_time_correction: 0,
        section_transversality: 1,
      },
    })
    expect(rows).toContainEqual({
      label: 'Type',
      value: 'Limit point of cycles (+1 multiplier)',
    })
  })
})
