use super::Codim2TestFunctions;
use crate::continuation::{
    BifurcationType, Codim1CurveType, Codim2BifurcationType, Codim2BranchSwitch,
    Codim2Certification, Codim2Coefficient, Codim2Conditioning, Codim2PointData, ContinuationPoint,
    ContinuationProblem,
};
use anyhow::{bail, Result};
use nalgebra::{DMatrix, DVector};

use super::{FoldCurveProblem, HopfCurveProblem, ZeroHopfNormalForm};
use crate::continuation::{LPCCurveProblem, NSCurveProblem, PDCurveProblem};

const MAX_REFINEMENT_ITERS: usize = 24;

/// A codimension-one problem that exposes codimension-two test functions.
pub trait Codim2CurveProblem: ContinuationProblem {
    fn curve_type(&self) -> Codim1CurveType;

    fn supported_codim2_types(&self) -> &'static [Codim2BifurcationType];

    fn codim2_tests_at(&mut self, aug: &DVector<f64>) -> Result<Codim2TestFunctions>;

    /// Named coefficients to retain after refinement. Implementations can add
    /// higher-order nondegeneracy coefficients such as the cusp cubic term.
    fn codim2_coefficients_at(
        &mut self,
        aug: &DVector<f64>,
        bifurcation_type: Codim2BifurcationType,
        test_value: f64,
    ) -> Result<Vec<Codim2Coefficient>> {
        let _ = aug;
        Ok(vec![Codim2Coefficient {
            name: coefficient_name(self.curve_type(), bifurcation_type).to_string(),
            value: test_value,
        }])
    }

    /// Implementations flag points whose higher-order nondegeneracy checks are
    /// unavailable or fail at the refined location.
    fn is_codim2_candidate(
        &self,
        bifurcation_type: Codim2BifurcationType,
        _coefficients: &[Codim2Coefficient],
    ) -> bool {
        let _ = bifurcation_type;
        false
    }
}

impl Codim2CurveProblem for FoldCurveProblem<'_> {
    fn curve_type(&self) -> Codim1CurveType {
        Codim1CurveType::Fold
    }

    fn supported_codim2_types(&self) -> &'static [Codim2BifurcationType] {
        &[
            Codim2BifurcationType::BogdanovTakens,
            Codim2BifurcationType::Cusp,
            Codim2BifurcationType::ZeroHopf,
        ]
    }

    fn codim2_tests_at(&mut self, aug: &DVector<f64>) -> Result<Codim2TestFunctions> {
        self.diagnostics(aug)?;
        Ok(self.codim2_tests())
    }

    fn codim2_coefficients_at(
        &mut self,
        aug: &DVector<f64>,
        bifurcation_type: Codim2BifurcationType,
        test_value: f64,
    ) -> Result<Vec<Codim2Coefficient>> {
        match bifurcation_type {
            Codim2BifurcationType::Cusp => {
                let normal_form = self.normal_form_at(aug)?;
                Ok(vec![
                    Codim2Coefficient {
                        name: "a".to_string(),
                        value: normal_form.quadratic_coefficient,
                    },
                    Codim2Coefficient {
                        name: "c".to_string(),
                        value: normal_form.cubic_coefficient,
                    },
                ])
            }
            Codim2BifurcationType::BogdanovTakens => {
                let normal_form = self.bogdanov_takens_normal_form_at(aug)?;
                Ok(vec![
                    Codim2Coefficient {
                        name: "a".to_string(),
                        value: normal_form.quadratic_coefficient,
                    },
                    Codim2Coefficient {
                        name: "b".to_string(),
                        value: normal_form.mixed_coefficient,
                    },
                    Codim2Coefficient {
                        name: "chain_residual".to_string(),
                        value: normal_form.chain_residual,
                    },
                    Codim2Coefficient {
                        name: "adjoint_chain_residual".to_string(),
                        value: normal_form.adjoint_chain_residual,
                    },
                ])
            }
            Codim2BifurcationType::ZeroHopf => {
                zero_hopf_coefficients(&self.zero_hopf_normal_form_at(aug)?)
            }
            _ => Ok(vec![Codim2Coefficient {
                name: coefficient_name(self.curve_type(), bifurcation_type).to_string(),
                value: test_value,
            }]),
        }
    }

    fn is_codim2_candidate(
        &self,
        bifurcation_type: Codim2BifurcationType,
        coefficients: &[Codim2Coefficient],
    ) -> bool {
        if bifurcation_type == Codim2BifurcationType::ZeroHopf {
            return equilibrium_codim2_diagnostics_are_invalid(coefficients);
        }
        let required: &[&str] = match bifurcation_type {
            Codim2BifurcationType::Cusp => &["c"],
            Codim2BifurcationType::BogdanovTakens => &["a", "b"],
            _ => return false,
        };
        let missing_or_degenerate = required.iter().any(|name| {
            coefficients
                .iter()
                .find(|coefficient| coefficient.name == *name)
                .is_none_or(|coefficient| {
                    !coefficient.value.is_finite() || coefficient.value.abs() <= 1e-8
                })
        });
        if missing_or_degenerate {
            return true;
        }
        if bifurcation_type == Codim2BifurcationType::BogdanovTakens {
            return ["chain_residual", "adjoint_chain_residual"]
                .iter()
                .any(|name| {
                    coefficients
                        .iter()
                        .find(|coefficient| coefficient.name == *name)
                        .is_none_or(|coefficient| {
                            !coefficient.value.is_finite() || coefficient.value > 1e-5
                        })
                });
        }
        false
    }
}

