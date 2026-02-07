use crate::equation_engine::{parse, Bytecode, Compiler, EquationSystem, Expr, VM};
use anyhow::{anyhow, bail, Result};
use marching_cubes::tables::{EDGE_TABLE, TRI_TABLE};
use serde::{Deserialize, Serialize};
use std::any::Any;
use std::cmp::Ordering;
use std::collections::HashSet;
use std::panic::{catch_unwind, AssertUnwindSafe};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct IsoclineAxisSpec {
    pub var_index: usize,
    pub min: f64,
    pub max: f64,
    pub samples: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "geometry", rename_all = "snake_case")]
pub enum IsoclineGeometry {
    Points {
        dim: usize,
        points: Vec<f64>,
    },
    Segments {
        dim: usize,
        points: Vec<f64>,
        segments: Vec<u32>,
    },
    Triangles {
        dim: usize,
        points: Vec<f64>,
        triangles: Vec<u32>,
    },
}

pub fn compile_scalar_expression(
    expression: &str,
    var_names: &[String],
    param_names: &[String],
) -> Result<Bytecode> {
    let parsed = parse(expression).map_err(|err| anyhow!(err))?;
    validate_expression_symbols(&parsed, var_names, param_names)?;
    let compiler = Compiler::new(var_names, param_names);
    let compiled = catch_unwind(AssertUnwindSafe(|| compiler.compile(&parsed)))
        .map_err(|payload| anyhow!(panic_payload_to_string(payload)))?;
    Ok(compiled)
}

pub fn compute_isocline(
    system: &EquationSystem,
    scalar_expr: &Bytecode,
    level: f64,
    axes: &[IsoclineAxisSpec],
    frozen_state: &[f64],
) -> Result<IsoclineGeometry> {
    if !level.is_finite() {
        bail!("Isocline level must be finite.");
    }
    let dim = system.equations.len();
    if dim == 0 {
        bail!("System dimension must be positive.");
    }
    if frozen_state.len() != dim {
        bail!(
            "Frozen state length ({}) does not match system dimension ({}).",
            frozen_state.len(),
            dim
        );
    }
    if axes.is_empty() || axes.len() > 3 {
        bail!("Isocline requires 1 to 3 active variables.");
    }

    let mut seen = HashSet::new();
    for axis in axes {
        if axis.var_index >= dim {
            bail!("Axis variable index {} out of range.", axis.var_index);
        }
        if !seen.insert(axis.var_index) {
            bail!("Axis variable indices must be unique.");
        }
        if !axis.min.is_finite() || !axis.max.is_finite() || axis.max <= axis.min {
            bail!("Each axis range must be finite with max > min.");
        }
        if axis.samples < 2 {
            bail!("Each axis needs at least 2 samples.");
        }
    }

    match axes.len() {
        1 => compute_isocline_points(system, scalar_expr, level, &axes[0], frozen_state),
        2 => compute_isocline_segments(system, scalar_expr, level, axes, frozen_state),
        3 => compute_isocline_triangles(system, scalar_expr, level, axes, frozen_state),
        _ => unreachable!(),
    }
}

fn panic_payload_to_string(payload: Box<dyn Any + Send>) -> String {
    if let Some(message) = payload.downcast_ref::<String>() {
        return message.clone();
    }
    if let Some(message) = payload.downcast_ref::<&str>() {
        return (*message).to_string();
    }
    "Expression compilation failed.".to_string()
}

fn evaluate_isocline_value(
    system: &EquationSystem,
    scalar_expr: &Bytecode,
    state: &[f64],
    stack: &mut Vec<f64>,
) -> f64 {
    VM::execute(scalar_expr, state, &system.params, stack)
}

fn validate_expression_symbols(
    expr: &Expr,
    var_names: &[String],
    param_names: &[String],
) -> Result<()> {
    let vars: HashSet<&str> = var_names.iter().map(String::as_str).collect();
    let params: HashSet<&str> = param_names.iter().map(String::as_str).collect();
    validate_expression_symbols_recursive(expr, &vars, &params)
}

