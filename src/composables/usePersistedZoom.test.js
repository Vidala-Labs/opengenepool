import { describe, it, expect, beforeEach } from 'vitest'
import { usePersistedZoom, STORAGE_KEY } from './usePersistedZoom.js'

// Create a mock storage for testing
function createMockStorage(initialData = {}) {
  const store = { ...initialData }
  return {
    getItem: (key) => store[key] ?? null,
    setItem: (key, value) => { store[key] = value },
    removeItem: (key) => { delete store[key] },
    clear: () => { Object.keys(store).forEach(k => delete store[k]) },
    _store: store  // Expose for test inspection
  }
}

describe('usePersistedZoom', () => {
  let mockStorage

  beforeEach(() => {
    mockStorage = createMockStorage()
  })

  describe('getInitialZoom', () => {
    it('returns fallback when localStorage is empty', () => {
      const { getInitialZoom } = usePersistedZoom(100, mockStorage)
      expect(getInitialZoom()).toBe(100)
    })

    it('returns fallback when no fallback provided and localStorage empty', () => {
      const { getInitialZoom } = usePersistedZoom(undefined, mockStorage)
      expect(getInitialZoom()).toBe(100) // DEFAULT_ZOOM
    })

    it('returns stored value when valid', () => {
      mockStorage = createMockStorage({ [STORAGE_KEY]: '150' })
      const { getInitialZoom } = usePersistedZoom(100, mockStorage)
      expect(getInitialZoom()).toBe(150)
    })

    it('ignores stored value and returns fallback when value is NaN', () => {
      mockStorage = createMockStorage({ [STORAGE_KEY]: 'invalid' })
      const { getInitialZoom } = usePersistedZoom(100, mockStorage)
      expect(getInitialZoom()).toBe(100)
    })

    it('ignores stored value and returns fallback when value is below minimum (50)', () => {
      mockStorage = createMockStorage({ [STORAGE_KEY]: '25' })
      const { getInitialZoom } = usePersistedZoom(100, mockStorage)
      expect(getInitialZoom()).toBe(100)
    })

    it('accepts stored value at minimum (50)', () => {
      mockStorage = createMockStorage({ [STORAGE_KEY]: '50' })
      const { getInitialZoom } = usePersistedZoom(100, mockStorage)
      expect(getInitialZoom()).toBe(50)
    })

    it('handles storage throwing error gracefully', () => {
      const errorStorage = {
        getItem: () => { throw new Error('Storage disabled') },
        setItem: () => {}
      }
      const { getInitialZoom } = usePersistedZoom(100, errorStorage)
      expect(getInitialZoom()).toBe(100)
    })

    it('handles null storage gracefully', () => {
      const { getInitialZoom } = usePersistedZoom(100, null)
      // Will try to use real localStorage, but fallback is returned if anything fails
      // We're really testing that it doesn't throw
      expect(typeof getInitialZoom()).toBe('number')
    })
  })

  describe('saveZoom', () => {
    it('saves zoom value to localStorage', () => {
      const { saveZoom } = usePersistedZoom(100, mockStorage)
      saveZoom(75)
      expect(mockStorage._store[STORAGE_KEY]).toBe('75')
    })

    it('saves zoom as string', () => {
      const { saveZoom } = usePersistedZoom(100, mockStorage)
      saveZoom(200)
      expect(typeof mockStorage._store[STORAGE_KEY]).toBe('string')
    })

    it('handles storage throwing error gracefully', () => {
      const errorStorage = {
        getItem: () => null,
        setItem: () => { throw new Error('Storage full') }
      }
      const { saveZoom } = usePersistedZoom(100, errorStorage)
      // Should not throw
      expect(() => saveZoom(75)).not.toThrow()
    })

    it('handles null storage gracefully', () => {
      // When storage is explicitly null, saveZoom should not throw
      const nullStorage = null
      const { saveZoom } = usePersistedZoom(100, nullStorage)
      // Should not throw - will attempt to use real localStorage
      expect(() => saveZoom(75)).not.toThrow()
    })
  })

  describe('integration', () => {
    it('saved zoom is retrievable on next call', () => {
      const { saveZoom } = usePersistedZoom(100, mockStorage)
      saveZoom(175)

      // Simulate new component mount with same storage
      const { getInitialZoom } = usePersistedZoom(100, mockStorage)
      expect(getInitialZoom()).toBe(175)
    })

    it('overwrites previous saved value', () => {
      const { saveZoom } = usePersistedZoom(100, mockStorage)
      saveZoom(150)
      saveZoom(200)
      saveZoom(75)

      const { getInitialZoom } = usePersistedZoom(100, mockStorage)
      expect(getInitialZoom()).toBe(75)
    })
  })
})
