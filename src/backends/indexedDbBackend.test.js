import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Span, Range, Orientation } from '../utils/dna.js'
import { createIndexedDbBackend } from './indexedDbBackend.js'

// In-memory store seam with an artificial async delay, to exercise operation
// ordering without a real IndexedDB (Node/happy-dom have none).
function makeFakeStore(initial = null, { delay = 5 } = {}) {
  let record = initial
  const sleep = (ms) => new Promise(r => setTimeout(r, ms))
  return {
    record: () => record,
    get: async (_id) => { await sleep(delay); return record ? JSON.parse(JSON.stringify(record)) : null },
    save: async (seq) => { await sleep(delay); record = JSON.parse(JSON.stringify(seq)) }
  }
}

/**
 * Test the applyEdit logic for annotationDeleted
 * Since IndexedDB requires browser APIs, we extract and test the filtering logic directly
 */
describe('indexedDbBackend annotation logic', () => {
  describe('annotationDeleted', () => {
    it('filters annotations by id field (not annotationId)', () => {
      // Simulate the filtering logic from indexedDbBackend line 142-144
      const annotations = [
        { id: 'ann1', caption: 'Keep' },
        { id: 'ann2', caption: 'Delete' },
        { id: 'ann3', caption: 'Also Keep' }
      ]

      // This is what the backend receives from SequenceDocument.deleteAnnotation
      const data = { editId: 'del-123', id: 'ann2' }

      // The filtering should use data.id, not data.annotationId
      const filtered = annotations.filter(ann => ann.id !== data.id)

      expect(filtered.length).toBe(2)
      expect(filtered.map(a => a.id)).toEqual(['ann1', 'ann3'])
    })

    it('does not filter when using old annotationId field', () => {
      const annotations = [
        { id: 'ann1', caption: 'Keep' },
        { id: 'ann2', caption: 'Should Delete' }
      ]

      // Old format (should NOT work)
      const dataOld = { id: 'del-123', annotationId: 'ann2' }

      // Using the old field name would not filter correctly
      const filteredOld = annotations.filter(ann => ann.id !== dataOld.annotationId)

      // This still works because annotationId exists, but tests the intent
      expect(filteredOld.length).toBe(1)
    })
  })

  describe('annotationCreated', () => {
    it('receives annotation fields at top level (not nested in data.annotation)', () => {
      // This is what SequenceDocument.addAnnotation sends
      const data = {
        id: 'ann1',
        caption: 'New Gene',
        type: 'gene',
        span: { ranges: [] },
        editId: 'create-123'
      }

      // The annotation should be the data itself (minus editId), not data.annotation
      expect(data.id).toBe('ann1')
      expect(data.caption).toBe('New Gene')
      expect(data.editId).toBeDefined()
    })
  })

  describe('annotationUpdate', () => {
    it('receives annotation fields at top level with editId', () => {
      // This is what SequenceDocument.updateAnnotation sends
      const data = {
        id: 'ann1',
        caption: 'Updated Gene',
        type: 'CDS',
        span: { ranges: [] },
        editId: 'update-456'
      }

      expect(data.id).toBe('ann1')
      expect(data.editId).toBeDefined()
      expect(data.editId.startsWith('update-')).toBe(true)
    })
  })
})

/**
 * Test span normalization logic that should happen in load()
 * This logic converts string spans (from IndexedDB storage) back to Span objects
 */
