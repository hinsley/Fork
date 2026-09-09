import type { ParticleSettings, StateGridAxis } from '../system/types'

export type Particle = { state: number[]; age: number; trail: number[][]; trailTimes: number[] }
export type ParticleStepper = (state: number[], time: number, dt: number) => number[]

export function normalizeParticleSettings(settings: ParticleSettings): ParticleSettings {
  const bounded = (value: number, min: number, max: number, fallback: number) =>
    Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback
  return {
    count: Math.round(bounded(settings.count, 1, 2000, 250)),
    speed: bounded(settings.speed, 0.01, 10, 1),
    lifetime: bounded(settings.lifetime, 0.1, 1000, 8),
    integrationStep: bounded(settings.integrationStep, 0.001, 0.1, 0.01),
    trailLength: Math.round(bounded(settings.trailLength, 0, 24, 8)),
    playing: settings.playing === true,
  }
}

export class ParticleSimulation {
  particles: Particle[] = []
  time = 0
  readonly axes: StateGridAxis[]
  settings: ParticleSettings
  private readonly step: ParticleStepper
  private readonly random: () => number
  constructor(axes: StateGridAxis[], settings: ParticleSettings,
    step: ParticleStepper, random = Math.random) {
    this.axes = axes
    this.settings = normalizeParticleSettings(settings)
    this.step = step
    this.random = random
    if (!axes.length || axes.some((axis) => !Number.isFinite(axis.min) ||
      !Number.isFinite(axis.max) || axis.max <= axis.min)) throw new Error('Particle grid bounds must be finite and increasing.')
    this.resize()
  }

  private spawn(stagger: boolean): Particle {
    return {
      state: this.axes.map((axis) => axis.min + this.random() * (axis.max - axis.min)),
      age: stagger ? this.random() * this.settings.lifetime : 0,
      trail: [], trailTimes: [],
    }
  }

  private resize() {
    this.particles.length = Math.min(this.particles.length, this.settings.count)
    while (this.particles.length < this.settings.count) this.particles.push(this.spawn(true))
  }

  advance(realSeconds: number) {
    this.settings = normalizeParticleSettings(this.settings)
    this.resize()
    if (!this.settings.playing) return
    // Bound work after a suspended tab; elapsed background time is not replayed.
    const duration = Math.min(Math.max(realSeconds, 0), 0.1) * this.settings.speed
    const steps = Math.ceil(duration / this.settings.integrationStep)
    if (steps === 0) return
    const dt = duration / steps
    for (let index = 0; index < this.particles.length; index += 1) {
      let particle = this.particles[index]
      particle.trail.unshift([...particle.state])
      particle.trailTimes.unshift(this.time)
      particle.trail.length = Math.min(particle.trail.length, this.settings.trailLength)
      particle.trailTimes.length = particle.trail.length
      for (let tick = 0; tick < steps; tick += 1) {
        const next = this.step(particle.state, this.time + tick * dt, dt)
        particle.age += dt
        if (particle.age >= this.settings.lifetime || next.some((value, axis) =>
          !Number.isFinite(value) || value < this.axes[axis].min || value > this.axes[axis].max)) {
          particle = this.spawn(false)
          this.particles[index] = particle
        } else particle.state = next
      }
    }
    this.time += duration
  }
}
