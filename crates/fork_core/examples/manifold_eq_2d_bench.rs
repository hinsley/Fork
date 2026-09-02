//! Deterministic benchmark for 2D stable/unstable manifold computation of flow
//! equilibria (`continue_manifold_eq_2d` / `extend_manifold_eq_2d`).
//!
//! The binary runs a fixed set of workloads, times them (warmup + min of two
//! timed runs), and snapshots the resulting surface numerics. When baseline
//! snapshot files are present it compares against them and fails if the
//! structure or coordinates drift beyond tolerance, so any optimization that
//! changes results is rejected by the harness.
//!
//! Output contract (consumed by `autoresearch.sh`):
//!   METRIC manifold_eq_2d_seconds=<total timed seconds>
//!   METRIC <workload>_seconds=<timed seconds per workload>
//!   METRIC numerics_max_abs_diff=<max coordinate drift vs baseline>
//!   METRIC vertices_total=... / rings_total=...
//!   METRIC <workload>_exact_calls / <workload>_ode_time_s (diagnostic work
//!   counters: strict leaf samples and ODE time they integrated, accumulated
//!   over both timed runs)
//! Exit codes: 0 ok, 1 numerics/structure mismatch or missing baseline,
//! 2 computation failure.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

use fork_core::continuation::{
    continue_manifold_eq_2d, extend_manifold_eq_2d, leaf_event_counters, leaf_path_counters,
    leaf_phase_counters, leaf_prescan_counters, leaf_profile_counters, leaf_profile_reset,
    walk_diagnostics,
    ContinuationBranch, Manifold2DSettings, ManifoldGeometry, ManifoldStability,
    ManifoldTerminationCaps,
};
use fork_core::continuation::types::Manifold2DProfile;
use fork_core::equation_engine::{parse, Compiler, EquationSystem};

fn build_system(equations: &[&str], vars: &[&str], params: &[(&str, f64)]) -> EquationSystem {
    let var_names: Vec<String> = vars.iter().map(|name| (*name).to_string()).collect();
    let param_names: Vec<String> = params.iter().map(|(name, _)| (*name).to_string()).collect();
    let param_values: Vec<f64> = params.iter().map(|(_, value)| *value).collect();
    let compiler = Compiler::new(&var_names, &param_names);
    let mut bytecodes = Vec::new();
    for equation in equations {
        let expr = parse(equation).unwrap_or_else(|e| panic!("parse failed: {e}"));
        bytecodes.push(compiler.compile(&expr));
    }
    let mut system = EquationSystem::new(bytecodes, param_values);
    system.set_maps(compiler.param_map, compiler.var_map);
    system
}

struct SurfaceSnapshot {
    name: String,
    rings: usize,
    vertices: usize,
    triangles: usize,
    ring_points: Vec<usize>,
    values: Vec<f64>,
}

fn snapshot_surface(name: &str, branch: &ContinuationBranch) -> SurfaceSnapshot {
    let Some(ManifoldGeometry::Surface(surface)) = branch.manifold_geometry.as_ref() else {
        panic!("{name}: expected surface geometry");
    };
    let dim = surface.dim;
    if surface.vertices_flat.len() % dim != 0 {
        panic!(
            "{name}: vertex count {} not a multiple of dim {}",
            surface.vertices_flat.len(),
            dim
        );
    }
    let offsets: Vec<usize> = surface.ring_offsets.clone();
    let total = surface.vertices_flat.len() / dim;
    // The first vertex is the equilibrium center cap; ring i spans
    // [offsets[i], offsets[i+1]) with the last ring running to `total`.
    let mut ring_points = Vec::with_capacity(offsets.len());
    for (i, &start) in offsets.iter().enumerate() {
        let end = if i + 1 < offsets.len() { offsets[i + 1] } else { total };
        ring_points.push(end - start);
    }
    SurfaceSnapshot {
        name: name.to_string(),
        rings: offsets.len(),
        vertices: total,
        triangles: surface.triangles.len(),
        ring_points,
        values: surface.vertices_flat.clone(),
    }
}

fn format_snapshot(snap: &SurfaceSnapshot) -> String {
    let mut out = String::new();
    out.push_str(&format!("workload={}\n", snap.name));
    out.push_str(&format!("rings={}\n", snap.rings));
    out.push_str(&format!("vertices={}\n", snap.vertices));
    out.push_str(&format!("triangles={}\n", snap.triangles));
    out.push_str("ring_points=");
    for (i, count) in snap.ring_points.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str(&count.to_string());
    }
    out.push('\n');
    // Full-precision round-trip formatting: deterministic across runs.
    for value in &snap.values {
        out.push_str(&format!("{value}\n"));
    }
    out
}

