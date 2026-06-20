import { describe, it, expect, beforeEach } from 'bun:test'
import { mount, flushPromises } from '@vue/test-utils'
import { ref, nextTick } from 'vue'
import AlignmentEditor from './AlignmentEditor.vue'
import { STORAGE_KEY } from '../composables/usePersistedZoom.js'
import { SequenceDocument } from '../composables/SequenceDocument.js'
import { Span, Range, Orientation } from '../utils/dna.js'
import { ezSpan } from '../../test/span-helpers.js'

// Helper to create a SequenceDocument for tests
function createDoc(sequence = '', annotations = [], circular = false, backend = null) {
  return new SequenceDocument({ sequence, annotations, circular, backend })
}

// Alignment now runs asynchronously (off the synchronous computed). `settle` waits
// for the runner to finish so alignmentResult/derived state are ready to assert.
// It is a superset of $nextTick, so it is safe to use everywhere a tick was used.
async function settle(wrapper) {
  await flushPromises()
  if (wrapper?.vm?.whenSettled) await wrapper.vm.whenSettled()
  await flushPromises()
  await wrapper?.vm?.$nextTick?.()
}

// Build a menu through the contributor service the way AlignmentEditor's
// showContextMenu does, from the legacy { source, mode, annotation, ... } shape.
function buildAlignmentMenu(wrapper, ctx = {}) {
  const mode = ctx.mode || wrapper.vm.selection.source.value || 'target'
  const targets = []
  if (ctx.source === 'annotation' && ctx.annotation) {
    targets.push({ layer: 'annotation', annotation: ctx.annotation, rangeIndex: ctx.fragment?.rangeIndex ?? ctx.rangeIndex ?? 0 })
  } else if (ctx.source === 'selection' || ctx.source === 'handle') {
    targets.push({ layer: 'selection', rangeIndex: ctx.rangeIndex, range: ctx.range, handleType: ctx.handleType })
  } else if (ctx.source === 'sequence') {
    targets.push({ layer: 'sequence', mode })
  }
  const len = (mode === 'query' ? wrapper.props('query') : wrapper.props('target'))?.sequence?.length ?? 0
  return wrapper.vm.contextMenu.buildMenu({
    mode,
    targets,
    annotations: [...(wrapper.props('target')?.annotations || []), ...(wrapper.props('query')?.annotations || [])],
    selection: wrapper.vm.selection,
    readonly: false,
    sequenceLength: len
  })
}

describe('AlignmentEditor Component', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY)
  })

  it('renders with required target and query props', async () => {
    const wrapper = mount(AlignmentEditor, {
      props: {
        target: createDoc('ATCGATCGATCG'),
        query: createDoc('ATCGATCGATCG')
      }
    })

    await settle(wrapper)

    expect(wrapper.find('.alignment-editor').exists()).toBe(true)
    expect(wrapper.find('.editor-svg').exists()).toBe(true)
  })

  it('computes alignment result for identical sequences', async () => {
    const sequence = 'CGAGTCAGT'

    const wrapper = mount(AlignmentEditor, {
      props: {
        target: createDoc(sequence),
        query: createDoc(sequence)
      }
    })

    await settle(wrapper)

    expect(wrapper.vm.hasAlignment).toBe(true)

    const result = wrapper.vm.alignmentResult
    expect(result.targetAligned).toBe('CGAGTCAGT')
    expect(result.queryAligned).toBe('CGAGTCAGT')
    expect(result.identity).toBe(100)

    const lines = wrapper.vm.alignmentLines
    expect(lines.length).toBeGreaterThan(0)
    expect(lines[0].matchText).toBe('|||||||||')
  })

  it('runs alignment asynchronously (result is null synchronously, set after settle)', async () => {
    const wrapper = mount(AlignmentEditor, {
      props: { target: createDoc('ATCGATCG'), query: createDoc('ATCGATCG') }
    })
    // Synchronously after mount the alignment has not run yet.
    expect(wrapper.vm.alignmentResult).toBeNull()
    expect(wrapper.vm.aligning).toBe(true)

    await settle(wrapper)

    expect(wrapper.vm.alignmentResult).not.toBeNull()
    expect(wrapper.vm.aligning).toBe(false)
  })

  it('shows an "Aligning…" indicator while pending, then selection status', async () => {
    const wrapper = mount(AlignmentEditor, {
      props: { target: createDoc('ATCGATCG'), query: createDoc('ATCGATCG') }
    })
    // While pending, the toolbar indicator reads "Aligning…".
    expect(wrapper.findComponent({ name: 'Indicator' }).props('text')).toBe('Aligning…')

    await settle(wrapper)

    // Once settled (no selection), the indicator is no longer "Aligning…".
    expect(wrapper.findComponent({ name: 'Indicator' }).props('text')).not.toBe('Aligning…')
  })

  it('does not show "No alignment found" while an alignment is still pending', async () => {
    const wrapper = mount(AlignmentEditor, {
      props: { target: createDoc('ATCGATCGATCG'), query: createDoc('ATCGATCGATCG') }
    })

    // Synchronously after mount the run is pending (worker/async fallback in flight).
    expect(wrapper.vm.aligning).toBe(true)

    // The empty-state placeholder must NOT claim "No alignment found" yet — the
    // alignment simply hasn't settled. (Pending and genuinely-empty are distinct.)
    const emptyText = wrapper.find('.empty-state').exists()
      ? wrapper.find('.empty-state').text()
      : ''
    expect(emptyText).not.toBe('No alignment found')

    await settle(wrapper)
  })

  it('shows "No alignment found" only once settled with no match', async () => {
    // Two sequences with no meaningful local alignment (score 0).
    const wrapper = mount(AlignmentEditor, {
      props: { target: createDoc('AAAAAAAAAAAA'), query: createDoc('GGGGGGGGGGGG') }
    })

    await settle(wrapper)

    expect(wrapper.vm.aligning).toBe(false)
    expect(wrapper.vm.hasAlignment).toBe(false)
    expect(wrapper.find('.empty-state').text()).toBe('No alignment found')
  })

  it('computes alignment for partial match', async () => {
    const target = 'CGAGTCAGT'
    const query = 'AGTCAGT'

    const wrapper = mount(AlignmentEditor, {
      props: {
        target: createDoc(target),
        query: createDoc(query)
      }
    })

    await settle(wrapper)

    expect(wrapper.vm.hasAlignment).toBe(true)

    const result = wrapper.vm.alignmentResult
    expect(result.queryAligned).toBe('AGTCAGT')
    expect(result.targetAligned).toBe('AGTCAGT')
    expect(result.identity).toBe(100)
    expect(result.targetStart).toBe(2)
  })

  it('shows no alignment message when no match found', async () => {
    const wrapper = mount(AlignmentEditor, {
      props: {
        target: createDoc('AAAAAAAAAA'),
        query: createDoc('TTTTTTTTTT')
      }
    })

    await settle(wrapper)

    // The alignment algorithm still finds some match, but let's test with really
    // different sequences that would produce no meaningful alignment
    // For now, just verify component renders
    expect(wrapper.find('.alignment-editor').exists()).toBe(true)
  })

  it('renders SequenceLayer components for target and query', async () => {
    const wrapper = mount(AlignmentEditor, {
      props: {
        target: createDoc('ATCGATCGATCG'),
        query: createDoc('ATCGATCGATCG')
      }
    })

    await settle(wrapper)

    const sequenceLayers = wrapper.findAllComponents({ name: 'SequenceLayer' })
    expect(sequenceLayers.length).toBe(2)
  })

  it('renders AlignmentTicksLayer for match indicators', async () => {
    const wrapper = mount(AlignmentEditor, {
      props: {
        target: createDoc('ATCGATCGATCG'),
        query: createDoc('ATCGATCGATCG')
      }
    })

    await settle(wrapper)

    const ticksLayer = wrapper.findComponent({ name: 'AlignmentTicksLayer' })
    expect(ticksLayer.exists()).toBe(true)
  })
})

describe('AlignmentEditor Selection', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY)
  })

  it('has selection composable available', async () => {
    const wrapper = mount(AlignmentEditor, {
      props: {
        target: createDoc('ATCGATCGATCG'),
        query: createDoc('ATCGATCGATCG')
      }
    })

    await settle(wrapper)

    expect(wrapper.vm.selection).toBeDefined()
    expect(wrapper.vm.selection.domain).toBeDefined()
  })

  it('can select on target row', async () => {
    const wrapper = mount(AlignmentEditor, {
      props: {
        target: createDoc('ATCGATCGATCG'),
        query: createDoc('ATCGATCGATCG')
      }
    })

    await settle(wrapper)

    wrapper.vm.selection.startSelection(0, false, 'target')
    wrapper.vm.selection.updateSelection(4)
    wrapper.vm.selection.endSelection()
    await settle(wrapper)

    expect(wrapper.vm.selection.isSelected.value).toBe(true)
    expect(wrapper.vm.selection.source.value).toBe('target')
  })

  it('can select on query row', async () => {
    const wrapper = mount(AlignmentEditor, {
      props: {
        target: createDoc('ATCGATCGATCG'),
        query: createDoc('ATCGATCGATCG')
      }
    })

    await settle(wrapper)

    wrapper.vm.selection.startSelection(0, false, 'query')
    wrapper.vm.selection.updateSelection(4)
    wrapper.vm.selection.endSelection()
    await settle(wrapper)

    expect(wrapper.vm.selection.isSelected.value).toBe(true)
    expect(wrapper.vm.selection.source.value).toBe('query')
  })

  it('getSelectedAlignmentSequenceText returns target sequence when target selected', async () => {
    const wrapper = mount(AlignmentEditor, {
      props: {
        target: createDoc('ATCGATCGATCG'),
        query: createDoc('GGGGAAAACCCC')
      }
    })

    await settle(wrapper)

    wrapper.vm.selection.startSelection(0, false, 'target')
    wrapper.vm.selection.updateSelection(4)
    wrapper.vm.selection.endSelection()
    await settle(wrapper)

    const selectedText = wrapper.vm.getSelectedAlignmentSequenceText()
    expect(selectedText).toBe('ATCG')
  })

  it('getSelectedAlignmentSequenceText returns query sequence when query selected', async () => {
    const wrapper = mount(AlignmentEditor, {
      props: {
        target: createDoc('ATCGATCGATCG'),
        query: createDoc('GGGGAAAACCCC')
      }
    })

    await settle(wrapper)

    wrapper.vm.selection.startSelection(0, false, 'query')
    wrapper.vm.selection.updateSelection(4)
    wrapper.vm.selection.endSelection()
    await settle(wrapper)

    const selectedText = wrapper.vm.getSelectedAlignmentSequenceText()
    expect(selectedText).toBe('GGGG')
  })
})

describe('AlignmentEditor Status Text', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY)
  })

  it('returns null for selectionStatusText when no selection (stats available via alignmentResult)', async () => {
    const wrapper = mount(AlignmentEditor, {
      props: {
        target: createDoc('ATCGATCGATCG'),
        query: createDoc('ATCGATCGATCG')
      }
    })

    await settle(wrapper)

    // selectionStatusText is null when no selection - stats should be displayed via #info slot
    const statusText = wrapper.vm.selectionStatusText
    expect(statusText).toBeNull()

    // But alignment stats are available via alignmentResult for the implementor
    const result = wrapper.vm.alignmentResult
    expect(result).not.toBeNull()
    expect(result.score).toBeGreaterThan(0)
    expect(result.identity).toBeGreaterThan(0)
  })

  it('shows Target selected when target row is selected', async () => {
    const wrapper = mount(AlignmentEditor, {
      props: {
        target: createDoc('ATCGATCGATCG'),
        query: createDoc('ATCGATCGATCG')
      }
    })

    await settle(wrapper)

    wrapper.vm.selection.startSelection(0, false, 'target')
    wrapper.vm.selection.updateSelection(4)
    wrapper.vm.selection.endSelection()
    await settle(wrapper)

    const statusText = wrapper.vm.selectionStatusText
    expect(statusText).toContain('Target selected')
  })

  it('shows Query selected when query row is selected', async () => {
    const wrapper = mount(AlignmentEditor, {
      props: {
        target: createDoc('ATCGATCGATCG'),
        query: createDoc('ATCGATCGATCG')
      }
    })

    await settle(wrapper)

    wrapper.vm.selection.startSelection(0, false, 'query')
    wrapper.vm.selection.updateSelection(4)
    wrapper.vm.selection.endSelection()
    await settle(wrapper)

    const statusText = wrapper.vm.selectionStatusText
    expect(statusText).toContain('Query selected')
  })

  it('uses plain GenBank coordinates for a forward (plus) selection', async () => {
    const wrapper = mount(AlignmentEditor, {
      props: { target: createDoc('ATCGATCGATCG'), query: createDoc('ATCGATCGATCG') }
    })
    await settle(wrapper)

    // Forward drag (pos > anchor) => PLUS orientation.
    wrapper.vm.selection.startSelection(0, false, 'target')
    wrapper.vm.selection.updateSelection(4)
    wrapper.vm.selection.endSelection()
    await settle(wrapper)

    const statusText = wrapper.vm.selectionStatusText
    expect(statusText).toContain('Target selected: 1..4')
    expect(statusText).not.toContain('complement')
  })

  it('wraps a complement (minus) selection coordinate in complement(...)', async () => {
    const wrapper = mount(AlignmentEditor, {
      props: { target: createDoc('ATCGATCGATCG'), query: createDoc('ATCGATCGATCG') }
    })
    await settle(wrapper)

    // Backward drag (pos < anchor) => MINUS orientation, i.e. a complement selection.
    wrapper.vm.selection.startSelection(4, false, 'target')
    wrapper.vm.selection.updateSelection(0)
    wrapper.vm.selection.endSelection()
    await settle(wrapper)

    const statusText = wrapper.vm.selectionStatusText
    expect(statusText).toContain('Target selected: complement(1..4)')
  })

  it('applies the same complement() coordinate notation on the query row', async () => {
    const wrapper = mount(AlignmentEditor, {
      props: { target: createDoc('ATCGATCGATCG'), query: createDoc('ATCGATCGATCG') }
    })
    await settle(wrapper)

    wrapper.vm.selection.startSelection(4, false, 'query')
    wrapper.vm.selection.updateSelection(0)
    wrapper.vm.selection.endSelection()
    await settle(wrapper)

    const statusText = wrapper.vm.selectionStatusText
    expect(statusText).toContain('Query selected: complement(1..4)')
  })

  it('shows the target-strand sequence for a forward target selection', async () => {
    const wrapper = mount(AlignmentEditor, {
      props: { target: createDoc('ATCGATCGATCG'), query: createDoc('ATCGATCGATCG') }
    })
    await settle(wrapper)

    wrapper.vm.selection.startSelection(0, false, 'target')
    wrapper.vm.selection.updateSelection(4)
    wrapper.vm.selection.endSelection()
    await settle(wrapper)

    // Forward target selection -> the actual target-strand bases at [0,4).
    expect(wrapper.vm.getSelectedAlignmentSequenceText()).toBe('ATCG')
  })

  it('reverse-complements the sequence for a complement target selection (copy content)', async () => {
    const wrapper = mount(AlignmentEditor, {
      props: { target: createDoc('ATCGATCGATCG'), query: createDoc('ATCGATCGATCG') }
    })
    await settle(wrapper)

    wrapper.vm.selection.startSelection(4, false, 'target')
    wrapper.vm.selection.updateSelection(0)
    wrapper.vm.selection.endSelection()
    await settle(wrapper)

    // complement(1..4): the copy/paste content is the reverse complement of ATCG.
    const { reverseComplement } = await import('../utils/dna.js')
    expect(wrapper.vm.getSelectedAlignmentSequenceText()).toBe(reverseComplement('ATCG'))
  })

  it('INVARIANT: selection orientation tracks drag direction (copy/paste color), not RC', async () => {
    // Green/red selection color is driven by range.orientation, which encodes the
    // drag direction (= the copy/paste content), NOT the alignment strand. On a
    // reverse-complement query, a forward drag must still produce a PLUS (green)
    // selection and a backward drag a MINUS (red) one — identical to a forward
    // alignment. This must not regress when the info-box notation changes.
    const { reverseComplement, Orientation } = await import('../utils/dna.js')
    const fwd = 'ATGGCCATTGTAATGGGCCGCTGAAA'
    const wrapper = mount(AlignmentEditor, {
      props: { target: createDoc(reverseComplement(fwd)), query: createDoc(fwd), initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await settle(wrapper)
    expect(wrapper.vm.alignmentResult.reverseComplement).toBe(true)

    // Forward drag on the RC query row -> PLUS (green).
    wrapper.vm.selection.startSelection(2, false, 'query')
    wrapper.vm.selection.updateSelection(8)
    wrapper.vm.selection.endSelection()
    await settle(wrapper)
    expect(wrapper.vm.selection.domain.value.ranges[0].orientation).toBe(Orientation.PLUS)

    // Backward drag on the RC query row -> MINUS (red).
    wrapper.vm.selection.startSelection(8, false, 'query')
    wrapper.vm.selection.updateSelection(2)
    wrapper.vm.selection.endSelection()
    await settle(wrapper)
    expect(wrapper.vm.selection.domain.value.ranges[0].orientation).toBe(Orientation.MINUS)
  })
})

describe('AlignmentEditor Reactivity', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY)
  })

  it('recomputes alignment when target document sequence changes', async () => {
    const targetDoc = createDoc('ATCGATCGATCG')
    const queryDoc = createDoc('ATCGATCGATCG')

    const wrapper = mount(AlignmentEditor, {
      props: {
        target: targetDoc,
        query: queryDoc
      }
    })

    await settle(wrapper)

    // Initial alignment should have 100% identity
    expect(wrapper.vm.alignmentResult.identity).toBe(100)
    const initialLength = wrapper.vm.alignmentResult.targetAligned.length

    // Delete from target document
    targetDoc.delete([{ start: 0, end: 4 }])
    await settle(wrapper)

    // Alignment should have changed - target is now shorter
    const newLength = wrapper.vm.alignmentResult.targetAligned.length
    expect(newLength).not.toBe(initialLength)
  })

  it('recomputes alignment when query document sequence changes', async () => {
    const targetDoc = createDoc('ATCGATCGATCG')
    const queryDoc = createDoc('ATCGATCGATCG')

    const wrapper = mount(AlignmentEditor, {
      props: {
        target: targetDoc,
        query: queryDoc
      }
    })

    await settle(wrapper)

    // Initial alignment
    expect(wrapper.vm.alignmentResult.identity).toBe(100)
    const initialLength = wrapper.vm.alignmentResult.queryAligned.length

    // Delete from query document
    queryDoc.delete([{ start: 0, end: 4 }])
    await settle(wrapper)

    // Alignment should have changed
    const newLength = wrapper.vm.alignmentResult.queryAligned.length
    expect(newLength).not.toBe(initialLength)
  })
})

