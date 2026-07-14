use anyhow::Result;
use nalgebra::{DMatrix, DVector};
use num_complex::Complex;
use serde::{Deserialize, Serialize};

use super::homoclinic_events::HomoclinicEventDiagnostics;
use super::types::ContinuationPoint;
use super::{BifurcationType, BranchType};

/// Action requested by a continuation problem after a converged trial fails
/// its a-posteriori acceptance check.
///
/// Most problems keep the historical behavior of reducing the PALC step.
/// Discretized problems may instead replace their discretization, transfer the
/// accepted numerical frontier, and retry the same geometric step.  A hard
/// termination is reserved for a structured, problem-specific retry budget or
/// resolution cap; callers can retrieve the detailed reason from the problem.
#[derive(Debug, Clone)]
pub enum StepRejectionAction {
    ReduceStep,
    Refined {
        accepted_aug: DVector<f64>,
        accepted_tangent: DVector<f64>,
        branch_states: Vec<Vec<f64>>,
        branch_type: Option<BranchType>,
    },
    Terminate,
}

/// An augmented continuation state and its tangent, carried outside the active
/// frontier (for example the initial endpoint retained by a stepped runner).
/// Both vectors must be reparameterized together when a problem changes an
/// internal coordinate chart without changing its dimension.
#[derive(Debug, Clone)]
pub struct ReparameterizationSeed {
    pub aug_state: DVector<f64>,
    pub tangent: DVector<f64>,
}

/// Coordinate-equivalent continuation data returned after a converged point
/// triggers an internal chart change.
///
/// Unlike [`StepRejectionAction::Refined`], this action follows an accepted
/// corrector and does not retry the step.  It keeps the previous and current
/// endpoints, PALC direction, published history, and any retained endpoint
/// seeds in one coordinate chart before event localization begins.
#[derive(Debug, Clone)]
pub struct PostCorrectorReparameterization {
    pub previous_aug: DVector<f64>,
    pub corrected_aug: DVector<f64>,
    pub previous_tangent: DVector<f64>,
    pub branch_states: Vec<Vec<f64>>,
    pub active_seeds: Vec<ReparameterizationSeed>,
}

/// Generic diagnostics reported by a continuation problem at a given point.
#[derive(Debug, Clone)]
pub struct PointDiagnostics {
    pub test_values: TestFunctionValues,
    pub eigenvalues: Vec<Complex<f64>>,
    pub cycle_points: Option<Vec<Vec<f64>>>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct TestFunctionValues {
    pub fold: f64,
    pub branch_point: f64,
    pub hopf: f64,
    pub neutral_saddle: f64,
    pub cycle_fold: f64,
    pub period_doubling: f64,
    pub neimark_sacker: f64,
}

impl TestFunctionValues {
    pub fn equilibrium(fold: f64, hopf: f64, neutral_saddle: f64) -> Self {
        Self {
            fold,
            branch_point: 1.0,
            hopf,
            neutral_saddle,
            cycle_fold: 1.0,
            period_doubling: 1.0,
            neimark_sacker: 1.0,
        }
    }

    pub fn limit_cycle(cycle_fold: f64, period_doubling: f64, neimark_sacker: f64) -> Self {
        Self {
            fold: 1.0,
            branch_point: 1.0,
            hopf: 1.0,
            neutral_saddle: 1.0,
            cycle_fold,
            period_doubling,
            neimark_sacker,
        }
    }

