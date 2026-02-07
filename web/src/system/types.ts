export interface SystemConfig {
  name: string
  equations: string[]
  params: number[]
  paramNames: string[]
  varNames: string[]
  solver: string
  type: 'flow' | 'map'
}

export interface OrbitObject {
  type: 'orbit'
  name: string
  systemName: string
  data: number[][]
  t_start: number
  t_end: number
  dt: number
  lyapunovExponents?: number[]
  covariantVectors?: CovariantLyapunovData
  parameters?: number[]
  customParameters?: number[]
}

export interface ComplexValue {
  re: number
  im: number
}

export interface EquilibriumEigenPair {
  value: ComplexValue
  vector: ComplexValue[]
}

export interface EquilibriumSolution {
  state: number[]
  residual_norm: number
  iterations: number
  jacobian: number[]
  eigenpairs: EquilibriumEigenPair[]
  cycle_points?: number[][]
}

export interface EquilibriumSolverParams {
  initialGuess: number[]
  maxSteps: number
  dampingFactor: number
  mapIterations?: number
}

export interface EquilibriumRunSummary {
  timestamp: string
  success: boolean
  residual_norm?: number
  iterations?: number
}

export interface EquilibriumObject {
  type: 'equilibrium'
  name: string
  systemName: string
  solution?: EquilibriumSolution
  lastSolverParams?: EquilibriumSolverParams
  lastRun?: EquilibriumRunSummary
  parameters?: number[]
  customParameters?: number[]
}

export interface ContinuationEigenvalue {
  re: number
  im: number
}

export interface ContinuationSettings {
  step_size: number
  min_step_size: number
  max_step_size: number
  max_steps: number
  corrector_steps: number
  corrector_tolerance: number
  step_tolerance: number
}

export interface ContinuationPoint {
  state: number[]
  param_value: number
  param2_value?: number
  stability:
    | 'None'
    | 'Fold'
    | 'Hopf'
    | 'NeutralSaddle'
    | 'CycleFold'
    | 'PeriodDoubling'
    | 'NeimarkSacker'
    | string
  eigenvalues?: ContinuationEigenvalue[]
  cycle_points?: number[][]
  auxiliary?: number
}

export interface ContinuationEndpointSeed {
  endpoint_index: number
  aug_state: number[]
  tangent: number[]
  step_size: number
}

export interface ContinuationResumeState {
  min_index_seed?: ContinuationEndpointSeed
  max_index_seed?: ContinuationEndpointSeed
}

export type BranchType =
  | { type: 'Equilibrium' }
  | { type: 'LimitCycle'; ntst: number; ncol: number }
  | {
      type: 'HomoclinicCurve'
      ntst: number
      ncol: number
      param1_name: string
      param2_name: string
      free_time: boolean
      free_eps0: boolean
      free_eps1: boolean
    }
  | {
      type: 'HomotopySaddleCurve'
      ntst: number
      ncol: number
      param1_name: string
      param2_name: string
      stage: 'StageA' | 'StageB' | 'StageC' | 'StageD'
    }
  | { type: 'FoldCurve'; param1_name: string; param2_name: string }
  | { type: 'HopfCurve'; param1_name: string; param2_name: string }
  | { type: 'LPCCurve'; param1_name: string; param2_name: string; ntst: number; ncol: number }
  | { type: 'PDCurve'; param1_name: string; param2_name: string; ntst: number; ncol: number }
  | { type: 'NSCurve'; param1_name: string; param2_name: string; ntst: number; ncol: number }

export interface ContinuationBranchData {
  points: ContinuationPoint[]
  bifurcations: number[]
  indices: number[]
  branch_type?: BranchType
  upoldp?: number[][]
  resume_state?: ContinuationResumeState
}

export interface ContinuationObject {
  type: 'continuation'
  name: string
  systemName: string
  parameterName: string
  parentObject: string
  startObject: string
  branchType:
    | 'equilibrium'
    | 'limit_cycle'
    | 'homoclinic_curve'
    | 'homotopy_saddle_curve'
    | 'fold_curve'
    | 'hopf_curve'
    | 'lpc_curve'
    | 'pd_curve'
    | 'ns_curve'
  data: ContinuationBranchData
  settings: ContinuationSettings
  timestamp: string
  params?: number[]
  mapIterations?: number
}

export type LimitCycleOrigin =
  | { type: 'orbit'; orbitName: string }
  | { type: 'hopf'; equilibriumObjectName: string; equilibriumBranchName: string; pointIndex: number }
  | { type: 'pd'; sourceLimitCycleObjectName: string; sourceBranchName: string; pointIndex: number }

export interface LimitCycleObject {
  type: 'limit_cycle'
  name: string
  systemName: string
  origin: LimitCycleOrigin
  ntst: number
  ncol: number
  period: number
  state: number[]
  parameters?: number[]
  customParameters?: number[]
  parameterName?: string
  paramValue?: number
  floquetMultipliers?: ContinuationEigenvalue[]
  createdAt: string
}

