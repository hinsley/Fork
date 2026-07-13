import type { AppActions } from '../../state/appState'
import type {
  BranchPointSelection,
  LimitCyclePointSelection,
  OrbitPointSelection,
} from '../branchPointSelection'

export type InspectorActions = Pick<
  AppActions,
  | 'renameNode'
  | 'toggleVisibility'
  | 'updateRender'
  | 'updateObjectParams'
  | 'updateObjectFrozenVariables'
  | 'updateIsoclineObject'
  | 'computeIsocline'
  | 'updateScene'
  | 'updateAnalysisViewport'
  | 'validateAnalysisExpression'
  | 'updateBifurcationDiagram'
  | 'setLimitCycleRenderTarget'
  | 'updateSystem'
  | 'validateSystem'
  | 'runOrbit'
  | 'computeLyapunovExponents'
  | 'computeCovariantLyapunovVectors'
  | 'solveEquilibrium'
  | 'createEquilibriumBranch'
  | 'createEquilibriumManifold1D'
  | 'extendEquilibriumManifold1D'
  | 'extendManifold2D'
  | 'createEquilibriumManifold2D'
  | 'createBranchFromPoint'
  | 'extendBranch'
  | 'createFoldCurveFromPoint'
  | 'createHopfCurveFromPoint'
  | 'computeNormalFormAtPoint'
  | 'createCodim2BranchFromPoint'
  | 'createPeriodicBranchFromPoint'
  | 'createIsoperiodicCurveFromPoint'
  | 'createLimitCycleCodim1CurveFromPoint'
  | 'createNSCurveFromPoint'
  | 'createLimitCycleFromHopf'
  | 'createLimitCycleFromOrbit'
  | 'createLimitCycleManifold2D'
  | 'computeLimitCycleFloquetModes'
  | 'createCycleFromPD'
  | 'createLimitCycleFromPD'
  | 'createHomoclinicFromLargeCycle'
  | 'createHomoclinicFromHomoclinic'
  | 'createHomotopySaddleFromEquilibrium'
  | 'createHomoclinicFromHomotopySaddle'
>

export type SystemEditorActions = Pick<AppActions, 'updateSystem' | 'validateSystem'>

export type InspectorPointSelections = {
  branch: {
    value?: BranchPointSelection
    onSelect?: (selection: BranchPointSelection) => void
  }
  orbit: {
    value?: OrbitPointSelection
    onSelect?: (selection: OrbitPointSelection) => void
  }
  limitCycle: {
    value?: LimitCyclePointSelection
    onSelect?: (selection: LimitCyclePointSelection) => void
  }
}
