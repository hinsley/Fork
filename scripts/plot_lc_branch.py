#!/usr/bin/env python3
"""
Visualize all limit cycles from a limit cycle continuation branch.

This script reads LC branch data saved by the Fork CLI and plots all limit cycles
simultaneously, color-coded by their position along the branch.

Usage:
    python plot_lc_branch.py            # assumes repo layout: data/systems/...
    python plot_lc_branch.py --root /path/to/data/systems
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Dict, List, Optional

import matplotlib.pyplot as plt
from matplotlib.collections import LineCollection
from mpl_toolkits.mplot3d.art3d import Line3DCollection
import numpy as np


def discover_lc_branches(systems_root: Path) -> List[Dict[str, Any]]:
    """Discover all limit cycle continuation branches in the data directory."""
    records: List[Dict[str, Any]] = []
    if not systems_root.exists():
        return records

    for system_dir in systems_root.iterdir():
        if not system_dir.is_dir():
            continue
        sys_name = system_dir.name
        
        # Look in branches/ directory only
        branches_dir = system_dir / "branches"
        if not branches_dir.exists():
            continue

        for branch_file in branches_dir.glob("*.json"):
            try:
                data = json.loads(branch_file.read_text())
                
                # Check if this is a continuation type
                if data.get("type") != "continuation":
                    continue
                
                branch_data = data.get("data", {})
                points = branch_data.get("points", [])
                
                if not points:
                    continue
                
                # Check for top-level branchType field (new format)
                top_level_type = data.get("branchType")
                branch_data_type = branch_data.get("branch_type", {})
                ntst, ncol, dim = 0, 0, 0
                is_lc = False
                
                if top_level_type == "limit_cycle":
                    is_lc = True
                    # Get mesh info from data.branch_type if available
                    # Handle both { LimitCycle: {ntst, ncol} } and { type: 'LimitCycle', ntst, ncol } formats
                    if isinstance(branch_data_type, dict):
                        if "LimitCycle" in branch_data_type:
                            lc_info = branch_data_type["LimitCycle"]
                            ntst = lc_info.get("ntst", 0)
                            ncol = lc_info.get("ncol", 0)
                        elif branch_data_type.get("type") == "LimitCycle":
                            ntst = branch_data_type.get("ntst", 0)
                            ncol = branch_data_type.get("ncol", 0)
                elif isinstance(branch_data_type, dict):
                    if "LimitCycle" in branch_data_type:
                        lc_info = branch_data_type["LimitCycle"]
                        ntst = lc_info.get("ntst", 0)
                        ncol = lc_info.get("ncol", 0)
                        is_lc = True
                    elif branch_data_type.get("type") == "LimitCycle":
                        ntst = branch_data_type.get("ntst", 0)
                        ncol = branch_data_type.get("ncol", 0)
                        is_lc = True
                else:
                    # Detect LC by state size - LC states are much larger than equilibrium
                    first_state = points[0].get("state", [])
                    state_len = len(first_state)
                    
                    # If state length is > 20, it's almost certainly an LC branch
                    if state_len > 20:
                        is_lc = True
                        # Try to infer mesh parameters
                        # Priority order: common dimensions first, then common ncol, then ntst variants
                        for test_dim in [3, 2, 4, 5]:  # Most systems are 2D or 3D
                            for test_ncol in [4, 3, 5]:  # ncol=4 is most common
                                for test_ntst in [20, 40, 10, 80, 30, 60]:  # Include doubled values
                                    # state = mesh_states + stage_states + period
                                    # = ntst*dim + ntst*ncol*dim + 1 = ntst*dim*(ncol+1)+1
                                    expected_len = test_ntst * test_dim * (test_ncol + 1) + 1
                                    if state_len == expected_len:
                                        ntst, ncol, dim = test_ntst, test_ncol, test_dim
                                        break
                                if ntst > 0:
                                    break
                            if ntst > 0:
                                break
                        
                        # Fallback: assume common defaults
                        if ntst == 0:
                            ntst, ncol = 20, 4
                            dim = (state_len - 1) // (ntst * (ncol + 1))
                
                if not is_lc:
                    continue
                
                # Fallback: If is_lc but we don't have ntst/ncol, infer from state size
                if ntst == 0 or ncol == 0:
                    first_state = points[0].get("state", [])
                    state_len = len(first_state)
                    
                    # Try to infer mesh parameters from state length
                    # Restructure to prioritize: common dims (2,3) with common ncol (4) first
                    # Then try doubled ntst values, then unusual ncol
                    if state_len > 20:
                        # Priority order: common dimensions first, then common ncol, then ntst variants
                        for test_dim in [3, 2, 4, 5]:  # Most systems are 2D or 3D
                            for test_ncol in [4, 3, 5]:  # ncol=4 is most common
                                for test_ntst in [20, 40, 10, 80, 30, 60]:  # Include doubled values
                                    # state = mesh_states + stage_states + period
                                    # = ntst*dim + ntst*ncol*dim + 1 = ntst*dim*(ncol+1)+1
                                    expected_len = test_ntst * test_dim * (test_ncol + 1) + 1
                                    if state_len == expected_len:
                                        ntst, ncol, dim = test_ntst, test_ncol, test_dim
                                        break
                                if ntst > 0:
                                    break
                            if ntst > 0:
                                break
                        
                        # Fallback: assume common defaults
                        if ntst == 0:
                            ntst, ncol = 20, 4
                            # dim = (state_len - 1) // (ntst * (ncol + 1))
                            # This is approximate since we can't invert cleanly
                            total_mesh_stage = (state_len - 1)
                            dim = total_mesh_stage // (ntst * (ncol + 1)) if ntst * (ncol + 1) > 0 else 0
                
                # Calculate dim if we have branch_type but dim is still 0
                if dim == 0 and ntst > 0 and ncol > 0:
                    first_state = points[0].get("state", [])
                    total_state_len = len(first_state)
                    # state = ntst*dim*(ncol+1)+1, so dim = (state_len-1)/(ntst*(ncol+1))
                    dim = (total_state_len - 1) // (ntst * (ncol + 1)) if ntst * (ncol + 1) > 0 else 0
                
                if dim > 0:
                    records.append({
                        "system": sys_name,
                        "branch": branch_file.stem,
                        "path": branch_file,
                        "point_count": len(points),
                        "ntst": ntst,
                        "ncol": ncol,
                        "dim": dim,
                        "param_name": data.get("parameterName", "param"),
                    })
            except (json.JSONDecodeError, KeyError):
                continue
    
    return sorted(records, key=lambda r: (r["system"], r["branch"]))


def prompt_choice(records: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Prompt user to select a branch."""
    print("Available LC continuation branches:\n")
    for idx, rec in enumerate(records):
        info = (
            f"[{idx}] {rec['system']}/{rec['branch']} "
            f"(dim={rec['dim']}, points={rec['point_count']}, "
            f"mesh={rec['ntst']}×{rec['ncol']})"
        )
        print(info)
    while True:
        raw = input("\nSelect branch index: ").strip()
        if raw.isdigit():
            idx = int(raw)
            if 0 <= idx < len(records):
                return records[idx]
        print("Invalid selection, try again.")


