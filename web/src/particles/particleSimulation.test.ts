import { describe, expect, it } from 'vitest'
import { ParticleSimulation, particleGridSeeds, normalizeParticleSettings } from './particleSimulation'
import type { ParticleSettings } from '../system/types'

const settings: ParticleSettings = { mode: 'bounded', speed: 1, lifetime: 1,
  integrationStep: 0.01, trailLength: 4, playing: true }
const axes = [{ variableName: 'x', min: -1, max: 1, resolution: 4 }]

describe('particle evolution', () => {
  it('uses every Cartesian grid center in scene order, including degenerate and frozen axes', () => {
    expect(particleGridSeeds([
      { variableName: 'x', min: 0, max: 2, resolution: 2 },
      { variableName: 'y', min: -3, max: 3, resolution: 3 },
      { variableName: 'z', min: 7, max: 7, resolution: 1 },
    ])).toEqual([[0.5, -2, 7], [0.5, 0, 7], [0.5, 2, 7], [1.5, -2, 7], [1.5, 0, 7], [1.5, 2, 7]])
    const legacy = { ...settings, count: 2 }
    const simulation = new ParticleSimulation(axes, legacy, (state) => state)
    expect(simulation.particles.map((particle) => particle.state)).toEqual([[-0.75], [-0.25], [0.25], [0.75]])
    expect(normalizeParticleSettings(legacy)).not.toHaveProperty('count')
  })

  it('staggers initial lifetimes and resets expired particles to their own grid point', () => {
    let seed = 0
    const simulation = new ParticleSimulation(axes, settings, (state) => state,
      () => ((seed++ % 10) + 0.5) / 10)
    expect(new Set(simulation.particles.map((particle) => particle.age)).size).toBe(4)
    expect(simulation.particles.every((particle) => particle.age < 1)).toBe(true)
    simulation.particles[0].state = [0.9]
    simulation.particles[0].age = 0.99
    simulation.advance(0.02)
    expect(simulation.particles[0].age).toBeLessThan(0.03)
    expect(simulation.particles[0].state).toEqual([-0.75])
    expect(simulation.particles[0].trail).toEqual([])
    expect(simulation.particles[1].trail).toHaveLength(1)
  })

  it('uses adjustable simulation time and bounded integration steps, and pauses in place', () => {
    const times: number[] = []
    const simulation = new ParticleSimulation([{ ...axes[0], resolution: 1 }], { ...settings, speed: 2 },
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

  it('returns escaped and nonfinite bounded trajectories to their respective grid seeds', () => {
    for (const output of [2, NaN, Infinity]) {
      const simulation = new ParticleSimulation(axes, settings, () => [output])
      simulation.advance(0.05)
      expect(simulation.particles.map((particle) => particle.state)).toEqual(simulation.seeds)
      expect(simulation.particles.every((particle) => particle.trail.length === 0)).toBe(true)
    }
  })

  it('lets continuous trajectories cross bounds and exceed lifetimes without respawning', () => {
    const simulation = new ParticleSimulation(axes, { ...settings, mode: 'continuous', lifetime: 0.1 },
      ([x], _time, dt) => [x + 10 * dt])
    for (let index = 0; index < 20; index++) simulation.advance(0.1)
    simulation.particles.forEach((particle, index) => {
      expect(particle.state[0]).toBeCloseTo(simulation.seeds[index][0] + 20)
      expect(particle.age).toBeCloseTo(2)
      expect(particle.trail).toHaveLength(4)
    })
    simulation.settings = { ...simulation.settings, playing: false, resetRevision: 1 }
    simulation.advance(0.1)
    expect(simulation.time).toBe(0)
    expect(simulation.particles.map((particle) => particle.state)).toEqual(simulation.seeds)
    expect(simulation.particles.every((particle) => particle.trail.length === 0)).toBe(true)
    simulation.settings.mode = 'bounded'
    simulation.advance(0)
    expect(simulation.particles.map((particle) => particle.state)).toEqual(simulation.seeds)
  })

  it('retains the last finite continuous state instead of respawning on numerical divergence', () => {
    const simulation = new ParticleSimulation(axes, { ...settings, mode: 'continuous' }, () => [Infinity])
    simulation.particles[0].state = [3]
    simulation.advance(0.1)
    expect(simulation.particles[0]).toMatchObject({ state: [3], stopped: true })
    simulation.advance(0.1)
    expect(simulation.particles[0].state).toEqual([3])
  })

  it('caps tab catch-up and trail storage and rejects unsafe grid sizes without subsampling', () => {
    const simulation = new ParticleSimulation(axes, settings, (state) => state)
    for (let index = 0; index < 12; index++) simulation.advance(0.01)
    expect(simulation.particles.every((particle) => particle.trail.length <= 4)).toBe(true)
    const before = simulation.time
    simulation.advance(100)
    expect(simulation.time - before).toBeCloseTo(0.1)
    expect(() => particleGridSeeds([{ ...axes[0], resolution: 100_001 }])).toThrow('Reduce the source grid resolutions')
  })
})
