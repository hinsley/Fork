import { addBranch, addObject, addScene, createSystem } from './model'
import { nowIso } from '../utils/determinism'
import type {
  ContinuationObject,
  ContinuationSettings,
  LimitCycleObject,
  OrbitObject,
  System,
} from './types'

export function createDemoSystem(): {
  system: System
  objectNodeId: string
  branchNodeId: string
} {
  let system = createSystem({ name: 'Demo_System' })
  const defaultSettings: ContinuationSettings = {
    step_size: 0.01,
    min_step_size: 1e-5,
    max_step_size: 0.1,
    max_steps: 100,
    corrector_steps: 4,
    corrector_tolerance: 1e-6,
    step_tolerance: 1e-6,
  }

  const orbit: OrbitObject = {
    type: 'orbit',
    name: 'Orbit A',
    systemName: system.config.name,
    data: [
      [0, 0, 1],
      [0.1, 0.1, 0.99],
      [0.2, 0.2, 0.96],
    ],
    t_start: 0,
    t_end: 0.2,
    dt: 0.1,
    parameters: [],
  }

  const result = addObject(system, orbit)
  system = result.system

  const branch: ContinuationObject = {
    type: 'continuation',
    name: 'eq_branch',
    systemName: system.config.name,
    parameterName: 'p1',
    parentObject: orbit.name,
    startObject: orbit.name,
    branchType: 'equilibrium',
    data: {
      points: [
        {
          state: [0, 0],
          param_value: 0,
          stability: 'None',
          eigenvalues: [],
        },
      ],
      bifurcations: [],
      indices: [0],
    },
    settings: defaultSettings,
    timestamp: nowIso(),
    params: [],
  }

  const branchResult = addBranch(system, branch, result.nodeId)
  system = branchResult.system

  return {
    system,
    objectNodeId: result.nodeId,
    branchNodeId: branchResult.nodeId,
  }
}

export function createPeriodDoublingSystem(): { system: System } {
  let system = createSystem({
    name: 'Period_Doubling_Fixture',
    config: {
      name: 'Period_Doubling_Fixture',
      equations: ['y', '-x'],
      params: [0.2],
      paramNames: ['mu'],
      varNames: ['x', 'y'],
      solver: 'rk4',
      type: 'flow',
    },
  })

  const ntst = 4
  const ncol = 2
  const period = 6
  const profilePointCount = ntst * ncol + 1
  const buildLimitCycleState = (radius: number) => {
    const profile: number[] = []
    for (let i = 0; i < profilePointCount; i += 1) {
      const theta = (i / (profilePointCount - 1)) * Math.PI * 2
      profile.push(radius * Math.cos(theta), radius * Math.sin(theta))
    }
    profile.push(period)
    return profile
  }
  const baseState = buildLimitCycleState(1)
  const pdState = buildLimitCycleState(1.25)

  const limitCycle: LimitCycleObject = {
    type: 'limit_cycle',
    name: 'LC_PD',
    systemName: system.config.name,
    origin: { type: 'orbit', orbitName: 'Orbit PD' },
    ntst,
    ncol,
    period,
    state: baseState,
    parameters: [...system.config.params],
    parameterName: 'mu',
    paramValue: 0.2,
    createdAt: nowIso(),
  }

  const added = addObject(system, limitCycle)
  system = added.system

  const branch: ContinuationObject = {
    type: 'continuation',
    name: 'lc_pd_mu',
    systemName: system.config.name,
    parameterName: 'mu',
    parentObject: limitCycle.name,
    startObject: limitCycle.name,
    branchType: 'limit_cycle',
    data: {
      points: [
        {
          state: baseState,
          param_value: 0.2,
          stability: 'None',
          eigenvalues: [],
        },
        {
          state: pdState,
          param_value: 0.25,
          stability: 'PeriodDoubling',
          eigenvalues: [{ re: -1, im: 0 }],
        },
      ],
      bifurcations: [1],
      indices: [0, 1],
      branch_type: { type: 'LimitCycle', ntst, ncol },
    },
    settings: {
      step_size: 0.01,
      min_step_size: 1e-5,
      max_step_size: 0.1,
      max_steps: 50,
      corrector_steps: 4,
      corrector_tolerance: 1e-6,
      step_tolerance: 1e-6,
    },
    timestamp: nowIso(),
    params: [...system.config.params],
  }

  const branchResult = addBranch(system, branch, added.nodeId)
  system = branchResult.system

  return { system }
}

export function createAxisPickerSystem(): { system: System } {
  let system = createSystem({
    name: 'Axis_Picker_Fixture',
    config: {
      name: 'Axis_Picker_Fixture',
      equations: ['y', '-x', 'w', 'x - z'],
      params: [],
      paramNames: [],
      varNames: ['x', 'y', 'z', 'w'],
      solver: 'rk4',
      type: 'flow',
    },
  })

  const orbit: OrbitObject = {
    type: 'orbit',
    name: 'Orbit Axes',
    systemName: system.config.name,
    data: [
      [0, 0, 1, 2, 3],
      [0.1, 0.2, 1.1, 2.1, 3.1],
      [0.2, 0.4, 1.2, 2.2, 3.2],
    ],
    t_start: 0,
    t_end: 0.2,
    dt: 0.1,
  }

  const added = addObject(system, orbit)
  system = added.system
  system = addScene(system, 'Scene A').system
  system = addScene(system, 'Scene B').system
  return { system }
}
