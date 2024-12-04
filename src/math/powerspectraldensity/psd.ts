import { compile, evaluate, dot, fft, max } from 'mathjs'

import { Equation, Parameter } from '../../components/ODEEditor'
import rk4 from '../odesolvers/rk4'

const radius = 1e0 // Initial condition radius.

function getInitialCondition(equations: Equation[]): number[] {
  return equations.map(() => (Math.random() - 0.5) * radius * 2)
}

export function powerSpectralDensity(equations: Equation[],
                                     parameters: Parameter[],
                                     variable: string, // Timeseries variable of which to calculate PSD.
                                     dt: number = 1e-2, // Time step.
                                     maxSteps: number = 2**16, // Maximum total steps. Powers of 2 are most efficient for FFT.
                                     Ttr: number = 0 // Transient steps to discard.
                                    ): [number[], number[]] {
  var point = getInitialCondition(equations)

  if (Ttr > 0) {
    // Evolve initial condition for Ttr steps to allow for transient decay.
    for (let i = 0; i < Ttr; i++) {
      point = rk4(equations, parameters, point, dt) as number[]
    }
  }

  const variableFunction = compile(variable)

  // Initialize array to store projected timeseries.
  const timeseries: number[] = new Array(maxSteps)

  // Evolve system and record projections.
  for (let i = 0; i < maxSteps; i++) {
    // Calculate timeseries variable from current state.
    const scope: { [key: string]: number } = {}
    equations.forEach((eq, i) => {
      scope[eq.variable] = point[i]
    })
    parameters.forEach((param, _) => {
      scope[param.name] = param.value
    })
    timeseries[i] = variableFunction.evaluate(scope)

    // Evolve system one step.
    point = rk4(equations, parameters, point, dt) as number[]
  }

  // Compute power spectral density.
  const nyquistIndex = Math.ceil(timeseries.length/2)
  const frequencyContributions = fft(timeseries).slice(0, nyquistIndex)
  const powerSpectralDensity = frequencyContributions.map(component => component.abs()**2 * 2 * dt / nyquistIndex)
  powerSpectralDensity[0] /= 2
  powerSpectralDensity[powerSpectralDensity.length - 1] /= 2

  return [timeseries, powerSpectralDensity]
}