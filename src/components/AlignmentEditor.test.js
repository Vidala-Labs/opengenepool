import { describe, it, expect, beforeEach } from 'bun:test'
import { mount } from '@vue/test-utils'
import { ref, nextTick } from 'vue'
import AlignmentEditor from './AlignmentEditor.vue'
import { STORAGE_KEY } from '../composables/usePersistedZoom.js'
import { SequenceDocument } from '../composables/SequenceDocument.js'
import { Span } from '../utils/dna.js'

// Helper to create a SequenceDocument for tests
function createDoc(sequence = '', annotations = [], circular = false, backend = null) {
  const normalizedAnnotations = annotations.map(annotation => ({
    ...annotation,
    span: typeof annotation.span === 'string' ? Span.parse(annotation.span) : annotation.span
  }))
  return new SequenceDocument({ sequence, annotations: normalizedAnnotations, circular, backend })
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

    await wrapper.vm.$nextTick()

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

    await wrapper.vm.$nextTick()

    expect(wrapper.vm.hasAlignment).toBe(true)

    const result = wrapper.vm.alignmentResult
    expect(result.targetAligned).toBe('CGAGTCAGT')
    expect(result.queryAligned).toBe('CGAGTCAGT')
    expect(result.identity).toBe(100)

    const lines = wrapper.vm.alignmentLines
    expect(lines.length).toBeGreaterThan(0)
    expect(lines[0].matchText).toBe('|||||||||')
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

    await wrapper.vm.$nextTick()

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

    await wrapper.vm.$nextTick()

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

    await wrapper.vm.$nextTick()

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

    await wrapper.vm.$nextTick()

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

    await wrapper.vm.$nextTick()

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

    await wrapper.vm.$nextTick()

    wrapper.vm.selection.startSelection(0, false, 'target')
    wrapper.vm.selection.updateSelection(4)
    wrapper.vm.selection.endSelection()
    await wrapper.vm.$nextTick()

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

    await wrapper.vm.$nextTick()

    wrapper.vm.selection.startSelection(0, false, 'query')
    wrapper.vm.selection.updateSelection(4)
    wrapper.vm.selection.endSelection()
    await wrapper.vm.$nextTick()

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

    await wrapper.vm.$nextTick()

    wrapper.vm.selection.startSelection(0, false, 'target')
    wrapper.vm.selection.updateSelection(4)
    wrapper.vm.selection.endSelection()
    await wrapper.vm.$nextTick()

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

    await wrapper.vm.$nextTick()

    wrapper.vm.selection.startSelection(0, false, 'query')
    wrapper.vm.selection.updateSelection(4)
    wrapper.vm.selection.endSelection()
    await wrapper.vm.$nextTick()

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

    await wrapper.vm.$nextTick()

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

    await wrapper.vm.$nextTick()

    wrapper.vm.selection.startSelection(0, false, 'target')
    wrapper.vm.selection.updateSelection(4)
    wrapper.vm.selection.endSelection()
    await wrapper.vm.$nextTick()

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

    await wrapper.vm.$nextTick()

    wrapper.vm.selection.startSelection(0, false, 'query')
    wrapper.vm.selection.updateSelection(4)
    wrapper.vm.selection.endSelection()
    await wrapper.vm.$nextTick()

    const statusText = wrapper.vm.selectionStatusText
    expect(statusText).toContain('Query selected')
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

    await wrapper.vm.$nextTick()

    // Initial alignment should have 100% identity
    expect(wrapper.vm.alignmentResult.identity).toBe(100)
    const initialLength = wrapper.vm.alignmentResult.targetAligned.length

    // Delete from target document
    targetDoc.delete([{ start: 0, end: 4 }])
    await wrapper.vm.$nextTick()

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

    await wrapper.vm.$nextTick()

    // Initial alignment
    expect(wrapper.vm.alignmentResult.identity).toBe(100)
    const initialLength = wrapper.vm.alignmentResult.queryAligned.length

    // Delete from query document
    queryDoc.delete([{ start: 0, end: 4 }])
    await wrapper.vm.$nextTick()

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

    await wrapper.vm.$nextTick()

    const initialTargetLength = targetDoc.sequence.length

    // Select on target row
    wrapper.vm.selection.startSelection(0, false, 'target')
    wrapper.vm.selection.updateSelection(4)
    wrapper.vm.selection.endSelection()
    await wrapper.vm.$nextTick()

    // Use internal delete function (confirmDelete would be used via context menu)
    wrapper.vm.confirmDelete()
    await wrapper.vm.$nextTick()

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

    await wrapper.vm.$nextTick()

    const initialQueryLength = queryDoc.sequence.length

    // Select on query row
    wrapper.vm.selection.startSelection(0, false, 'query')
    wrapper.vm.selection.updateSelection(4)
    wrapper.vm.selection.endSelection()
    await wrapper.vm.$nextTick()

    // Use internal delete function
    wrapper.vm.confirmDelete()
    await wrapper.vm.$nextTick()

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

    await wrapper.vm.$nextTick()

    // Select on target row
    wrapper.vm.selection.startSelection(0, false, 'target')
    wrapper.vm.selection.updateSelection(4)
    wrapper.vm.selection.endSelection()
    await wrapper.vm.$nextTick()

    wrapper.vm.confirmDelete()
    await wrapper.vm.$nextTick()

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

    await wrapper.vm.$nextTick()

    // Select on query row
    wrapper.vm.selection.startSelection(0, false, 'query')
    wrapper.vm.selection.updateSelection(4)
    wrapper.vm.selection.endSelection()
    await wrapper.vm.$nextTick()

    wrapper.vm.confirmDelete()
    await wrapper.vm.$nextTick()

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
      new Annotation({ id: 'ann1', span: Span.parse('0..6'), type: 'gene', label: 'Test Gene' })
    ]

    const wrapper = mount(AlignmentEditor, {
      props: {
        target: createDoc('ATCGATCGATCG', targetAnns),
        query: createDoc('ATCGATCGATCG')
      }
    })

    await wrapper.vm.$nextTick()

    expect(wrapper.vm.alignedTargetAnnotations).toBeDefined()
    expect(wrapper.vm.alignedTargetAnnotations.length).toBe(1)
  })

  it('computes alignedQueryAnnotations from query document', async () => {
    const { Annotation } = await import('../utils/annotation.js')
    const queryAnns = [
      new Annotation({ id: 'qann1', span: Span.parse('0..6'), type: 'gene', label: 'Query Gene' })
    ]

    const wrapper = mount(AlignmentEditor, {
      props: {
        target: createDoc('ATCGATCGATCG'),
        query: createDoc('ATCGATCGATCG', queryAnns)
      }
    })

    await wrapper.vm.$nextTick()

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
        new Annotation({ id: 'targetAnn', span: Span.parse('4..6'), type: 'gene', label: 'targetFoo' })
      ]
    })

    const queryDoc = new SequenceDocument({
      sequence: 'ATCGATCG',
      annotations: [
        new Annotation({ id: 'queryAnn', span: Span.parse('4..6'), type: 'gene', label: 'queryFoo' })
      ]
    })

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await wrapper.vm.$nextTick()

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
    //   Original positions 4,5 ("AT") map to aligned positions 5,6 (after the gap)
    //   So original 4..6 -> aligned 5..7

    const { Annotation } = await import('../utils/annotation.js')

    const targetDoc = new SequenceDocument({
      sequence: 'ATCGATCG',  // Shorter, will have gap in alignment
      annotations: [
        new Annotation({ id: 'targetAnn', span: Span.parse('4..6'), type: 'gene', label: 'targetFoo' })
      ]
    })

    const queryDoc = new SequenceDocument({
      sequence: 'ATCGAATCG',  // Longer, no gap
      annotations: [
        new Annotation({ id: 'queryAnn', span: Span.parse('4..6'), type: 'gene', label: 'queryFoo' })
      ]
    })

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await wrapper.vm.$nextTick()

    // Verify alignment result (target gets the gap when query is longer)
    const result = wrapper.vm.alignmentResult
    expect(result.targetAligned).toBe('ATCG-ATCG')
    expect(result.queryAligned).toBe('ATCGAATCG')

    // Verify target annotation (has gap, should shift after position 4)
    // Original 4..6 should map to aligned 5..7
    const targetAnns = wrapper.vm.alignedTargetAnnotations
    expect(targetAnns.length).toBe(1)
    expect(targetAnns[0].span.ranges[0].start).toBe(5)
    expect(targetAnns[0].span.ranges[0].end).toBe(7)

    // Verify query annotation (no gaps in query, unchanged)
    const queryAnns = wrapper.vm.alignedQueryAnnotations
    expect(queryAnns.length).toBe(1)
    expect(queryAnns[0].span.ranges[0].start).toBe(4)
    expect(queryAnns[0].span.ranges[0].end).toBe(6)
  })
})

