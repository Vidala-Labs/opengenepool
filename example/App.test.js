import { describe, it, expect } from 'bun:test'
import { SequenceDocument } from '../src/composables/SequenceDocument.js'
import { Span, Range } from '../src/utils/dna.js'
import { ezSpan } from '../test/span-helpers.js'

/**
 * Tests for the computed property logic in App.vue
 */
describe('App computed properties', () => {
  describe('normalizeSpan (boundary: rehydrated spans must become real Range/Span objects)', () => {
    // Mirrors example/App.vue normalizeSpan(). The example app persists sequences to
    // IndexedDB; structured clone (and JSON round-trips) strip the Span/Range prototypes,
    // so annotation.span arrives as plain {ranges:[{start,end,...}]}. The app must rebuild
    // real Range instances before handing data to the library (OGP does no defensive coding).
    function normalizeSpan(span) {
      if (span instanceof Span) return span
      if (typeof span === 'string') return Span.parse(span)
      if (span?.ranges) {
        return new Span(span.ranges.map(r =>
          r instanceof Range
            ? r
            : (typeof r === 'string'
                ? Range.parse(r)
                : new Range(r.start, r.end, r.orientation, r.startIndefinite, r.endIndefinite))
        ))
      }
      return new Span()
    }

    it('rebuilds Range instances from plain (structured-clone) ranges', () => {
      // IndexedDB persists via structured clone, which keeps own enumerable props
      // but strips the Range prototype: span -> { ranges: [{start,end,orientation,...}] }
      const plain = {
        ranges: [
          { start: 10, end: 50, orientation: -1, startIndefinite: false, endIndefinite: true }
        ]
      }
      expect(plain.ranges[0] instanceof Range).toBe(false)  // sanity: plain object

      const span = normalizeSpan(plain)
      expect(span instanceof Span).toBe(true)
      expect(span.ranges[0] instanceof Range).toBe(true)
      // The crash path: Span.toJSON()/toGenBank() call range methods that only exist on Range
      expect(() => span.toJSON()).not.toThrow()
      expect(span.toJSON()).toBe('(10..>50)')
    })

    it('rebuilds a multi-range span and survives toJSON()', () => {
      const plain = {
        ranges: [
          { start: 0, end: 5, orientation: 1 },
          { start: 9, end: 20, orientation: 1 }
        ]
      }
      const span = normalizeSpan(plain)
      expect(span.ranges.every(r => r instanceof Range)).toBe(true)
      expect(span.toJSON()).toBe('0..5 + 9..20')
    })

    it('rebuilds ranges stored as fenced strings (JSON-persisted spans)', () => {
      const span = normalizeSpan({ ranges: ['(10..>50)'] })
      expect(span.ranges[0] instanceof Range).toBe(true)
      expect(span.toJSON()).toBe('(10..>50)')
    })

    it('passes through an existing Span unchanged', () => {
      const span = new Span([new Range(0, 10)])
      expect(normalizeSpan(span)).toBe(span)
    })

    it('parses a string span', () => {
      expect(normalizeSpan('10..50').toJSON()).toBe('10..50')
    })
  })

  describe('displayTitle', () => {
    // Mirrors: const displayTitle = computed(() => currentSequenceData.value?.name || 'Untitled')
    function getDisplayTitle(currentSequenceData) {
      return currentSequenceData?.name || 'Untitled'
    }

    it('returns sequence name when available', () => {
      const data = { name: 'pUC19', sequence: 'ATCG' }
      expect(getDisplayTitle(data)).toBe('pUC19')
    })

    it('returns "Untitled" when name is missing', () => {
      const data = { sequence: 'ATCG' }
      expect(getDisplayTitle(data)).toBe('Untitled')
    })

    it('returns "Untitled" when name is empty string', () => {
      const data = { name: '', sequence: 'ATCG' }
      expect(getDisplayTitle(data)).toBe('Untitled')
    })

    it('returns "Untitled" when no sequence data', () => {
      expect(getDisplayTitle(null)).toBe('Untitled')
      expect(getDisplayTitle(undefined)).toBe('Untitled')
    })
  })

  describe('sequenceLength', () => {
    // Mirrors: const sequenceLength = computed(() => targetDoc.value?.sequence?.length || 0)
    function getSequenceLength(targetDoc) {
      return targetDoc?.sequence?.length || 0
    }

    it('returns sequence length from document', () => {
      const doc = new SequenceDocument({ sequence: 'ATCGATCGATCG' })
      expect(getSequenceLength(doc)).toBe(12)
    })

    it('returns 0 when document is null', () => {
      expect(getSequenceLength(null)).toBe(0)
    })

    it('returns 0 when sequence is empty', () => {
      const doc = new SequenceDocument({ sequence: '' })
      expect(getSequenceLength(doc)).toBe(0)
    })
  })

  describe('hasMetadata', () => {
    // Mirrors: const hasMetadata = computed(() => {
    //   const m = currentSequenceData.value?.metadata
    //   return m && (m.molecule_type || m.definition)
    // })
    function hasMetadata(currentSequenceData) {
      const m = currentSequenceData?.metadata
      return !!(m && (m.molecule_type || m.definition))
    }

    it('returns true when molecule_type is present', () => {
      const data = { metadata: { molecule_type: 'DNA' } }
      expect(hasMetadata(data)).toBe(true)
    })

    it('returns true when definition is present', () => {
      const data = { metadata: { definition: 'Cloning vector pUC19' } }
      expect(hasMetadata(data)).toBe(true)
    })

    it('returns true when both are present', () => {
      const data = { metadata: { molecule_type: 'DNA', definition: 'Cloning vector' } }
      expect(hasMetadata(data)).toBe(true)
    })

    it('returns false when metadata is empty', () => {
      const data = { metadata: {} }
      expect(hasMetadata(data)).toBe(false)
    })

    it('returns false when metadata is missing', () => {
      const data = { sequence: 'ATCG' }
      expect(hasMetadata(data)).toBe(false)
    })

    it('returns false when no sequence data', () => {
      expect(hasMetadata(null)).toBe(false)
    })
  })

  describe('targetDoc creation', () => {
    // Mirrors the computed that creates SequenceDocument from raw data
    function createTargetDoc(currentSequenceData) {
      if (!currentSequenceData) return null
      return new SequenceDocument({
        sequence: currentSequenceData.sequence,
        name: currentSequenceData.name,
        annotations: currentSequenceData.annotations || [],
        circular: currentSequenceData.metadata?.circular || false
      })
    }

    it('creates SequenceDocument from raw data', () => {
      const data = {
        sequence: 'ATCGATCG',
        name: 'pUC19',
        annotations: [{ id: '1', span: ezSpan(0, 4), type: 'misc_feature' }],
        metadata: { circular: true }
      }
      const doc = createTargetDoc(data)

      expect(doc).toBeInstanceOf(SequenceDocument)
      expect(doc.sequence).toBe('ATCGATCG')
      expect(doc.annotations.length).toBe(1)
      expect(doc.annotations[0].span.toJSON()).toBe('0..4')
      expect(doc.circular).toBe(true)
    })

    it('passes the sequence name into the document', () => {
      const data = { sequence: 'ATCGATCG', name: 'pUC19' }
      const doc = createTargetDoc(data)
      expect(doc.name).toBe('pUC19')
    })

    it('returns null when no data', () => {
      expect(createTargetDoc(null)).toBeNull()
    })

    it('defaults annotations to empty array', () => {
      const data = { sequence: 'ATCG' }
      const doc = createTargetDoc(data)
      expect(doc.annotations).toEqual([])
    })

    it('defaults circular to false', () => {
      const data = { sequence: 'ATCG' }
      const doc = createTargetDoc(data)
      expect(doc.circular).toBe(false)
    })
  })

  describe('queryDoc creation (alignment mode)', () => {
    function createQueryDoc(alignmentSequenceData) {
      if (!alignmentSequenceData) return null
      return new SequenceDocument({
        sequence: alignmentSequenceData.sequence,
        name: alignmentSequenceData.name,
        annotations: alignmentSequenceData.annotations || [],
        circular: alignmentSequenceData.metadata?.circular || false
      })
    }

    it('creates SequenceDocument for alignment query', () => {
      const data = { sequence: 'GGGGAAAA', annotations: [] }
      const doc = createQueryDoc(data)

      expect(doc).toBeInstanceOf(SequenceDocument)
      expect(doc.sequence).toBe('GGGGAAAA')
    })

    it('returns null when not in alignment mode', () => {
      expect(createQueryDoc(null)).toBeNull()
    })
  })
})

