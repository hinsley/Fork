/**
 * Duration to prefill when re-running an orbit.
 *
 * `t_end - t_start` carries the integrator's accumulated rounding
 * (`100.00000000001425`), which would add a step on rerun. Snap to a whole
 * number of steps when the span is one up to rounding, and trim the rest to
 * 12 significant digits.
 */
export function normalizeOrbitDuration(duration: number, dt?: number | null): number {
  if (!Number.isFinite(duration) || duration <= 0) return duration
  if (typeof dt === 'number' && Number.isFinite(dt) && dt > 0) {
    const steps = Math.round(duration / dt)
    if (steps > 0 && Math.abs(duration / dt - steps) <= 1e-6) {
      return Number((steps * dt).toPrecision(12))
    }
  }
  return Number(duration.toPrecision(12))
}
