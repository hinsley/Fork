import mathJaxBundleUrl from 'mathjax/es5/tex-svg.js?url'

const FORK_MATHJAX_SCRIPT_SELECTOR = 'script[data-fork-mathjax="true"]'

type MathJaxConfig = {
  startup?: {
    promise?: Promise<unknown>
    typeset?: boolean
  }
  svg?: {
    fontCache?: string
  }
  tex?: {
    inlineMath?: [string, string][]
    displayMath?: [string, string][]
  }
  typesetPromise?: (elements?: unknown[]) => Promise<unknown>
}

type MathJaxWindow = Window & typeof globalThis & { MathJax?: MathJaxConfig }

let mathJaxPromise: Promise<void> | null = null
let warnedAboutMathJaxLoad = false

function configureMathJax(win: MathJaxWindow) {
  const existing = win.MathJax ?? {}
  win.MathJax = {
    ...existing,
    tex: {
      inlineMath: [
        ['$', '$'],
        ['\\(', '\\)'],
      ],
      displayMath: [
        ['$$', '$$'],
        ['\\[', '\\]'],
      ],
      ...existing.tex,
    },
    svg: {
      fontCache: 'global',
      ...existing.svg,
    },
    startup: {
      typeset: false,
      ...existing.startup,
    },
  }
}

function createTestMathJax(win: MathJaxWindow) {
  const ready = Promise.resolve()
  win.MathJax = {
    ...win.MathJax,
    startup: {
      promise: ready,
      typeset: false,
      ...win.MathJax?.startup,
    },
    typesetPromise: win.MathJax?.typesetPromise ?? (() => ready),
  }
  return ready
}

function getStartupPromise(win: MathJaxWindow) {
  return win.MathJax?.startup?.promise
}

function injectMathJaxScript(win: MathJaxWindow) {
  const existingScript = document.querySelector(FORK_MATHJAX_SCRIPT_SELECTOR) as
    | HTMLScriptElement
    | null

  return new Promise<void>((resolve, reject) => {
    const finish = () => {
      const startupPromise = getStartupPromise(win)
      if (!startupPromise) {
        resolve()
        return
      }
      void startupPromise.then(() => resolve(), reject)
    }

    const handleError = () => {
      reject(new Error('Failed to load MathJax for Plotly labels.'))
    }

    if (existingScript) {
      existingScript.addEventListener('load', finish, { once: true })
      existingScript.addEventListener('error', handleError, { once: true })
      return
    }

    const script = document.createElement('script')
    script.src = mathJaxBundleUrl
    script.async = true
    script.setAttribute('data-fork-mathjax', 'true')
    script.addEventListener('load', finish, { once: true })
    script.addEventListener('error', handleError, { once: true })
    ;(document.head ?? document.body ?? document.documentElement).appendChild(script)
  })
}

async function loadMathJax() {
  if (typeof window === 'undefined') return
  const win = window as MathJaxWindow
  const startupPromise = getStartupPromise(win)
  if (startupPromise) {
    await startupPromise
    return
  }
  if (import.meta.env.MODE === 'test') {
    await createTestMathJax(win)
    return
  }
  if (!mathJaxPromise) {
    configureMathJax(win)
    mathJaxPromise = injectMathJaxScript(win).catch((error) => {
      mathJaxPromise = null
      throw error
    })
  }
  await mathJaxPromise
}

export async function ensureMathJaxReady() {
  try {
    await loadMathJax()
  } catch (error) {
    if (warnedAboutMathJaxLoad || typeof console === 'undefined') return
    warnedAboutMathJaxLoad = true
    console.warn('[Plotly] MathJax failed to load; LaTeX labels will render as plain text.', error)
  }
}

export function preloadMathJax() {
  void ensureMathJaxReady()
}
