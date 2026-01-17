import type { SystemConfig } from '../system/types'
import { isCliSafeName } from '../utils/naming'

const IDENTIFIER_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/

export type SystemValidation = {
  valid: boolean
  errors: {
    name?: string
    varNames?: string
    paramNames?: string
    equations?: string[]
    params?: string[]
    solver?: string
  }
  warnings: string[]
}

export const validateSystemName = (name: string): string | null => {
  if (!name.trim()) return 'System name is required.'
  if (!isCliSafeName(name)) {
    return 'System name must contain only letters, numbers, and underscores.'
  }
  return null
}

export const validateSystemConfig = (system: SystemConfig): SystemValidation => {
  const errors: SystemValidation['errors'] = {}
  const warnings: string[] = []

  const nameError = validateSystemName(system.name)
  if (nameError) {
    errors.name = nameError
  }

  if (system.varNames.some((name) => name.trim().length === 0)) {
    errors.varNames = 'Variable names cannot be empty.'
  }
  const varNames = system.varNames.map((name) => name.trim()).filter((name) => name.length > 0)
  if (varNames.length === 0) {
    errors.varNames = 'At least one variable is required.'
  } else if (!errors.varNames) {
    const invalidVars = varNames.filter((name) => !IDENTIFIER_REGEX.test(name))
    if (invalidVars.length > 0) {
      errors.varNames = `Invalid variable names: ${invalidVars.join(', ')}.`
    } else {
      const duplicateVars = varNames.filter((name, index) => varNames.indexOf(name) !== index)
      if (duplicateVars.length > 0) {
        errors.varNames = `Duplicate variable names: ${[
          ...new Set(duplicateVars),
        ].join(', ')}.`
      }
    }
  }

  if (system.paramNames.some((name) => name.trim().length === 0)) {
    errors.paramNames = 'Parameter names cannot be empty.'
  }
  if (system.paramNames.length > 0 && !errors.paramNames) {
    const invalidParams = system.paramNames.filter((name) => !IDENTIFIER_REGEX.test(name))
    if (invalidParams.length > 0) {
      errors.paramNames = `Invalid parameter names: ${invalidParams.join(', ')}.`
    } else {
      const duplicateParams = system.paramNames.filter(
        (name, index) => system.paramNames.indexOf(name) !== index
      )
      if (duplicateParams.length > 0) {
        errors.paramNames = `Duplicate parameter names: ${[
          ...new Set(duplicateParams),
        ].join(', ')}.`
      }
    }
  }

  const equationErrors: string[] = []
  for (let i = 0; i < system.varNames.length; i += 1) {
    const eq = system.equations[i]
    if (!eq || !eq.trim()) {
      equationErrors[i] = 'Equation required.'
    }
  }
  if (equationErrors.some(Boolean)) {
    errors.equations = equationErrors
  }

  if (system.paramNames.length !== system.params.length) {
    errors.params = system.paramNames.map(() => 'Parameter count mismatch.')
  } else if (system.params.some((value) => !Number.isFinite(value))) {
    errors.params = system.params.map((value) =>
      Number.isFinite(value) ? '' : 'Parameter must be numeric.'
    )
  }

  if (system.type === 'map' && system.solver !== 'discrete') {
    errors.solver = 'Map systems must use the discrete solver.'
  }
  if (system.type === 'flow' && !['rk4', 'tsit5'].includes(system.solver)) {
    errors.solver = 'Flow systems must use rk4 or tsit5.'
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    warnings,
  }
}