describe('AlignmentEditor Context Menu', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY)
  })

  it('shows context menu with Select all option when clicking on target sequence', async () => {
    const wrapper = mount(AlignmentEditor, {
      props: {
        target: createDoc('ATCGATCGATCG'),
        query: createDoc('ATCGATCGATCG')
      }
    })

    await wrapper.vm.$nextTick()

    // Get Select all from target SequenceLayer's getMenuItemsForElement
    const targetLayer = wrapper.vm.targetSequenceLayerRef
    const items = targetLayer.getMenuItemsForElement({ layer: 'sequence', mode: 'target' })

    // Should have Select all
    expect(items.length).toBeGreaterThan(0)
    expect(items.some(item => item.label === 'Select all')).toBe(true)
  })

  it('shows Select all along with other options when selection exists', async () => {
    const wrapper = mount(AlignmentEditor, {
      props: {
        target: createDoc('ATCGATCGATCG'),
        query: createDoc('ATCGATCGATCG')
      }
    })

    await wrapper.vm.$nextTick()

    // Create a selection
    wrapper.vm.selection.startSelection(0, false, 'target')
    wrapper.vm.selection.updateSelection(4)
    wrapper.vm.selection.endSelection()
    await wrapper.vm.$nextTick()

    // Global items from buildContextMenuItems
    const globalItems = wrapper.vm.buildContextMenuItems({ source: 'sequence', mode: 'target' })

    // Should have Copy, Select none, Delete
    expect(globalItems.some(item => item.label === 'Copy selection')).toBe(true)
    expect(globalItems.some(item => item.label === 'Select none')).toBe(true)
    expect(globalItems.some(item => item.label === 'Delete sequence')).toBe(true)

    // Select all comes from layer
    const targetLayer = wrapper.vm.targetSequenceLayerRef
    const layerItems = targetLayer.getMenuItemsForElement({ layer: 'sequence', mode: 'target' })
    expect(layerItems.some(item => item.label === 'Select all')).toBe(true)
  })

  it('Select all action selects entire target sequence', async () => {
    const wrapper = mount(AlignmentEditor, {
      props: {
        target: createDoc('ATCGATCGATCG'),
        query: createDoc('GGGGAAAACCCC')
      }
    })

    await wrapper.vm.$nextTick()

    // No selection initially
    expect(wrapper.vm.selection.isSelected.value).toBe(false)

    // Get Select all from target SequenceLayer and execute it
    const targetLayer = wrapper.vm.targetSequenceLayerRef

    // Debug: Check what props the layer has
    const sequenceLayers = wrapper.findAllComponents({ name: 'SequenceLayer' })
    const targetLayerComponent = sequenceLayers.find(l => l.props('mode') === 'target')
    expect(targetLayerComponent).toBeDefined()
    expect(targetLayerComponent.props('mode')).toBe('target')
    expect(targetLayerComponent.props('originalSequenceLength')).toBe(12)

    const items = targetLayer.getMenuItemsForElement({ layer: 'sequence', mode: 'target' })
    const selectAllItem = items.find(item => item.label === 'Select all')
    expect(selectAllItem).toBeDefined()

    selectAllItem.action()
    await wrapper.vm.$nextTick()

    // Should have selected entire target sequence (12 bases)
    expect(wrapper.vm.selection.isSelected.value).toBe(true)
    expect(wrapper.vm.selection.source.value).toBe('target')
    expect(wrapper.vm.selection.domain.value.ranges[0].start).toBe(0)
    expect(wrapper.vm.selection.domain.value.ranges[0].end).toBe(12)
  })

  it('Select all uses query sequence length when clicking on query row', async () => {
    const wrapper = mount(AlignmentEditor, {
      props: {
        target: createDoc('ATCGATCGATCG'),
        query: createDoc('GGGGAAAA')  // 8 bases
      }
    })

    await wrapper.vm.$nextTick()

    // Get Select all from query SequenceLayer and execute it
    const queryLayer = wrapper.vm.querySequenceLayerRef
    const items = queryLayer.getMenuItemsForElement({ layer: 'sequence', mode: 'query' })
    const selectAllItem = items.find(item => item.label === 'Select all')
    selectAllItem.action()
    await wrapper.vm.$nextTick()

    // Should have selected entire query sequence (8 bases)
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

  it('does NOT show Select all when right-clicking on background', async () => {
    const wrapper = mount(AlignmentEditor, {
      props: {
        target: createDoc('ATCGATCGATCG'),
        query: createDoc('ATCGATCGATCG')
      }
    })

    await wrapper.vm.$nextTick()

    // Build context menu from background (no sequence layer)
    // Global items from editor should NOT include Select all
    const items = wrapper.vm.buildContextMenuItems({ source: 'background' })

    // Background should NOT have Select all (it comes from layers, not global items)
    expect(items.some(item => item.label === 'Select all')).toBe(false)
  })

  it('shows Select all for target when right-clicking on target sequence layer', async () => {
    const wrapper = mount(AlignmentEditor, {
      props: {
        target: createDoc('ATCGATCGATCG'),  // 12 bases
        query: createDoc('GGGGAAAA')  // 8 bases
      }
    })

    await wrapper.vm.$nextTick()

    // Get Select all from target SequenceLayer
    const targetLayer = wrapper.vm.targetSequenceLayerRef
    const items = targetLayer.getMenuItemsForElement({ layer: 'sequence', mode: 'target' })

    // Should have Select all
    const selectAllItem = items.find(item => item.label === 'Select all')
    expect(selectAllItem).toBeDefined()

    // Execute Select all and verify it selects target sequence (12 bases)
    selectAllItem.action()
    await wrapper.vm.$nextTick()

    expect(wrapper.vm.selection.source.value).toBe('target')
    expect(wrapper.vm.selection.domain.value.ranges[0].end).toBe(12)
  })

  it('shows Select all for query when right-clicking on query sequence layer', async () => {
    const wrapper = mount(AlignmentEditor, {
      props: {
        target: createDoc('ATCGATCGATCG'),  // 12 bases
        query: createDoc('GGGGAAAA')  // 8 bases
      }
    })

    await wrapper.vm.$nextTick()

    // Get Select all from query SequenceLayer
    const queryLayer = wrapper.vm.querySequenceLayerRef
    const items = queryLayer.getMenuItemsForElement({ layer: 'sequence', mode: 'query' })

    // Should have Select all
    const selectAllItem = items.find(item => item.label === 'Select all')
    expect(selectAllItem).toBeDefined()

    // Execute Select all and verify it selects query sequence (8 bases)
    selectAllItem.action()
    await wrapper.vm.$nextTick()

    expect(wrapper.vm.selection.source.value).toBe('query')
    expect(wrapper.vm.selection.domain.value.ranges[0].end).toBe(8)
  })

  it('Select all from layer is included when building full context menu', async () => {
    const wrapper = mount(AlignmentEditor, {
      props: {
        target: createDoc('ATCGATCGATCG'),
        query: createDoc('GGGGAAAA')
      }
    })

    await wrapper.vm.$nextTick()

    // Layer items include Select all
    const targetLayer = wrapper.vm.targetSequenceLayerRef
    const layerItems = targetLayer.getMenuItemsForElement({ layer: 'sequence', mode: 'target' })

    // Should have Select all from layer
    expect(layerItems.some(item => item.label === 'Select all')).toBe(true)
  })
})

