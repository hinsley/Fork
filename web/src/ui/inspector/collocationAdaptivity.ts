export type CollocationAdaptivityDraft = {
  adaptiveCollocationEnabled?: boolean
  adaptiveRedistributionEnabled?: boolean
  adaptiveDefectTolerance?: string
  adaptiveMaxRefinements?: string
  adaptiveMaxMeshPoints?: string
}

function parseExactInteger(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  const parsed = Number(trimmed)
  return Number.isInteger(parsed) ? parsed : null
}

export function buildCollocationAdaptivitySettings(draft: CollocationAdaptivityDraft) {
  const enabled = draft.adaptiveCollocationEnabled ?? true
  if (!enabled) {
    return {
      enabled: false,
      redistribution_enabled: draft.adaptiveRedistributionEnabled ?? true,
      defect_tolerance: 0.025,
      max_refinements: 3,
      max_mesh_points: 512,
    }
  }
  const defectTolerance = Number(draft.adaptiveDefectTolerance ?? '0.025')
  const maxRefinements = parseExactInteger(draft.adaptiveMaxRefinements ?? '3')
  const maxMeshPoints = parseExactInteger(draft.adaptiveMaxMeshPoints ?? '512')
  if (
    !Number.isFinite(defectTolerance) ||
    defectTolerance <= 0 ||
    maxRefinements === null ||
    maxRefinements < 0 ||
    maxMeshPoints === null ||
    maxMeshPoints < 2
  ) {
    return null
  }
  return {
    enabled,
    redistribution_enabled: draft.adaptiveRedistributionEnabled ?? true,
    defect_tolerance: defectTolerance,
    max_refinements: maxRefinements,
    max_mesh_points: maxMeshPoints,
  }
}
