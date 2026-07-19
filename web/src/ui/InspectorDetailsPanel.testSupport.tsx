import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createDemoSystem, createPeriodDoublingSystem } from '../system/fixtures'
import { InspectorDetailsPanel } from './InspectorDetailsPanel'
import { buildCollocationAdaptivitySettings } from './inspector/collocationAdaptivity'
import { makeSurfaceProfileDefaults, toManifold2DProfile } from './manifoldProfileDrafts'
import { useState } from 'react'
import {
  DEFAULT_SCENE_CAMERA,
  addScene,
  addBranch,
  addObject,
  createSystem,
  renameNode,
  toggleNodeVisibility,
  updateBranch,
  updateLimitCycleRenderTarget,
  updateNodeRender,
  updateObject,
} from '../system/model'
import { buildSubsystemSnapshot } from '../system/subsystemGateway'
import { renderPlot } from '../viewports/plotly/plotlyAdapter'
import type {
  Codim2PointData,
  ContinuationObject,
  EquilibriumObject,
  ForcedPeriodicResponseObject,
  IsoclineObject,
  LimitCycleObject,
  OrbitObject,
  System,
  SystemConfig,
} from '../system/types'

export const continuationSettings = {
  step_size: 0.01,
  min_step_size: 1e-6,
  max_step_size: 0.1,
  max_steps: 50,
  corrector_steps: 4,
  corrector_tolerance: 1e-6,
  step_tolerance: 1e-6,
}

export const stateSpaceStrideCycleLikeBranchTypes = [
  'homoclinic_curve',
  'heteroclinic_curve',
  'homotopy_saddle_curve',
  'pd_curve',
  'lpc_curve',
  'ns_curve',
] as const

export type StateSpaceStrideCycleLikeBranchType = (typeof stateSpaceStrideCycleLikeBranchTypes)[number]

export function makeStateSpaceStrideBranchTypeData(
  branchType: StateSpaceStrideCycleLikeBranchType
): ContinuationObject['data']['branch_type'] {
  switch (branchType) {
    case 'homoclinic_curve':
      return {
        type: 'HomoclinicCurve',
        ntst: 4,
        ncol: 2,
        param1_name: 'mu',
        param2_name: 'nu',
        free_time: true,
        free_eps0: true,
        free_eps1: true,
      }
    case 'heteroclinic_curve':
      return {
        type: 'HeteroclinicCurve',
        schema: {
          schema_version: 1,
          base_params: [0.2, 0.1],
          param1_index: 0,
          param2_index: 1,
          source_basis: {
            stable_q: [1, 0, 0, 1],
            unstable_q: [1, 0, 0, 1],
            dim: 2,
            nneg: 1,
            npos: 1,
          },
          target_basis: {
            stable_q: [1, 0, 0, 1],
            unstable_q: [1, 0, 0, 1],
            dim: 2,
            nneg: 1,
            npos: 1,
          },
          fixed_time: 5,
          fixed_eps0: 0.01,
          fixed_eps1: 0.01,
          projector_refresh_interval: 5,
        },
        ntst: 4,
        ncol: 2,
        param1_name: 'mu',
        param2_name: 'nu',
        free_time: true,
        free_eps0: false,
        free_eps1: false,
      }
    case 'homotopy_saddle_curve':
      return {
        type: 'HomotopySaddleCurve',
        ntst: 4,
        ncol: 2,
        param1_name: 'mu',
        param2_name: 'nu',
        stage: 'StageD',
      }
    case 'pd_curve':
      return { type: 'PDCurve', param1_name: 'mu', param2_name: 'nu', ntst: 4, ncol: 2 }
    case 'lpc_curve':
      return { type: 'LPCCurve', param1_name: 'mu', param2_name: 'nu', ntst: 4, ncol: 2 }
    case 'ns_curve':
      return { type: 'NSCurve', param1_name: 'mu', param2_name: 'nu', ntst: 4, ncol: 2 }
  }
}

