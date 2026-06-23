import { describe, it, expect } from 'vitest'
import { snapshotDoc } from './persistence.js'
import { SequenceDocument } from '../src/composables/SequenceDocument.js'
import { Span, Range, Orientation } from '../src/utils/dna.js'

describe('snapshotDoc (demo persistence)', () => {
  it('reflects the live document sequence after an edit, not the stale record', () => {
    // Loaded record + a live doc that has since been edited (bases deleted).
    const currentSequenceData = {
      id: 'seq1', name: 'pUC19',
      sequence: 'ATCGATCGATCG',   // stale: what was loaded
      annotations: [],
      metadata: { circular: true }
    }
    const liveDoc = new SequenceDocument({ sequence: 'ATCGATCGATCG', circular: true })
    liveDoc.delete([{ start: 0, end: 4 }])  // now 'ATCGATCG'

    const snap = snapshotDoc(currentSequenceData, liveDoc)

    // The persisted/exported sequence must be the LIVE doc's (8 bases), not stale 12.
    expect(snap.sequence).toBe('ATCGATCG')
    expect(snap.sequence).not.toBe(currentSequenceData.sequence)
  })

  it('demonstrates the bug it guards against: stale record diverges from the doc', () => {
    // This pins WHY the fix matters — exporting currentSequenceData.sequence (the old
    // behavior) would emit the pre-edit bases.
    const currentSequenceData = { id: 's', sequence: 'AAAA', annotations: [], metadata: {} }
    const liveDoc = new SequenceDocument({ sequence: 'AAAA' })
    liveDoc.insert(4, 'GGGG')  // live doc now 'AAAAGGGG'

    expect(currentSequenceData.sequence).toBe('AAAA')               // stale
    expect(snapshotDoc(currentSequenceData, liveDoc).sequence).toBe('AAAAGGGG')  // fixed
  })

  it('carries over record fields (id, name) and updates circular from the doc', () => {
    const currentSequenceData = { id: 'seq1', name: 'pUC19', sequence: 'AT', annotations: [], metadata: { circular: false, molecule_type: 'DNA' } }
    const liveDoc = new SequenceDocument({ sequence: 'ATCG', circular: true })

    const snap = snapshotDoc(currentSequenceData, liveDoc)
    expect(snap.id).toBe('seq1')
    expect(snap.name).toBe('pUC19')
    expect(snap.metadata.molecule_type).toBe('DNA')   // preserved
    expect(snap.metadata.circular).toBe(true)         // synced from live doc
    expect(snap.sequence).toBe('ATCG')
  })

  it('produces a plain (JSON-clonable) record with no Span class instances', () => {
    const liveDoc = new SequenceDocument({
      sequence: 'ATCGATCG',
      annotations: [{ id: 'a', caption: 'g', type: 'gene', span: new Span([new Range(0, 4, Orientation.PLUS)]) }]
    })
    const snap = snapshotDoc({ id: 's', metadata: {} }, liveDoc)
    // Round-trips through JSON without throwing; no class instances remain (Span
    // serializes to its fenced string, which the demo rehydrates on load).
    expect(() => JSON.stringify(snap)).not.toThrow()
    expect(typeof snap.annotations[0].span).toBe('string')
    expect(snap.annotations[0].span).toBe('0..4')
  })

  it('returns null when inputs are missing', () => {
    expect(snapshotDoc(null, {})).toBeNull()
    expect(snapshotDoc({}, null)).toBeNull()
  })
})