fn validate_expression_symbols_recursive(
    expr: &Expr,
    vars: &HashSet<&str>,
    params: &HashSet<&str>,
) -> Result<()> {
    match expr {
        Expr::Number(_) => Ok(()),
        Expr::Variable(name) => {
            if vars.contains(name.as_str()) || params.contains(name.as_str()) {
                Ok(())
            } else {
                bail!("Unknown variable or parameter: {name}")
            }
        }
        Expr::Binary(left, _, right) => {
            validate_expression_symbols_recursive(left, vars, params)?;
            validate_expression_symbols_recursive(right, vars, params)
        }
        Expr::Unary(_, operand) => validate_expression_symbols_recursive(operand, vars, params),
        Expr::Call(func, arg) => {
            const KNOWN_FUNCTIONS: &[&str] = &[
                "sin", "cos", "tan", "exp", "log", "ln", "sinh", "cosh", "tanh", "sec", "csc",
                "cot", "sech", "csch", "coth",
            ];
            if !KNOWN_FUNCTIONS.contains(&func.as_str()) {
                bail!("Unknown function: {func}");
            }
            validate_expression_symbols_recursive(arg, vars, params)
        }
    }
}

fn compute_isocline_points(
    system: &EquationSystem,
    scalar_expr: &Bytecode,
    level: f64,
    axis: &IsoclineAxisSpec,
    frozen_state: &[f64],
) -> Result<IsoclineGeometry> {
    let dim = frozen_state.len();
    let mut state = frozen_state.to_vec();
    let mut stack = Vec::with_capacity(64);
    let sample_count = axis.samples.max(2);
    let denom = (sample_count - 1) as f64;
    let step = (axis.max - axis.min) / denom;
    let mut values = Vec::with_capacity(sample_count);
    for i in 0..sample_count {
        let x = axis.min + step * i as f64;
        state[axis.var_index] = x;
        values.push(evaluate_isocline_value(system, scalar_expr, &state, &mut stack) - level);
    }

    let mut roots = Vec::new();
    let zero_eps = 1e-10;
    for i in 0..sample_count.saturating_sub(1) {
        let x0 = axis.min + step * i as f64;
        let x1 = axis.min + step * (i + 1) as f64;
        let v0 = values[i];
        let v1 = values[i + 1];
        if v0.abs() <= zero_eps {
            roots.push(x0);
        }
        if v1.abs() <= zero_eps {
            roots.push(x1);
        }
        if (v0 < 0.0 && v1 > 0.0) || (v0 > 0.0 && v1 < 0.0) {
            let t = interpolate_factor(v0, v1);
            roots.push(x0 + (x1 - x0) * t);
        }
    }
    if roots.is_empty() {
        return Ok(IsoclineGeometry::Points {
            dim,
            points: Vec::new(),
        });
    }

    roots.sort_by(|a, b| a.partial_cmp(b).unwrap_or(Ordering::Equal));
    roots.dedup_by(|a, b| (*a - *b).abs() <= 1e-8 * (1.0 + a.abs().max(b.abs())));

    let mut points = Vec::with_capacity(roots.len() * dim);
    for root in roots {
        let mut root_state = frozen_state.to_vec();
        root_state[axis.var_index] = root;
        points.extend(root_state);
    }

    Ok(IsoclineGeometry::Points { dim, points })
}

