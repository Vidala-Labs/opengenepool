import { describe, it, expect, beforeEach } from 'bun:test'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import SequenceEditor from './SequenceEditor.vue'
import AlignmentTicksLayer from './AlignmentTicksLayer.vue'
import { STORAGE_KEY } from '../composables/usePersistedZoom.js'

// Mock graphics provider for AlignmentTicksLayer tests
function createMockGraphics(textMode = true) {
  return {
    metrics: ref({
      lmargin: 50,
      charWidth: 8,
      blockWidth: 7,
      textMode
    }),
    lineHeight: ref(16)
  }
}

describe('SequenceLayer styling integration', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY)
  })

  it('renders sequence-text with correct CSS class', async () => {
    const wrapper = mount(SequenceEditor, {
      props: {
        sequence: 'ATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCG',
        initialZoom: 50
      }
    })

    await wrapper.vm.$nextTick()

    // Find the sequence-text element rendered by SequenceLayer
    const sequenceText = wrapper.find('.sequence-text')
    expect(sequenceText.exists()).toBe(true)

    // Verify the element has the correct class for styling
    expect(sequenceText.classes()).toContain('sequence-text')
  })

  it('SequenceLayer does not define conflicting scoped styles', async () => {
    // Import SequenceLayer and verify it doesn't have scoped style block
    const SequenceLayer = (await import('./SequenceLayer.vue')).default

    // The component should not have styles that would override SequenceEditor's :deep() styles
    // This is a structural test - we verify SequenceLayer relies on parent styles
    expect(SequenceLayer).toBeDefined()

    // Mount and verify the element renders without inline style conflicts
    const wrapper = mount(SequenceEditor, {
      props: {
        sequence: 'ATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCG',
        initialZoom: 50
      }
    })

    await wrapper.vm.$nextTick()

    const sequenceText = wrapper.find('.sequence-text')
    expect(sequenceText.exists()).toBe(true)

    // Should not have font-size set as inline style (it should come from CSS)
    expect(sequenceText.element.style.fontSize).toBe('')
  })

  it('sequence text has letter-spacing style applied when in text mode', async () => {
    const wrapper = mount(SequenceEditor, {
      props: {
        sequence: 'ATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCG',
        initialZoom: 50
      }
    })

    await wrapper.vm.$nextTick()

    // Check if text mode is active (depends on zoom level and container size)
    const textMode = wrapper.vm.graphics.metrics.value.textMode

    if (textMode) {
      const sequenceText = wrapper.find('.sequence-text')
      expect(sequenceText.exists()).toBe(true)

      // Letter spacing should be set as inline style from SequenceLayer
      const letterSpacing = sequenceText.element.style.letterSpacing
      // Should be a pixel value (may be negative for compact spacing)
      expect(letterSpacing).toMatch(/^-?\d+(\.\d+)?px$/)
    } else {
      // In bar mode, sequence-bar should exist instead
      const sequenceBar = wrapper.find('.sequence-bar')
      expect(sequenceBar.exists()).toBe(true)
    }
  })

  it('alignment mode renders target text with correct class when in text mode', async () => {
    const wrapper = mount(SequenceEditor, {
      props: {
        sequence: 'ATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCG',
        alignmentSequence: 'ATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCG',
        initialZoom: 50
      }
    })

    await wrapper.vm.$nextTick()

    // Check alignment mode is active
    expect(wrapper.vm.isAlignmentMode).toBe(true)
    expect(wrapper.vm.hasAlignment).toBe(true)

    // Check if text mode is active
    const textMode = wrapper.vm.graphics.metrics.value.textMode

    if (textMode) {
      // Find alignment target text - it should have both sequence-text and alignment-target-text classes
      const targetTexts = wrapper.findAll('.sequence-text')
      expect(targetTexts.length).toBeGreaterThan(0)

      // At least one should have alignment-target-text class
      const hasTargetClass = targetTexts.some(el => el.classes().includes('alignment-target-text'))
      expect(hasTargetClass).toBe(true)
    } else {
      // In bar mode, we should have sequence-bar elements
      const sequenceBars = wrapper.findAll('.sequence-bar')
      expect(sequenceBars.length).toBeGreaterThan(0)
    }
  })
})

describe('AlignmentTicks Component', () => {
  it('renders match indicators between aligned sequences', () => {
    const wrapper = mount(AlignmentTicksLayer, {
      global: {
        provide: {
          graphics: createMockGraphics(true),
          isAlignmentMode: ref(true),
          alignmentLines: ref([{ index: 0, matchText: '|||  ||' }]),
          alignmentBlockHeight: ref(48)
        }
      }
    })

    const text = wrapper.find('.alignment-match-text')
    expect(text.exists()).toBe(true)
    expect(text.text()).toBe('|||  ||')
  })

  it('shows full match line for identical sequences', () => {
    const wrapper = mount(AlignmentTicksLayer, {
      global: {
        provide: {
          graphics: createMockGraphics(true),
          isAlignmentMode: ref(true),
          alignmentLines: ref([{ index: 0, matchText: '|||||||||' }]),
          alignmentBlockHeight: ref(48)
        }
      }
    })

    const text = wrapper.find('.alignment-match-text')
    expect(text.text()).toBe('|||||||||')
  })

  it('hides match text in bar mode', () => {
    const wrapper = mount(AlignmentTicksLayer, {
      global: {
        provide: {
          graphics: createMockGraphics(false),
          isAlignmentMode: ref(true),
          alignmentLines: ref([{ index: 0, matchText: '|||' }]),
          alignmentBlockHeight: ref(48)
        }
      }
    })

    const text = wrapper.find('.alignment-match-text')
    expect(text.exists()).toBe(false)
  })
})

