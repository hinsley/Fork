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
}

export interface EquilibriumSolverParams {
  initialGuess: number[]
  maxSteps: number
  dampingFactor: number
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
}

export interface ContinuationEigenvalue {
  re: number
  im: number
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
  auxiliary?: number
}

export type BranchType =
  | { type: 'Equilibrium' }
  | { type: 'LimitCycle'; ntst: number; ncol: number }
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
    | 'fold_curve'
    | 'hopf_curve'
    | 'lpc_curve'
    | 'pd_curve'
    | 'ns_curve'
  data: ContinuationBranchData
  settings: any
  timestamp: string
  params?: number[]
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
  parameterName?: string
  paramValue?: number
  floquetMultipliers?: ContinuationEigenvalue[]
  createdAt: string
}

export type AnalysisObject =
  | OrbitObject
  | EquilibriumObject
  | LimitCycleObject
  | ContinuationObject

export interface CovariantLyapunovData {
  dim: number
  times: number[]
  vectors: number[][][]
}

export type NodeKind = 'object' | 'branch' | 'scene' | 'diagram' | 'camera'

export interface RenderStyle {
  color: string
  lineWidth: number
  pointSize: number
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

export interface Scene {
  id: string
  name: string
  camera: {
    eye: { x: number; y: number; z: number }
    center: { x: number; y: number; z: number }
    up: { x: number; y: number; z: number }
  }
  selectedNodeIds: string[]
  display: 'all' | 'selection'
}

export interface BifurcationDiagram {
  id: string
  name: string
  branchId: string | null
  xParam: string | null
  yParam: string | null
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

export interface SystemSummary {
  id: string
  name: string
  updatedAt: string
  type: SystemConfig['type']
}
