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
}

export interface EquilibriumSolverParams {
  initialGuess: number[];
  maxSteps: number;
  dampingFactor: number;
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
  stability: "None" | "Fold" | "Hopf";
  eigenvalues?: ContinuationEigenvalue[];
}

export type BranchType =
  | { type: 'Equilibrium' }
  | { type: 'LimitCycle'; ntst: number; ncol: number };

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
  startObject: string; // Name of the equilibrium object used as seed
  branchType: 'equilibrium' | 'limit_cycle';  // Human-readable branch type
  data: ContinuationBranchData;
  settings: any; // Store settings used
  timestamp: string;
  params?: number[];  // Full parameter snapshot at branch creation
}

export type AnalysisObject = OrbitObject | EquilibriumObject | ContinuationObject;

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