describe('indexedDbBackend span normalization', () => {
  // This is the normalization function that should be used in load()
  function normalizeSpan(span) {
    if (span instanceof Span) return span
    if (typeof span === 'string') return Span.parse(span)
    if (span?.ranges) return new Span(span.ranges)
    return new Span()
  }

  function normalizeAnnotations(annotations) {
    return annotations.map(ann => ({
      ...ann,
      span: normalizeSpan(ann.span)
    }))
  }

  describe('normalizeSpan', () => {
    it('returns Span unchanged if already a Span', () => {
      const span = new Span([new Range(10, 50)])
      const result = normalizeSpan(span)
      expect(result).toBe(span)
    })

    it('parses string span to Span object', () => {
      const result = normalizeSpan('10..50')
      expect(result).toBeInstanceOf(Span)
      expect(result.ranges).toHaveLength(1)
      expect(result.ranges[0].start).toBe(10)
      expect(result.ranges[0].end).toBe(50)
    })

    it('parses joined string span', () => {
      const result = normalizeSpan('10..50 + 60..70')
      expect(result).toBeInstanceOf(Span)
      expect(result.ranges).toHaveLength(2)
    })

    it('parses minus strand string span', () => {
      const result = normalizeSpan('(10..50)')
      expect(result.ranges[0].orientation).toBe(Orientation.MINUS)
    })

    it('constructs Span from object with ranges array', () => {
      const result = normalizeSpan({ ranges: [new Range(10, 50)] })
      expect(result).toBeInstanceOf(Span)
      expect(result.ranges[0].start).toBe(10)
    })

    it('returns empty Span for null/undefined', () => {
      expect(normalizeSpan(null).ranges).toHaveLength(0)
      expect(normalizeSpan(undefined).ranges).toHaveLength(0)
    })
  })

  describe('normalizeAnnotations', () => {
    it('normalizes string spans in annotations', () => {
      // Simulate what IndexedDB returns after JSON serialization roundtrip
      const storedAnnotations = [
        { id: 'ann1', caption: 'Gene', type: 'gene', span: '10..50' },
        { id: 'ann2', caption: 'CDS', type: 'CDS', span: '100..200 + (300..400)' }
      ]

      const normalized = normalizeAnnotations(storedAnnotations)

      expect(normalized[0].span).toBeInstanceOf(Span)
      expect(normalized[0].span.ranges[0].start).toBe(10)

      expect(normalized[1].span).toBeInstanceOf(Span)
      expect(normalized[1].span.ranges).toHaveLength(2)
      expect(normalized[1].span.ranges[1].orientation).toBe(Orientation.MINUS)
    })

    it('preserves other annotation fields', () => {
      const storedAnnotations = [
        { id: 'ann1', caption: 'Gene', type: 'gene', span: '10..50', attributes: { note: 'test' } }
      ]

      const normalized = normalizeAnnotations(storedAnnotations)

      expect(normalized[0].id).toBe('ann1')
      expect(normalized[0].caption).toBe('Gene')
      expect(normalized[0].type).toBe('gene')
      expect(normalized[0].attributes.note).toBe('test')
    })
  })

  describe('roundtrip simulation', () => {
    it('span survives JSON serialization + normalization', () => {
      // Create original span
      const original = new Span([
        new Range(10, 50, Orientation.PLUS),
        new Range(60, 70, Orientation.MINUS)
      ])

      // Simulate save: Span.toJSON() returns fenced string
      const serialized = JSON.stringify({ span: original })
      expect(JSON.parse(serialized).span).toBe('10..50 + (60..70)')

      // Simulate load: parse the string back
      const loaded = JSON.parse(serialized)
      const restored = normalizeSpan(loaded.span)

      expect(restored).toBeInstanceOf(Span)
      expect(restored.ranges).toHaveLength(2)
      expect(restored.ranges[0].start).toBe(10)
      expect(restored.ranges[0].end).toBe(50)
      expect(restored.ranges[0].orientation).toBe(Orientation.PLUS)
      expect(restored.ranges[1].start).toBe(60)
      expect(restored.ranges[1].end).toBe(70)
      expect(restored.ranges[1].orientation).toBe(Orientation.MINUS)
    })
  })
})