fn compute_isocline_segments(
    system: &EquationSystem,
    scalar_expr: &Bytecode,
    level: f64,
    axes: &[IsoclineAxisSpec],
    frozen_state: &[f64],
) -> Result<IsoclineGeometry> {
    let dim = frozen_state.len();
    let axis_x = &axes[0];
    let axis_y = &axes[1];
    let nx = axis_x.samples.max(2);
    let ny = axis_y.samples.max(2);
    let step_x = (axis_x.max - axis_x.min) / (nx.saturating_sub(1) as f64);
    let step_y = (axis_y.max - axis_y.min) / (ny.saturating_sub(1) as f64);
    let index = |ix: usize, iy: usize| -> usize { ix + iy * nx };
    let mut values = vec![0.0; nx * ny];
    let mut stack = Vec::with_capacity(64);
    let mut state = frozen_state.to_vec();

    for iy in 0..ny {
        let y = axis_y.min + step_y * iy as f64;
        for ix in 0..nx {
            let x = axis_x.min + step_x * ix as f64;
            state[axis_x.var_index] = x;
            state[axis_y.var_index] = y;
            values[index(ix, iy)] =
                evaluate_isocline_value(system, scalar_expr, &state, &mut stack) - level;
        }
    }

    let mut points = Vec::new();
    let mut segments = Vec::new();
    let mut point_count = 0u32;
    for iy in 0..ny.saturating_sub(1) {
        let y0 = axis_y.min + step_y * iy as f64;
        let y1 = axis_y.min + step_y * (iy + 1) as f64;
        for ix in 0..nx.saturating_sub(1) {
            let x0 = axis_x.min + step_x * ix as f64;
            let x1 = axis_x.min + step_x * (ix + 1) as f64;
            let v0 = values[index(ix, iy)];
            let v1 = values[index(ix + 1, iy)];
            let v2 = values[index(ix + 1, iy + 1)];
            let v3 = values[index(ix, iy + 1)];

            let mut case_index = 0u8;
            if v0 >= 0.0 {
                case_index |= 1;
            }
            if v1 >= 0.0 {
                case_index |= 2;
            }
            if v2 >= 0.0 {
                case_index |= 4;
            }
            if v3 >= 0.0 {
                case_index |= 8;
            }
            let edge_pairs = marching_squares_edge_pairs(case_index);
            if edge_pairs.is_empty() {
                continue;
            }

            for (edge_a, edge_b) in edge_pairs {
                let (ax, ay) = interpolate_square_edge(*edge_a, x0, x1, y0, y1, v0, v1, v2, v3);
                let (bx, by) = interpolate_square_edge(*edge_b, x0, x1, y0, y1, v0, v1, v2, v3);
                let mut state_a = frozen_state.to_vec();
                state_a[axis_x.var_index] = ax;
                state_a[axis_y.var_index] = ay;
                let mut state_b = frozen_state.to_vec();
                state_b[axis_x.var_index] = bx;
                state_b[axis_y.var_index] = by;
                points.extend(state_a);
                points.extend(state_b);
                segments.push(point_count);
                segments.push(point_count + 1);
                point_count += 2;
            }
        }
    }

    Ok(IsoclineGeometry::Segments {
        dim,
        points,
        segments,
    })
}

fn marching_squares_edge_pairs(case_index: u8) -> &'static [(u8, u8)] {
    match case_index {
        0 | 15 => &[],
        1 => &[(3, 0)],
        2 => &[(0, 1)],
        3 => &[(3, 1)],
        4 => &[(1, 2)],
        5 => &[(3, 2), (0, 1)],
        6 => &[(0, 2)],
        7 => &[(3, 2)],
        8 => &[(2, 3)],
        9 => &[(0, 2)],
        10 => &[(0, 3), (1, 2)],
        11 => &[(1, 2)],
        12 => &[(1, 3)],
        13 => &[(0, 1)],
        14 => &[(3, 0)],
        _ => &[],
    }
}

fn interpolate_square_edge(
    edge: u8,
    x0: f64,
    x1: f64,
    y0: f64,
    y1: f64,
    v0: f64,
    v1: f64,
    v2: f64,
    v3: f64,
) -> (f64, f64) {
    match edge {
        0 => {
            let t = interpolate_factor(v0, v1);
            (x0 + (x1 - x0) * t, y0)
        }
        1 => {
            let t = interpolate_factor(v1, v2);
            (x1, y0 + (y1 - y0) * t)
        }
        2 => {
            let t = interpolate_factor(v2, v3);
            (x1 + (x0 - x1) * t, y1)
        }
        3 => {
            let t = interpolate_factor(v3, v0);
            (x0, y1 + (y0 - y1) * t)
        }
        _ => (x0, y0),
    }
}

const CUBE_EDGE_CORNERS: [(usize, usize); 12] = [
    (0, 1),
    (1, 2),
    (2, 3),
    (3, 0),
    (4, 5),
    (5, 6),
    (6, 7),
    (7, 4),
    (0, 4),
    (1, 5),
    (2, 6),
    (3, 7),
];