impl Codim2CurveProblem for HopfCurveProblem<'_> {
    fn curve_type(&self) -> Codim1CurveType {
        if self.system_kind().is_map() {
            Codim1CurveType::NeimarkSacker
        } else {
            Codim1CurveType::Hopf
        }
    }

    fn supported_codim2_types(&self) -> &'static [Codim2BifurcationType] {
        if self.system_kind().is_map() {
            &[
                Codim2BifurcationType::Resonance1_1,
                Codim2BifurcationType::Resonance1_2,
                Codim2BifurcationType::Resonance1_3,
                Codim2BifurcationType::Resonance1_4,
            ]
        } else {
            &[
                Codim2BifurcationType::BogdanovTakens,
                Codim2BifurcationType::ZeroHopf,
                Codim2BifurcationType::DoubleHopf,
                Codim2BifurcationType::GeneralizedHopf,
            ]
        }
    }

    fn codim2_tests_at(&mut self, aug: &DVector<f64>) -> Result<Codim2TestFunctions> {
        self.diagnostics(aug)?;
        Ok(self.codim2_tests())
    }

    fn codim2_coefficients_at(
        &mut self,
        aug: &DVector<f64>,
        bifurcation_type: Codim2BifurcationType,
        test_value: f64,
    ) -> Result<Vec<Codim2Coefficient>> {
        match bifurcation_type {
            Codim2BifurcationType::GeneralizedHopf => {
                let normal_form = self.normal_form_at(aug)?;
                let omega = aug[aug.len() - 1].max(0.0).sqrt();
                Ok(vec![
                    Codim2Coefficient {
                        name: "l1".to_string(),
                        value: normal_form.first_lyapunov_coefficient,
                    },
                    Codim2Coefficient {
                        name: "l2".to_string(),
                        value: normal_form.second_lyapunov_coefficient,
                    },
                    Codim2Coefficient {
                        name: "omega".to_string(),
                        value: omega,
                    },
                ])
            }
            Codim2BifurcationType::ZeroHopf => {
                zero_hopf_coefficients(&self.zero_hopf_normal_form_at(aug)?)
            }
            Codim2BifurcationType::DoubleHopf => {
                let normal_form = self.hopf_hopf_normal_form_at(aug)?;
                let mut coefficients = vec![
                    Codim2Coefficient {
                        name: "omega1".to_string(),
                        value: normal_form.frequency1,
                    },
                    Codim2Coefficient {
                        name: "omega2".to_string(),
                        value: normal_form.frequency2,
                    },
                    Codim2Coefficient {
                        name: "re_G2100".to_string(),
                        value: normal_form.g2100.re,
                    },
                    Codim2Coefficient {
                        name: "im_G2100".to_string(),
                        value: normal_form.g2100.im,
                    },
                    Codim2Coefficient {
                        name: "re_G0021".to_string(),
                        value: normal_form.g0021.re,
                    },
                    Codim2Coefficient {
                        name: "im_G0021".to_string(),
                        value: normal_form.g0021.im,
                    },
                    Codim2Coefficient {
                        name: "re_G1110".to_string(),
                        value: normal_form.g1110.re,
                    },
                    Codim2Coefficient {
                        name: "im_G1110".to_string(),
                        value: normal_form.g1110.im,
                    },
                    Codim2Coefficient {
                        name: "re_G1011".to_string(),
                        value: normal_form.g1011.re,
                    },
                    Codim2Coefficient {
                        name: "im_G1011".to_string(),
                        value: normal_form.g1011.im,
                    },
                    Codim2Coefficient {
                        name: "eigen_residual".to_string(),
                        value: normal_form.diagnostics.max_eigen_residual,
                    },
                    Codim2Coefficient {
                        name: "homological_residual".to_string(),
                        value: normal_form.diagnostics.max_homological_residual,
                    },
                    Codim2Coefficient {
                        name: "unfolding_condition".to_string(),
                        value: normal_form.diagnostics.unfolding_condition_number,
                    },
                    Codim2Coefficient {
                        name: "resonance_distance".to_string(),
                        value: normal_form.diagnostics.resonance_distance,
                    },
                ];
                for predictor in &normal_form.neimark_sacker_predictors {
                    coefficients.push(Codim2Coefficient {
                        name: format!("ns{}_alpha1", predictor.periodic_mode),
                        value: predictor.parameter_quadratic[0],
                    });
                    coefficients.push(Codim2Coefficient {
                        name: format!("ns{}_alpha2", predictor.periodic_mode),
                        value: predictor.parameter_quadratic[1],
                    });
                }
                Ok(coefficients)
            }
            _ => Ok(vec![Codim2Coefficient {
                name: coefficient_name(self.curve_type(), bifurcation_type).to_string(),
                value: test_value,
            }]),
        }
    }

    fn is_codim2_candidate(
        &self,
        bifurcation_type: Codim2BifurcationType,
        coefficients: &[Codim2Coefficient],
    ) -> bool {
        match bifurcation_type {
            Codim2BifurcationType::GeneralizedHopf => coefficients
                .iter()
                .find(|coefficient| coefficient.name == "l2")
                .is_none_or(|coefficient| {
                    !coefficient.value.is_finite() || coefficient.value.abs() <= 1e-8
                }),
            // Hopf-side BT points do not currently carry the nilpotent-chain
            // coefficients needed for safe branch switching.
            Codim2BifurcationType::BogdanovTakens => true,
            Codim2BifurcationType::ZeroHopf | Codim2BifurcationType::DoubleHopf => {
                (coefficient_missing_or_small(coefficients, "omega", 1e-8)
                    && coefficient_missing_or_small(coefficients, "omega1", 1e-8))
                    || equilibrium_codim2_diagnostics_are_invalid(coefficients)
            }
            _ => false,
        }
    }
}

impl Codim2CurveProblem for LPCCurveProblem<'_> {
    fn curve_type(&self) -> Codim1CurveType {
        Codim1CurveType::LimitPointCycle
    }

    fn supported_codim2_types(&self) -> &'static [Codim2BifurcationType] {
        &[
            Codim2BifurcationType::CuspOfCycles,
            Codim2BifurcationType::FoldFlip,
            Codim2BifurcationType::FoldNeimarkSacker,
        ]
    }

    fn codim2_tests_at(&mut self, aug: &DVector<f64>) -> Result<Codim2TestFunctions> {
        self.diagnostics(aug)?;
        Ok(self.codim2_tests())
    }

    fn codim2_coefficients_at(
        &mut self,
        aug: &DVector<f64>,
        bifurcation_type: Codim2BifurcationType,
        test_value: f64,
    ) -> Result<Vec<Codim2Coefficient>> {
        LPCCurveProblem::codim2_coefficients_at(self, aug, bifurcation_type, test_value)
    }

    fn is_codim2_candidate(
        &self,
        bifurcation_type: Codim2BifurcationType,
        coefficients: &[Codim2Coefficient],
    ) -> bool {
        if bifurcation_type != Codim2BifurcationType::CuspOfCycles {
            return false;
        }
        coefficient_missing_or_small(coefficients, "cubic_coefficient", 1e-8)
            // The local return map starts from the collocation phase anchor,
            // so its fixed-point residual also contains the accepted profile's
            // off-grid discretization error.  A millesimal bound remains well
            // below the cycle-curve acceptance threshold while accommodating
            // the intentionally coarse 4x3 exploration mesh.
            || coefficient_too_large(coefficients, "return_map_residual", 1e-3)
            || coefficient_too_large(coefficients, "right_eigen_residual", 1e-5)
            || coefficient_too_large(coefficients, "left_eigen_residual", 1e-5)
            || coefficient_too_large(coefficients, "homological_residual", 1e-4)
    }
}

impl Codim2CurveProblem for PDCurveProblem<'_> {
    fn curve_type(&self) -> Codim1CurveType {
        Codim1CurveType::PeriodDoubling
    }

    fn supported_codim2_types(&self) -> &'static [Codim2BifurcationType] {
        &[
            Codim2BifurcationType::FoldFlip,
            Codim2BifurcationType::GeneralizedPeriodDoubling,
            Codim2BifurcationType::FlipNeimarkSacker,
        ]
    }

    fn codim2_tests_at(&mut self, aug: &DVector<f64>) -> Result<Codim2TestFunctions> {
        self.diagnostics(aug)?;
        Ok(self.codim2_tests())
    }

    fn codim2_coefficients_at(
        &mut self,
        aug: &DVector<f64>,
        bifurcation_type: Codim2BifurcationType,
        test_value: f64,
    ) -> Result<Vec<Codim2Coefficient>> {
        PDCurveProblem::codim2_coefficients_at(self, aug, bifurcation_type, test_value)
    }

    fn is_codim2_candidate(
        &self,
        _bifurcation_type: Codim2BifurcationType,
        _coefficients: &[Codim2Coefficient],
    ) -> bool {
        false
    }
}