describe('Alignment mode logic', () => {
  describe('alignment state', () => {
    it('entering alignment mode sets query data', () => {
      let alignmentSequenceData = null

      // Simulate handleAlign
      function handleAlign(seqToAlign) {
        alignmentSequenceData = seqToAlign
      }

      handleAlign({ id: 'seq2', sequence: 'ATCGATCG' })
      expect(alignmentSequenceData).not.toBeNull()
      expect(alignmentSequenceData.id).toBe('seq2')
    })

    it('clearing alignment nullifies query data', () => {
      let alignmentSequenceData = { id: 'seq2', sequence: 'ATCGATCG' }

      // Simulate clearAlignment
      function clearAlignment() {
        alignmentSequenceData = null
      }

      clearAlignment()
      expect(alignmentSequenceData).toBeNull()
    })
  })

  describe('component rendering decision', () => {
    // Mirrors the v-if/v-else-if/v-else logic in App.vue template:
    // - v-if="!currentSequenceData" -> placeholder
    // - v-else-if="queryDoc" -> AlignmentEditor
    // - v-else -> SequenceEditor
    function getComponentToRender(currentSequenceData, queryDoc) {
      if (!currentSequenceData) return 'placeholder'
      if (queryDoc) return 'AlignmentEditor'
      return 'SequenceEditor'
    }

    it('renders placeholder when no sequence selected', () => {
      expect(getComponentToRender(null, null)).toBe('placeholder')
    })

    it('renders SequenceEditor when sequence selected but no alignment', () => {
      const currentData = { id: 'seq1', sequence: 'ATCG' }
      expect(getComponentToRender(currentData, null)).toBe('SequenceEditor')
    })

    it('renders AlignmentEditor when in alignment mode', () => {
      const currentData = { id: 'seq1', sequence: 'ATCG' }
      const queryData = new SequenceDocument({ sequence: 'GGGG' })
      expect(getComponentToRender(currentData, queryData)).toBe('AlignmentEditor')
    })

    it('switches from SequenceEditor to AlignmentEditor when alignment initiated', () => {
      const currentData = { id: 'seq1', sequence: 'ATCG' }

      // Initially no alignment
      expect(getComponentToRender(currentData, null)).toBe('SequenceEditor')

      // User right-clicks another sequence and chooses "Align with current"
      const queryData = new SequenceDocument({ sequence: 'GGGG' })
      expect(getComponentToRender(currentData, queryData)).toBe('AlignmentEditor')
    })

    it('switches back to SequenceEditor when alignment cleared', () => {
      const currentData = { id: 'seq1', sequence: 'ATCG' }
      let queryData = new SequenceDocument({ sequence: 'GGGG' })

      // In alignment mode
      expect(getComponentToRender(currentData, queryData)).toBe('AlignmentEditor')

      // User clicks close alignment button
      queryData = null
      expect(getComponentToRender(currentData, queryData)).toBe('SequenceEditor')
    })
  })
})

