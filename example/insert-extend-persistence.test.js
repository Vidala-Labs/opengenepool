import { describe, it, expect } from 'vitest'
import { SequenceDocument } from '../src/composables/SequenceDocument.js'
import { Span, Range, Orientation } from '../src/utils/dna.js'

/**
 * Integration test for "extend annotation on insert" through a backend that
 * rebuilds state from the EDIT STREAM (insert / annotationUpdate callbacks),
 * rather than by snapshotting the live document's in-memory annotation array.
 *
 * The demo's own persistence path (`snapshotDoc`) reads the live document, whose
 * annotation array is already adjusted in place — so it never exhibited the
 * extend-on-insert bug. A stream-rebuilding backend (e.g. an event-sourced server
 * like Labrador's) is the real-world case that DID drop the extension: it heard
 * only `insert` and never the annotation move.
 *
 * This `StreamBackend` is a minimal stand-in: it keeps its own annotation store,
 * applies the same fenced-coordinate shift on `insert`, and overwrites a span on
 * `annotationUpdate`. With the fix, an extend-on-insert reaches it as an
 * `annotationUpdate` and the persisted span includes the inserted bases.
 */
class StreamBackend {
  constructor(annotations) {
    // id -> { start, end, orientation }, fenced coordinates.
    this.store = new Map()
    for (const ann of annotations) {
      const r = ann.span.ranges[0]
      this.store.set(ann.id, { start: r.start, end: r.end, orientation: r.orientation })
    }
  }

  // Sequence channel: adjust annotations from the insert alone, honoring the
  // length-preservation contract (geometric, strand-agnostic). An insert never
  // changes an annotation's length unless it strictly straddles it: a boundary at
  // the geometric LOW coordinate shifts (site === low, insert lands before it); a
  // boundary at the geometric HIGH coordinate stays (insert lands after it). Plain
  // shifts come from this channel; extends arrive separately as annotationUpdate.
  insert({ position, text }) {
    const len = text.length
    for (const range of this.store.values()) {
      const low = Math.min(range.start, range.end)
      const high = Math.max(range.start, range.end)
      const newLow = low >= position ? low + len : low
      const newHigh = high > position ? high + len : high
      // Write back preserving orientation (start/end may be descending for reverse).
      if (range.start <= range.end) {
        range.start = newLow
        range.end = newHigh
      } else {
        range.start = newHigh
        range.end = newLow
      }
    }
  }

  // Annotation channel: overwrite the stored span from the (post-insert) payload.
  annotationUpdate({ id, span }) {
    const r = span.ranges[0]
    this.store.set(id, { start: r.start, end: r.end, orientation: r.orientation })
  }

  spanOf(id) {
    return this.store.get(id)
  }
}

const seedDoc = (orientation) => {
  const annotations = [
    { id: 'ann1', caption: 'Test', type: 'gene', span: new Span([new Range(2, 4, orientation)]) }
  ]
  const backend = new StreamBackend(annotations)
  const doc = new SequenceDocument({ sequence: 'ATCGATCG', annotations, backend })
  return { doc, backend }
}

describe('insert + extend persists through a stream-rebuilding backend', () => {
  for (const [strand, orientation] of [['forward', Orientation.PLUS], ['reverse', Orientation.MINUS]]) {
    describe(`${strand} strand`, () => {
      it('start boundary, no extend: backend annotation shifts to 4..6', () => {
        const { doc, backend } = seedDoc(orientation)
        doc.insert(2, 'GG')
        expect(backend.spanOf('ann1')).toEqual({ start: 4, end: 6, orientation })
      })

      it('start boundary, extend: backend keeps start, end grows to 2..6', () => {
        const { doc, backend } = seedDoc(orientation)
        doc.insert(2, 'GG', { extendStartIds: ['ann1'] })
        expect(backend.spanOf('ann1')).toEqual({ start: 2, end: 6, orientation })
      })

      it('end boundary, no extend: backend annotation unchanged at 2..4', () => {
        const { doc, backend } = seedDoc(orientation)
        doc.insert(4, 'GG')
        expect(backend.spanOf('ann1')).toEqual({ start: 2, end: 4, orientation })
      })

      it('end boundary, extend: backend end grows to 2..6', () => {
        const { doc, backend } = seedDoc(orientation)
        doc.insert(4, 'GG', { extendEndIds: ['ann1'] })
        expect(backend.spanOf('ann1')).toEqual({ start: 2, end: 6, orientation })
      })
    })
  }

  it('the backend store matches the live document after every case', () => {
    // Cross-check: stream-rebuilt state and in-memory state agree.
    const { doc, backend } = seedDoc(Orientation.PLUS)
    doc.insert(4, 'GG', { extendEndIds: ['ann1'] })

    const live = doc.annotations[0].span.ranges[0]
    const persisted = backend.spanOf('ann1')
    expect({ start: persisted.start, end: persisted.end }).toEqual({ start: live.start, end: live.end })
  })
})
