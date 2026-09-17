use serde::{Deserialize, Serialize};

/// A concise numerical failure report shared by errors and accepted partial results.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct CalculationDiagnostic {
    pub kind: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub suggestion: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub iterations: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_iterations: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub residual_norm: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tolerance: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub step_size: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_step_size: Option<f64>,
}

impl CalculationDiagnostic {
    pub fn new(kind: &str, message: &str, suggestion: &str) -> Self {
        Self { kind: kind.into(), message: message.into(), suggestion: Some(suggestion.into()), ..Self::default() }
    }

    pub fn numerical(kind: &str, operation: &str, iterations: usize, max_iterations: usize, residual: f64, tolerance: f64) -> Self {
        let (reason, suggestion) = match kind {
            "singular_jacobian" => ("Jacobian is singular", "Choose a nearby seed and check equation or variable scaling."),
            "nonfinite" => ("Evaluation became non-finite", "Check the equation domain and use a seed away from singularities."),
            "stalled" => ("Correction stalled above tolerance", "Improve the seed or variable scaling before increasing correction iterations."),
            _ => ("Iteration limit reached", "Use a closer seed or increase the iteration limit if the residual is decreasing."),
        };
        let mut report = Self::new(kind, &format!("{operation}: {reason}."), suggestion);
        report.iterations = Some(iterations);
        report.max_iterations = Some(max_iterations);
        report.residual_norm = residual.is_finite().then_some(residual);
        report.tolerance = tolerance.is_finite().then_some(tolerance);
        report
    }

    pub fn at_step(mut self, step: f64, minimum: f64) -> Self {
        self.step_size = step.is_finite().then_some(step);
        self.min_step_size = minimum.is_finite().then_some(minimum);
        self
    }
}

impl std::fmt::Display for CalculationDiagnostic {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)?;
        if let Some(suggestion) = &self.suggestion { write!(f, " {suggestion}")?; }
        Ok(())
    }
}
impl std::error::Error for CalculationDiagnostic {}
