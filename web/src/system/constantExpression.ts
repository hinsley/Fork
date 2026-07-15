const CONSTANTS: Readonly<Record<string, number>> = {
  pi: Math.PI,
  tau: Math.PI * 2,
  e: Math.E,
}

class ConstantExpressionParser {
  private position = 0
  private readonly input: string

  constructor(input: string) {
    this.input = input
  }

  parse(): number | null {
    const value = this.parseExpression()
    this.skipWhitespace()
    return value !== null && this.position === this.input.length && Number.isFinite(value)
      ? value
      : null
  }

  private parseExpression(): number | null {
    let value = this.parseTerm()
    if (value === null) return null

    while (true) {
      if (this.consume('+')) {
        const right = this.parseTerm()
        if (right === null) return null
        value += right
      } else if (this.consume('-')) {
        const right = this.parseTerm()
        if (right === null) return null
        value -= right
      } else {
        return value
      }
    }
  }

  private parseTerm(): number | null {
    let value = this.parsePower()
    if (value === null) return null

    while (true) {
      if (this.consume('*')) {
        const right = this.parsePower()
        if (right === null) return null
        value *= right
      } else if (this.consume('/')) {
        const right = this.parsePower()
        if (right === null) return null
        value /= right
      } else {
        return value
      }
    }
  }

  private parsePower(): number | null {
    let value = this.parseUnary()
    if (value === null) return null

    while (this.consume('^')) {
      const exponent = this.parseUnary()
      if (exponent === null) return null
      value = value ** exponent
    }
    return value
  }

  private parseUnary(): number | null {
    if (this.consume('+')) return this.parseUnary()
    if (this.consume('-')) {
      const value = this.parseUnary()
      return value === null ? null : -value
    }
    return this.parsePrimary()
  }

  private parsePrimary(): number | null {
    if (this.consume('(')) {
      const value = this.parseExpression()
      return value !== null && this.consume(')') ? value : null
    }

    this.skipWhitespace()
    const remaining = this.input.slice(this.position)
    const numberMatch = /^(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?/.exec(remaining)
    if (numberMatch) {
      this.position += numberMatch[0].length
      return Number(numberMatch[0])
    }

    const identifierMatch = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(remaining)
    if (!identifierMatch) return null
    this.position += identifierMatch[0].length
    return CONSTANTS[identifierMatch[0]] ?? null
  }

  private consume(expected: string): boolean {
    this.skipWhitespace()
    if (this.input[this.position] !== expected) return false
    this.position += 1
    return true
  }

  private skipWhitespace(): void {
    while (/\s/.test(this.input[this.position] ?? '')) this.position += 1
  }
}

/** Evaluates a finite, constant-only arithmetic expression. */
export function parseConstantExpression(value: string): number | null {
  if (value.trim().length === 0) return null
  return new ConstantExpressionParser(value).parse()
}