impl Codim2CurveProblem for NSCurveProblem<'_> {
    fn curve_type(&self) -> Codim1CurveType {
        Codim1CurveType::NeimarkSacker
    }

    fn supported_codim2_types(&self) -> &'static [Codim2BifurcationType] {
        &[
            Codim2BifurcationType::FoldNeimarkSacker,
            Codim2BifurcationType::FlipNeimarkSacker,
            Codim2BifurcationType::DoubleNeimarkSacker,
            Codim2BifurcationType::Chenciner,
            Codim2BifurcationType::Resonance1_1,
            Codim2BifurcationType::Resonance1_2,
            Codim2BifurcationType::Resonance1_3,
            Codim2BifurcationType::Resonance1_4,
        ]
    }

    fn codim2_tests_at(&mut self, aug: &DVector<f64>) -> Result<Codim2TestFunctions> {
        self.diagnostics(aug)?;
        Ok(self.codim2_tests())
    }

    fn codim2_coefficients_at(
        &mut self,
        aug: &DVector<f64>,
        bifurcation_type: Codim2BifurcationType,
        test_value: f64,
    ) -> Result<Vec<Codim2Coefficient>> {
        NSCurveProblem::codim2_coefficients_at(self, aug, bifurcation_type, test_value)
    }

    fn is_codim2_candidate(
        &self,
        _bifurcation_type: Codim2BifurcationType,
        _coefficients: &[Codim2Coefficient],
    ) -> bool {
        false
    }
}

fn zero_hopf_coefficients(normal_form: &ZeroHopfNormalForm) -> Result<Vec<Codim2Coefficient>> {
    Ok(vec![
        Codim2Coefficient {
            name: "omega".to_string(),
            value: normal_form.frequency,
        },
        Codim2Coefficient {
            name: "G200".to_string(),
            value: normal_form.g200,
        },
        Codim2Coefficient {
            name: "G011".to_string(),
            value: normal_form.g011,
        },
        Codim2Coefficient {
            name: "re_G110".to_string(),
            value: normal_form.g110.re,
        },
        Codim2Coefficient {
            name: "im_G110".to_string(),
            value: normal_form.g110.im,
        },
        Codim2Coefficient {
            name: "f111".to_string(),
            value: normal_form.f111,
        },
        Codim2Coefficient {
            name: "re_g021".to_string(),
            value: normal_form.reduced_g021.re,
        },
        Codim2Coefficient {
            name: "im_g021".to_string(),
            value: normal_form.reduced_g021.im,
        },
        Codim2Coefficient {
            name: "ns_beta1".to_string(),
            value: normal_form.ns_beta1,
        },
        Codim2Coefficient {
            name: "ns_beta2".to_string(),
            value: normal_form.ns_beta2,
        },
        Codim2Coefficient {
            name: "has_ns".to_string(),
            value: if normal_form.has_neimark_sacker {
                1.0
            } else {
                0.0
            },
        },
        Codim2Coefficient {
            name: "eigen_residual".to_string(),
            value: normal_form.diagnostics.max_eigen_residual,
        },
        Codim2Coefficient {
            name: "homological_residual".to_string(),
            value: normal_form.diagnostics.max_homological_residual,
        },
        Codim2Coefficient {
            name: "unfolding_condition".to_string(),
            value: normal_form.diagnostics.unfolding_condition_number,
        },
    ])
}

fn equilibrium_codim2_diagnostics_are_invalid(coefficients: &[Codim2Coefficient]) -> bool {
    coefficient_too_large(coefficients, "eigen_residual", 1e-5)
        || coefficient_too_large(coefficients, "homological_residual", 1e-4)
        || coefficients
            .iter()
            .find(|coefficient| coefficient.name == "unfolding_condition")
            .is_none_or(|coefficient| !coefficient.value.is_finite() || coefficient.value > 1e10)
}

fn coefficient_missing_or_small(
    coefficients: &[Codim2Coefficient],
    name: &str,
    tolerance: f64,
) -> bool {
    coefficients
        .iter()
        .find(|coefficient| coefficient.name == name)
        .is_none_or(|coefficient| {
            !coefficient.value.is_finite() || coefficient.value.abs() <= tolerance
        })
}

fn coefficient_too_large(coefficients: &[Codim2Coefficient], name: &str, tolerance: f64) -> bool {
    coefficients
        .iter()
        .find(|coefficient| coefficient.name == name)
        .is_none_or(|coefficient| {
            !coefficient.value.is_finite() || coefficient.value.abs() > tolerance
        })
}

/// A refined point that replaces the right endpoint of its source segment in
/// the public curve result while continuation itself remains at the accepted
/// step endpoint.
#[derive(Debug, Clone)]
pub struct RefinedCodim2Event {
    pub replace_index: usize,
    pub point: ContinuationPoint,
    pub data: Codim2PointData,
}

/// Detect and refine supported codimension-two sign changes along an already
/// corrected codimension-one curve.
pub fn refine_codim2_points<P: Codim2CurveProblem>(
    problem: &mut P,
    points: &[ContinuationPoint],
    corrector_steps: usize,
    tolerance: f64,
) -> Result<Vec<RefinedCodim2Event>> {
    if points.len() < 2 {
        return Ok(Vec::new());
    }
    if !tolerance.is_finite() || tolerance <= 0.0 {
        bail!("Codimension-two refinement tolerance must be positive and finite");
    }

    let dim = problem.dimension();
    let mut prev_aug = aug_from_point(&points[0], dim)?;
    let mut prev_tests = problem.codim2_tests_at(&prev_aug)?;
    prepare_problem_for_next_segment(problem, &prev_aug)?;

    let mut events = Vec::new();

    for (right_index, point) in points.iter().enumerate().skip(1) {
        let current_aug = aug_from_point(point, dim)?;
        let current_tests = problem.codim2_tests_at(&current_aug)?;

        let detected = detect_supported_crossings(
            &prev_tests,
            &current_tests,
            problem.supported_codim2_types(),
            tolerance,
        );

        for bifurcation_type in detected {
            let event = refine_segment(
                problem,
                right_index - 1,
                right_index,
                &prev_aug,
                &current_aug,
                prev_tests.value_for(bifurcation_type),
                current_tests.value_for(bifurcation_type),
                bifurcation_type,
                corrector_steps,
                tolerance,
            )?;
            events.push(event);
        }

        // Re-prime the problem at the accepted endpoint. Refinement may have
        // evaluated intermediate points, while border updates must follow the
        // actual continuation path and orientation.
        prepare_problem_for_next_segment(problem, &current_aug)?;
        prev_aug = current_aug;
        prev_tests = current_tests;
    }

    Ok(events)
}

fn detect_supported_crossings(
    previous: &Codim2TestFunctions,
    current: &Codim2TestFunctions,
    supported: &[Codim2BifurcationType],
    tolerance: f64,
) -> Vec<Codim2BifurcationType> {
    supported
        .iter()
        .copied()
        .filter(|kind| {
            let left = previous.value_for(*kind);
            let right = current.value_for(*kind);
            if !left.is_finite() || !right.is_finite() {
                return false;
            }
            left * right < 0.0 || (right.abs() <= tolerance && left.abs() > tolerance)
        })
        .collect()
}

