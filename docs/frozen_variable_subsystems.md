# Frozen-Variable Subsystems

This document describes how Fork models frozen-variable computations and how continuation data is represented and rendered.

## Purpose

Frozen variables let an analysis object define a reduced subsystem where selected state variables are treated as constants. This supports fast-slow workflows where slow variables are used as continuation parameters for a fast subsystem.

## Data Model

Frozen-variable behavior is object-scoped.

- `frozenVariables.frozenValuesByVarName`: object-level frozen assignments.
- `subsystemSnapshot`: immutable snapshot of the reduced subsystem used for compute and display mapping.
- `parameterRef` / `parameter2Ref`: explicit parameter identity, including frozen-variable refs.

Key snapshot fields:

- `baseVarNames`: full system variable order.
- `freeVariableNames` / `freeVariableIndices`: reduced subsystem state basis.
- `frozenValuesByVarName`: frozen assignments.
- `frozenParameterNamesByVarName`: generated internal parameter IDs (for example `fv__h2Na`).
- `hash`: deterministic snapshot hash used for mismatch detection.

## Compute Pipeline

All frozen-aware runs pass through the subsystem gateway in `web/src/system/subsystemGateway.ts`:

1. Normalize frozen config.
2. Build/reuse `subsystemSnapshot`.
3. Build reduced run config:
   - equations restricted to free variables,
   - frozen variables rewritten to generated frozen parameters,
   - parameter vector extended with frozen parameter values.
4. Resolve continuation parameter refs to runtime parameter names.
5. Project full seeds to reduced states before calling Fork Core.

## Canonical State Representation

Computed states are reduced-canonical.

- Non-cycle states (for example equilibrium continuation points): reduced vector length equals `freeVariableNames.length`.
- Cycle-like continuation points (limit cycle, isochrone, homoclinic-related packed states): packed collocation vectors are stored in reduced coordinates.

For a limit-cycle branch point with mesh `(ntst, ncol)` and reduced dimension `d_free`, packed state payloads are interpreted with `d_free`, not full system dimension.

## Display Projection Rules

UI views must embed reduced states back into full-system coordinates before plotting/tabulating state variables.

Embedding uses:

- `stateVectorToDisplay(snapshot, state, projectionOptions)`
- `mapStateRowsToDisplay(snapshot, rows, projectionOptions)`

Projection options are required when continuation parameters reference frozen variables:

- `parameterRef + paramValue`
- `parameter2Ref + param2Value`

This ensures the currently continued frozen variable reflects per-point continuation values, while other frozen variables remain fixed to snapshot values.

## Limit-Cycle Specific Notes

For frozen subsystems, limit-cycle branches remain reduced-packed internally.

Correct rendering requires:

1. Decode packed profiles with reduced dimension (`snapshot.freeVariableNames.length`).
2. Embed each decoded profile point to full-state coordinates via snapshot mapping.
3. Apply per-point frozen-parameter projection overrides when a frozen variable is a continuation parameter.

If full-system dimension is used to decode reduced-packed cycle states, branch shapes and frozen-variable readouts will be incorrect.

When a cycle-like continuation branch has exactly one free variable (`freeVariableNames.length === 1`),
Fork renders branch envelopes (min/max curves) in both state-space scenes and bifurcation diagrams.
This envelope policy applies to continuation branches (limit cycle, isochrone, homoclinic-related branches),
not standalone limit-cycle objects.

## Branch/Object Snapshot Semantics

- Branches and derived objects carry immutable `subsystemSnapshot` copies.
- Editing an object's frozen config does not mutate existing computed branches/objects.
- Snapshot hash mismatches are informational and non-blocking.

## Practical Debug Checklist

When a frozen-variable continuation appears wrong:

1. Confirm branch/object `subsystemSnapshot.freeVariableNames` matches reduced state dimension.
2. Confirm `parameterRef` points to the intended frozen variable.
3. Confirm the runtime continuation parameter resolves to generated frozen parameter name (`fv__...`).
4. Confirm UI uses reduced-dimension decode plus full-state embedding with projection overrides.
