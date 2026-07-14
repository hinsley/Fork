/**
 * Serialization Module
 * 
 * Contains functions for serializing and normalizing continuation branch data
 * for WASM interop.
 */

import {
  ContinuationBranchData,
  ContinuationEigenvalue,
  HeteroclinicInclinationFrame,
  HeteroclinicInclinationTransport,
} from '../types';

type EigenvalueWire = [number, number];

function copyInclinationFrame(
  frame: HeteroclinicInclinationFrame | null | undefined
): HeteroclinicInclinationFrame | null | undefined {
  if (!frame) return frame;
  return {
    ...frame,
    transported_frame: [...frame.transported_frame],
    reference_frame: [...frame.reference_frame],
    ...(frame.exterior_orientation
      ? { exterior_orientation: [...frame.exterior_orientation] }
      : {}),
  };
}

function copyInclinationTransport(
  transport: HeteroclinicInclinationTransport | null | undefined
): HeteroclinicInclinationTransport | null | undefined {
  if (!transport) return transport;
  const copy = { ...transport };
  if ('source' in transport) copy.source = copyInclinationFrame(transport.source);
  if ('target' in transport) copy.target = copyInclinationFrame(transport.target);
  return copy;
}

/**
 * Serialize branch data for WASM consumption.
 * Converts eigenvalues from object format to tuple format.
 */
export function serializeBranchDataForWasm(data: ContinuationBranchData): any {
  return {
    ...data,
    points: data.points.map(pt => ({
      ...pt,
      eigenvalues: (pt.eigenvalues as any[] | undefined)?.map(ev => {
        if (Array.isArray(ev)) {
          return ev as EigenvalueWire;
        }
        return [ev?.re ?? 0, ev?.im ?? 0] as EigenvalueWire;
      }) ?? [],
      heteroclinic_events: pt.heteroclinic_events
        ? {
            ...pt.heteroclinic_events,
            source_eigenvalues: pt.heteroclinic_events.source_eigenvalues.map(ev => [ev.re, ev.im]),
            target_eigenvalues: pt.heteroclinic_events.target_eigenvalues.map(ev => [ev.re, ev.im]),
            inclination_transport: copyInclinationTransport(
              pt.heteroclinic_events.inclination_transport
            ),
          }
        : undefined,
    })) as any
  };
}

/**
 * Normalize branch eigenvalues from WASM format to application format.
 * Converts eigenvalues from tuple format to object format.
 */
export function normalizeBranchEigenvalues(data: ContinuationBranchData): ContinuationBranchData {
  const branchType = data.branch_type;
  const inferParam2 = (state: number[]): number | undefined => {
    if (branchType?.type === 'HeteroclinicCurve') {
      const dim = branchType.schema.source_basis.dim;
      const profileLength = ((branchType.ntst + 1) + branchType.ntst * branchType.ncol) * dim;
      const value = state[profileLength + 2 * dim];
      return Number.isFinite(value) ? value : undefined;
    }
    if (branchType?.type === 'HomoclinicCurve' && data.homoc_context) {
      const dim = data.homoc_context.basis.dim;
      const profileLength = ((branchType.ntst + 1) + branchType.ntst * branchType.ncol) * dim;
      const value = state[profileLength + dim];
      return Number.isFinite(value) ? value : undefined;
    }
    return undefined;
  };
  return {
    ...data,
    points: data.points.map(pt => ({
      ...pt,
      param2_value: Number.isFinite(pt.param2_value)
        ? pt.param2_value
        : inferParam2(pt.state),
      eigenvalues: normalizeEigenvalueArray(pt.eigenvalues as any),
      heteroclinic_events: pt.heteroclinic_events
        ? {
            ...pt.heteroclinic_events,
            source_eigenvalues: normalizeEigenvalueArray(
              pt.heteroclinic_events.source_eigenvalues as any
            ),
            target_eigenvalues: normalizeEigenvalueArray(
              pt.heteroclinic_events.target_eigenvalues as any
            ),
            inclination_transport: copyInclinationTransport(
              pt.heteroclinic_events.inclination_transport
            ),
          }
        : undefined,
    }))
  };
}

/**
 * Normalize a raw eigenvalue array to the standard { re, im } format.
 */
export function normalizeEigenvalueArray(raw: any): ContinuationEigenvalue[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((val: any) => {
      if (Array.isArray(val)) {
        return { re: val[0] ?? 0, im: val[1] ?? 0 };
      }
      return {
        re: typeof val?.re === 'number' ? val.re : Number(val?.re ?? 0),
        im: typeof val?.im === 'number' ? val.im : Number(val?.im ?? 0)
      };
    });
  }
  return [];
}