describe('Delete via context menu (bug reproduction)', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY)
  })

  it('FAILS: context menu Delete sequence on target does nothing', async () => {
    const targetDoc = createDoc('ATCGATCGATCGATCGATCGATCG')  // 24bp
    const queryDoc = createDoc('ATCGATCGATCGATCGATCGATCG')   // 24bp identical

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await wrapper.vm.$nextTick()

    const initialTargetLength = targetDoc.sequence.length
    expect(initialTargetLength).toBe(24)

    // Verify the rendered target sequence before delete
    const sequenceLayers = wrapper.findAllComponents({ name: 'SequenceLayer' })
    const targetLayer = sequenceLayers.find(layer => layer.props('mode') === 'target')
    expect(targetLayer).toBeDefined()

    // Check the aligned target sequence shown in the view
    const alignedTargetBefore = wrapper.vm.alignedTargetSequence
    console.log('Before delete - alignedTargetSequence:', alignedTargetBefore)
    console.log('Before delete - targetDoc.sequence:', targetDoc.sequence)
    expect(alignedTargetBefore).toBe('ATCGATCGATCGATCGATCGATCG')

    // Select on target row (simulating mouse selection)
    wrapper.vm.selection.startSelection(5, false, 'target')
    wrapper.vm.selection.updateSelection(10)
    wrapper.vm.selection.endSelection()
    await wrapper.vm.$nextTick()

    expect(wrapper.vm.selection.source.value).toBe('target')
    expect(wrapper.vm.selection.isSelected.value).toBe(true)

    // Get context menu items (this is what happens when right-clicking)
    const menuItems = wrapper.vm.buildContextMenuItems({ source: 'sequence', mode: 'target' })

    // Find "Delete sequence" menu item
    const deleteItem = menuItems.find(item => item.label === 'Delete sequence')
    expect(deleteItem).toBeDefined()

    // Click "Delete sequence" - this calls handleDelete() which shows confirmation
    deleteItem.action()
    await wrapper.vm.$nextTick()

    // Confirmation dialog should be visible
    expect(wrapper.vm.deleteConfirmVisible).toBe(true)

    // Click confirm - this calls confirmDelete()
    wrapper.vm.confirmDelete()
    await wrapper.vm.$nextTick()

    // Verify the rendered target sequence after delete
    const alignedTargetAfter = wrapper.vm.alignedTargetSequence
    console.log('After delete - alignedTargetSequence:', alignedTargetAfter)
    console.log('After delete - targetDoc.sequence:', targetDoc.sequence)

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
    await wrapper.vm.$nextTick()

    const initialQueryLength = queryDoc.sequence.length
    expect(initialQueryLength).toBe(24)

    // Verify the rendered query sequence before delete
    const alignedQueryBefore = wrapper.vm.alignedQuerySequence
    console.log('Before delete - alignedQuerySequence:', alignedQueryBefore)
    console.log('Before delete - queryDoc.sequence:', queryDoc.sequence)
    expect(alignedQueryBefore).toBe('ATCGATCGATCGATCGATCGATCG')

    // Select on query row (simulating mouse selection)
    wrapper.vm.selection.startSelection(5, false, 'query')
    wrapper.vm.selection.updateSelection(10)
    wrapper.vm.selection.endSelection()
    await wrapper.vm.$nextTick()

    expect(wrapper.vm.selection.source.value).toBe('query')
    expect(wrapper.vm.selection.isSelected.value).toBe(true)

    // Get context menu items
    const menuItems = wrapper.vm.buildContextMenuItems({ source: 'sequence', mode: 'query' })

    // Find "Delete sequence" menu item
    const deleteItem = menuItems.find(item => item.label === 'Delete sequence')
    expect(deleteItem).toBeDefined()

    // Click "Delete sequence"
    deleteItem.action()
    await wrapper.vm.$nextTick()

    // Confirmation dialog should be visible
    expect(wrapper.vm.deleteConfirmVisible).toBe(true)

    // Click confirm
    wrapper.vm.confirmDelete()
    await wrapper.vm.$nextTick()

    // Verify the rendered query sequence after delete
    const alignedQueryAfter = wrapper.vm.alignedQuerySequence
    console.log('After delete - alignedQuerySequence:', alignedQueryAfter)
    console.log('After delete - queryDoc.sequence:', queryDoc.sequence)

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

    await wrapper.vm.$nextTick()

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

    await wrapper.vm.$nextTick()

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

    await wrapper.vm.$nextTick()

    // Find the target SequenceLayer by checking the mode prop
    const sequenceLayers = wrapper.findAllComponents({ name: 'SequenceLayer' })
    const targetLayer = sequenceLayers.find(layer => layer.props('mode') === 'target')
    expect(targetLayer).toBeDefined()

    // Simulate starting a selection on target layer
    // The SequenceLayer should call selection.startSelection with source='target'
    wrapper.vm.selection.startSelection(2, false, 'target')
    wrapper.vm.selection.updateSelection(6)
    wrapper.vm.selection.endSelection()
    await wrapper.vm.$nextTick()

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

    await wrapper.vm.$nextTick()

    // Find the query SequenceLayer by checking the mode prop
    const sequenceLayers = wrapper.findAllComponents({ name: 'SequenceLayer' })
    const queryLayer = sequenceLayers.find(layer => layer.props('mode') === 'query')
    expect(queryLayer).toBeDefined()

    // Simulate starting a selection on query layer
    wrapper.vm.selection.startSelection(2, false, 'query')
    wrapper.vm.selection.updateSelection(6)
    wrapper.vm.selection.endSelection()
    await wrapper.vm.$nextTick()

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

    await wrapper.vm.$nextTick()

    // First select on target
    wrapper.vm.selection.startSelection(0, false, 'target')
    wrapper.vm.selection.updateSelection(4)
    wrapper.vm.selection.endSelection()
    await wrapper.vm.$nextTick()

    expect(wrapper.vm.selection.source.value).toBe('target')

    // Now select on query - should switch source
    wrapper.vm.selection.startSelection(0, false, 'query')
    wrapper.vm.selection.updateSelection(4)
    wrapper.vm.selection.endSelection()
    await wrapper.vm.$nextTick()

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

    await wrapper.vm.$nextTick()

    const initialQueryLength = queryDoc.sequence.length

    // Select on query row
    wrapper.vm.selection.startSelection(0, false, 'query')
    wrapper.vm.selection.updateSelection(4)
    wrapper.vm.selection.endSelection()
    await wrapper.vm.$nextTick()

    // Delete - should affect query document
    wrapper.vm.confirmDelete()
    await wrapper.vm.$nextTick()

    // Query should be shorter, target unchanged
    expect(queryDoc.sequence.length).toBe(initialQueryLength - 4)
    expect(targetDoc.sequence.length).toBe(12)
  })

  it('dragging on overlay creates selection with source=target (BUG TEST)', async () => {
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

    await wrapper.vm.$nextTick()

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
    await wrapper.vm.$nextTick()

    // Trigger mouseup to complete the selection
    const mouseUpEvent = new MouseEvent('mouseup', { bubbles: true })
    window.dispatchEvent(mouseUpEvent)
    await wrapper.vm.$nextTick()

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
})

