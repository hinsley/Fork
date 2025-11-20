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
}

export type AnalysisObject = OrbitObject; // Union with future types