describe('Sidebar logic', () => {
  describe('selectedSequence computed', () => {
    // Mirrors: const selectedSequence = computed(() =>
    //   props.sequences.find(s => s.id === props.selectedId)
    // )
    function getSelectedSequence(sequences, selectedId) {
      return sequences.find(s => s.id === selectedId)
    }

    it('finds selected sequence from list', () => {
      const sequences = [
        { id: 'a', name: 'Seq A' },
        { id: 'b', name: 'Seq B' },
        { id: 'c', name: 'Seq C' }
      ]
      const selected = getSelectedSequence(sequences, 'b')
      expect(selected.name).toBe('Seq B')
    })

    it('returns undefined when no match', () => {
      const sequences = [{ id: 'a', name: 'Seq A' }]
      expect(getSelectedSequence(sequences, 'x')).toBeUndefined()
    })

    it('returns undefined when selectedId is null', () => {
      const sequences = [{ id: 'a', name: 'Seq A' }]
      expect(getSelectedSequence(sequences, null)).toBeUndefined()
    })
  })

  describe('context menu visibility', () => {
    // Context menu should not show for the currently selected sequence
    function shouldShowContextMenu(sequenceId, selectedId) {
      return sequenceId !== selectedId
    }

    it('shows context menu for non-selected sequence', () => {
      expect(shouldShowContextMenu('seq2', 'seq1')).toBe(true)
    })

    it('hides context menu for selected sequence', () => {
      expect(shouldShowContextMenu('seq1', 'seq1')).toBe(false)
    })
  })
})

