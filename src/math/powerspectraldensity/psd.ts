import { compile, evaluate, dot, fft } from 'mathjs'

import { Equation, Parameter } from '../../components/ODEEditor'
import rk4 from '../odesolvers/rk4'

const radius = 1e1 // Initial condition radius.

function getInitialCondition(equations: Equation[]): number[] {
  return equations.map(() => (Math.random() - 0.5) * radius * 2)
}

export function powerSpectralDensity(equations: Equation[],
                                     parameters: Parameter[],
                                     variable: string, // Timeseries variable of which to calculate PSD.
                                     dt: number = 1e-2, // Time step.
                                     maxSteps: number = 2**16, // Maximum total steps. Powers of 2 are most efficient for FFT.
                                     Ttr: number = 0 // Transient steps to discard.
                                    ): number[] {
  var point = getInitialCondition(equations)

  if (Ttr > 0) {
    // Evolve initial condition for Ttr steps to allow for transient decay.
    for (let i = 0; i < Ttr; i++) {
      point = rk4(equations, parameters, point, dt) as number[]
    }
  }

  const variableFunction = compile(variable)

  const projectionVector = equations.map(() => Math.random() - 0.5)
  const norm = Math.sqrt(projectionVector.reduce((sum, component) => sum + component * component, 0))
  const projectionAxis = projectionVector.map(component => component / norm)

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
    timeseries[i] = evaluate(variable, scope)

    // Evolve system one step.
    point = rk4(equations, parameters, point, dt) as number[]
  }

  // Compute power spectral density.
  const frequencyContributions = fft(timeseries).slice(0, Math.ceil(timeseries.length/2))
  const powerSpectralDensity = frequencyContributions.map(component => component.abs()**2)

  return powerSpectralDensity
}