#[allow(clippy::too_many_arguments)]
fn refine_segment<P: Codim2CurveProblem>(
    problem: &mut P,
    left_index: usize,
    right_index: usize,
    left_aug: &DVector<f64>,
    right_aug: &DVector<f64>,
    left_test: f64,
    right_test: f64,
    bifurcation_type: Codim2BifurcationType,
    corrector_steps: usize,
    tolerance: f64,
) -> Result<RefinedCodim2Event> {
    let mut lo_aug = left_aug.clone();
    let mut hi_aug = right_aug.clone();
    let mut lo_test = left_test;
    let mut hi_test = right_test;

    let mut best_aug = if lo_test.abs() < hi_test.abs() {
        lo_aug.clone()
    } else {
        hi_aug.clone()
    };
    let mut best_test = if lo_test.abs() < hi_test.abs() {
        lo_test
    } else {
        hi_test
    };
    let mut iterations = 0;

    for iteration in 1..=MAX_REFINEMENT_ITERS {
        iterations = iteration;
        let bracket = &hi_aug - &lo_aug;
        let bracket_norm = bracket.norm();
        if bracket_norm <= tolerance {
            break;
        }
        let tangent = if bracket_norm > 1e-14 {
            &bracket / bracket_norm
        } else {
            break;
        };

        let denom = hi_test - lo_test;
        let fraction = if denom.abs() > f64::EPSILON {
            (-lo_test / denom).clamp(0.1, 0.9)
        } else {
            0.5
        };
        let predicted = &lo_aug + bracket * fraction;
        let corrected = correct_to_curve(
            problem,
            &predicted,
            &tangent,
            corrector_steps.max(3),
            tolerance,
        )?
        .unwrap_or(predicted);

        let tests = problem.codim2_tests_at(&corrected)?;
        let trial_test = tests.value_for(bifurcation_type);
        if !trial_test.is_finite() {
            break;
        }

        if trial_test.abs() < best_test.abs() {
            best_aug = corrected.clone();
            best_test = trial_test;
        }

        let residual_norm = curve_residual_norm(problem, &corrected)?;
        if trial_test.abs() <= tolerance && residual_norm <= tolerance * 10.0 {
            best_aug = corrected;
            best_test = trial_test;
            break;
        }

        if lo_test * trial_test <= 0.0 {
            hi_aug = corrected;
            hi_test = trial_test;
        } else {
            lo_aug = corrected;
            lo_test = trial_test;
        }
    }

    let residual_norm = curve_residual_norm(problem, &best_aug)?;
    let diagnostics = problem.diagnostics(&best_aug)?;
    let tangent = normalized_secant(left_aug, right_aug)?;
    let source_norm = (right_aug - left_aug).norm();
    let source_directional_derivative = (bifurcation_type == Codim2BifurcationType::Chenciner
        && source_norm > 1e-14)
        .then_some((right_test - left_test) / source_norm);
    let conditioning = refinement_conditioning(
        problem,
        &best_aug,
        &tangent,
        bifurcation_type,
        source_directional_derivative,
    )?;
    let coefficients = problem.codim2_coefficients_at(&best_aug, bifurcation_type, best_test)?;
    let candidate = problem.is_codim2_candidate(bifurcation_type, &coefficients);
    let refined = best_test.abs() <= tolerance && residual_norm <= tolerance * 10.0;
    let certification = codim2_certification(bifurcation_type, refined, candidate);

    let point = ContinuationPoint {
        state: best_aug
            .rows(1, problem.dimension())
            .iter()
            .copied()
            .collect(),
        param_value: best_aug[0],
        stability: BifurcationType::None,
        eigenvalues: diagnostics.eigenvalues,
        cycle_points: diagnostics.cycle_points,
        homoclinic_events: None,
    };
    let data = Codim2PointData {
        bifurcation_type,
        refined,
        candidate,
        test_function: test_function_name(problem.curve_type(), bifurcation_type).to_string(),
        test_function_value: best_test,
        residual_norm,
        iterations,
        tolerance,
        source_segment: [left_index, right_index],
        source_test_values: [left_test, right_test],
        method: "bracketed secant with pseudo-arclength curve correction".to_string(),
        branch_switches: cycle_branch_switches(
            problem.curve_type(),
            bifurcation_type,
            &coefficients,
        ),
        coefficients,
        conditioning,
        certification,
    };

    Ok(RefinedCodim2Event {
        replace_index: right_index,
        point,
        data,
    })
}

fn codim2_certification(
    bifurcation_type: Codim2BifurcationType,
    refined: bool,
    candidate: bool,
) -> Codim2Certification {
    let bk_metadata_only = matches!(
        bifurcation_type,
        Codim2BifurcationType::GeneralizedPeriodDoubling
            | Codim2BifurcationType::Chenciner
            | Codim2BifurcationType::Resonance1_1
            | Codim2BifurcationType::Resonance1_2
            | Codim2BifurcationType::Resonance1_3
            | Codim2BifurcationType::Resonance1_4
    );
    if bk_metadata_only {
        return Codim2Certification {
            defining_conditions_verified: refined,
            nondegeneracy_evaluated: false,
            nondegenerate: None,
            reason: Some(
                "The defining event is curve-corrected and refined. The corresponding BifurcationKit periodic codim-2 constructor is metadata-only (its normal-form field is unset), so no independent normalized higher-order/resonant nondegeneracy coefficient is available as a parity oracle."
                    .to_string(),
            ),
        };
    }
    Codim2Certification {
        defining_conditions_verified: refined,
        nondegeneracy_evaluated: true,
        nondegenerate: Some(!candidate),
        reason: candidate.then(|| {
            "A required nondegeneracy coefficient is missing, singular, or below tolerance."
                .to_string()
        }),
    }
}

fn cycle_branch_switches(
    source: Codim1CurveType,
    bifurcation_type: Codim2BifurcationType,
    coefficients: &[Codim2Coefficient],
) -> Vec<Codim2BranchSwitch> {
    let available = |target, target_auxiliary| Codim2BranchSwitch {
        target,
        available: true,
        target_auxiliary,
        reason: None,
    };
    let unavailable = |target, reason: &str| Codim2BranchSwitch {
        target,
        available: false,
        target_auxiliary: None,
        reason: Some(reason.to_string()),
    };
    let secondary_ns_cosine = || {
        coefficients
            .iter()
            .find(|coefficient| coefficient.name == "secondary_unit_pair_cosine")
            .map(|coefficient| coefficient.value.clamp(-1.0, 1.0))
    };

    match (source, bifurcation_type) {
        (Codim1CurveType::LimitPointCycle, Codim2BifurcationType::FoldFlip) => {
            vec![available(Codim1CurveType::PeriodDoubling, None)]
        }
        (Codim1CurveType::PeriodDoubling, Codim2BifurcationType::FoldFlip) => {
            vec![available(Codim1CurveType::LimitPointCycle, None)]
        }
        (Codim1CurveType::LimitPointCycle, Codim2BifurcationType::FoldNeimarkSacker) => {
            vec![available(
                Codim1CurveType::NeimarkSacker,
                secondary_ns_cosine(),
            )]
        }
        (Codim1CurveType::NeimarkSacker, Codim2BifurcationType::FoldNeimarkSacker) => {
            vec![available(Codim1CurveType::LimitPointCycle, None)]
        }
        (Codim1CurveType::PeriodDoubling, Codim2BifurcationType::FlipNeimarkSacker) => {
            vec![available(
                Codim1CurveType::NeimarkSacker,
                secondary_ns_cosine(),
            )]
        }
        (Codim1CurveType::NeimarkSacker, Codim2BifurcationType::FlipNeimarkSacker) => {
            vec![available(Codim1CurveType::PeriodDoubling, None)]
        }
        (Codim1CurveType::NeimarkSacker, Codim2BifurcationType::DoubleNeimarkSacker) => {
            let auxiliary = secondary_ns_cosine();
            vec![if auxiliary.is_some() {
                available(Codim1CurveType::NeimarkSacker, auxiliary)
            } else {
                unavailable(
                    Codim1CurveType::NeimarkSacker,
                    "The second unit-pair angle could not be recovered from the refined Floquet spectrum.",
                )
            }]
        }
        (Codim1CurveType::NeimarkSacker, Codim2BifurcationType::Resonance1_1) => {
            vec![available(Codim1CurveType::LimitPointCycle, None)]
        }
        (Codim1CurveType::NeimarkSacker, Codim2BifurcationType::Resonance1_2) => {
            vec![available(Codim1CurveType::PeriodDoubling, None)]
        }
        (Codim1CurveType::LimitPointCycle, Codim2BifurcationType::CuspOfCycles) => vec![
            unavailable(
                Codim1CurveType::LimitPointCycle,
                "CPC has two tangent LPC arcs; selecting the other arc requires a two-parameter unfolding tangent, not the unperturbed refined orbit.",
            ),
        ],
        (Codim1CurveType::PeriodDoubling, Codim2BifurcationType::GeneralizedPeriodDoubling) => {
            vec![unavailable(
                Codim1CurveType::LimitPointCycle,
                "The emanating fold curve of doubled cycles requires the normalized fifth-order GPD coefficient and a doubled-orbit predictor.",
            )]
        }
        (Codim1CurveType::NeimarkSacker, Codim2BifurcationType::Chenciner) => vec![unavailable(
            Codim1CurveType::NeimarkSacker,
            "The emanating torus-fold curve is not a periodic-orbit codimension-one curve and has no Fork curve problem yet.",
        )],
        (Codim1CurveType::NeimarkSacker, Codim2BifurcationType::Resonance1_3) => vec![unavailable(
            Codim1CurveType::NeimarkSacker,
            "A 1:3 point emits a resonant period-three orbit branch, not another NS curve; Fork has no typed period-three resonant predictor.",
        )],
        (Codim1CurveType::NeimarkSacker, Codim2BifurcationType::Resonance1_4) => vec![unavailable(
            Codim1CurveType::NeimarkSacker,
            "A 1:4 point emits resonant period-four orbit branches, not another NS curve; Fork has no typed period-four resonant predictor.",
        )],
        _ => Vec::new(),
    }
}