/**
 * Tests for the handleEdit function logic in App.vue
 * These test the sequence manipulation logic that will be used in the app.
 */
/**
 * BUG TEST: Computed property that creates new SequenceDocument on every access
 *
 * This test demonstrates a bug where using a computed property that returns
 * `new SequenceDocument(...)` causes mutations to be lost, because each access
 * creates a fresh instance from the unchanged source data.
 */
describe('Computed document mutation bug', () => {
  it('mutations are lost when computed creates new instance on every access (BUG DEMO)', () => {
    // Simulate the buggy pattern from App.vue lines 54-61
    const currentSequenceData = { value: { sequence: 'ATCGATCGATCG', annotations: [] } }

    // This is the BUGGY pattern - creating new SequenceDocument on every access
    function getBuggyTargetDoc() {
      if (!currentSequenceData.value) return null
      return new SequenceDocument({
        sequence: currentSequenceData.value.sequence,
        annotations: currentSequenceData.value.annotations || [],
        circular: false
      })
    }

    // First access - get the document
    const doc1 = getBuggyTargetDoc()
    expect(doc1.sequence).toBe('ATCGATCGATCG')
    expect(doc1.sequence.length).toBe(12)

    // Delete 4 bases from position 4-8
    doc1.delete([{ start: 4, end: 8 }])

    // The document we mutated shows the change
    expect(doc1.sequence.length).toBe(8)
    expect(doc1.sequence).toBe('ATCGATCG')

    // BUT second access creates a NEW document from UNCHANGED source data!
    const doc2 = getBuggyTargetDoc()

    // BUG: The mutation is lost - we're back to the original sequence
    expect(doc2.sequence.length).toBe(12)  // Still 12, not 8!
    expect(doc2.sequence).toBe('ATCGATCGATCG')  // Original sequence!

    // The two documents are NOT the same instance
    expect(doc1).not.toBe(doc2)
  })

  it('mutations persist when document instance is reused (CORRECT PATTERN)', () => {
    // Simulate the correct pattern - create document once and reuse
    const currentSequenceData = { value: { sequence: 'ATCGATCGATCG', annotations: [] } }

    // Create document ONCE
    let cachedDoc = null
    function getCorrectTargetDoc() {
      if (!currentSequenceData.value) {
        cachedDoc = null
        return null
      }
      // Only create if we don't have one or source changed
      if (!cachedDoc) {
        cachedDoc = new SequenceDocument({
          sequence: currentSequenceData.value.sequence,
          annotations: currentSequenceData.value.annotations || [],
          circular: false
        })
      }
      return cachedDoc
    }

    // First access - get the document
    const doc1 = getCorrectTargetDoc()
    expect(doc1.sequence).toBe('ATCGATCGATCG')
    expect(doc1.sequence.length).toBe(12)

    // Delete 4 bases from position 4-8
    doc1.delete([{ start: 4, end: 8 }])

    // The document shows the change
    expect(doc1.sequence.length).toBe(8)
    expect(doc1.sequence).toBe('ATCGATCG')

    // Second access returns the SAME document instance
    const doc2 = getCorrectTargetDoc()

    // CORRECT: The mutation persists
    expect(doc2.sequence.length).toBe(8)
    expect(doc2.sequence).toBe('ATCGATCG')

    // Same instance
    expect(doc1).toBe(doc2)
  })
})

