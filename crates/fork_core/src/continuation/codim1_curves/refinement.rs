use super::Codim2TestFunctions;
use crate::continuation::{
    BifurcationType, Codim1CurveType, Codim2BifurcationType, Codim2Coefficient, Codim2Conditioning,
    Codim2PointData, ContinuationPoint, ContinuationProblem,
};
use anyhow::{bail, Result};
use nalgebra::{DMatrix, DVector};

use super::{FoldCurveProblem, HopfCurveProblem};

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
        Codim1CurveType::Hopf
    }

    fn supported_codim2_types(&self) -> &'static [Codim2BifurcationType] {
        &[
            Codim2BifurcationType::BogdanovTakens,
            Codim2BifurcationType::ZeroHopf,
            Codim2BifurcationType::DoubleHopf,
            Codim2BifurcationType::GeneralizedHopf,
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
        if bifurcation_type != Codim2BifurcationType::GeneralizedHopf {
            return Ok(vec![Codim2Coefficient {
                name: coefficient_name(self.curve_type(), bifurcation_type).to_string(),
                value: test_value,
            }]);
        }
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
            _ => false,
        }
    }
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

        let detected = detect_supported_crossing(
            &prev_tests,
            &current_tests,
            problem.supported_codim2_types(),
            tolerance,
        );

        if let Some(bifurcation_type) = detected {
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

fn detect_supported_crossing(
    previous: &Codim2TestFunctions,
    current: &Codim2TestFunctions,
    supported: &[Codim2BifurcationType],
    tolerance: f64,
) -> Option<Codim2BifurcationType> {
    supported.iter().copied().find(|kind| {
        let left = previous.value_for(*kind);
        let right = current.value_for(*kind);
        if !left.is_finite() || !right.is_finite() {
            return false;
        }
        left * right < 0.0 || (right.abs() <= tolerance && left.abs() > tolerance)
    })
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
    let conditioning = refinement_conditioning(problem, &best_aug, &tangent, bifurcation_type)?;
    let coefficients = problem.codim2_coefficients_at(&best_aug, bifurcation_type, best_test)?;
    let candidate = problem.is_codim2_candidate(bifurcation_type, &coefficients);
    let refined = best_test.abs() <= tolerance && residual_norm <= tolerance * 10.0;

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
        coefficients,
        conditioning,
    };

    Ok(RefinedCodim2Event {
        replace_index: right_index,
        point,
        data,
    })
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
) -> Result<Codim2Conditioning> {
    let curve_jacobian = problem.extended_jacobian(aug)?;
    let bordered = append_row(&curve_jacobian, tangent)?;
    let gradient = codim2_test_gradient(problem, aug, bifurcation_type)?;
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

    fn point(param_value: f64) -> ContinuationPoint {
        ContinuationPoint {
            state: vec![0.0],
            param_value,
            stability: BifurcationType::None,
            eigenvalues: Vec::new(),
            cycle_points: None,
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
