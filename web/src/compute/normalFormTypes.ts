export type NormalFormType =
  | 'BranchPoint'
  | 'PeriodDoubling'
  | 'NeimarkSacker'
  | 'ZeroHopf'
  | 'HopfHopf'

export type NormalFormCriticality = 'Supercritical' | 'Subcritical' | 'Singular'

export type NormalFormComplex = {
  re: number
  im: number
}

export type MapNormalFormConditioning = {
  eigenvector_pairing: number
  right_residual: number
  left_residual: number
  homological_residual: number
}

export type PeriodicNormalFormConditioning = MapNormalFormConditioning & {
  return_map_residual: number
  section_residual: number
  return_time_correction: number
  section_transversality: number
}

export type EquilibriumCodim2NormalFormDiagnostics = {
  jacobian_condition_number: number
  unfolding_condition_number: number
  minimum_eigenvector_pairing: number
  max_eigen_residual: number
  max_homological_residual: number
  resonance_distance: number
}

export type MapNormalForm =
  | {
      type: 'BranchPoint'
      kind: 'Fold' | 'Transcritical' | 'Pitchfork' | 'Degenerate'
      constant_parameter_coefficient: number
      linear_parameter_coefficient: number
      quadratic_coefficient: number
      cubic_coefficient: number
      conditioning: MapNormalFormConditioning
    }
  | {
      type: 'PeriodDoubling'
      parameter_coefficient: number
      cubic_coefficient: number
      criticality: NormalFormCriticality
      conditioning: MapNormalFormConditioning
    }
  | {
      type: 'NeimarkSacker'
      angle: number
      multiplier: NormalFormComplex
      parameter_coefficient: NormalFormComplex
      cubic_coefficient: NormalFormComplex
      criticality: NormalFormCriticality
      conditioning: MapNormalFormConditioning
    }

export type PeriodicOrbitNormalForm =
  | {
      type: 'BranchPoint'
      kind: 'LimitPointCycle' | 'Transcritical' | 'Pitchfork' | 'Degenerate'
      constant_parameter_coefficient: number
      linear_parameter_coefficient: number
      quadratic_coefficient: number
      cubic_coefficient: number
      critical_mode: number[]
      conditioning: PeriodicNormalFormConditioning
    }
  | {
      type: 'PeriodDoubling'
      multiplier: number
      parameter_coefficient: number
      cubic_coefficient: number
      criticality: NormalFormCriticality
      critical_mode: number[]
      conditioning: PeriodicNormalFormConditioning
    }
  | {
      type: 'NeimarkSacker'
      angle: number
      multiplier: NormalFormComplex
      parameter_coefficient: NormalFormComplex
      cubic_coefficient: NormalFormComplex
      criticality: NormalFormCriticality
      conditioning: PeriodicNormalFormConditioning
    }

export type ZeroHopfNormalForm = {
  type: 'ZeroHopf'
  state: number[]
  param1_index: number
  param2_index: number
  param1_value: number
  param2_value: number
  frequency: number
  zero_eigenvalue: number
  g200: number
  g011: number
  g110: NormalFormComplex
  g111: NormalFormComplex
  g021: NormalFormComplex
  f200: number
  f011: number
  f111: number
  reduced_g021: NormalFormComplex
  ns_center_coefficient: number
  ns_beta1: number
  ns_beta2: number
  has_neimark_sacker: boolean
  diagnostics: EquilibriumCodim2NormalFormDiagnostics
}

export type HopfHopfNeimarkSackerPredictor = {
  periodic_mode: 1 | 2
  parameter_quadratic: [number, number]
  frequency1_quadratic: number
  frequency2_quadratic: number
}

export type HopfHopfNormalForm = {
  type: 'HopfHopf'
  state: number[]
  param1_index: number
  param2_index: number
  param1_value: number
  param2_value: number
  frequency1: number
  frequency2: number
  g2100: NormalFormComplex
  g0021: NormalFormComplex
  g1110: NormalFormComplex
  g1011: NormalFormComplex
  gamma: [[NormalFormComplex, NormalFormComplex], [NormalFormComplex, NormalFormComplex]]
  neimark_sacker_predictors: HopfHopfNeimarkSackerPredictor[]
  diagnostics: EquilibriumCodim2NormalFormDiagnostics
}

export type ComputedNormalForm =
  | MapNormalForm
  | PeriodicOrbitNormalForm
  | ZeroHopfNormalForm
  | HopfHopfNormalForm

export type NormalFormProvenance = {
  source_kind: 'Map' | 'PeriodicOrbit' | 'ZeroHopf' | 'HopfHopf'
  source_branch_id: string
  source_branch_name?: string
  /** Legacy CLI field accepted when reading older branch JSON. */
  source_branch?: string
  source_point_index: number
  parameter_names: string[]
  parameter_values: number[]
  map_iterations?: number
  normalized_mesh?: number[]
  computed_at: string
  normal_form: ComputedNormalForm
}

export type LimitCycleSetupWire = {
  guess: {
    param_value: number
    period: number
    mesh_states: number[][]
    stage_states: number[][][]
    requires_fixed_parameter_correction: boolean
  }
  phase_anchor: number[]
  phase_direction: number[]
  mesh_points: number
  collocation_degree: number
  normalized_mesh: number[]
}