fn compute_isocline_triangles(
    system: &EquationSystem,
    scalar_expr: &Bytecode,
    level: f64,
    axes: &[IsoclineAxisSpec],
    frozen_state: &[f64],
) -> Result<IsoclineGeometry> {
    let dim = frozen_state.len();
    let axis_x = &axes[0];
    let axis_y = &axes[1];
    let axis_z = &axes[2];
    let nx = axis_x.samples.max(2);
    let ny = axis_y.samples.max(2);
    let nz = axis_z.samples.max(2);
    let step_x = (axis_x.max - axis_x.min) / (nx.saturating_sub(1) as f64);
    let step_y = (axis_y.max - axis_y.min) / (ny.saturating_sub(1) as f64);
    let step_z = (axis_z.max - axis_z.min) / (nz.saturating_sub(1) as f64);
    let index = |ix: usize, iy: usize, iz: usize| -> usize { ix + iy * nx + iz * nx * ny };

    let mut values = vec![0.0; nx * ny * nz];
    let mut stack = Vec::with_capacity(64);
    let mut state = frozen_state.to_vec();
    for iz in 0..nz {
        let z = axis_z.min + step_z * iz as f64;
        for iy in 0..ny {
            let y = axis_y.min + step_y * iy as f64;
            for ix in 0..nx {
                let x = axis_x.min + step_x * ix as f64;
                state[axis_x.var_index] = x;
                state[axis_y.var_index] = y;
                state[axis_z.var_index] = z;
                values[index(ix, iy, iz)] =
                    evaluate_isocline_value(system, scalar_expr, &state, &mut stack) - level;
            }
        }
    }

    let mut points = Vec::new();
    let mut triangles = Vec::new();
    let mut vertex_count = 0u32;
    for iz in 0..nz.saturating_sub(1) {
        let z0 = axis_z.min + step_z * iz as f64;
        let z1 = axis_z.min + step_z * (iz + 1) as f64;
        for iy in 0..ny.saturating_sub(1) {
            let y0 = axis_y.min + step_y * iy as f64;
            let y1 = axis_y.min + step_y * (iy + 1) as f64;
            for ix in 0..nx.saturating_sub(1) {
                let x0 = axis_x.min + step_x * ix as f64;
                let x1 = axis_x.min + step_x * (ix + 1) as f64;
                let corner_points = [
                    (x0, y0, z0),
                    (x1, y0, z0),
                    (x1, y1, z0),
                    (x0, y1, z0),
                    (x0, y0, z1),
                    (x1, y0, z1),
                    (x1, y1, z1),
                    (x0, y1, z1),
                ];
                let corner_values = [
                    values[index(ix, iy, iz)],
                    values[index(ix + 1, iy, iz)],
                    values[index(ix + 1, iy + 1, iz)],
                    values[index(ix, iy + 1, iz)],
                    values[index(ix, iy, iz + 1)],
                    values[index(ix + 1, iy, iz + 1)],
                    values[index(ix + 1, iy + 1, iz + 1)],
                    values[index(ix, iy + 1, iz + 1)],
                ];

                let mut cube_index = 0usize;
                for (corner, value) in corner_values.iter().enumerate() {
                    if *value < 0.0 {
                        cube_index |= 1 << corner;
                    }
                }
                let edge_mask = EDGE_TABLE[cube_index] as i32;
                if edge_mask == 0 {
                    continue;
                }

                let mut edge_vertices = [(0.0, 0.0, 0.0); 12];
                for edge in 0..12usize {
                    if (edge_mask & (1 << edge)) == 0 {
                        continue;
                    }
                    let (ca, cb) = CUBE_EDGE_CORNERS[edge];
                    let (ax, ay, az) = corner_points[ca];
                    let (bx, by, bz) = corner_points[cb];
                    let t = interpolate_factor(corner_values[ca], corner_values[cb]);
                    edge_vertices[edge] =
                        (ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t);
                }

                let tri_row = TRI_TABLE[cube_index];
                let mut tri_offset = 0usize;
                while tri_offset + 2 < tri_row.len() && tri_row[tri_offset] != -1 {
                    let e0 = tri_row[tri_offset] as usize;
                    let e1 = tri_row[tri_offset + 1] as usize;
                    let e2 = tri_row[tri_offset + 2] as usize;
                    let v0 = edge_vertices[e0];
                    let v1 = edge_vertices[e1];
                    let v2 = edge_vertices[e2];
                    let mut state0 = frozen_state.to_vec();
                    state0[axis_x.var_index] = v0.0;
                    state0[axis_y.var_index] = v0.1;
                    state0[axis_z.var_index] = v0.2;
                    let mut state1 = frozen_state.to_vec();
                    state1[axis_x.var_index] = v1.0;
                    state1[axis_y.var_index] = v1.1;
                    state1[axis_z.var_index] = v1.2;
                    let mut state2 = frozen_state.to_vec();
                    state2[axis_x.var_index] = v2.0;
                    state2[axis_y.var_index] = v2.1;
                    state2[axis_z.var_index] = v2.2;

                    points.extend(state0);
                    points.extend(state1);
                    points.extend(state2);
                    triangles.push(vertex_count);
                    triangles.push(vertex_count + 1);
                    triangles.push(vertex_count + 2);
                    vertex_count += 3;
                    tri_offset += 3;
                }
            }
        }
    }

    Ok(IsoclineGeometry::Triangles {
        dim,
        points,
        triangles,
    })
}

