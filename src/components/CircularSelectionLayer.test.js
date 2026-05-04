import { describe, it, expect } from 'bun:test'
import { mount } from '@vue/test-utils'
import { ref, computed } from 'vue'
import CircularSelectionLayer from './CircularSelectionLayer.vue'
import { useEditorState } from '../composables/useEditorState.js'
import { useGraphics } from '../composables/useGraphics.js'
import { useSelection } from '../composables/useSelection.js'
import { useCircularGraphics } from '../composables/useCircularGraphics.js'
import { createEventBus } from '../composables/useEventBus.js'
import { Range, Orientation } from '../utils/dna.js'

describe('CircularSelectionLayer', () => {
  function createWrapper(options = {}) {
    const editorState = useEditorState()
    editorState.setSequence('A'.repeat(options.sequenceLength || 5000))
    editorState.setZoom(100)

    const graphics = useGraphics(editorState)
    graphics.setContainerSize(800, 600)

    const circularGraphics = useCircularGraphics(editorState)

    const eventBus = createEventBus()
    const selection = useSelection(editorState, graphics, eventBus)

    return mount(CircularSelectionLayer, {
      props: {
        thickness: options.thickness || 20
      },
      global: {
        provide: {
          editorState,
          circularGraphics,
          selection
        }
      }
    })
  }

  describe('rendering', () => {
    it('renders empty when no selection', () => {
      const wrapper = createWrapper()
      const paths = wrapper.findAll('.selection')
      expect(paths).toHaveLength(0)
    })

    it('renders selection arc when selected', async () => {
      const wrapper = createWrapper()
      const selection = wrapper.vm.selection

      selection.select([new Range(100, 500)])
      await wrapper.vm.$nextTick()

      const paths = wrapper.findAll('.selection')
      expect(paths).toHaveLength(1)
    })

    it('renders cursor line for zero-width selection', async () => {
      const wrapper = createWrapper()
      const selection = wrapper.vm.selection

      selection.select([new Range(100, 100)])
      await wrapper.vm.$nextTick()

      const cursors = wrapper.findAll('.selection.cursor')
      expect(cursors).toHaveLength(1)
    })
  })

  describe('handles', () => {
    it('renders post-it tab handles for selection', async () => {
      const wrapper = createWrapper()
      const selection = wrapper.vm.selection

      selection.select([new Range(100, 500)])
      await wrapper.vm.$nextTick()

      const handles = wrapper.findAll('.sel_handle')
      // Should have start and end handles
      expect(handles.length).toBe(2)
    })

    it('renders only one handle for cursor', async () => {
      const wrapper = createWrapper()
      const selection = wrapper.vm.selection

      selection.select([new Range(100, 100)])
      await wrapper.vm.$nextTick()

      const handles = wrapper.findAll('.sel_handle')
      expect(handles.length).toBe(1)
    })
  })

  describe('orientation classes', () => {
    it('applies plus class for plus strand', async () => {
      const wrapper = createWrapper()
      const selection = wrapper.vm.selection

      selection.select([new Range(100, 500)]) // Plus strand by default
      await wrapper.vm.$nextTick()

      const path = wrapper.find('.selection.plus')
      expect(path.exists()).toBe(true)
    })

    it('applies minus class for minus strand', async () => {
      const wrapper = createWrapper()
      const selection = wrapper.vm.selection

      selection.select([new Range(100, 500, Orientation.MINUS)]) // Minus strand
      await wrapper.vm.$nextTick()

      const path = wrapper.find('.selection.minus')
      expect(path.exists()).toBe(true)
    })
  })

  describe('multi-range selection', () => {
    it('renders multiple arcs for multi-range selection', async () => {
      const wrapper = createWrapper()
      const selection = wrapper.vm.selection

      // Create multi-range selection
      selection.select([new Range(100, 500)])
      selection.startSelection(1000, true)
      selection.updateSelection(1500)
      selection.endSelection()

      await wrapper.vm.$nextTick()

      const paths = wrapper.findAll('.selection')
      expect(paths.length).toBe(2)
    })

    it('shows range index tags for multi-range', async () => {
      const wrapper = createWrapper()
      const selection = wrapper.vm.selection

      // Create multi-range selection
      selection.select([new Range(100, 500)])
      selection.startSelection(1000, true)
      selection.updateSelection(1500)
      selection.endSelection()

      await wrapper.vm.$nextTick()

      const tags = wrapper.findAll('.sel_tag')
      expect(tags.length).toBe(2)
    })
  })

  describe('events', () => {
    it('emits contextmenu event on path right-click', async () => {
      const wrapper = createWrapper()
      const selection = wrapper.vm.selection

      selection.select([new Range(100, 500)])
      await wrapper.vm.$nextTick()

      const path = wrapper.find('.selection')
      await path.trigger('contextmenu')

      expect(wrapper.emitted('contextmenu')).toBeTruthy()
    })
  })

  describe('origin crossing', () => {
    it('supports wrapped selections with two ranges', async () => {
      const wrapper = createWrapper({ sequenceLength: 5000 })
      const selection = wrapper.vm.selection

      // Create a wrapped selection: 4500..5000 + 0..500
      selection.select([new Range(4500, 5000)])
      selection.domain.value.ranges.push({
        start: 0,
        end: 500,
        orientation: 1
      })

      await wrapper.vm.$nextTick()

      const paths = wrapper.findAll('.selection')
      expect(paths.length).toBe(2)
    })
  })

  describe('merge bubbles', () => {
    it('shows merge bubble when ranges touch', async () => {
      const wrapper = createWrapper()
      const selection = wrapper.vm.selection

      // Create two touching ranges: 100..500 and 500..1000
      selection.select([new Range(100, 500)])
      selection.startSelection(500, true)
      selection.updateSelection(1000)
      selection.endSelection()

      await wrapper.vm.$nextTick()

      // Check that merge bubble is rendered
      const mergeBubbles = wrapper.findAll('.merge_bubble')
      expect(mergeBubbles.length).toBe(1)
    })

    it('does not show merge bubble for non-touching ranges', async () => {
      const wrapper = createWrapper()
      const selection = wrapper.vm.selection

      // Create two non-touching ranges: 100..500 and 600..1000
      selection.select([new Range(100, 500)])
      selection.startSelection(600, true)
      selection.updateSelection(1000)
      selection.endSelection()

      await wrapper.vm.$nextTick()

      // No merge bubble should be shown
      const mergeBubbles = wrapper.findAll('.merge_bubble')
      expect(mergeBubbles.length).toBe(0)
    })

    it('emits merge event when merge bubble is clicked', async () => {
      const wrapper = createWrapper()
      const selection = wrapper.vm.selection

      // Create two touching ranges
      selection.select([new Range(100, 500)])
      selection.startSelection(500, true)
      selection.updateSelection(1000)
      selection.endSelection()

      await wrapper.vm.$nextTick()

      const mergeBubble = wrapper.find('.merge_bubble')
      await mergeBubble.trigger('click')

      expect(wrapper.emitted('merge')).toBeTruthy()
      // After merge, should only have one range
      expect(selection.domain.value.ranges.length).toBe(1)
    })
  })

  describe('dragging existing multi-range selection across origin', () => {
    // When we have a multi-range selection and drag one range across the origin,
    // the new wrapped part should be inserted ADJACENT to its partner range,
    // not pushed to the end of the array.
    //
    // Example: Start with [[10..20], [30..50]]
    // Drag range 0's start across origin
    // Expected: [[1990..2000], [0..20], [30..50]] - wrapped parts stay adjacent
    // Buggy:    [[1990..2000], [30..50], [0..20]] - new part pushed to end

    it('should keep wrapped range parts adjacent when extending forward strand across origin', async () => {
      const wrapper = createWrapper({ sequenceLength: 2000 })
      const selection = wrapper.vm.selection
      const seqLen = 2000

      // Create two forward strand ranges: [10..20] (range 0) and [30..50] (range 1)
      selection.select([new Range(10, 20)])
      selection.domain.value.ranges.push({
        start: 30,
        end: 50,
        orientation: 1  // PLUS
      })

      await wrapper.vm.$nextTick()
      expect(selection.domain.value.ranges.length).toBe(2)

      const handles = wrapper.findAll('.sel_handle')
      const firstRangeStartHandle = handles.at(0)

      await firstRangeStartHandle.trigger('mousedown', {
        button: 0,
        preventDefault: () => {},
        stopPropagation: () => {}
      })

      expect(wrapper.vm.draggedHandle.rangeIndex).toBe(0)
      expect(wrapper.vm.draggedHandle.type).toBe('start')

      // Simulate the wrap: dragging position 10 counter-clockwise past origin to ~1990
      const ranges = selection.domain.value.ranges
      const rangeIndex = 0
      const anchor = 20
      const originalOrientation = 1 // PLUS
      const pos = 1990

      wrapper.vm.isWrapped = true
      wrapper.vm.wrapDirection = 'counterclockwise'

      const highRange = { start: pos, end: seqLen, orientation: originalOrientation }
      const lowRange = { start: 0, end: anchor, orientation: originalOrientation }

      const primaryRange = ranges[rangeIndex]
      primaryRange.start = highRange.start
      primaryRange.end = highRange.end
      primaryRange.orientation = originalOrientation

      // BUG: Current code does ranges.push(lowRange)
      ranges.splice(rangeIndex + 1, 0, lowRange)
      wrapper.vm.wrappedSecondRangeIndex = rangeIndex + 1

      await wrapper.vm.$nextTick()

      expect(ranges.length).toBe(3)

      // Expected: [[1990..2000], [0..20], [30..50]]
      // Buggy:    [[1990..2000], [30..50], [0..20]]
      expect(ranges[0].start).toBe(1990)
      expect(ranges[0].end).toBe(2000)
      expect(ranges[1].start).toBe(0)
      expect(ranges[1].end).toBe(20)
      expect(ranges[2].start).toBe(30)
      expect(ranges[2].end).toBe(50)

      window.dispatchEvent(new MouseEvent('mouseup'))
      await wrapper.vm.$nextTick()
    })

    it('should keep wrapped range parts adjacent when extending reverse strand across origin', async () => {
      const wrapper = createWrapper({ sequenceLength: 2000 })
      const selection = wrapper.vm.selection
      const seqLen = 2000

      // Create two reverse strand ranges: (10..20) (range 0) and (30..50) (range 1)
      selection.select([new Range(10, 20, Orientation.MINUS)])  // MINUS strand
      selection.domain.value.ranges.push({
        start: 30,
        end: 50,
        orientation: -1  // MINUS
      })

      await wrapper.vm.$nextTick()
      expect(selection.domain.value.ranges.length).toBe(2)

      const handles = wrapper.findAll('.sel_handle')
      const firstRangeStartHandle = handles.at(0)

      await firstRangeStartHandle.trigger('mousedown', {
        button: 0,
        preventDefault: () => {},
        stopPropagation: () => {}
      })

      // Simulate the wrap for MINUS strand
      const ranges = selection.domain.value.ranges
      const rangeIndex = 0
      const anchor = 20
      const originalOrientation = -1 // MINUS
      const pos = 1990

      wrapper.vm.isWrapped = true
      wrapper.vm.wrapDirection = 'counterclockwise'

      // For MINUS strand: low range first, high range second
      const highRange = { start: pos, end: seqLen, orientation: originalOrientation }
      const lowRange = { start: 0, end: anchor, orientation: originalOrientation }

      const primaryRange = ranges[rangeIndex]
      // For reverse: low range is primary
      primaryRange.start = lowRange.start
      primaryRange.end = lowRange.end
      primaryRange.orientation = originalOrientation

      // BUG: Current code does ranges.push(highRange)
      ranges.splice(rangeIndex + 1, 0, highRange)
      wrapper.vm.wrappedSecondRangeIndex = rangeIndex + 1

      await wrapper.vm.$nextTick()

      expect(ranges.length).toBe(3)

      // For MINUS strand wrapped across origin:
      // Expected: [[0..20], [1990..2000], [30..50]] - low part first for reverse
      // Buggy:    [[0..20], [30..50], [1990..2000]]
      expect(ranges[0].start).toBe(0)
      expect(ranges[0].end).toBe(20)
      expect(ranges[1].start).toBe(1990)
      expect(ranges[1].end).toBe(2000)
      expect(ranges[2].start).toBe(30)
      expect(ranges[2].end).toBe(50)

      window.dispatchEvent(new MouseEvent('mouseup'))
      await wrapper.vm.$nextTick()
    })

    it('should keep wrapped range parts adjacent with mixed orientation ranges', async () => {
      const wrapper = createWrapper({ sequenceLength: 2000 })
      const selection = wrapper.vm.selection
      const seqLen = 2000

      // Create mixed ranges: [10..20] PLUS (range 0), (30..50) MINUS (range 1), [60..80] PLUS (range 2)
      selection.select([new Range(10, 20)])
      selection.domain.value.ranges.push({
        start: 30,
        end: 50,
        orientation: -1  // MINUS
      })
      selection.domain.value.ranges.push({
        start: 60,
        end: 80,
        orientation: 1  // PLUS
      })

      await wrapper.vm.$nextTick()
      expect(selection.domain.value.ranges.length).toBe(3)

      const handles = wrapper.findAll('.sel_handle')
      const firstRangeStartHandle = handles.at(0)

      await firstRangeStartHandle.trigger('mousedown', {
        button: 0,
        preventDefault: () => {},
        stopPropagation: () => {}
      })

      // Simulate wrapping range 0 (PLUS) across origin
      const ranges = selection.domain.value.ranges
      const rangeIndex = 0
      const anchor = 20
      const originalOrientation = 1 // PLUS
      const pos = 1990

      wrapper.vm.isWrapped = true
      wrapper.vm.wrapDirection = 'counterclockwise'

      const highRange = { start: pos, end: seqLen, orientation: originalOrientation }
      const lowRange = { start: 0, end: anchor, orientation: originalOrientation }

      const primaryRange = ranges[rangeIndex]
      primaryRange.start = highRange.start
      primaryRange.end = highRange.end
      primaryRange.orientation = originalOrientation

      ranges.splice(rangeIndex + 1, 0, lowRange)
      wrapper.vm.wrappedSecondRangeIndex = rangeIndex + 1

      await wrapper.vm.$nextTick()

      expect(ranges.length).toBe(4)

      // Expected: [[1990..2000], [0..20], [30..50], [60..80]]
      // Buggy:    [[1990..2000], [30..50], [60..80], [0..20]]
      expect(ranges[0].start).toBe(1990)
      expect(ranges[0].end).toBe(2000)
      expect(ranges[0].orientation).toBe(1)
      expect(ranges[1].start).toBe(0)
      expect(ranges[1].end).toBe(20)
      expect(ranges[1].orientation).toBe(1)
      expect(ranges[2].start).toBe(30)
      expect(ranges[2].end).toBe(50)
      expect(ranges[2].orientation).toBe(-1)
      expect(ranges[3].start).toBe(60)
      expect(ranges[3].end).toBe(80)
      expect(ranges[3].orientation).toBe(1)

      window.dispatchEvent(new MouseEvent('mouseup'))
      await wrapper.vm.$nextTick()
    })

    it('should keep wrapped range parts adjacent when wrapping middle range', async () => {
      const wrapper = createWrapper({ sequenceLength: 2000 })
      const selection = wrapper.vm.selection
      const seqLen = 2000

      // Create three ranges: [100..200], [10..20], [300..400]
      // We'll wrap the middle one (range 1: [10..20])
      selection.select([new Range(100, 200)])
      selection.domain.value.ranges.push({
        start: 10,
        end: 20,
        orientation: 1
      })
      selection.domain.value.ranges.push({
        start: 300,
        end: 400,
        orientation: 1
      })

      await wrapper.vm.$nextTick()
      expect(selection.domain.value.ranges.length).toBe(3)

      const handles = wrapper.findAll('.sel_handle')
      // Range 1 handles are at indices 2 and 3
      const middleRangeStartHandle = handles.at(2)

      await middleRangeStartHandle.trigger('mousedown', {
        button: 0,
        preventDefault: () => {},
        stopPropagation: () => {}
      })

      expect(wrapper.vm.draggedHandle.rangeIndex).toBe(1)

      // Simulate wrapping range 1 across origin
      const ranges = selection.domain.value.ranges
      const rangeIndex = 1
      const anchor = 20
      const originalOrientation = 1
      const pos = 1990

      wrapper.vm.isWrapped = true
      wrapper.vm.wrapDirection = 'counterclockwise'

      const highRange = { start: pos, end: seqLen, orientation: originalOrientation }
      const lowRange = { start: 0, end: anchor, orientation: originalOrientation }

      const primaryRange = ranges[rangeIndex]
      primaryRange.start = highRange.start
      primaryRange.end = highRange.end
      primaryRange.orientation = originalOrientation

      ranges.splice(rangeIndex + 1, 0, lowRange)
      wrapper.vm.wrappedSecondRangeIndex = rangeIndex + 1

      await wrapper.vm.$nextTick()

      expect(ranges.length).toBe(4)

      // Expected: [[100..200], [1990..2000], [0..20], [300..400]]
      // Buggy:    [[100..200], [1990..2000], [300..400], [0..20]]
      expect(ranges[0].start).toBe(100)
      expect(ranges[0].end).toBe(200)
      expect(ranges[1].start).toBe(1990)
      expect(ranges[1].end).toBe(2000)
      expect(ranges[2].start).toBe(0)
      expect(ranges[2].end).toBe(20)
      expect(ranges[3].start).toBe(300)
      expect(ranges[3].end).toBe(400)

      window.dispatchEvent(new MouseEvent('mouseup'))
      await wrapper.vm.$nextTick()
    })

    it('should work correctly when wrapping the last range (no reorder needed)', async () => {
      const wrapper = createWrapper({ sequenceLength: 2000 })
      const selection = wrapper.vm.selection
      const seqLen = 2000

      // Create two ranges: [30..50], [10..20]
      // Wrapping the last range should work (this is the case that works by accident)
      selection.select([new Range(30, 50)])
      selection.domain.value.ranges.push({
        start: 10,
        end: 20,
        orientation: 1
      })

      await wrapper.vm.$nextTick()
      expect(selection.domain.value.ranges.length).toBe(2)

      const handles = wrapper.findAll('.sel_handle')
      // Range 1 handles are at indices 2 and 3
      const lastRangeStartHandle = handles.at(2)

      await lastRangeStartHandle.trigger('mousedown', {
        button: 0,
        preventDefault: () => {},
        stopPropagation: () => {}
      })

      expect(wrapper.vm.draggedHandle.rangeIndex).toBe(1)

      // Simulate wrapping range 1 across origin
      const ranges = selection.domain.value.ranges
      const rangeIndex = 1
      const anchor = 20
      const originalOrientation = 1
      const pos = 1990

      wrapper.vm.isWrapped = true
      wrapper.vm.wrapDirection = 'counterclockwise'

      const highRange = { start: pos, end: seqLen, orientation: originalOrientation }
      const lowRange = { start: 0, end: anchor, orientation: originalOrientation }

      const primaryRange = ranges[rangeIndex]
      primaryRange.start = highRange.start
      primaryRange.end = highRange.end
      primaryRange.orientation = originalOrientation

      ranges.splice(rangeIndex + 1, 0, lowRange)
      wrapper.vm.wrappedSecondRangeIndex = rangeIndex + 1

      await wrapper.vm.$nextTick()

      expect(ranges.length).toBe(3)

      // Expected (and current behavior): [[30..50], [1990..2000], [0..20]]
      // This case works because range 1 is already at the end
      expect(ranges[0].start).toBe(30)
      expect(ranges[0].end).toBe(50)
      expect(ranges[1].start).toBe(1990)
      expect(ranges[1].end).toBe(2000)
      expect(ranges[2].start).toBe(0)
      expect(ranges[2].end).toBe(20)

      window.dispatchEvent(new MouseEvent('mouseup'))
      await wrapper.vm.$nextTick()
    })
  })

  describe('origin crossing range order', () => {
    // When a selection wraps across the origin on a circular plasmid,
    // the range order must be correct for cut/paste to concatenate properly:
    // - FORWARD strand: high positions first (reads clockwise through origin)
    // - REVERSE strand: low positions first (reads counter-clockwise through origin)

    it('forward strand wrapped selection should have high range first, low range second', async () => {
      // For forward strand reading clockwise through origin,
      // the expected order for cut/paste is: 800..1000 then 0..200
      // This ensures the sequence concatenates in biological reading order
      const expectedRanges = [
        { start: 800, end: 1000, orientation: 1 },  // high range first (PLUS = 1)
        { start: 0, end: 200, orientation: 1 }      // low range second
      ]

      const [first, second] = expectedRanges
      expect(first.end).toBe(1000)  // First range ends at seqLen (high positions)
      expect(second.start).toBe(0)  // Second range starts at 0 (low positions)
    })

    it('reverse strand wrapped selection should have low range first, high range second', async () => {
      // For reverse strand reading counter-clockwise through origin,
      // the expected order for cut/paste is: 0..200 then 800..1000
      // This ensures the sequence concatenates in biological reading order for minus strand
      const expectedRanges = [
        { start: 0, end: 200, orientation: -1 },    // low range first (MINUS = -1)
        { start: 800, end: 1000, orientation: -1 }  // high range second
      ]

      const [first, second] = expectedRanges
      expect(first.start).toBe(0)    // First range starts at 0 (low positions)
      expect(second.end).toBe(1000)  // Second range ends at seqLen (high positions)
    })
  })
})