fn correct_to_curve<P: ContinuationProblem>(
    problem: &mut P,
    prediction: &DVector<f64>,
    tangent: &DVector<f64>,
    max_iters: usize,
    tolerance: f64,
) -> Result<Option<DVector<f64>>> {
    let dim = problem.dimension();
    let mut current = prediction.clone();

    for _ in 0..max_iters {
        let mut residual = DVector::zeros(dim);
        problem.residual(&current, &mut residual)?;
        if residual.norm() <= tolerance {
            return Ok(Some(current));
        }

        let jacobian = problem.extended_jacobian(&current)?;
        let bordered = append_row(&jacobian, tangent)?;
        let mut rhs = DVector::zeros(dim + 1);
        for row in 0..dim {
            rhs[row] = -residual[row];
        }
        let Some(delta) = bordered.lu().solve(&rhs) else {
            return Ok(None);
        };
        if !delta.iter().all(|value| value.is_finite()) {
            return Ok(None);
        }
        let damping = if delta.norm() > 1.0 {
            0.5 / delta.norm()
        } else {
            1.0
        };
        current += delta * damping;
    }

    if curve_residual_norm(problem, &current)? <= tolerance * 10.0 {
        Ok(Some(current))
    } else {
        Ok(None)
    }
}

fn refinement_conditioning<P: Codim2CurveProblem>(
    problem: &mut P,
    aug: &DVector<f64>,
    tangent: &DVector<f64>,
    bifurcation_type: Codim2BifurcationType,
    source_directional_derivative: Option<f64>,
) -> Result<Codim2Conditioning> {
    let curve_jacobian = problem.extended_jacobian(aug)?;
    let bordered = append_row(&curve_jacobian, tangent)?;
    // A codimension-one curve Jacobian has a one-dimensional nullspace. For
    // Chenciner localization, the only new rank information supplied by the
    // expensive normal-form gradient is therefore its component along that
    // tangent. The signed source bracket already measures this derivative.
    // Using its projected row avoids two complete return-map normal-form
    // evaluations per collocation unknown while preserving the transversality
    // test and the natural curve-corrected defining system.
    let gradient = if let Some(derivative) = source_directional_derivative
        .filter(|value| value.is_finite() && value.abs() > f64::EPSILON)
    {
        tangent * derivative
    } else {
        codim2_test_gradient(problem, aug, bifurcation_type)?
    };
    let augmented = append_row(&curve_jacobian, &gradient)?;
    Ok(Codim2Conditioning {
        bordered_condition_number: condition_number(&bordered),
        jacobian_condition_number: condition_number(&augmented),
    })
}

fn codim2_test_gradient<P: Codim2CurveProblem>(
    problem: &mut P,
    aug: &DVector<f64>,
    bifurcation_type: Codim2BifurcationType,
) -> Result<DVector<f64>> {
    let mut gradient = DVector::zeros(aug.len());
    for index in 0..aug.len() {
        let step = 1e-5 * aug[index].abs().max(1.0);
        let mut plus = aug.clone();
        let mut minus = aug.clone();
        plus[index] += step;
        minus[index] -= step;
        let plus_value = problem.codim2_tests_at(&plus)?.value_for(bifurcation_type);
        let minus_value = problem.codim2_tests_at(&minus)?.value_for(bifurcation_type);
        gradient[index] = (plus_value - minus_value) / (2.0 * step);
    }
    Ok(gradient)
}

fn condition_number(matrix: &DMatrix<f64>) -> Option<f64> {
    if matrix.nrows() == 0 || matrix.ncols() == 0 {
        return None;
    }
    let singular_values = matrix.clone().svd(false, false).singular_values;
    let maximum = singular_values.iter().copied().fold(0.0_f64, f64::max);
    let minimum = singular_values
        .iter()
        .copied()
        .filter(|value| value.is_finite())
        .fold(f64::INFINITY, f64::min);
    if !maximum.is_finite() || !minimum.is_finite() || maximum <= 0.0 {
        None
    } else {
        // Preserve a finite diagnostic for rank-deficient/near-singular
        // matrices so severe conditioning is visible and JSON-safe.
        let numerical_floor = f64::EPSILON * maximum.max(1.0);
        Some(maximum / minimum.max(numerical_floor))
    }
}

fn append_row(matrix: &DMatrix<f64>, row: &DVector<f64>) -> Result<DMatrix<f64>> {
    if matrix.ncols() != row.len() {
        bail!(
            "Cannot border a {}x{} matrix with a {}-entry row",
            matrix.nrows(),
            matrix.ncols(),
            row.len()
        );
    }
    let mut bordered = DMatrix::zeros(matrix.nrows() + 1, matrix.ncols());
    bordered
        .view_mut((0, 0), (matrix.nrows(), matrix.ncols()))
        .copy_from(matrix);
    bordered.row_mut(matrix.nrows()).copy_from(&row.transpose());
    Ok(bordered)
}

fn normalized_secant(left: &DVector<f64>, right: &DVector<f64>) -> Result<DVector<f64>> {
    let secant = right - left;
    let norm = secant.norm();
    if norm <= 1e-14 {
        bail!("Codimension-two refinement source segment has zero length");
    }
    Ok(secant / norm)
}

fn curve_residual_norm<P: ContinuationProblem>(problem: &mut P, aug: &DVector<f64>) -> Result<f64> {
    let mut residual = DVector::zeros(problem.dimension());
    problem.residual(aug, &mut residual)?;
    Ok(residual.norm())
}

fn prepare_problem_for_next_segment<P: ContinuationProblem>(
    problem: &mut P,
    aug: &DVector<f64>,
) -> Result<()> {
    let mut residual = DVector::zeros(problem.dimension());
    problem.residual(aug, &mut residual)?;
    problem.update_after_step(aug)
}

fn aug_from_point(point: &ContinuationPoint, dimension: usize) -> Result<DVector<f64>> {
    if point.state.len() != dimension {
        bail!(
            "Codimension-one point has {} state entries, expected {}",
            point.state.len(),
            dimension
        );
    }
    let mut aug = DVector::zeros(dimension + 1);
    aug[0] = point.param_value;
    for (index, value) in point.state.iter().enumerate() {
        aug[index + 1] = *value;
    }
    Ok(aug)
}

