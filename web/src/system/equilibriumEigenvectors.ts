import type { EquilibriumEigenvectorRenderStyle } from './types'

export const DEFAULT_EQUILIBRIUM_EIGENVECTOR_RENDER: EquilibriumEigenvectorRenderStyle = {
  enabled: false,
}

export function resolveEquilibriumEigenvectorRender(
  render?: Partial<EquilibriumEigenvectorRenderStyle>
): EquilibriumEigenvectorRenderStyle {
  return {
    enabled: Boolean(render?.enabled ?? DEFAULT_EQUILIBRIUM_EIGENVECTOR_RENDER.enabled),
  }
}
