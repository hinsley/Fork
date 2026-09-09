import { describe, expect, it } from 'vitest'
import { ParticleSimulation } from './particleSimulation'
import type { ParticleSettings } from '../system/types'

const settings: ParticleSettings = { count: 4, speed: 1, lifetime: 1,
  integrationStep: 0.01, trailLength: 4, playing: true }
const axes = [{ variableName: 'x', min: -1, max: 1, resolution: 10 }]

describe('particle evolution', () => {
  it('staggers initial lifetimes and replaces expired particles without joining trails', () => {
    let seed = 0
    const simulation = new ParticleSimulation(axes, settings, (state) => state,
      () => ((seed++ % 10) + 0.5) / 10)
    expect(new Set(simulation.particles.map((particle) => particle.age)).size).toBe(4)
    expect(simulation.particles.every((particle) => particle.age < 1)).toBe(true)
    simulation.particles[0].age = 0.99
    simulation.advance(0.02)
    expect(simulation.particles[0].age).toBeLessThan(0.03)
    expect(simulation.particles[0].trail).toEqual([])
    expect(simulation.particles[1].trail).toHaveLength(1)
  })

  it('uses adjustable simulation time and bounded integration steps, and pauses in place', () => {
    const times: number[] = []
    const simulation = new ParticleSimulation(axes, { ...settings, count: 1, speed: 2 },
      ([x], time, dt) => { times.push(time); expect(dt).toBeLessThanOrEqual(0.01); return [x + dt] }, () => 0.5)
    simulation.advance(0.05)
    expect(simulation.time).toBeCloseTo(0.1)
    expect(simulation.particles[0].state[0]).toBeCloseTo(0.1)
    expect(times).toHaveLength(10)
    simulation.settings.playing = false
    simulation.advance(0.1)
    expect(simulation.time).toBeCloseTo(0.1)
    expect(simulation.particles[0].state[0]).toBeCloseTo(0.1)
  })

  it('respawns escaped and nonfinite states inside the full grid', () => {
    for (const output of [2, NaN, Infinity]) {
      const simulation = new ParticleSimulation(axes, settings, () => [output], () => 0.4)
      simulation.advance(0.05)
      expect(simulation.particles.every((particle) => particle.state[0] === -0.2 ||
        Math.abs(particle.state[0] + 0.2) < 1e-12)).toBe(true)
      expect(simulation.particles.every((particle) => particle.trail.length === 0)).toBe(true)
    }
  })

  it('caps tab catch-up and trail storage and resizes the population', () => {
    const simulation = new ParticleSimulation(axes, settings, (state) => state)
    for (let index = 0; index < 12; index++) simulation.advance(0.01)
    expect(simulation.particles.every((particle) => particle.trail.length <= 4)).toBe(true)
    const before = simulation.time
    simulation.advance(100)
    expect(simulation.time - before).toBeCloseTo(0.1)
    simulation.settings.count = 2
    simulation.advance(0)
    expect(simulation.particles).toHaveLength(2)
  })
})