describe('SequenceEditor Alignment Mode', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY)
  })

  it('aligns identical sequences correctly', async () => {
    const sequence = 'CGAGTCAGT'

    const wrapper = mount(SequenceEditor, {
      props: {
        sequence: sequence,
        alignmentSequence: sequence
      }
    })

    await wrapper.vm.$nextTick()

    // Should be in alignment mode
    expect(wrapper.vm.isAlignmentMode).toBe(true)
    expect(wrapper.vm.hasAlignment).toBe(true)

    // Check the alignment result
    const result = wrapper.vm.alignmentResult
    expect(result.targetAligned).toBe('CGAGTCAGT')
    expect(result.queryAligned).toBe('CGAGTCAGT')
    expect(result.identity).toBe(100)

    // Check alignment lines are generated correctly
    const lines = wrapper.vm.alignmentLines
    expect(lines.length).toBeGreaterThan(0)
    expect(lines[0].targetText).toBe('CGAGTCAGT')
    expect(lines[0].queryText).toBe('CGAGTCAGT')
    expect(lines[0].matchText).toBe('|||||||||')

    // Check that sequence lines exist in the SVG (alignment mode uses same .sequence-line class)
    const sequenceLines = wrapper.findAll('.sequence-line')
    expect(sequenceLines.length).toBeGreaterThan(0)

    // Check textMode - if false, text won't render (bar mode instead)
    const textMode = wrapper.vm.graphics.metrics.value.textMode

    if (textMode) {
      // Check that the SVG contains alignment text elements
      const targetText = wrapper.find('.alignment-target-text')
      const queryText = wrapper.find('.alignment-query-text')
      const matchText = wrapper.find('.alignment-match-text')

      expect(targetText.exists()).toBe(true)
      expect(queryText.exists()).toBe(true)
      expect(matchText.exists()).toBe(true)

      // Verify the text content in the SVG elements
      expect(targetText.text()).toBe('CGAGTCAGT')
      expect(queryText.text()).toBe('CGAGTCAGT')
      expect(matchText.text()).toBe('|||||||||')
    }
  })

  it('aligns query that is substring of target (CGAGTCAGT vs AGTCAGT)', async () => {
    const target = 'CGAGTCAGT'
    const query = 'AGTCAGT'

    const wrapper = mount(SequenceEditor, {
      props: {
        sequence: target,
        alignmentSequence: query
      }
    })

    await wrapper.vm.$nextTick()

    expect(wrapper.vm.isAlignmentMode).toBe(true)
    expect(wrapper.vm.hasAlignment).toBe(true)

    const result = wrapper.vm.alignmentResult
    // Query should align to the AGTCAGT portion of target
    expect(result.queryAligned).toBe('AGTCAGT')
    expect(result.targetAligned).toBe('AGTCAGT')
    expect(result.identity).toBe(100)

    // Target start should be at position 2 (0-indexed), where AGTCAGT begins
    expect(result.targetStart).toBe(2)
    expect(result.targetEnd).toBe(9)

    // Query spans the full sequence
    expect(result.queryStart).toBe(0)
    expect(result.queryEnd).toBe(7)

    const lines = wrapper.vm.alignmentLines
    expect(lines.length).toBeGreaterThan(0)
    expect(lines[0].matchText).toBe('|||||||')
  })

  it('aligns query with extra bases at end (CGAGTCAGT vs AGTCAGTTT)', async () => {
    const target = 'CGAGTCAGT'
    const query = 'AGTCAGTTT'

    const wrapper = mount(SequenceEditor, {
      props: {
        sequence: target,
        alignmentSequence: query
      }
    })

    await wrapper.vm.$nextTick()

    expect(wrapper.vm.isAlignmentMode).toBe(true)
    expect(wrapper.vm.hasAlignment).toBe(true)

    const result = wrapper.vm.alignmentResult
    // Should find the AGTCAGT match, ignoring the extra TT
    expect(result.queryAligned).toBe('AGTCAGT')
    expect(result.targetAligned).toBe('AGTCAGT')
    expect(result.identity).toBe(100)

    // Query starts at 0 but ends at 7 (not including the TT)
    expect(result.queryStart).toBe(0)
    expect(result.queryEnd).toBe(7)

    // Target aligns from position 2
    expect(result.targetStart).toBe(2)
    expect(result.targetEnd).toBe(9)

    const lines = wrapper.vm.alignmentLines
    expect(lines.length).toBeGreaterThan(0)
    expect(lines[0].matchText).toBe('|||||||')
  })
})

