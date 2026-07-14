import type { NormalFormProvenance } from '../compute/normalFormTypes'

export interface PeriodicVariableConfig {
  enabled: boolean
  period: number
}

export interface SystemConfig {
  name: string
  equations: string[]
  params: number[]
  paramNames: string[]
  varNames: string[]
  periodicVariables?: PeriodicVariableConfig[]
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
  solutionProvenance?: EquilibriumSolutionProvenance
  lastSolverParams?: EquilibriumSolverParams
  lastRun?: EquilibriumRunSummary
  parameters?: number[]
  customParameters?: number[]
  frozenVariables?: FrozenVariablesConfig
  subsystemSnapshot?: SubsystemSnapshot
}

export interface EquilibriumSolutionProvenance {
  fingerprint: string
  mapIterations?: number
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
  collocation_adaptivity?: CollocationAdaptivitySettings
  homoclinic_discretization?: 'collocation' | 'shooting'
  shooting_intervals?: number
  integration_steps_per_segment?: number
}

export interface CollocationAdaptivitySettings {
  enabled: boolean
  redistribution_enabled: boolean
  defect_tolerance: number
  max_refinements: number
  max_mesh_points: number
}

export type CollocationMeshAdaptationKind = 'redistribution' | 'refinement'

export interface CollocationRefinementAttempt {
  sequence: number
  kind: CollocationMeshAdaptationKind
  old_mesh_points: number
  new_mesh_points: number
  degree: number
  trigger_defect: number
  tolerance: number
  interval_scaled_defects: number[]
  old_normalized_mesh: number[]
  new_normalized_mesh: number[]
}

export interface CollocationAdaptationReport {
  initial_mesh_points: number
  current_mesh_points: number
  degree: number
  defect_tolerance: number
  refinement_budget: number
  max_mesh_points: number
  initial_normalized_mesh: number[]
  current_normalized_mesh: number[]
  attempts: CollocationRefinementAttempt[]
  termination?: {
    reason:
      | 'adaptivity_disabled'
      | 'refinement_budget_exhausted'
      | 'mesh_point_limit_reached'
      | 'refinement_stalled'
    measured_defect: number
    tolerance: number
    mesh_points: number
    degree: number
    refinements_attempted: number
    refinement_budget: number
    max_mesh_points: number
    normalized_mesh: number[]
  }
}

export interface Codim2PointData {
  type: string
  refined: boolean
  candidate: boolean
  test_function: string
  test_function_value: number
  residual_norm: number
  iterations: number
  tolerance: number
  source_segment: [number, number]
  source_test_values: [number, number]
  method: string
  coefficients: Array<{ name: string; value: number }>
  conditioning: {
    bordered_condition_number?: number
    jacobian_condition_number?: number
  }
  branch_switches?: Codim2BranchSwitch[]
  certification?: Codim2Certification
}

export interface Codim2BranchSwitch {
  target: string
  available: boolean
  target_auxiliary?: number
  reason?: string
}

export interface Codim2Certification {
  defining_conditions_verified: boolean
  nondegeneracy_evaluated: boolean
  nondegenerate?: boolean
  reason?: string
}

export type HomoclinicEventKind =
  | 'NNS'
  | 'NSF'
  | 'NFF'
  | 'DRS'
  | 'DRU'
  | 'NDS'
  | 'NDU'
  | 'TLS'
  | 'TLU'
  | 'NCH'
  | 'SH'
  | 'BT'
  | 'OFU'
  | 'OFS'
  | 'IFU'
  | 'IFS'

export type HomoclinicEventStatus = 'available' | 'unavailable' | 'unsupported'

export interface HomoclinicEventValue {
  kind: HomoclinicEventKind
  name: string
  value: number | null
  status: HomoclinicEventStatus
  reason: string | null
}

export interface HomoclinicEventDiagnostics {
  events: HomoclinicEventValue[]
  stable_dimension: number
  unstable_dimension: number
  discarded_eigenvalues: number
}

