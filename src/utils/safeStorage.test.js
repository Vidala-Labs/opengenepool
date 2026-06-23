import { describe, it, expect, afterEach } from 'vitest'
import { getStorageItem, setStorageItem, removeStorageItem } from './safeStorage.js'

const KEY = '__safeStorage_test__'

afterEach(() => {
  try { localStorage.removeItem(KEY) } catch {}
})

describe('safeStorage', () => {
  describe('with a working localStorage', () => {
    it('round-trips set/get/remove', () => {
      expect(setStorageItem(KEY, 'hello')).toBe(true)
      expect(getStorageItem(KEY)).toBe('hello')
      removeStorageItem(KEY)
      expect(getStorageItem(KEY)).toBeNull()
    })

    it('getStorageItem returns null for a missing key', () => {
      expect(getStorageItem('__definitely_absent__')).toBeNull()
    })
  })

  describe('when localStorage is unavailable (SSR / restricted)', () => {
    function withoutLocalStorage(fn) {
      const original = globalThis.localStorage
      try {
        // Simulate an environment where touching localStorage throws.
        Object.defineProperty(globalThis, 'localStorage', {
          configurable: true,
          get() { throw new Error('localStorage is not available') }
        })
        fn()
      } finally {
        // Restore the real localStorage.
        delete globalThis.localStorage
        if (original !== undefined) {
          Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: original, writable: true })
        }
      }
    }

    it('getStorageItem returns null and does not throw', () => {
      withoutLocalStorage(() => {
        expect(() => getStorageItem(KEY)).not.toThrow()
        expect(getStorageItem(KEY)).toBeNull()
      })
    })

    it('setStorageItem returns false and does not throw', () => {
      withoutLocalStorage(() => {
        expect(() => setStorageItem(KEY, 'x')).not.toThrow()
        expect(setStorageItem(KEY, 'x')).toBe(false)
      })
    })

    it('removeStorageItem does not throw', () => {
      withoutLocalStorage(() => {
        expect(() => removeStorageItem(KEY)).not.toThrow()
      })
    })
  })

  describe('when setItem throws (quota / privacy mode)', () => {
    it('setStorageItem returns false without throwing', () => {
      const original = globalThis.localStorage
      try {
        Object.defineProperty(globalThis, 'localStorage', {
          configurable: true,
          value: { getItem: () => null, setItem: () => { throw new Error('QuotaExceeded') }, removeItem: () => {} },
          writable: true
        })
        expect(() => setStorageItem(KEY, 'x')).not.toThrow()
        expect(setStorageItem(KEY, 'x')).toBe(false)
      } finally {
        Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: original, writable: true })
      }
    })
  })
})
