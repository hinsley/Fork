import type { Manifold2DProfile } from '../system/types'

export type EquilibriumManifoldProfileDraft =
  | 'adaptive_global'
  | 'local_preview'
  | 'lorenz_global'

export type SurfaceProfileDefaults = {
  initialRadius: string
  targetRadius: string
  leafDelta: string
  deltaMin: string
  ringPoints: string
  minSpacing: string
  maxSpacing: string
  alphaMin: string
  alphaMax: string
  deltaAlphaMin: string
  deltaAlphaMax: string
  integrationDt: string
  targetArclength: string
  caps: {
    maxSteps: string
    maxPoints: string
    maxRings: string
    maxVertices: string
    maxTime: string
    maxIterations: string
  }
}

export function toManifold2DProfile(profile: EquilibriumManifoldProfileDraft): Manifold2DProfile {
  switch (profile) {
    case 'adaptive_global':
      return 'AdaptiveGlobal'
    case 'local_preview':
      return 'LocalPreview'
    case 'lorenz_global':
      return 'LorenzGlobalKo'
  }
}

export function makeSurfaceProfileDefaults(
  profile: EquilibriumManifoldProfileDraft
): SurfaceProfileDefaults {
  if (profile === 'adaptive_global') {
    return {
      initialRadius: '0.2',
      targetRadius: '20',
      leafDelta: '0.2',
      deltaMin: '0.001',
      ringPoints: '32',
      minSpacing: '0.05',
      maxSpacing: '0.5',
      alphaMin: '0.3',
      alphaMax: '0.4',
      deltaAlphaMin: '0.01',
      deltaAlphaMax: '1.0',
      integrationDt: '0.005',
      targetArclength: '60',
      caps: {
        maxSteps: '1500',
        maxPoints: '8000',
        maxRings: '240',
        maxVertices: '200000',
        maxTime: '200',
        maxIterations: '',
      },
    }
  }
  if (profile === 'lorenz_global') {
    return {
      initialRadius: '1.0',
      targetRadius: '40',
      leafDelta: '1.0',
      deltaMin: '0.01',
      ringPoints: '20',
      minSpacing: '0.25',
      maxSpacing: '2.0',
      alphaMin: '0.3',
      alphaMax: '0.4',
      deltaAlphaMin: '0.01',
      deltaAlphaMax: '1.0',
      integrationDt: '0.001',
      targetArclength: '100',
      caps: {
        maxSteps: '2000',
        maxPoints: '8000',
        maxRings: '200',
        maxVertices: '200000',
        maxTime: '200',
        maxIterations: '',
      },
    }
  }
  return {
    initialRadius: '1e-3',
    targetRadius: '5',
    leafDelta: '0.002',
    deltaMin: '0.001',
    ringPoints: '48',
    minSpacing: '0.00134',
    maxSpacing: '0.004',
    alphaMin: '0.3',
    alphaMax: '0.4',
    deltaAlphaMin: '0.1',
    deltaAlphaMax: '1.0',
    integrationDt: '0.01',
    targetArclength: '10',
    caps: {
      maxSteps: '300',
      maxPoints: '8000',
      maxRings: '240',
      maxVertices: '50000',
      maxTime: '200',
      maxIterations: '',
    },
  }
}
