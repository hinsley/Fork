import { describe, expect, it } from 'vitest'
import {
  appendMathJaxWrappedSuffix,
  containsMathJaxMarkup,
  normalizeMathJaxForPlotly,
} from './mathText'

describe('mathText', () => {
  it('detects MathJax markup for supported delimiters', () => {
    expect(containsMathJaxMarkup('$y$')).toBe(true)
    expect(containsMathJaxMarkup('value \\(y\\)')).toBe(true)
    expect(containsMathJaxMarkup('$$z_{n+1}$$')).toBe(true)
    expect(containsMathJaxMarkup('\\[x^2\\]')).toBe(true)
    expect(containsMathJaxMarkup('plain text')).toBe(false)
    expect(containsMathJaxMarkup('cost \\$100')).toBe(false)
  })

  it('appends suffixes inside wrapped MathJax labels', () => {
    expect(appendMathJaxWrappedSuffix('$z$', '_n')).toBe('$z_n$')
    expect(appendMathJaxWrappedSuffix('$$z$$', '_{n+1}')).toBe('$$z_{n+1}$$')
    expect(appendMathJaxWrappedSuffix('\\(z\\)', '_n')).toBe('\\(z_n\\)')
    expect(appendMathJaxWrappedSuffix('\\[z\\]', '_{n+1}')).toBe('\\[z_{n+1}\\]')
    expect(appendMathJaxWrappedSuffix('z', '_n')).toBe('z_n')
  })

  it('normalizes mixed MathJax labels into Plotly-compatible whole-label math', () => {
    expect(normalizeMathJaxForPlotly('$z_{n+1}$+2')).toBe('$z_{n+1}+2$')
    expect(normalizeMathJaxForPlotly('\\(z_{n+1}\\)+2')).toBe('$z_{n+1}+2$')
    expect(normalizeMathJaxForPlotly('value \\(y\\)')).toBe('$\\text{value }y$')
    expect(normalizeMathJaxForPlotly('$x$ value')).toBe('$x\\text{ value}$')
    expect(normalizeMathJaxForPlotly('$x$')).toBe('$x$')
    expect(normalizeMathJaxForPlotly('plain text')).toBe('plain text')
  })
})