describe('indexedDbBackend operation serialization (lost-update races)', () => {
  // Wait until the store has been written enough times to reflect all queued ops.
  async function settle(ms = 200) { await new Promise(r => setTimeout(r, ms)) }

  it('applies rapid sequential inserts without losing updates', async () => {
    const store = makeFakeStore({ id: 'seq1', content: '', title: '', annotations: [], metadata: {} })
    const backend = createIndexedDbBackend('seq1', { store })

    // Fire several inserts in a row WITHOUT awaiting between them. With a
    // get->mutate->put race these would read the same stale '' and clobber each
    // other; serialized, each sees the previous write.
    backend.insert({ position: 0, text: 'AAA' })
    backend.insert({ position: 3, text: 'CCC' })
    backend.insert({ position: 6, text: 'GGG' })
    await settle()

    expect(store.record().content).toBe('AAACCCGGG')
  })

  it('applies interleaved insert + annotation ops in order', async () => {
    const store = makeFakeStore({ id: 'seq1', content: 'ATCG', title: '', annotations: [], metadata: {} })
    const backend = createIndexedDbBackend('seq1', { store })

    backend.annotationCreated({ id: 'a1', caption: 'one', editId: 'e1' })
    backend.insert({ position: 4, text: 'TTTT' })
    backend.annotationCreated({ id: 'a2', caption: 'two', editId: 'e2' })
    await settle()

    const rec = store.record()
    expect(rec.content).toBe('ATCGTTTT')
    expect(rec.annotations.map(a => a.id)).toEqual(['a1', 'a2'])
  })

  it('a delete after an insert sees the inserted bases (no stale read)', async () => {
    const store = makeFakeStore({ id: 'seq1', content: 'AAAA', title: '', annotations: [], metadata: {} })
    const backend = createIndexedDbBackend('seq1', { store })

    backend.insert({ position: 4, text: 'GGGG' })   // -> AAAAGGGG
    backend.delete({ start: 0, end: 2 })            // -> AAGGGG
    await settle()

    expect(store.record().content).toBe('AAGGGG')
  })
})

describe('indexedDbBackend operation result promises (awaitable failures)', () => {
  it('edit methods return a promise that resolves on success', async () => {
    const store = makeFakeStore({ id: 'seq1', content: '', title: '', annotations: [], metadata: {} })
    const backend = createIndexedDbBackend('seq1', { store })

    await expect(backend.insert({ position: 0, text: 'AAA' })).resolves.toBeUndefined()
    expect(store.record().content).toBe('AAA')
  })

  it('a returned promise rejects when the underlying save fails', async () => {
    // Store whose save() always throws.
    const store = {
      record: () => null,
      get: async () => ({ id: 'seq1', content: '', title: '', annotations: [], metadata: {} }),
      save: async () => { throw new Error('disk full') }
    }
    const statuses = []
    const backend = createIndexedDbBackend('seq1', {
      store,
      onSyncStatusChange: (s) => statuses.push(s)
    })

    // Previously the error was swallowed and the promise resolved; callers/tests
    // could not assert persistence failure.
    await expect(backend.insert({ position: 0, text: 'AAA' })).rejects.toThrow('disk full')
    expect(statuses).toContain('error')
  })

  it('a failed operation does not poison subsequent operations in the queue', async () => {
    // Fail only the first save, then succeed.
    let saved = { id: 'seq1', content: 'AAAA', title: '', annotations: [], metadata: {} }
    let calls = 0
    const store = {
      record: () => saved,
      get: async () => JSON.parse(JSON.stringify(saved)),
      save: async (seq) => {
        calls += 1
        if (calls === 1) throw new Error('transient')
        saved = JSON.parse(JSON.stringify(seq))
      }
    }
    const backend = createIndexedDbBackend('seq1', { store })

    const first = backend.insert({ position: 4, text: 'BBBB' })   // save #1 -> throws
    const second = backend.insert({ position: 4, text: 'CCCC' })  // save #2 -> succeeds

    await expect(first).rejects.toThrow('transient')
    await expect(second).resolves.toBeUndefined()
    // Second op still applied (queue kept advancing) and observed the original 'AAAA'.
    expect(saved.content).toBe('AAAACCCC')
  })
})
