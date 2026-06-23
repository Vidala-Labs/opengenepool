import { describe, it, expect, afterEach } from 'vitest'
import { setUuidGenerator, generateId, generateIdSync } from './uuid.js'

afterEach(() => {
  // Reset to the built-in default so tests don't leak the override.
  setUuidGenerator(null)
})

describe('uuid util', () => {
  describe('generateId (async, overridable)', () => {
    it('returns a string by default', async () => {
      const id = await generateId()
      expect(typeof id).toBe('string')
      expect(id.length).toBeGreaterThan(0)
    })

    it('uses an injected synchronous generator', async () => {
      let n = 0
      setUuidGenerator(() => `sync-${++n}`)
      expect(await generateId()).toBe('sync-1')
      expect(await generateId()).toBe('sync-2')
    })

    it('uses an injected async generator (awaited)', async () => {
      setUuidGenerator(async () => {
        await Promise.resolve()
        return 'server-v7-id'
      })
      expect(await generateId()).toBe('server-v7-id')
    })

    it('reverts to the default when set back to null', async () => {
      setUuidGenerator(() => 'overridden')
      expect(await generateId()).toBe('overridden')
      setUuidGenerator(null)
      const id = await generateId()
      expect(id).not.toBe('overridden')
      expect(typeof id).toBe('string')
    })
  })

  describe('generateIdSync (guarded, never throws)', () => {
    it('returns a string', () => {
      expect(typeof generateIdSync()).toBe('string')
    })

    it('does not use an async injected generator (stays synchronous)', () => {
      // Even with an async override installed, the sync path must return a string
      // synchronously (it uses the guarded local generator, not the override).
      setUuidGenerator(async () => 'server-id')
      const id = generateIdSync()
      expect(typeof id).toBe('string')
      expect(id).not.toBe('server-id')
    })

    it('does not throw when crypto.randomUUID is unavailable', () => {
      const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
      try {
        // Simulate an environment without crypto.randomUUID
        Object.defineProperty(globalThis, 'crypto', {
          value: undefined,
          configurable: true
        })
        const id = generateIdSync()
        expect(typeof id).toBe('string')
        expect(id.length).toBeGreaterThan(0)
      } finally {
        if (original) {
          Object.defineProperty(globalThis, 'crypto', original)
        }
      }
    })

    it('produces distinct ids across calls', () => {
      expect(generateIdSync()).not.toBe(generateIdSync())
    })
  })
})