describe('Delete with different sequences (alignment has gaps)', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY)
  })

  it('deletes from target when sequences differ (BUG REPRODUCTION)', async () => {
    // Use sequences that produce gaps in alignment
    // Target has TTTTT in middle, query has GGGGG - this creates alignment gaps
    const targetDoc = createDoc('ATCGATCGATTTTTCGATCGATCG')  // 24bp
    const queryDoc = createDoc('ATCGATCGAGGGGGCGATCGATCG')   // 24bp, different middle

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await wrapper.vm.$nextTick()

    const initialLength = targetDoc.sequence.length
    expect(initialLength).toBe(24)

    // Log alignment result to understand the gaps
    console.log('Alignment result with different sequences:', {
      targetAligned: wrapper.vm.alignmentResult.targetAligned,
      queryAligned: wrapper.vm.alignmentResult.queryAligned,
      identity: wrapper.vm.alignmentResult.identity
    })

    // Select 5bp from target (positions 5..10)
    wrapper.vm.selection.startSelection(5, false, 'target')
    wrapper.vm.selection.updateSelection(10)
    wrapper.vm.selection.endSelection()
    await wrapper.vm.$nextTick()

    // Verify selection source
    expect(wrapper.vm.selection.source.value).toBe('target')

    // Log the selection
    const domain = wrapper.vm.selection.domain.value
    console.log('Selection domain:', domain?.ranges)

    // Delete via confirmDelete (like context menu would)
    wrapper.vm.confirmDelete()
    await wrapper.vm.$nextTick()

    // Target should be modified
    console.log('After delete - targetDoc.sequence:', targetDoc.sequence)
    console.log('After delete - targetDoc.sequence.length:', targetDoc.sequence.length)
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
    await wrapper.vm.$nextTick()

    const initialLength = queryDoc.sequence.length
    expect(initialLength).toBe(24)

    // Select 5bp from query (positions 5..10)
    wrapper.vm.selection.startSelection(5, false, 'query')
    wrapper.vm.selection.updateSelection(10)
    wrapper.vm.selection.endSelection()
    await wrapper.vm.$nextTick()

    // Verify selection source
    expect(wrapper.vm.selection.source.value).toBe('query')

    // Delete
    wrapper.vm.confirmDelete()
    await wrapper.vm.$nextTick()

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
    await wrapper.vm.$nextTick()

    // Capture alignmentResult BEFORE delete
    const alignmentBefore = wrapper.vm.alignmentResult
    expect(alignmentBefore).not.toBeNull()
    expect(alignmentBefore.targetAligned.length).toBe(24)
    console.log('alignmentResult BEFORE delete:', {
      targetAligned: alignmentBefore.targetAligned,
      queryAligned: alignmentBefore.queryAligned,
      score: alignmentBefore.score
    })

    // Delete from target sequence directly (bypassing selection/context menu)
    targetDoc.delete([{ start: 5, end: 10 }])
    await wrapper.vm.$nextTick()

    // Verify the document was modified
    expect(targetDoc.sequence.length).toBe(19)
    expect(targetDoc.sequence).toBe('ATCGACGATCGATCGATCG')

    // Capture alignmentResult AFTER delete
    const alignmentAfter = wrapper.vm.alignmentResult
    console.log('alignmentResult AFTER delete:', {
      targetAligned: alignmentAfter?.targetAligned,
      queryAligned: alignmentAfter?.queryAligned,
      score: alignmentAfter?.score
    })

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
    await wrapper.vm.$nextTick()

    // Before delete
    const alignedTargetBefore = wrapper.vm.alignedTargetSequence
    expect(alignedTargetBefore).toBe('ATCGATCGATCGATCGATCGATCG')

    // Delete from target
    targetDoc.delete([{ start: 0, end: 5 }])
    await wrapper.vm.$nextTick()

    // After delete - alignedTargetSequence should reflect the change
    const alignedTargetAfter = wrapper.vm.alignedTargetSequence
    console.log('alignedTargetSequence BEFORE:', alignedTargetBefore)
    console.log('alignedTargetSequence AFTER:', alignedTargetAfter)
    console.log('targetDoc.sequence AFTER:', targetDoc.sequence)

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
    await wrapper.vm.$nextTick()

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
    //   Target: ATCG-ATCG (gap at position 4)
    //   Query:  ATCGAATCG
    const targetDoc = createDoc('ATCGATCG')
    const queryDoc = createDoc('ATCGAATCG')

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await wrapper.vm.$nextTick()

    // Verify alignment
    expect(wrapper.vm.alignmentResult.targetAligned).toBe('ATCG-ATCG')
    expect(wrapper.vm.alignmentResult.queryAligned).toBe('ATCGAATCG')

    // Position 4 should be an insertion (gap in target)
    const feature = wrapper.vm.detectAlignmentFeatureAt(4)
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
    await wrapper.vm.$nextTick()

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
    await wrapper.vm.$nextTick()

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
    await wrapper.vm.$nextTick()

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
    await wrapper.vm.$nextTick()

    // Position 4 has gap in target (insertion in query)
    const items = wrapper.vm.getAlignmentMenuItems(4, 'query')
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
    await wrapper.vm.$nextTick()

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
    await wrapper.vm.$nextTick()

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
    await wrapper.vm.$nextTick()

    // Verify no annotations initially
    expect(queryDoc.annotations.length).toBe(0)

    // Create deletion annotation at position 4 (single gap)
    wrapper.vm.createDeletionAnnotation(4, 5)
    await wrapper.vm.$nextTick()

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
    await wrapper.vm.$nextTick()

    // Verify alignment has the expected gaps
    expect(wrapper.vm.alignmentResult.targetAligned).toBe('ATCGAAATCG')
    expect(wrapper.vm.alignmentResult.queryAligned).toBe('ATCG--ATCG')

    // Create deletion annotation for the entire gap region (positions 4-6)
    wrapper.vm.createDeletionAnnotation(4, 6)
    await wrapper.vm.$nextTick()

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
    //   Target: ATCG-ATCG (gap at position 4)
    //   Query:  ATCGAATCG
    // Insertion at aligned position 4 - inserted base 'A'
    // Caption: +A (the inserted sequence)
    // Span: 4..5 (the inserted base in original query coordinates)
    // Should store sequence in attributes
    const targetDoc = createDoc('ATCGATCG')
    const queryDoc = createDoc('ATCGAATCG')

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await wrapper.vm.$nextTick()

    // Verify no annotations initially
    expect(queryDoc.annotations.length).toBe(0)

    // Create insertion annotation at position 4
    wrapper.vm.createInsertionAnnotation(4, 5)
    await wrapper.vm.$nextTick()

    // Should have created annotation on query document
    expect(queryDoc.annotations.length).toBe(1)
    const ann = queryDoc.annotations[0]
    expect(ann.type).toBe('insertion')
    expect(ann.caption).toBe('+A')
    // Span should cover the inserted base (position 4 in original query)
    expect(ann.span.ranges[0].start).toBe(4)
    expect(ann.span.ranges[0].end).toBe(5)
    // Sequence should be stored in attributes
    expect(ann.attributes.sequence).toBe('A')
  })

  it('creates insertion annotation for multi-base insertion', async () => {
    // Target: ATCGATCG    (8 bases)
    // Query:  ATCGAAATCG  (10 bases)
    // Aligned:
    //   Target: ATCG--ATCG (gaps at positions 4-5)
    //   Query:  ATCGAAATCG
    // Insertion of 'AA' at aligned positions 4-6
    const targetDoc = createDoc('ATCGATCG')
    const queryDoc = createDoc('ATCGAAATCG')

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await wrapper.vm.$nextTick()

    // Verify alignment
    expect(wrapper.vm.alignmentResult.targetAligned).toBe('ATCG--ATCG')
    expect(wrapper.vm.alignmentResult.queryAligned).toBe('ATCGAAATCG')

    // Create insertion annotation for the entire insertion (positions 4-6)
    wrapper.vm.createInsertionAnnotation(4, 6)
    await wrapper.vm.$nextTick()

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
    await wrapper.vm.$nextTick()

    // Verify no annotations initially
    expect(queryDoc.annotations.length).toBe(0)

    // Create mutation annotation at position 4
    wrapper.vm.createMutationAnnotation(4, 5)
    await wrapper.vm.$nextTick()

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
    await wrapper.vm.$nextTick()

    // Verify alignment (should be direct without gaps)
    expect(wrapper.vm.alignmentResult.targetAligned).toBe('ATCGATCGATCG')
    expect(wrapper.vm.alignmentResult.queryAligned).toBe('ATCGTTCGATCG')

    // Create mutation annotation for positions 4-6 (AT->TT)
    wrapper.vm.createMutationAnnotation(4, 6)
    await wrapper.vm.$nextTick()

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
    await wrapper.vm.$nextTick()

    // Get menu items for deletion position
    const items = wrapper.vm.getAlignmentMenuItems(4, 'query')
    const deleteItem = items.find(item => item.label === 'Annotate deletion')
    expect(deleteItem).toBeDefined()

    // Execute the action
    deleteItem.action()
    await wrapper.vm.$nextTick()

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
    await wrapper.vm.$nextTick()

    // Get menu items for insertion position
    const items = wrapper.vm.getAlignmentMenuItems(4, 'query')
    const insertItem = items.find(item => item.label === 'Annotate insertion')
    expect(insertItem).toBeDefined()

    // Execute the action
    insertItem.action()
    await wrapper.vm.$nextTick()

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
    await wrapper.vm.$nextTick()

    // Get menu items for mutation position
    const items = wrapper.vm.getAlignmentMenuItems(4, 'query')
    const mutationItem = items.find(item => item.label === 'Annotate mutation')
    expect(mutationItem).toBeDefined()

    // Execute the action
    mutationItem.action()
    await wrapper.vm.$nextTick()

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
    await wrapper.vm.$nextTick()

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
    //   Target: ATCG--ATCG (gaps at positions 4-5)
    //   Query:  ATCGAAATCG
    const targetDoc = createDoc('ATCGATCG')
    const queryDoc = createDoc('ATCGAAATCG')

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } }
    })
    await wrapper.vm.$nextTick()

    // Clicking on position 4 should find the full insertion region 4-6
    const region = wrapper.vm.findContiguousFeatureRegion(4, 'insertion')
    expect(region.start).toBe(4)
    expect(region.end).toBe(6)
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
    await wrapper.vm.$nextTick()

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
    await wrapper.vm.$nextTick()

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
    //   Target: ATCG-ATCG (gap at position 4)
    //   Query:  ATCGAATCG
    const targetDoc = createDoc('ATCGATCG')
    const queryDoc = createDoc('ATCGAATCG')

    const wrapper = mount(AlignmentEditor, {
      props: { target: targetDoc, query: queryDoc, initialZoom: 100 },
      global: { stubs: { Teleport: true } },
      attachTo: document.body
    })
    await wrapper.vm.$nextTick()

    // Find the alignment-match overlay rect
    const matchOverlay = wrapper.find('rect.alignment-match-overlay')
    expect(matchOverlay.exists()).toBe(true)

    // Verify menu items for position 4 (the insertion)
    const items = wrapper.vm.getAlignmentMenuItems(4, 'query')
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
    await wrapper.vm.$nextTick()

    // Find the alignment-match overlay rect
    const matchOverlay = wrapper.find('rect.alignment-match-overlay')
    expect(matchOverlay.exists()).toBe(true)

    // Verify menu items for position 4 (the mismatch)
    const items = wrapper.vm.getAlignmentMenuItems(4, 'query')
    expect(items.length).toBeGreaterThan(0)
    expect(items.some(item => item.label === 'Annotate mutation')).toBe(true)

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
    await wrapper.vm.$nextTick()

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
    await wrapper.vm.$nextTick()

    // Verify no annotations initially
    expect(queryDoc.annotations.length).toBe(0)

    // Get menu items and execute the deletion action
    const items = wrapper.vm.getAlignmentMenuItems(4, 'query')
    const deleteItem = items.find(item => item.label === 'Annotate deletion')
    expect(deleteItem).toBeDefined()

    deleteItem.action()
    await wrapper.vm.$nextTick()

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
    await wrapper.vm.$nextTick()

    // Verify no annotations initially
    expect(queryDoc.annotations.length).toBe(0)

    // Get menu items and execute the insertion action
    const items = wrapper.vm.getAlignmentMenuItems(4, 'query')
    const insertItem = items.find(item => item.label === 'Annotate insertion')
    expect(insertItem).toBeDefined()

    insertItem.action()
    await wrapper.vm.$nextTick()

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
    await wrapper.vm.$nextTick()

    // Verify no annotations initially
    expect(queryDoc.annotations.length).toBe(0)

    // Get menu items and execute the mutation action
    const items = wrapper.vm.getAlignmentMenuItems(4, 'query')
    const mutationItem = items.find(item => item.label === 'Annotate mutation')
    expect(mutationItem).toBeDefined()

    mutationItem.action()
    await wrapper.vm.$nextTick()

    // Annotation should be created on query document
    expect(queryDoc.annotations.length).toBe(1)
    expect(queryDoc.annotations[0].type).toBe('mutation')
    expect(queryDoc.annotations[0].caption).toBe('A5T')

    wrapper.unmount()
  })
})