export interface ContinuationPoint {
  state: number[]
  param_value: number
  param2_value?: number
  stability:
    | 'None'
    | 'Fold'
    | 'BranchPoint'
    | 'Hopf'
    | 'NeutralSaddle'
    | 'CycleFold'
    | 'PeriodDoubling'
    | 'NeimarkSacker'
    | string
  eigenvalues?: ContinuationEigenvalue[]
  cycle_points?: number[][]
  auxiliary?: number
  codim2?: Codim2PointData
  codim2_events?: Codim2PointData[]
  normal_form?: NormalFormProvenance
  homoclinic_events?: HomoclinicEventDiagnostics
}

export type ManifoldStability = 'Stable' | 'Unstable'
export type ManifoldDirection = 'Plus' | 'Minus' | 'Both'
export type ManifoldEigenKind = 'RealPair' | 'ComplexPair'
export type Manifold2DProfile = 'LocalPreview' | 'AdaptiveGlobal' | 'LorenzGlobalKo'
export type ManifoldCycle2DAlgorithm =
  | 'GeodesicRings'
  | 'IsochronFibers'
  | 'SegmentedPreimageFibers'

export interface ManifoldTerminationCaps {
  max_steps: number
  max_points: number
  max_rings: number
  max_vertices: number
  max_time: number
  max_iterations?: number
}

export interface EquilibriumManifold1DSettings {
  stability: ManifoldStability
  direction: ManifoldDirection
  eig_index?: number
  eps: number
  target_arclength: number
  integration_dt: number
  caps: ManifoldTerminationCaps
  bounds?: { min: number[]; max: number[] }
}

export interface EquilibriumManifold2DSettings {
  stability: ManifoldStability
  eig_indices?: [number, number]
  profile?: Manifold2DProfile
  initial_radius: number
  leaf_delta: number
  delta_min: number
  ring_points: number
  min_spacing: number
  max_spacing: number
  alpha_min: number
  alpha_max: number
  delta_alpha_min: number
  delta_alpha_max: number
  integration_dt: number
  target_radius: number
  target_arclength: number
  caps: ManifoldTerminationCaps
  bounds?: { min: number[]; max: number[] }
}

export interface LimitCycleManifold2DSettings {
  stability: ManifoldStability
  direction: ManifoldDirection
  algorithm: ManifoldCycle2DAlgorithm
  floquet_index?: number
  parameter_index?: number
  profile?: Manifold2DProfile
  initial_radius: number
  leaf_delta: number
  delta_min: number
  ring_points: number
  min_spacing: number
  max_spacing: number
  alpha_min: number
  alpha_max: number
  delta_alpha_min: number
  delta_alpha_max: number
  integration_dt: number
  target_arclength: number
  ntst?: number
  ncol?: number
  caps: ManifoldTerminationCaps
  bounds?: { min: number[]; max: number[] }
}

export interface ManifoldCurveGeometry {
  dim: number
  points_flat: number[]
  arclength: number[]
  source_arclength?: number[]
  direction: ManifoldDirection
  solver_diagnostics?: ManifoldCurveSolverDiagnostics
  resume_state?: ManifoldCurveResumeState
}

export interface ManifoldMapDomainCursor {
  segment_index: number
  alpha: number
}

export type ManifoldCurveResumeState =
  | { type: 'Flow'; version: number; endpoint: number[] }
  | {
      type: 'Map'
      version: number
      cycle_anchor: number[]
      active_domain: number[][]
      pending_points?: number[][]
      cursor?: ManifoldMapDomainCursor
      spacing_target: number
      map_step_iterations: number
      growth_iterations: number
    }