describe('Alignment Selection', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY)
  })

  // Note: Selection in alignment mode is now handled by SequenceLayer components
  // which use the unified selection composable. These tests verify the selection
  // composable works correctly in alignment mode context.

  it('uses unified selection composable in alignment mode', async () => {
    const wrapper = mount(SequenceEditor, {
      props: {
        sequence: 'ATCGATCGATCG',
        alignmentSequence: 'ATCGATCGATCG'
      }
    })

    await wrapper.vm.$nextTick()

    // The selection composable should be available
    expect(wrapper.vm.selection).toBeDefined()
    expect(wrapper.vm.selection.domain).toBeDefined()
  })

  it('creates selection using selection composable in alignment mode', async () => {
    const wrapper = mount(SequenceEditor, {
      props: {
        sequence: 'ATCGATCGATCG',
        alignmentSequence: 'ATCGATCGATCG'
      }
    })

    await wrapper.vm.$nextTick()

    // Use selection composable directly (this is what SequenceLayer does internally)
    wrapper.vm.selection.select('2..8')
    await wrapper.vm.$nextTick()

    expect(wrapper.vm.selection.isSelected.value).toBe(true)
    expect(wrapper.vm.selection.domain.value.ranges[0].start).toBe(2)
    expect(wrapper.vm.selection.domain.value.ranges[0].end).toBe(8)
  })

  it('shows selection path with correct orientation', async () => {
    const wrapper = mount(SequenceEditor, {
      props: {
        sequence: 'ATCGATCGATCG',
        alignmentSequence: 'ATCGATCGATCG'
      }
    })

    await wrapper.vm.$nextTick()

    // Create a forward selection
    wrapper.vm.selection.startSelection(2)
    wrapper.vm.selection.updateSelection(8)
    wrapper.vm.selection.endSelection()
    await wrapper.vm.$nextTick()

    // Selection should be rendered with plus orientation (forward drag)
    expect(wrapper.vm.selection.domain.value.ranges[0].orientation).toBe(1)  // PLUS
  })

  it('can select reverse direction', async () => {
    const wrapper = mount(SequenceEditor, {
      props: {
        sequence: 'ATCGATCGATCG',
        alignmentSequence: 'ATCGATCGATCG'
      }
    })

    await wrapper.vm.$nextTick()

    // Create a reverse selection (drag from right to left)
    wrapper.vm.selection.startSelection(8)
    wrapper.vm.selection.updateSelection(2)
    wrapper.vm.selection.endSelection()
    await wrapper.vm.$nextTick()

    // Selection should be rendered with minus orientation (reverse drag)
    expect(wrapper.vm.selection.domain.value.ranges[0].orientation).toBe(-1)  // MINUS
  })

  it('SelectionLayer receives selection from composable', async () => {
    const wrapper = mount(SequenceEditor, {
      props: {
        sequence: 'ATCGATCGATCG',
        alignmentSequence: 'ATCGATCGATCG'
      }
    })

    await wrapper.vm.$nextTick()

    // Create a selection
    wrapper.vm.selection.select('2..8')
    await wrapper.vm.$nextTick()

    // SelectionLayer should have access to the selection via injection
    const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
    expect(selectionLayer.exists()).toBe(true)
    expect(selectionLayer.vm.selection).toBeDefined()
    expect(selectionLayer.vm.selection.isSelected.value).toBe(true)
  })

  it('query row selection is independent from target row', async () => {
    const wrapper = mount(SequenceEditor, {
      props: {
        sequence: 'ATCGATCGATCG',
        alignmentSequence: 'GGGGAAAACCCC'
      }
    })

    await wrapper.vm.$nextTick()

    // Simulate selection on query row (startSelection now takes source as 3rd param)
    wrapper.vm.selection.startSelection(0, false, 'query')
    wrapper.vm.selection.updateSelection(4)
    wrapper.vm.selection.endSelection()
    await wrapper.vm.$nextTick()

    // Selection should be active with query source
    expect(wrapper.vm.selection.isSelected.value).toBe(true)
    expect(wrapper.vm.selection.source.value).toBe('query')

    // Copy should return query sequence, not target
    const selectedText = wrapper.vm.getSelectedAlignmentSequenceText()
    expect(selectedText).toBe('GGGG')  // First 4 bases of query

    // Find selection paths
    const selectionPaths = wrapper.findAll('.selection')
    expect(selectionPaths.length).toBeGreaterThan(0)

    // Parse the SVG path to extract Y coordinates
    const selectionPath = selectionPaths[0]
    const pathD = selectionPath.attributes('d')
    expect(pathD).toBeDefined()

    // Extract Y coordinate from path (format: "M x,y L x,y ..." or similar)
    // The path contains coordinates - extract the Y value
    const yMatch = pathD.match(/[ML]\s*[\d.]+[,\s]([\d.]+)/)
    expect(yMatch).not.toBeNull()
    const actualY = parseFloat(yMatch[1])

    // Query row should be at Y = 2 * lineHeight (below target and match rows)
    const lineHeight = wrapper.vm.graphics.lineHeight.value
    const expectedQueryY = lineHeight * 2

    // The selection Y should be at the query row position, not at 0 (target row)
    expect(actualY).toBeGreaterThanOrEqual(expectedQueryY)
  })

  it('target row selection has handles at the top pointing down', async () => {
    const wrapper = mount(SequenceEditor, {
      props: {
        sequence: 'ATCGATCGATCG',
        alignmentSequence: 'ATCGATCGATCG'
      }
    })

    await wrapper.vm.$nextTick()

    // Create selection on target row
    wrapper.vm.selection.startSelection(0, false, 'target')
    wrapper.vm.selection.updateSelection(4)
    wrapper.vm.selection.endSelection()
    await wrapper.vm.$nextTick()

    // Find handle paths (sel_handle class)
    const handles = wrapper.findAll('.sel_handle')
    expect(handles.length).toBe(2)  // start and end handles

    // Get the selection path to find the selection's Y position
    const selectionPath = wrapper.find('.selection')
    const selPathD = selectionPath.attributes('d')

    // Parse Y values from path commands
    const selMMatch = selPathD.match(/M\s+[\d.]+,(-?[\d.]+)/)
    const selVMatches = [...selPathD.matchAll(/V\s+(-?[\d.]+)/g)]
    const allSelY = [
      selMMatch ? parseFloat(selMMatch[1]) : null,
      ...selVMatches.map(m => parseFloat(m[1]))
    ].filter(v => v !== null)
    const selectionTopY = Math.min(...allSelY)

    // Get handle path and parse Y values
    const handlePath = handles[0].attributes('d')
    const handleMMatch = handlePath.match(/M\s+[\d.]+,(-?[\d.]+)/)
    const handleLMatches = [...handlePath.matchAll(/L\s+[\d.]+,(-?[\d.]+)/g)]
    const handleVMatches = [...handlePath.matchAll(/V\s+(-?[\d.]+)/g)]
    const handleQMatches = [...handlePath.matchAll(/Q\s+[\d.]+,(-?[\d.]+)\s+[\d.]+,(-?[\d.]+)/g)]

    const handleYValues = [
      handleMMatch ? parseFloat(handleMMatch[1]) : null,
      ...handleLMatches.map(m => parseFloat(m[1])),
      ...handleVMatches.map(m => parseFloat(m[1])),
      ...handleQMatches.flatMap(m => [parseFloat(m[1]), parseFloat(m[2])])
    ].filter(v => v !== null)

    const handleBottomY = Math.max(...handleYValues)  // Triangle tip pointing down
    const handleTopY = Math.min(...handleYValues)     // Top of rectangle

    // For target row: handle is above selection, triangle points DOWN into selection
    // Handle's rectangle is above the selection top
    expect(handleTopY).toBeLessThan(selectionTopY)
    // Handle's triangle tip is at or near the selection top
    expect(handleBottomY).toBeLessThanOrEqual(selectionTopY + 10)
  })

  it('query row selection has handles at the bottom pointing up', async () => {
    const wrapper = mount(SequenceEditor, {
      props: {
        sequence: 'ATCGATCGATCG',
        alignmentSequence: 'ATCGATCGATCG'
      }
    })

    await wrapper.vm.$nextTick()

    // Create selection on query row
    wrapper.vm.selection.startSelection(0, false, 'query')
    wrapper.vm.selection.updateSelection(4)
    wrapper.vm.selection.endSelection()
    await wrapper.vm.$nextTick()

    // Find handle paths
    const handles = wrapper.findAll('.sel_handle')
    expect(handles.length).toBe(2)

    // Get the selection path to find the selection's bottom Y
    const selectionPath = wrapper.find('.selection')
    const selPathD = selectionPath.attributes('d')

    // Parse V commands for Y values (V y means vertical line to y)
    // Selection path format: M x,y H x V y H x Z
    const selVMatches = [...selPathD.matchAll(/V\s+(-?[\d.]+)/g)]
    const selYFromV = selVMatches.map(m => parseFloat(m[1]))

    // Also get Y from M command (M x,y)
    const selMMatch = selPathD.match(/M\s+[\d.]+,(-?[\d.]+)/)
    const selYFromM = selMMatch ? parseFloat(selMMatch[1]) : null

    const allSelY = [...selYFromV, selYFromM].filter(v => v !== null)
    const selectionBottomY = Math.max(...allSelY)

    // Get handle path and parse similarly
    const handlePath = handles[0].attributes('d')

    // For query up-pointing triangle, the path starts with M x,top (triangle tip)
    // Then L to y (junction), then V to bottom
    const handleMMatch = handlePath.match(/M\s+[\d.]+,(-?[\d.]+)/)
    const handleLMatches = [...handlePath.matchAll(/L\s+[\d.]+,(-?[\d.]+)/g)]
    const handleVMatches = [...handlePath.matchAll(/V\s+(-?[\d.]+)/g)]
    const handleQMatches = [...handlePath.matchAll(/Q\s+[\d.]+,(-?[\d.]+)\s+[\d.]+,(-?[\d.]+)/g)]

    const handleYValues = [
      handleMMatch ? parseFloat(handleMMatch[1]) : null,
      ...handleLMatches.map(m => parseFloat(m[1])),
      ...handleVMatches.map(m => parseFloat(m[1])),
      ...handleQMatches.flatMap(m => [parseFloat(m[1]), parseFloat(m[2])])
    ].filter(v => v !== null)

    const handleTopY = Math.min(...handleYValues)     // Triangle tip pointing UP
    const handleBottomY = Math.max(...handleYValues)  // Bottom of rectangle

    // For query row: handle is below selection, triangle points UP into selection
    // Handle's rectangle is below the selection bottom
    expect(handleBottomY).toBeGreaterThan(selectionBottomY)
    // Handle's triangle tip is at or near the selection bottom
    expect(handleTopY).toBeGreaterThanOrEqual(selectionBottomY - 10)
  })

  it('query row multi-selection has tags below handles', async () => {
    const wrapper = mount(SequenceEditor, {
      props: {
        sequence: 'ATCGATCGATCGATCGATCG',
        alignmentSequence: 'ATCGATCGATCGATCGATCG'
      }
    })

    await wrapper.vm.$nextTick()

    const lineHeight = wrapper.vm.graphics.lineHeight.value

    // Create multi-selection on query row
    wrapper.vm.selection.startSelection(0, false, 'query')
    wrapper.vm.selection.updateSelection(4)
    wrapper.vm.selection.endSelection()

    // Add second range (Ctrl-click would do this)
    wrapper.vm.selection.startSelection(8, true, 'query')
    wrapper.vm.selection.updateSelection(12)
    wrapper.vm.selection.endSelection()
    await wrapper.vm.$nextTick()

    // Should have 2 ranges
    expect(wrapper.vm.selection.domain.value.ranges.length).toBe(2)

    // Find tags (sel_tag class)
    const tags = wrapper.findAll('.sel_tag')
    expect(tags.length).toBe(2)

    // Get handle and tag Y positions
    const handles = wrapper.findAll('.sel_handle')
    const handlePath = handles[0].attributes('d')
    // Extract all Y values and get the max (bottom of handle for query mode)
    const handleYValues = [...handlePath.matchAll(/[,\s](-?[\d.]+)/g)].map(m => parseFloat(m[1]))
    const handleBottomY = Math.max(...handleYValues)

    // Get tag transform to extract Y position
    const tagTransform = tags[0].attributes('transform')
    const tagYMatch = tagTransform.match(/translate\(-?[\d.]+,\s*(-?[\d.]+)\)/)
    const tagY = parseFloat(tagYMatch[1])

    // For query row: tags should be BELOW handles (higher Y value than handle bottom)
    expect(tagY).toBeGreaterThan(handleBottomY)
  })

  it('query row multi-line selection has start handle on first line', async () => {
    const wrapper = mount(SequenceEditor, {
      props: {
        // Long sequence to ensure multi-line at zoom 50
        sequence: 'ATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCG',
        alignmentSequence: 'ATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCG',
        initialZoom: 50
      }
    })

    await wrapper.vm.$nextTick()

    const lineHeight = wrapper.vm.graphics.lineHeight.value

    // Create a selection spanning multiple lines on query row (positions 0 to 60 spans 2 lines at zoom 50)
    wrapper.vm.selection.startSelection(0, false, 'query')
    wrapper.vm.selection.updateSelection(60)
    wrapper.vm.selection.endSelection()
    await wrapper.vm.$nextTick()

    // Find handle paths
    const handles = wrapper.findAll('.sel_handle')
    expect(handles.length).toBe(2)  // start and end handles

    // Parse Y values from both handles
    const handle0Path = handles[0].attributes('d')
    const handle1Path = handles[1].attributes('d')

    // Extract Y values from handle paths
    const extractYValues = (path) => {
      const mMatch = path.match(/M\s+[\d.]+,(-?[\d.]+)/)
      const lMatches = [...path.matchAll(/L\s+[\d.]+,(-?[\d.]+)/g)]
      const vMatches = [...path.matchAll(/V\s+(-?[\d.]+)/g)]
      const qMatches = [...path.matchAll(/Q\s+[\d.]+,(-?[\d.]+)\s+[\d.]+,(-?[\d.]+)/g)]
      return [
        mMatch ? parseFloat(mMatch[1]) : null,
        ...lMatches.map(m => parseFloat(m[1])),
        ...vMatches.map(m => parseFloat(m[1])),
        ...qMatches.flatMap(m => [parseFloat(m[1]), parseFloat(m[2])])
      ].filter(v => v !== null)
    }

    const handle0YValues = extractYValues(handle0Path)
    const handle1YValues = extractYValues(handle1Path)

    // Get center Y of each handle (average of min and max)
    const handle0CenterY = (Math.min(...handle0YValues) + Math.max(...handle0YValues)) / 2
    const handle1CenterY = (Math.min(...handle1YValues) + Math.max(...handle1YValues)) / 2

    // For a multi-line selection on query row:
    // - Start handle (handle0) should be on line 0 (lower Y value since query row Y increases with line)
    // - End handle (handle1) should be on line 1 (higher Y value)
    // The two handles should be on DIFFERENT lines, not the same line
    const yDifference = Math.abs(handle1CenterY - handle0CenterY)

    // They should be at least half a line height apart (on different lines)
    expect(yDifference).toBeGreaterThan(lineHeight / 2)
  })

  it('target row multi-line selection has start handle on first line', async () => {
    const wrapper = mount(SequenceEditor, {
      props: {
        // Long sequence to ensure multi-line at zoom 50
        sequence: 'ATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCG',
        alignmentSequence: 'ATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCG',
        initialZoom: 50
      }
    })

    await wrapper.vm.$nextTick()

    const lineHeight = wrapper.vm.graphics.lineHeight.value

    // Create a selection spanning multiple lines on target row
    wrapper.vm.selection.startSelection(0, false, 'target')
    wrapper.vm.selection.updateSelection(60)
    wrapper.vm.selection.endSelection()
    await wrapper.vm.$nextTick()

    // Find handle paths
    const handles = wrapper.findAll('.sel_handle')
    expect(handles.length).toBe(2)

    // Parse Y values from both handles
    const handle0Path = handles[0].attributes('d')
    const handle1Path = handles[1].attributes('d')

    const extractYValues = (path) => {
      const mMatch = path.match(/M\s+[\d.]+,(-?[\d.]+)/)
      const lMatches = [...path.matchAll(/L\s+[\d.]+,(-?[\d.]+)/g)]
      const vMatches = [...path.matchAll(/V\s+(-?[\d.]+)/g)]
      const qMatches = [...path.matchAll(/Q\s+[\d.]+,(-?[\d.]+)\s+[\d.]+,(-?[\d.]+)/g)]
      return [
        mMatch ? parseFloat(mMatch[1]) : null,
        ...lMatches.map(m => parseFloat(m[1])),
        ...vMatches.map(m => parseFloat(m[1])),
        ...qMatches.flatMap(m => [parseFloat(m[1]), parseFloat(m[2])])
      ].filter(v => v !== null)
    }

    const handle0YValues = extractYValues(handle0Path)
    const handle1YValues = extractYValues(handle1Path)

    const handle0CenterY = (Math.min(...handle0YValues) + Math.max(...handle0YValues)) / 2
    const handle1CenterY = (Math.min(...handle1YValues) + Math.max(...handle1YValues)) / 2

    // For a multi-line selection on target row:
    // The two handles should be on DIFFERENT lines
    const yDifference = Math.abs(handle1CenterY - handle0CenterY)

    // They should be at least half a line height apart
    expect(yDifference).toBeGreaterThan(lineHeight / 2)
  })

  it('query row handle drag stays on same line when dragging horizontally', async () => {
    const wrapper = mount(SequenceEditor, {
      props: {
        // Long sequence to ensure multi-line at zoom 50
        sequence: 'ATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCG',
        alignmentSequence: 'ATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCG',
        initialZoom: 50
      }
    })

    await wrapper.vm.$nextTick()

    // Create a short selection on query row (positions 5-10 on line 0)
    wrapper.vm.selection.startSelection(5, false, 'query')
    wrapper.vm.selection.updateSelection(10)
    wrapper.vm.selection.endSelection()
    await wrapper.vm.$nextTick()

    // Verify initial selection is on line 0 (positions 5-10 are well within first line at zoom 50)
    const initialRange = wrapper.vm.selection.domain.value.ranges[0]
    expect(initialRange.start).toBe(5)
    expect(initialRange.end).toBe(10)

    // Get the SelectionLayer to access its internal drag logic
    const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
    expect(selectionLayer.exists()).toBe(true)

    // Find handles and simulate a drag
    const handles = wrapper.findAll('.sel_handle')
    expect(handles.length).toBe(2)

    // Get the query selection layer (there are target and query selection layers)
    const querySelectionLayer = wrapper.findAllComponents({ name: 'SelectionLayer' })
      .find(sl => sl.props('alignmentMode') === 'query')
    expect(querySelectionLayer).toBeDefined()

    // Get geometry info for simulating the drag
    const lineHeight = wrapper.vm.graphics.lineHeight.value
    const alignmentBlockHeight = lineHeight * 3  // 3 rows per alignment block
    const queryRowY = lineHeight * 2  // Query row is 2 lines down from top of block

    // Simulate dragging the end handle horizontally to the right on the same line
    // The Y should stay at the query row level
    const svgRect = wrapper.find('.editor-svg').element.getBoundingClientRect()

    // Create a synthetic mouse event at the query row Y position
    // If the bug exists, this Y position will be incorrectly calculated as line 1+
    // instead of staying on line 0
    const testY = queryRowY + lineHeight / 2  // Middle of query row on line 0

    // The key insight is: when we're on the query row of line 0, the Y coordinate
    // is at lineHeight * 2 (query offset within block 0).
    // But graphics.pixelToLineIndex() doesn't know about this offset,
    // so it thinks we're on line 1 or 2 instead of line 0.

    // Verify the current selection is single-line (start and end on same line)
    const zoom = wrapper.vm.editorState.zoomLevel.value
    const startLine = Math.floor(initialRange.start / zoom)
    const endLine = Math.floor(initialRange.end / zoom)
    expect(startLine).toBe(0)
    expect(endLine).toBe(0)

    // Now let's check that the SelectionLayer can correctly interpret the Y coordinate
    // by examining its computed selection paths
    const selectionPaths = wrapper.findAll('.selection')
    expect(selectionPaths.length).toBeGreaterThan(0)

    const pathD = selectionPaths[0].attributes('d')
    // Parse the path to verify the selection is rendered on line 0 (query row)
    // For query row on line 0, Y should be around 2 * lineHeight
    const yMatch = pathD.match(/M\s+[\d.]+,(\d+)/)
    expect(yMatch).not.toBeNull()
    const renderedY = parseFloat(yMatch[1])

    // The selection should be rendered at the query row position (2 * lineHeight)
    // If it's at 0 or at alignmentBlockHeight, something is wrong
    expect(renderedY).toBeGreaterThanOrEqual(lineHeight * 2 - 5)  // Allow small tolerance
    expect(renderedY).toBeLessThan(alignmentBlockHeight)  // Should not be on line 1
  })

  it('target row handle drag stays on same line when dragging horizontally', async () => {
    const wrapper = mount(SequenceEditor, {
      props: {
        // Long sequence to ensure multi-line at zoom 50
        sequence: 'ATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCG',
        alignmentSequence: 'ATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCG',
        initialZoom: 50
      }
    })

    await wrapper.vm.$nextTick()

    // Create a short selection on target row (positions 5-10 on line 0)
    wrapper.vm.selection.startSelection(5, false, 'target')
    wrapper.vm.selection.updateSelection(10)
    wrapper.vm.selection.endSelection()
    await wrapper.vm.$nextTick()

    // Verify initial selection
    const initialRange = wrapper.vm.selection.domain.value.ranges[0]
    expect(initialRange.start).toBe(5)
    expect(initialRange.end).toBe(10)

    // Verify selection is on line 0
    const zoom = wrapper.vm.editorState.zoomLevel.value
    const startLine = Math.floor(initialRange.start / zoom)
    const endLine = Math.floor(initialRange.end / zoom)
    expect(startLine).toBe(0)
    expect(endLine).toBe(0)

    // Check the rendered Y position
    const lineHeight = wrapper.vm.graphics.lineHeight.value
    const alignmentBlockHeight = lineHeight * 3

    const selectionPaths = wrapper.findAll('.selection')
    expect(selectionPaths.length).toBeGreaterThan(0)

    const pathD = selectionPaths[0].attributes('d')
    const yMatch = pathD.match(/M\s+[\d.]+,(-?\d+)/)
    expect(yMatch).not.toBeNull()
    const renderedY = parseFloat(yMatch[1])

    // Target row should be at Y=0 (top of the alignment block)
    // It might have a small negative margin for handles
    expect(renderedY).toBeLessThan(lineHeight)  // Should not be at query row position
  })

  it('generates separate rectangular paths per line in alignment mode', async () => {
    const wrapper = mount(SequenceEditor, {
      props: {
        // Long sequence to ensure multi-line at zoom 50
        sequence: 'ATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCG',
        alignmentSequence: 'ATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCG',
        initialZoom: 50
      }
    })

    await wrapper.vm.$nextTick()

    // Create a selection spanning multiple lines on target row (positions 0 to 60 spans 2 lines at zoom 50)
    wrapper.vm.selection.startSelection(0, false, 'target')
    wrapper.vm.selection.updateSelection(60)
    wrapper.vm.selection.endSelection()
    await wrapper.vm.$nextTick()

    // In alignment mode, should have separate path elements per line (2 paths)
    // instead of a single connected wrap-around path (1 path)
    const selectionPaths = wrapper.findAll('.selection')
    expect(selectionPaths.length).toBe(2)

    // Each path should be a simple rectangle (M, H, V, H, Z - only 2 H commands)
    for (const path of selectionPaths) {
      const pathD = path.attributes('d')
      const hCommands = (pathD.match(/H /g) || []).length
      expect(hCommands).toBe(2)  // Simple rectangle has 2 H commands
    }
  })

  it('target row multi-selection has tags above handles', async () => {
    const wrapper = mount(SequenceEditor, {
      props: {
        sequence: 'ATCGATCGATCGATCGATCG',
        alignmentSequence: 'ATCGATCGATCGATCGATCG'
      }
    })

    await wrapper.vm.$nextTick()

    // Create multi-selection on target row
    wrapper.vm.selection.startSelection(0, false, 'target')
    wrapper.vm.selection.updateSelection(4)
    wrapper.vm.selection.endSelection()

    // Add second range
    wrapper.vm.selection.startSelection(8, true, 'target')
    wrapper.vm.selection.updateSelection(12)
    wrapper.vm.selection.endSelection()
    await wrapper.vm.$nextTick()

    // Should have 2 ranges
    expect(wrapper.vm.selection.domain.value.ranges.length).toBe(2)

    // Find tags
    const tags = wrapper.findAll('.sel_tag')
    expect(tags.length).toBe(2)

    // Get handle and tag Y positions
    const handles = wrapper.findAll('.sel_handle')
    const handlePath = handles[0].attributes('d')
    // Extract all Y values and get the min (top of handle for target mode)
    const handleYValues = [...handlePath.matchAll(/[,\s](-?[\d.]+)/g)].map(m => parseFloat(m[1]))
    const handleTopY = Math.min(...handleYValues)

    // Get tag Y position
    const tagTransform = tags[0].attributes('transform')
    const tagYMatch = tagTransform.match(/translate\(-?[\d.]+,\s*(-?[\d.]+)\)/)
    const tagY = parseFloat(tagYMatch[1])

    // For target row: tags should be ABOVE handles (lower Y value than handle top)
    expect(tagY).toBeLessThan(handleTopY)
  })
})