fn parse_snapshot(text: &str) -> SurfaceSnapshot {
    let mut name = String::new();
    let mut rings = 0usize;
    let mut vertices = 0usize;
    let mut triangles = 0usize;
    let mut ring_points: Vec<usize> = Vec::new();
    let mut values: Vec<f64> = Vec::new();
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("workload=") {
            name = rest.to_string();
        } else if let Some(rest) = line.strip_prefix("rings=") {
            rings = rest.parse().expect("rings");
        } else if let Some(rest) = line.strip_prefix("vertices=") {
            vertices = rest.parse().expect("vertices");
        } else if let Some(rest) = line.strip_prefix("triangles=") {
            triangles = rest.parse().expect("triangles");
        } else if let Some(rest) = line.strip_prefix("ring_points=") {
            ring_points = rest.split(',').map(|p| p.parse().expect("ring point")).collect();
        } else if !line.is_empty() {
            values.push(line.parse().expect("vertex value"));
        }
    }
    SurfaceSnapshot { name, rings, vertices, triangles, ring_points, values }
}

fn compare_snapshots(current: &SurfaceSnapshot, baseline_dir: &Path) -> Result<f64, String> {
    let path = baseline_dir.join(format!("{}.txt", current.name));
    if !path.exists() {
        return Err(format!(
            "baseline snapshot missing at {} (run with MANIFOLD_BENCH_WRITE_BASELINE=1 to create it)",
            path.display()
        ));
    }
    let text = fs::read_to_string(&path)
        .map_err(|e| format!("cannot read {}: {e}", path.display()))?;
    let baseline = parse_snapshot(&text);
    if baseline.name != current.name {
        return Err(format!(
            "workload name mismatch: computed {} vs baseline {}",
            current.name, baseline.name
        ));
    }
    if (baseline.rings, baseline.vertices, baseline.triangles)
        != (current.rings, current.vertices, current.triangles)
    {
        return Err(format!(
            "structure mismatch for {}: rings {} vs {}, vertices {} vs {}, triangles {} vs {}",
            current.name,
            current.rings,
            baseline.rings,
            current.vertices,
            baseline.vertices,
            current.triangles,
            baseline.triangles
        ));
    }
    if baseline.ring_points != current.ring_points {
        return Err(format!(
            "ring point counts mismatch for {}: {:?} vs {:?}",
            current.name, current.ring_points, baseline.ring_points
        ));
    }
    let mut max_diff = 0.0_f64;
    for (a, b) in current.values.iter().zip(baseline.values.iter()) {
        let d = (a - b).abs();
        if d > max_diff {
            max_diff = d;
        }
    }
    Ok(max_diff)
}

/// Lorenz system stable 2D manifold at the origin using the production-tuned
/// Krauskopf-Osinga global profile, grown to a target radius and then
/// extended further through the resume path.
fn run_lorenz_stable() -> Result<SurfaceSnapshot, String> {
    let mut system = build_system(
        &["sigma*(y-x)", "x*(rho-z)-y", "x*y-beta*z"],
        &["x", "y", "z"],
        &[("sigma", 10.0), ("rho", 28.0), ("beta", 8.0 / 3.0)],
    );
    let settings = Manifold2DSettings {
        stability: ManifoldStability::Stable,
        profile: Some(Manifold2DProfile::LorenzGlobalKo),
        target_radius: 8.0,
        target_arclength: 20.0,
        caps: ManifoldTerminationCaps {
            max_rings: 60,
            max_vertices: 100_000,
            ..ManifoldTerminationCaps::default()
        },
        ..Manifold2DSettings::default()
    };
    let extend_settings = Manifold2DSettings {
        target_arclength: 2.0,
        ..settings.clone()
    };
    let branch = continue_manifold_eq_2d(&mut system, &[0.0, 0.0, 0.0], settings)
        .map_err(|e| format!("lorenz stable manifold failed: {e}"))?;
    // Extend the accepted surface by additional geodesic arclength through the
    // resume path (same hot loop, different entry state).
    let branch = extend_manifold_eq_2d(&mut system, branch, extend_settings)
        .map_err(|e| format!("lorenz stable manifold extension failed: {e}"))?;
    Ok(snapshot_surface("lorenz_stable", &branch))
}

