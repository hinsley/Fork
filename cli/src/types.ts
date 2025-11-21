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

export interface ContinuationTestFunctionValues {
    fold: number;
    hopf: number;
    neutral_saddle: number;
}

export interface ContinuationPoint {
    state: number[];
    param_value: number;
    tangent: number[];
    stability: "None" | "Fold" | "Hopf";
    test_function_values?: ContinuationTestFunctionValues;
    test_function_value?: number;
}

export interface ContinuationBranchData {
    points: ContinuationPoint[];
    bifurcations: number[];
    indices: number[];
}

export interface ContinuationObject {
    type: "continuation";
    name: string;
    systemName: string;
    parameterName: string;
    startObject: string; // Name of the equilibrium object used as seed
    data: ContinuationBranchData;
    settings: any; // Store settings used
    timestamp: string;
}

export type AnalysisObject = OrbitObject | EquilibriumObject | ContinuationObject;

export interface CovariantLyapunovData {
  dim: number;
  times: number[];
  vectors: number[][][]; // [checkpoint][vector][component]
}
