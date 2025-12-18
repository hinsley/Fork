/**
 * Limit Cycle Metrics Module
 * 
 * Contains functions for extracting and computing metrics from limit cycle data.
 */

import { ContinuationEigenvalue } from '../types';

export interface LimitCycleMetrics {
  period: number;
  ranges: { min: number; max: number; range: number }[];
  means: number[];
  rmsAmplitudes: number[];
}

/**
 * Extract profile points from flat LC state.
 * Flat state format: [profile_0, profile_1, ..., profile_N, period]
 * Returns array of state vectors and the period.
 */
export function extractLCProfile(
  flatState: number[],
  dim: number,
  ntst: number,
  ncol: number
): { profilePoints: number[][]; period: number } {
  const profilePointCount = ntst * ncol + 1;
  const period = flatState[flatState.length - 1];
  const profilePoints: number[][] = [];

  for (let i = 0; i < profilePointCount; i++) {
    const offset = i * dim;
    profilePoints.push(flatState.slice(offset, offset + dim));
  }

  return { profilePoints, period };
}

/**
 * Compute interpretable metrics from LC profile points.
 */
export function computeLCMetrics(profilePoints: number[][], period: number): LimitCycleMetrics {
  const dim = profilePoints[0]?.length || 0;
  const n = profilePoints.length;

  const ranges: { min: number; max: number; range: number }[] = [];
  const means: number[] = [];
  const rmsAmplitudes: number[] = [];

  for (let d = 0; d < dim; d++) {
    const values = profilePoints.map(pt => pt[d]);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const mean = values.reduce((a, b) => a + b, 0) / n;

    // RMS amplitude from mean
    const rms = Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n);

    ranges.push({ min, max, range: max - min });
    means.push(mean);
    rmsAmplitudes.push(rms);
  }

  return { period, ranges, means, rmsAmplitudes };
}

/**
 * Interpret Floquet multipliers into a simple stability label.
 */
export function interpretLCStability(eigenvalues: ContinuationEigenvalue[] | undefined): string {
  if (!eigenvalues || eigenvalues.length === 0) return 'unknown';

  // Floquet multipliers: stable if all |λ| < 1 (except trivial λ=1)
  let unstableCount = 0;
  let hasNeimarkSacker = false;

  for (const eig of eigenvalues) {
    const magnitude = Math.sqrt(eig.re * eig.re + eig.im * eig.im);

    // Skip trivial multiplier (≈1)
    if (Math.abs(magnitude - 1.0) < 0.01 && Math.abs(eig.im) < 0.01) continue;

    if (magnitude > 1.0 + 1e-6) {
      unstableCount++;
      // Complex pair with |λ| > 1 indicates Neimark-Sacker
      if (Math.abs(eig.im) > 1e-6) hasNeimarkSacker = true;
    }
  }

  if (unstableCount === 0) return 'stable';
  if (hasNeimarkSacker) return `unstable (torus)`;
  return `unstable (${unstableCount}D)`;
}
