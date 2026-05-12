import { describe, expect, it } from 'vitest'
import { createSystem, addObject } from './model'
import { validateSystemConfig } from '../state/systemValidation'

describe('data systems', () => {
  it('accepts column metadata without equations or parameters', () => {
    const system = createSystem({
      name: 'Data_System',
      config: {
        name: 'Data_System',
        type: 'data',
        solver: 'data',
        equations: [],
        params: [],
        paramNames: [],
        varNames: ['voltage'],
        data: {
          sampleInterval: 0.01,
          columns: ['voltage'],
        },
      },
    })

    expect(validateSystemConfig(system.config).valid).toBe(true)
  })

  it('stores derived spectra as dataset objects without persisting raw file contents', () => {
    const system = createSystem({
      name: 'Data_System',
      config: {
        name: 'Data_System',
        type: 'data',
        solver: 'data',
        equations: [],
        params: [],
        paramNames: [],
        varNames: ['voltage'],
        data: {
          sampleInterval: 0.01,
          columns: ['voltage'],
        },
      },
    })

    const { system: withDataset, nodeId } = addObject(system, {
      type: 'dataset',
      name: 'trace',
      systemName: 'Data_System',
      sourceName: 'trace.csv',
      fileSize: 64,
      columns: ['voltage'],
      sampleInterval: 0.01,
      rowCount: 8,
      lastPowerSpectrum: {
        frequencies: [0, 1],
        power: [0, 2],
        sampleCount: 8,
        segmentCount: 1,
        sampleInterval: 0.01,
        windowSize: 8,
        columnName: 'voltage',
        computedAt: '2026-05-12T00:00:00.000Z',
      },
    })

    const object = withDataset.objects[nodeId]
    expect(object.type).toBe('dataset')
    expect(JSON.stringify(object)).not.toContain('0,1,2,3,4,5,6,7')
    expect(withDataset.index.objects[nodeId]?.objectType).toBe('dataset')
  })
})