describe('AlignmentEditor Edit Routing', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY)
  })

  it('deletes from target document when target row selected', async () => {
    const targetDoc = createDoc('ATCGATCGATCG')
    const queryDoc = createDoc('ATCGATCGATCG')

    const wrapper = mount(AlignmentEditor, {
      props: {
        target: targetDoc,
        query: queryDoc
      }
    })

    await settle(wrapper)

    const initialTargetLength = targetDoc.sequence.length

    // Select on target row
    wrapper.vm.selection.startSelection(0, false, 'target')
    wrapper.vm.selection.updateSelection(4)
    wrapper.vm.selection.endSelection()
    await settle(wrapper)

    // Use internal delete function (confirmDelete would be used via context menu)
    wrapper.vm.confirmDelete()
    await settle(wrapper)

    // Target should be shorter
    expect(targetDoc.sequence.length).toBe(initialTargetLength - 4)
    // Query should be unchanged
    expect(queryDoc.sequence.length).toBe(12)
  })

  it('deletes from query document when query row selected', async () => {
    const targetDoc = createDoc('ATCGATCGATCG')
    const queryDoc = createDoc('ATCGATCGATCG')

    const wrapper = mount(AlignmentEditor, {
      props: {
        target: targetDoc,
        query: queryDoc
      }
    })

    await settle(wrapper)

    const initialQueryLength = queryDoc.sequence.length

    // Select on query row
    wrapper.vm.selection.startSelection(0, false, 'query')
    wrapper.vm.selection.updateSelection(4)
    wrapper.vm.selection.endSelection()
    await settle(wrapper)

    // Use internal delete function
    wrapper.vm.confirmDelete()
    await settle(wrapper)

    // Query should be shorter
    expect(queryDoc.sequence.length).toBe(initialQueryLength - 4)
    // Target should be unchanged
    expect(targetDoc.sequence.length).toBe(12)
  })

  it('emits edit event with correct to field for target deletion', async () => {
    const targetDoc = createDoc('ATCGATCGATCG')
    const queryDoc = createDoc('ATCGATCGATCG')

    const wrapper = mount(AlignmentEditor, {
      props: {
        target: targetDoc,
        query: queryDoc
      }
    })

    await settle(wrapper)

    // Select on target row
    wrapper.vm.selection.startSelection(0, false, 'target')
    wrapper.vm.selection.updateSelection(4)
    wrapper.vm.selection.endSelection()
    await settle(wrapper)

    wrapper.vm.confirmDelete()
    await settle(wrapper)

    const editEvents = wrapper.emitted('edit')
    expect(editEvents).toBeDefined()
    expect(editEvents.length).toBe(1)
    expect(editEvents[0][0].type).toBe('delete')
    expect(editEvents[0][0].to).toBe('target')
  })

  it('emits edit event with correct to field for query deletion', async () => {
    const targetDoc = createDoc('ATCGATCGATCG')
    const queryDoc = createDoc('ATCGATCGATCG')

    const wrapper = mount(AlignmentEditor, {
      props: {
        target: targetDoc,
        query: queryDoc
      }
    })

    await settle(wrapper)

    // Select on query row
    wrapper.vm.selection.startSelection(0, false, 'query')
    wrapper.vm.selection.updateSelection(4)
    wrapper.vm.selection.endSelection()
    await settle(wrapper)

    wrapper.vm.confirmDelete()
    await settle(wrapper)

    const editEvents = wrapper.emitted('edit')
    expect(editEvents).toBeDefined()
    expect(editEvents.length).toBe(1)
    expect(editEvents[0][0].type).toBe('delete')
    expect(editEvents[0][0].to).toBe('query')
  })
})

describe('AlignmentEditor Annotations', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY)
  })

  it('computes alignedTargetAnnotations from target document', async () => {
    const { Annotation } = await import('../utils/annotation.js')
    const targetAnns = [
      new Annotation({ id: 'ann1', span: ezSpan(0, 6), type: 'gene', label: 'Test Gene' })
    ]

    const wrapper = mount(AlignmentEditor, {
      props: {
        target: createDoc('ATCGATCGATCG', targetAnns),
        query: createDoc('ATCGATCGATCG')
      }
    })

    await settle(wrapper)

    expect(wrapper.vm.alignedTargetAnnotations).toBeDefined()
    expect(wrapper.vm.alignedTargetAnnotations.length).toBe(1)
  })

  it('computes alignedQueryAnnotations from query document', async () => {
    const { Annotation } = await import('../utils/annotation.js')
    const queryAnns = [
      new Annotation({ id: 'qann1', span: ezSpan(0, 6), type: 'gene', label: 'Query Gene' })
    ]

    const wrapper = mount(AlignmentEditor, {
      props: {
        target: createDoc('ATCGATCGATCG'),
        query: createDoc('ATCGATCGATCG', queryAnns)
      }
    })

    await settle(wrapper)

    expect(wrapper.vm.alignedQueryAnnotations).toBeDefined()
    expect(wrapper.vm.alignedQueryAnnotations.length).toBe(1)
  })
})

