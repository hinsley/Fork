use fork_core::transfer_eigenmodes::{
    RestartedArnoldiRunner, RestartedArnoldiSettings, SparseColumnMatrix, SparseEigenmodePhase,
    SparseEigenmodeProgress,
};
use serde::Serialize;
use serde_wasm_bindgen::to_value;
use wasm_bindgen::prelude::*;

const EIGENMODE_BATCH_SIZE: usize = 1;

#[derive(Serialize)]
struct Progress {
    done: bool,
    current_step: usize,
    max_steps: usize,
    points_computed: usize,
    bifurcations_found: usize,
    current_param: f64,
    phase: &'static str,
    batch_size_hint: usize,
    restart_count: usize,
    max_restarts: usize,
    subspace_dimension: usize,
    max_subspace_dimension: usize,
    converged_modes: usize,
    requested_modes: usize,
    residual: Option<f64>,
    tolerance: Option<f64>,
}

#[wasm_bindgen]
pub struct WasmTransferEigenmodeRunner {
    runner: RestartedArnoldiRunner,
}

#[wasm_bindgen]
impl WasmTransferEigenmodeRunner {
    #[wasm_bindgen(constructor)]
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        column_offsets: Vec<u32>,
        target_indices: Vec<u32>,
        probabilities: Vec<f64>,
        stationary_distribution: Vec<f64>,
        stationary_eigenvalue: f64,
        stationary_residual: f64,
        requested_modes: u32,
        tolerance: f64,
        max_restarts: u32,
        warm_start_real: Vec<f64>,
        warm_start_imaginary: Vec<f64>,
    ) -> Result<Self, JsValue> {
        let dimension = stationary_distribution.len();
        let column_offsets = column_offsets
            .into_iter()
            .map(|value| usize::try_from(value).map_err(|error| error.to_string()))
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| JsValue::from_str(&error))?;
        let target_indices = target_indices
            .into_iter()
            .map(|value| usize::try_from(value).map_err(|error| error.to_string()))
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| JsValue::from_str(&error))?;
        let operator =
            SparseColumnMatrix::new(dimension, column_offsets, target_indices, probabilities)
                .map_err(|error| JsValue::from_str(&error.to_string()))?;
        let settings = RestartedArnoldiSettings::bounded(
            dimension,
            requested_modes as usize,
            tolerance,
            max_restarts as usize,
        )
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
        let runner = RestartedArnoldiRunner::new(
            operator,
            stationary_distribution,
            stationary_eigenvalue,
            stationary_residual,
            settings,
            &warm_start_real,
            &warm_start_imaginary,
        )
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
        Ok(Self { runner })
    }

    pub fn run_steps(&mut self, batch_size: u32) -> Result<JsValue, JsValue> {
        self.runner
            .advance(batch_size.max(1) as usize)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        serialize_progress(self.runner.progress())
    }

    pub fn get_progress(&self) -> Result<JsValue, JsValue> {
        serialize_progress(self.runner.progress())
    }

    pub fn get_result(&self) -> Result<JsValue, JsValue> {
        let result = self
            .runner
            .result()
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        to_value(result).map_err(|error| JsValue::from_str(&error.to_string()))
    }
}

fn serialize_progress(progress: SparseEigenmodeProgress) -> Result<JsValue, JsValue> {
    let phase = match progress.phase {
        SparseEigenmodePhase::BuildingKrylov => "building_krylov",
        SparseEigenmodePhase::Restarting => "restarting_krylov",
        SparseEigenmodePhase::FinalizingModes => "finalizing_eigenmodes",
        SparseEigenmodePhase::Complete => "complete",
    };
    to_value(&Progress {
        done: progress.phase == SparseEigenmodePhase::Complete,
        current_step: progress.matrix_vector_products,
        max_steps: progress.max_matrix_vector_products,
        points_computed: progress.matrix_vector_products,
        bifurcations_found: 0,
        current_param: progress.best_residual.unwrap_or(0.0),
        phase,
        batch_size_hint: EIGENMODE_BATCH_SIZE,
        restart_count: progress.restart_count,
        max_restarts: progress.max_restarts,
        subspace_dimension: progress.subspace_dimension,
        max_subspace_dimension: progress.max_subspace_dimension,
        converged_modes: progress.converged_modes,
        requested_modes: progress.requested_modes,
        residual: progress.best_residual,
        tolerance: Some(progress.tolerance),
    })
    .map_err(|error| JsValue::from_str(&error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn progress_exposes_the_krylov_phase_and_bounded_batch() {
        let operator =
            SparseColumnMatrix::new(2, vec![0, 2, 4], vec![0, 1, 0, 1], vec![0.9, 0.1, 0.2, 0.8])
                .unwrap();
        let settings = RestartedArnoldiSettings::bounded(2, 1, 1.0e-10, 8).unwrap();
        let runner = RestartedArnoldiRunner::new(
            operator,
            vec![2.0 / 3.0, 1.0 / 3.0],
            1.0,
            0.0,
            settings,
            &[],
            &[],
        )
        .unwrap();

        let progress = runner.progress();
        assert_eq!(progress.phase, SparseEigenmodePhase::BuildingKrylov);
        assert_eq!(EIGENMODE_BATCH_SIZE, 1);
        assert!(progress.max_matrix_vector_products >= 1);
    }
}