def ask_int(prompt: str, default: int, min_value: int = 1) -> int:
    """Ask the user for an integer value."""
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


def ask_yes_no(prompt: str, default: bool = True) -> bool:
    """Ask the user a yes/no question."""
    default_str = "Y/n" if default else "y/N"
    while True:
        raw = input(f"{prompt} [{default_str}]: ").strip().lower()
        if not raw:
            return default
        if raw in ("y", "yes"):
            return True
        if raw in ("n", "no"):
            return False
        print("Please enter y or n.")


def load_system_varnames(system_dir: Path) -> List[str]:
    """Load variable names from system.json if available."""
    sys_json = system_dir / "system.json"
    if not sys_json.exists():
        return []
    data = json.loads(sys_json.read_text())
    return data.get("varNames", [])


def extract_limit_cycle(state: List[float], ntst: int, ncol: int, dim: int) -> np.ndarray:
    """
    Extract limit cycle profile from state vector.
    
    Rust stores collocation state as:
      [mesh_states (ntst points), stage_states (ntst*ncol points), period]
    
    We extract BOTH mesh and stage states for higher resolution plotting.
    The states are interleaved to show the full collocation profile.
    """
    mesh_points = ntst  # Number of mesh intervals (NOT ntst+1, due to periodicity)
    num_stages = ntst * ncol
    mesh_data_len = mesh_points * dim
    stage_data_len = num_stages * dim
    full_state_len = (mesh_points + num_stages) * dim + 1
    
    if len(state) < full_state_len:
        # Fallback: try with ntst+1 mesh points (some formats)
        mesh_points = ntst + 1
        mesh_data_len = mesh_points * dim
        full_state_len = (mesh_points + num_stages) * dim + 1
    
    if len(state) < mesh_data_len + 1:
        return np.array([])
    
    # Extract mesh states
    mesh_data = np.array(state[:mesh_data_len]).reshape(mesh_points, dim)
    
    # Try to extract stage states too for higher resolution
    if len(state) >= mesh_data_len + stage_data_len + 1:
        stage_data = np.array(state[mesh_data_len:mesh_data_len + stage_data_len]).reshape(num_stages, dim)
        
        # Interleave mesh and stage points for correct ordering
        # Each interval has: mesh_point, then ncol stage points
        full_profile = []
        for i in range(min(ntst, mesh_points)):
            full_profile.append(mesh_data[i])
            for j in range(ncol):
                stage_idx = i * ncol + j
                if stage_idx < len(stage_data):
                    full_profile.append(stage_data[stage_idx])
        # Add final mesh point if we have ntst+1 mesh points
        if mesh_points > ntst:
            full_profile.append(mesh_data[-1])
        profile = np.array(full_profile)
    else:
        # Mesh only
        profile = mesh_data
    
    # Close the cycle by appending the first point
    profile = np.vstack([profile, profile[0:1]])
    
    return profile


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Plot all limit cycles from a continuation branch."
    )
    parser.add_argument(
        "--root",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "cli" / "data" / "systems",
        help="Path to the data/systems directory (default: repo_root/cli/data/systems)",
    )
    parser.add_argument(
        "--stride",
        type=int,
        default=None,
        help="Only plot every N-th limit cycle (prompted if not provided).",
    )
    args = parser.parse_args()

    records = discover_lc_branches(args.root)
    if not records:
        print(f"No LC branches found under {args.root}")
        return

    rec = prompt_choice(records)
    
    # Load full branch data
    branch_data = json.loads(rec["path"].read_text())
    points = branch_data["data"]["points"]
    ntst = rec["ntst"]
    ncol = rec["ncol"]
    dim = rec["dim"]
    param_name = rec["param_name"]
    
    print(f"\nLoaded branch with {len(points)} points, dim={dim}")
    
    stride = args.stride if args.stride else ask_int("Plot every N-th cycle (stride)", 1)
    
    # Get variable names
    var_names = load_system_varnames(args.root / rec["system"])
    
    # Determine if 2D or 3D plot
    if dim == 2:
        axis_labels = var_names[:2] if len(var_names) >= 2 else ["x", "y"]
        plot_3d = False
    else:
        plot_3d = ask_yes_no("Use 3D plot?", default=True)
        if plot_3d:
            axis_labels = var_names[:3] if len(var_names) >= 3 else ["x", "y", "z"]
        else:
            # Ask which 2D projection to use
            print(f"\nVariable indices: {list(enumerate(var_names if var_names else [f'x{i}' for i in range(dim)]))}")
            x_idx = ask_int("X axis variable index", 0, 0)
            y_idx = ask_int("Y axis variable index", 1, 0)
            axis_labels = [
                var_names[x_idx] if x_idx < len(var_names) else f"x{x_idx}",
                var_names[y_idx] if y_idx < len(var_names) else f"x{y_idx}"
            ]
    
    # Extract param values and limit cycles
    param_values = []
    cycles = []
    
    for i, pt in enumerate(points[::stride]):
        state = pt.get("state", [])
        param_val = pt.get("param_value", 0.0)
        
        cycle = extract_limit_cycle(state, ntst, ncol, dim)
        if cycle.size > 0:
            param_values.append(param_val)
            cycles.append(cycle)
    
    if not cycles:
        print("No valid limit cycles found in branch.")
        return
    
    print(f"Plotting {len(cycles)} limit cycles...")
    
    # Normalize param values for colormap
    param_arr = np.array(param_values)
    param_min, param_max = param_arr.min(), param_arr.max()
    if param_max > param_min:
        param_norm = (param_arr - param_min) / (param_max - param_min)
    else:
        param_norm = np.zeros_like(param_arr)
    
    # Create colormap
    cmap = plt.cm.viridis
    
    # Plot
    if dim == 2 or not plot_3d:
        fig, ax = plt.subplots(figsize=(10, 8))
        
        # Determine which dimensions to plot
        if dim == 2:
            x_idx, y_idx = 0, 1
        else:
            x_idx = int(axis_labels[0].lstrip('x')) if axis_labels[0].startswith('x') and axis_labels[0][1:].isdigit() else 0
            y_idx = int(axis_labels[1].lstrip('x')) if axis_labels[1].startswith('x') and axis_labels[1][1:].isdigit() else 1
            # Re-get actual indices if not simple names
            if not axis_labels[0].startswith('x'):
                x_idx = var_names.index(axis_labels[0]) if axis_labels[0] in var_names else 0
            if not axis_labels[1].startswith('x'):
                y_idx = var_names.index(axis_labels[1]) if axis_labels[1] in var_names else 1
        
        for cycle, norm_val in zip(cycles, param_norm):
            color = cmap(norm_val)
            ax.plot(cycle[:, x_idx], cycle[:, y_idx], color=color, linewidth=0.8, alpha=0.7)
        
        ax.set_xlabel(axis_labels[0])
        ax.set_ylabel(axis_labels[1])
        
    else:
        # 3D plot
        fig = plt.figure(figsize=(12, 9))
        ax = fig.add_subplot(111, projection="3d")
        
        for cycle, norm_val in zip(cycles, param_norm):
            color = cmap(norm_val)
            ax.plot(cycle[:, 0], cycle[:, 1], cycle[:, 2], color=color, linewidth=0.8, alpha=0.7)
        
        ax.set_xlabel(axis_labels[0])
        ax.set_ylabel(axis_labels[1])
        ax.set_zlabel(axis_labels[2])
    
    # Add colorbar
    sm = plt.cm.ScalarMappable(cmap=cmap, norm=plt.Normalize(param_min, param_max))
    sm.set_array([])
    cbar = plt.colorbar(sm, ax=ax, shrink=0.8, aspect=30)
    cbar.set_label(param_name)
    
    ax.set_title(f"Limit Cycles: {rec['system']}/{rec['branch']} ({len(cycles)} cycles)")
    
    plt.tight_layout()
    plt.show()


if __name__ == "__main__":
    main()
