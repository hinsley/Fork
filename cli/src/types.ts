export interface SystemConfig {
  name: string;
  equations: string[];
  params: number[];
  paramNames: string[];
  varNames: string[];
  solver: string; // "rk4" | "tsit5" | "discrete"
  type: "flow" | "map";
}

export interface OrbitObject {
  type: "orbit";
  name: string;
  systemName: string;
  data: number[][]; // [t, x, y, ...]
  t_start: number;
  t_end: number;
  dt: number;
  lyapunovExponents?: number[];
  covariantVectors?: CovariantLyapunovData;
  parameters?: number[]; // Snapshot of parameters when created
  customParameters?: number[]; // Optional custom parameter override snapshot
}

export interface ComplexValue {
  re: number;
  im: number;
}

export interface EquilibriumEigenPair {
  value: ComplexValue;
  vector: ComplexValue[];
}

export interface EquilibriumSolution {
  state: number[];
  residual_norm: number;
  iterations: number;
  jacobian: number[];
  eigenpairs: EquilibriumEigenPair[];
  cycle_points?: number[][];
}

export interface EquilibriumSolverParams {
  initialGuess: number[];
  maxSteps: number;
  dampingFactor: number;
  mapIterations?: number;
}

export interface EquilibriumRunSummary {
  timestamp: string;
  success: boolean;
  residual_norm?: number;
  iterations?: number;
}

export interface EquilibriumObject {
  type: "equilibrium";
  name: string;
  systemName: string;
  solution?: EquilibriumSolution;
  lastSolverParams?: EquilibriumSolverParams;
  lastRun?: EquilibriumRunSummary;
  parameters?: number[]; // Snapshot of parameters when created (or last successfully solved)
  customParameters?: number[]; // Optional custom parameter override snapshot
}

export interface ContinuationEigenvalue {
  re: number;
  im: number;
}

export interface ContinuationPoint {
  state: number[];
  param_value: number;
  param2_value?: number;  // Second parameter value for 2-param branches
  stability: "None" | "Fold" | "Hopf" | "NeutralSaddle" | "CycleFold" | "PeriodDoubling" | "NeimarkSacker" | string;
  eigenvalues?: ContinuationEigenvalue[];
  cycle_points?: number[][];
  auxiliary?: number;  // Extra data like κ for Hopf curves
}

export type ManifoldStability = 'Stable' | 'Unstable';
export type ManifoldDirection = 'Plus' | 'Minus' | 'Both';
export type ManifoldEigenKind = 'RealPair' | 'ComplexPair';
export type Manifold2DProfile = 'LocalPreview' | 'LorenzGlobalKo';

export interface ManifoldTerminationCaps {
  max_steps: number;
  max_points: number;
  max_rings: number;
  max_vertices: number;
  max_time: number;
}

export interface ManifoldCurveGeometry {
  dim: number;
  points_flat: number[];
  arclength: number[];
  direction: ManifoldDirection;
}

export interface ManifoldRingDiagnostic {
  ring_index: number;
  radius_estimate: number;
  point_count: number;
}

export interface ManifoldSurfaceSolverDiagnostics {
  termination_reason: string;
  termination_detail?: string;
  final_leaf_delta: number;
  ring_attempts: number;
  build_failures: number;
  spacing_failures: number;
  reject_ring_quality: number;
  reject_geodesic_quality: number;
  reject_too_small: number;
  leaf_fail_plane_no_convergence?: number;
  leaf_fail_plane_root_not_bracketed?: number;
  leaf_fail_segment_switch_limit?: number;
  leaf_fail_integrator_non_finite?: number;
  leaf_fail_no_first_hit_within_max_time?: number;
  failed_ring?: number;
  failed_attempt?: number;
  failed_leaf_points?: number;
  last_leaf_failure_reason?: string;
  last_leaf_failure_point?: number;
  last_leaf_failure_time?: number;
  last_leaf_failure_segment?: number;
  last_leaf_failure_tau?: number;
  leaf_delta_floor?: number;
  min_leaf_delta_reached?: boolean;
  last_ring_max_turn_angle?: number;
  last_ring_max_distance_angle?: number;
  last_geodesic_max_angle?: number;
  last_geodesic_max_distance_angle?: number;
}

export interface ManifoldSurfaceGeometry {
  dim: number;
  vertices_flat: number[];
  triangles: number[];
  ring_offsets: number[];
  ring_diagnostics?: ManifoldRingDiagnostic[];
  solver_diagnostics?: ManifoldSurfaceSolverDiagnostics;
}

export interface ManifoldBounds {
  min: number[];
  max: number[];
}

export interface EquilibriumManifold1DSettings {
  stability: ManifoldStability;
  direction: ManifoldDirection;
  eig_index?: number;
  eps: number;
  target_arclength: number;
  integration_dt: number;
  caps: ManifoldTerminationCaps;
  bounds?: ManifoldBounds;
}

export interface EquilibriumManifold2DSettings {
  stability: ManifoldStability;
  eig_indices?: [number, number];
  profile?: Manifold2DProfile;
  initial_radius: number;
  leaf_delta: number;
  delta_min: number;
  ring_points: number;
  min_spacing: number;
  max_spacing: number;
  alpha_min: number;
  alpha_max: number;
  delta_alpha_min: number;
  delta_alpha_max: number;
  integration_dt: number;
  target_radius: number;
  target_arclength: number;
  caps: ManifoldTerminationCaps;
  bounds?: ManifoldBounds;
}