    pub fn value_for(&self, kind: BifurcationType) -> f64 {
        match kind {
            BifurcationType::Fold => self.fold,
            BifurcationType::BranchPoint => self.branch_point,
            BifurcationType::Hopf => self.hopf,
            BifurcationType::NeutralSaddle => self.neutral_saddle,
            BifurcationType::CycleFold => self.cycle_fold,
            BifurcationType::PeriodDoubling => self.period_doubling,
            BifurcationType::NeimarkSacker => self.neimark_sacker,
            BifurcationType::None
            | BifurcationType::HomoclinicNeutralSaddle
            | BifurcationType::HomoclinicNeutralSaddleFocus
            | BifurcationType::HomoclinicNeutralBiFocus
            | BifurcationType::HomoclinicDoubleRealStable
            | BifurcationType::HomoclinicDoubleRealUnstable
            | BifurcationType::HomoclinicNeutrallyDivergentStable
            | BifurcationType::HomoclinicNeutrallyDivergentUnstable
            | BifurcationType::HomoclinicThreeLeadingStable
            | BifurcationType::HomoclinicThreeLeadingUnstable
            | BifurcationType::HomoclinicNonCentral
            | BifurcationType::HomoclinicShilnikovHopf
            | BifurcationType::HomoclinicBogdanovTakens
            | BifurcationType::HomoclinicOrbitFlipUnstable
            | BifurcationType::HomoclinicOrbitFlipStable => 0.0,
        }
    }

    pub fn is_finite(&self) -> bool {
        self.fold.is_finite()
            && self.branch_point.is_finite()
            && self.hopf.is_finite()
            && self.neutral_saddle.is_finite()
            && self.cycle_fold.is_finite()
            && self.period_doubling.is_finite()
            && self.neimark_sacker.is_finite()
    }
}

/// Core interface implemented by any system that can be continued via PALC.
pub trait ContinuationProblem {
    /// Number of state variables (excluding the continuation parameter).
    fn dimension(&self) -> usize;

    /// Evaluate the residual F(aug_state) and write into `out`.
    fn residual(&mut self, aug_state: &DVector<f64>, out: &mut DVector<f64>) -> Result<()>;

    /// Compute the extended Jacobian (derivative of F w.r.t. [p, x]).
    fn extended_jacobian(&mut self, aug_state: &DVector<f64>) -> Result<DMatrix<f64>>;

    /// Diagonal weights for the pseudo-arclength inner product on `[p, x]`.
    ///
    /// The default is the Euclidean metric. Discretized problems should override
    /// this with quadrature weights so that tangent normalization and corrector
    /// hyperplanes do not change when the mesh is refined. Every weight must be
    /// finite and strictly positive.
    fn palc_metric_weights(&self, _aug_state: &DVector<f64>) -> Result<DVector<f64>> {
        Ok(DVector::from_element(self.dimension() + 1, 1.0))
    }

    /// Return diagnostics (test functions, eigenvalues, etc.) for bifurcation detection.
    fn diagnostics(&mut self, aug_state: &DVector<f64>) -> Result<PointDiagnostics>;

    /// Return homoclinic special-point test functions when this problem
    /// represents a homoclinic orbit to a hyperbolic saddle.
    ///
    /// The continuation runner uses these diagnostics both to localize named
    /// events and to serialize the exact test values on corrected homoclinic
    /// points. Ordinary continuation problems return `None` and therefore do
    /// not acquire a problem-specific payload.
    fn homoclinic_event_diagnostics(
        &mut self,
        _aug_state: &DVector<f64>,
    ) -> Result<Option<HomoclinicEventDiagnostics>> {
        Ok(None)
    }

    /// Whether homoclinic special-point tests may bracket an event between the
    /// supplied seed and the first corrected continuation point.
    ///
    /// The default supports already-corrected seeds and synthetic problems.
    /// Homoclinic formulations initialized from approximate orbit profiles
    /// should return `false`: their first correction can change the event test
    /// functions discontinuously even though no event lies on the corrected
    /// branch.
    fn detect_homoclinic_events_from_initial_seed(&self) -> bool {
        true
    }

    /// Refine a candidate's semantic classification at its corrected location.
    ///
    /// The default keeps the detected test-function label. Discrete maps use
    /// this hook to distinguish a genuine branch point from a saddle-node;
    /// both have a simple `+1` multiplier and therefore share the same scalar
    /// localization test.
    fn classify_bifurcation(
        &mut self,
        _aug_state: &DVector<f64>,
        detected: BifurcationType,
    ) -> Result<BifurcationType> {
        Ok(detected)
    }

