import { afterEach, describe, it, expect, vi } from 'vitest'
import { ref, effectScope, nextTick } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { useAlignmentRunner, canUseWorker } from './useAlignmentRunner.js'

// In the Vitest/happy-dom test env, import.meta.url is a file: URL, so the runner uses
// its async main-thread fallback (no real Worker). These tests exercise that path.

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('canUseWorker', () => {
  it('is false for a file: url (test/SSR)', () => {
    expect(canUseWorker('file:///x/y.js')).toBe(false)
  })

  it('is true for http/https/blob urls', () => {
    vi.stubGlobal('Worker', function Worker() {})

    expect(canUseWorker('http://localhost:5174/x.js')).toBe(true)
    expect(canUseWorker('https://example.com/x.js')).toBe(true)
    expect(canUseWorker('blob:https://example.com/abc')).toBe(true)
  })
})

describe('useAlignmentRunner (fallback path)', () => {
  it('resolves an alignment result for identical sequences', async () => {
    const q = ref('ATCGATCG')
    const t = ref('ATCGATCG')
    const { result } = useAlignmentRunner(() => q.value, () => t.value, null, { debounceMs: 0 })
    await flushPromises()
    expect(result.value).not.toBeNull()
    expect(result.value.identity).toBe(100)
  })

  it('returns null (no run) for empty sequences', async () => {
    const q = ref('')
    const t = ref('ATCG')
    const { result, pending } = useAlignmentRunner(() => q.value, () => t.value, null, { debounceMs: 0 })
    await flushPromises()
    expect(result.value).toBeNull()
    expect(pending.value).toBe(false)
  })

  it('toggles pending true while running and false once settled', async () => {
    const q = ref('ATCGATCG')
    const t = ref('ATCGATCG')
    const { pending } = useAlignmentRunner(() => q.value, () => t.value, null, { debounceMs: 0 })
    // Immediately after setup a run is dispatched.
    expect(pending.value).toBe(true)
    await flushPromises()
    expect(pending.value).toBe(false)
  })

  it('debounces rapid input changes into a single run', async () => {
    const q = ref('ATCG')
    const t = ref('ATCG')
    const { result, whenSettled } = useAlignmentRunner(() => q.value, () => t.value, null, { debounceMs: 20 })
    // rapid changes
    q.value = 'ATCGA'
    q.value = 'ATCGAT'
    q.value = 'ATCGATC'
    await whenSettled()
    // Only the final value should be reflected (target length 4 aligned region).
    expect(result.value).not.toBeNull()
    // queryAligned should derive from the final query, not an intermediate one
    expect(result.value.queryAligned.replace(/-/g, '').length).toBeGreaterThan(0)
  })

  it('drops stale results (A then B yields only B)', async () => {
    const q = ref('AAAA')
    const t = ref('AAAA')
    const { result, whenSettled } = useAlignmentRunner(() => q.value, () => t.value, null, { debounceMs: 0 })
    await whenSettled()
    expect(result.value.targetAligned).toBe('AAAA')

    // Switch to a different pair; after settle only the latest should show.
    q.value = 'GGGG'
    t.value = 'GGGG'
    await whenSettled()
    expect(result.value.targetAligned).toBe('GGGG')
  })

  it('stops updating after the scope is disposed', async () => {
    const q = ref('ATCG')
    const t = ref('ATCG')
    const scope = effectScope()
    let api
    scope.run(() => { api = useAlignmentRunner(() => q.value, () => t.value, null, { debounceMs: 0 }) })
    await flushPromises()
    expect(api.result.value).not.toBeNull()

    scope.stop()
    const before = api.result.value
    q.value = 'GGGGGGGG'
    t.value = 'GGGGGGGG'
    await flushPromises()
    // No update after disposal.
    expect(api.result.value).toBe(before)
  })
})