export function createStateSpaceStrideBranchFixture(branchType: StateSpaceStrideCycleLikeBranchType) {
  const config: SystemConfig = {
    name: `Stride_Flow_${branchType}`,
    equations: ['y', '-x'],
    params: [0.2, 0.1],
    paramNames: ['mu', 'nu'],
    varNames: ['x', 'y'],
    solver: 'rk4',
    type: 'flow',
  }
  const baseSystem = createSystem({ name: config.name, config })
  const equilibrium: EquilibriumObject = {
    type: 'equilibrium',
    name: 'Eq_Stride',
    systemName: config.name,
  }
  const withEquilibrium = addObject(baseSystem, equilibrium)
  const branch: ContinuationObject = {
    type: 'continuation',
    name: `${branchType}_mu_nu`,
    systemName: config.name,
    parameterName: 'mu, nu',
    parentObject: equilibrium.name,
    startObject: equilibrium.name,
    branchType,
    data: {
      points: [
        {
          state: new Array(24).fill(0),
          param_value: 0.2,
          param2_value: 0.1,
          stability: 'None',
          eigenvalues: [],
        },
      ],
      bifurcations: [0],
      indices: [0],
      branch_type: makeStateSpaceStrideBranchTypeData(branchType),
    },
    settings: continuationSettings,
    timestamp: new Date().toISOString(),
    params: [...config.params],
  }
  return addBranch(withEquilibrium.system, branch, withEquilibrium.nodeId)
}

export function renderInspectorForStateSpaceStride(
  system: System,
  selectedNodeId: string,
  onUpdateRender: ReturnType<typeof vi.fn>,
  onExtendEquilibriumManifold1D: ReturnType<typeof vi.fn> = vi.fn(),
  onExtendManifold2D: ReturnType<typeof vi.fn> = vi.fn(),
  onCreateLimitCycleCodim1CurveFromPoint: ReturnType<typeof vi.fn> = vi.fn(),
  onCreateCodim2BranchFromPoint: ReturnType<typeof vi.fn> = vi.fn()
) {
  render(
    <InspectorDetailsPanel
      system={system}
      selectedNodeId={selectedNodeId}
      view="selection"
      theme="light"
      onRename={vi.fn()}
      onToggleVisibility={vi.fn()}
      onUpdateRender={onUpdateRender}
      onUpdateScene={vi.fn()}
      onUpdateBifurcationDiagram={vi.fn()}
      onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
      onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
      onRunOrbit={vi.fn().mockResolvedValue(undefined)}
      onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
      onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
      onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
      onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
      onExtendEquilibriumManifold1D={onExtendEquilibriumManifold1D}
      onExtendManifold2D={onExtendManifold2D}
      onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
      onExtendBranch={vi.fn().mockResolvedValue(undefined)}
      onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
      onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
      onCreateLimitCycleCodim1CurveFromPoint={onCreateLimitCycleCodim1CurveFromPoint}
      onCreateCodim2BranchFromPoint={onCreateCodim2BranchFromPoint}
      onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
      onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
      onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
      onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
      onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
    />
  )
}


export {
  fireEvent, render, screen, waitFor, within, userEvent, describe, expect, it, vi,
  createDemoSystem, createPeriodDoublingSystem, InspectorDetailsPanel,
  buildCollocationAdaptivitySettings, makeSurfaceProfileDefaults, toManifold2DProfile, useState,
  DEFAULT_SCENE_CAMERA, addScene, addBranch, addObject, createSystem, renameNode,
  toggleNodeVisibility, updateBranch, updateLimitCycleRenderTarget, updateNodeRender, updateObject,
  buildSubsystemSnapshot, renderPlot,
}
export type {
  Codim2PointData, ContinuationObject, EquilibriumObject, ForcedPeriodicResponseObject,
  IsoclineObject, LimitCycleObject, OrbitObject, System, SystemConfig,
}