export interface ManifoldCurveSolverDiagnostics {
  termination_reason: string
  termination_detail?: string
  requested_arclength: number
  achieved_arclength: number
  target_reached: boolean
  integration_steps: number
  map_growth_iterations: number
  preimage_failures: number
  refinement_failures: number
  extension_count: number
  source_correction_norm: number
  least_period?: number
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
  local_leaf_shrinks?: number
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
  extension_count?: number
}

export interface ManifoldHkoFiberResumeState {
  phase_point: number[]
  fiber: number[][]
  inner: number[]
  outer: number[]
  solution_start: number[]
  solution_unknown: number[]
  lift_off: number
  family_parameter: number
  family_step: number
}

export type ManifoldSurfaceResumeState =
  | {
      type: 'GeodesicRings'
      version: number
      outer_ring: number[][]
      inward_anchors: number[][]
      current_leaf_delta: number
      accumulated_arclength: number
      center?: number[]
    }
  | {
      type: 'HkoIsochronFibers'
      version: number
      fibers: ManifoldHkoFiberResumeState[]
      emitted_arclength: number
      sigma: number
      return_time: number
      bvp_intervals: number
      bvp_degree: number
    }
  | {
      type: 'SegmentedPreimageFibers'
      version: number
      fibers: number[][][]
      current_ring: number[][]
      arclengths: number[]
      emitted_arclength: number
      sigma: number
      segment_duration: number
      phase_shift_per_segment: number
      bvp_intervals: number
      bvp_degree: number
    }

export interface ManifoldSurfaceGeometry {
  dim: number
  vertices_flat: number[]
  triangles: number[]
  ring_offsets: number[]
  ring_diagnostics?: ManifoldRingDiagnostic[]
  solver_diagnostics?: ManifoldSurfaceSolverDiagnostics
  resume_state?: ManifoldSurfaceResumeState
}

export type ManifoldGeometry =
  | { type: 'Curve'; Curve: ManifoldCurveGeometry }
  | { type: 'Surface'; Surface: ManifoldSurfaceGeometry }
  | {
      type: 'Curve'
      dim: number
      points_flat: number[]
      arclength: number[]
      source_arclength?: number[]
      direction: ManifoldDirection
      solver_diagnostics?: ManifoldCurveSolverDiagnostics
      resume_state?: ManifoldCurveResumeState
    }
  | {
      type: 'Surface'
      dim: number
      vertices_flat: number[]
      triangles: number[]
      ring_offsets: number[]
      ring_diagnostics?: ManifoldRingDiagnostic[]
      solver_diagnostics?: ManifoldSurfaceSolverDiagnostics
      resume_state?: ManifoldSurfaceResumeState
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
  projector_refresh_interval?: number
}

export type HomoclinicBranchDiscretization =
  | { type: 'collocation' }
  | { type: 'shooting'; integration_steps_per_segment: number }

