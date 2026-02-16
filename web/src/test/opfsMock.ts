type MockEntry = MockDirectoryHandle | MockFileHandle

class MockFileHandle {
  kind = 'file' as const
  name: string
  contents = ''
  writeCount = 0

  constructor(name: string) {
    this.name = name
  }

  async getFile(): Promise<File> {
    return { text: async () => this.contents } as File
  }

  async createWritable() {
    let buffer = ''
    return {
      write: async (data: string | Blob | ArrayBuffer) => {
        if (typeof data === 'string') {
          buffer += data
          return
        }
        if (data instanceof Blob) {
          buffer += await data.text()
          return
        }
        buffer += new TextDecoder().decode(data)
      },
      close: async () => {
        this.contents = buffer
        this.writeCount += 1
      },
    }
  }
}

class MockDirectoryHandle {
  kind = 'directory' as const
  name: string
  entries = new Map<string, MockEntry>()

  constructor(name: string) {
    this.name = name
  }

  async getDirectoryHandle(name: string, options: { create?: boolean } = {}) {
    const existing = this.entries.get(name)
    if (existing) {
      if (existing.kind !== 'directory') {
        throw new Error(`"${name}" is not a directory`)
      }
      return existing
    }
    if (!options.create) {
      throw new Error(`Missing directory: ${name}`)
    }
    const dir = new MockDirectoryHandle(name)
    this.entries.set(name, dir)
    return dir
  }

  async getFileHandle(name: string, options: { create?: boolean } = {}) {
    const existing = this.entries.get(name)
    if (existing) {
      if (existing.kind !== 'file') {
        throw new Error(`"${name}" is not a file`)
      }
      return existing
    }
    if (!options.create) {
      throw new Error(`Missing file: ${name}`)
    }
    const file = new MockFileHandle(name)
    this.entries.set(name, file)
    return file
  }

  async removeEntry(name: string, options: { recursive?: boolean } = {}) {
    const existing = this.entries.get(name)
    if (!existing) return
    if (
      existing.kind === 'directory' &&
      existing.entries.size > 0 &&
      !options.recursive
    ) {
      throw new Error('Directory is not empty')
    }
    this.entries.delete(name)
  }

  async *values(): AsyncIterableIterator<MockEntry> {
    for (const entry of this.entries.values()) {
      yield entry
    }
  }
}

type OpfsInstall = {
  root: MockDirectoryHandle
  cleanup: () => void
}

export function installMockOpfs(): OpfsInstall {
  const root = new MockDirectoryHandle('root')
  const storage = {
    getDirectory: async () => root,
  }

  const navigatorAny = navigator as { storage?: unknown }
  const hadStorage = Object.prototype.hasOwnProperty.call(navigatorAny, 'storage')
  const previousStorage = navigatorAny.storage
  Object.defineProperty(navigator, 'storage', {
    value: storage,
    configurable: true,
  })

  const globalAny = globalThis as { FileSystemFileHandle?: unknown }
  const hadFileHandle = Object.prototype.hasOwnProperty.call(globalAny, 'FileSystemFileHandle')
  const previousFileHandle = globalAny.FileSystemFileHandle
  globalAny.FileSystemFileHandle = MockFileHandle

  return {
    root,
    cleanup: () => {
      if (hadStorage) {
        Object.defineProperty(navigator, 'storage', {
          value: previousStorage,
          configurable: true,
        })
      } else {
        delete navigatorAny.storage
      }

      if (hadFileHandle) {
        globalAny.FileSystemFileHandle = previousFileHandle
      } else {
        delete globalAny.FileSystemFileHandle
      }
    },
  }
}