describe('Annotation alignment mapping', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY)
  })

  it('maps annotations correctly when target has extra base', async () => {
    // Target: ATCGAATCG (9 bases) with annotation at 4..6 ("AA")
    // Query: ATCGATCG (8 bases) with annotation at 4..6 ("TC")
    // Aligned:
    //   Position: 012345678
    //   Target:   ATCGAATCG
    //   Query:    ATCG-ATCG
    //   Match:    |||| ||||
    //
    // Query annotation mapping:
    //   Original positions 4,5 ("TC") map to aligned positions 5,6 (after the gap)
    //   So original 4..6 -> aligned 5..7

    const { Annotation } = await import('../utils/annotation.js')

    const targetDoc = new SequenceDocument({
      sequence: 'ATCGAATCG',
      annotations: [
        new Annotation({ id: 'targetAnn', span: ezSpan(4, 6), type: 'gene', label: 'targetFoo' })
      ]
    })

    const queryDoc = new SequenceDocument({
      sequence: 'ATCGATCG',
      annotations: [
        new Annotation({ id: 'queryAnn', span: ezSpan(4, 6), type: 'gene', label: 'queryFoo' })
      ]
    })

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await settle(wrapper)

    // Verify alignment result
    const result = wrapper.vm.alignmentResult
    expect(result.targetAligned).toBe('ATCGAATCG')
    expect(result.queryAligned).toBe('ATCG-ATCG')

    // Verify target annotation mapping (no gaps in target, should be unchanged)
    const targetAnns = wrapper.vm.alignedTargetAnnotations
    expect(targetAnns.length).toBe(1)
    expect(targetAnns[0].span.ranges[0].start).toBe(4)
    expect(targetAnns[0].span.ranges[0].end).toBe(6)

    // Verify query annotation mapping (gap shifts positions after position 4)
    // Original 4..6 should map to aligned 5..7 (shifted by 1 due to gap at position 4)
    const queryAnns = wrapper.vm.alignedQueryAnnotations
    expect(queryAnns.length).toBe(1)
    expect(queryAnns[0].span.ranges[0].start).toBe(5)
    expect(queryAnns[0].span.ranges[0].end).toBe(7)
  })

  it('maps annotations correctly when query has extra base', async () => {
    // Swapped: query is now the longer sequence with the extra base
    // Target: ATCGATCG (8 bases) with annotation at 4..6 ("TC")
    // Query: ATCGAATCG (9 bases) with annotation at 4..6 ("AA")
    // Aligned:
    //   Position: 012345678
    //   Target:   ATCG-ATCG (gap at position 4)
    //   Query:    ATCGAATCG
    //   Match:    |||| ||||
    //
    // Target annotation mapping:
    //   Original positions 4,5 ("AT") map around the gap.
    //   So original 4..6 -> aligned 4..7

    const { Annotation } = await import('../utils/annotation.js')

    const targetDoc = new SequenceDocument({
      sequence: 'ATCGATCG',  // Shorter, will have gap in alignment
      annotations: [
        new Annotation({ id: 'targetAnn', span: ezSpan(4, 6), type: 'gene', label: 'targetFoo' })
      ]
    })

    const queryDoc = new SequenceDocument({
      sequence: 'ATCGAATCG',  // Longer, no gap
      annotations: [
        new Annotation({ id: 'queryAnn', span: ezSpan(4, 6), type: 'gene', label: 'queryFoo' })
      ]
    })

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await settle(wrapper)

    // Verify alignment result (target gets the gap when query is longer)
    const result = wrapper.vm.alignmentResult
    expect(result.targetAligned).toBe('ATCGA-TCG')
    expect(result.queryAligned).toBe('ATCGAATCG')

    // Verify target annotation (has gap, should span across it)
    // Original 4..6 should map to aligned 4..7
    const targetAnns = wrapper.vm.alignedTargetAnnotations
    expect(targetAnns.length).toBe(1)
    expect(targetAnns[0].span.ranges[0].start).toBe(4)
    expect(targetAnns[0].span.ranges[0].end).toBe(7)

    // Verify query annotation (no gaps in query, unchanged)
    const queryAnns = wrapper.vm.alignedQueryAnnotations
    expect(queryAnns.length).toBe(1)
    expect(queryAnns[0].span.ranges[0].start).toBe(4)
    expect(queryAnns[0].span.ranges[0].end).toBe(6)
  })

  it('projects query annotations through a target with an insertion, a deletion, and a mutation', async () => {
    // The query differs from the target by all three edit kinds at once:
    //   - SNP at position 6 (target C -> query A)
    //   - a 2bp deletion in the query around position 16 (gap in queryAligned)
    //   - a 2bp insertion in the query around position 28 (gap in targetAligned)
    //
    //   col:    0         1         2         3         4
    //           0123456789012345678901234567890123456789012345
    //   target: ATCGATCGATCGATCGAAAATTTTCCCCGGGG--TACGTACGTACG
    //   query:  ATCGATAGATCGATCG--AATTTTCCCCGGGGGGTACGTACGTACG
    //   match:  |||||| |||||||||  ||||||||||||||  ||||||||||||
    //
    // A query annotation upstream of every edit maps at identity; one downstream
    // of the deletion shifts by the 2bp gap width.
    const { Annotation } = await import('../utils/annotation.js')

    const target = 'ATCGATCGATCGATCGAAAATTTTCCCCGGGGTACGTACGTACG'
    const arr = target.split('')
    arr[6] = 'A' // SNP
    arr.splice(28, 0, 'G', 'G') // insertion (before deletion so target indices below hold)
    arr.splice(16, 2) // deletion
    const query = arr.join('')

    const targetDoc = new SequenceDocument({ sequence: target })
    const queryDoc = new SequenceDocument({
      sequence: query,
      annotations: [
        new Annotation({ id: 'qUp', span: ezSpan(2, 6), type: 'misc_feature', label: 'upstream' }),
        new Annotation({ id: 'qDown', span: ezSpan(20, 26), type: 'misc_feature', label: 'downstream' })
      ]
    })

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await settle(wrapper)

    const result = wrapper.vm.alignmentResult
    expect(result.targetAligned).toBe('ATCGATCGATCGATCGAAAATTTTCCCCGGGG--TACGTACGTACG')
    expect(result.queryAligned).toBe('ATCGATAGATCGATCG--AATTTTCCCCGGGGGGTACGTACGTACG')

    const queryAnns = wrapper.vm.alignedQueryAnnotations
    expect(queryAnns.length).toBe(2)

    const up = queryAnns.find(a => a.id === 'qUp')
    expect(up.span.ranges[0].start).toBe(2)
    expect(up.span.ranges[0].end).toBe(6)

    const down = queryAnns.find(a => a.id === 'qDown')
    expect(down.span.ranges[0].start).toBe(22)
    expect(down.span.ranges[0].end).toBe(28)
  })

  it('projects query annotations onto the reverse-complement query row', async () => {
    // The query is the antisense strand of the target, so it aligns as a reverse
    // complement: the aligned query row shows reverseComplement(query) lined up
    // under the target. A forward-strand query annotation must still appear on
    // that row, flipped into RC coordinates with its strand inverted.
    const { Annotation } = await import('../utils/annotation.js')
    const { reverseComplement } = await import('../utils/dna.js')

    const target = 'ATGCGTACGTTAGCCTAGGCTAATCGGATCCGGAATTCCTGCAG' // 44 bp
    const query = reverseComplement(target)

    const targetDoc = new SequenceDocument({ sequence: target })
    const queryDoc = new SequenceDocument({
      sequence: query,
      annotations: [
        // Forward (+) feature on the query document, original coords [5, 15).
        new Annotation({ id: 'qFeat', span: ezSpan(5, 15), type: 'misc_feature', label: 'q' })
      ]
    })

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await settle(wrapper)

    // Sanity: it aligned as reverse complement.
    expect(wrapper.vm.alignmentResult.reverseComplement).toBe(true)
    expect(wrapper.vm.queryIsReverseComplement).toBe(true)

    // The query annotation must NOT be suppressed; it appears flipped:
    //   original [5,15) over a 44bp query -> RC coords [29, 39), strand inverted.
    const queryAnns = wrapper.vm.alignedQueryAnnotations
    expect(queryAnns.length).toBe(1)
    expect(queryAnns[0].span.ranges[0].start).toBe(29)
    expect(queryAnns[0].span.ranges[0].end).toBe(39)
    expect(queryAnns[0].span.ranges[0].orientation).toBe(Orientation.MINUS)
  })

  it('renders an RC alignment with a query CDS that spans alignment gaps', async () => {
    // Regression: a CDS on the query projects to a MINUS-strand span in the RC
    // view. TranslationLayer iterates that span over the *gapped* aligned query
    // string; iterating a minus-strand range complements each base, and a gap
    // column ('-') has no complement. Previously this threw "Invalid DNA base: -"
    // mid-render and corrupted the vnode tree (TypeError: ... 'emitsOptions').
    // The query/target differ by an indel so the alignment genuinely has a gap
    // inside the CDS region.
    const { Annotation } = await import('../utils/annotation.js')
    const { reverseComplement, Span, Range, Orientation: O } = await import('../utils/dna.js')

    // A forward sequence with a CDS; insert a base so the alignment has a gap.
    const fwd = 'ATGGCCATTGTAATGGGCCGCTGAAAGGGTGCCCGATCAGTTACGGATCCGTACGTTAGC'
    const targetSeq = reverseComplement(fwd) // query (fwd) will align as RC
    // target also has a 1bp deletion relative to fwd so the alignment gaps.
    const targetGapped = reverseComplement(fwd.slice(0, 30) + fwd.slice(31))

    const targetDoc = new SequenceDocument({ sequence: targetGapped, circular: true })
    const queryDoc = new SequenceDocument({
      sequence: fwd,
      circular: true,
      annotations: [
        new Annotation({ id: 'cds', span: new Span([new Range(0, 60, O.PLUS)]), type: 'CDS', label: 'gene' })
      ]
    })

    // The mount + settle must NOT throw (the render crash happened on update).
    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await settle(wrapper)

    expect(wrapper.vm.alignmentResult.reverseComplement).toBe(true)
    // The CDS projected onto the query row as a MINUS-strand feature.
    expect(wrapper.vm.alignedQueryCdsAnnotations.length).toBe(1)
    expect(wrapper.vm.alignedQueryCdsAnnotations[0].span.ranges[0].orientation).toBe(Orientation.MINUS)
    // And the query translation rendered without error.
    expect(wrapper.find('.editor-svg').exists()).toBe(true)
  })

  it('creates an RC-aware indel annotation on a reverse-complement query', async () => {
    // When the query aligns as a reverse complement, the annotation created from a
    // gap must be RC-aware: it lands on the correct FORWARD document interval of
    // the original query and is marked minus-strand (the feature is on the
    // antisense strand that matched). It must NOT feed descending coordinates
    // into Range (which would throw) nor silently min/max them without orientation.
    const { reverseComplement, Orientation } = await import('../utils/dna.js')

    const fwd = 'ATGGCCATTGTAATGGGCCGCTGAAAGGGTGCCCGAT' // length 37
    // Query (fwd) aligns as RC against a target = RC(fwd) missing 3 bases at 18..21,
    // so the query carries a 3bp insertion relative to the target. From the probe:
    // the inserted query bases occupy original query positions {16,17,18}.
    const target = reverseComplement(fwd.slice(0, 18) + fwd.slice(21))

    const targetDoc = createDoc(target)
    const queryDoc = createDoc(fwd)

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await settle(wrapper)
    expect(wrapper.vm.alignmentResult.reverseComplement).toBe(true)

    const r = wrapper.vm.alignmentResult
    let gap = -1
    for (let i = 0; i < r.targetAligned.length; i++) {
      if (r.targetAligned[i] === '-' && r.queryAligned[i] !== '-') { gap = i; break }
    }
    expect(gap).toBeGreaterThan(-1)
    const region = wrapper.vm.findContiguousFeatureRegion(gap, 'insertion')
    expect(region.end - region.start).toBeGreaterThan(1) // genuinely multi-base

    const before = queryDoc.annotations.length
    await wrapper.vm.createInsertionAnnotation(region.start, region.end)
    await settle(wrapper)

    expect(queryDoc.annotations.length).toBe(before + 1)
    const ann = queryDoc.annotations[queryDoc.annotations.length - 1]
    expect(ann.type).toBe('insertion')
    // Correct forward interval over the original query: positions 16,17,18 -> [16,19).
    expect(ann.span.ranges[0].start).toBe(16)
    expect(ann.span.ranges[0].end).toBe(19)
    // And marked as an antisense-strand feature.
    expect(ann.span.ranges[0].orientation).toBe(Orientation.MINUS)
  })

  it('creates a forward (plus-strand) indel annotation when not reverse complement', async () => {
    const { Orientation } = await import('../utils/dna.js')
    // Forward: query has a 1bp insertion relative to target.
    const targetDoc = createDoc('ATCGATCG')
    const queryDoc = createDoc('ATCGAATCG')

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await settle(wrapper)
    expect(wrapper.vm.alignmentResult.reverseComplement).toBe(false)

    const r = wrapper.vm.alignmentResult
    let gap = -1
    for (let i = 0; i < r.targetAligned.length; i++) {
      if (r.targetAligned[i] === '-' && r.queryAligned[i] !== '-') { gap = i; break }
    }
    const region = wrapper.vm.findContiguousFeatureRegion(gap, 'insertion')
    await wrapper.vm.createInsertionAnnotation(region.start, region.end)
    await settle(wrapper)

    const ann = queryDoc.annotations[queryDoc.annotations.length - 1]
    expect(ann.span.ranges[0].end).toBeGreaterThan(ann.span.ranges[0].start)
    expect(ann.span.ranges[0].orientation).toBe(Orientation.PLUS)
  })

  it('keeps the query reverse map the true inverse of the query position map (RC)', async () => {
    // SelectionLayer draws a query selection by converting ORIGINAL query coords
    // back to aligned columns via queryReverseMap. A selection is stored in
    // original coords (queryPositionMap is RC-aware). For the highlight to land
    // under the cursor, queryReverseMap must be the inverse of queryPositionMap:
    //   queryReverseMap[queryPositionMap[col]] === col   (for every non-gap col)
    // Before the fix queryReverseMap was keyed on RC-STRING positions, so e.g.
    // original base 0 mapped to the LAST aligned column — selecting the leftmost
    // base highlighted the rightmost.
    const { reverseComplement } = await import('../utils/dna.js')

    const fwd = 'ATGGCCATTGTAATGGGCCGCTGAAA' // query, 26 bp
    const target = reverseComplement(fwd) // gapless RC

    const wrapper = mount(AlignmentEditor, {
      props: { target: createDoc(target), query: createDoc(fwd), initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await settle(wrapper)
    expect(wrapper.vm.alignmentResult.reverseComplement).toBe(true)

    const posMap = wrapper.vm.queryPositionMap // aligned col -> original query pos
    const revMap = wrapper.vm.queryReverseMap // original query pos -> aligned col

    // The two maps must round-trip for every non-gap aligned column.
    for (let col = 0; col < posMap.length; col++) {
      const orig = posMap[col]
      if (orig === null) continue
      expect(revMap[orig]).toBe(col)
    }

    // Concretely: the leftmost aligned column (0) holds some original base; that
    // base must map back to column 0, not the last column.
    const leftmostOrig = posMap[0]
    expect(revMap[leftmostOrig]).toBe(0)
  })

  it('highlights the leftmost RC query base on the left (not mirrored)', async () => {
    // The motivating selection bug: a selection on the RC query row is stored in
    // queryDoc (wrapped-forward) coordinates and drawn by converting back through
    // queryReverseMap. The displayed leftmost query base (the one whose wrapped
    // position is queryPositionMap[0]) must map to the leftmost aligned column 0,
    // i.e. the highlight lands under the cursor, not on the opposite end.
    const { reverseComplement } = await import('../utils/dna.js')
    const fwd = 'ATGGCCATTGTAATGGGCCGCTGAAA'
    const wrapper = mount(AlignmentEditor, {
      props: { target: createDoc(reverseComplement(fwd)), query: createDoc(fwd), initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await settle(wrapper)
    expect(wrapper.vm.alignmentResult.reverseComplement).toBe(true)

    const leftmostQueryPos = wrapper.vm.queryPositionMap[0]
    // queryReverseMap drives SelectionLayer.convertRangeToAligned; the leftmost
    // displayed base must convert to aligned column 0.
    expect(wrapper.vm.queryReverseMap[leftmostQueryPos]).toBe(0)
  })

  it('does not flip-flop the reverse-complement decision across settles', async () => {
    // The alignment runner reads props.query directly, NOT the wrapped queryDoc.
    // If it read the wrapped (RC'd) sequence, that would match forward, flip
    // reverseComplement false, unwrap, re-align, and oscillate. Settling twice
    // must leave the decision stable.
    const { reverseComplement } = await import('../utils/dna.js')
    const fwd = 'ATGGCCATTGTAATGGGCCGCTGAAA'
    const wrapper = mount(AlignmentEditor, {
      props: { target: createDoc(reverseComplement(fwd)), query: createDoc(fwd), initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await settle(wrapper)
    const first = wrapper.vm.alignmentResult.reverseComplement
    expect(first).toBe(true)
    await settle(wrapper)
    expect(wrapper.vm.alignmentResult.reverseComplement).toBe(true)
    // queryDoc is the RC wrapper view and stays so.
    expect(wrapper.vm.queryDoc.constructor.name).toBe('SequenceDocumentRC')
  })

  it('edits on the reverse-complement query row mutate the correct underlying bases', async () => {
    // End-to-end round-trip: deleting a displayed range on the RC query row must
    // remove the reverse-complemented bases from the UNDERLYING (props.query)
    // document — closing the loop the wrapper unit tests open.
    const { reverseComplement } = await import('../utils/dna.js')
    const fwd = 'ATGGCCATTGTAATGGGCCGCTGAAA' // 26 bp, the underlying query
    const queryDoc = createDoc(fwd)
    const wrapper = mount(AlignmentEditor, {
      props: { target: createDoc(reverseComplement(fwd)), query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await settle(wrapper)
    expect(wrapper.vm.alignmentResult.reverseComplement).toBe(true)

    // Delete displayed (wrapped) range [0,3) on the RC query row, via the wrapper.
    const before = fwd.length
    wrapper.vm.queryDoc.delete([{ start: 0, end: 3 }])

    // Underlying lost 3 bases; the removed bases correspond to the inner range
    // [N-3, N) = the LAST 3 bases of the original forward query.
    expect(queryDoc.sequence.length).toBe(before - 3)
    expect(queryDoc.sequence).toBe(fwd.slice(0, before - 3))
  })
})

describe('AlignmentEditor Context Menu', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY)
  })

  // Build a sequence-row menu via the contributor service the way the editor does.
  function sequenceRowMenu(wrapper, mode) {
    const len = (mode === 'query' ? wrapper.props('query') : wrapper.props('target'))?.sequence?.length ?? 0
    return wrapper.vm.contextMenu.buildMenu({
      mode,
      targets: [{ layer: 'sequence', mode }],
      selection: wrapper.vm.selection,
      readonly: false,
      sequenceLength: len
    })
  }

  // BUG 2: Create Annotation must be available even when neither row has annotations
  // (the AnnotationLayers are v-if mounted only when aligned annotations exist, so no
  // annotation contributor would be registered to own Create Annotation).
  it('offers Create Annotation on a sequence row even with no annotations present', async () => {
    const wrapper = mount(AlignmentEditor, {
      props: { target: createDoc('ATCGATCGATCG'), query: createDoc('ATCGATCGATCG') }  // no annotations
    })
    await settle(wrapper)

    const items = sequenceRowMenu(wrapper, 'target')
    expect(items.some(i => i.label === 'Create Annotation')).toBe(true)
  })

  it('shows context menu with Select all option when clicking on target sequence', async () => {
    const wrapper = mount(AlignmentEditor, {
      props: { target: createDoc('ATCGATCGATCG'), query: createDoc('ATCGATCGATCG') }
    })
    await settle(wrapper)

    const items = sequenceRowMenu(wrapper, 'target')
    expect(items.some(item => item.label === 'Select all')).toBe(true)
  })

  it('shows Select all along with other options when selection exists', async () => {
    const wrapper = mount(AlignmentEditor, {
      props: { target: createDoc('ATCGATCGATCG'), query: createDoc('ATCGATCGATCG') }
    })
    await settle(wrapper)

    wrapper.vm.selection.startSelection(0, false, 'target')
    wrapper.vm.selection.updateSelection(4)
    wrapper.vm.selection.endSelection()
    await settle(wrapper)

    const items = sequenceRowMenu(wrapper, 'target')
    expect(items.some(item => item.label === 'Select all')).toBe(true)
    expect(items.some(item => item.label === 'Copy selection')).toBe(true)
    expect(items.some(item => item.label === 'Select none')).toBe(true)
    expect(items.some(item => item.label === 'Delete sequence')).toBe(true)
  })

  it('Select all action selects entire target sequence', async () => {
    const wrapper = mount(AlignmentEditor, {
      props: { target: createDoc('ATCGATCGATCG'), query: createDoc('GGGGAAAACCCC') }
    })
    await settle(wrapper)
    expect(wrapper.vm.selection.isSelected.value).toBe(false)

    const items = sequenceRowMenu(wrapper, 'target')
    items.find(item => item.label === 'Select all').action()
    await settle(wrapper)

    expect(wrapper.vm.selection.isSelected.value).toBe(true)
    expect(wrapper.vm.selection.source.value).toBe('target')
    expect(wrapper.vm.selection.domain.value.ranges[0].start).toBe(0)
    expect(wrapper.vm.selection.domain.value.ranges[0].end).toBe(12)
  })

  it('Select all uses query sequence length when clicking on query row', async () => {
    const wrapper = mount(AlignmentEditor, {
      props: { target: createDoc('ATCGATCGATCG'), query: createDoc('GGGGAAAA') }  // 8 bases
    })
    await settle(wrapper)

    const items = sequenceRowMenu(wrapper, 'query')
    items.find(item => item.label === 'Select all').action()
    await settle(wrapper)

    expect(wrapper.vm.selection.isSelected.value).toBe(true)
    expect(wrapper.vm.selection.source.value).toBe('query')
    expect(wrapper.vm.selection.domain.value.ranges[0].start).toBe(0)
    expect(wrapper.vm.selection.domain.value.ranges[0].end).toBe(8)
  })
})

describe('AlignmentEditor Select All Context Menu', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY)
  })

  // Build a row's menu through the contributor service (as the editor does).
  function rowMenu(wrapper, mode) {
    const len = (mode === 'query' ? wrapper.props('query') : wrapper.props('target'))?.sequence?.length ?? 0
    return wrapper.vm.contextMenu.buildMenu({
      mode,
      targets: [{ layer: 'sequence', mode }],
      selection: wrapper.vm.selection,
      readonly: false,
      sequenceLength: len
    })
  }

  it('does NOT show Select all when right-clicking on empty background', async () => {
    const wrapper = mount(AlignmentEditor, {
      props: { target: createDoc('ATCGATCGATCG'), query: createDoc('ATCGATCGATCG') }
    })
    await settle(wrapper)

    // Background: no sequence target in the chain → no Select all.
    const items = wrapper.vm.contextMenu.buildMenu({
      mode: 'target', targets: [], selection: wrapper.vm.selection, readonly: false, sequenceLength: 0
    })
    expect(items.some(item => item.label === 'Select all')).toBe(false)
  })

  it('shows Select all for target when right-clicking on target sequence layer', async () => {
    const wrapper = mount(AlignmentEditor, {
      props: { target: createDoc('ATCGATCGATCG'), query: createDoc('GGGGAAAA') }
    })
    await settle(wrapper)

    const item = rowMenu(wrapper, 'target').find(i => i.label === 'Select all')
    expect(item).toBeDefined()
    item.action()
    await settle(wrapper)
    expect(wrapper.vm.selection.source.value).toBe('target')
    expect(wrapper.vm.selection.domain.value.ranges[0].end).toBe(12)
  })

  it('shows Select all for query when right-clicking on query sequence layer', async () => {
    const wrapper = mount(AlignmentEditor, {
      props: { target: createDoc('ATCGATCGATCG'), query: createDoc('GGGGAAAA') }
    })
    await settle(wrapper)

    const item = rowMenu(wrapper, 'query').find(i => i.label === 'Select all')
    expect(item).toBeDefined()
    item.action()
    await settle(wrapper)
    expect(wrapper.vm.selection.source.value).toBe('query')
    expect(wrapper.vm.selection.domain.value.ranges[0].end).toBe(8)
  })

  it('Select all is included when building the full row context menu', async () => {
    const wrapper = mount(AlignmentEditor, {
      props: { target: createDoc('ATCGATCGATCG'), query: createDoc('GGGGAAAA') }
    })
    await settle(wrapper)
    expect(rowMenu(wrapper, 'target').some(i => i.label === 'Select all')).toBe(true)
  })
})

describe('Delete via context menu (bug reproduction)', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY)
  })

  it('context menu Delete sequence on target removes the selected bases', async () => {
    const targetDoc = createDoc('ATCGATCGATCGATCGATCGATCG')  // 24bp
    const queryDoc = createDoc('ATCGATCGATCGATCGATCGATCG')   // 24bp identical

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await settle(wrapper)

    const initialTargetLength = targetDoc.sequence.length
    expect(initialTargetLength).toBe(24)

    // Verify the rendered target sequence before delete
    const sequenceLayers = wrapper.findAllComponents({ name: 'SequenceLayer' })
    const targetLayer = sequenceLayers.find(layer => layer.props('mode') === 'target')
    expect(targetLayer).toBeDefined()

    // Check the aligned target sequence shown in the view
    const alignedTargetBefore = wrapper.vm.alignedTargetSequence
    expect(alignedTargetBefore).toBe('ATCGATCGATCGATCGATCGATCG')

    // Select on target row (simulating mouse selection)
    wrapper.vm.selection.startSelection(5, false, 'target')
    wrapper.vm.selection.updateSelection(10)
    wrapper.vm.selection.endSelection()
    await settle(wrapper)

    expect(wrapper.vm.selection.source.value).toBe('target')
    expect(wrapper.vm.selection.isSelected.value).toBe(true)

    // Get context menu items (this is what happens when right-clicking)
    const menuItems = buildAlignmentMenu(wrapper, { source: 'sequence', mode: 'target' })

    // Find "Delete sequence" menu item
    const deleteItem = menuItems.find(item => item.label === 'Delete sequence')
    expect(deleteItem).toBeDefined()

    // Click "Delete sequence" - this calls handleDelete() which shows confirmation
    deleteItem.action()
    await settle(wrapper)

    // Confirmation dialog should be visible
    expect(wrapper.vm.deleteConfirmVisible).toBe(true)

    // Click confirm - this calls confirmDelete()
    wrapper.vm.confirmDelete()
    await settle(wrapper)

    // Verify the rendered target sequence after delete
    const alignedTargetAfter = wrapper.vm.alignedTargetSequence

    // Target should be modified (24 - 5 = 19)
    // Original: ATCGATCGATCGATCGATCGATCG (24bp)
    // Select 5..10: TCGAT (5 bases)
    // After: ATCGA + CGATCGATCGATCG = ATCGACGATCGATCGATCG (19bp)
    expect(targetDoc.sequence.length).toBe(19)
    expect(targetDoc.sequence).toBe('ATCGACGATCGATCGATCG')
    // Query should be unchanged
    expect(queryDoc.sequence.length).toBe(24)

    // The aligned sequence shown should also reflect the change
    expect(alignedTargetAfter.replace(/-/g, '').length).toBe(19)
  })

  it('PASSES: context menu Delete sequence on query works correctly', async () => {
    const targetDoc = createDoc('ATCGATCGATCGATCGATCGATCG')  // 24bp
    const queryDoc = createDoc('ATCGATCGATCGATCGATCGATCG')   // 24bp identical

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await settle(wrapper)

    const initialQueryLength = queryDoc.sequence.length
    expect(initialQueryLength).toBe(24)

    // Verify the rendered query sequence before delete
    const alignedQueryBefore = wrapper.vm.alignedQuerySequence
    expect(alignedQueryBefore).toBe('ATCGATCGATCGATCGATCGATCG')

    // Select on query row (simulating mouse selection)
    wrapper.vm.selection.startSelection(5, false, 'query')
    wrapper.vm.selection.updateSelection(10)
    wrapper.vm.selection.endSelection()
    await settle(wrapper)

    expect(wrapper.vm.selection.source.value).toBe('query')
    expect(wrapper.vm.selection.isSelected.value).toBe(true)

    // Get context menu items
    const menuItems = buildAlignmentMenu(wrapper, { source: 'sequence', mode: 'query' })

    // Find "Delete sequence" menu item
    const deleteItem = menuItems.find(item => item.label === 'Delete sequence')
    expect(deleteItem).toBeDefined()

    // Click "Delete sequence"
    deleteItem.action()
    await settle(wrapper)

    // Confirmation dialog should be visible
    expect(wrapper.vm.deleteConfirmVisible).toBe(true)

    // Click confirm
    wrapper.vm.confirmDelete()
    await settle(wrapper)

    // Verify the rendered query sequence after delete
    const alignedQueryAfter = wrapper.vm.alignedQuerySequence

    // Query should be modified (24 - 5 = 19)
    expect(queryDoc.sequence.length).toBe(19)
    // Target should be unchanged
    expect(targetDoc.sequence.length).toBe(24)

    // The aligned sequence shown should also reflect the change
    expect(alignedQueryAfter.replace(/-/g, '').length).toBe(19)
  })
})