describe('App edit handling logic', () => {
  // Helper function that mirrors the handleEdit logic
  function applyEdit(sequence, data) {
    let seq = sequence

    if (data.type === 'delete' && data.ranges) {
      // Delete ranges from highest to lowest to avoid position shifting
      const sortedRanges = [...data.ranges].sort((a, b) => b.start - a.start)
      for (const range of sortedRanges) {
        seq = seq.slice(0, range.start) + seq.slice(range.end)
      }
    } else if (data.type === 'insert' && data.position !== undefined && data.text) {
      seq = seq.slice(0, data.position) + data.text + seq.slice(data.position)
    }

    return seq
  }

  describe('delete operations', () => {
    it('deletes middle 5bp from 25bp sequence', () => {
      const sequence = 'ATCGATCGAATTTTTCGATCGATCG'
      const result = applyEdit(sequence, {
        type: 'delete',
        ranges: [{ start: 10, end: 15 }]
      })
      expect(result).toBe('ATCGATCGAACGATCGATCG')
      expect(result.length).toBe(20)
    })

    it('handles multiple ranges deleted from high to low', () => {
      const sequence = 'ABCDEFGHIJKLMNOP'
      const result = applyEdit(sequence, {
        type: 'delete',
        ranges: [{ start: 2, end: 4 }, { start: 10, end: 12 }]
      })
      // Deletes KL (10-12) first, then CD (2-4)
      expect(result).toBe('ABEFGHIJMNOP')
    })
  })

  describe('insert operations', () => {
    it('inserts 5bp in middle of 20bp sequence', () => {
      const sequence = 'ATCGATCGATCGATCGATCG'
      const result = applyEdit(sequence, {
        type: 'insert',
        position: 10,
        text: 'GGGGG'
      })
      expect(result).toBe('ATCGATCGATGGGGGCGATCGATCG')
      expect(result.length).toBe(25)
    })

    it('inserts at beginning', () => {
      const sequence = 'ATCGATCG'
      const result = applyEdit(sequence, {
        type: 'insert',
        position: 0,
        text: 'TTT'
      })
      expect(result).toBe('TTTATCGATCG')
    })

    it('inserts at end', () => {
      const sequence = 'ATCGATCG'
      const result = applyEdit(sequence, {
        type: 'insert',
        position: 8,
        text: 'CCC'
      })
      expect(result).toBe('ATCGATCGCCC')
    })
  })

  describe('replace operations (delete + insert)', () => {
    it('replaces TTTTT with CCCCC', () => {
      const sequence = 'ATCGATCGAATTTTTCGATCGATCG'

      // First delete
      let result = applyEdit(sequence, {
        type: 'delete',
        ranges: [{ start: 10, end: 15 }]
      })
      expect(result).toBe('ATCGATCGAACGATCGATCG')

      // Then insert at same position
      result = applyEdit(result, {
        type: 'insert',
        position: 10,
        text: 'CCCCC'
      })
      expect(result).toBe('ATCGATCGAACCCCCCGATCGATCG')
      expect(result.length).toBe(25)
    })
  })
})
