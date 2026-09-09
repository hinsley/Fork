import type { ParticleSettings, StateGridAxis } from '../system/types'

export type Particle = {
  state: number[]
  age: number
  trail: number[][]
  trailTimes: number[]
  stopped?: boolean
}
export type ParticleStepper = (state: number[], time: number, dt: number) => number[]
export const MAX_PARTICLE_GRID_POINTS = 100_000

export function normalizeParticleSettings(settings: ParticleSettings): ParticleSettings {
  const bounded = (value: number, min: number, max: number, fallback: number) =>
    Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback
  return {
    mode: settings.mode === 'continuous' ? 'continuous' : 'bounded',
    resetRevision: Number.isSafeInteger(settings.resetRevision) && settings.resetRevision! >= 0
      ? settings.resetRevision : 0,
    speed: bounded(settings.speed, 0.01, 10, 1),
    lifetime: bounded(settings.lifetime, 0.1, 1000, 8),
    integrationStep: bounded(settings.integrationStep, 0.001, 0.1, 0.01),
    trailLength: Math.round(bounded(settings.trailLength, 0, 24, 8)),
    playing: settings.playing === true,
  }
}

export function particleGridSeeds(axes: StateGridAxis[]): number[][] {
  if (!axes.length || axes.some((axis) => !Number.isFinite(axis.min) ||
    !Number.isFinite(axis.max) || axis.max < axis.min ||
    !Number.isSafeInteger(axis.resolution) || axis.resolution < 1)) {
    throw new Error('Particle grid bounds and resolutions must be valid.')
  }
  const count = axes.reduce((total, axis) => total * axis.resolution, 1)
  if (!Number.isSafeInteger(count) || count > MAX_PARTICLE_GRID_POINTS) {
    throw new Error(`This grid exceeds ${MAX_PARTICLE_GRID_POINTS.toLocaleString()} particle seeds. Reduce the source grid resolutions.`)
  }
  return Array.from({ length: count }, (_, cell) => {
    const point = new Array<number>(axes.length)
    let remaining = cell
    for (let index = axes.length - 1; index >= 0; index--) {
      const axis = axes[index]
      const coordinate = remaining % axis.resolution
      remaining = Math.floor(remaining / axis.resolution)
      point[index] = axis.min + (coordinate + 0.5) * (axis.max - axis.min) / axis.resolution
    }
    return point
  })
}

export class ParticleSimulation {
  particles: Particle[] = []
  time = 0
  readonly axes: StateGridAxis[]
  readonly seeds: number[][]
  settings: ParticleSettings
  private readonly step: ParticleStepper
  private readonly random: () => number
  private mode: ParticleSettings['mode']
  private resetRevision: number | undefined

  constructor(axes: StateGridAxis[], settings: ParticleSettings,
    step: ParticleStepper, random = Math.random) {
    this.axes = axes
    this.seeds = particleGridSeeds(axes)
    this.settings = normalizeParticleSettings(settings)
    this.mode = this.settings.mode
    this.resetRevision = this.settings.resetRevision
    this.step = step
    this.random = random
    this.reset()
  }

  private spawn(index: number, stagger: boolean): Particle {
    return {
      state: [...this.seeds[index]],
      age: stagger && this.settings.mode === 'bounded' ? this.random() * this.settings.lifetime : 0,
      trail: [], trailTimes: [],
    }
  }

  private reset() {
    this.time = 0
    this.particles = this.seeds.map((_, index) => this.spawn(index, true))
  }

  advance(realSeconds: number) {
    this.settings = normalizeParticleSettings(this.settings)
    if (this.settings.mode !== this.mode || this.settings.resetRevision !== this.resetRevision) {
      this.mode = this.settings.mode
      this.resetRevision = this.settings.resetRevision
      this.reset()
      return
    }
    if (!this.settings.playing) return
    // Bound work after a suspended tab; elapsed background time is not replayed.
    const duration = Math.min(Math.max(realSeconds, 0), 0.1) * this.settings.speed
    const steps = Math.ceil(duration / this.settings.integrationStep)
    if (steps === 0) return
    const dt = duration / steps
    for (let index = 0; index < this.particles.length; index += 1) {
      let particle = this.particles[index]
      if (particle.stopped) continue
      particle.trail.unshift([...particle.state])
      particle.trailTimes.unshift(this.time)
      particle.trail.length = Math.min(particle.trail.length, this.settings.trailLength)
      particle.trailTimes.length = particle.trail.length
      for (let tick = 0; tick < steps; tick += 1) {
        const next = this.step(particle.state, this.time + tick * dt, dt)
        const nonfinite = next.some((value) => !Number.isFinite(value))
        particle.age += dt
        if (this.mode === 'bounded' && (nonfinite || particle.age >= this.settings.lifetime ||
          next.some((value, axis) => value < this.axes[axis].min || value > this.axes[axis].max))) {
          particle = this.spawn(index, false)
          this.particles[index] = particle
        } else if (nonfinite) {
          // Retain the last finite position when an unbounded trajectory cannot be integrated further.
          particle.stopped = true
          break
        } else particle.state = next
      }
    }
    this.time += duration
  }
}