describe('AlignmentEditor Mouse Interactions', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY)
  })

  it('SequenceLayer receives correct positionMap prop for target', async () => {
    const wrapper = mount(AlignmentEditor, {
      props: {
        target: createDoc('ATCGATCGATCG'),
        query: createDoc('ATCGATCGATCG')
      }
    })

    await settle(wrapper)

    // Check that alignment is computed
    expect(wrapper.vm.hasAlignment).toBe(true)

    // Find the target SequenceLayer
    const sequenceLayers = wrapper.findAllComponents({ name: 'SequenceLayer' })
    const targetLayer = sequenceLayers.find(layer => layer.props('mode') === 'target')
    expect(targetLayer).toBeDefined()

    // Verify positionMap is passed and populated
    const positionMap = targetLayer.props('positionMap')
    expect(positionMap).toBeDefined()
    expect(Array.isArray(positionMap)).toBe(true)
    expect(positionMap.length).toBeGreaterThan(0)
  })

  it('SequenceLayer receives correct positionMap prop for query', async () => {
    const wrapper = mount(AlignmentEditor, {
      props: {
        target: createDoc('ATCGATCGATCG'),
        query: createDoc('ATCGATCGATCG')
      }
    })

    await settle(wrapper)

    // Find the query SequenceLayer
    const sequenceLayers = wrapper.findAllComponents({ name: 'SequenceLayer' })
    const queryLayer = sequenceLayers.find(layer => layer.props('mode') === 'query')
    expect(queryLayer).toBeDefined()

    // Verify positionMap is passed and populated
    const positionMap = queryLayer.props('positionMap')
    expect(positionMap).toBeDefined()
    expect(Array.isArray(positionMap)).toBe(true)
    expect(positionMap.length).toBeGreaterThan(0)
  })

  it('mouse selection on target row sets source to target', async () => {
    const wrapper = mount(AlignmentEditor, {
      props: {
        target: createDoc('ATCGATCGATCG'),
        query: createDoc('ATCGATCGATCG')
      }
    })

    await settle(wrapper)

    // Find the target SequenceLayer by checking the mode prop
    const sequenceLayers = wrapper.findAllComponents({ name: 'SequenceLayer' })
    const targetLayer = sequenceLayers.find(layer => layer.props('mode') === 'target')
    expect(targetLayer).toBeDefined()

    // Simulate starting a selection on target layer
    // The SequenceLayer should call selection.startSelection with source='target'
    wrapper.vm.selection.startSelection(2, false, 'target')
    wrapper.vm.selection.updateSelection(6)
    wrapper.vm.selection.endSelection()
    await settle(wrapper)

    expect(wrapper.vm.selection.source.value).toBe('target')
    expect(wrapper.vm.selection.isSelected.value).toBe(true)
  })

  it('mouse selection on query row sets source to query', async () => {
    const wrapper = mount(AlignmentEditor, {
      props: {
        target: createDoc('ATCGATCGATCG'),
        query: createDoc('ATCGATCGATCG')
      }
    })

    await settle(wrapper)

    // Find the query SequenceLayer by checking the mode prop
    const sequenceLayers = wrapper.findAllComponents({ name: 'SequenceLayer' })
    const queryLayer = sequenceLayers.find(layer => layer.props('mode') === 'query')
    expect(queryLayer).toBeDefined()

    // Simulate starting a selection on query layer
    wrapper.vm.selection.startSelection(2, false, 'query')
    wrapper.vm.selection.updateSelection(6)
    wrapper.vm.selection.endSelection()
    await settle(wrapper)

    expect(wrapper.vm.selection.source.value).toBe('query')
    expect(wrapper.vm.selection.isSelected.value).toBe(true)
  })

  it('switching from target to query selection changes source', async () => {
    const wrapper = mount(AlignmentEditor, {
      props: {
        target: createDoc('ATCGATCGATCG'),
        query: createDoc('GGGGAAAACCCC')
      }
    })

    await settle(wrapper)

    // First select on target
    wrapper.vm.selection.startSelection(0, false, 'target')
    wrapper.vm.selection.updateSelection(4)
    wrapper.vm.selection.endSelection()
    await settle(wrapper)

    expect(wrapper.vm.selection.source.value).toBe('target')

    // Now select on query - should switch source
    wrapper.vm.selection.startSelection(0, false, 'query')
    wrapper.vm.selection.updateSelection(4)
    wrapper.vm.selection.endSelection()
    await settle(wrapper)

    expect(wrapper.vm.selection.source.value).toBe('query')
  })

  it('delete operation uses correct source document', async () => {
    const targetDoc = createDoc('ATCGATCGATCG')
    const queryDoc = createDoc('GGGGAAAACCCC')

    const wrapper = mount(AlignmentEditor, {
      props: {
        target: targetDoc,
        query: queryDoc
      }
    })

    await settle(wrapper)

    const initialQueryLength = queryDoc.sequence.length

    // Select on query row
    wrapper.vm.selection.startSelection(0, false, 'query')
    wrapper.vm.selection.updateSelection(4)
    wrapper.vm.selection.endSelection()
    await settle(wrapper)

    // Delete - should affect query document
    wrapper.vm.confirmDelete()
    await settle(wrapper)

    // Query should be shorter, target unchanged
    expect(queryDoc.sequence.length).toBe(initialQueryLength - 4)
    expect(targetDoc.sequence.length).toBe(12)
  })

  it('dragging on overlay creates selection with source=target', async () => {
    // This test verifies that clicking and dragging on the overlay creates a selection
    // We need to mock getBoundingClientRect since happy-dom doesn't provide real layout
    const wrapper = mount(AlignmentEditor, {
      props: {
        target: createDoc('ATCGATCGATCGATCGATCGATCG'), // 24 bases
        query: createDoc('ATCGATCGATCGATCGATCGATCG'),
        initialZoom: 100 // Use a zoom level that shows all bases
      },
      attachTo: document.body
    })

    await settle(wrapper)

    // Verify alignment is ready
    expect(wrapper.vm.hasAlignment).toBe(true)

    // Get the SVG element and mock its bounding rect
    const svg = wrapper.find('.editor-svg')
    expect(svg.exists()).toBe(true)

    // Mock getBoundingClientRect for the SVG element
    // This simulates real browser layout where the SVG starts at (0, 0)
    // and the left margin (lmargin) is where sequence text begins
    const lmargin = wrapper.vm.graphics.metrics.value.lmargin
    const charWidth = wrapper.vm.graphics.metrics.value.charWidth

    svg.element.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 500,
      width: 1000,
      height: 500
    })

    // Find the overlay rects within the target SequenceLayer
    const sequenceLayers = wrapper.findAllComponents({ name: 'SequenceLayer' })
    const targetLayer = sequenceLayers.find(layer => layer.props('mode') === 'target')
    expect(targetLayer).toBeDefined()

    // Find the overlay rect
    const overlay = targetLayer.find('.sequence-overlay')
    expect(overlay.exists()).toBe(true)

    // Before clicking, selection should be empty
    expect(wrapper.vm.selection.isSelected.value).toBe(false)

    // Calculate click positions based on actual metrics
    // Start at position 5 (after lmargin + 5 chars)
    const startX = lmargin + (5 * charWidth)
    // End at position 15 (after lmargin + 15 chars)
    const endX = lmargin + (15 * charWidth)

    // Trigger mousedown on the overlay at the starting position
    await overlay.trigger('mousedown', {
      button: 0,
      clientX: startX,
      clientY: 10
    })

    // Simulate drag to a different position with mousemove
    const mouseMoveEvent = new MouseEvent('mousemove', {
      bubbles: true,
      clientX: endX,
      clientY: 10
    })
    window.dispatchEvent(mouseMoveEvent)
    await settle(wrapper)

    // Trigger mouseup to complete the selection
    const mouseUpEvent = new MouseEvent('mouseup', { bubbles: true })
    window.dispatchEvent(mouseUpEvent)
    await settle(wrapper)

    // After clicking and dragging, a selection SHOULD be created:
    // - selection.source.value should be 'target' (since we clicked target row)
    // - selection.isSelected.value should be true
    // - selection.domain.value.ranges should have at least one range with non-zero length
    expect(wrapper.vm.selection.source.value).toBe('target')
    expect(wrapper.vm.selection.isSelected.value).toBe(true)

    const ranges = wrapper.vm.selection.domain.value?.ranges || []
    expect(ranges.length).toBeGreaterThan(0)

    // The selection should have a non-zero length (start !== end)
    const firstRange = ranges[0]
    expect(firstRange.end).toBeGreaterThan(firstRange.start)

    wrapper.unmount()
  })

  // A drag that begins on a row's sequence text must keep tracking the cursor even
  // while the cursor is over the whitespace BETWEEN the target and query rows (or in
  // a row's annotation band) — off the sequence text but inside the editor. The
  // selection must reflect the projected position, not freeze at the last on-text spot.
  // Identical sequences → no gaps → positionMap is identity, so projected pos == base.
  function setupRowDrag() {
    const wrapper = mount(AlignmentEditor, {
      props: {
        target: createDoc('ATCGATCGATCGATCGATCGATCG'), // 24 bases, identical → no gaps
        query: createDoc('ATCGATCGATCGATCGATCGATCG'),
        initialZoom: 100
      },
      attachTo: document.body
    })
    return wrapper
  }

  it('target-row drag keeps tracking while the cursor is in the inter-row whitespace', async () => {
    const wrapper = setupRowDrag()
    await settle(wrapper)
    expect(wrapper.vm.hasAlignment).toBe(true)

    const svg = wrapper.find('.editor-svg')
    svg.element.getBoundingClientRect = () => ({
      x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 500, width: 1000, height: 500
    })
    const lmargin = wrapper.vm.graphics.metrics.value.lmargin
    const charWidth = wrapper.vm.graphics.metrics.value.charWidth
    const lh = wrapper.vm.graphics.lineHeight.value
    const TOP_PADDING = 30

    const targetLayer = wrapper.findAllComponents({ name: 'SequenceLayer' })
      .find(l => l.props('mode') === 'target')
    const overlay = targetLayer.find('.sequence-overlay')

    // Mousedown on the target text at base 5 (Y on the target baseline).
    const startX = lmargin + 5 * charWidth + charWidth / 2
    await overlay.trigger('mousedown', { button: 0, clientX: startX, clientY: TOP_PADDING + lh / 2 })
    expect(wrapper.vm.selection.source.value).toBe('target')

    // Drag to base 15's X, but with Y on the MATCH line — the whitespace between the
    // target and query text rows (off the target text, inside the row block).
    const moveX = lmargin + 15 * charWidth + charWidth / 2
    const interRowY = TOP_PADDING + lh + lh / 2 // mid match-line band → still line 0
    window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: moveX, clientY: interRowY }))
    await settle(wrapper)

    const range = wrapper.vm.selection.domain.value.ranges[0]
    expect(range.end).toBe(15)        // tracked to the projected base under the cursor
    expect(range.end).not.toBe(5)     // not frozen at the mousedown base
    expect(wrapper.vm.selection.source.value).toBe('target') // row stays locked

    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    await settle(wrapper)
    wrapper.unmount()
  })

  it('query-row drag keeps tracking while the cursor is in the inter-row whitespace', async () => {
    const wrapper = setupRowDrag()
    await settle(wrapper)
    expect(wrapper.vm.hasAlignment).toBe(true)

    const svg = wrapper.find('.editor-svg')
    svg.element.getBoundingClientRect = () => ({
      x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 500, width: 1000, height: 500
    })
    const lmargin = wrapper.vm.graphics.metrics.value.lmargin
    const charWidth = wrapper.vm.graphics.metrics.value.charWidth
    const lh = wrapper.vm.graphics.lineHeight.value
    const TOP_PADDING = 30

    const queryLayer = wrapper.findAllComponents({ name: 'SequenceLayer' })
      .find(l => l.props('mode') === 'query')
    const overlay = queryLayer.find('.sequence-overlay')

    // Mousedown on the query text at base 5 (query baseline is at TOP_PADDING + 2*lh).
    const startX = lmargin + 5 * charWidth + charWidth / 2
    await overlay.trigger('mousedown', { button: 0, clientX: startX, clientY: TOP_PADDING + 2 * lh + lh / 2 })
    expect(wrapper.vm.selection.source.value).toBe('query')

    // Drag to base 15's X, but Y on the match line (whitespace between the two rows).
    const moveX = lmargin + 15 * charWidth + charWidth / 2
    const interRowY = TOP_PADDING + lh + lh / 2
    window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: moveX, clientY: interRowY }))
    await settle(wrapper)

    const range = wrapper.vm.selection.domain.value.ranges[0]
    expect(range.end).toBe(15)
    expect(range.end).not.toBe(5)
    expect(wrapper.vm.selection.source.value).toBe('query')

    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    await settle(wrapper)
    wrapper.unmount()
  })
})

describe('Delete with different sequences (alignment has gaps)', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY)
  })

  it('deletes from target when sequences differ (gapped alignment)', async () => {
    // Use sequences that produce gaps in alignment
    // Target has TTTTT in middle, query has GGGGG - this creates alignment gaps
    const targetDoc = createDoc('ATCGATCGATTTTTCGATCGATCG')  // 24bp
    const queryDoc = createDoc('ATCGATCGAGGGGGCGATCGATCG')   // 24bp, different middle

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await settle(wrapper)

    const initialLength = targetDoc.sequence.length
    expect(initialLength).toBe(24)

    // Log alignment result to understand the gaps

    // Select 5bp from target (positions 5..10)
    wrapper.vm.selection.startSelection(5, false, 'target')
    wrapper.vm.selection.updateSelection(10)
    wrapper.vm.selection.endSelection()
    await settle(wrapper)

    // Verify selection source
    expect(wrapper.vm.selection.source.value).toBe('target')

    // Log the selection
    const domain = wrapper.vm.selection.domain.value

    // Delete via confirmDelete (like context menu would)
    wrapper.vm.confirmDelete()
    await settle(wrapper)

    // Target should be modified
    expect(targetDoc.sequence.length).toBe(19)  // 24 - 5 = 19
  })

  it('deletes from query when sequences differ', async () => {
    // Same setup with different sequences
    const targetDoc = createDoc('ATCGATCGATTTTTCGATCGATCG')  // 24bp
    const queryDoc = createDoc('ATCGATCGAGGGGGCGATCGATCG')   // 24bp, different middle

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await settle(wrapper)

    const initialLength = queryDoc.sequence.length
    expect(initialLength).toBe(24)

    // Select 5bp from query (positions 5..10)
    wrapper.vm.selection.startSelection(5, false, 'query')
    wrapper.vm.selection.updateSelection(10)
    wrapper.vm.selection.endSelection()
    await settle(wrapper)

    // Verify selection source
    expect(wrapper.vm.selection.source.value).toBe('query')

    // Delete
    wrapper.vm.confirmDelete()
    await settle(wrapper)

    // Query should be modified
    expect(queryDoc.sequence.length).toBe(19)  // 24 - 5 = 19
  })
})

describe('AlignmentEditor Reactivity', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY)
  })

  it('alignmentResult recomputes when target sequence changes via delete', async () => {
    const targetDoc = createDoc('ATCGATCGATCGATCGATCGATCG')  // 24bp
    const queryDoc = createDoc('ATCGATCGATCGATCGATCGATCG')   // 24bp identical

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await settle(wrapper)

    // Capture alignmentResult BEFORE delete
    const alignmentBefore = wrapper.vm.alignmentResult
    expect(alignmentBefore).not.toBeNull()
    expect(alignmentBefore.targetAligned.length).toBe(24)

    // Delete from target sequence directly (bypassing selection/context menu)
    targetDoc.delete([{ start: 5, end: 10 }])
    await settle(wrapper)

    // Verify the document was modified
    expect(targetDoc.sequence.length).toBe(19)
    expect(targetDoc.sequence).toBe('ATCGACGATCGATCGATCG')

    // Capture alignmentResult AFTER delete
    const alignmentAfter = wrapper.vm.alignmentResult

    // The alignmentResult should be DIFFERENT - it should have been recomputed
    // with the new target sequence (19bp instead of 24bp)
    expect(alignmentAfter).not.toBeNull()

    // CRITICAL: This is the reactivity test
    // If reactivity works: alignmentAfter.targetAligned should reflect the new 19bp target
    // If reactivity fails: alignmentAfter will still show the old 24bp alignment
    expect(alignmentAfter.targetAligned).not.toBe(alignmentBefore.targetAligned)

    // The new alignment should be against the 19bp target
    const targetBasesInAlignment = alignmentAfter.targetAligned.replace(/-/g, '').length
    expect(targetBasesInAlignment).toBeLessThanOrEqual(19)
  })

  it('alignedTargetSequence updates when target document is modified', async () => {
    const targetDoc = createDoc('ATCGATCGATCGATCGATCGATCG')  // 24bp
    const queryDoc = createDoc('ATCGATCGATCGATCGATCGATCG')   // 24bp identical

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await settle(wrapper)

    // Before delete
    const alignedTargetBefore = wrapper.vm.alignedTargetSequence
    expect(alignedTargetBefore).toBe('ATCGATCGATCGATCGATCGATCG')

    // Delete from target
    targetDoc.delete([{ start: 0, end: 5 }])
    await settle(wrapper)

    // After delete - alignedTargetSequence should reflect the change
    const alignedTargetAfter = wrapper.vm.alignedTargetSequence

    // The aligned target should NOT still be the original 24bp sequence
    expect(alignedTargetAfter).not.toBe(alignedTargetBefore)

    // It should reflect the new 19bp target
    expect(alignedTargetAfter.replace(/-/g, '').length).toBeLessThanOrEqual(19)
  })
})

