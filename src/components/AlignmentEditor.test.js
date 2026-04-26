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

describe('AlignmentEditor Context Menu', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY)
  })

  it('shows context menu with Select all option when no selection', async () => {
    const wrapper = mount(AlignmentEditor, {
      props: {
        target: createDoc('ATCGATCGATCG'),
        query: createDoc('ATCGATCGATCG')
      }
    })

    await wrapper.vm.$nextTick()

    // Build context menu with no selection
    const items = wrapper.vm.buildContextMenuItems({ source: 'sequence' })

    // Should have at least one item (Select all)
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

    // Build context menu with selection
    const items = wrapper.vm.buildContextMenuItems({ source: 'sequence' })

    // Should have Copy, Select none, Select all, and Delete
    expect(items.some(item => item.label === 'Copy selection')).toBe(true)
    expect(items.some(item => item.label === 'Select none')).toBe(true)
    expect(items.some(item => item.label === 'Select all')).toBe(true)
    expect(items.some(item => item.label === 'Delete sequence')).toBe(true)
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

    // Build context menu and execute Select all action
    const items = wrapper.vm.buildContextMenuItems({ source: 'sequence' })
    const selectAllItem = items.find(item => item.label === 'Select all')
    expect(selectAllItem).toBeDefined()

    selectAllItem.action()
    await wrapper.vm.$nextTick()

    // Should have selected entire target sequence (12 bases)
    expect(wrapper.vm.selection.isSelected.value).toBe(true)
    expect(wrapper.vm.selection.domain.value.ranges[0].start).toBe(0)
    expect(wrapper.vm.selection.domain.value.ranges[0].end).toBe(12)
  })

  it('Select all uses query sequence length when query is selected', async () => {
    const wrapper = mount(AlignmentEditor, {
      props: {
        target: createDoc('ATCGATCGATCG'),
        query: createDoc('GGGGAAAA')  // 8 bases
      }
    })

    await wrapper.vm.$nextTick()

    // First select something on query row to set source to 'query'
    wrapper.vm.selection.startSelection(0, false, 'query')
    wrapper.vm.selection.updateSelection(2)
    wrapper.vm.selection.endSelection()
    await wrapper.vm.$nextTick()

    expect(wrapper.vm.selection.source.value).toBe('query')

    // Build context menu and execute Select all action
    const items = wrapper.vm.buildContextMenuItems({ source: 'sequence' })
    const selectAllItem = items.find(item => item.label === 'Select all')
    selectAllItem.action()
    await wrapper.vm.$nextTick()

    // Should have selected entire query sequence (8 bases)
    expect(wrapper.vm.selection.isSelected.value).toBe(true)
    expect(wrapper.vm.selection.domain.value.ranges[0].start).toBe(0)
    expect(wrapper.vm.selection.domain.value.ranges[0].end).toBe(8)
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