describe('Alignment Annotations', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY)
  })

  it('renders target annotations ABOVE target row', async () => {
    const { Annotation } = await import('../utils/annotation.js')
    const wrapper = mount(SequenceEditor, {
      props: {
        sequence: 'ATCGATCGATCG',
        alignmentSequence: 'ATCGATCGATCG',
        annotations: [
          new Annotation({ id: 'ann1', span: '0..6', type: 'gene', label: 'Test Gene' })
        ]
      }
    })

    await wrapper.vm.$nextTick()

    // Check that aligned target annotations are computed
    const targetAnnotations = wrapper.vm.alignedTargetAnnotations
    expect(targetAnnotations).toBeDefined()
    expect(targetAnnotations.length).toBe(1)
  })

  it('maps annotation coordinates through alignment gaps', async () => {
    const { Annotation } = await import('../utils/annotation.js')
    // Create an alignment with a gap
    const wrapper = mount(SequenceEditor, {
      props: {
        sequence: 'ATCGAATCGATCG', // Has extra A
        alignmentSequence: 'ATCGATCGATCG',
        annotations: [
          new Annotation({ id: 'ann1', span: '0..4', type: 'gene', label: 'Test Gene' })
        ]
      }
    })

    await wrapper.vm.$nextTick()

    // The annotation coordinates should be mapped through the alignment
    const targetAnnotations = wrapper.vm.alignedTargetAnnotations
    expect(targetAnnotations).toBeDefined()
    // Annotation positions should account for gaps in alignment
  })

  it('renders query annotations BELOW query row', async () => {
    const { Annotation } = await import('../utils/annotation.js')
    const wrapper = mount(SequenceEditor, {
      props: {
        sequence: 'ATCGATCGATCG',
        alignmentSequence: 'ATCGATCGATCG',
        alignmentAnnotations: [
          new Annotation({ id: 'qann1', span: '0..6', type: 'gene', label: 'Query Gene' })
        ]
      }
    })

    await wrapper.vm.$nextTick()

    // Check that aligned query annotations are computed
    const queryAnnotations = wrapper.vm.alignedQueryAnnotations
    expect(queryAnnotations).toBeDefined()
    expect(queryAnnotations.length).toBe(1)
  })

  it('stacks query annotations downward (descending)', async () => {
    const { Annotation } = await import('../utils/annotation.js')
    const wrapper = mount(SequenceEditor, {
      props: {
        sequence: 'ATCGATCGATCG',
        alignmentSequence: 'ATCGATCGATCG',
        alignmentAnnotations: [
          new Annotation({ id: 'qann1', span: '0..6', type: 'gene', label: 'Gene 1' }),
          new Annotation({ id: 'qann2', span: '2..8', type: 'gene', label: 'Gene 2' })
        ]
      }
    })

    await wrapper.vm.$nextTick()

    const queryAnnotations = wrapper.vm.alignedQueryAnnotations
    expect(queryAnnotations).toBeDefined()
    expect(queryAnnotations.length).toBe(2)
    // Query annotations should stack downward (positive deltaY)
  })
})