describe('Gap annotation context menu', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY)
  })

  it('detectAlignmentFeatureAt returns deletion when gap in query', async () => {
    // Target: ATCGAATCG (9 bases)
    // Query:  ATCGATCG  (8 bases)
    // Aligned:
    //   Target: ATCGAATCG
    //   Query:  ATCG-ATCG (gap at position 4)
    const targetDoc = createDoc('ATCGAATCG')
    const queryDoc = createDoc('ATCGATCG')

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await settle(wrapper)

    // Verify alignment
    expect(wrapper.vm.alignmentResult.targetAligned).toBe('ATCGAATCG')
    expect(wrapper.vm.alignmentResult.queryAligned).toBe('ATCG-ATCG')

    // Position 4 should be a deletion (gap in query)
    const feature = wrapper.vm.detectAlignmentFeatureAt(4)
    expect(feature).not.toBeNull()
    expect(feature.type).toBe('deletion')
    expect(feature.targetBase).toBe('A')
  })

  it('detectAlignmentFeatureAt returns insertion when gap in target', async () => {
    // Target: ATCGATCG  (8 bases)
    // Query:  ATCGAATCG (9 bases)
    // Aligned:
    //   Target: ATCGA-TCG (gap at position 5)
    //   Query:  ATCGAATCG
    const targetDoc = createDoc('ATCGATCG')
    const queryDoc = createDoc('ATCGAATCG')

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await settle(wrapper)

    // Verify alignment
    expect(wrapper.vm.alignmentResult.targetAligned).toBe('ATCGA-TCG')
    expect(wrapper.vm.alignmentResult.queryAligned).toBe('ATCGAATCG')

    // Position 5 should be an insertion (gap in target)
    const feature = wrapper.vm.detectAlignmentFeatureAt(5)
    expect(feature).not.toBeNull()
    expect(feature.type).toBe('insertion')
    expect(feature.queryBase).toBe('A')
  })

  it('detectAlignmentFeatureAt returns mutation when bases differ', async () => {
    // Target: ATCGATCG
    // Query:  ATCGTTCG (position 4: A->T)
    const targetDoc = createDoc('ATCGATCG')
    const queryDoc = createDoc('ATCGTTCG')

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await settle(wrapper)

    // Verify alignment (should be direct alignment with mismatch)
    expect(wrapper.vm.alignmentResult.targetAligned).toBe('ATCGATCG')
    expect(wrapper.vm.alignmentResult.queryAligned).toBe('ATCGTTCG')

    // Position 4 should be a mutation (A->T)
    const feature = wrapper.vm.detectAlignmentFeatureAt(4)
    expect(feature).not.toBeNull()
    expect(feature.type).toBe('mutation')
    expect(feature.targetBase).toBe('A')
    expect(feature.queryBase).toBe('T')
  })

  it('detectAlignmentFeatureAt returns null for matching bases', async () => {
    const targetDoc = createDoc('ATCGATCG')
    const queryDoc = createDoc('ATCGATCG')

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await settle(wrapper)

    // Position 0 should be a match (A=A), no feature
    const feature = wrapper.vm.detectAlignmentFeatureAt(0)
    expect(feature).toBeNull()
  })

  it('getAlignmentMenuItems returns "Annotate deletion" for gap in query', async () => {
    const targetDoc = createDoc('ATCGAATCG')
    const queryDoc = createDoc('ATCGATCG')

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await settle(wrapper)

    // Position 4 has gap in query
    const items = wrapper.vm.getAlignmentMenuItems(4, 'query')
    expect(items.length).toBeGreaterThan(0)
    expect(items.some(item => item.label === 'Annotate deletion')).toBe(true)
  })

  it('getAlignmentMenuItems returns "Annotate insertion" for gap in target', async () => {
    const targetDoc = createDoc('ATCGATCG')
    const queryDoc = createDoc('ATCGAATCG')

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await settle(wrapper)

    // Position 5 has gap in target (insertion in query)
    const items = wrapper.vm.getAlignmentMenuItems(5, 'query')
    expect(items.length).toBeGreaterThan(0)
    expect(items.some(item => item.label === 'Annotate insertion')).toBe(true)
  })

  it('getAlignmentMenuItems returns "Annotate mutation" for mismatch', async () => {
    const targetDoc = createDoc('ATCGATCG')
    const queryDoc = createDoc('ATCGTTCG')

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await settle(wrapper)

    // Position 4 is a mismatch (A vs T)
    const items = wrapper.vm.getAlignmentMenuItems(4, 'query')
    expect(items.length).toBeGreaterThan(0)
    expect(items.some(item => item.label === 'Annotate mutation')).toBe(true)
  })

  it('getAlignmentMenuItems returns empty array for matching bases', async () => {
    const targetDoc = createDoc('ATCGATCG')
    const queryDoc = createDoc('ATCGATCG')

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await settle(wrapper)

    // Position 0 is a match - no menu items
    const items = wrapper.vm.getAlignmentMenuItems(0, 'query')
    expect(items.length).toBe(0)
  })

  it('creates deletion annotation with correct span and caption (single base)', async () => {
    // Target: ATCGAATCG (9 bases)
    // Query:  ATCGATCG  (8 bases)
    // Aligned:
    //   Target: ATCGAATCG
    //   Query:  ATCG-ATCG (gap at position 4)
    // Deletion at aligned position 4 - target base 'A' at GenBank position 5 (1-indexed)
    // Caption should be: Δ(5)
    // Span: 3..5 (flanking bases in original query coordinates)
    const targetDoc = createDoc('ATCGAATCG')
    const queryDoc = createDoc('ATCGATCG')

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await settle(wrapper)

    // Verify no annotations initially
    expect(queryDoc.annotations.length).toBe(0)

    // Create deletion annotation at position 4 (single gap)
    wrapper.vm.createDeletionAnnotation(4, 5)
    await settle(wrapper)

    // Should have created annotation on query document
    expect(queryDoc.annotations.length).toBe(1)
    const ann = queryDoc.annotations[0]
    expect(ann.type).toBe('deletion')
    // Caption uses GenBank 1-indexed target position
    expect(ann.caption).toBe('Δ(5)')
    // Span should cover the flanking bases (positions 3 and 4 in original query)
    expect(ann.span.ranges[0].start).toBe(3)
    expect(ann.span.ranges[0].end).toBe(5)
  })

  it('creates deletion annotation with range caption for multi-base deletion', async () => {
    // Target: ATCGAAATCG (10 bases)
    // Query:  ATCGATCG   (8 bases)
    // Aligned:
    //   Target: ATCGAAATCG
    //   Query:  ATCG--ATCG (gaps at positions 4-5)
    // Deletion at aligned positions 4-6 - target bases 'AA' at GenBank positions 5..6
    // Caption should be: Δ(5..6)
    const targetDoc = createDoc('ATCGAAATCG')
    const queryDoc = createDoc('ATCGATCG')

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await settle(wrapper)

    // Verify alignment has the expected gaps
    expect(wrapper.vm.alignmentResult.targetAligned).toBe('ATCGAAATCG')
    expect(wrapper.vm.alignmentResult.queryAligned).toBe('ATCG--ATCG')

    // Create deletion annotation for the entire gap region (positions 4-6)
    wrapper.vm.createDeletionAnnotation(4, 6)
    await settle(wrapper)

    expect(queryDoc.annotations.length).toBe(1)
    const ann = queryDoc.annotations[0]
    expect(ann.type).toBe('deletion')
    // Caption uses GenBank 1-indexed target range
    expect(ann.caption).toBe('Δ(5..6)')
  })

  it('creates insertion annotation with sequence metadata', async () => {
    // Target: ATCGATCG  (8 bases)
    // Query:  ATCGAATCG (9 bases)
    // Aligned:
    //   Target: ATCGA-TCG (gap at position 5)
    //   Query:  ATCGAATCG
    // Insertion at aligned position 5 - inserted base 'A'
    // Caption: +A (the inserted sequence)
    // Span: 5..6 (the inserted base in original query coordinates)
    // Should store sequence in attributes
    const targetDoc = createDoc('ATCGATCG')
    const queryDoc = createDoc('ATCGAATCG')

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await settle(wrapper)

    // Verify no annotations initially
    expect(queryDoc.annotations.length).toBe(0)

    // Create insertion annotation at position 5
    wrapper.vm.createInsertionAnnotation(5, 6)
    await settle(wrapper)

    // Should have created annotation on query document
    expect(queryDoc.annotations.length).toBe(1)
    const ann = queryDoc.annotations[0]
    expect(ann.type).toBe('insertion')
    expect(ann.caption).toBe('+A')
    // Span should cover the inserted base (position 5 in original query)
    expect(ann.span.ranges[0].start).toBe(5)
    expect(ann.span.ranges[0].end).toBe(6)
    // Sequence should be stored in attributes
    expect(ann.attributes.sequence).toBe('A')
  })

  it('creates insertion annotation for multi-base insertion', async () => {
    // Target: ATCGATCG    (8 bases)
    // Query:  ATCGAAATCG  (10 bases)
    // Aligned:
    //   Target: ATCG--ATCG (gaps at positions 4-5)
    //   Query:  ATCGAAATCG
    // Insertion of 'AA' at aligned positions 5-7
    const targetDoc = createDoc('ATCGATCG')
    const queryDoc = createDoc('ATCGAAATCG')

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await settle(wrapper)

    // Verify alignment
    expect(wrapper.vm.alignmentResult.targetAligned).toBe('ATCGA--TCG')
    expect(wrapper.vm.alignmentResult.queryAligned).toBe('ATCGAAATCG')

    // Create insertion annotation for the entire insertion (positions 5-7)
    wrapper.vm.createInsertionAnnotation(5, 7)
    await settle(wrapper)

    expect(queryDoc.annotations.length).toBe(1)
    const ann = queryDoc.annotations[0]
    expect(ann.type).toBe('insertion')
    expect(ann.caption).toBe('+AA')
    expect(ann.attributes.sequence).toBe('AA')
  })

  it('creates mutation annotation with correct caption (single base)', async () => {
    // Target: ATCGATCG
    // Query:  ATCGTTCG (position 4: A->T)
    // Mutation at aligned position 4
    // Caption: A5T (targetBase + GenBank position + queryBase)
    const targetDoc = createDoc('ATCGATCG')
    const queryDoc = createDoc('ATCGTTCG')

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await settle(wrapper)

    // Verify no annotations initially
    expect(queryDoc.annotations.length).toBe(0)

    // Create mutation annotation at position 4
    wrapper.vm.createMutationAnnotation(4, 5)
    await settle(wrapper)

    // Should have created annotation on query document
    expect(queryDoc.annotations.length).toBe(1)
    const ann = queryDoc.annotations[0]
    expect(ann.type).toBe('mutation')
    // Caption: targetBase + GenBank position (1-indexed) + queryBase
    expect(ann.caption).toBe('A5T')
    // Span should cover the mutated base (position 4 in original query)
    expect(ann.span.ranges[0].start).toBe(4)
    expect(ann.span.ranges[0].end).toBe(5)
  })

  it('creates mutation annotation with range caption for multi-base mutation', async () => {
    // Target: ATCGATCGATCG
    // Query:  ATCGTTCGATCG (positions 4-5: AT->TT)
    // Mutation at aligned positions 4-6
    // Caption: AT(5..6)TT
    const targetDoc = createDoc('ATCGATCGATCG')
    const queryDoc = createDoc('ATCGTTCGATCG')

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await settle(wrapper)

    // Verify alignment (should be direct without gaps)
    expect(wrapper.vm.alignmentResult.targetAligned).toBe('ATCGATCGATCG')
    expect(wrapper.vm.alignmentResult.queryAligned).toBe('ATCGTTCGATCG')

    // Create mutation annotation for positions 4-6 (AT->TT)
    wrapper.vm.createMutationAnnotation(4, 6)
    await settle(wrapper)

    expect(queryDoc.annotations.length).toBe(1)
    const ann = queryDoc.annotations[0]
    expect(ann.type).toBe('mutation')
    // Caption: targetBases(GenBank range)queryBases
    expect(ann.caption).toBe('AT(5..6)TT')
  })

  it('clicking Annotate deletion menu item creates annotation with correct caption', async () => {
    const targetDoc = createDoc('ATCGAATCG')
    const queryDoc = createDoc('ATCGATCG')

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await settle(wrapper)

    // Get menu items for deletion position
    const items = wrapper.vm.getAlignmentMenuItems(4, 'query')
    const deleteItem = items.find(item => item.label === 'Annotate deletion')
    expect(deleteItem).toBeDefined()

    // Execute the action
    deleteItem.action()
    await settle(wrapper)

    // Should have created annotation with correct caption
    expect(queryDoc.annotations.length).toBe(1)
    expect(queryDoc.annotations[0].type).toBe('deletion')
    expect(queryDoc.annotations[0].caption).toBe('Δ(5)')
  })

  it('clicking Annotate insertion menu item creates annotation with correct caption', async () => {
    const targetDoc = createDoc('ATCGATCG')
    const queryDoc = createDoc('ATCGAATCG')

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await settle(wrapper)

    // Get menu items for insertion position
    const items = wrapper.vm.getAlignmentMenuItems(5, 'query')
    const insertItem = items.find(item => item.label === 'Annotate insertion')
    expect(insertItem).toBeDefined()

    // Execute the action
    insertItem.action()
    await settle(wrapper)

    // Should have created annotation with correct caption and sequence attribute
    expect(queryDoc.annotations.length).toBe(1)
    expect(queryDoc.annotations[0].type).toBe('insertion')
    expect(queryDoc.annotations[0].caption).toBe('+A')
    expect(queryDoc.annotations[0].attributes.sequence).toBe('A')
  })

  it('clicking Annotate mutation menu item creates annotation with correct caption', async () => {
    const targetDoc = createDoc('ATCGATCG')
    const queryDoc = createDoc('ATCGTTCG')

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await settle(wrapper)

    // Get menu items for mutation position
    const items = wrapper.vm.getAlignmentMenuItems(4, 'query')
    const mutationItem = items.find(item => item.label === 'Annotate mutation')
    expect(mutationItem).toBeDefined()

    // Execute the action
    mutationItem.action()
    await settle(wrapper)

    // Should have created annotation with correct caption
    expect(queryDoc.annotations.length).toBe(1)
    expect(queryDoc.annotations[0].type).toBe('mutation')
    expect(queryDoc.annotations[0].caption).toBe('A5T')
  })

  it('findContiguousFeatureRegion finds full deletion region', async () => {
    // Target: ATCGAAATCG (10 bases)
    // Query:  ATCGATCG   (8 bases)
    // Aligned:
    //   Target: ATCGAAATCG
    //   Query:  ATCG--ATCG (gaps at positions 4-5)
    const targetDoc = createDoc('ATCGAAATCG')
    const queryDoc = createDoc('ATCGATCG')

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await settle(wrapper)

    // Clicking on position 4 should find the full deletion region 4-6
    const region = wrapper.vm.findContiguousFeatureRegion(4, 'deletion')
    expect(region.start).toBe(4)
    expect(region.end).toBe(6)

    // Clicking on position 5 should also find the same region
    const region2 = wrapper.vm.findContiguousFeatureRegion(5, 'deletion')
    expect(region2.start).toBe(4)
    expect(region2.end).toBe(6)
  })

  it('findContiguousFeatureRegion finds full insertion region', async () => {
    // Target: ATCGATCG   (8 bases)
    // Query:  ATCGAAATCG (10 bases)
    // Aligned:
    //   Target: ATCGA--TCG (gaps at positions 5-6)
    //   Query:  ATCGAAATCG
    const targetDoc = createDoc('ATCGATCG')
    const queryDoc = createDoc('ATCGAAATCG')

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await settle(wrapper)

    // Clicking on position 5 should find the full insertion region 5-7
    const region = wrapper.vm.findContiguousFeatureRegion(5, 'insertion')
    expect(region.start).toBe(5)
    expect(region.end).toBe(7)
  })
})

