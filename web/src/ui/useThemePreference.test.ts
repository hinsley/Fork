import { afterEach, describe, expect, it, vi } from 'vitest'

const deterministic = vi.hoisted(() => ({ enabled: false }))
vi.mock('../utils/determinism', () => ({
  isDeterministicMode: () => deterministic.enabled,
}))

import { readStoredPreference } from './useThemePreference'

describe('readStoredPreference', () => {
  afterEach(() => {
    window.localStorage.clear()
    deterministic.enabled = false
    vi.restoreAllMocks()
  })

  it('follows the OS on first run', () => {
    expect(readStoredPreference()).toBe('system')
  })

  it('keeps an explicit stored choice', () => {
    window.localStorage.setItem('fork-theme', 'dark')
    expect(readStoredPreference()).toBe('dark')
  })

  it('falls back to the OS when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(readStoredPreference()).toBe('system')
  })

  it('pins light in deterministic test mode', () => {
    deterministic.enabled = true
    window.localStorage.setItem('fork-theme', 'dark')
    expect(readStoredPreference()).toBe('light')
  })
})