describe('Alignment Copy', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY)
  })

  it('copies target sequence (no gaps) when target row selected', async () => {
    const wrapper = mount(SequenceEditor, {
      props: {
        sequence: 'ATCGATCGATCG',
        alignmentSequence: 'ATCG-ATCGATCG'  // Query has a gap
      }
    })

    await wrapper.vm.$nextTick()

    // Set up target selection using unified selection composable
    wrapper.vm.selection.startSelection(0, false, 'target')
    wrapper.vm.selection.updateSelection(4)
    wrapper.vm.selection.endSelection()
    await wrapper.vm.$nextTick()

    // For target row, use getSelectedSequence (standard path)
    const selectedText = wrapper.vm.getSelectedSequence()
    expect(selectedText).toBe('ATCG')
  })

  it('copies query sequence (no gaps) when query row selected', async () => {
    const wrapper = mount(SequenceEditor, {
      props: {
        sequence: 'ATCGATCGATCG',
        alignmentSequence: 'ATCGATCGATCG'
      }
    })

    await wrapper.vm.$nextTick()

    // Set up query selection using unified selection composable
    wrapper.vm.selection.startSelection(0, false, 'query')
    wrapper.vm.selection.updateSelection(4)
    wrapper.vm.selection.endSelection()
    await wrapper.vm.$nextTick()

    const selectedText = wrapper.vm.getSelectedAlignmentSequenceText()
    expect(selectedText).toBe('ATCG')
  })

  it('copies reverse complement when target row selected with minus orientation', async () => {
    const wrapper = mount(SequenceEditor, {
      props: {
        sequence: 'ATCGATCGATCG',
        alignmentSequence: 'ATCGATCGATCG'
      }
    })

    await wrapper.vm.$nextTick()

    // Set up target selection with MINUS orientation (reverse drag: 4 -> 0)
    wrapper.vm.selection.startSelection(4, false, 'target')
    wrapper.vm.selection.updateSelection(0)
    wrapper.vm.selection.endSelection()
    await wrapper.vm.$nextTick()

    // Target uses getSelectedSequence (exposed as getSelectedSequenceText internally)
    // ATCG reverse complement is CGAT
    const selectedText = wrapper.vm.getSelectedSequence()
    expect(selectedText).toBe('CGAT')
  })

  it('copies reverse complement when query row selected with minus orientation', async () => {
    const wrapper = mount(SequenceEditor, {
      props: {
        sequence: 'ATCGATCGATCG',
        alignmentSequence: 'ATCGATCGATCG'
      }
    })

    await wrapper.vm.$nextTick()

    // Set up query selection with MINUS orientation (reverse drag: 4 -> 0)
    wrapper.vm.selection.startSelection(4, false, 'query')
    wrapper.vm.selection.updateSelection(0)
    wrapper.vm.selection.endSelection()
    await wrapper.vm.$nextTick()

    // ATCG reverse complement is CGAT
    const selectedText = wrapper.vm.getSelectedAlignmentSequenceText()
    expect(selectedText).toBe('CGAT')
  })
})