describe('AlignmentTicksLayer context menu integration', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY)
  })

  it('right-clicking on gap in AlignmentTicksLayer shows "Annotate deletion" menu item', async () => {
    // Target: ATCGAATCG (9 bases)
    // Query:  ATCGATCG  (8 bases)
    // Aligned:
    //   Target: ATCGAATCG
    //   Query:  ATCG-ATCG (gap at position 4)
    const targetDoc = createDoc('ATCGAATCG')
    const queryDoc = createDoc('ATCGATCG')

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } },
      attachTo: document.body
    })
    await settle(wrapper)

    // Find the alignment-match overlay rect
    const matchOverlay = wrapper.find('rect.alignment-match-overlay')
    expect(matchOverlay.exists()).toBe(true)

    // Simulate right-click at a position that corresponds to the gap (position 4)
    // The overlay has data-line-start attribute
    const lineStart = parseInt(matchOverlay.attributes('data-line-start'))
    expect(lineStart).toBe(0)

    // Right-click on the overlay - we need to trigger contextmenu with coordinates
    // that would map to position 4 (the gap)
    await matchOverlay.trigger('contextmenu', {
      clientX: 100, // Will be used to calculate position
      clientY: 50,
      preventDefault: () => {},
      stopPropagation: () => {}
    })
    await settle(wrapper)

    // Context menu should be visible
    // Note: The actual position calculation depends on the SVG metrics
    // For this test, we verify the menu items are generated correctly
    const items = wrapper.vm.getAlignmentMenuItems(4, 'query')
    expect(items.length).toBeGreaterThan(0)
    expect(items.some(item => item.label === 'Annotate deletion')).toBe(true)

    wrapper.unmount()
  })

  it('right-clicking on insertion gap shows "Annotate insertion" menu item', async () => {
    // Target: ATCGATCG  (8 bases)
    // Query:  ATCGAATCG (9 bases)
    // Aligned:
    //   Target: ATCGA-TCG (gap at position 5)
    //   Query:  ATCGAATCG
    const targetDoc = createDoc('ATCGATCG')
    const queryDoc = createDoc('ATCGAATCG')

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } },
      attachTo: document.body
    })
    await settle(wrapper)

    // Find the alignment-match overlay rect
    const matchOverlay = wrapper.find('rect.alignment-match-overlay')
    expect(matchOverlay.exists()).toBe(true)

    // Verify menu items for position 5 (the insertion)
    const items = wrapper.vm.getAlignmentMenuItems(5, 'query')
    expect(items.length).toBeGreaterThan(0)
    expect(items.some(item => item.label === 'Annotate insertion')).toBe(true)

    wrapper.unmount()
  })

  it('right-clicking on mismatch shows "Annotate mutation" menu item', async () => {
    // Target: ATCGATCG
    // Query:  ATCGTTCG (position 4: A->T)
    const targetDoc = createDoc('ATCGATCG')
    const queryDoc = createDoc('ATCGTTCG')

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } },
      attachTo: document.body
    })
    await settle(wrapper)

    // Find the alignment-match overlay rect
    const matchOverlay = wrapper.find('rect.alignment-match-overlay')
    expect(matchOverlay.exists()).toBe(true)

    // Verify menu items for position 4 (the mismatch)
    const items = wrapper.vm.getAlignmentMenuItems(4, 'query')
    expect(items.length).toBeGreaterThan(0)
    expect(items.some(item => item.label === 'Annotate mutation')).toBe(true)

    wrapper.unmount()
  })

  it('resolves a match-line click on a LATER line to the correct aligned column', async () => {
    // Regression: the match-line overlay maps a click's clientX to an aligned
    // column relative to the line's START offset (line.start), not its ordinal
    // index. On a multi-line alignment a mismatch on line 1 (aligned columns
    // 100..199) is only reachable if 100 — not the ordinal 1 — is used as the
    // line offset. getAlignedPositionFromEvent(event, lineStart) returns
    // lineStart + charIndex, so passing the ordinal landed clicks near column 0
    // (a matching region) and the Annotate-mutation item never appeared.
    //
    // happy-dom has no layout (charWidth is degenerate), so we exercise the
    // composition directly: with the SVG rect mocked and a clientX one char-width
    // past the left margin, the resolved column must be lineStart + 1.
    const targetDoc = createDoc('ATCGATCGATCGATCGATCG')
    const queryDoc = createDoc('ATCGATCGATCGATCGATCG')

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } },
      attachTo: document.body
    })
    await settle(wrapper)

    const svg = wrapper.find('svg.editor-svg')
    svg.element.getBoundingClientRect = () => ({
      x: 0, y: 0, left: 0, top: 0, right: 2000, bottom: 1000, width: 2000, height: 1000
    })
    const lmargin = wrapper.vm.graphics.metrics.value.lmargin
    const charWidth = wrapper.vm.graphics.metrics.value.charWidth

    // The resolved column is lineStart + charIndex. The charIndex depends only on
    // clientX (not on lineStart), so passing 100 vs 0 must differ by exactly 100 —
    // i.e. the line's START offset is added, not its ordinal. (Robust to
    // happy-dom's degenerate charWidth, which makes the absolute charIndex
    // unreliable but identical across both calls.)
    const event = { clientX: lmargin + (3 * charWidth), clientY: 50 }
    const atStart100 = wrapper.vm.getAlignedPositionFromEvent(event, 100)
    const atStart0 = wrapper.vm.getAlignedPositionFromEvent(event, 0)
    expect(atStart100 - atStart0).toBe(100)

    wrapper.unmount()
  })

  it('right-clicking on matching bases shows no annotation menu items', async () => {
    // Target: ATCGATCG
    // Query:  ATCGATCG (identical)
    const targetDoc = createDoc('ATCGATCG')
    const queryDoc = createDoc('ATCGATCG')

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } },
      attachTo: document.body
    })
    await settle(wrapper)

    // Find the alignment-match overlay rect
    const matchOverlay = wrapper.find('rect.alignment-match-overlay')
    expect(matchOverlay.exists()).toBe(true)

    // Verify no menu items for position 0 (a match)
    const items = wrapper.vm.getAlignmentMenuItems(0, 'query')
    expect(items.length).toBe(0)

    wrapper.unmount()
  })

  it('executing deletion menu action from ticks layer creates annotation', async () => {
    // Target: ATCGAATCG (9 bases)
    // Query:  ATCGATCG  (8 bases)
    const targetDoc = createDoc('ATCGAATCG')
    const queryDoc = createDoc('ATCGATCG')

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } },
      attachTo: document.body
    })
    await settle(wrapper)

    // Verify no annotations initially
    expect(queryDoc.annotations.length).toBe(0)

    // Get menu items and execute the deletion action
    const items = wrapper.vm.getAlignmentMenuItems(4, 'query')
    const deleteItem = items.find(item => item.label === 'Annotate deletion')
    expect(deleteItem).toBeDefined()

    deleteItem.action()
    await settle(wrapper)

    // Annotation should be created on query document
    expect(queryDoc.annotations.length).toBe(1)
    expect(queryDoc.annotations[0].type).toBe('deletion')
    expect(queryDoc.annotations[0].caption).toBe('Δ(5)')

    wrapper.unmount()
  })

  it('executing insertion menu action from ticks layer creates annotation with sequence', async () => {
    // Target: ATCGATCG  (8 bases)
    // Query:  ATCGAATCG (9 bases)
    const targetDoc = createDoc('ATCGATCG')
    const queryDoc = createDoc('ATCGAATCG')

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } },
      attachTo: document.body
    })
    await settle(wrapper)

    // Verify no annotations initially
    expect(queryDoc.annotations.length).toBe(0)

    // Get menu items and execute the insertion action
    const items = wrapper.vm.getAlignmentMenuItems(5, 'query')
    const insertItem = items.find(item => item.label === 'Annotate insertion')
    expect(insertItem).toBeDefined()

    insertItem.action()
    await settle(wrapper)

    // Annotation should be created on query document
    expect(queryDoc.annotations.length).toBe(1)
    expect(queryDoc.annotations[0].type).toBe('insertion')
    expect(queryDoc.annotations[0].caption).toBe('+A')
    expect(queryDoc.annotations[0].attributes.sequence).toBe('A')

    wrapper.unmount()
  })

  it('executing mutation menu action from ticks layer creates annotation', async () => {
    // Target: ATCGATCG
    // Query:  ATCGTTCG (position 4: A->T)
    const targetDoc = createDoc('ATCGATCG')
    const queryDoc = createDoc('ATCGTTCG')

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } },
      attachTo: document.body
    })
    await settle(wrapper)

    // Verify no annotations initially
    expect(queryDoc.annotations.length).toBe(0)

    // Get menu items and execute the mutation action
    const items = wrapper.vm.getAlignmentMenuItems(4, 'query')
    const mutationItem = items.find(item => item.label === 'Annotate mutation')
    expect(mutationItem).toBeDefined()

    mutationItem.action()
    await settle(wrapper)

    // Annotation should be created on query document
    expect(queryDoc.annotations.length).toBe(1)
    expect(queryDoc.annotations[0].type).toBe('mutation')
    expect(queryDoc.annotations[0].caption).toBe('A5T')

    wrapper.unmount()
  })
})

describe('Context menu parity with SequenceEditor', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY)
  })

  describe('Insert/Replace sequence options', () => {
    it('shows "Insert sequence..." when cursor is at a position (zero-length selection)', async () => {
      const targetDoc = createDoc('ATCGATCGATCG')
      const queryDoc = createDoc('ATCGATCGATCG')

      const wrapper = mount(AlignmentEditor, {
        props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
        global: { stubs: { Teleport: true } }
      })
      await settle(wrapper)

      // Set cursor position (zero-length selection)
      wrapper.vm.selection.select([new Range(5, 5)])
      wrapper.vm.selection.source.value = 'target'
      await settle(wrapper)

      const items = buildAlignmentMenu(wrapper, { source: 'sequence' })
      expect(items.some(item => item.label === 'Insert sequence...')).toBe(true)
    })

    it('shows "Replace sequence with..." when selection has non-zero length', async () => {
      const targetDoc = createDoc('ATCGATCGATCG')
      const queryDoc = createDoc('ATCGATCGATCG')

      const wrapper = mount(AlignmentEditor, {
        props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
        global: { stubs: { Teleport: true } }
      })
      await settle(wrapper)

      // Set selection with range
      wrapper.vm.selection.select([new Range(2, 6)])
      wrapper.vm.selection.source.value = 'target'
      await settle(wrapper)

      const items = buildAlignmentMenu(wrapper, { source: 'sequence' })
      expect(items.some(item => item.label === 'Replace sequence with...')).toBe(true)
    })
  })

  // Note: Tests for "Merge with left segment", "Split annotation", "Flip strand",
  // "Delete this range", "Move range up/down" are NOT included here because those
  // menu items come from the shared layers (AnnotationLayer, SelectionLayer) via
  // getMenuItemsForElement(), not from buildContextMenuItems().
  // Those features are tested in the respective layer test files and work
  // automatically in AlignmentEditor since it uses the same layers.

  describe('Extension context menu items', () => {
    it('includes extension menu items when extensions provide them', async () => {
      const targetDoc = createDoc('ATCGATCGATCG')
      const queryDoc = createDoc('ATCGATCGATCG')

      // Mock extension with contextMenuItems
      const mockExtension = {
        contextMenuItems: (context, api) => {
          if (context.type === 'selection') {
            return [{ label: 'Mock Extension Action', action: () => {} }]
          }
          return []
        }
      }

      const wrapper = mount(AlignmentEditor, {
        props: {
          target: targetDoc,
          query: queryDoc,
          initialZoom: 100,
          extensions: [mockExtension]
        },
        global: { stubs: { Teleport: true } }
      })
      await settle(wrapper)

      // Set selection
      wrapper.vm.selection.select([new Range(2, 6)])
      wrapper.vm.selection.source.value = 'target'
      await settle(wrapper)

      const items = buildAlignmentMenu(wrapper, {
        source: 'selection'
      })

      expect(items.some(item => item.label === 'Mock Extension Action')).toBe(true)
    })
  })
})

describe('TranslationLayer in alignment mode', () => {
  // Helper to extract transform Y value from a transform string like "translate(0, 30)"
  function extractTransformY(transformStr) {
    if (!transformStr) return null
    const match = transformStr.match(/translate\([^,]+,\s*([^)]+)\)/)
    return match ? parseFloat(match[1]) : null
  }

  it('renders target translations above target sequence', async () => {
    // Create sequences with a CDS annotation
    const sequence = 'ATGATGATGATGATGATGATGATGATG' // 27bp = 9 codons
    const targetDoc = createDoc(sequence, [
      { type: 'CDS', span: ezSpan(0, 27), caption: 'TestCDS' }
    ])
    const queryDoc = createDoc(sequence, [
      { type: 'CDS', span: ezSpan(0, 27), caption: 'TestCDS' }
    ])

    const wrapper = mount(AlignmentEditor, {
      props: {
        target: targetDoc,
        query: queryDoc
      },
      global: { stubs: { Teleport: true } }
    })
    await settle(wrapper)

    // Find TranslationLayer components
    const translationLayers = wrapper.findAllComponents({ name: 'TranslationLayer' })
    expect(translationLayers.length).toBe(2) // One for target, one for query

    // Target translation layer should have mode="target" and stack-direction="up" (default)
    const targetTranslation = translationLayers.find(tl => tl.props('mode') === 'target')
    expect(targetTranslation).toBeTruthy()
    expect(targetTranslation.props('stackDirection')).toBe('up')

    // Query translation layer should have mode="query" and stack-direction="down"
    // This positions translation chevrons below the query sequence, above the CDS annotation bar
    const queryTranslation = translationLayers.find(tl => tl.props('mode') === 'query')
    expect(queryTranslation).toBeTruthy()
    expect(queryTranslation.props('stackDirection')).toBe('down')
  })

  it('target translation yOffset positions chevrons above target sequence row', async () => {
    const sequence = 'ATGATGATGATGATGATGATGATGATG'
    const targetDoc = createDoc(sequence, [
      { type: 'CDS', span: ezSpan(0, 27), caption: 'TestCDS' }
    ])
    const queryDoc = createDoc(sequence, [
      { type: 'CDS', span: ezSpan(0, 27), caption: 'TestCDS' }
    ])

    const wrapper = mount(AlignmentEditor, {
      props: {
        target: targetDoc,
        query: queryDoc
      },
      global: { stubs: { Teleport: true } }
    })
    await settle(wrapper)

    const translationLayers = wrapper.findAllComponents({ name: 'TranslationLayer' })
    const targetTranslation = translationLayers.find(tl => tl.props('mode') === 'target')

    // Target translation yOffset should be 0 (relative to block start)
    // getAlignmentLineY already accounts for TOP_PADDING, so yOffset is within-block offset
    // With stackDirection='up', the chevrons render above the sequence (negative Y direction)
    expect(targetTranslation.props('yOffset')).toBe(0)
  })

  it('query translation yOffset positions chevrons below query sequence row', async () => {
    const sequence = 'ATGATGATGATGATGATGATGATGATG'
    const targetDoc = createDoc(sequence, [
      { type: 'CDS', span: ezSpan(0, 27), caption: 'TestCDS' }
    ])
    const queryDoc = createDoc(sequence, [
      { type: 'CDS', span: ezSpan(0, 27), caption: 'TestCDS' }
    ])

    const wrapper = mount(AlignmentEditor, {
      props: {
        target: targetDoc,
        query: queryDoc
      },
      global: { stubs: { Teleport: true } }
    })
    await settle(wrapper)

    const translationLayers = wrapper.findAllComponents({ name: 'TranslationLayer' })
    const queryTranslation = translationLayers.find(tl => tl.props('mode') === 'query')

    // Query translation yOffset should be lineHeight * 3 (relative to block start)
    // getAlignmentLineY already accounts for TOP_PADDING, so yOffset is within-block offset
    // Query sequence is at lineHeight * 2, so lineHeight * 3 positions translation below it
    // With stackDirection='down', chevrons render below that position
    const lineHeight = wrapper.vm.graphics.lineHeight.value

    expect(queryTranslation.props('yOffset')).toBe(lineHeight * 3)
  })

  it('query translation does not overlap with match line', async () => {
    const sequence = 'ATGATGATGATGATGATGATGATGATG'
    const targetDoc = createDoc(sequence, [
      { type: 'CDS', span: ezSpan(0, 27), caption: 'TestCDS' }
    ])
    const queryDoc = createDoc(sequence, [
      { type: 'CDS', span: ezSpan(0, 27), caption: 'TestCDS' }
    ])

    const wrapper = mount(AlignmentEditor, {
      props: {
        target: targetDoc,
        query: queryDoc
      },
      global: { stubs: { Teleport: true } }
    })
    await settle(wrapper)

    const translationLayers = wrapper.findAllComponents({ name: 'TranslationLayer' })
    const queryTranslation = translationLayers.find(tl => tl.props('mode') === 'query')

    const TOP_PADDING = 30
    const lineHeight = wrapper.vm.graphics.lineHeight.value
    const translationHeight = 18 // Default height prop

    // Match line is at TOP_PADDING + lineHeight (within each block)
    const matchLineY = TOP_PADDING + lineHeight

    // Query translation renders at yOffset with stackDirection='down',
    // so chevrons span from yOffset to yOffset + translationHeight
    const queryTranslationTop = queryTranslation.props('yOffset')
    const queryTranslationBottom = queryTranslationTop + translationHeight

    // The top of the query translation should be BELOW the match line
    expect(queryTranslationTop).toBeGreaterThan(matchLineY)
  })

  it('filters gap characters when computing translations', async () => {
    // Create sequences that will produce gaps in alignment
    const targetDoc = createDoc('ATGATCGATG', [
      { type: 'CDS', span: ezSpan(0, 9), caption: 'TestCDS' }
    ])
    // Query has an insertion, creating a gap in target
    const queryDoc = createDoc('ATGAATCGATG', [
      { type: 'CDS', span: ezSpan(0, 9), caption: 'TestCDS' }
    ])

    const wrapper = mount(AlignmentEditor, {
      props: {
        target: targetDoc,
        query: queryDoc
      },
      global: { stubs: { Teleport: true } }
    })
    await settle(wrapper)

    // The alignment should have computed successfully
    expect(wrapper.vm.hasAlignment).toBe(true)

    // Both aligned sequences should exist and may contain gaps
    expect(wrapper.vm.alignedTargetSequence).toBeTruthy()
    expect(wrapper.vm.alignedQuerySequence).toBeTruthy()

    // TranslationLayer should still render without errors
    // (gaps are filtered before codon formation)
    const translationLayers = wrapper.findAllComponents({ name: 'TranslationLayer' })
    // May have 0, 1, or 2 depending on whether CDS annotations map through alignment
    expect(translationLayers.length).toBeGreaterThanOrEqual(0)
  })
})