export interface LimitCycleManifold2DSettings {
  stability: ManifoldStability;
  floquet_index?: number;
  profile?: Manifold2DProfile;
  initial_radius: number;
  leaf_delta: number;
  delta_min: number;
  ring_points: number;
  min_spacing: number;
  max_spacing: number;
  alpha_min: number;
  alpha_max: number;
  delta_alpha_min: number;
  delta_alpha_max: number;
  integration_dt: number;
  target_arclength: number;
  ntst?: number;
  ncol?: number;
  caps: ManifoldTerminationCaps;
  bounds?: ManifoldBounds;
}

export type ManifoldGeometry =
  | { type: 'Curve'; dim: number; points_flat: number[]; arclength: number[]; direction: ManifoldDirection }
  | {
      type: 'Surface';
      dim: number;
      vertices_flat: number[];
      triangles: number[];
      ring_offsets: number[];
      ring_diagnostics?: ManifoldRingDiagnostic[];
      solver_diagnostics?: ManifoldSurfaceSolverDiagnostics;
    };

export interface ContinuationEndpointSeed {
  endpoint_index: number;
  aug_state: number[];
  tangent: number[];
  step_size: number;
}

export interface ContinuationResumeState {
  min_index_seed?: ContinuationEndpointSeed;
  max_index_seed?: ContinuationEndpointSeed;
}

export interface HomoclinicBasisSnapshot {
  stable_q: number[];
  unstable_q: number[];
  dim: number;
  nneg: number;
  npos: number;
}

export interface HomoclinicResumeContext {
  base_params: number[];
  param1_index: number;
  param2_index: number;
  basis: HomoclinicBasisSnapshot;
  fixed_time: number;
  fixed_eps0: number;
  fixed_eps1: number;
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
  | { type: 'IsochroneCurve'; param1_name: string; param2_name: string; ntst: number; ncol: number }
  | { type: 'PDCurve'; param1_name: string; param2_name: string; ntst: number; ncol: number }
  | { type: 'NSCurve'; param1_name: string; param2_name: string; ntst: number; ncol: number }
  | {
      type: 'ManifoldEq1D';
      stability: ManifoldStability;
      direction: ManifoldDirection;
      eig_index: number;
      method: string;
      caps: ManifoldTerminationCaps;
    }
  | {
      type: 'ManifoldEq2D';
      stability: ManifoldStability;
      eig_kind: ManifoldEigenKind;
      eig_indices: [number, number];
      method: string;
      caps: ManifoldTerminationCaps;
    }
  | {
      type: 'ManifoldCycle2D';
      stability: ManifoldStability;
      floquet_index: number;
      ntst: number;
      ncol: number;
      method: string;
      caps: ManifoldTerminationCaps;
    };

export interface ContinuationBranchData {
  points: ContinuationPoint[];
  bifurcations: number[];
  indices: number[];
  branch_type?: BranchType;
  upoldp?: number[][];  // LC-specific velocity profile
  homoc_context?: HomoclinicResumeContext;
  resume_state?: ContinuationResumeState;
  manifold_geometry?: ManifoldGeometry;
}

export interface ContinuationObject {
  type: "continuation";
  name: string;
  systemName: string;
  parameterName: string;
  /**
   * Parent analysis object that owns this branch on disk.
   *
   * Branch files live under `objects/<parentObject>/branches/<name>.json`.
   */
  parentObject: string;
  /**
   * Name of the seed object/branch used to construct this branch.
   *
   * This is kept for provenance/debugging and should not be used for storage lookup.
   */
  startObject: string;
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
    | 'cycle_manifold_2d';
  data: ContinuationBranchData;
  settings: any; // Store settings used
  timestamp: string;
  params?: number[];  // Full parameter snapshot at branch creation
  mapIterations?: number;
}

export type LimitCycleOrigin =
  | { type: 'orbit'; orbitName: string }
  | { type: 'hopf'; equilibriumObjectName: string; equilibriumBranchName: string; pointIndex: number }
  | { type: 'pd'; sourceLimitCycleObjectName: string; sourceBranchName: string; pointIndex: number };

export interface LimitCycleObject {
  type: "limit_cycle";
  name: string;
  systemName: string;
  origin: LimitCycleOrigin;
  ntst: number;
  ncol: number;
  period: number;
  state: number[]; // Flattened collocation state: [mesh, stages, period].
  parameters?: number[]; // Full parameter snapshot at creation.
  customParameters?: number[]; // Optional custom parameter override snapshot
  parameterName?: string;
  paramValue?: number;
  floquetMultipliers?: ContinuationEigenvalue[];
  createdAt: string;
}

export type AnalysisObject = OrbitObject | EquilibriumObject | LimitCycleObject | ContinuationObject;

export interface CovariantLyapunovData {
  dim: number;
  times: number[];
  vectors: number[][][]; // [checkpoint][vector][component]
}

export interface LimitCycleMeta {
  ntst: number;
  ncol: number;
}

export interface LimitCycleBranchResponse {
  branch: ContinuationBranchData;
  meta: LimitCycleMeta;
}

export type EquilibriumManifold1DResult = ContinuationBranchData[];
export type EquilibriumManifold2DResult = ContinuationBranchData;
export type LimitCycleManifold2DResult = ContinuationBranchData;

export interface ContinuationProgress {
  done: boolean;
  current_step: number;
  max_steps: number;
  points_computed: number;
  bifurcations_found: number;
  current_param: number;
}

export interface AnalysisProgress {
  done: boolean;
  current_step: number;
  max_steps: number;
}

export interface EquilibriumSolveProgress {
  done: boolean;
  iterations: number;
  max_steps: number;
  residual_norm: number;
}
