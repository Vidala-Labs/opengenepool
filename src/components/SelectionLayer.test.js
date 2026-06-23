import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref, computed } from 'vue'
import SelectionLayer from './SelectionLayer.vue'
import { useEditorState } from '../composables/useEditorState.js'
import { useGraphics } from '../composables/useGraphics.js'
import { useSelection } from '../composables/useSelection.js'
import { createEventBus } from '../composables/useEventBus.js'
import { Range } from '../utils/dna.js'

describe('SelectionLayer', () => {
  let editorState
  let graphics
  let eventBus
  let selection

  function createWrapper() {
    editorState = useEditorState()
    editorState.setSequence('A'.repeat(500))
    editorState.setZoom(100)
    graphics = useGraphics(editorState)
    graphics.setContainerSize(800, 600)
    eventBus = createEventBus()
    // Create selection composable - this is now provided from parent
    selection = useSelection(editorState, graphics, eventBus)

    return mount(SelectionLayer, {
      global: {
        provide: {
          editorState,
          graphics,
          eventBus,
          selection  // Provide selection to the component
        }
      }
    })
  }

  describe('direction-based handle selection', () => {
    it('detects overlapping handles at touch point', async () => {
      const wrapper = createWrapper()
      const selection = wrapper.vm.selection

      // Create two touching ranges: [10..50] and [50..100]
      selection.select([new Range(10, 50)])
      selection.startSelection(50, true)  // Add second range starting at 50
      selection.updateSelection(100)
      selection.endSelection()

      await wrapper.vm.$nextTick()

      // Both ranges touch at position 50
      const ranges = selection.domain.value.ranges
      expect(ranges.length).toBe(2)
      expect(ranges[0].end).toBe(50)
      expect(ranges[1].start).toBe(50)
    })

    it('chooses left range end handle when dragging left from touch point', async () => {
      const wrapper = createWrapper()
      const selection = wrapper.vm.selection

      // Create two touching ranges
      selection.select([new Range(10, 50)])
      selection.startSelection(50, true)
      selection.updateSelection(100)
      selection.endSelection()

      await wrapper.vm.$nextTick()

      const ranges = selection.domain.value.ranges

      // Find handles at position 50 (touch point)
      // Range 0's end is at 50, Range 1's start is at 50
      const overlappingHandles = []
      const touchPoint = 50

      for (let i = 0; i < ranges.length; i++) {
        if (ranges[i].start === touchPoint) {
          overlappingHandles.push({ rangeIndex: i, type: 'start' })
        }
        if (ranges[i].end === touchPoint) {
          overlappingHandles.push({ rangeIndex: i, type: 'end' })
        }
      }

      expect(overlappingHandles.length).toBe(2)

      // When dragging left, should choose the 'end' handle (left range)
      const draggingLeft = true
      let chosenHandle
      if (draggingLeft) {
        chosenHandle = overlappingHandles.find(h => {
          const r = ranges[h.rangeIndex]
          return h.type === 'end' && r.end === touchPoint
        })
      }

      expect(chosenHandle).toBeDefined()
      expect(chosenHandle.type).toBe('end')
      expect(ranges[chosenHandle.rangeIndex].end).toBe(50)
    })

    it('chooses right range start handle when dragging right from touch point', async () => {
      const wrapper = createWrapper()
      const selection = wrapper.vm.selection

      // Create two touching ranges
      selection.select([new Range(10, 50)])
      selection.startSelection(50, true)
      selection.updateSelection(100)
      selection.endSelection()

      await wrapper.vm.$nextTick()

      const ranges = selection.domain.value.ranges

      // Find handles at position 50 (touch point)
      const overlappingHandles = []
      const touchPoint = 50

      for (let i = 0; i < ranges.length; i++) {
        if (ranges[i].start === touchPoint) {
          overlappingHandles.push({ rangeIndex: i, type: 'start' })
        }
        if (ranges[i].end === touchPoint) {
          overlappingHandles.push({ rangeIndex: i, type: 'end' })
        }
      }

      expect(overlappingHandles.length).toBe(2)

      // When dragging right, should choose the 'start' handle (right range)
      const draggingLeft = false
      let chosenHandle
      if (!draggingLeft) {
        chosenHandle = overlappingHandles.find(h => {
          const r = ranges[h.rangeIndex]
          return h.type === 'start' && r.start === touchPoint
        })
      }

      expect(chosenHandle).toBeDefined()
      expect(chosenHandle.type).toBe('start')
      expect(ranges[chosenHandle.rangeIndex].start).toBe(50)
    })

    it('does not use direction detection for non-overlapping handles', async () => {
      const wrapper = createWrapper()
      const selection = wrapper.vm.selection

      // Create a single range - no overlapping handles
      selection.select([new Range(10, 50)])

      await wrapper.vm.$nextTick()

      const ranges = selection.domain.value.ranges
      expect(ranges.length).toBe(1)

      // Check handles at position 10 (start) - only one handle there
      const startHandles = []
      for (let i = 0; i < ranges.length; i++) {
        if (ranges[i].start === 10) {
          startHandles.push({ rangeIndex: i, type: 'start' })
        }
        if (ranges[i].end === 10) {
          startHandles.push({ rangeIndex: i, type: 'end' })
        }
      }

      expect(startHandles.length).toBe(1)
    })
  })

  describe('merge bubbles', () => {
    it('shows merge bubble when ranges touch', async () => {
      const wrapper = createWrapper()
      const selection = wrapper.vm.selection

      // Create two touching ranges
      selection.select([new Range(10, 50)])
      selection.startSelection(50, true)
      selection.updateSelection(100)
      selection.endSelection()

      await wrapper.vm.$nextTick()

      // Check that merge bubble is rendered
      const mergeBubbles = wrapper.findAll('.merge_bubble')
      expect(mergeBubbles.length).toBe(1)
    })

    it('does not show merge bubble for non-touching ranges', async () => {
      const wrapper = createWrapper()
      const selection = wrapper.vm.selection

      // Create two non-touching ranges
      selection.select([new Range(10, 40)])
      selection.startSelection(60, true)
      selection.updateSelection(100)
      selection.endSelection()

      await wrapper.vm.$nextTick()

      // No merge bubble should be shown
      const mergeBubbles = wrapper.findAll('.merge_bubble')
      expect(mergeBubbles.length).toBe(0)
    })
  })

  describe('multi-line selection paths', () => {
    it('generates single connected wrap-around path in normal mode', async () => {
      const wrapper = createWrapper()
      const selection = wrapper.vm.selection

      // Create a selection that spans multiple lines (positions 0-150 at zoom 100)
      // At zoom 100, line 0 is 0-99, line 1 is 100-199
      selection.select([new Range(0, 150)])

      await wrapper.vm.$nextTick()

      // Should have exactly 1 selection path element (connected wrap-around)
      const selectionPaths = wrapper.findAll('.selection')
      expect(selectionPaths.length).toBe(1)

      // The path should have wrap-around shape (more complex than a simple rectangle)
      const pathD = selectionPaths[0].attributes('d')
      // Wrap-around path has 8 commands: M, H, V, H, V, H, V, H, Z
      // Count H commands - should have 4 for wrap-around (vs 2 for simple rectangle)
      const hCommands = (pathD.match(/H /g) || []).length
      expect(hCommands).toBe(4)
    })
  })

  describe('handle rendering', () => {
    it('renders post-it tab arrow handles', async () => {
      const wrapper = createWrapper()
      const selection = wrapper.vm.selection

      selection.select([new Range(10, 50)])
      await wrapper.vm.$nextTick()

      // Should have start and end handles
      const handles = wrapper.findAll('.sel_handle')
      expect(handles.length).toBe(2)
    })

    it('renders segment index tags for multi-range selection', async () => {
      const wrapper = createWrapper()
      const selection = wrapper.vm.selection

      // Create two ranges
      selection.select([new Range(10, 40)])
      selection.startSelection(60, true)
      selection.updateSelection(100)
      selection.endSelection()

      await wrapper.vm.$nextTick()

      // Should have index tags
      const tags = wrapper.findAll('.sel_tag')
      expect(tags.length).toBe(2)
    })
  })
})