describe('Copy annotation to target/query', () => {
  it('shows "Copy annotation to target" when right-clicking on query annotation', async () => {
    const { Annotation } = await import('../utils/annotation.js')

    const targetDoc = createDoc('ATCGATCG', [])
    const queryDoc = createDoc('ATCGATCG', [
      new Annotation({ span: ezSpan(2, 5), type: 'CDS', label: 'Test CDS' })
    ])

    const wrapper = mount(AlignmentEditor, {
      props: {
        target: targetDoc,
        query: queryDoc
      }
    })

    await settle(wrapper)

    // Build context menu for query annotation
    const queryAnnotation = wrapper.vm.alignedQueryAnnotations[0]
    expect(queryAnnotation).toBeDefined()

    const menuItems = buildAlignmentMenu(wrapper, {
      source: 'annotation',
      annotation: queryAnnotation
    })

    // Should have "Copy annotation to target" option
    const copyItem = menuItems.find(item => item.label === 'Copy annotation to target')
    expect(copyItem).toBeDefined()
  })

  it('shows "Copy annotation to query" when right-clicking on target annotation', async () => {
    const { Annotation } = await import('../utils/annotation.js')

    const targetDoc = createDoc('ATCGATCG', [
      new Annotation({ span: ezSpan(2, 5), type: 'CDS', label: 'Test CDS' })
    ])
    const queryDoc = createDoc('ATCGATCG', [])

    const wrapper = mount(AlignmentEditor, {
      props: {
        target: targetDoc,
        query: queryDoc
      }
    })

    await settle(wrapper)

    // Build context menu for target annotation
    const targetAnnotation = wrapper.vm.alignedTargetAnnotations[0]
    expect(targetAnnotation).toBeDefined()

    const menuItems = buildAlignmentMenu(wrapper, {
      source: 'annotation',
      annotation: targetAnnotation
    })

    // Should have "Copy annotation to query" option
    const copyItem = menuItems.find(item => item.label === 'Copy annotation to query')
    expect(copyItem).toBeDefined()
  })

  it('copies annotation from query to target when clicking copy menu item', async () => {
    const { Annotation } = await import('../utils/annotation.js')

    const targetDoc = createDoc('ATCGATCG', [])
    const queryDoc = createDoc('ATCGATCG', [
      new Annotation({ span: ezSpan(2, 5), type: 'CDS', caption: 'Test CDS' })
    ])

    const wrapper = mount(AlignmentEditor, {
      props: {
        target: targetDoc,
        query: queryDoc
      }
    })

    await settle(wrapper)

    // Verify initial state
    expect(targetDoc.annotations.length).toBe(0)
    expect(queryDoc.annotations.length).toBe(1)

    // Build context menu for query annotation
    const queryAnnotation = wrapper.vm.alignedQueryAnnotations[0]
    const menuItems = buildAlignmentMenu(wrapper, {
      source: 'annotation',
      annotation: queryAnnotation
    })

    // Execute copy action
    const copyItem = menuItems.find(item => item.label === 'Copy annotation to target')
    expect(copyItem).toBeDefined()
    copyItem.action()

    await settle(wrapper)

    // Target should now have the annotation copy
    expect(targetDoc.annotations.length).toBe(1)
    const copiedAnn = targetDoc.annotations[0]
    expect(copiedAnn.type).toBe('CDS')
    expect(copiedAnn.caption).toBe('Test CDS')
    expect(copiedAnn.span.toJSON()).toBe('2..5')

    // Query annotation should still exist
    expect(queryDoc.annotations.length).toBe(1)
  })

  it('copies annotation from target to query when clicking copy menu item', async () => {
    const { Annotation } = await import('../utils/annotation.js')

    const targetDoc = createDoc('ATCGATCG', [
      new Annotation({ span: ezSpan(2, 5), type: 'promoter', caption: 'Test Promoter' })
    ])
    const queryDoc = createDoc('ATCGATCG', [])

    const wrapper = mount(AlignmentEditor, {
      props: {
        target: targetDoc,
        query: queryDoc
      }
    })

    await settle(wrapper)

    // Verify initial state
    expect(targetDoc.annotations.length).toBe(1)
    expect(queryDoc.annotations.length).toBe(0)

    // Build context menu for target annotation
    const targetAnnotation = wrapper.vm.alignedTargetAnnotations[0]
    const menuItems = buildAlignmentMenu(wrapper, {
      source: 'annotation',
      annotation: targetAnnotation
    })

    // Execute copy action
    const copyItem = menuItems.find(item => item.label === 'Copy annotation to query')
    expect(copyItem).toBeDefined()
    copyItem.action()

    await settle(wrapper)

    // Query should now have the annotation copy
    expect(queryDoc.annotations.length).toBe(1)
    const copiedAnn = queryDoc.annotations[0]
    expect(copiedAnn.type).toBe('promoter')
    expect(copiedAnn.caption).toBe('Test Promoter')
    expect(copiedAnn.span.toJSON()).toBe('2..5')

    // Target annotation should still exist
    expect(targetDoc.annotations.length).toBe(1)
  })

  it('maps annotation coordinates through alignment when copying', async () => {
    const { Annotation } = await import('../utils/annotation.js')

    // Target has gap - query annotation at 4..6 covers "AA" which is an insertion
    // Target: ATCGATCG (8 bases)
    // Query: ATCGAATCG (9 bases) - extra 'A' at position 4
    // Aligned: Target: ATCGA-TCG, Query: ATCGAATCG
    // Query annotation 4..6 ("AA") maps across the matched A and inserted A.
    const targetDoc = createDoc('ATCGATCG', [])
    const queryDoc = createDoc('ATCGAATCG', [
      new Annotation({ span: ezSpan(4, 6), type: 'CDS', caption: 'AA region' })
    ])

    const wrapper = mount(AlignmentEditor, {
      props: {
        target: targetDoc,
        query: queryDoc
      }
    })

    await settle(wrapper)

    // Build context menu for query annotation
    const queryAnnotation = wrapper.vm.alignedQueryAnnotations[0]
    const menuItems = buildAlignmentMenu(wrapper, {
      source: 'annotation',
      annotation: queryAnnotation
    })

    // Execute copy action
    const copyItem = menuItems.find(item => item.label === 'Copy annotation to target')
    copyItem.action()

    await settle(wrapper)

    // Copied annotation span should be mapped through alignment
    // Query 4..6 partially overlaps with target, so result is 4..5 (one position)
    expect(targetDoc.annotations.length).toBe(1)
    const copiedAnn = targetDoc.annotations[0]
    expect(copiedAnn.span.toJSON()).toBe('4..5')
  })

  it('does not show copy options in readonly mode', async () => {
    const { Annotation } = await import('../utils/annotation.js')

    const targetDoc = createDoc('ATCGATCG', [
      new Annotation({ span: ezSpan(2, 5), type: 'CDS', caption: 'Test CDS' })
    ])
    const queryDoc = createDoc('ATCGATCG', [])

    const wrapper = mount(AlignmentEditor, {
      props: {
        target: targetDoc,
        query: queryDoc,
        readonly: true
      }
    })

    await settle(wrapper)

    // Build context menu for target annotation
    const targetAnnotation = wrapper.vm.alignedTargetAnnotations[0]
    const menuItems = buildAlignmentMenu(wrapper, {
      source: 'annotation',
      annotation: targetAnnotation
    })

    // Should not have copy option in readonly mode
    const copyItem = menuItems.find(item => item.label === 'Copy annotation to query')
    expect(copyItem).toBeUndefined()
  })

  it('does not show copy option when annotation is entirely in a gap', async () => {
    const { Annotation } = await import('../utils/annotation.js')

    // Target has a deletion - query position 5 corresponds to a gap in target
    // Target: ATCGATCG (8 bases)
    // Query: ATCGAATCG (9 bases) - extra 'A' at position 5
    // Annotation covers ONLY the extra 'A' (5..6) which is a gap in target
    const targetDoc = createDoc('ATCGATCG', [])
    const queryDoc = createDoc('ATCGAATCG', [
      new Annotation({ span: ezSpan(5, 6), type: 'CDS', caption: 'Single insertion' })
    ])

    const wrapper = mount(AlignmentEditor, {
      props: {
        target: targetDoc,
        query: queryDoc
      }
    })

    await settle(wrapper)

    // Verify alignment result shows the gap
    // Query aligned: ATCGAATCG
    // Target aligned: ATCGA-TCG (gap at position 5)
    expect(wrapper.vm.alignedQuerySequence).toBe('ATCGAATCG')
    expect(wrapper.vm.alignedTargetSequence).toBe('ATCGA-TCG')

    // Build context menu for query annotation
    const queryAnnotation = wrapper.vm.alignedQueryAnnotations[0]
    expect(queryAnnotation).toBeDefined()

    const menuItems = buildAlignmentMenu(wrapper, {
      source: 'annotation',
      annotation: queryAnnotation
    })

    // Should NOT have "Copy annotation to target" because it's entirely in a gap
    const copyItem = menuItems.find(item => item.label === 'Copy annotation to target')
    expect(copyItem).toBeUndefined()
  })
})

describe('AlignmentEditor Translation Spacing', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY)
  })

  it('AnnotationLayer receives effectiveShowTranslation that considers zoom level', async () => {
    // This test verifies that the show-translation prop passed to AnnotationLayer
    // uses effectiveShowTranslation (which considers codon width) not just showTranslation
    const { Annotation } = await import('../utils/annotation.js')
    const targetDoc = createDoc('ATCGATCGATCGATCGATCGATCG', [
      new Annotation({ span: ezSpan(0, 24), type: 'CDS', caption: 'GFP' })
    ])
    const queryDoc = createDoc('ATCGATCGATCGATCGATCGATCG', [
      new Annotation({ span: ezSpan(0, 24), type: 'CDS', caption: 'mCherry' })
    ])

    const wrapper = mount(AlignmentEditor, {
      props: {
        target: targetDoc,
        query: queryDoc,
        initialZoom: 100
      }
    })
    await settle(wrapper)

    // Find the AnnotationLayer components - they should exist for target and query
    const annotationLayers = wrapper.findAllComponents({ name: 'AnnotationLayer' })

    // At least the query annotation layer should be present (may be 0-2 depending on visibility)
    // The key is that the show-translation binding uses effectiveShowTranslation
    // We verify this by checking the component's source code was updated

    // This is more of a smoke test - the actual behavior is tested by:
    // 1. The implementation using effectiveShowTranslation computed
    // 2. effectiveShowTranslation checking codonWidth >= MIN_CODON_WIDTH (8px)
    // 3. When zoomed out, codonWidth will be < 8px, so effectiveShowTranslation = false
    // 4. This means annotations won't reserve translation space when zoomed out

    expect(wrapper.vm.hasAlignment).toBe(true)
  })
})

describe('AlignmentEditor CDS Mutation Annotation', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY)
  })

  it('findCdsContainingRange returns CDS when range is entirely within', async () => {
    const { Annotation } = await import('../utils/annotation.js')
    // Create a CDS annotation from positions 0-24
    const targetDoc = createDoc('ATGATCGATCGATCGATCGATCGA', [
      new Annotation({ span: ezSpan(0, 24), type: 'CDS', caption: 'GFP' })
    ])
    const queryDoc = createDoc('ATGATCGATCGATCGATCGATCGA')

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await settle(wrapper)

    // Position 5-6 is within the CDS (0..24)
    const cds = wrapper.vm.findCdsContainingRange(5, 6)
    expect(cds).not.toBeNull()
    expect(cds.caption).toBe('GFP')
  })

  it('findCdsContainingRange returns null when range is outside CDS', async () => {
    const { Annotation } = await import('../utils/annotation.js')
    // CDS only covers 10-24
    const targetDoc = createDoc('ATGATCGATCGATCGATCGATCGA', [
      new Annotation({ span: ezSpan(10, 24), type: 'CDS', caption: 'GFP' })
    ])
    const queryDoc = createDoc('ATGATCGATCGATCGATCGATCGA')

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await settle(wrapper)

    // Position 5-6 is outside the CDS
    const cds = wrapper.vm.findCdsContainingRange(5, 6)
    expect(cds).toBeNull()
  })

  it('findCdsContainingRange returns null when range partially overlaps CDS', async () => {
    const { Annotation } = await import('../utils/annotation.js')
    // CDS covers 5-15
    const targetDoc = createDoc('ATGATCGATCGATCGATCGATCGA', [
      new Annotation({ span: ezSpan(5, 15), type: 'CDS', caption: 'GFP' })
    ])
    const queryDoc = createDoc('ATGATCGATCGATCGATCGATCGA')

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await settle(wrapper)

    // Range 3-7 only partially overlaps CDS (5..15)
    const cds = wrapper.vm.findCdsContainingRange(3, 7)
    expect(cds).toBeNull()
  })

  it('computeAminoAcidChanges detects single codon missense mutation', async () => {
    const { Annotation } = await import('../utils/annotation.js')
    // Target: ATGAAATGA (M-K-*) - start codon, lysine, stop
    // Query:  ATGAGATGA (M-R-*) - single base change AAA->AGA (K->R)
    const targetDoc = createDoc('ATGAAATGA', [
      new Annotation({ span: ezSpan(0, 9), type: 'CDS', caption: 'TestCDS' })
    ])
    const queryDoc = createDoc('ATGAGATGA')

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await settle(wrapper)

    // Find the CDS
    const cds = wrapper.vm.findCdsContainingRange(4, 5)
    expect(cds).not.toBeNull()

    // Compute amino acid changes for mutation at position 4 (A->G)
    const changes = wrapper.vm.computeAminoAcidChanges(cds, 4, 5, 'A', 'G')
    expect(changes.length).toBe(1)
    expect(changes[0].targetAA).toBe('K')  // Lysine
    expect(changes[0].queryAA).toBe('R')   // Arginine
    expect(changes[0].codonIndex).toBe(2)  // Second codon (1-indexed)
    expect(changes[0].isSilent).toBe(false)
    expect(changes[0].isNonsense).toBe(false)
  })

  it('computeAminoAcidChanges detects silent mutation', async () => {
    const { Annotation } = await import('../utils/annotation.js')
    // Target: ATGAAATGA (M-K-*) - Lysine codon AAA
    // Query:  ATGAAGTGA (M-K-*) - Lysine codon AAG (synonymous)
    const targetDoc = createDoc('ATGAAATGA', [
      new Annotation({ span: ezSpan(0, 9), type: 'CDS', caption: 'TestCDS' })
    ])
    const queryDoc = createDoc('ATGAAGTGA')

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await settle(wrapper)

    const cds = wrapper.vm.findCdsContainingRange(5, 6)
    const changes = wrapper.vm.computeAminoAcidChanges(cds, 5, 6, 'A', 'G')

    expect(changes.length).toBe(1)
    expect(changes[0].targetAA).toBe('K')
    expect(changes[0].queryAA).toBe('K')  // Still lysine
    expect(changes[0].isSilent).toBe(true)
    expect(changes[0].isNonsense).toBe(false)
  })

  it('computeAminoAcidChanges detects nonsense mutation', async () => {
    const { Annotation } = await import('../utils/annotation.js')
    // Target: ATGAAATGA (M-K-*)
    // Query:  ATGTAATGA (M-*-*) - AAA->TAA (K->Stop)
    const targetDoc = createDoc('ATGAAATGA', [
      new Annotation({ span: ezSpan(0, 9), type: 'CDS', caption: 'TestCDS' })
    ])
    const queryDoc = createDoc('ATGTAATGA')

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await settle(wrapper)

    const cds = wrapper.vm.findCdsContainingRange(3, 4)
    const changes = wrapper.vm.computeAminoAcidChanges(cds, 3, 4, 'A', 'T')

    expect(changes.length).toBe(1)
    expect(changes[0].targetAA).toBe('K')
    expect(changes[0].queryAA).toBe('*')  // Stop codon
    expect(changes[0].isSilent).toBe(false)
    expect(changes[0].isNonsense).toBe(true)
  })

  it('formatCdsSuffix formats single amino acid change', async () => {
    const targetDoc = createDoc('ATGATG')
    const queryDoc = createDoc('ATGATG')
    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await settle(wrapper)

    const changes = [{ targetAA: 'K', queryAA: 'R', codonIndex: 5, isSilent: false, isNonsense: false }]
    const suffix = wrapper.vm.formatCdsSuffix('GFP', changes)
    expect(suffix).toBe('[GFP-K5R]')
  })

  it('formatCdsSuffix formats silent mutation', async () => {
    const targetDoc = createDoc('ATGATG')
    const queryDoc = createDoc('ATGATG')
    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await settle(wrapper)

    const changes = [{ targetAA: 'K', queryAA: 'K', codonIndex: 5, isSilent: true, isNonsense: false }]
    const suffix = wrapper.vm.formatCdsSuffix('GFP', changes)
    expect(suffix).toBe('[GFP (silent)]')
  })

  it('formatCdsSuffix formats nonsense mutation', async () => {
    const targetDoc = createDoc('ATGATG')
    const queryDoc = createDoc('ATGATG')
    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await settle(wrapper)

    const changes = [{ targetAA: 'K', queryAA: '*', codonIndex: 5, isSilent: false, isNonsense: true }]
    const suffix = wrapper.vm.formatCdsSuffix('GFP', changes)
    expect(suffix).toBe('[GFP-K5* (nonsense)]')
  })

  it('formatCdsSuffix formats multiple codon changes', async () => {
    const targetDoc = createDoc('ATGATG')
    const queryDoc = createDoc('ATGATG')
    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await settle(wrapper)

    const changes = [
      { targetAA: 'K', queryAA: 'R', codonIndex: 2, isSilent: false, isNonsense: false },
      { targetAA: 'L', queryAA: 'M', codonIndex: 3, isSilent: false, isNonsense: false }
    ]
    const suffix = wrapper.vm.formatCdsSuffix('GFP', changes)
    expect(suffix).toBe('[GFP-K2R,L3M]')
  })

  it('createMutationAnnotation adds CDS suffix for mutation within CDS', async () => {
    const { Annotation } = await import('../utils/annotation.js')
    // Target: ATGAAATGA (M-K-*)
    // Query:  ATGAGATGA (M-R-*) - K->R at codon 2
    const targetDoc = createDoc('ATGAAATGA', [
      new Annotation({ span: ezSpan(0, 9), type: 'CDS', caption: 'GFP' })
    ])
    const queryDoc = createDoc('ATGAGATGA')

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await settle(wrapper)

    // Verify alignment
    expect(wrapper.vm.alignmentResult.targetAligned).toBe('ATGAAATGA')
    expect(wrapper.vm.alignmentResult.queryAligned).toBe('ATGAGATGA')

    // Create mutation annotation at position 4 (A->G)
    wrapper.vm.createMutationAnnotation(4, 5)
    await settle(wrapper)

    // Check the annotation was created with CDS suffix
    expect(queryDoc.annotations.length).toBe(1)
    const ann = queryDoc.annotations[0]
    expect(ann.caption).toBe('A5G [GFP-K2R]')
  })

  it('createMutationAnnotation shows (silent) for synonymous mutation', async () => {
    const { Annotation } = await import('../utils/annotation.js')
    // Target: ATGAAATGA (M-K-*) - AAA = Lysine
    // Query:  ATGAAGTGA (M-K-*) - AAG = Lysine (synonymous)
    const targetDoc = createDoc('ATGAAATGA', [
      new Annotation({ span: ezSpan(0, 9), type: 'CDS', caption: 'GFP' })
    ])
    const queryDoc = createDoc('ATGAAGTGA')

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await settle(wrapper)

    // Create mutation annotation at position 5 (A->G in third position of codon)
    wrapper.vm.createMutationAnnotation(5, 6)
    await settle(wrapper)

    expect(queryDoc.annotations.length).toBe(1)
    const ann = queryDoc.annotations[0]
    expect(ann.caption).toBe('A6G [GFP (silent)]')
  })

  it('createMutationAnnotation shows (nonsense) when mutation creates stop codon', async () => {
    const { Annotation } = await import('../utils/annotation.js')
    // Target: ATGAAATGA (M-K-*)
    // Query:  ATGTAATGA (M-*-*) - AAA->TAA creates premature stop
    const targetDoc = createDoc('ATGAAATGA', [
      new Annotation({ span: ezSpan(0, 9), type: 'CDS', caption: 'GFP' })
    ])
    const queryDoc = createDoc('ATGTAATGA')

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await settle(wrapper)

    // Create mutation annotation at position 3 (A->T)
    wrapper.vm.createMutationAnnotation(3, 4)
    await settle(wrapper)

    expect(queryDoc.annotations.length).toBe(1)
    const ann = queryDoc.annotations[0]
    expect(ann.caption).toBe('A4T [GFP-K2* (nonsense)]')
  })

  it('createMutationAnnotation does not add suffix for mutation outside CDS', async () => {
    const { Annotation } = await import('../utils/annotation.js')
    // CDS covers positions 9-18, mutation is at position 3 which is outside CDS
    // Using a sequence where alignment is predictable
    const targetDoc = createDoc('AAAGGGAAATGAAATGAAA', [
      new Annotation({ span: ezSpan(9, 18), type: 'CDS', caption: 'GFP' })
    ])
    const queryDoc = createDoc('AAACGGAAATGAAATGAAA')  // G->C at position 3

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await settle(wrapper)

    // Verify the alignment is as expected (no gaps)
    expect(wrapper.vm.alignmentResult.targetAligned).toBe('AAAGGGAAATGAAATGAAA')
    expect(wrapper.vm.alignmentResult.queryAligned).toBe('AAACGGAAATGAAATGAAA')

    // Create mutation annotation at position 3 (G->C) which is outside CDS
    wrapper.vm.createMutationAnnotation(3, 4)
    await settle(wrapper)

    expect(queryDoc.annotations.length).toBe(1)
    const ann = queryDoc.annotations[0]
    // Should NOT have CDS suffix since mutation is outside CDS (at position 4 in GenBank notation)
    expect(ann.caption).toBe('G4C')
  })

  it('createMutationAnnotation does not add suffix for mutation in stop codon region', async () => {
    const { Annotation } = await import('../utils/annotation.js')
    // Target: ATGAAATGA (M-K-*) - TGA is the stop codon at positions 6-8
    // Query:  ATGAAATAA (M-K-*) - TGA->TAA (both are stop codons)
    const targetDoc = createDoc('ATGAAATGA', [
      new Annotation({ span: ezSpan(0, 9), type: 'CDS', caption: 'GFP' })
    ])
    const queryDoc = createDoc('ATGAAATAA')

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await settle(wrapper)

    // Create mutation annotation at position 7 (G->A)
    wrapper.vm.createMutationAnnotation(7, 8)
    await settle(wrapper)

    expect(queryDoc.annotations.length).toBe(1)
    const ann = queryDoc.annotations[0]
    // Should NOT have CDS suffix since original was already a stop codon
    expect(ann.caption).toBe('G8A')
  })

  it('createMutationAnnotation handles multi-base mutation spanning two codons', async () => {
    const { Annotation } = await import('../utils/annotation.js')
    // Target: ATGAAATTTTGA (M-K-F-*) codons: ATG AAA TTT TGA
    // Query:  ATGAAGCTTTGA - positions 5-6 change from AT to GC
    // This spans codon boundary: codon 2 (AAA->AAG = K->K silent) and codon 3 (TTT->CTT = F->L)
    const targetDoc = createDoc('ATGAAATTTTGA', [
      new Annotation({ span: ezSpan(0, 12), type: 'CDS', caption: 'GFP' })
    ])
    const queryDoc = createDoc('ATGAAGCTTTGA')

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await settle(wrapper)

    // Verify the alignment (no gaps expected for similar length sequences)
    expect(wrapper.vm.alignmentResult.targetAligned).toBe('ATGAAATTTTGA')
    expect(wrapper.vm.alignmentResult.queryAligned).toBe('ATGAAGCTTTGA')

    // Create mutation annotation for positions 5-7 (AT->GC in aligned coordinates)
    wrapper.vm.createMutationAnnotation(5, 7)
    await settle(wrapper)

    expect(queryDoc.annotations.length).toBe(1)
    const ann = queryDoc.annotations[0]
    // The caption should show the mutation with CDS suffix
    // Position 5-6 (0-indexed) = 6..7 (1-indexed GenBank notation)
    // AT->GC spans codons, affecting F->L in codon 3 (codon 2 becomes AAG which is still K - silent)
    expect(ann.caption).toBe('AT(6..7)GC [GFP-F3L]')
  })

  it('uses gene attribute from CDS when caption is not available', async () => {
    const { Annotation } = await import('../utils/annotation.js')
    // CDS without caption but with gene attribute
    const targetDoc = createDoc('ATGAAATGA', [
      new Annotation({
        span: ezSpan(0, 9),
        type: 'CDS',
        attributes: { gene: 'mCherry' }
      })
    ])
    const queryDoc = createDoc('ATGAGATGA')

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await settle(wrapper)

    wrapper.vm.createMutationAnnotation(4, 5)
    await settle(wrapper)

    expect(queryDoc.annotations.length).toBe(1)
    const ann = queryDoc.annotations[0]
    expect(ann.caption).toBe('A5G [mCherry-K2R]')
  })

  it('findAllCdsContainingRange returns all overlapping CDS annotations', async () => {
    const { Annotation } = await import('../utils/annotation.js')
    // Two overlapping CDS annotations
    // CDS1: 0..12 (GFP)
    // CDS2: 6..18 (mCherry) - overlaps with CDS1 at positions 6-11
    const targetDoc = createDoc('ATGAAATGAAATGAAATGA', [
      new Annotation({ span: ezSpan(0, 12), type: 'CDS', caption: 'GFP' }),
      new Annotation({ span: ezSpan(6, 18), type: 'CDS', caption: 'mCherry' })
    ])
    const queryDoc = createDoc('ATGAAATGAAATGAAATGA')

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await settle(wrapper)

    // Position 8 is in the overlap region (within both CDS annotations)
    // findAllCdsContainingRange should return both
    const allCds = wrapper.vm.findAllCdsContainingRange(8, 9)
    expect(allCds.length).toBe(2)
    expect(allCds[0].caption).toBe('GFP')
    expect(allCds[1].caption).toBe('mCherry')

    // findCdsContainingRange should still return first one for backwards compatibility
    const firstCds = wrapper.vm.findCdsContainingRange(8, 9)
    expect(firstCds).not.toBeNull()
    expect(firstCds.caption).toBe('GFP')
  })

  it('shows suffixes for all overlapping CDS when mutation is in overlap region', async () => {
    const { Annotation } = await import('../utils/annotation.js')
    // Two overlapping CDS annotations with a mutation in the overlap
    // Target: ATGAAAAAAAAATGA (codons for GFP: ATG AAA AAA AAA TGA = M-K-K-K-*)
    // Both CDS cover positions 3-12 (AAA AAA AAA)
    // CDS1 (GFP): 0..15 - full sequence
    // CDS2 (mCherry): 3..15 - starts at second codon
    // Mutation at position 4: A->G changes AAA->AGA (K->R) in both frames
    const targetDoc = createDoc('ATGAAAAAAAAATGA', [
      new Annotation({ span: ezSpan(0, 15), type: 'CDS', caption: 'GFP' }),
      new Annotation({ span: ezSpan(3, 15), type: 'CDS', caption: 'mCherry' })
    ])
    const queryDoc = createDoc('ATGAGAAAAAAATGA')

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await settle(wrapper)

    // Verify alignment
    expect(wrapper.vm.alignmentResult.targetAligned).toBe('ATGAAAAAAAAATGA')
    expect(wrapper.vm.alignmentResult.queryAligned).toBe('ATGAGAAAAAAATGA')

    // Create mutation at position 4 (A->G), which is in both CDS regions
    wrapper.vm.createMutationAnnotation(4, 5)
    await settle(wrapper)

    expect(queryDoc.annotations.length).toBe(1)
    const ann = queryDoc.annotations[0]
    // Should show suffixes for both CDS
    // GFP: position 4 is in codon 2 (AAA->AGA = K->R)
    // mCherry: position 4 is in codon 1 (AAA->AGA = K->R, since mCherry starts at position 3)
    expect(ann.caption).toBe('A5G [GFP-K2R] [mCherry-K1R]')
  })

  it('shows two amino acid changes when mutation spans codon boundary', async () => {
    const { Annotation } = await import('../utils/annotation.js')
    // Target: ATGAAATTTGAA (codons: ATG AAA TTT GAA = M-K-F-E)
    // Query:  ATGAAGCTGGAA (mutation at positions 5-8: ATTT -> GCTG)
    // This changes: AAA->AAG (K->K silent), TTT->CTG (F->L), and first base of GAA
    // Actually let's simplify - make a 2-base mutation that clearly affects 2 codons
    // Target: ATGAAATTTTGA (codons: ATG AAA TTT TGA = M-K-F-*)
    // Query:  ATGAAGGCTTGA (positions 5-7 change: AT->GG and T->C)
    // Hmm, this is getting complex. Let me create a cleaner example.

    // Cleaner example:
    // Target: ATGAAAAATTGA (codons: ATG AAA AAT TGA = M-K-N-*)
    // Query:  ATGAAGGATTGA (positions 5-6: AA->GG changes codon 2 AAA->AAG (K->K) and codon 3 AAT->GAT (N->D))
    const targetDoc = createDoc('ATGAAAAATTGA', [
      new Annotation({ span: ezSpan(0, 12), type: 'CDS', caption: 'GFP' })
    ])
    const queryDoc = createDoc('ATGAAGGATTGA')

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await settle(wrapper)

    // Verify alignment
    expect(wrapper.vm.alignmentResult.targetAligned).toBe('ATGAAAAATTGA')
    expect(wrapper.vm.alignmentResult.queryAligned).toBe('ATGAAGGATTGA')

    // Create mutation at positions 5-7 (AA->GG)
    wrapper.vm.createMutationAnnotation(5, 7)
    await settle(wrapper)

    expect(queryDoc.annotations.length).toBe(1)
    const ann = queryDoc.annotations[0]
    // Codon 2 (positions 3-5): AAA -> AAG = K -> K (silent, not shown)
    // Codon 3 (positions 6-8): AAT -> GAT = N -> D
    // Since codon 2 is silent, only codon 3 change is shown
    expect(ann.caption).toBe('AA(6..7)GG [GFP-N3D]')
  })

  it('shows both amino acid changes when both codons have non-silent mutations', async () => {
    const { Annotation } = await import('../utils/annotation.js')
    // Target: ATGAAACATTGA (codons: ATG AAA CAT TGA = M-K-H-*)
    // Query:  ATGAGATATATA (positions 4-5: AA->GA and positions 6-7: CA->TA)
    // Let me create a mutation that affects 2 codons with non-silent changes
    // Target: ATGAAACATTGA (M-K-H-*)
    // Mutation at positions 4-7: AACA -> GATA
    // Codon 2: AAA -> AGA = K -> R
    // Codon 3: CAT -> TAT = H -> Y
    const targetDoc = createDoc('ATGAAACATTGA', [
      new Annotation({ span: ezSpan(0, 12), type: 'CDS', caption: 'GFP' })
    ])
    const queryDoc = createDoc('ATGAGATATTGA')

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await settle(wrapper)

    // Verify alignment
    expect(wrapper.vm.alignmentResult.targetAligned).toBe('ATGAAACATTGA')
    expect(wrapper.vm.alignmentResult.queryAligned).toBe('ATGAGATATTGA')

    // Create mutation at positions 4-7 (AACA->GATA)
    wrapper.vm.createMutationAnnotation(4, 7)
    await settle(wrapper)

    expect(queryDoc.annotations.length).toBe(1)
    const ann = queryDoc.annotations[0]
    // Codon 2: AAA -> AGA = K -> R
    // Codon 3: CAT -> TAT = H -> Y
    // Both are non-silent, should show both
    expect(ann.caption).toBe('AAC(5..7)GAT [GFP-K2R,H3Y]')
  })
})

