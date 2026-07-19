import { defineConfig } from '@playwright/test'

const port = Number(process.env.PLAYWRIGHT_PORT ?? 4173)

if (!Number.isFinite(port) || port <= 0) {
  throw new Error('PLAYWRIGHT_PORT must be a valid port number.')
}

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    headless: true,
  },
  projects: [
    {
      name: 'mocked',
      testIgnore: /\.real\.spec\.ts$/,
    },
    {
      name: 'real-wasm',
      testMatch: /\.real\.spec\.ts$/,
      fullyParallel: false,
      workers: 1,
    },
  ],
  webServer: {
    command: `npm run dev:prepared -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