/// Rössler system unstable 2D manifold at the origin (complex-pair
/// eigendirections), grown to a target radius. Covers the Unstable stability
/// path with oscillatory leaves on a nonlinear chaotic flow.
fn run_rossler_unstable() -> Result<SurfaceSnapshot, String> {
    let mut system = build_system(
        &["-y-z", "x+a*y", "b+z*(x-c)"],
        &["x", "y", "z"],
        &[("a", 0.2), ("b", 0.2), ("c", 5.7)],
    );
    let settings = Manifold2DSettings {
        stability: ManifoldStability::Unstable,
        initial_radius: 0.02,
        leaf_delta: 0.02,
        delta_min: 1e-4,
        ring_points: 16,
        min_spacing: 0.005,
        max_spacing: 0.05,
        alpha_min: 0.3,
        alpha_max: 0.4,
        delta_alpha_min: 0.1,
        delta_alpha_max: 1.0,
        integration_dt: 5e-3,
        target_radius: 0.4,
        target_arclength: 1.0,
        caps: ManifoldTerminationCaps {
            max_steps: 200,
            max_points: 400,
            max_rings: 64,
            max_vertices: 20_000,
            max_time: 8.0,
            ..ManifoldTerminationCaps::default()
        },
        ..Manifold2DSettings::default()
    };
    let branch = continue_manifold_eq_2d(&mut system, &[0.0, 0.0, 0.0], settings)
        .map_err(|e| format!("rossler unstable manifold failed: {e}"))?;
    Ok(snapshot_surface("rossler_unstable", &branch))
}

type Workload = fn() -> Result<SurfaceSnapshot, String>;

const WORKLOADS: &[(&str, Workload)] = &[
    ("lorenz_stable_seconds", run_lorenz_stable),
    ("rossler_unstable_seconds", run_rossler_unstable),
];