export type IsoclineSource =
  | {
      kind: 'custom'
      expression: string
    }
  | {
      kind: 'flow_derivative'
      variableName: string
    }
  | {
      kind: 'map_increment'
      variableName: string
    }

export interface IsoclineAxis {
  variableName: string
  min: number
  max: number
  samples: number
}

export interface IsoclineComputedSnapshot {
  source: IsoclineSource
  expression: string
  level: number
  axes: IsoclineAxis[]
  frozenState: number[]
  parameters: number[]
  computedAt: string
}

export interface IsoclineObject {
  type: 'isocline'
  name: string
  systemName: string
  source: IsoclineSource
  level: number
  axes: IsoclineAxis[]
  frozenState: number[]
  parameters?: number[]
  customParameters?: number[]
  lastComputed?: IsoclineComputedSnapshot
}

export type LimitCycleRenderTarget =
  | { type: 'object' }
  | { type: 'branch'; branchId: string; pointIndex: number }

export type AnalysisObject =
  | OrbitObject
  | EquilibriumObject
  | LimitCycleObject
  | IsoclineObject
  | ContinuationObject

export interface CovariantLyapunovData {
  dim: number
  times: number[]
  vectors: number[][][]
}

export type NodeKind = 'object' | 'branch' | 'scene' | 'diagram' | 'camera'

export interface ClvRenderStyle {
  enabled: boolean
  stride: number
  lengthScale: number
  headScale: number
  thickness: number
  vectorIndices: number[]
  colors: string[]
  colorOverrides?: Record<number, string>
}

export interface EquilibriumEigenvectorRenderStyle {
  enabled: boolean
  vectorIndices: number[]
  colors: string[]
  colorOverrides?: Record<number, string>
  lineLengthScale: number
  lineThickness: number
  discRadiusScale: number
  discThickness: number
}

export type LineStyle = 'solid' | 'dashed' | 'dotted'

export interface RenderStyle {
  color: string
  lineWidth: number
  lineStyle: LineStyle
  pointSize: number
  stateSpaceStride?: number
  clv?: ClvRenderStyle
  equilibriumEigenvectors?: EquilibriumEigenvectorRenderStyle
}

export interface TreeNode {
  id: string
  name: string
  kind: NodeKind
  objectType?: AnalysisObject['type'] | 'branch' | 'scene' | 'bifurcation' | 'camera'
  parentId: string | null
  children: string[]
  visibility: boolean
  expanded: boolean
  render: RenderStyle
}

export type AxisRange = [number, number]

export type AxisRanges = {
  x?: AxisRange | null
  y?: AxisRange | null
  z?: AxisRange | null
}

export type SceneAxisVariables = {
  x: string
  y: string
  z: string
}

export interface Scene {
  id: string
  name: string
  camera: {
    eye: { x: number; y: number; z: number }
    center: { x: number; y: number; z: number }
    up: { x: number; y: number; z: number }
  }
  axisRanges: AxisRanges
  viewRevision: number
  axisVariables?: SceneAxisVariables | null
  selectedNodeIds: string[]
  display: 'all' | 'selection'
}

export interface BifurcationDiagram {
  id: string
  name: string
  selectedBranchIds: string[]
  xAxis: BifurcationAxis | null
  yAxis: BifurcationAxis | null
  axisRanges: AxisRanges
  viewRevision: number
}

export type BifurcationAxisKind = 'parameter' | 'state'

export interface BifurcationAxis {
  kind: BifurcationAxisKind
  name: string
}

export interface SystemLayout {
  leftWidth: number
  rightWidth: number
  objectsOpen: boolean
  inspectorOpen: boolean
  branchViewerOpen: boolean
}

export interface SystemUiState {
  selectedNodeId: string | null
  layout: SystemLayout
  viewportHeights: Record<string, number>
  limitCycleRenderTargets?: Record<string, LimitCycleRenderTarget>
}

export interface System {
  id: string
  name: string
  config: SystemConfig
  nodes: Record<string, TreeNode>
  rootIds: string[]
  objects: Record<string, AnalysisObject>
  branches: Record<string, ContinuationObject>
  scenes: Scene[]
  bifurcationDiagrams: BifurcationDiagram[]
  ui: SystemUiState
  updatedAt: string
}

export interface SystemData {
  id: string
  name: string
  config: SystemConfig
  objects: Record<string, AnalysisObject>
  branches: Record<string, ContinuationObject>
  updatedAt: string
}

export interface SystemUiSnapshot {
  systemId: string
  updatedAt: string
  nodes: Record<string, TreeNode>
  rootIds: string[]
  scenes: Scene[]
  bifurcationDiagrams: BifurcationDiagram[]
  ui: SystemUiState
}

export interface SystemSummary {
  id: string
  name: string
  updatedAt: string
  type: SystemConfig['type']
}
