import { describe, expect, it } from 'vitest'
import { appendMathJaxWrappedSuffix, containsMathJaxMarkup } from './mathText'

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
})