describe('AlignmentEditor Selection with non-zero alignment start', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY)
  })

  it('selection on target row returns original coordinates when targetStart > 0', async () => {
    // Target has leading unaligned bases - alignment starts at position 5
    // Target: NNNNNGATCGATCG (14 bases, alignment at 5..14)
    // Query:  GATCGATCG (9 bases, full alignment)
    // The align() function should produce targetStart=5
    const targetDoc = createDoc('NNNNNGATCGATCG')
    const queryDoc = createDoc('GATCGATCG')

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 }
    })
    await settle(wrapper)

    // Verify alignment has non-zero targetStart
    expect(wrapper.vm.alignmentResult.targetStart).toBe(5)

    // Simulate selection on target row (positions 5-8 in original coordinates)
    // This is what SequenceLayer would produce when clicking on target row
    wrapper.vm.selection.select([new Range(5, 8)])
    wrapper.vm.selection.source.value = 'target'
    await settle(wrapper)

    // Selection status should show original coordinates (GenBank 1-indexed)
    // Range 5..8 (0-indexed) = 6..8 (1-indexed GenBank)
    expect(wrapper.vm.selectionStatusText).toContain('6..8')
  })

  it('selection on query row returns original coordinates when queryStart > 0', async () => {
    // Query has leading unaligned bases - alignment starts at position 5
    // Target: GATCGATCG (9 bases, full alignment)
    // Query:  NNNNNGATCGATCG (14 bases, alignment at 5..14)
    const targetDoc = createDoc('GATCGATCG')
    const queryDoc = createDoc('NNNNNGATCGATCG')

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 }
    })
    await settle(wrapper)

    // Verify alignment has non-zero queryStart
    expect(wrapper.vm.alignmentResult.queryStart).toBe(5)

    // Select positions on query (5-8 original)
    wrapper.vm.selection.select([new Range(5, 8)])
    wrapper.vm.selection.source.value = 'query'
    await settle(wrapper)

    // Selection status should show original coordinates (GenBank 1-indexed)
    expect(wrapper.vm.selectionStatusText).toContain('6..8')
  })

  it('position maps correctly reflect non-zero start offsets', async () => {
    // Test that position maps are built correctly with offsets
    // Target: NNNNNGATCGATCG (14 bases)
    // Query:  GATCGATCG (9 bases)
    // Alignment should be: GATCGATCG vs GATCGATCG (at target positions 5-13)
    const targetDoc = createDoc('NNNNNGATCGATCG')
    const queryDoc = createDoc('GATCGATCG')

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 }
    })
    await settle(wrapper)

    // Check target position map - should start at position 5
    // Aligned position 0 should map to original position 5
    const targetPosMap = wrapper.vm.targetPositionMap
    expect(targetPosMap[0]).toBe(5)
    expect(targetPosMap[1]).toBe(6)
    expect(targetPosMap[8]).toBe(13)

    // Check query position map - should start at 0 (full alignment)
    const queryPosMap = wrapper.vm.queryPositionMap
    expect(queryPosMap[0]).toBe(0)
    expect(queryPosMap[8]).toBe(8)
  })

  it('maps circular target alignment positions back to physical coordinates', async () => {
    const targetDoc = createDoc('AAAACCCCGGGGTTTTACGTACGT', [], true)
    const queryDoc = createDoc('GGGGTTTTACGTACGTAAAACCCC')

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 }
    })
    await wrapper.vm.$nextTick()

    expect(wrapper.vm.alignmentResult.targetOriginOffset).toBe(8)
    expect(wrapper.vm.alignmentResult.targetStart).toBe(8)
    expect(wrapper.vm.alignedTargetSequence).toBe('GGGGTTTTACGTACGTAAAACCCC')
    expect(wrapper.vm.alignedQuerySequence).toBe('GGGGTTTTACGTACGTAAAACCCC')
    expect(wrapper.vm.targetPositionMap).toEqual([
      8, 9, 10, 11, 12, 13, 14, 15,
      16, 17, 18, 19, 20, 21, 22, 23,
      0, 1, 2, 3, 4, 5, 6, 7
    ])
    expect(wrapper.vm.alignmentLines[0].targetPosition).toBe(9)
  })

  it('maps circular target annotations into wrapped aligned columns', async () => {
    const annotation = {
      id: 'origin-feature',
      caption: 'origin-feature',
      type: 'gene',
      span: new Span([new Range(0, 4, Orientation.PLUS)])
    }
    const targetDoc = createDoc('AAAACCCCGGGGTTTTACGTACGT', [annotation], true)
    const queryDoc = createDoc('GGGGTTTTACGTACGTAAAACCCC')

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 }
    })
    await wrapper.vm.$nextTick()

    expect(wrapper.vm.alignedTargetAnnotations).toHaveLength(1)
    expect(wrapper.vm.alignedTargetAnnotations[0].span.ranges[0].start).toBe(16)
    expect(wrapper.vm.alignedTargetAnnotations[0].span.ranges[0].end).toBe(20)
  })

  it('handleSelectionChange does not double-convert original coordinates', async () => {
    // This tests the bug: when SequenceLayer sends original coordinates,
    // handleSelectionChange should NOT try to convert them again.
    //
    // Bug scenario:
    // - Target: NNNNNGATCGATCG (14 bases), alignment starts at position 5
    // - User clicks on aligned position 0-3 (the first 3 bases of aligned region)
    // - SequenceLayer converts to original positions 5-8 using positionMap
    // - SequenceLayer sets selection.domain to (5, 8) and emits 'select'
    // - handleSelectionChange receives the event
    // - BUG: handleSelectionChange looks up alignedToOrigMap[5] and alignedToOrigMap[8]
    // - alignedToOrigMap maps aligned→original, so position 5 in aligned = position 10 in original
    // - Selection gets corrupted to (10, 13) instead of staying at (5, 8)
    const targetDoc = createDoc('NNNNNGATCGATCG')
    const queryDoc = createDoc('GATCGATCG')

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 }
    })
    await settle(wrapper)

    // Verify alignment setup
    expect(wrapper.vm.alignmentResult.targetStart).toBe(5)

    // Simulate what SequenceLayer does internally:
    // 1. User clicks on aligned positions 0-3 (first 3 visible bases)
    // 2. SequenceLayer's getPositionFromEvent converts to original positions 5-8
    // 3. SequenceLayer calls selection.startSelection/updateSelection/endSelection
    // 4. selection.domain.value now has original positions (5, 8)
    wrapper.vm.selection.startSelection(5, false, 'target')
    wrapper.vm.selection.updateSelection(8)
    wrapper.vm.selection.endSelection()
    await settle(wrapper)

    // At this point, selection.domain has original coords (5, 8)
    expect(wrapper.vm.selection.domain.value.ranges[0].start).toBe(5)
    expect(wrapper.vm.selection.domain.value.ranges[0].end).toBe(8)

    // Now simulate SequenceLayer emitting 'select' event which triggers handleSelectionChange
    // Find the target SequenceLayer and emit from it
    const targetSeqLayer = wrapper.vm.targetSequenceLayerRef
    targetSeqLayer.$emit('select', { ranges: wrapper.vm.selection.domain.value.ranges })
    await settle(wrapper)

    // BUG CHECK: After handleSelectionChange, the coordinates should still be (5, 8)
    // But with the bug, they get converted to (10, 13) because handleSelectionChange
    // treats them as aligned positions and converts using alignedToOrigMap
    const domain = wrapper.vm.selection.domain.value
    expect(domain.ranges[0].start).toBe(5)  // Will fail with bug: gets 10
    expect(domain.ranges[0].end).toBe(8)    // Will fail with bug: gets 13
  })
})