fn main() {
    let args: Vec<String> = env::args().collect();
    let baseline_dir = if let Some(i) = args.iter().position(|a| a == "--baselines") {
        PathBuf::from(args.get(i + 1).expect("--baselines needs a path"))
    } else if let Ok(dir) = env::var("MANIFOLD_BENCH_BASELINES") {
        PathBuf::from(dir)
    } else {
        // Default: baselines live next to this example in the source tree.
        let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        p.push("examples/baselines");
        p
    };
    let write_baseline = env::var("MANIFOLD_BENCH_WRITE_BASELINE").is_ok_and(|v| v == "1");
    let tolerance: f64 = env::var("MANIFOLD_BENCH_TOL")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(1e-7);

    if write_baseline {
        fs::create_dir_all(&baseline_dir).expect("create baseline dir");
    }

    let mut total_seconds = 0.0_f64;
    let mut max_diff = 0.0_f64;
    let mut vertices_total = 0usize;
    let mut rings_total = 0usize;
    let mut failures: Vec<String> = Vec::new();
    let mut compute_failed = false;

    for (metric_name, workload) in WORKLOADS {
        if std::env::var("FORK_MANIFOLD_PROFILE").is_ok() {
            eprintln!("WARMUP {metric_name}");
        }
        // Warmup run (untimed): stabilizes allocator arenas and page faults.
        match workload() {
            Ok(_) => {}
            Err(e) => {
                failures.push(format!("{metric_name}: warmup failed: {e}"));
                compute_failed = true;
                continue;
            }
        }
        // Counters accumulate over the two timed runs (identical each run, so
        // the total is a deterministic 2x per-run work measure).
        leaf_profile_reset();
        if std::env::var("FORK_MANIFOLD_PROFILE").is_ok() {
            eprintln!("TIMED {metric_name}");
        }
        let mut best = f64::INFINITY;
        let mut snapshot = None;
        for _ in 0..2 {
            let start = Instant::now();
            match workload() {
                Ok(snap) => {
                    best = best.min(start.elapsed().as_secs_f64());
                    snapshot = Some(snap);
                }
                Err(e) => {
                    failures.push(format!("{metric_name}: timed run failed: {e}"));
                    compute_failed = true;
                    break;
                }
            }
        }
        let Some(snapshot) = snapshot else { continue };

        if write_baseline {
            let path = baseline_dir.join(format!("{}.txt", snapshot.name));
            fs::write(&path, format_snapshot(&snapshot))
                .unwrap_or_else(|e| panic!("cannot write {}: {e}", path.display()));
            println!("wrote baseline {}", path.display());
        } else {
            match compare_snapshots(&snapshot, &baseline_dir) {
                Ok(diff) => max_diff = max_diff.max(diff),
                Err(msg) => {
                    failures.push(format!("{metric_name}: {msg}"));
                }
            }
        }

        vertices_total += snapshot.vertices;
        rings_total += snapshot.rings;
        total_seconds += best;
        println!("METRIC {metric_name}={best:.6}");
        let (exact_calls, ode_time_ns) = leaf_profile_counters();
        println!("METRIC {metric_name}_exact_calls={exact_calls}");
        println!(
            "METRIC {metric_name}_ode_time_s={:.6}",
            ode_time_ns as f64 / 1e9
        );
        let (phase_calls, phase_tsums) = leaf_phase_counters();
        for p in 0..4 {
            println!("METRIC {metric_name}_phase{p}_calls={}", phase_calls[p]);
            println!(
                "METRIC {metric_name}_phase{p}_ode_time_s={:.6}",
                phase_tsums[p]
            );
        }
        let path = leaf_path_counters();
        println!("METRIC {metric_name}_follow_attempts={}", path[0]);
        println!("METRIC {metric_name}_follow_ok={}", path[1]);
        println!("METRIC {metric_name}_follow_fail_shift={}", path[2]);
        println!("METRIC {metric_name}_follow_fail_backward={}", path[3]);
        println!("METRIC {metric_name}_follow_fail_other={}", path[4]);
        println!("METRIC {metric_name}_checkpoint_attempts={}", path[5]);
        println!("METRIC {metric_name}_checkpoint_ok={}", path[6]);
        println!("METRIC {metric_name}_checkpoint_dead_skips={}", path[7]);
        println!("METRIC {metric_name}_death_rebase_guard={}", path[8]);
        println!("METRIC {metric_name}_death_query_shift={}", path[9]);
        println!("METRIC {metric_name}_death_extend={}", path[10]);
        let (prescan, mode_calls, mode_t, mode_leaves) = leaf_prescan_counters();
        println!("METRIC {metric_name}_prescan_ok={}", prescan[0]);
        println!("METRIC {metric_name}_prescan_dead={}", prescan[1]);
        println!("METRIC {metric_name}_prescan_notime={}", prescan[2]);
        println!("METRIC {metric_name}_prescan_none={}", prescan[3]);
        for m in 0..3 {
            println!(
                "METRIC {metric_name}_mode{m}_leaves_ok_err={} {}",
                mode_leaves[m][0], mode_leaves[m][1]
            );
            println!(
                "METRIC {metric_name}_mode{m}_calls_ok_err={} {}",
                mode_calls[m][0], mode_calls[m][1]
            );
            println!(
                "METRIC {metric_name}_mode{m}_ode_s_ok_err={:.6} {:.6}",
                mode_t[m][0], mode_t[m][1]
            );
        }
        let (event_fails, event_ok_iters, event_fail_iters, guard_rejects, guard_t_us, guard_far_s) =
            leaf_event_counters();
        for (reason, name) in [
            ("radial", 0),
            ("det", 1),
            ("delta", 2),
            ("damping", 3),
            ("maxiters", 4),
            ("strict_err", 5),
        ] {
            println!("METRIC {metric_name}_event_fail_{reason}={}", event_fails[name]);
        }
        println!("METRIC {metric_name}_event_ok_iters_sum={}", event_ok_iters);
        println!("METRIC {metric_name}_event_fail_iters_sum={}", event_fail_iters);
        println!("METRIC {metric_name}_direct_guard_rejects={}", guard_rejects);
        println!("METRIC {metric_name}_direct_guard_far_s={}", guard_far_s);
        let (walk_jumps, walk_steps_sum, walk_brackets) = walk_diagnostics();
        println!("METRIC {metric_name}_walk_jumps={}", walk_jumps);
        println!(
            "METRIC {metric_name}_walk_avg_steps_to_bracket={:.2}",
            if walk_brackets > 0 {
                walk_steps_sum as f64 / walk_brackets as f64
            } else {
                f64::NAN
            }
        );
        if guard_rejects > 0 {
            println!(
                "METRIC {metric_name}_direct_guard_t_avg_s={:.6}",
                (guard_t_us as f64 / 1e6) / guard_rejects as f64
            );
        }
    }

    if !failures.is_empty() {
        for failure in &failures {
            eprintln!("FAIL: {failure}");
        }
        std::process::exit(if compute_failed { 2 } else { 1 });
    }

    println!("METRIC manifold_eq_2d_seconds={total_seconds:.6}");
    if !write_baseline {
        println!("METRIC numerics_max_abs_diff={max_diff:.3e}");
        if max_diff > tolerance {
            eprintln!(
                "FAIL: numerics drift {:.3e} exceeds tolerance {:.3e}",
                max_diff, tolerance
            );
            std::process::exit(1);
        }
    }
    println!("METRIC vertices_total={vertices_total}");
    println!("METRIC rings_total={rings_total}");
    if write_baseline {
        println!(
            "baseline mode: wrote {} snapshots to {}",
            WORKLOADS.len(),
            baseline_dir.display()
        );
    } else {
        println!(
            "ok: total {:.3}s, max numerics drift {:.3e} (tol {:.1e})",
            total_seconds, max_diff, tolerance
        );
    }
}
