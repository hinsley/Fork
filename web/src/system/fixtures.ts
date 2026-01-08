import { addBranch, addObject, createSystem } from './model'
import { nowIso } from '../utils/determinism'
import type { ContinuationObject, OrbitObject, System } from './types'

export function createDemoSystem(): {
  system: System
  objectNodeId: string
  branchNodeId: string
} {
  let system = createSystem({ name: 'Demo System' })

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
    settings: {},
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