export type BranchType =
  | { type: 'Equilibrium' }
  | { type: 'LimitCycle'; ntst: number; ncol: number; normalized_mesh?: number[] }
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
      discretization?: HomoclinicBranchDiscretization
      normalized_mesh?: number[]
      collocation_adaptivity?: CollocationAdaptivitySettings
      collocation_adaptation?: CollocationAdaptationReport
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
      normalized_mesh?: number[]
    }
  | {
      type: 'IsoperiodicCurve'
      param1_name: string
      param2_name: string
      param1_ref?: ParameterRef
      param2_ref?: ParameterRef
      ntst: number
      ncol: number
      normalized_mesh?: number[]
    }
  | {
      type: 'PDCurve'
      param1_name: string
      param2_name: string
      param1_ref?: ParameterRef
      param2_ref?: ParameterRef
      ntst: number
      ncol: number
      normalized_mesh?: number[]
    }
  | {
      type: 'NSCurve'
      param1_name: string
      param2_name: string
      param1_ref?: ParameterRef
      param2_ref?: ParameterRef
      ntst: number
      ncol: number
      normalized_mesh?: number[]
    }
  | {
      type: 'ManifoldEq1D'
      stability: ManifoldStability
      direction: ManifoldDirection
      eig_index: number
      method: string
      caps: ManifoldTerminationCaps
      map_iterations?: number
      cycle_point_index?: number
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
      direction?: ManifoldDirection
      algorithm?: ManifoldCycle2DAlgorithm
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
  collocation_adaptation?: CollocationAdaptationReport
  normal_form_provenance?: NormalFormProvenance
  codim2_seed?: {
    source_type: 'GeneralizedHopf' | 'BogdanovTakens' | 'ZeroHopf' | 'DoubleHopf'
    source_branch_id: string
    source_point_index: number
    target: 'Fold' | 'Hopf' | 'LimitPointCycle' | 'NeimarkSacker' | 'Homoclinic'
    perturbation: number
    predictor_residual: number
    corrected_residual: number
    correction_iterations?: number
  }
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
    | 'isoperiodic_curve'
    | 'pd_curve'
    | 'ns_curve'
    | 'eq_manifold_1d'
    | 'eq_manifold_2d'
    | 'cycle_manifold_2d'
  data: ContinuationBranchData
  settings: ContinuationSettings
  manifoldSettings?:
    | EquilibriumManifold1DSettings
    | EquilibriumManifold2DSettings
    | LimitCycleManifold2DSettings
  manifoldFingerprint?: string
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
  normalized_mesh?: number[]
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
  backend?: FloquetBackend
  multipliers: ContinuationEigenvalue[]
  vectors: ComplexValue[][][]
  computedAt: string
}

export type FloquetBackend = 'auto' | 'periodic_schur' | 'block_cyclic'

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

export type NodeKind =
  | 'object'
  | 'branch'
  | 'folder'
  | 'scene'
  | 'diagram'
  | 'analysis'
  | 'camera'

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
  manifoldSurfaceVisible?: boolean
  clv?: ClvRenderStyle
  equilibriumEigenvectors?: EquilibriumEigenvectorRenderStyle
}

export interface TreeNode {
  id: string
  name: string
  kind: NodeKind
  objectType?:
    | AnalysisObject['type']
    | 'branch'
    | 'scene'
    | 'bifurcation'
    | 'analysis'
    | 'camera'
    | 'folder'
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

export type SceneAxisVariables =
  | [string]
  | [string, string]
  | [string, string, string]

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

export type EventSeriesMode =
  | 'every_iterate'
  | 'cross_up'
  | 'cross_down'
  | 'cross_either'

export interface AnalysisEventSpec {
  mode: EventSeriesMode
  source: IsoclineSource
  level: number
  positivityConstraints?: string[]
}

export type AnalysisAxisSpec =
  | {
      kind: 'observable'
      expression: string
      label?: string | null
      hitOffset: number
    }
  | {
      kind: 'hit_index'
      label?: string | null
    }
  | {
      kind: 'delta_time'
      label?: string | null
      hitOffset: number
    }

export interface AnalysisViewportAdvanced {
  skipHits: number
  hitStride: number
  maxHits: number
  connectPoints: boolean
  showIdentityLine: boolean
  identityLineColor: string
  identityLineStyle: LineStyle
}

export interface ReturnMapViewport {
  id: string
  name: string
  kind: 'return_map'
  axisRanges: AxisRanges
  viewRevision: number
  sourceNodeIds: string[]
  display: 'all' | 'selection'
  event: AnalysisEventSpec
  axes: {
    x: AnalysisAxisSpec
    y: AnalysisAxisSpec
    z?: AnalysisAxisSpec | null
  }
  advanced: AnalysisViewportAdvanced
}

export type AnalysisViewport = ReturnMapViewport

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
  analysisViewports: AnalysisViewport[]
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
  analysisViewports: AnalysisViewport[]
  ui: SystemUiState
}

export interface SystemSummary {
  id: string
  name: string
  updatedAt: string
  type: SystemConfig['type']
}
