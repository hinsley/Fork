import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadSystem, readSystemFile } from './importExport'
import { serializeSystem } from './serialization'
import { createSystem } from './model'

describe('system import/export', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reads a system bundle from a file', async () => {
    const system = createSystem({ name: 'Example' })
    const bundle = serializeSystem(system)
    const file = {
      text: async () => JSON.stringify(bundle),
    } as File

    const restored = await readSystemFile(file)

    expect(restored.name).toBe(system.name)
    expect(restored.config).toEqual(system.config)
  })

  it('downloads a system bundle as JSON', () => {
    const system = createSystem({ name: 'My System' })
    if (!('createObjectURL' in URL)) {
      Object.defineProperty(URL, 'createObjectURL', {
        value: () => '',
        writable: true,
      })
    }
    if (!('revokeObjectURL' in URL)) {
      Object.defineProperty(URL, 'revokeObjectURL', {
        value: () => {},
        writable: true,
      })
    }
    const createObjectUrlSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:mock-url')
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {})
    const removeSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'remove')
      .mockImplementation(() => {})
    const appendSpy = vi.spyOn(document.body, 'appendChild')

    downloadSystem(system)

    expect(createObjectUrlSpy).toHaveBeenCalledTimes(1)
    expect(revokeSpy).toHaveBeenCalledWith('blob:mock-url')
    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(removeSpy).toHaveBeenCalledTimes(1)
    expect(appendSpy).toHaveBeenCalledTimes(1)

    const anchor = appendSpy.mock.calls[0][0] as HTMLAnchorElement
    expect(anchor.download).toBe('My_System.json')
    expect(anchor.href).toBe('blob:mock-url')
  })
})
