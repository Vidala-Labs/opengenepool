import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import CircularSequenceLayer from './CircularSequenceLayer.vue'
import { useEditorState } from '../composables/useEditorState.js'
import { useGraphics } from '../composables/useGraphics.js'
import { useSelection } from '../composables/useSelection.js'
import { useCircularGraphics } from '../composables/useCircularGraphics.js'
import { createEventBus } from '../composables/useEventBus.js'
import { positionToAngle, polarToCartesian } from '../utils/circular.js'

describe('CircularSequenceLayer', () => {
  function createWrapper(options = {}) {
    const editorState = useEditorState()
    editorState.setSequence('A'.repeat(options.sequenceLength || 5000))
    editorState.setZoom(100)

    const graphics = useGraphics(editorState)
    graphics.setContainerSize(800, 600)

    const circularGraphics = useCircularGraphics(editorState)
    const eventBus = createEventBus()
    const selection = useSelection(editorState, graphics, eventBus)

    const wrapper = mount(CircularSequenceLayer, {
      props: {
        draggableOrigin: options.draggableOrigin ?? true
      },
      global: {
        provide: {
          editorState,
          circularGraphics,
          selection
        }
      }
    })

    // Attach for test access
    wrapper.editorState = editorState
    wrapper.circularGraphics = circularGraphics
    wrapper.selection = selection

    return wrapper
  }

  describe('rendering', () => {
    it('renders the component', () => {
      const wrapper = createWrapper()
      expect(wrapper.find('.circular-sequence-layer').exists()).toBe(true)
    })

    it('renders backbone path', () => {
      const wrapper = createWrapper()
      const backbone = wrapper.find('.backbone')
      expect(backbone.exists()).toBe(true)
      expect(backbone.attributes('d')).toBeTruthy()
    })

    it('renders tick marks group', () => {
      const wrapper = createWrapper()
      const tickMarks = wrapper.find('.tick-marks')
      expect(tickMarks.exists()).toBe(true)
    })

    it('renders tick lines', () => {
      const wrapper = createWrapper()
      const tickLines = wrapper.findAll('.tick-line')
      expect(tickLines.length).toBeGreaterThan(0)
    })

    it('renders tick labels', () => {
      const wrapper = createWrapper()
      const tickLabels = wrapper.findAll('.tick-label')
      expect(tickLabels.length).toBeGreaterThan(0)
    })

    it('renders origin tick with special class', () => {
      const wrapper = createWrapper()
      const originTick = wrapper.find('.origin-tick')
      expect(originTick.exists()).toBe(true)
    })

    it('renders origin line with special class', () => {
      const wrapper = createWrapper()
      const originLine = wrapper.find('.origin-line')
      expect(originLine.exists()).toBe(true)
    })

    it('renders origin label with special class when draggable', () => {
      const wrapper = createWrapper({ draggableOrigin: true })
      const originLabel = wrapper.find('.origin-label')
      expect(originLabel.exists()).toBe(true)
    })

    it('does not render origin-label class when not draggable', () => {
      const wrapper = createWrapper({ draggableOrigin: false })
      const originLabel = wrapper.find('.origin-label')
      expect(originLabel.exists()).toBe(false)
    })
  })

  describe('backbone path', () => {
    it('generates correct backbone path with center and radius', () => {
      const wrapper = createWrapper()
      const backbone = wrapper.find('.backbone')
      const d = backbone.attributes('d')

      // Should contain arc commands
      expect(d).toContain('M')
      expect(d).toContain('A')
    })

    it('updates backbone path when zoom changes', async () => {
      const wrapper = createWrapper()
      const initialPath = wrapper.find('.backbone').attributes('d')

      wrapper.circularGraphics.setZoom(1.5)
      await wrapper.vm.$nextTick()

      const newPath = wrapper.find('.backbone').attributes('d')
      expect(newPath).not.toBe(initialPath)
    })
  })

  describe('tick marks', () => {
    it('generates appropriate number of ticks based on sequence length', () => {
      // 5000bp sequence should have ticks at 0, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500
      const wrapper = createWrapper({ sequenceLength: 5000 })
      const ticks = wrapper.findAll('.tick')
      expect(ticks.length).toBe(10)
    })

    it('uses different intervals for longer sequences', () => {
      // 50000bp should use 5000bp intervals
      const wrapper = createWrapper({ sequenceLength: 50000 })
      const ticks = wrapper.findAll('.tick')
      expect(ticks.length).toBe(10) // 0, 5k, 10k, ..., 45k
    })

    it('formats tick labels with k suffix for thousands', () => {
      const wrapper = createWrapper({ sequenceLength: 5000 })
      const labels = wrapper.findAll('.tick-label')
      const labelTexts = labels.map(l => l.text())

      expect(labelTexts).toContain('0')
      expect(labelTexts.some(t => t.includes('k'))).toBe(true)
    })
  })

  describe('events', () => {
    it('emits contextmenu event on right-click', async () => {
      const wrapper = createWrapper()
      const backbone = wrapper.find('.backbone')

      await backbone.trigger('contextmenu', {
        preventDefault: () => {},
        clientX: 250,
        clientY: 250
      })

      expect(wrapper.emitted('contextmenu')).toBeTruthy()
    })

    it('emits origin-drag-start when origin label is clicked', async () => {
      const wrapper = createWrapper({ draggableOrigin: true })
      const originLabel = wrapper.find('.origin-label')

      await originLabel.trigger('mousedown', {
        button: 0,
        preventDefault: () => {},
        stopPropagation: () => {}
      })

      expect(wrapper.emitted('origin-drag-start')).toBeTruthy()
    })

    it('does not emit origin-drag-start when draggableOrigin is false', async () => {
      const wrapper = createWrapper({ draggableOrigin: false })
      // There should be no .origin-label element
      const originLabel = wrapper.find('.origin-label')
      expect(originLabel.exists()).toBe(false)
    })
  })

  describe('selection', () => {
    it('starts selection on backbone click', async () => {
      const wrapper = createWrapper()

      // Mock SVG for coordinate calculation
      const mockSvg = document.createElement('div')
      mockSvg.className = 'circular-view'
      mockSvg.getBoundingClientRect = () => ({
        left: 0, top: 0, width: 500, height: 500
      })
      document.body.appendChild(mockSvg)

      const backbone = wrapper.find('.backbone')

      // Click on backbone (not in dead zone)
      const cg = wrapper.circularGraphics
      const x = cg.centerX.value + cg.backboneRadius.value
      const y = cg.centerY.value

      await backbone.trigger('mousedown', {
        button: 0,
        clientX: x,
        clientY: y,
        preventDefault: () => {}
      })

      expect(wrapper.selection.isSelected.value).toBe(true)

      document.body.removeChild(mockSvg)
    })

    // A drag that starts on the backbone must keep tracking the cursor even while the
    // cursor is over the ANNOTATION RING (outside the backbone radius) — the circular
    // analogue of "off the sequence text, over annotation whitespace". mouseToPosition
    // is radius-independent (atan2 of the angle), so the position must follow the angle.
    it('keeps tracking while the cursor is over the annotation ring (off the backbone)', async () => {
      const wrapper = createWrapper({ sequenceLength: 360 })

      const mockSvg = document.createElement('div')
      mockSvg.className = 'circular-view'
      // 500x500 rect == viewBox, origin at (0,0), so client coords == SVG coords.
      mockSvg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 500, height: 500 })
      document.body.appendChild(mockSvg)

      const cg = wrapper.circularGraphics
      const seqLen = wrapper.editorState.sequenceLength.value
      const cx = cg.centerX.value
      const cy = cg.centerY.value
      const backboneR = cg.backboneRadius.value

      // Mousedown on the backbone at base 10's angle.
      const startBase = 10
      const startPt = polarToCartesian(cx, cy, backboneR, positionToAngle(startBase, seqLen))
      const backbone = wrapper.find('.backbone')
      await backbone.trigger('mousedown', { button: 0, clientX: startPt.x, clientY: startPt.y, preventDefault: () => {} })
      expect(wrapper.selection.isSelected.value).toBe(true)

      // Drag to base 90's angle, but at the ANNOTATION-RING radius (well outside the
      // backbone) — i.e. the cursor is over the annotation band, not the backbone.
      const moveBase = 90
      const ringR = backboneR + 40
      const movePt = polarToCartesian(cx, cy, ringR, positionToAngle(moveBase, seqLen))
      // The editor's own projection for that exact point (radius-independent):
      const projected = cg.mouseToPosition(movePt.x, movePt.y)

      window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: movePt.x, clientY: movePt.y }))
      await wrapper.vm.$nextTick()

      const range = wrapper.selection.domain.value.ranges[0]
      // Selection tracked the cursor's ANGLE even though the cursor was over the ring,
      // not the backbone — so its far edge reflects the projected position, not base 10.
      expect(range.end).toBe(projected)
      expect(projected).not.toBe(startBase) // moved; not frozen at the mousedown base

      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
      await wrapper.vm.$nextTick()

      document.body.removeChild(mockSvg)
    })
  })
})