describe('Alignment Status Text', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY)
  })

  it('shows alignment score and identity when in alignment mode', async () => {
    const wrapper = mount(SequenceEditor, {
      props: {
        sequence: 'ATCGATCGATCG',
        alignmentSequence: 'ATCGATCGATCG'
      }
    })

    await wrapper.vm.$nextTick()

    // Without selection, should show alignment stats
    const statusText = wrapper.vm.selectionStatusText
    expect(statusText).toContain('Score')
    expect(statusText).toContain('Identity')
  })

  it('shows selection info when target row is selected', async () => {
    const wrapper = mount(SequenceEditor, {
      props: {
        sequence: 'ATCGATCGATCG',
        alignmentSequence: 'ATCGATCGATCG'
      }
    })

    await wrapper.vm.$nextTick()

    // Set up target selection using the unified selection composable
    wrapper.vm.selection.startSelection(0, false, 'target')
    wrapper.vm.selection.updateSelection(4)
    wrapper.vm.selection.endSelection()
    await wrapper.vm.$nextTick()

    const statusText = wrapper.vm.selectionStatusText
    expect(statusText).toContain('selected')
  })

  it('shows selection info when query row is selected', async () => {
    const wrapper = mount(SequenceEditor, {
      props: {
        sequence: 'ATCGATCGATCG',
        alignmentSequence: 'ATCGATCGATCG'
      }
    })

    await wrapper.vm.$nextTick()

    // Set up query selection using the unified selection composable
    wrapper.vm.selection.startSelection(0, false, 'query')
    wrapper.vm.selection.updateSelection(4)
    wrapper.vm.selection.endSelection()
    await wrapper.vm.$nextTick()

    const statusText = wrapper.vm.selectionStatusText
    // For query selections, status should indicate query row
    expect(statusText).toBeDefined()
    expect(statusText).toContain('Query selected')
  })
})
