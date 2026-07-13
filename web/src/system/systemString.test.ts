import { describe, expect, it } from 'vitest'
import { formatSystemString, parseSystemString } from './systemString'

describe('system strings', () => {
  it('parses equations and numeric parameters with flexible whitespace', () => {
    expect(
      parseSystemString("  x'=-x + sigma*y\r\n\ty ' = x\t\n sigma= 1.25e-2 \n offset = -.5 ")
    ).toEqual({
      varNames: ['x', 'y'],
      equations: ['-x + sigma*y', 'x'],
      paramNames: ['sigma', 'offset'],
      params: [0.0125, -0.5],
    })
  })

  it('allows equations and parameters in any order while preserving their own order', () => {
    expect(parseSystemString("b = 2\ny' = x\na = 1\nx' = y")).toEqual({
      varNames: ['y', 'x'],
      equations: ['x', 'y'],
      paramNames: ['b', 'a'],
      params: [2, 1],
    })
  })

  it('requires the prime marker to classify an equation', () => {
    expect(() => parseSystemString('x = y')).toThrow(
      'Line 1: parameter "x" must have a finite numeric value.'
    )
  })

  it.each([
    ["x' = -x\nx' = x", 'Line 2: variable "x" is already defined on line 1.'],
    ['a = 1\na = 2', 'Line 2: parameter "a" is already defined on line 1.'],
    ["x' = -x\nx = 1", 'Line 2: "x" is already defined as a variable on line 1.'],
    ["x' = -x = 1", 'Line 1: expected exactly one assignment separator (=).'],
    ["x'' = -x", "Line 1: expected <variable>' = <equation> or <parameter> = <number>."],
    ["x' =", 'Line 1: equation for "x" cannot be empty.'],
    ['rate = 1ms', 'Line 1: parameter "rate" must have a finite numeric value.'],
    ['rate = 1e309', 'Line 1: parameter "rate" must have a finite numeric value.'],
    ['not-a-name = 1', "Line 1: expected <variable>' = <equation> or <parameter> = <number>."],
  ])('rejects ambiguous or incomplete input: %s', (input, message) => {
    expect(() => parseSystemString(input)).toThrow(message)
  })

  it('requires at least one governing equation', () => {
    expect(() => parseSystemString('\n a = 1\n')).toThrow(
      "A system string must contain at least one <variable>' = <equation> line."
    )
  })

  it('formats a canonical string that round-trips through the parser', () => {
    const definition = {
      varNames: ['x', 'y'],
      equations: ['sigma * (y - x)', 'x - rho * y'],
      paramNames: ['sigma', 'rho'],
      params: [10, 2.5e-7],
    }

    const formatted = formatSystemString(definition)

    expect(formatted).toBe(
      "x' = sigma * (y - x)\ny' = x - rho * y\nsigma = 10\nrho = 2.5e-7"
    )
    expect(parseSystemString(formatted)).toEqual(definition)
  })

  it('refuses to format mismatched or non-finite definitions', () => {
    expect(() =>
      formatSystemString({
        varNames: ['x'],
        equations: [],
        paramNames: [],
        params: [],
      })
    ).toThrow('Cannot format a system string with mismatched variables and equations.')

    expect(() =>
      formatSystemString({
        varNames: ['x'],
        equations: ['x'],
        paramNames: ['a'],
        params: [Number.NaN],
      })
    ).toThrow('Cannot format a system string with a non-finite parameter value.')
  })
})
