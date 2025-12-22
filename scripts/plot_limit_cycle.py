#!/usr/bin/env python3
"""
Inspect and visualize limit-cycle continuation branches saved by the Fork CLI.

Examples
--------
    python scripts/plot_limit_cycle.py \
        --system HopfNF --branch eq_m_LC_11 --repeat 2

    python scripts/plot_limit_cycle.py --root /path/to/cli/data/systems
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import matplotlib.pyplot as plt
import numpy as np

DEFAULT_ROOT = Path(__file__).resolve().parents[1] / "cli" / "data" / "systems"


def discover_limit_cycle_branches(systems_root: Path) -> List[Dict[str, str]]:
    records: List[Dict[str, str]] = []
    if not systems_root.exists():
        return records
    for system_dir in systems_root.iterdir():
        if not system_dir.is_dir():
            continue
        objects_dir = system_dir / "objects"
        if not objects_dir.exists():
            continue

        # Objects-first layout: branches live under objects/<object>/branches/*.json.
        for obj_dir in objects_dir.iterdir():
            if not obj_dir.is_dir():
                continue
            branches_dir = obj_dir / "branches"
            if not branches_dir.exists():
                continue
            for branch_path in branches_dir.glob("*.json"):
                data = json.loads(branch_path.read_text())
                if data.get("type") != "continuation":
                    continue
                if (data.get("branchType") or "equilibrium") != "limit_cycle":
                    continue
                records.append(
                    {
                        "system": system_dir.name,
                        "branch": branch_path.stem,
                        "path": str(branch_path),
                        "parent_object": obj_dir.name,
                    }
                )
    return sorted(records, key=lambda r: (r["system"], r["branch"]))


def prompt_branch(records: List[Dict[str, str]]) -> Dict[str, str]:
    print("Limit-cycle continuation branches:\n")
    for idx, rec in enumerate(records):
        print(f"[{idx}] {rec['system']} / {rec['branch']}")
    while True:
        raw = input("\nSelect branch index: ").strip()
        if raw.isdigit():
            idx = int(raw)
            if 0 <= idx < len(records):
                return records[idx]
        print("Invalid selection, try again.")


def load_branch(
    systems_root: Path, system_name: str, branch_name: str
) -> Dict:
    # Try to resolve by scanning all objects/*/branches/<branch>.json.
    candidate_paths = list((systems_root / system_name / "objects").glob(f"*/branches/{branch_name}.json"))
    if not candidate_paths:
        raise FileNotFoundError(
            f'Branch "{branch_name}" not found under "{systems_root / system_name / "objects"}". '
            "Use `objects/<object>/branches/<branch>.json`."
        )
    branch_path = candidate_paths[0]
    data = json.loads(branch_path.read_text())
    if data.get("type") != "continuation":
        raise ValueError(f"{branch_path} is not a continuation branch.")
    if (data.get("branchType") or "equilibrium") != "limit_cycle":
        raise ValueError(
            f'{branch_name} is not a limit-cycle branch (branchType={data.get("branchType")}).'
        )
    return data


def reshape_state_vector(
    point_state: List[float],
    dim: int,
    mesh_points: int,
    degree: Optional[int],
) -> Tuple[np.ndarray, float]:
    """
    Reconstruct mesh states (array shape (mesh_points, dim)) and period from the flattened
    state vector stored in `ContinuationPoint.state`.

    Layout: [mesh states, stage states, period], where stage states count equals mesh_points * degree.
    """
    state_vec = np.asarray(point_state, dtype=float)
    base = mesh_points * dim
    if base <= 0:
        raise ValueError("Mesh points and dimension must be positive.")

    if degree is None or degree <= 0:
        remaining = len(state_vec) - base - 1
        if remaining > 0:
            inferred = remaining // (mesh_points * dim)
            if inferred > 0:
                degree = inferred
    degree = degree or 1

    stage_block = mesh_points * degree * dim
    expected = base + stage_block + 1
    if len(state_vec) < expected:
        raise ValueError(
            f"Point state length {len(point_state)} is insufficient for mesh={mesh_points}, "
            f"dim={dim}, degree={degree}."
        )
    arr = state_vec[:base].reshape(mesh_points, dim)
    period = float(state_vec[expected - 1])
    return arr, period


def plot_limit_cycle(
    states: np.ndarray,
    repeat: int,
    var_names: Optional[List[str]] = None,
) -> None:
    """
    Plot the 3D limit-cycle curve by repeating the mesh `repeat` times to visualise continuity.
    """
    dim = states.shape[1]
    if dim < 2:
        raise ValueError("Need at least 2 variables to plot a limit cycle.")
    idx_x, idx_y = 0, 1
    idx_z = 2 if dim >= 3 else None

    names = var_names or []
    label_x = names[idx_x] if idx_x < len(names) else f"x{idx_x}"
    label_y = names[idx_y] if idx_y < len(names) else f"x{idx_y}"
    label_z = names[idx_z] if idx_z is not None and idx_z < len(names) else (
        f"x{idx_z}" if idx_z is not None else None
    )

    repeated = np.tile(states, (repeat, 1))
    fig = plt.figure(figsize=(8, 6))
    if idx_z is None:
        ax = fig.add_subplot(111)
        ax.plot(repeated[:, idx_x], repeated[:, idx_y], color="tab:blue")
        ax.set_xlabel(label_x)
        ax.set_ylabel(label_y)
    else:
        ax = fig.add_subplot(111, projection="3d")
        ax.plot3D(
            repeated[:, idx_x],
            repeated[:, idx_y],
            repeated[:, idx_z],
            color="tab:blue",
        )
        ax.set_xlabel(label_x)
        ax.set_ylabel(label_y)
        ax.set_zlabel(label_z)

    ax.set_title(f"Limit cycle (repeat={repeat})")
    plt.tight_layout()
    plt.show()


def ask_int(prompt: str, default: int, min_value: int = 0, max_value: Optional[int] = None) -> int:
    while True:
        raw = input(f"{prompt} [{default}]: ").strip()
        if not raw:
            return default
        try:
            value = int(raw)
            if value < min_value:
                raise ValueError
            if max_value is not None and value > max_value:
                raise ValueError
            return value
        except ValueError:
            upper = f", ≤ {max_value}" if max_value is not None else ""
            print(f"Enter an integer ≥ {min_value}{upper}.")


def ask_float(prompt: str, default: float) -> float:
    while True:
        raw = input(f"{prompt} [{default}]: ").strip()
        if not raw:
            return default
        try:
            return float(raw)
        except ValueError:
            print("Please enter a number.")


def maybe_infer_dim_from_state(point_state: List[float], mesh_points: int, default_dim: int) -> int:
    if mesh_points <= 0:
        return default_dim
    length = len(point_state)
    # state layout: mesh_points * dim + 1 (period)
    dim_candidate = (length - 1) // mesh_points
    if dim_candidate <= 0:
        return default_dim
    return dim_candidate


def main() -> None:
    parser = argparse.ArgumentParser(description="Visualize a limit-cycle continuation branch.")
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT, help="systems root")
    parser.add_argument("--system", help="System name under data/systems")
    parser.add_argument(
        "--branch",
        help="Continuation object name (JSON file without extension)",
    )
    parser.add_argument(
        "--index",
        type=int,
        default=None,
        help="Continuation point index (default: last point).",
    )
    parser.add_argument(
        "--mesh-points",
        type=int,
        default=None,
        help="Override mesh points if not stored in metadata.",
    )
    parser.add_argument(
        "--degree",
        type=int,
        default=None,
        help="Override collocation degree if metadata is missing.",
    )
    parser.add_argument(
        "--dim",
        type=int,
        default=None,
        help="Override system dimension if state length is ambiguous.",
    )
    parser.add_argument(
        "--repeat",
        type=int,
        default=None,
        help="How many periods of the orbit to tile for plotting.",
    )
    args = parser.parse_args()

    root = args.root
    system = args.system
    branch_name = args.branch

    if not system or not branch_name:
        records = discover_limit_cycle_branches(root)
        if not records:
            raise RuntimeError(f"No limit-cycle branches found under {root}")
        if not system or not branch_name:
            selected = prompt_branch(records)
            system = system or selected["system"]
            branch_name = branch_name or selected["branch"]

    branch = load_branch(root, system, branch_name)
    points: List[Dict] = branch["data"]["points"]
    if not points:
        raise RuntimeError("Branch has no points.")
    index = args.index if args.index is not None else len(points) - 1
    if not (0 <= index < len(points)):
        raise IndexError(f"Point index {index} out of range [0, {len(points)-1}].")
    point = points[index]

    # figure out mesh and dim
    if args.index is None:
        index = ask_int("Continuation point index", len(points) - 1, 0, len(points) - 1)
    point = points[index]

    meta = branch.get("limitCycleMeta") or {}
    mesh_points = args.mesh_points or meta.get("meshPoints")
    if mesh_points is None:
        try:
            mesh_points = ask_int("Mesh points (collocation mesh)", 60, 3)
        except KeyboardInterrupt:
            return

    degree = args.degree or meta.get("degree")
    if degree is None:
        degree = ask_int("Collocation degree", 5, 2)

    var_names = None
    system_dir = root / system
    system_json = system_dir / "system.json"
    if system_json.exists():
        data = json.loads(system_json.read_text())
        var_names = data.get("varNames")
        dim = data.get("dim") or (len(var_names) if var_names else None)
    else:
        dim = None

    dim = args.dim or dim
    if dim is None:
        inferred_dim = maybe_infer_dim_from_state(point["state"], mesh_points, 2)
        print(
            f"Inferred dimension {inferred_dim} from state vector "
            f"(length {len(point['state'])}, mesh={mesh_points})."
        )
        dim = ask_int("System dimension", inferred_dim, 1)

    try:
        states, period = reshape_state_vector(point["state"], dim, mesh_points, degree)
    except ValueError as exc:
        print(f"Failed to parse point {index}: {exc}")
        # try to salvage by scanning for a point with the expected length
        fallback = None
        stage_block = mesh_points * degree * dim
        expected_len = mesh_points * dim + stage_block + 1
        for idx, candidate in enumerate(points):
            if len(candidate["state"]) >= expected_len:
                fallback = (idx, candidate)
                break
        if fallback is None:
            raise ValueError(
                f"{exc}\nNo points in this branch have length ≥ {expected_len}; "
                "double-check mesh/dim settings or pass overrides."
            ) from exc
        print(f"Trying fallback point {fallback[0]} instead.")
        point = fallback[1]
        states, period = reshape_state_vector(point["state"], dim, mesh_points, degree)
        index = fallback[0]
    print(
        f"Point index {index}: param={point['param_value']:.6f}, "
        f"period={period:.6f}, states shape={states.shape}"
    )
    repeat = args.repeat if args.repeat is not None else ask_int("Repeat periods", 2, 1)
    plot_limit_cycle(states, repeat, var_names=var_names)


if __name__ == "__main__":
    main()

