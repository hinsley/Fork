import { parseConstantExpression } from './constantExpression'

export type SystemStringDefinition = {
  varNames: string[]
  equations: string[]
  paramNames: string[]
  params: number[]
}

const IDENTIFIER = '[a-zA-Z_][a-zA-Z0-9_]*'
const EQUATION_LINE = new RegExp(`^(${IDENTIFIER})\\s*'\\s*=\\s*(.*)$`)
const PARAMETER_LINE = new RegExp(`^(${IDENTIFIER})\\s*=\\s*(.*)$`)

type DefinedName = {
  kind: 'variable' | 'parameter'
  line: number
}

function lineError(line: number, message: string): never {
  throw new Error(`Line ${line}: ${message}`)
}

function recordName(
  definitions: Map<string, DefinedName>,
  name: string,
  kind: DefinedName['kind'],
  line: number
): void {
  const previous = definitions.get(name)
  if (!previous) {
    definitions.set(name, { kind, line })
    return
  }

  if (previous.kind === kind) {
    lineError(line, `${kind} "${name}" is already defined on line ${previous.line}.`)
  }
  lineError(line, `"${name}" is already defined as a ${previous.kind} on line ${previous.line}.`)
}

export function parseSystemString(input: string): SystemStringDefinition {
  const result: SystemStringDefinition = {
    varNames: [],
    equations: [],
    paramNames: [],
    params: [],
  }
  const definitions = new Map<string, DefinedName>()

  input.split(/\r\n?|\n/).forEach((rawLine, index) => {
    const lineNumber = index + 1
    const line = rawLine.trim()
    if (!line) return

    const assignmentCount = [...line].filter((character, characterIndex) => {
      if (character !== '=') return false
      const previous = line[characterIndex - 1]
      const next = line[characterIndex + 1]
      return previous !== '<' && previous !== '>' && previous !== '!' && previous !== '=' && next !== '='
    }).length
    if (assignmentCount !== 1) {
      lineError(lineNumber, 'expected exactly one assignment separator (=).')
    }

    const equationMatch = EQUATION_LINE.exec(line)
    if (equationMatch) {
      const name = equationMatch[1]
      const equation = equationMatch[2].trim()
      if (!equation) lineError(lineNumber, `equation for "${name}" cannot be empty.`)
      recordName(definitions, name, 'variable', lineNumber)
      result.varNames.push(name)
      result.equations.push(equation)
      return
    }

    const parameterMatch = PARAMETER_LINE.exec(line)
    if (parameterMatch) {
      const name = parameterMatch[1]
      const rawValue = parameterMatch[2].trim()
      const value = parseConstantExpression(rawValue)
      if (value === null) {
        lineError(lineNumber, `parameter "${name}" must have a finite constant expression.`)
      }
      recordName(definitions, name, 'parameter', lineNumber)
      result.paramNames.push(name)
      result.params.push(value)
      return
    }

    lineError(
      lineNumber,
      "expected <variable>' = <equation> or <parameter> = <number>."
    )
  })

  if (result.varNames.length === 0) {
    throw new Error(
      "A system string must contain at least one <variable>' = <equation> line."
    )
  }

  return result
}

function formatNumber(value: number): string {
  return Object.is(value, -0) ? '-0' : String(value)
}

export function formatSystemString(definition: SystemStringDefinition): string {
  if (definition.varNames.length !== definition.equations.length) {
    throw new Error('Cannot format a system string with mismatched variables and equations.')
  }
  if (definition.paramNames.length !== definition.params.length) {
    throw new Error('Cannot format a system string with mismatched parameter names and values.')
  }
  if (definition.params.some((value) => !Number.isFinite(value))) {
    throw new Error('Cannot format a system string with a non-finite parameter value.')
  }

  const lines = definition.varNames.map(
    (name, index) => `${name}' = ${definition.equations[index]}`
  )
  definition.paramNames.forEach((name, index) => {
    lines.push(`${name} = ${formatNumber(definition.params[index])}`)
  })

  const formatted = lines.join('\n')
  parseSystemString(formatted)
  return formatted
}
