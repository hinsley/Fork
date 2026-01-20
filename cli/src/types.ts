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

export type BranchType =
  | { type: 'Equilibrium' }
  | { type: 'LimitCycle'; ntst: number; ncol: number }
  | { type: 'FoldCurve'; param1_name: string; param2_name: string }
  | { type: 'HopfCurve'; param1_name: string; param2_name: string }
  | { type: 'LPCCurve'; param1_name: string; param2_name: string; ntst: number; ncol: number }
  | { type: 'PDCurve'; param1_name: string; param2_name: string; ntst: number; ncol: number }
  | { type: 'NSCurve'; param1_name: string; param2_name: string; ntst: number; ncol: number };

export interface ContinuationBranchData {
  points: ContinuationPoint[];
  bifurcations: number[];
  indices: number[];
  branch_type?: BranchType;
  upoldp?: number[][];  // LC-specific velocity profile
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
  branchType: 'equilibrium' | 'limit_cycle' | 'fold_curve' | 'hopf_curve' | 'lpc_curve' | 'pd_curve' | 'ns_curve';
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
