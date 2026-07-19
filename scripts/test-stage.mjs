#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { access, mkdir } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const stage = process.argv[2]
const validStages = new Set(['fast', 'medium', 'full', 'profile'])

if (!validStages.has(stage)) {
  console.error('Usage: node scripts/test-stage.mjs <fast|medium|full|profile>')
  process.exit(2)
}

function run(label, command, args, options = {}) {
  const startedAt = performance.now()
  console.log(`\n[${label}] ${command} ${args.join(' ')}`)
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: { ...process.env, ...options.env },
      stdio: 'inherit',
    })
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      const durationSeconds = (performance.now() - startedAt) / 1000
      if (signal) {
        reject(new Error(`${label} stopped by ${signal}`))
      } else if (code !== 0) {
        reject(new Error(`${label} failed with exit code ${code}`))
      } else {
        console.log(`[${label}] completed in ${durationSeconds.toFixed(1)}s`)
        resolve({ label, durationSeconds })
      }
    })
  })
}

async function requirePath(label, relativePath, preparationCommand) {
  try {
    await access(path.join(repoRoot, relativePath), constants.R_OK)
  } catch {
    throw new Error(`${label} is not prepared. Run ${preparationCommand} first.`)
  }
}

async function runFast() {
  return Promise.all([
    run('rust-fast', 'cargo', ['test', '--workspace']),
    run('cli-fast', 'npm', ['run', 'test'], { cwd: path.join(repoRoot, 'cli') }),
    run('web-unit', 'npm', ['run', 'test:unit'], { cwd: path.join(repoRoot, 'web') }),
  ])
}

async function runDeferred(label, tier) {
  return run(label, 'node', [path.join(repoRoot, 'scripts/test-rust-tier.mjs'), tier])
}

async function runMediumOnly() {
  await Promise.all([
    requirePath('Node WASM', 'crates/fork_wasm/pkg/fork_wasm.js', 'npm --prefix cli run prepare:wasm'),
    requirePath('web WASM', 'crates/fork_wasm/pkg-web/fork_wasm.js', 'npm --prefix web run prepare:wasm'),
  ])
  const [rust] = await Promise.all([
    runDeferred('rust-medium', 'medium'),
    run('node-wasm-smoke', 'npm', ['run', 'test:wasm:prepared'], {
      cwd: path.join(repoRoot, 'cli'),
    }),
    run('cli-build', 'npm', ['run', 'build:prepared'], { cwd: path.join(repoRoot, 'cli') }),
    run('web-build', 'npm', ['run', 'build:prepared'], { cwd: path.join(repoRoot, 'web') }),
    run('playwright-mocked', 'npm', ['run', 'test:e2e:mocked'], {
      cwd: path.join(repoRoot, 'web'),
    }),
  ])
  await run('playwright-real-wasm', 'npm', ['run', 'test:e2e:real'], {
    cwd: path.join(repoRoot, 'web'),
  })
  return rust
}

async function runFullOnly() {
  await mkdir(path.join(repoRoot, 'target/test-timings/coverage'), { recursive: true })
  await runDeferred('rust-extreme', 'extreme')
  await runDeferred('rust-published-references', 'published')
  await Promise.all([
    run('rust-coverage', 'cargo', [
      'llvm-cov',
      'nextest',
      '--release',
      '--workspace',
      '--all-features',
      '--run-ignored',
      'all',
      '--lcov',
      '--output-path',
      'target/test-timings/coverage/rust.lcov',
    ]),
    run('web-coverage', 'npm', ['run', 'test:unit:coverage'], {
      cwd: path.join(repoRoot, 'web'),
    }),
    run('cli-coverage', 'npm', ['run', 'test:coverage'], {
      cwd: path.join(repoRoot, 'cli'),
    }),
  ])
}

async function runProfile() {
  await mkdir(path.join(repoRoot, 'target/test-timings'), { recursive: true })
  await run('profile', 'node', [path.join(repoRoot, 'scripts/test-profile.mjs')])
}

try {
  if (stage === 'profile') {
    await runProfile()
  } else {
    const startedAt = performance.now()
    await runFast()
    if (stage === 'medium' || stage === 'full') await runMediumOnly()
    if (stage === 'full') await runFullOnly()
    console.log(`\n${stage} stage passed in ${((performance.now() - startedAt) / 1000).toFixed(1)}s`)
  }
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
