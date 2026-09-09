import init, { WasmSystem } from '@fork-wasm'
import type { ParticleSettings, StateGridAxis, SystemConfig } from '../system/types'
import { periodicPeriodsForConfig } from '../system/periodicity'
import { ParticleSimulation } from './particleSimulation'

export type ParticleWorkerInput = { id: string; config: SystemConfig; axes: StateGridAxis[]; settings: ParticleSettings }
let simulations: Array<{ id: string; simulation: ParticleSimulation; runtime: WasmSystem }> = []
const ready = init()
self.onmessage = async (event: MessageEvent<
  | { type: 'init'; inputs: ParticleWorkerInput[] }
  | { type: 'frame'; seconds: number; settings: Record<string, ParticleSettings> }
>) => {
  try {
    await ready
    const message = event.data
    if (message.type === 'init') {
      simulations.forEach(({ runtime }) => runtime.free())
      simulations = message.inputs.map(({ id, config, axes, settings }) => {
        const runtime = new WasmSystem(config.equations, new Float64Array(config.params),
          config.paramNames, config.varNames, config.solver, 'flow')
        runtime.set_periods(new Float64Array(periodicPeriodsForConfig(config)))
        const simulation = new ParticleSimulation(axes, settings, (state, time, dt) => {
          runtime.set_state(new Float64Array(state))
          runtime.set_t(time)
          runtime.step(dt)
          return Array.from(runtime.get_state())
        })
        return { id, runtime, simulation }
      })
    } else {
      simulations.forEach(({ id, simulation }) => {
        if (message.settings[id]) simulation.settings = message.settings[id]
        simulation.advance(message.seconds)
      })
    }
    self.postMessage({ frames: simulations.map(({ id, simulation }) =>
      ({ id, particles: simulation.particles, time: simulation.time })) })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) })
  }
}
