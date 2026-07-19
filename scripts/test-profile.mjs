#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputRoot = path.join(repoRoot, 'target/test-timings')
const resume = process.env.TEST_PROFILE_RESUME === '1'

function run(label, command, args, options = {}) {
  const startedAt = performance.now()
  console.log(`\n[profile:${label}] ${command} ${args.join(' ')}`)
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: { ...process.env, ...options.env },
      stdio: 'inherit',
    })
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      const durationSeconds = (performance.now() - startedAt) / 1000
      if (signal || code !== 0) {
        reject(new Error(`${label} failed${signal ? ` (${signal})` : ` with exit code ${code}`}`))
      } else {
        resolve({ label, durationSeconds })
      }
    })
  })
}

if (!resume) await rm(outputRoot, { recursive: true, force: true })
await mkdir(path.join(outputRoot, 'nextest'), { recursive: true })

const cliTimings = []
const profileCli = async (label, script) => {
  const result = await run(label, 'npm', ['run', script], { cwd: path.join(repoRoot, 'cli') })
  cliTimings.push({ name: script, durationSeconds: result.durationSeconds })
}

if (!resume) {
  await Promise.all([
    run('prepare-node-wasm', 'npm', ['run', 'prepare:wasm'], {
      cwd: path.join(repoRoot, 'cli'),
    }),
    run('prepare-web-wasm', 'npm', ['run', 'prepare:wasm'], {
      cwd: path.join(repoRoot, 'web'),
    }),
  ])

  // Profile layers sequentially so CPU contention does not inflate individual
  // case durations and distort the Pareto ordering.
  await run('rust', 'cargo', [
    'nextest',
    'run',
    '--workspace',
    '--profile',
    'profile',
    '--run-ignored',
    'all',
    '-E',
    'not binary(published_cycle_references)',
  ])
  await run('rust-published-release', 'cargo', [
    'nextest',
    'run',
    '--release',
    '-p',
    'fork_core',
    '--test',
    'published_cycle_references',
    '--profile',
    'profile-published',
    '--run-ignored',
    'ignored-only',
  ])
  await run('vitest', 'npm', [
    'exec',
    '--',
    'vitest',
    'run',
    '--reporter=json',
    `--outputFile=${path.join(outputRoot, 'vitest.json')}`,
  ], { cwd: path.join(repoRoot, 'web') })
  await profileCli('cli-unit', 'test:unit')
  await profileCli('cli-menu', 'test:homoclinic-menu')
  await profileCli('cli-wasm', 'test:wasm:prepared')

  await writeFile(
    path.join(outputRoot, 'cli.json'),
    `${JSON.stringify({ tests: cliTimings }, null, 2)}\n`
  )
} else {
  console.log('\n[profile] resuming from existing Rust, Vitest, and CLI timing data')
}

await run('playwright-mocked', 'npm', [
  'run',
  'test:e2e:mocked',
  '--',
  '--reporter=json',
], {
  cwd: path.join(repoRoot, 'web'),
  env: { PLAYWRIGHT_JSON_OUTPUT_FILE: path.join(outputRoot, 'playwright-mocked.json') },
})

await run('playwright-real', 'npm', [
  'run',
  'test:e2e:real',
  '--',
  '--reporter=json',
], {
  cwd: path.join(repoRoot, 'web'),
  env: { PLAYWRIGHT_JSON_OUTPUT_FILE: path.join(outputRoot, 'playwright-real.json') },
})

await run('pareto-report', 'node', [path.join(repoRoot, 'scripts/test-pareto-report.mjs')])
console.log(`\nProfile data written to ${path.relative(repoRoot, outputRoot)}/`)
