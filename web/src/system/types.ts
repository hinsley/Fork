export interface SystemConfig {
  name: string
  equations: string[]
  params: number[]
  paramNames: string[]
  varNames: string[]
  solver: string
  type: 'flow' | 'map'
}

export interface FrozenVariablesConfig {
  frozenValuesByVarName: Record<string, number>
}

export type ParameterRef =
  | { kind: 'native_param'; name: string }
  | { kind: 'frozen_var'; variableName: string }

export interface SubsystemSnapshot {
  baseVarNames: string[]
  baseParamNames: string[]
  freeVariableNames: string[]
  freeVariableIndices: number[]
  frozenValuesByVarName: Record<string, number>
  frozenParameterNamesByVarName: Record<string, string>
  hash: string
}

export interface OrbitObject {
  type: 'orbit'
  id?: string
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
  frozenVariables?: FrozenVariablesConfig
  subsystemSnapshot?: SubsystemSnapshot
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
  id?: string
  name: string
  systemName: string
  solution?: EquilibriumSolution
  lastSolverParams?: EquilibriumSolverParams
  lastRun?: EquilibriumRunSummary
  parameters?: number[]
  customParameters?: number[]
  frozenVariables?: FrozenVariablesConfig
  subsystemSnapshot?: SubsystemSnapshot
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

export type ManifoldStability = 'Stable' | 'Unstable'
export type ManifoldDirection = 'Plus' | 'Minus' | 'Both'
export type ManifoldEigenKind = 'RealPair' | 'ComplexPair'
export type Manifold2DProfile = 'LocalPreview' | 'LorenzGlobalKo'

export interface ManifoldTerminationCaps {
  max_steps: number
  max_points: number
  max_rings: number
  max_vertices: number
  max_time: number
}

export interface ManifoldCurveGeometry {
  dim: number
  points_flat: number[]
  arclength: number[]
  direction: ManifoldDirection
}

export interface ManifoldRingDiagnostic {
  ring_index: number
  radius_estimate: number
  point_count: number
}

export interface ManifoldSurfaceSolverDiagnostics {
  termination_reason: string
  termination_detail?: string
  final_leaf_delta: number
  ring_attempts: number
  build_failures: number
  spacing_failures: number
  reject_ring_quality: number
  reject_geodesic_quality: number
  reject_too_small: number
  leaf_fail_plane_no_convergence?: number
  leaf_fail_plane_root_not_bracketed?: number
  leaf_fail_segment_switch_limit?: number
  leaf_fail_integrator_non_finite?: number
  leaf_fail_no_first_hit_within_max_time?: number
  failed_ring?: number
  failed_attempt?: number
  failed_leaf_points?: number
  last_leaf_failure_reason?: string
  last_leaf_failure_point?: number
  last_leaf_failure_time?: number
  last_leaf_failure_segment?: number
  last_leaf_failure_tau?: number
  leaf_delta_floor?: number
  min_leaf_delta_reached?: boolean
  last_ring_max_turn_angle?: number
  last_ring_max_distance_angle?: number
  last_geodesic_max_angle?: number
  last_geodesic_max_distance_angle?: number
}

export interface ManifoldSurfaceGeometry {
  dim: number
  vertices_flat: number[]
  triangles: number[]
  ring_offsets: number[]
  ring_diagnostics?: ManifoldRingDiagnostic[]
  solver_diagnostics?: ManifoldSurfaceSolverDiagnostics
}

export type ManifoldGeometry =
  | { type: 'Curve'; Curve: ManifoldCurveGeometry }
  | { type: 'Surface'; Surface: ManifoldSurfaceGeometry }
  | { type: 'Curve'; dim: number; points_flat: number[]; arclength: number[]; direction: ManifoldDirection }
  | {
      type: 'Surface'
      dim: number
      vertices_flat: number[]
      triangles: number[]
      ring_offsets: number[]
      ring_diagnostics?: ManifoldRingDiagnostic[]
      solver_diagnostics?: ManifoldSurfaceSolverDiagnostics
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

export interface HomoclinicBasisSnapshot {
  stable_q: number[]
  unstable_q: number[]
  dim: number
  nneg: number
  npos: number
}

export interface HomoclinicResumeContext {
  base_params: number[]
  param1_index: number
  param2_index: number
  basis: HomoclinicBasisSnapshot
  fixed_time: number
  fixed_eps0: number
  fixed_eps1: number
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
      param1_ref?: ParameterRef
      param2_ref?: ParameterRef
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
      param1_ref?: ParameterRef
      param2_ref?: ParameterRef
      stage: 'StageA' | 'StageB' | 'StageC' | 'StageD'
    }
  | {
      type: 'FoldCurve'
      param1_name: string
      param2_name: string
      param1_ref?: ParameterRef
      param2_ref?: ParameterRef
    }
  | {
      type: 'HopfCurve'
      param1_name: string
      param2_name: string
      param1_ref?: ParameterRef
      param2_ref?: ParameterRef
    }
  | {
      type: 'LPCCurve'
      param1_name: string
      param2_name: string
      param1_ref?: ParameterRef
      param2_ref?: ParameterRef
      ntst: number
      ncol: number
    }
  | {
      type: 'IsochroneCurve'
      param1_name: string
      param2_name: string
      param1_ref?: ParameterRef
      param2_ref?: ParameterRef
      ntst: number
      ncol: number
    }
  | {
      type: 'PDCurve'
      param1_name: string
      param2_name: string
      param1_ref?: ParameterRef
      param2_ref?: ParameterRef
      ntst: number
      ncol: number
    }
  | {
      type: 'NSCurve'
      param1_name: string
      param2_name: string
      param1_ref?: ParameterRef
      param2_ref?: ParameterRef
      ntst: number
      ncol: number
    }
  | {
      type: 'ManifoldEq1D'
      stability: ManifoldStability
      direction: ManifoldDirection
      eig_index: number
      method: string
      caps: ManifoldTerminationCaps
    }
  | {
      type: 'ManifoldEq2D'
      stability: ManifoldStability
      eig_kind: ManifoldEigenKind
      eig_indices: [number, number]
      method: string
      caps: ManifoldTerminationCaps
    }
  | {
      type: 'ManifoldCycle2D'
      stability: ManifoldStability
      floquet_index: number
      ntst: number
      ncol: number
      method: string
      caps: ManifoldTerminationCaps
    }

export interface ContinuationBranchData {
  points: ContinuationPoint[]
  bifurcations: number[]
  indices: number[]
  branch_type?: BranchType
  upoldp?: number[][]
  homoc_context?: HomoclinicResumeContext
  resume_state?: ContinuationResumeState
  manifold_geometry?: ManifoldGeometry
}

export interface ContinuationObject {
  type: 'continuation'
  id?: string
  name: string
  systemName: string
  parameterName: string
  parameterRef?: ParameterRef
  parameter2Ref?: ParameterRef
  parentObjectId?: string
  startObjectId?: string
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
    | 'isochrone_curve'
    | 'pd_curve'
    | 'ns_curve'
    | 'eq_manifold_1d'
    | 'eq_manifold_2d'
    | 'cycle_manifold_2d'
  data: ContinuationBranchData
  settings: ContinuationSettings
  timestamp: string
  params?: number[]
  mapIterations?: number
  subsystemSnapshot?: SubsystemSnapshot
}

export type LimitCycleOrigin =
  | { type: 'orbit'; orbitId?: string; orbitName: string }
  | {
      type: 'hopf'
      equilibriumObjectId?: string
      equilibriumBranchId?: string
      equilibriumObjectName: string
      equilibriumBranchName: string
      pointIndex: number
    }
  | {
      type: 'pd'
      sourceLimitCycleObjectId?: string
      sourceBranchId?: string
      sourceLimitCycleObjectName: string
      sourceBranchName: string
      pointIndex: number
    }

export interface LimitCycleObject {
  type: 'limit_cycle'
  id?: string
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
  parameterRef?: ParameterRef
  paramValue?: number
  floquetMultipliers?: ContinuationEigenvalue[]
  floquetModes?: LimitCycleFloquetModeData
  createdAt: string
  frozenVariables?: FrozenVariablesConfig
  subsystemSnapshot?: SubsystemSnapshot
}

export interface LimitCycleFloquetModeData {
  ntst: number
  ncol: number
  multipliers: ContinuationEigenvalue[]
  vectors: ComplexValue[][][]
  computedAt: string
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
  subsystemSnapshot?: SubsystemSnapshot
}

export interface IsoclineObject {
  type: 'isocline'
  id?: string
  name: string
  systemName: string
  source: IsoclineSource
  level: number
  axes: IsoclineAxis[]
  frozenState: number[]
  parameters?: number[]
  customParameters?: number[]
  lastComputed?: IsoclineComputedSnapshot
  frozenVariables?: FrozenVariablesConfig
  subsystemSnapshot?: SubsystemSnapshot
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
  stride: number
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

export type SceneAxisVariables = [string] | [string, string] | [string, string, string]

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

export interface ObjectIndexEntry {
  id: string
  name: string
  objectType: AnalysisObject['type']
  shard: string
  updatedAt: string
}

export interface BranchIndexEntry {
  id: string
  name: string
  branchType: ContinuationObject['branchType']
  parentObjectId: string | null
  startObjectId: string | null
  shard: string
  updatedAt: string
}

export interface SystemIndex {
  objects: Record<string, ObjectIndexEntry>
  branches: Record<string, BranchIndexEntry>
}

export interface System {
  id: string
  name: string
  config: SystemConfig
  index: SystemIndex
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
  index: SystemIndex
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
