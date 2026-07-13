const CLI_SAFE_NAME = /^[a-zA-Z0-9_]+$/

export const DEFAULT_NAME_MAX_LENGTH = 48

export type DefaultNameKind =
  | 'orbit'
  | 'equilibrium'
  | 'isocline'
  | 'folder'
  | 'scene'
  | 'bifurcationDiagram'
  | 'analysisViewport'
  | 'equilibriumContinuation'
  | 'branchContinuation'
  | 'continuationBranch'
  | 'manifold1d'
  | 'manifold2d'
  | 'limitCycle'
  | 'periodDoubledCycle'
  | 'foldCurve'
  | 'hopfCurve'
  | 'isoperiodicCurve'
  | 'nsCurve'
  | 'homoclinic'
  | 'homoclinicRestart'
  | 'homotopySaddle'
  | 'homoclinicStageD'

export type DefaultNameOptions = {
  sourceName?: string
  parameterName?: string
  pointIndex?: number
  entityLabel?: string
  existingNames?: Iterable<string>
}

const INDEXED_LABELS: Partial<Record<DefaultNameKind, string>> = {
  orbit: 'Orbit',
  equilibrium: 'Equilibrium',
  isocline: 'Isocline',
  folder: 'Folder',
  scene: 'Scene',
  bifurcationDiagram: 'Bifurcation_Diagram',
  analysisViewport: 'Event_Map',
}

// Operation names describe how an entity was produced, not the identity worth
// carrying through every later generation. Remove them when a new operation
// supplies its own semantic prefix.
const INHERITED_OPERATION_PREFIXES = [
  'homotopy_saddle',
  'isoperiodic_curve',
  'fold_curve',
  'hopf_curve',
  'ns_curve',
  'cycle_pd',
  'lc_pd',
  'manifold',
  'homotopy',
  'isoperiodic',
  'homoc',
  'fold',
  'hopf',
  'ns',
]

function normalizeNameFragment(value: string): string {
  return toCliSafeName(value).replace(/_+/g, '_').replace(/^_+|_+$/g, '')
}

function compactNameFragment(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  if (maxLength <= 1) return value.slice(0, Math.max(0, maxLength))
  const tailLength = Math.min(12, Math.max(3, Math.floor((maxLength - 1) / 3)))
  const headLength = Math.max(1, maxLength - tailLength - 1)
  const head = value.slice(0, headLength).replace(/_+$/g, '')
  const tail = value.slice(-tailLength).replace(/^_+/g, '')
  return `${head}_${tail}`.slice(0, maxLength).replace(/_+$/g, '')
}

function sourceIdentity(value: string): string {
  let source = normalizeNameFragment(value)
  let changed = true
  while (changed && source) {
    changed = false
    const lower = source.toLowerCase()
    for (const prefix of INHERITED_OPERATION_PREFIXES) {
      const marker = `${prefix}_`
      if (lower === prefix) {
        source = ''
        changed = true
        break
      }
      if (lower.startsWith(marker)) {
        source = source.slice(marker.length)
        changed = true
        break
      }
    }
  }
  return source
    .replace(/_(?:from_homoc|stage_d|staged|restart)$/i, '')
    .replace(/^_+|_+$/g, '')
}

function composeDerivedName(
  prefix: string[],
  sourceName: string,
  suffix: string[] = []
): string {
  const fixedPrefix = prefix.map(normalizeNameFragment).filter(Boolean)
  const fixedSuffix = suffix
    .map(normalizeNameFragment)
    .filter(Boolean)
    .map((part) => compactNameFragment(part, 14))
  const source = normalizeNameFragment(sourceName) || 'entity'
  const fixedLength = [...fixedPrefix, ...fixedSuffix].reduce(
    (total, part) => total + part.length,
    0
  )
  const separatorCount = fixedPrefix.length + fixedSuffix.length
  const sourceBudget = Math.max(8, DEFAULT_NAME_MAX_LENGTH - fixedLength - separatorCount)
  const compactSource = compactNameFragment(source, sourceBudget)
  const parts = [...fixedPrefix, compactSource]
  for (const suffixPart of fixedSuffix) {
    const current = parts.join('_').toLowerCase()
    if (current === suffixPart.toLowerCase() || current.endsWith(`_${suffixPart.toLowerCase()}`)) {
      continue
    }
    parts.push(suffixPart)
  }
  return compactNameFragment(parts.join('_'), DEFAULT_NAME_MAX_LENGTH)
}

