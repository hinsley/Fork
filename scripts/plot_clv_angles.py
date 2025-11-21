#!/usr/bin/env python3
"""
Plot the minimal angle between E^cu and E^ss subspaces extracted from CLVs.

Workflow:
1. Script searches the CLI data directory for orbit objects that already have CLVs.
2. User selects which dataset to analyze.
3. User specifies the dimension of the center-unstable subspace E^cu (leading CLVs).
4. Script computes, for every stored checkpoint, the smallest principal angle between
   span(E^cu) and span(E^ss) and plots the resulting time series.

The plot is a standard Matplotlib figure, so you can drag/pan/zoom with the toolbar tools.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any, Dict, List

import matplotlib.pyplot as plt
import numpy as np


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


def ask_int(prompt: str, default: int, min_value: int, max_value: int) -> int:
    while True:
        raw = input(f"{prompt} [{default}]: ").strip()
        if not raw:
            value = default
        else:
            try:
                value = int(raw)
            except ValueError:
                print("Please enter an integer.")
                continue
        if value < min_value or value > max_value:
            print(f"Enter an integer in [{min_value}, {max_value}].")
            continue
        return value


def orthonormal_basis(matrix: np.ndarray) -> np.ndarray:
    """Return an orthonormal basis spanning the columns of matrix."""
    if matrix.shape[1] == 0:
        raise ValueError("Matrix must have at least one column.")
    q, r = np.linalg.qr(matrix, mode="reduced")
    # Handle potential rank deficiency by removing nearly-zero vectors.
    tol = np.max(matrix.shape) * np.finfo(matrix.dtype).eps * np.abs(r).max()
    keep = np.abs(np.diag(r)) > tol
    if not np.any(keep):
        raise ValueError("Subspace appears degenerate; QR produced zero columns.")
    return q[:, keep]


def principal_angle_degrees(cu: np.ndarray, ss: np.ndarray) -> float:
    """Return the smallest principal angle between two subspaces in degrees."""
    cu_basis = orthonormal_basis(cu)
    ss_basis = orthonormal_basis(ss)
    gram = cu_basis.T @ ss_basis
    singular_values = np.linalg.svd(gram, compute_uv=False)
    if singular_values.size == 0:
        return 90.0
    cos_theta = np.clip(np.max(np.abs(singular_values)), -1.0, 1.0)
    return math.degrees(math.acos(cos_theta))


def compute_angles(cov_data: Dict[str, Any], e_cu_dim: int) -> np.ndarray:
    vectors = np.array(cov_data["vectors"], dtype=float)  # (checkpoints, dim, dim)
    times = np.array(cov_data["times"], dtype=float)
    dim = cov_data["dim"]

    if e_cu_dim <= 0 or e_cu_dim >= dim:
        raise ValueError("E^cu dimension must be between 1 and dim-1.")

    angles: List[float] = []
    for idx in range(vectors.shape[0]):
        # vectors[idx] is shape (dim_vectors, dim_components) = (dim, dim)
        # Rows correspond to individual CLVs; transpose to put vectors in columns.
        clv_matrix = vectors[idx].T  # shape (dim, dim)
        cu_span = clv_matrix[:, :e_cu_dim]
        ss_span = clv_matrix[:, e_cu_dim:]
        if ss_span.shape[1] == 0:
            raise ValueError("Stable subspace has zero dimension; adjust E^cu.")
        angle = principal_angle_degrees(cu_span, ss_span)
        angles.append(angle)
    return times[: len(angles)], np.array(angles, dtype=float)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Plot minimal angles between E^cu and E^ss from CLV datasets."
    )
    parser.add_argument(
        "--root",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "cli" / "data" / "systems",
        help="Path to the data/systems directory (default: repo_root/cli/data/systems)",
    )
    args = parser.parse_args()

    records = discover_clv_sets(args.root)
    if not records:
        print(f"No CLV datasets found under {args.root}")
        return

    rec = prompt_choice(records)
    obj_data = json.loads(rec["path"].read_text())
    cov = obj_data["covariantVectors"]
    dim = cov["dim"]

    e_cu_dim = ask_int(
        "Dimension of E^cu (number of leading CLVs)",
        default=min(2, dim - 1),
        min_value=1,
        max_value=dim - 1,
    )

    times, angles = compute_angles(cov, e_cu_dim)

    fig, ax = plt.subplots(figsize=(10, 6))
    ax.plot(times, angles, color="tab:blue")
    ax.set_xlabel("Time")
    ax.set_ylabel("Minimal angle between E^cu and E^ss (degrees)")
    ax.set_title(
        f"CLV subspace angle: {rec['system']}/{rec['object']} "
        f"(dim={dim}, E^cu dim={e_cu_dim})"
    )
    ax.grid(True)
    plt.tight_layout()
    plt.show()


if __name__ == "__main__":
    main()

