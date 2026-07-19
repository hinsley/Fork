/**
 * The staged Rust inventory is intentionally explicit. `profile` rewrites the
 * timing report, but moving a test between tiers remains a reviewed change.
 */
export const mediumRustTests = [
  'complex_principal_blocks_localize_transport_rank_loss',
  'transported_inclination_tests_cross_on_analytic_connections',
  'hopf_hopf_ns_predictors_correct_both_modes_and_continue',
  'manifold_eq_2d_rossler_unstable_no_segment_switch_limit_failures',
  'manifold_cycle_2d_hko_constructs_nonlinear_fundamental_segments',
  'lpc_curve_refines_cpc_with_a_signed_coefficient_bracket',
  'manifold_eq_2d_adaptive_global_grows_shimizu_morioka_stable_surface',
  'transverse_pair_ns_curve_accepts_multiple_collocation_steps',
  'stable_orbit_reaches_matcont_pd_and_continues_the_pd_curve',
  'nonorientable_suspension_pd_curve_accepts_multiple_collocation_steps',
  'test_pd_branch_is_period_doubled',
  'manifold_cycle_2d_isochron_fibers_builds_stable_linear_cylinder',
  'targeted_ns_normal_form_tracks_the_requested_pair_when_modulus_order_switches',
  'neimark_sacker_normal_form_includes_orbit_drift_and_quadratic_terms',
  'manifold_cycle_2d_hko_reports_max_steps_when_the_common_fiber_is_short',
  'underresolved_connection_adapts_and_persists_its_exact_mesh',
  'manifold_cycle_2d_isochron_fibers_builds_unstable_linear_cylinder',
  'manifold_eq_2d_builds_surface_geometry',
  'manifold_eq_2d_extension_resumes_the_outer_geodesic_ring',
  'zero_hopf_ns_predictor_corrects_and_continues_multiple_curve_steps',
  'manifold_cycle_2d_extension_resumes_hko_fundamental_segments',
  'neimark_sacker_normal_form_matches_a_complex_cubic_suspension',
  'manifold_eq_2d_lorenz_stable_global_parameters_expand_beyond_local_patch',
  'manifold_eq_2d_lorenz_stable_global_run_does_not_end_ring_build_failed_for_reference_profile',
  'ns_curve_refines_chenciner_with_a_signed_cubic_bracket',
  'decoupled_duffing_saddle_focus_advances_with_nsf_diagnostics',
  'test_hopf_continuation_direction',
  'period_doubling_normal_form_matches_an_analytic_suspension',
]

export const extremeRustTests = [
  'manifold_cycle_2d_hopf_benchmark_builds_multiple_rings_for_stable',
  'manifold_cycle_2d_hopf_benchmark_builds_multiple_rings_for_unstable',
  'pd_curve_refines_gpd_with_a_signed_cubic_bracket',
]

export const publishedRustTests = [
  'mlfast_orbit_reaches_published_lpc_and_continues_curve',
  'steinmetz_larter_orbit_reaches_published_ns_and_continues_curve',
]

export const allDeferredRustTests = [
  ...mediumRustTests,
  ...extremeRustTests,
  ...publishedRustTests,
]

export function nextestFilter(testNames) {
  const escaped = testNames.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return `test(/(?:${escaped.join('|')})$/)`
}