function reserveName(
  baseName: string,
  existingNames: Iterable<string> | undefined,
  startIndex?: number
): string {
  const existing = new Set(existingNames ?? [])
  if (startIndex === undefined && !existing.has(baseName)) return baseName
  let index = startIndex ?? 2
  while (true) {
    const suffix = `_${index}`
    const candidate = `${compactNameFragment(
      baseName,
      DEFAULT_NAME_MAX_LENGTH - suffix.length
    )}${suffix}`
    if (!existing.has(candidate)) return candidate
    index += 1
  }
}

export function isCliSafeName(name: string): boolean {
  return CLI_SAFE_NAME.test(name)
}

export function toCliSafeName(name: string): string {
  return name.trim().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '_')
}

/**
 * Produces the app-owned default for any newly created tree entity.
 * User-entered names remain untouched; this policy only governs automatic
 * suggestions and collision suffixes.
 */
export function suggestDefaultName(
  kind: DefaultNameKind,
  options: DefaultNameOptions = {}
): string {
  const indexedLabel = INDEXED_LABELS[kind]
  if (indexedLabel) {
    const label = normalizeNameFragment(options.entityLabel ?? indexedLabel) || indexedLabel
    return reserveName(label, options.existingNames, 1)
  }

  const rawSource = options.sourceName ?? ''
  const source =
    kind === 'equilibriumContinuation' ||
    kind === 'branchContinuation' ||
    kind === 'continuationBranch' ||
    kind === 'manifold1d' ||
    kind === 'manifold2d'
      ? normalizeNameFragment(rawSource)
      : sourceIdentity(rawSource)
  const parameter = options.parameterName ?? ''
  let baseName: string

  switch (kind) {
    case 'equilibriumContinuation':
    case 'branchContinuation':
    case 'continuationBranch':
      baseName = composeDerivedName([], source || 'branch', parameter ? [parameter] : [])
      break
    case 'manifold1d':
      baseName = composeDerivedName(['manifold'], source || 'equilibrium', ['1d'])
      break
    case 'manifold2d':
      baseName = composeDerivedName(['manifold'], source || 'object', ['2d'])
      break
    case 'limitCycle':
      baseName = composeDerivedName(['LC'], source || 'source')
      break
    case 'periodDoubledCycle': {
      const label = normalizeNameFragment(options.entityLabel ?? 'LC') || 'LC'
      const pointIndex = Number.isFinite(options.pointIndex)
        ? Math.max(0, Math.trunc(options.pointIndex as number))
        : 0
      baseName = source
        ? composeDerivedName([label, 'PD'], source, [`pt${pointIndex}`])
        : composeDerivedName([label, 'PD'], `pt${pointIndex}`)
      break
    }
    case 'foldCurve':
      baseName = composeDerivedName(['fold'], source || 'branch')
      break
    case 'hopfCurve':
      baseName = composeDerivedName(['hopf'], source || 'branch')
      break
    case 'isoperiodicCurve':
      baseName = composeDerivedName(['isoperiodic'], source || 'branch')
      break
    case 'nsCurve':
      baseName = composeDerivedName(['ns'], source || 'branch')
      break
    case 'homoclinic':
      baseName = composeDerivedName(['homoc'], source || 'branch')
      break
    case 'homoclinicRestart':
      baseName = composeDerivedName(['homoc'], source || 'branch', ['restart'])
      break
    case 'homotopySaddle':
      baseName = composeDerivedName(['homotopy_saddle'], source || 'branch')
      break
    case 'homoclinicStageD':
      baseName = composeDerivedName(['homoc'], source || 'branch', ['stageD'])
      break
    default:
      baseName = composeDerivedName([], source || 'Entity')
      break
  }

  return reserveName(baseName, options.existingNames)
}
