#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputRoot = path.join(repoRoot, 'target/test-timings')

function decodeXml(value) {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
}

function attribute(source, name) {
  const match = source.match(new RegExp(`\\b${name}="([^"]*)"`))
  return match ? decodeXml(match[1]) : ''
}

async function rustRecords() {
  const xml = `${await readFile(path.join(outputRoot, 'nextest/profile.xml'), 'utf8')}\n${await readFile(
    path.join(outputRoot, 'nextest/published.xml'),
    'utf8'
  )}`
  return [...xml.matchAll(/<testcase\b([^>]*)>/g)].map((match) => {
    const attrs = match[1]
    const testName = attribute(attrs, 'name')
    const separator = testName.lastIndexOf('::')
    const moduleName = separator >= 0
      ? `${attribute(attrs, 'classname')}:${testName.slice(0, separator)}`
      : attribute(attrs, 'classname') || 'rust'
    return {
      layer: 'rust',
      module: moduleName,
      name: testName,
      durationSeconds: Number(attribute(attrs, 'time')) || 0,
    }
  })
}

async function vitestRecords() {
  const data = JSON.parse(await readFile(path.join(outputRoot, 'vitest.json'), 'utf8'))
  return (data.testResults ?? []).flatMap((file) =>
    (file.assertionResults ?? []).map((test) => ({
      layer: 'vitest',
      module: path.relative(repoRoot, file.name ?? 'web'),
      name: [...(test.ancestorTitles ?? []), test.title].filter(Boolean).join(' > '),
      durationSeconds: (Number(test.duration) || 0) / 1000,
    }))
  )
}

function collectPlaywrightSuite(suite, layer, inheritedFile = '') {
  const file = suite.file || inheritedFile
  const records = []
  for (const spec of suite.specs ?? []) {
    const durationMs = (spec.tests ?? []).flatMap((test) => test.results ?? [])
      .reduce((sum, result) => sum + (Number(result.duration) || 0), 0)
    records.push({
      layer,
      module: file,
      name: spec.title,
      durationSeconds: durationMs / 1000,
    })
  }
  for (const child of suite.suites ?? []) {
    records.push(...collectPlaywrightSuite(child, layer, file))
  }
  return records
}

async function playwrightRecords(filename, layer) {
  const data = JSON.parse(await readFile(path.join(outputRoot, filename), 'utf8'))
  return (data.suites ?? []).flatMap((suite) => collectPlaywrightSuite(suite, layer))
}

async function cliRecords() {
  const data = JSON.parse(await readFile(path.join(outputRoot, 'cli.json'), 'utf8'))
  return (data.tests ?? []).map((test) => ({
    layer: 'cli',
    module: 'cli',
    name: test.name,
    durationSeconds: Number(test.durationSeconds) || 0,
  }))
}

function rank(records) {
  const totals = new Map()
  for (const record of records) {
    totals.set(record.layer, (totals.get(record.layer) ?? 0) + record.durationSeconds)
  }
  const cumulative = new Map()
  return [...records]
    .sort((left, right) =>
      left.layer.localeCompare(right.layer) || right.durationSeconds - left.durationSeconds
    )
    .map((record) => {
      const total = totals.get(record.layer) || 1
      const nextCumulative = (cumulative.get(record.layer) ?? 0) + record.durationSeconds
      cumulative.set(record.layer, nextCumulative)
      return {
        ...record,
        percentage: (record.durationSeconds / total) * 100,
        cumulativePercentage: (nextCumulative / total) * 100,
        reachesPareto80: nextCumulative - record.durationSeconds < total * 0.8,
      }
    })
}

const records = rank([
  ...(await rustRecords()),
  ...(await vitestRecords()),
  ...(await playwrightRecords('playwright-mocked.json', 'playwright-mocked')),
  ...(await playwrightRecords('playwright-real.json', 'playwright-real')),
  ...(await cliRecords()),
])

const layers = [...new Set(records.map((record) => record.layer))]
const report = [
  '# Test timing Pareto report',
  '',
  `Generated ${new Date().toISOString()}. Percentages and cumulative percentages are within each layer.`,
  '',
]

for (const layer of layers) {
  const layerRecords = records.filter((record) => record.layer === layer)
  const total = layerRecords.reduce((sum, record) => sum + record.durationSeconds, 0)
  const paretoCount = layerRecords.filter((record) => record.reachesPareto80).length
  report.push(`## ${layer}`, '')
  report.push(
    `${layerRecords.length} measured tests; ${total.toFixed(2)}s summed case time; ${paretoCount} tests reach 80%.`,
    '',
    '| Test | Module/file | Seconds | Percent | Cumulative |',
    '|---|---|---:|---:|---:|'
  )
  for (const record of layerRecords.slice(0, Math.max(paretoCount, 20))) {
    const clean = (value) => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ')
    report.push(
      `| ${clean(record.name)} | ${clean(record.module)} | ${record.durationSeconds.toFixed(3)} | ${record.percentage.toFixed(1)}% | ${record.cumulativePercentage.toFixed(1)}% |`
    )
  }
  report.push('')
}

await writeFile(path.join(outputRoot, 'pareto.json'), `${JSON.stringify({ records }, null, 2)}\n`)
await writeFile(path.join(outputRoot, 'pareto.md'), `${report.join('\n')}\n`)
console.log(report.join('\n'))