    /// Check whether a converged trial point is accurate enough to accept.
    ///
    /// Discretized problems can reject an under-resolved point here without
    /// aborting the continuation or mutating reference/gauge state. A rejected
    /// trial is retried with a smaller pseudo-arclength step.
    fn is_step_acceptable(&mut self, _aug_state: &DVector<f64>) -> Result<bool> {
        Ok(true)
    }

    /// Handle a converged trial rejected by [`Self::is_step_acceptable`].
    ///
    /// `accepted_aug` and `accepted_tangent` describe the last valid frontier;
    /// `branch_states` contains the packed state of every already-published
    /// point.  A dimension-changing refinement must transfer all three so a
    /// branch never mixes incompatible state layouts.
    fn handle_step_rejection(
        &mut self,
        _accepted_aug: &DVector<f64>,
        _accepted_tangent: &DVector<f64>,
        _rejected_aug: &DVector<f64>,
        _branch_states: &[Vec<f64>],
    ) -> Result<StepRejectionAction> {
        Ok(StepRejectionAction::ReduceStep)
    }

    /// Transfer externally held branch states after this problem changed its
    /// discretization. Extension workflows keep the original branch outside
    /// the inner continuation runner, so they invoke this hook before merging
    /// a resized extension.
    fn transfer_branch_states_to_current_discretization(
        &self,
        branch_states: &[Vec<f64>],
    ) -> Result<Vec<Vec<f64>>> {
        if branch_states
            .iter()
            .any(|state| state.len() != self.dimension())
        {
            anyhow::bail!("Continuation problem cannot transfer external branch-state layouts");
        }
        Ok(branch_states.to_vec())
    }

    /// Refresh derived payloads after a persisted point's packed state has
    /// been transferred to the problem's current discretization or coordinate
    /// chart.
    ///
    /// The default intentionally preserves every payload, because most
    /// continuation problems either do not transfer states or store no
    /// discretization-dependent point data. Problems whose rendered geometry
    /// is derived from the packed state should override this hook so the two
    /// representations cannot diverge after a transfer.
    fn refresh_persisted_point_after_state_transfer(
        &self,
        _point: &mut ContinuationPoint,
    ) -> Result<()> {
        Ok(())
    }

    /// Transfer externally retained endpoint seeds after any discretization or
    /// coordinate-chart changes performed by an inner extension run.
    fn transfer_endpoint_seeds_to_current_coordinates(
        &self,
        seeds: &[ReparameterizationSeed],
    ) -> Result<Vec<ReparameterizationSeed>> {
        let expected = self.dimension() + 1;
        if seeds
            .iter()
            .any(|seed| seed.aug_state.len() != expected || seed.tangent.len() != expected)
        {
            anyhow::bail!("Continuation problem cannot transfer external endpoint-seed layouts");
        }
        Ok(seeds.to_vec())
    }

    /// Optionally replace an internal coordinate chart after a converged trial.
    ///
    /// Implementations must prepare the complete change transactionally and
    /// mutate their chart only after every returned state and tangent has been
    /// transformed successfully.  The continuation runner invokes this hook
    /// before updating gauges, computing the new tangent, or localizing an
    /// event; it is never called from the bisection corrector.
    fn reparameterize_after_step(
        &mut self,
        _previous_aug: &DVector<f64>,
        _corrected_aug: &DVector<f64>,
        _previous_tangent: &DVector<f64>,
        _branch_states: &[Vec<f64>],
        _active_seeds: &[ReparameterizationSeed],
    ) -> Result<Option<PostCorrectorReparameterization>> {
        Ok(None)
    }

    /// Optional hook called after each successful continuation step.
    /// Used by some problems to update internal state (e.g., phase conditions for LCs).
    fn update_after_step(&mut self, _aug_state: &DVector<f64>) -> Result<()> {
        Ok(()) // Default no-op
    }
}
