export const EXPRESSION_FUNCTION_GROUPS = [
  {
    label: 'Trigonometric',
    functions: [
      'sin(x)',
      'cos(x)',
      'tan(x)',
      'sec(x)',
      'csc(x)',
      'cot(x)',
      'asin(x)',
      'acos(x)',
      'atan(x)',
      'atan2(y, x)',
    ],
  },
  {
    label: 'Hyperbolic',
    functions: [
      'sinh(x)',
      'cosh(x)',
      'tanh(x)',
      'sech(x)',
      'csch(x)',
      'coth(x)',
      'asinh(x)',
      'acosh(x)',
      'atanh(x)',
    ],
  },
  {
    label: 'Exponential and logarithmic',
    functions: [
      'exp(x)',
      'exp2(x)',
      'expm1(x)',
      'ln(x)',
      'log(x)',
      'log(x, base)',
      'log2(x)',
      'log10(x)',
      'log1p(x)',
    ],
  },
  {
    label: 'Algebraic',
    functions: ['sqrt(x)', 'cbrt(x)', 'pow(x, y)', 'hypot(x, y)'],
  },
  {
    label: 'Special and stable',
    functions: [
      'erf(x)',
      'erfc(x)',
      'sinc(x)',
      'sigmoid(x)',
      'softplus(x)',
      'logaddexp(x, y)',
    ],
  },
] as const

export const EXPRESSION_CONSTANTS = ['pi', 'tau', 'e'] as const

export const EXPRESSION_COMPARISONS = ['<', '<=', '>', '>=', '==', '!='] as const

export const PIECEWISE_EXPRESSION_FUNCTIONS = [
  'abs(x)',
  'min(x, y, ...)',
  'max(x, y, ...)',
  'floor(x)',
  'ceil(x)',
  'round(x)',
  'trunc(x)',
  'fract(x)',
  'sign(x)',
  'clamp(x, min, max)',
  'heaviside(x)',
  'if(condition, then, else)',
] as const
