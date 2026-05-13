import { addObject, addScene, selectNode } from './model'
import type { DatasetObject, PowerSpectrumSnapshot, System, SystemConfig } from './types'
import { nowIso } from '../utils/determinism'

export const STARTER_DATASET_NAME = 'starter-signal'
export const STARTER_DATASET_SOURCE_NAME = 'starter-signal.csv'
export const STARTER_DATASET_COLUMN = 'signal'
export const STARTER_DATASET_SAMPLE_INTERVAL = 1
export const STARTER_DATASET_SAMPLE_COUNT = 512
export const STARTER_DATASET_WINDOW_SIZE = 128
export const STARTER_DATASET_SCENE_NAME = 'State_Space'

type StarterSpectrumResult = {
  frequencies: number[]
  power: number[]
  sample_count: number
  segment_count: number
  sample_interval: number
  window_size: number
}

export function createDataSystemConfig(name: string): SystemConfig {
  return {
    name,
    equations: [],
    params: [],
    paramNames: [],
    varNames: [STARTER_DATASET_COLUMN],
    solver: 'data',
    type: 'data',
    data: {
      sampleInterval: STARTER_DATASET_SAMPLE_INTERVAL,
      columns: [STARTER_DATASET_COLUMN],
      starterDatasetSeeded: false,
    },
  }
}

export function createStarterDataSamples(): number[] {
  return Array.from({ length: STARTER_DATASET_SAMPLE_COUNT }, (_, index) => {
    const fundamental = Math.sin((2 * Math.PI * index) / 16)
    const harmonic = 0.35 * Math.sin((2 * Math.PI * 3 * index) / 32)
    const slowComponent = 0.1 * Math.cos((2 * Math.PI * index) / 64)
    return fundamental + harmonic + slowComponent
  })
}

function createStarterDatasetPreview(columns: string[] = [STARTER_DATASET_COLUMN]) {
  return {
    columns,
    sampleInterval: STARTER_DATASET_SAMPLE_INTERVAL,
    rowCount: STARTER_DATASET_SAMPLE_COUNT,
    stride: 1,
    rowIndices: Array.from(
      { length: STARTER_DATASET_SAMPLE_COUNT },
      (_, index) => index
    ),
    rows: createStarterDataSamples().map((value) => [value]),
  }
}

function starterCsvSize(): number {
  const rows = [
    STARTER_DATASET_COLUMN,
    ...createStarterDataSamples().map((value) => value.toPrecision(12)),
  ]
  return rows.join('\n').length
}

export function needsStarterDataset(system: System): boolean {
  if (system.config.type !== 'data') return false
  if (system.config.data?.starterDatasetSeeded) return false
  const hasLoadedDataset = Object.values(system.objects).some(
    (object) => object.type === 'dataset'
  )
  const hasIndexedDataset = Object.values(system.index.objects).some(
    (entry) => entry.objectType === 'dataset'
  )
  return !hasLoadedDataset && !hasIndexedDataset
}

export function markStarterDatasetSeeded(system: System): { system: System; changed: boolean } {
  if (system.config.type !== 'data') return { system, changed: false }
  let objects = system.objects
  let objectsChanged = false
  Object.entries(system.objects).forEach(([id, object]) => {
    if (
      object.type !== 'dataset' ||
      object.preview ||
      (object.name !== STARTER_DATASET_NAME &&
        object.sourceName !== STARTER_DATASET_SOURCE_NAME)
    ) {
      return
    }
    if (!objectsChanged) {
      objects = structuredClone(system.objects)
      objectsChanged = true
    }
    const columns = object.columns.length > 0 ? object.columns : [STARTER_DATASET_COLUMN]
    objects[id] = {
      ...object,
      preview: createStarterDatasetPreview(columns),
    }
  })
  if (system.config.data?.starterDatasetSeeded && !objectsChanged) {
    return { system, changed: false }
  }
  return {
    system: {
      ...system,
      objects,
      updatedAt: nowIso(),
      config: {
        ...system.config,
        data: {
          sampleInterval:
            system.config.data?.sampleInterval ?? STARTER_DATASET_SAMPLE_INTERVAL,
          columns:
            system.config.data?.columns ??
            (system.config.varNames.length > 0
              ? [...system.config.varNames]
              : [STARTER_DATASET_COLUMN]),
          ...system.config.data,
          starterDatasetSeeded: true,
        },
      },
    },
    changed: true,
  }
}

export function seedStarterDataset(
  system: System,
  spectrum: StarterSpectrumResult,
  computedAt: string
): { system: System; changed: boolean } {
  if (system.config.type !== 'data') return { system, changed: false }
  if (!needsStarterDataset(system)) return markStarterDatasetSeeded(system)

  const columns =
    system.config.data?.columns ??
    (system.config.varNames.length > 0
      ? [...system.config.varNames]
      : [STARTER_DATASET_COLUMN])
  const sampleInterval =
    system.config.data?.sampleInterval ?? STARTER_DATASET_SAMPLE_INTERVAL
  const columnName = columns[0] ?? STARTER_DATASET_COLUMN
  const config: SystemConfig = {
    ...system.config,
    varNames: columns,
    data: {
      ...system.config.data,
      sampleInterval,
      columns,
      sourceName: STARTER_DATASET_SOURCE_NAME,
      rowCount: spectrum.sample_count,
      fileSize: starterCsvSize(),
      starterDatasetSeeded: true,
    },
  }
  const base: System = {
    ...system,
    config,
  }
  const dataset: DatasetObject = {
    type: 'dataset',
    name: STARTER_DATASET_NAME,
    systemName: system.name,
    sourceName: STARTER_DATASET_SOURCE_NAME,
    fileSize: starterCsvSize(),
    columns,
    sampleInterval,
    rowCount: spectrum.sample_count,
    preview: {
      ...createStarterDatasetPreview(columns),
      sampleInterval,
    },
    lastPowerSpectrum: {
      frequencies: spectrum.frequencies,
      power: spectrum.power,
      sampleCount: spectrum.sample_count,
      segmentCount: spectrum.segment_count,
      sampleInterval: spectrum.sample_interval,
      windowSize: spectrum.window_size,
      columnName,
      computedAt,
    } satisfies PowerSpectrumSnapshot,
  }
  const withDataset = addObject(base, dataset)
  const withScene =
    withDataset.system.scenes.length === 0
      ? addScene(withDataset.system, STARTER_DATASET_SCENE_NAME).system
      : withDataset.system
  return {
    system: selectNode(withScene, withDataset.nodeId),
    changed: true,
  }
}
