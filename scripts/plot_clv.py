#!/usr/bin/env python3
"""
Visualize Covariant Lyapunov Vectors saved by the Fork CLI.

Usage:
    python plot_clv.py            # assumes repo layout: data/systems/...
    python plot_clv.py --root /path/to/data/systems
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any, Dict, List, Tuple

import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
import numpy as np

DEFAULT_MAX_ARROWS = 150  # safety so we don't flood the plot


def discover_clv_sets(systems_root: Path) -> List[Dict[str, Any]]:
    records: List[Dict[str, Any]] = []
    if not systems_root.exists():
        return records

    for system_dir in systems_root.iterdir():
        if not system_dir.is_dir():
            continue
        sys_name = system_dir.name
        objects_dir = system_dir / "objects"
        if not objects_dir.exists():
            continue

        for obj_file in objects_dir.glob("*.json"):
            data = json.loads(obj_file.read_text())
            if data.get("type") != "orbit":
                continue
            cov = data.get("covariantVectors")
            if not cov:
                continue
            times = cov.get("times") or []
            vectors = cov.get("vectors") or []
            if not times or not vectors:
                continue
            records.append(
                {
                    "system": sys_name,
                    "object": obj_file.stem,
                    "path": obj_file,
                    "cov_times": times,
                    "cov_dim": cov.get("dim", len(vectors[0])),
                    "cov_count": len(vectors),
                }
            )
    return sorted(records, key=lambda r: (r["system"], r["object"]))


def prompt_choice(records: List[Dict[str, Any]]) -> Dict[str, Any]:
    print("Available CLV datasets:\n")
    for idx, rec in enumerate(records):
        times = rec["cov_times"]
        info = (
            f"[{idx}] {rec['system']}/{rec['object']} "
            f"(dim={rec['cov_dim']}, checkpoints={rec['cov_count']}, "
            f"t ∈ [{times[0]:.3f}, {times[-1]:.3f}])"
        )
        print(info)
    while True:
        raw = input("\nSelect dataset index: ").strip()
        if raw.isdigit():
            idx = int(raw)
            if 0 <= idx < len(records):
                return records[idx]
        print("Invalid selection, try again.")


def ask_float(prompt: str, default: float) -> float:
    while True:
        raw = input(f"{prompt} [{default}]: ").strip()
        if not raw:
            return default
        try:
            return float(raw)
        except ValueError:
            print("Please enter a number.")


def ask_int(prompt: str, default: int, min_value: int = 1) -> int:
    while True:
        raw = input(f"{prompt} [{default}]: ").strip()
        if not raw:
            return default
        try:
            value = int(raw)
            if value >= min_value:
                return value
        except ValueError:
            pass
        print(f"Enter an integer ≥ {min_value}.")


def ask_vector_indices(dim: int) -> List[int]:
    default = "0"
    raw = input(
        f"Vector indices to plot (comma-separated, 0≤idx<{dim}) [{default}]: "
    ).strip()
    if not raw:
        raw = default
    indices: List[int] = []
    for token in raw.split(","):
        token = token.strip()
        if not token:
            continue
        try:
            idx = int(token)
            if 0 <= idx < dim:
                indices.append(idx)
            else:
                print(f"Ignoring out-of-range index {idx}.")
        except ValueError:
            print(f"Ignoring invalid token '{token}'.")
    return sorted(set(indices))


def load_system_varnames(system_dir: Path) -> List[str]:
    sys_json = system_dir / "system.json"
    if not sys_json.exists():
        return []
    data = json.loads(sys_json.read_text())
    return data.get("varNames", [])


def interpolate_state(times: np.ndarray, states: np.ndarray, t: float) -> np.ndarray:
    if t <= times[0]:
        return states[0]
    if t >= times[-1]:
        return states[-1]
    idx = np.searchsorted(times, t)
    t0, t1 = times[idx - 1], times[idx]
    w = 0.0 if t1 == t0 else (t - t0) / (t1 - t0)
    return (1.0 - w) * states[idx - 1] + w * states[idx]


def main() -> None:
    parser = argparse.ArgumentParser(description="Plot CLVs saved by Fork CLI.")
    parser.add_argument(
        "--root",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "cli" / "data" / "systems",
        help="Path to the data/systems directory (default: repo_root/cli/data/systems)",
    )
    parser.add_argument(
        "--max-arrows",
        type=int,
        default=DEFAULT_MAX_ARROWS,
        help="Hard cap on total arrows drawn (safety).",
    )
    args = parser.parse_args()

    records = discover_clv_sets(args.root)
    if not records:
        print(f"No CLV datasets found under {args.root}")
        return

    rec = prompt_choice(records)
    obj_data = json.loads(rec["path"].read_text())
    cov = obj_data["covariantVectors"]
    cov_times = np.array(cov["times"], dtype=float)
    cov_vectors = np.array(cov["vectors"], dtype=float)  # shape: (checkpoints, dim, dim)
    dim = cov["dim"]

    if dim < 3:
        raise RuntimeError("Need at least 3 state dimensions for a 3D plot.")

    orbit = np.array(obj_data["data"], dtype=float)  # (N, dim+1)
    orbit_times = orbit[:, 0]
    orbit_states = orbit[:, 1 : dim + 1]  # drop any extra params beyond dim if present

    t_start = ask_float("Start time", cov_times[0])
    t_end = ask_float("End time", cov_times[-1])
    if t_end <= t_start:
        raise ValueError("End time must exceed start time.")

    stride = ask_int("Stride (only every N-th CLV shown)", 10)
    vector_indices = ask_vector_indices(dim)
    if not vector_indices:
        print("No vector indices chosen; nothing to plot.")
        return

    # Filter checkpoints by time window
    mask = (cov_times >= t_start) & (cov_times <= t_end)
    indices = np.flatnonzero(mask)[::stride]
    if not len(indices):
        raise RuntimeError("No CLV checkpoints in the requested window.")

    if len(indices) * len(vector_indices) > args.max_arrows:
        print(
            f"Warning: requested {len(indices) * len(vector_indices)} arrows, "
            f"clamping to {args.max_arrows}."
        )
        indices = indices[: max(1, args.max_arrows // max(1, len(vector_indices)))]

    var_names = load_system_varnames(args.root / rec["system"])
    axis_labels = (
        var_names[:3] if len(var_names) >= 3 else [f"x{i+1}" for i in range(3)]
    )

    # Prepare orbit segment for plotting
    orbit_mask = (orbit_times >= t_start) & (orbit_times <= t_end)
    orbit_segment = orbit_states[orbit_mask]
    orbit_segment_times = orbit_times[orbit_mask]

    fig = plt.figure(figsize=(10, 8))
    ax = fig.add_subplot(111, projection="3d")
    ax.plot(
        orbit_segment[:, 0],
        orbit_segment[:, 1],
        orbit_segment[:, 2],
        color="gray",
        linewidth=1.2,
        label="Orbit segment",
    )

    # Determine a reasonable vector scale (fraction of bounding-box diagonal)
    bbox = orbit_segment.max(axis=0) - orbit_segment.min(axis=0)
    diag = np.linalg.norm(bbox)
    vec_scale = 0.15 * (diag if diag > 0 else 1.0)

    colors = plt.cm.tab10(np.linspace(0, 1, len(vector_indices)))
    legend_handles = [
        Line2D([0], [0], color="gray", linewidth=1.2, label="Orbit segment")
    ]
    legend_handles.extend(
        Line2D([0], [0], color=color, linewidth=2.0, label=f"CLV {idx}")
        for color, idx in zip(colors, vector_indices)
    )

    for idx in indices:
        base_state = interpolate_state(orbit_times, orbit_states, cov_times[idx])
        for color, v_idx in zip(colors, vector_indices):
            vec = cov_vectors[idx, v_idx, :3]
            vec_norm = np.linalg.norm(vec)
            if vec_norm == 0:
                continue
            direction = vec / vec_norm
            ax.quiver(
                base_state[0],
                base_state[1],
                base_state[2],
                direction[0],
                direction[1],
                direction[2],
                length=vec_scale,
                color=color,
                arrow_length_ratio=0.15,
                linewidth=1.0,
            )

    ax.set_xlabel(axis_labels[0])
    ax.set_ylabel(axis_labels[1])
    ax.set_zlabel(axis_labels[2])
    ax.set_title(
        f"CLVs for {rec['system']}/{rec['object']} "
        f"(t ∈ [{t_start:.3f}, {t_end:.3f}], stride={stride})"
    )
    ax.legend(handles=legend_handles, loc="best")
    plt.tight_layout()
    plt.show()


if __name__ == "__main__":
    main()
    