fn interpolate_factor(v0: f64, v1: f64) -> f64 {
    let denominator = v0 - v1;
    if denominator.abs() <= 1e-12 {
        0.5
    } else {
        (v0 / denominator).clamp(0.0, 1.0)
    }
}

#[cfg(test)]
mod tests {
    use super::{compile_scalar_expression, compute_isocline, IsoclineAxisSpec, IsoclineGeometry};
    use crate::equation_engine::{parse, Compiler, EquationSystem};

    fn build_system_for_test(
        equations: Vec<String>,
        params: Vec<f64>,
        var_names: &[String],
        param_names: &[String],
    ) -> EquationSystem {
        let compiler = Compiler::new(var_names, param_names);
        let bytecodes = equations
            .iter()
            .map(|eq| {
                let expr = parse(eq).expect("equation should parse");
                compiler.compile(&expr)
            })
            .collect();
        let mut system = EquationSystem::new(bytecodes, params);
        system.set_maps(compiler.param_map, compiler.var_map);
        system
    }

    fn flatten_state(points: &[f64], dim: usize, index: usize) -> &[f64] {
        let start = index * dim;
        let end = start + dim;
        &points[start..end]
    }

    #[test]
    fn compile_scalar_expression_rejects_unknown_symbols() {
        let var_names = vec!["x".to_string()];
        let param_names = vec!["a".to_string()];
        let err = compile_scalar_expression("x + missing", &var_names, &param_names)
            .expect_err("unknown symbol should fail");
        assert!(
            err.to_string().to_lowercase().contains("unknown"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn compute_isocline_1d_returns_points() {
        let var_names = vec!["x".to_string()];
        let param_names: Vec<String> = vec![];
        let system = build_system_for_test(vec!["x".to_string()], vec![], &var_names, &param_names);
        let scalar = compile_scalar_expression("x", &var_names, &param_names)
            .expect("expression should compile");
        let geometry = compute_isocline(
            &system,
            &scalar,
            0.0,
            &[IsoclineAxisSpec {
                var_index: 0,
                min: -1.0,
                max: 1.0,
                samples: 33,
            }],
            &[0.0],
        )
        .expect("isocline should compute");

        match geometry {
            IsoclineGeometry::Points { dim, points } => {
                assert_eq!(dim, 1);
                assert!(!points.is_empty(), "expected at least one root point");
                let root = points[0];
                assert!(root.abs() < 1e-6, "expected root near zero, got {root}");
            }
            other => panic!("expected points geometry, got {other:?}"),
        }
    }

    #[test]
    fn compute_isocline_2d_returns_segments() {
        let var_names = vec!["x".to_string(), "y".to_string()];
        let param_names: Vec<String> = vec![];
        let system = build_system_for_test(
            vec!["x".to_string(), "y".to_string()],
            vec![],
            &var_names,
            &param_names,
        );
        let scalar = compile_scalar_expression("x + y", &var_names, &param_names)
            .expect("expression should compile");
        let geometry = compute_isocline(
            &system,
            &scalar,
            0.0,
            &[
                IsoclineAxisSpec {
                    var_index: 0,
                    min: -1.0,
                    max: 1.0,
                    samples: 25,
                },
                IsoclineAxisSpec {
                    var_index: 1,
                    min: -1.0,
                    max: 1.0,
                    samples: 25,
                },
            ],
            &[0.0, 0.0],
        )
        .expect("isocline should compute");

        match geometry {
            IsoclineGeometry::Segments {
                dim,
                points,
                segments,
            } => {
                assert_eq!(dim, 2);
                assert!(!segments.is_empty(), "expected at least one segment");
                assert!(segments.len() % 2 == 0);
                assert!(
                    points.len() >= dim * 2,
                    "expected at least two vertices for one segment"
                );
            }
            other => panic!("expected segments geometry, got {other:?}"),
        }
    }

    #[test]
    fn compute_isocline_3d_returns_triangles() {
        let var_names = vec!["x".to_string(), "y".to_string(), "z".to_string()];
        let param_names: Vec<String> = vec![];
        let system = build_system_for_test(
            vec!["x".to_string(), "y".to_string(), "z".to_string()],
            vec![],
            &var_names,
            &param_names,
        );
        let scalar = compile_scalar_expression("x + y + z", &var_names, &param_names)
            .expect("expression should compile");
        let geometry = compute_isocline(
            &system,
            &scalar,
            0.0,
            &[
                IsoclineAxisSpec {
                    var_index: 0,
                    min: -1.0,
                    max: 1.0,
                    samples: 16,
                },
                IsoclineAxisSpec {
                    var_index: 1,
                    min: -1.0,
                    max: 1.0,
                    samples: 16,
                },
                IsoclineAxisSpec {
                    var_index: 2,
                    min: -1.0,
                    max: 1.0,
                    samples: 16,
                },
            ],
            &[0.0, 0.0, 0.0],
        )
        .expect("isocline should compute");

        match geometry {
            IsoclineGeometry::Triangles {
                dim,
                points,
                triangles,
            } => {
                assert_eq!(dim, 3);
                assert!(!triangles.is_empty(), "expected at least one triangle");
                assert!(triangles.len() % 3 == 0);
                assert!(!points.is_empty(), "expected at least one vertex");
            }
            other => panic!("expected triangles geometry, got {other:?}"),
        }
    }

    #[test]
    fn compute_isocline_with_frozen_coordinate_uses_frozen_value() {
        let var_names = vec!["x".to_string(), "y".to_string(), "z".to_string()];
        let param_names: Vec<String> = vec![];
        let system = build_system_for_test(
            vec!["x".to_string(), "y".to_string(), "z".to_string()],
            vec![],
            &var_names,
            &param_names,
        );
        let scalar = compile_scalar_expression("x + y + z", &var_names, &param_names)
            .expect("expression should compile");
        let geometry = compute_isocline(
            &system,
            &scalar,
            0.0,
            &[
                IsoclineAxisSpec {
                    var_index: 0,
                    min: -1.0,
                    max: 1.0,
                    samples: 16,
                },
                IsoclineAxisSpec {
                    var_index: 1,
                    min: -1.0,
                    max: 1.0,
                    samples: 16,
                },
            ],
            &[0.0, 0.0, 0.5],
        )
        .expect("isocline should compute");

        match geometry {
            IsoclineGeometry::Segments { dim, points, .. } => {
                assert_eq!(dim, 3);
                assert!(!points.is_empty(), "expected geometry points");
                let first = flatten_state(&points, dim, 0);
                assert!(
                    (first[2] - 0.5).abs() < 1e-8,
                    "frozen z should remain 0.5, got {}",
                    first[2]
                );
            }
            other => panic!("expected segments geometry, got {other:?}"),
        }
    }
}
