import { describe, expect, it } from 'vitest'
import { parseConstantExpression } from './constantExpression'

describe('constant expressions', () => {
  it('evaluates finite arithmetic expressions with mathematical constants', () => {
    expect(parseConstantExpression('pi')).toBeCloseTo(Math.PI)
    expect(parseConstantExpression('tau / 4')).toBeCloseTo(Math.PI / 2)
    expect(parseConstantExpression('2*pi + e^2 - tau/4')).toBeCloseTo(
      2 * Math.PI + Math.E ** 2 - Math.PI / 2
    )
    expect(parseConstantExpression('-(pi - e)')).toBeCloseTo(-(Math.PI - Math.E))
  })

  it('rejects symbols, implicit multiplication, malformed input, and non-finite results', () => {
    for (const expression of ['', 'x', '2pi', 'pi +', '1 / 0', '1e309']) {
      expect(parseConstantExpression(expression), expression).toBeNull()
    }
  })
})
