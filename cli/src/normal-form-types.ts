export type NormalFormComplex = { re: number; im: number };
export type NormalFormCriticality = 'Supercritical' | 'Subcritical' | 'Singular';

export type NormalFormConditioning = {
  eigenvector_pairing: number;
  right_residual: number;
  left_residual: number;
  homological_residual: number;
  return_map_residual?: number;
  section_residual?: number;
  return_time_correction?: number;
  section_transversality?: number;
};

export type BranchPointNormalForm = {
  type: 'BranchPoint';
  kind: 'Fold' | 'LimitPointCycle' | 'Transcritical' | 'Pitchfork' | 'Degenerate';
  constant_parameter_coefficient: number;
  linear_parameter_coefficient: number;
  quadratic_coefficient: number;
  cubic_coefficient: number;
  conditioning: NormalFormConditioning;
  critical_mode?: number[];
};

export type PeriodDoublingNormalForm = {
  type: 'PeriodDoubling';
  multiplier?: number;
  parameter_coefficient: number;
  cubic_coefficient: number;
  criticality: NormalFormCriticality;
  conditioning: NormalFormConditioning;
  critical_mode?: number[];
};

export type NeimarkSackerNormalForm = {
  type: 'NeimarkSacker';
  angle: number;
  multiplier: NormalFormComplex;
  parameter_coefficient: NormalFormComplex;
  cubic_coefficient: NormalFormComplex;
  criticality: NormalFormCriticality;
  conditioning: NormalFormConditioning;
};

export type EquilibriumCodim2Diagnostics = {
  jacobian_condition_number: number;
  unfolding_condition_number: number;
  minimum_eigenvector_pairing: number;
  max_eigen_residual: number;
  max_homological_residual: number;
  resonance_distance: number;
};

export type ZeroHopfNormalForm = {
  type: 'ZeroHopf';
  frequency: number;
  g200: number;
  g011: number;
  g110: NormalFormComplex;
  g111: NormalFormComplex;
  g021: NormalFormComplex;
  reduced_g021: NormalFormComplex;
  has_neimark_sacker: boolean;
  diagnostics: EquilibriumCodim2Diagnostics;
  [key: string]: unknown;
};

export type HopfHopfNormalForm = {
  type: 'HopfHopf';
  frequency1: number;
  frequency2: number;
  g2100: NormalFormComplex;
  g0021: NormalFormComplex;
  g1110: NormalFormComplex;
  g1011: NormalFormComplex;
  neimark_sacker_predictors: Array<{ periodic_mode: 1 | 2 }>;
  diagnostics: EquilibriumCodim2Diagnostics;
  [key: string]: unknown;
};

export type ComputedNormalForm =
  | BranchPointNormalForm
  | PeriodDoublingNormalForm
  | NeimarkSackerNormalForm
  | ZeroHopfNormalForm
  | HopfHopfNormalForm;

export interface NormalFormProvenance {
  source_kind: 'Map' | 'PeriodicOrbit' | 'ZeroHopf' | 'HopfHopf';
  source_branch_id: string;
  source_branch_name?: string;
  /** Legacy CLI field accepted when reading older branch JSON. */
  source_branch?: string;
  source_point_index: number;
  parameter_names: string[];
  parameter_values: number[];
  map_iterations?: number;
  normalized_mesh?: number[];
  computed_at: string;
  normal_form: ComputedNormalForm;
}
