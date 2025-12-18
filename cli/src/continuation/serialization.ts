/**
 * Serialization Module
 * 
 * Contains functions for serializing and normalizing continuation branch data
 * for WASM interop.
 */

import { ContinuationBranchData, ContinuationEigenvalue } from '../types';

type EigenvalueWire = [number, number];

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
      }) ?? []
    })) as any
  };
}

/**
 * Normalize branch eigenvalues from WASM format to application format.
 * Converts eigenvalues from tuple format to object format.
 */
export function normalizeBranchEigenvalues(data: ContinuationBranchData): ContinuationBranchData {
  return {
    ...data,
    points: data.points.map(pt => ({
      ...pt,
      eigenvalues: normalizeEigenvalueArray(pt.eigenvalues as any)
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
