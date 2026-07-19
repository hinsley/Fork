#!/usr/bin/env node
import { spawn } from 'node:child_process'
import process from 'node:process'
import {
  extremeRustTests,
  mediumRustTests,
  nextestFilter,
  publishedRustTests,
} from './test-inventory.mjs'

const tier = process.argv[2]
const tests = {
  medium: mediumRustTests,
  extreme: extremeRustTests,
  published: publishedRustTests,
}[tier]

if (!tests) {
  console.error('Usage: node scripts/test-rust-tier.mjs <medium|extreme|published>')
  process.exit(2)
}

const args = ['nextest', 'run']
if (process.env.NEXTEST_ARCHIVE_FILE) {
  args.push('--archive-file', process.env.NEXTEST_ARCHIVE_FILE)
} else {
  args.push('--workspace')
}
args.push('--run-ignored', 'ignored-only', '-E', nextestFilter(tests))
if (process.env.NEXTEST_PARTITION) {
  args.push('--partition', process.env.NEXTEST_PARTITION)
}
if (tier === 'published') args.push('--release')

const child = spawn('cargo', args, { stdio: 'inherit', env: process.env })
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 1)
})
