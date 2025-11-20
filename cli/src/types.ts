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
}

export type AnalysisObject = OrbitObject | EquilibriumObject;
