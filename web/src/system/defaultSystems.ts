import { createSystem } from './model'
import type { System, SystemConfig } from './types'

type DefaultSystemSpec = SystemConfig

const tanh = (value: string) =>
  `(exp(${value}) - exp(-(${value}))) / (exp(${value}) + exp(-(${value})))`

// Morris-Lecar uses tanh/cosh; expand them into exp-only forms for the parser.
const morrisLecarMInf = `0.5 * (1 + ${tanh('(V - V1) / V2')})`
const morrisLecarWInf = `0.5 * (1 + ${tanh('(V - V3) / V4')})`
const morrisLecarTauW =
  '2 / (exp((V - V3) / (2 * V4)) + exp(-((V - V3) / (2 * V4))))'

const DEFAULT_SYSTEM_SPECS: DefaultSystemSpec[] = [
  {
    name: 'Lorenz',
    equations: ['sigma * (y - x)', 'x * (rho - z) - y', 'x * y - beta * z'],
    params: [10, 28, 2.6666666667],
    paramNames: ['sigma', 'rho', 'beta'],
    varNames: ['x', 'y', 'z'],
    solver: 'rk4',
    type: 'flow',
  },
  {
    name: 'Henon',
    equations: ['1 - a * x^2 + y', 'b * x'],
    params: [1.4, 0.3],
    paramNames: ['a', 'b'],
    varNames: ['x', 'y'],
    solver: 'discrete',
    type: 'map',
  },
  {
    name: 'Rossler',
    equations: ['-y - z', 'x + a * y', 'b + z * (x - c)'],
    params: [0.2, 0.2, 5.7],
    paramNames: ['a', 'b', 'c'],
    varNames: ['x', 'y', 'z'],
    solver: 'rk4',
    type: 'flow',
  },
  {
    name: 'Thomas',
    equations: ['sin(y) - b * x', 'sin(z) - b * y', 'sin(x) - b * z'],
    params: [0.208186],
    paramNames: ['b'],
    varNames: ['x', 'y', 'z'],
    solver: 'rk4',
    type: 'flow',
  },
  {
    name: 'Langford',
    equations: [
      '(z - b) * x - d * y',
      'd * x + (z - b) * y',
      'c + a * z - z^3 / 3 - (x^2 + y^2) * (1 + e * z) + f * z * x^3',
    ],
    params: [0.95, 0.7, 0.6, 3.5, 0.25, 0.1],
    paramNames: ['a', 'b', 'c', 'd', 'e', 'f'],
    varNames: ['x', 'y', 'z'],
    solver: 'rk4',
    type: 'flow',
  },
  {
    name: 'Logistic',
    equations: ['r * x * (1 - x)'],
    params: [3.9],
    paramNames: ['r'],
    varNames: ['x'],
    solver: 'discrete',
    type: 'map',
  },
  {
    name: 'Tent',
    equations: ['mu * (0.5 - (((x - 0.5) ^ 2) ^ 0.5))'],
    params: [2],
    paramNames: ['mu'],
    varNames: ['x'],
    solver: 'discrete',
    type: 'map',
  },
  {
    name: 'FitzHughNagumo',
    equations: ['v - (v^3) / 3 - w + I', '(v + a - b * w) / tau'],
    params: [0.7, 0.8, 12.5, 0.5],
    paramNames: ['a', 'b', 'tau', 'I'],
    varNames: ['v', 'w'],
    solver: 'rk4',
    type: 'flow',
  },
  {
    name: 'HindmarshRose',
    equations: [
      'y - a * x^3 + b * x^2 - z + I',
      'c - d * x^2 - y',
      'r * (s * (x - xR) - z)',
    ],
    params: [1, 3, 1, 5, 0.006, 4, -1.6, 3.25],
    paramNames: ['a', 'b', 'c', 'd', 'r', 's', 'xR', 'I'],
    varNames: ['x', 'y', 'z'],
    solver: 'rk4',
    type: 'flow',
  },
  {
    name: 'MorrisLecar',
    equations: [
      `(I - g_L * (V - V_L) - g_Ca * (${morrisLecarMInf}) * (V - V_Ca) - g_K * w * (V - V_K)) / C`,
      `(${morrisLecarWInf} - w) / (${morrisLecarTauW})`,
    ],
    params: [20, 2, 4.4, 8, -60, 120, -84, -1.2, 18, 2, 30, 90],
    paramNames: [
      'C',
      'g_L',
      'g_Ca',
      'g_K',
      'V_L',
      'V_Ca',
      'V_K',
      'V1',
      'V2',
      'V3',
      'V4',
      'I',
    ],
    varNames: ['V', 'w'],
    solver: 'rk4',
    type: 'flow',
  },
  {
    name: 'Lorenz84',
    equations: [
      '-a * x - y^2 - z^2 + a * F',
      'x * y - b * x * z - y + G',
      'b * x * y + x * z - z',
    ],
    params: [0.25, 4, 8, 1],
    paramNames: ['a', 'b', 'F', 'G'],
    varNames: ['x', 'y', 'z'],
    solver: 'rk4',
    type: 'flow',
  },
]

function cloneSystemConfig(config: SystemConfig): SystemConfig {
  return {
    ...config,
    equations: [...config.equations],
    params: [...config.params],
    paramNames: [...config.paramNames],
    varNames: [...config.varNames],
  }
}

export function createDefaultSystems(): System[] {
  return DEFAULT_SYSTEM_SPECS.map((spec) =>
    createSystem({ name: spec.name, config: cloneSystemConfig(spec) })
  )
}
