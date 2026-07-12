import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { addScene, createSystem } from './model'
import {
  EMBED_ARCHIVE_LIMITS,
  buildSystemArchiveBytes,
  parseSystemArchiveBytes,
} from './archive'

function archiveWithEntry(bytes: Uint8Array, path: string, value: unknown): Uint8Array {
  const entries = unzipSync(bytes)
  entries[path] = strToU8(JSON.stringify(value))
  const zippable: Record<string, [Uint8Array]> = {}
  Object.entries(entries).forEach(([entryPath, entryBytes]) => {
    zippable[entryPath] = [new Uint8Array(entryBytes)]
  })
  return zipSync(zippable as unknown as Record<string, Uint8Array>)
}

describe('embedded system archives', () => {
  it('strictly parses the existing exported archive format', () => {
    const created = addScene(createSystem({ name: 'Embed_Archive' }), 'Scene_1').system
    const restored = parseSystemArchiveBytes(buildSystemArchiveBytes(created), {
      limits: EMBED_ARCHIVE_LIMITS,
      strict: true,
    })
    expect(restored).toEqual(created)
  })

  it('rejects archives over the compressed byte budget', () => {
    const created = createSystem({ name: 'Embed_Size' })
    const bytes = buildSystemArchiveBytes(created)
    expect(() =>
      parseSystemArchiveBytes(bytes, {
        limits: { ...EMBED_ARCHIVE_LIMITS, maxCompressedBytes: bytes.byteLength - 1 },
        strict: true,
      })
    ).toThrow('64 MiB')
  })

  it('rejects unsupported ZIP entries', () => {
    const created = createSystem({ name: 'Embed_Entries' })
    const bytes = archiveWithEntry(buildSystemArchiveBytes(created), '../outside.txt', 'bad')
    expect(() =>
      parseSystemArchiveBytes(bytes, { limits: EMBED_ARCHIVE_LIMITS, strict: true })
    ).toThrow('unsupported entry')
  })

  it('rejects object-map keys that can alter object prototypes', () => {
    const created = createSystem({ name: 'Embed_Keys' })
    const unsafeIndex = JSON.parse(
      '{"__proto__":{"id":"__proto__","name":"bad","objectType":"orbit","shard":"00","updatedAt":"now"}}'
    )
    const bytes = archiveWithEntry(
      buildSystemArchiveBytes(created),
      'index/objects.json',
      unsafeIndex
    )
    expect(() =>
      parseSystemArchiveBytes(bytes, { limits: EMBED_ARCHIVE_LIMITS, strict: true })
    ).toThrow('invalid object ID')
  })

  it('rejects mismatched manifest and system identifiers', () => {
    const created = createSystem({ name: 'Embed_Ids' })
    const bytes = buildSystemArchiveBytes(created)
    const entries = unzipSync(bytes)
    const manifest = JSON.parse(strFromU8(entries['manifest.json'])) as Record<string, unknown>
    manifest.systemId = 'different-system'
    const mismatched = archiveWithEntry(bytes, 'manifest.json', manifest)
    expect(() => parseSystemArchiveBytes(mismatched)).toThrow('identifiers do not match')
  })
})
