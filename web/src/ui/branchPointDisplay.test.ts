import { describe, expect, it } from 'vitest'
import type { ContinuationObject, ContinuationPoint } from '../system/types'
import {
  resolveBranchPointParams,
  resolveContinuationParameterReadout,
  summarizeContinuationPointEigenvalues,
} from './branchPointDisplay'

function makeTwoParameterBranch(): ContinuationObject {
  return {
    type: 'continuation',
    name: 'homoc_mu_nu',
    systemName: 'DisplayTest',
    parameterName: 'mu, nu',
    parentObject: 'EQ',
    startObject: 'EQ',
    branchType: 'homoclinic_curve',
    data: {
      points: [],
      bifurcations: [],
      indices: [],
      branch_type: {
        type: 'HomoclinicCurve',
        ntst: 4,
        ncol: 2,
        param1_name: 'mu',
        param2_name: 'nu',
        free_time: true,
        free_eps0: true,
        free_eps1: true,
      },
    },
    settings: {
      step_size: 0.01,
      min_step_size: 1e-6,
      max_step_size: 0.1,
      max_steps: 50,
      corrector_steps: 4,
      corrector_tolerance: 1e-6,
      step_tolerance: 1e-6,
    },
    timestamp: '2026-04-27T00:00:00.000Z',
    params: [0.2, 0.1],
  }
}

describe('branch point display helpers', () => {
  it('formats one/two-parameter continuation readouts from branch metadata', () => {
    const branch = makeTwoParameterBranch()
    const point: ContinuationPoint = {
      state: new Array(24).fill(0),
      param_value: 0.2,
      param2_value: 0.1,
      stability: 'None',
      eigenvalues: [],
    }

    expect(
      resolveContinuationParameterReadout(
        { paramNames: ['mu', 'nu'] },
        [0.2, 0.1],
        branch,
        point,
        2
      )
    ).toEqual({
      label: 'Continuation parameters',
      value: 'mu=0.200000, nu=0.100000',
    })
    expect(resolveBranchPointParams(['mu', 'nu'], [0, 0], branch, point, 2)).toEqual([
      0.2,
      0.1,
    ])
  })

  it('keeps multiplier labeling for cycle-like continuation points', () => {
    const point: ContinuationPoint = {
      state: [],
      param_value: 1,
      stability: 'None',
      eigenvalues: [{ re: 0.5, im: -0.25 }],
    }

    expect(summarizeContinuationPointEigenvalues(point, 'pd_curve')).toBe(
      'Multipliers: 0.500000+-0.250000i'
    )
  })
})
