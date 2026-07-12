import { defineConfig } from 'vitest/config'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

const STANDALONE_DEPENDENCIES_ID = 'virtual:standalone-embed-dependencies'
const RESOLVED_STANDALONE_DEPENDENCIES_ID = `\0${STANDALONE_DEPENDENCIES_ID}`

function standaloneEmbedDependencies(): Plugin {
  return {
    name: 'standalone-embed-dependencies',
    resolveId(id) {
      return id === STANDALONE_DEPENDENCIES_ID
        ? RESOLVED_STANDALONE_DEPENDENCIES_ID
        : null
    },
    load(id) {
      if (id !== RESOLVED_STANDALONE_DEPENDENCIES_ID) return null
      const plotlySource = readFileSync(
        path.resolve(__dirname, 'node_modules/plotly.js-dist-min/plotly.min.js'),
        'utf8'
      )
      const mathJaxSource = readFileSync(
        path.resolve(__dirname, 'node_modules/mathjax/es5/tex-svg.js'),
        'utf8'
      )
      const plotlyLicense = readFileSync(
        path.resolve(__dirname, 'node_modules/plotly.js-dist-min/LICENSE'),
        'utf8'
      )
      const mathJaxLicense = readFileSync(
        path.resolve(__dirname, 'node_modules/mathjax/LICENSE'),
        'utf8'
      )
      const compressed = gzipSync(
        JSON.stringify({
          plotlySource,
          mathJaxSource,
          plotlyLicense,
          mathJaxLicense,
        }),
        { level: 9 }
      ).toString('base64')
      return `export const dependenciesGzipBase64 = ${JSON.stringify(compressed)};`
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [standaloneEmbedDependencies(), react()],
  resolve: {
    alias: {
      '@fork-wasm': path.resolve(__dirname, '..', 'crates', 'fork_wasm', 'pkg-web'),
    },
  },
  worker: {
    format: 'es',
  },
  server: {
    fs: {
      allow: [path.resolve(__dirname, '..'), path.resolve(__dirname, '..', 'crates')],
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    globals: true,
    css: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**'],
  },
})
