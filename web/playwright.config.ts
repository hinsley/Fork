import { defineConfig } from '@playwright/test'

const port = Number(process.env.PLAYWRIGHT_PORT ?? 4173)

if (!Number.isFinite(port) || port <= 0) {
  throw new Error('PLAYWRIGHT_PORT must be a valid port number.')
}

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  // The specs drive real wasm computations; running them beside each other
  // starves the workers and makes progress-dependent assertions flaky.
  fullyParallel: false,
  workers: process.env.CI ? 1 : 2,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    headless: true,
  },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI,
    // `npm run dev` triggers the predev hook, which rebuilds both serial and
    // threaded wasm packages; that routinely exceeds two minutes in CI.
    timeout: 600_000,
  },
})