fn coefficient_name(
    curve_type: Codim1CurveType,
    bifurcation_type: Codim2BifurcationType,
) -> &'static str {
    match (curve_type, bifurcation_type) {
        (Codim1CurveType::Fold, Codim2BifurcationType::Cusp) => "a",
        (Codim1CurveType::Hopf, Codim2BifurcationType::GeneralizedHopf) => "l1",
        (Codim1CurveType::LimitPointCycle, Codim2BifurcationType::CuspOfCycles) => {
            "quadratic_coefficient"
        }
        (Codim1CurveType::PeriodDoubling, Codim2BifurcationType::GeneralizedPeriodDoubling) => {
            "cubic_coefficient"
        }
        (Codim1CurveType::NeimarkSacker, Codim2BifurcationType::Chenciner) => {
            "first_lyapunov_coefficient"
        }
        (_, Codim2BifurcationType::BogdanovTakens) => "bt_test",
        (_, Codim2BifurcationType::ZeroHopf) => "zero_hopf_test",
        (_, Codim2BifurcationType::DoubleHopf) => "double_hopf_test",
        _ => "test_value",
    }
}

fn test_function_name(
    curve_type: Codim1CurveType,
    bifurcation_type: Codim2BifurcationType,
) -> &'static str {
    match (curve_type, bifurcation_type) {
        (Codim1CurveType::Fold, Codim2BifurcationType::Cusp) => "fold quadratic coefficient a",
        (Codim1CurveType::Hopf, Codim2BifurcationType::GeneralizedHopf) => {
            "first Lyapunov coefficient l1"
        }
        (Codim1CurveType::LimitPointCycle, Codim2BifurcationType::CuspOfCycles) => {
            "periodic return-map quadratic coefficient"
        }
        (Codim1CurveType::PeriodDoubling, Codim2BifurcationType::GeneralizedPeriodDoubling) => {
            "period-doubling cubic coefficient"
        }
        (Codim1CurveType::NeimarkSacker, Codim2BifurcationType::Chenciner) => {
            "Neimark-Sacker first Lyapunov coefficient"
        }
        (Codim1CurveType::LimitPointCycle, Codim2BifurcationType::FoldFlip)
        | (Codim1CurveType::PeriodDoubling, Codim2BifurcationType::FoldFlip) => {
            "secondary -1/+1 Floquet multiplier test"
        }
        (Codim1CurveType::LimitPointCycle, Codim2BifurcationType::FoldNeimarkSacker)
        | (Codim1CurveType::NeimarkSacker, Codim2BifurcationType::FoldNeimarkSacker) => {
            "secondary unit-pair/+1 Floquet test"
        }
        (Codim1CurveType::PeriodDoubling, Codim2BifurcationType::FlipNeimarkSacker)
        | (Codim1CurveType::NeimarkSacker, Codim2BifurcationType::FlipNeimarkSacker) => {
            "secondary unit-pair/-1 Floquet test"
        }
        (Codim1CurveType::NeimarkSacker, Codim2BifurcationType::DoubleNeimarkSacker) => {
            "secondary bialternate Floquet test"
        }
        (Codim1CurveType::NeimarkSacker, Codim2BifurcationType::Resonance1_1) => {
            "1:1 resonance angle test"
        }
        (Codim1CurveType::NeimarkSacker, Codim2BifurcationType::Resonance1_2) => {
            "1:2 resonance angle test"
        }
        (Codim1CurveType::NeimarkSacker, Codim2BifurcationType::Resonance1_3) => {
            "1:3 resonance angle test"
        }
        (Codim1CurveType::NeimarkSacker, Codim2BifurcationType::Resonance1_4) => {
            "1:4 resonance angle test"
        }
        (_, Codim2BifurcationType::BogdanovTakens) => "Bogdanov-Takens test",
        (_, Codim2BifurcationType::ZeroHopf) => "zero-Hopf test",
        (_, Codim2BifurcationType::DoubleHopf) => "double-Hopf test",
        _ => "codimension-two test",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::continuation::{
        BifurcationType, Codim1CurveType, Codim2BifurcationType, ContinuationPoint,
        ContinuationProblem, FoldCurveProblem, HopfCurveProblem, PointDiagnostics,
        TestFunctionValues,
    };
    use crate::equation_engine::{parse, Compiler, EquationSystem};
    use crate::equilibrium::SystemKind;
    use anyhow::Result;
    use nalgebra::{DMatrix, DVector};

    struct StraightCurve;

    struct TwoCrossings;

    struct CycleInteractionCurve {
        source: Codim1CurveType,
    }

    impl ContinuationProblem for StraightCurve {
        fn dimension(&self) -> usize {
            1
        }

        fn residual(&mut self, aug: &DVector<f64>, out: &mut DVector<f64>) -> Result<()> {
            out[0] = aug[1];
            Ok(())
        }

        fn extended_jacobian(&mut self, _aug: &DVector<f64>) -> Result<DMatrix<f64>> {
            Ok(DMatrix::from_row_slice(1, 2, &[0.0, 1.0]))
        }

        fn diagnostics(&mut self, _aug: &DVector<f64>) -> Result<PointDiagnostics> {
            Ok(PointDiagnostics {
                test_values: TestFunctionValues::equilibrium(1.0, 1.0, 1.0),
                eigenvalues: Vec::new(),
                cycle_points: None,
            })
        }
    }

    impl Codim2CurveProblem for StraightCurve {
        fn curve_type(&self) -> Codim1CurveType {
            Codim1CurveType::Fold
        }

        fn supported_codim2_types(&self) -> &'static [Codim2BifurcationType] {
            &[Codim2BifurcationType::Cusp]
        }

        fn codim2_tests_at(&mut self, aug: &DVector<f64>) -> Result<Codim2TestFunctions> {
            Ok(Codim2TestFunctions {
                cusp: aug[0],
                ..Default::default()
            })
        }
    }

    impl ContinuationProblem for TwoCrossings {
        fn dimension(&self) -> usize {
            1
        }

        fn residual(&mut self, aug: &DVector<f64>, out: &mut DVector<f64>) -> Result<()> {
            out[0] = aug[1];
            Ok(())
        }

        fn extended_jacobian(&mut self, _aug: &DVector<f64>) -> Result<DMatrix<f64>> {
            Ok(DMatrix::from_row_slice(1, 2, &[0.0, 1.0]))
        }

        fn diagnostics(&mut self, _aug: &DVector<f64>) -> Result<PointDiagnostics> {
            Ok(PointDiagnostics {
                test_values: TestFunctionValues::equilibrium(1.0, 1.0, 1.0),
                eigenvalues: Vec::new(),
                cycle_points: None,
            })
        }
    }

    impl Codim2CurveProblem for TwoCrossings {
        fn curve_type(&self) -> Codim1CurveType {
            Codim1CurveType::Hopf
        }

        fn supported_codim2_types(&self) -> &'static [Codim2BifurcationType] {
            &[
                Codim2BifurcationType::ZeroHopf,
                Codim2BifurcationType::DoubleHopf,
            ]
        }

        fn codim2_tests_at(&mut self, aug: &DVector<f64>) -> Result<Codim2TestFunctions> {
            Ok(Codim2TestFunctions {
                zero_hopf: aug[0],
                double_hopf: aug[0],
                ..Default::default()
            })
        }
    }

    impl ContinuationProblem for CycleInteractionCurve {
        fn dimension(&self) -> usize {
            1
        }

        fn residual(&mut self, aug: &DVector<f64>, out: &mut DVector<f64>) -> Result<()> {
            out[0] = aug[1] - aug[0] * aug[0];
            Ok(())
        }

        fn extended_jacobian(&mut self, aug: &DVector<f64>) -> Result<DMatrix<f64>> {
            Ok(DMatrix::from_row_slice(1, 2, &[-2.0 * aug[0], 1.0]))
        }

        fn diagnostics(&mut self, _aug: &DVector<f64>) -> Result<PointDiagnostics> {
            Ok(PointDiagnostics {
                test_values: TestFunctionValues::limit_cycle(1.0, 1.0, 1.0),
                eigenvalues: Vec::new(),
                cycle_points: None,
            })
        }
    }

    impl Codim2CurveProblem for CycleInteractionCurve {
        fn curve_type(&self) -> Codim1CurveType {
            self.source
        }

        fn supported_codim2_types(&self) -> &'static [Codim2BifurcationType] {
            match self.source {
                Codim1CurveType::LimitPointCycle => &[
                    Codim2BifurcationType::FoldFlip,
                    Codim2BifurcationType::FoldNeimarkSacker,
                ],
                Codim1CurveType::PeriodDoubling => &[
                    Codim2BifurcationType::FoldFlip,
                    Codim2BifurcationType::FlipNeimarkSacker,
                ],
                Codim1CurveType::NeimarkSacker => &[
                    Codim2BifurcationType::FoldNeimarkSacker,
                    Codim2BifurcationType::FlipNeimarkSacker,
                    Codim2BifurcationType::DoubleNeimarkSacker,
                    Codim2BifurcationType::Chenciner,
                    Codim2BifurcationType::Resonance1_1,
                    Codim2BifurcationType::Resonance1_2,
                    Codim2BifurcationType::Resonance1_3,
                    Codim2BifurcationType::Resonance1_4,
                ],
                _ => &[],
            }
        }

        fn codim2_tests_at(&mut self, aug: &DVector<f64>) -> Result<Codim2TestFunctions> {
            let value = aug[0];
            Ok(Codim2TestFunctions {
                fold_flip: value,
                fold_ns: value,
                flip_ns: value,
                double_ns: value,
                chenciner: value,
                resonance_1_1: value,
                resonance_1_2: value,
                resonance_1_3: value,
                resonance_1_4: value,
                ..Default::default()
            })
        }

        fn codim2_coefficients_at(
            &mut self,
            _aug: &DVector<f64>,
            _bifurcation_type: Codim2BifurcationType,
            test_value: f64,
        ) -> Result<Vec<Codim2Coefficient>> {
            Ok(vec![
                Codim2Coefficient {
                    name: "test_value".to_string(),
                    value: test_value,
                },
                Codim2Coefficient {
                    name: "secondary_unit_pair_cosine".to_string(),
                    value: 0.25,
                },
            ])
        }
    }

    fn point(param_value: f64) -> ContinuationPoint {
        ContinuationPoint {
            state: vec![0.0],
            param_value,
            stability: BifurcationType::None,
            eigenvalues: Vec::new(),
            cycle_points: None,
            homoclinic_events: None,
        }
    }

    fn cycle_point(param_value: f64) -> ContinuationPoint {
        ContinuationPoint {
            state: vec![param_value * param_value],
            param_value,
            stability: BifurcationType::None,
            eigenvalues: Vec::new(),
            cycle_points: None,
            homoclinic_events: None,
        }
    }

    fn equation_system(
        equations: &[&str],
        var_names: &[&str],
        param_names: &[&str],
        params: Vec<f64>,
    ) -> EquationSystem {
        let vars: Vec<String> = var_names.iter().map(|name| (*name).to_string()).collect();
        let names: Vec<String> = param_names.iter().map(|name| (*name).to_string()).collect();
        let compiler = Compiler::new(&vars, &names);
        let bytecode = equations
            .iter()
            .map(|equation| compiler.compile(&parse(equation).expect("parse equation")))
            .collect();
        EquationSystem::new(bytecode, params)
    }

    #[test]
    fn bracketed_refinement_returns_curve_corrected_zero_with_provenance() {
        let mut problem = StraightCurve;
        let events = refine_codim2_points(&mut problem, &[point(-1.0), point(1.0)], 8, 1e-9)
            .expect("refinement");

        assert_eq!(events.len(), 1);
        let event = &events[0];
        assert_eq!(event.replace_index, 1);
        assert_eq!(event.data.bifurcation_type, Codim2BifurcationType::Cusp);
        assert_eq!(event.data.source_segment, [0, 1]);
        assert!(event.data.refined);
        assert!(event.point.param_value.abs() < 1e-9);
        assert!(event.data.test_function_value.abs() < 1e-9);
        assert!(event.data.residual_norm < 1e-9);
    }

    #[test]
    fn one_segment_can_refine_every_supported_simultaneous_interaction() {
        let mut problem = TwoCrossings;
        let events = refine_codim2_points(&mut problem, &[point(-1.0), point(1.0)], 8, 1e-9)
            .expect("simultaneous refinement");
        let kinds = events
            .iter()
            .map(|event| event.data.bifurcation_type)
            .collect::<Vec<_>>();
        assert_eq!(
            kinds,
            vec![
                Codim2BifurcationType::ZeroHopf,
                Codim2BifurcationType::DoubleHopf,
            ]
        );
        assert!(events.iter().all(|event| event.data.refined));
    }

    #[test]
    fn cycle_interaction_matrix_has_signed_brackets_and_curve_corrected_roots() {
        let mut observed = Vec::new();
        for source in [
            Codim1CurveType::LimitPointCycle,
            Codim1CurveType::PeriodDoubling,
            Codim1CurveType::NeimarkSacker,
        ] {
            let mut problem = CycleInteractionCurve { source };
            let events = refine_codim2_points(
                &mut problem,
                &[cycle_point(-1.0), cycle_point(1.0)],
                8,
                1e-9,
            )
            .expect("cycle interaction matrix refinement");
            assert_eq!(events.len(), problem.supported_codim2_types().len());
            for event in events {
                observed.push((source, event.data.bifurcation_type));
                assert!(event.data.refined, "event={:?}", event.data);
                assert!(!event.data.candidate);
                assert_eq!(event.data.source_test_values, [-1.0, 1.0]);
                assert!(event.data.test_function_value.abs() < 1e-9);
                assert!(event.data.residual_norm < 1e-9);
                assert!(event.point.param_value.abs() < 1e-9);
                assert!(event.point.state[0].abs() < 1e-9);
                assert!(event
                    .data
                    .branch_switches
                    .iter()
                    .all(|switch| switch.available || switch.reason.as_deref().is_some()));
                if matches!(
                    event.data.bifurcation_type,
                    Codim2BifurcationType::Chenciner
                        | Codim2BifurcationType::Resonance1_1
                        | Codim2BifurcationType::Resonance1_2
                        | Codim2BifurcationType::Resonance1_3
                        | Codim2BifurcationType::Resonance1_4
                ) {
                    assert!(!event.data.certification.nondegeneracy_evaluated);
                    assert_eq!(event.data.certification.nondegenerate, None);
                    assert!(event
                        .data
                        .certification
                        .reason
                        .as_deref()
                        .is_some_and(|reason| {
                            reason.contains("BifurcationKit") && reason.contains("metadata-only")
                        }));
                }
            }
        }

        for kind in [
            Codim2BifurcationType::FoldFlip,
            Codim2BifurcationType::FoldNeimarkSacker,
            Codim2BifurcationType::FlipNeimarkSacker,
            Codim2BifurcationType::DoubleNeimarkSacker,
            Codim2BifurcationType::Chenciner,
            Codim2BifurcationType::Resonance1_1,
            Codim2BifurcationType::Resonance1_2,
            Codim2BifurcationType::Resonance1_3,
            Codim2BifurcationType::Resonance1_4,
        ] {
            assert!(observed
                .iter()
                .any(|(_, observed_kind)| *observed_kind == kind));
        }
    }

    #[test]
    fn cycle_intersection_switches_are_typed_and_nsns_keeps_the_second_angle() {
        let fold_flip = cycle_branch_switches(
            Codim1CurveType::LimitPointCycle,
            Codim2BifurcationType::FoldFlip,
            &[],
        );
        assert_eq!(fold_flip.len(), 1);
        assert_eq!(fold_flip[0].target, Codim1CurveType::PeriodDoubling);
        assert!(fold_flip[0].available);
        assert!(fold_flip[0].reason.is_none());

        let nsns = cycle_branch_switches(
            Codim1CurveType::NeimarkSacker,
            Codim2BifurcationType::DoubleNeimarkSacker,
            &[Codim2Coefficient {
                name: "secondary_unit_pair_cosine".to_string(),
                value: 0.25,
            }],
        );
        assert_eq!(nsns.len(), 1);
        assert!(nsns[0].available);
        assert_eq!(nsns[0].target, Codim1CurveType::NeimarkSacker);
        assert_eq!(nsns[0].target_auxiliary, Some(0.25));
    }

    #[test]
    fn unsupported_higher_order_switches_explain_why_they_are_unavailable() {
        for (source, kind) in [
            (
                Codim1CurveType::LimitPointCycle,
                Codim2BifurcationType::CuspOfCycles,
            ),
            (
                Codim1CurveType::PeriodDoubling,
                Codim2BifurcationType::GeneralizedPeriodDoubling,
            ),
            (
                Codim1CurveType::NeimarkSacker,
                Codim2BifurcationType::Chenciner,
            ),
            (
                Codim1CurveType::NeimarkSacker,
                Codim2BifurcationType::Resonance1_3,
            ),
        ] {
            let switches = cycle_branch_switches(source, kind, &[]);
            assert_eq!(switches.len(), 1);
            assert!(!switches[0].available);
            assert!(switches[0]
                .reason
                .as_deref()
                .is_some_and(|reason| !reason.is_empty()));
        }
    }

    #[test]
    fn refines_cubic_fold_to_nondegenerate_cusp() {
        let mut system =
            equation_system(&["x^3 + b*x + a"], &["x"], &["a", "b"], vec![-0.016, -0.12]);
        let mut problem = FoldCurveProblem::new(&mut system, SystemKind::Flow, &[-0.2], 0, 1)
            .expect("fold problem");
        let fold_point = |x: f64| ContinuationPoint {
            state: vec![-3.0 * x * x, x],
            param_value: 2.0 * x * x * x,
            stability: BifurcationType::None,
            eigenvalues: Vec::new(),
            cycle_points: None,
            homoclinic_events: None,
        };

        let events =
            refine_codim2_points(&mut problem, &[fold_point(-0.2), fold_point(0.2)], 12, 1e-7)
                .expect("cusp refinement");

        assert_eq!(events.len(), 1);
        let event = &events[0];
        assert_eq!(event.data.bifurcation_type, Codim2BifurcationType::Cusp);
        assert!(event.data.refined, "diagnostics: {:?}", event.data);
        assert!(!event.data.candidate);
        assert!(event.point.param_value.abs() < 1e-6);
        assert!(event.point.state[0].abs() < 1e-6);
        assert!(event.point.state[1].abs() < 1e-6);
        let cubic = event
            .data
            .coefficients
            .iter()
            .find(|coefficient| coefficient.name == "c")
            .expect("cubic coefficient");
        assert!((cubic.value - 1.0).abs() < 1e-4, "c={}", cubic.value);
    }

    #[test]
    fn refines_radial_hopf_to_nondegenerate_generalized_hopf() {
        let mut system = equation_system(
            &[
                "mu*x - y + beta*x*(x^2+y^2) + x*(x^2+y^2)^2",
                "x + mu*y + beta*y*(x^2+y^2) + y*(x^2+y^2)^2",
            ],
            &["x", "y"],
            &["mu", "beta"],
            vec![0.0, -1.0],
        );
        let mut problem =
            HopfCurveProblem::new(&mut system, SystemKind::Flow, &[0.0, 0.0], 1.0, 1, 0)
                .expect("Hopf problem");
        let hopf_point = |beta: f64| ContinuationPoint {
            state: vec![0.0, 0.0, 0.0, 1.0],
            param_value: beta,
            stability: BifurcationType::None,
            eigenvalues: Vec::new(),
            cycle_points: None,
            homoclinic_events: None,
        };

        let events =
            refine_codim2_points(&mut problem, &[hopf_point(-1.0), hopf_point(1.0)], 12, 1e-7)
                .expect("generalized Hopf refinement");

        assert_eq!(events.len(), 1);
        let event = &events[0];
        assert_eq!(
            event.data.bifurcation_type,
            Codim2BifurcationType::GeneralizedHopf
        );
        assert!(event.data.refined, "diagnostics: {:?}", event.data);
        assert!(!event.data.candidate, "diagnostics: {:?}", event.data);
        assert!(event.point.param_value.abs() < 1e-6);
        assert!(event.data.test_function_value.abs() < 1e-6);
        assert!(event
            .data
            .coefficients
            .iter()
            .any(|coefficient| coefficient.name == "l1"));
        let second = event
            .data
            .coefficients
            .iter()
            .find(|coefficient| coefficient.name == "l2")
            .expect("second Lyapunov coefficient");
        assert!((second.value - 4.0).abs() < 5e-2, "l2={}", second.value);
    }

    #[test]
    fn refines_bogdanov_takens_with_nondegenerate_coefficients() {
        let mut system = equation_system(
            &["y", "mu1 + mu2*y + x^2 + 2*x*y"],
            &["x", "y"],
            &["mu1", "mu2"],
            vec![0.0, -0.2],
        );
        let mut problem = FoldCurveProblem::new(&mut system, SystemKind::Flow, &[0.0, 0.0], 0, 1)
            .expect("fold problem");
        let fold_point = |mu2: f64| ContinuationPoint {
            state: vec![mu2, 0.0, 0.0],
            param_value: 0.0,
            stability: BifurcationType::None,
            eigenvalues: Vec::new(),
            cycle_points: None,
            homoclinic_events: None,
        };

        let events =
            refine_codim2_points(&mut problem, &[fold_point(-0.2), fold_point(0.2)], 12, 1e-7)
                .expect("Bogdanov-Takens refinement");
        let event = events
            .iter()
            .find(|event| event.data.bifurcation_type == Codim2BifurcationType::BogdanovTakens)
            .expect("Bogdanov-Takens event");
        assert!(event.data.refined, "diagnostics: {:?}", event.data);
        assert!(!event.data.candidate, "diagnostics: {:?}", event.data);
        let coefficient = |name: &str| {
            event
                .data
                .coefficients
                .iter()
                .find(|coefficient| coefficient.name == name)
                .map(|coefficient| coefficient.value)
                .expect("normal-form coefficient")
        };
        assert!((coefficient("a") - 1.0).abs() < 1e-4);
        assert!((coefficient("b") - 2.0).abs() < 1e-4);
    }
}
