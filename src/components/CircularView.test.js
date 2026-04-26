import { describe, it, expect } from 'bun:test'
import { mount } from '@vue/test-utils'
import { ref, computed } from 'vue'
import CircularView from './CircularView.vue'
import { useEditorState } from '../composables/useEditorState.js'
import { useGraphics } from '../composables/useGraphics.js'
import { useSelection } from '../composables/useSelection.js'
import { createEventBus } from '../composables/useEventBus.js'
import { Annotation } from '../utils/annotation.js'
import { Span } from '../utils/dna.js'

describe('CircularView', () => {
  function createWrapper(props = {}, options = {}) {
    const editorState = useEditorState()
    editorState.setSequence('A'.repeat(options.sequenceLength || 5000))
    editorState.setZoom(100)
    editorState.title.value = options.title || 'Test Plasmid'

    const graphics = useGraphics(editorState)
    graphics.setContainerSize(800, 600)

    const eventBus = createEventBus()
    const selection = useSelection(editorState, graphics, eventBus)

    const wrapper = mount(CircularView, {
      props: {
        annotations: props.annotations || [],
        showAnnotationCaptions: props.showAnnotationCaptions ?? true
      },
      global: {
        provide: {
          editorState,
          eventBus,
          selection,
          annotationColors: ref(null)
        }
      }
    })

    // Attach state for test access
    wrapper.editorState = editorState
    wrapper.selection = selection

    return wrapper
  }

  /**
   * Helper to mock the SVG getBoundingClientRect for coordinate tests.
   * Without this, getCoordsFromEvent returns null.
   */
  function mockSvgRect(wrapper) {
    const svg = wrapper.find('svg.circular-view').element
    if (svg) {
      // Mock getBoundingClientRect to return a 500x500 rect matching viewBox
      svg.getBoundingClientRect = () => ({
        left: 0,
        top: 0,
        width: 500,
        height: 500,
        right: 500,
        bottom: 500
      })
    }
  }

  /**
   * Helper to create mock mouse event coordinates for a position on the circle.
   * Returns client coordinates that, after transformation, will map to the sequence position.
   */
  function getPositionCoords(wrapper, position) {
    const cg = wrapper.vm.circularGraphics
    const seqLen = wrapper.editorState.sequenceLength.value
    const angle = (position / seqLen) * 2 * Math.PI - Math.PI / 2 // Position 0 at top
    const radius = cg.backboneRadius.value
    // With mocked rect (500x500 matching viewBox), client coords = SVG coords
    return {
      x: cg.centerX.value + radius * Math.cos(angle),
      y: cg.centerY.value + radius * Math.sin(angle)
    }
  }

  /**
   * Helper to get coordinates in the dead zone (center of circle).
   */
  function getDeadZoneCoords(wrapper) {
    const cg = wrapper.vm.circularGraphics
    return {
      x: cg.centerX.value,
      y: cg.centerY.value
    }
  }

  describe('rendering', () => {
    it('renders SVG with viewBox', () => {
      const wrapper = createWrapper()
      const svg = wrapper.find('svg.circular-view')
      expect(svg.exists()).toBe(true)
      // Vue test utils returns attribute names in lowercase
      const viewBox = svg.attributes('viewbox') || svg.attributes('viewBox')
      expect(viewBox).toBeTruthy()
    })

    it('renders backbone circle', () => {
      const wrapper = createWrapper()
      const backbone = wrapper.find('.backbone')
      expect(backbone.exists()).toBe(true)
    })

    it('renders tick marks', () => {
      const wrapper = createWrapper()
      const tickMarks = wrapper.find('.tick-marks')
      expect(tickMarks.exists()).toBe(true)
    })

    it('renders title in center', () => {
      const wrapper = createWrapper({}, { title: 'My Plasmid' })
      const title = wrapper.find('.center-title')
      expect(title.exists()).toBe(true)
      expect(title.text()).toBe('My Plasmid')
    })

    it('renders sequence length in center', () => {
      const wrapper = createWrapper({}, { sequenceLength: 5000 })
      const length = wrapper.find('.center-length')
      expect(length.exists()).toBe(true)
      expect(length.text()).toContain('5,000')
      expect(length.text()).toContain('bp')
    })
  })

  describe('annotations', () => {
    it('passes annotations to CircularAnnotationLayer', () => {
      const annotations = [
        new Annotation({
          id: 'ann1',
          caption: 'GFP',
          type: 'gene',
          span: Span.parse('100..500')
        })
      ]

      const wrapper = createWrapper({ annotations })
      // CircularAnnotationLayer should be rendered
      const annotationLayer = wrapper.findComponent({ name: 'CircularAnnotationLayer' })
      expect(annotationLayer.exists()).toBe(true)
    })
  })

  describe('selection layer', () => {
    it('renders CircularSelectionLayer', () => {
      const wrapper = createWrapper()
      const selectionLayer = wrapper.findComponent({ name: 'CircularSelectionLayer' })
      expect(selectionLayer.exists()).toBe(true)
    })
  })

  describe('tick marks', () => {
    it('generates tick marks based on sequence length', () => {
      const wrapper = createWrapper({}, { sequenceLength: 5000 })
      const ticks = wrapper.findAll('.tick')
      // 5000bp sequence should have ticks at 0, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500
      expect(ticks.length).toBeGreaterThan(0)
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
  })

  describe('coordinate system', () => {
    it('exposes circularGraphics via defineExpose', () => {
      const wrapper = createWrapper()
      expect(wrapper.vm.circularGraphics).toBeDefined()
      expect(wrapper.vm.circularGraphics.centerX).toBeDefined()
      expect(wrapper.vm.circularGraphics.centerY).toBeDefined()
      expect(wrapper.vm.circularGraphics.backboneRadius).toBeDefined()
    })
  })

  describe('zoom', () => {
    it('exposes isZooming state', () => {
      const wrapper = createWrapper()
      expect(wrapper.vm.isZooming).toBeDefined()
      expect(wrapper.vm.isZooming).toBe(false)
    })

    it('exposes showZoomTooltip state', () => {
      const wrapper = createWrapper()
      expect(wrapper.vm.showZoomTooltip).toBeDefined()
      expect(wrapper.vm.showZoomTooltip).toBe(false)
    })

    it('renders zoom tooltip when showZoomTooltip is true', async () => {
      const wrapper = createWrapper()
      // Tooltip should not be visible initially
      expect(wrapper.find('.zoom-tooltip').exists()).toBe(false)

      // Set showZoomTooltip to true
      wrapper.vm.showZoomTooltip = true
      await wrapper.vm.$nextTick()

      // Tooltip should be visible
      expect(wrapper.find('.zoom-tooltip').exists()).toBe(true)
    })
  })

  describe('mouse selection', () => {
    it('creates selection on click', async () => {
      const wrapper = createWrapper()
      mockSvgRect(wrapper)
      const svg = wrapper.find('svg.circular-view')
      const coords = getPositionCoords(wrapper, 500)

      await svg.trigger('mousedown', {
        button: 0,
        clientX: coords.x,
        clientY: coords.y,
        preventDefault: () => {}
      })

      await wrapper.vm.$nextTick()

      // Selection should be started
      expect(wrapper.selection.isSelected.value).toBe(true)
    })

    it('extends selection on drag', async () => {
      const wrapper = createWrapper()
      mockSvgRect(wrapper)
      const svg = wrapper.find('svg.circular-view')
      const startCoords = getPositionCoords(wrapper, 500)
      const endCoords = getPositionCoords(wrapper, 1000)

      // Start drag
      await svg.trigger('mousedown', {
        button: 0,
        clientX: startCoords.x,
        clientY: startCoords.y,
        preventDefault: () => {}
      })

      // Move (simulate via window event)
      window.dispatchEvent(new MouseEvent('mousemove', {
        clientX: endCoords.x,
        clientY: endCoords.y
      }))

      await wrapper.vm.$nextTick()

      // End drag
      window.dispatchEvent(new MouseEvent('mouseup'))
      await wrapper.vm.$nextTick()

      // Selection should cover a range (start and end may vary due to coordinate math)
      const domain = wrapper.selection.domain.value
      expect(domain.ranges.length).toBe(1)
      // Just verify selection exists - exact positions depend on coordinate mapping
      expect(wrapper.selection.isSelected.value).toBe(true)
    })

    it('clears selection on click in dead zone', async () => {
      const wrapper = createWrapper()
      mockSvgRect(wrapper)

      // First create a selection
      wrapper.selection.select('100..500')
      await wrapper.vm.$nextTick()
      expect(wrapper.selection.isSelected.value).toBe(true)

      // Click in dead zone (center)
      const svg = wrapper.find('svg.circular-view')
      const deadZone = getDeadZoneCoords(wrapper)

      await svg.trigger('mousedown', {
        button: 0,
        clientX: deadZone.x,
        clientY: deadZone.y,
        preventDefault: () => {}
      })

      await wrapper.vm.$nextTick()

      // Selection should be cleared
      expect(wrapper.selection.isSelected.value).toBe(false)
    })

    it('extends selection with shift-click', async () => {
      const wrapper = createWrapper()
      mockSvgRect(wrapper)
      const svg = wrapper.find('svg.circular-view')

      // First create a selection
      wrapper.selection.select('100..500')
      await wrapper.vm.$nextTick()

      const originalEnd = wrapper.selection.domain.value.ranges[0].end

      // Shift-click at a further position
      const extendCoords = getPositionCoords(wrapper, 1000)

      await svg.trigger('mousedown', {
        button: 0,
        clientX: extendCoords.x,
        clientY: extendCoords.y,
        shiftKey: true,
        preventDefault: () => {}
      })

      await wrapper.vm.$nextTick()

      // Selection should be extended
      const newRange = wrapper.selection.domain.value.ranges[0]
      expect(newRange.end).toBeGreaterThan(originalEnd)
    })

    it('adds new range with ctrl-click', async () => {
      const wrapper = createWrapper()
      mockSvgRect(wrapper)
      const svg = wrapper.find('svg.circular-view')

      // First create a selection
      wrapper.selection.select('100..500')
      await wrapper.vm.$nextTick()
      expect(wrapper.selection.domain.value.ranges.length).toBe(1)

      // Ctrl-click at a different position
      const newRangeCoords = getPositionCoords(wrapper, 2000)

      await svg.trigger('mousedown', {
        button: 0,
        clientX: newRangeCoords.x,
        clientY: newRangeCoords.y,
        ctrlKey: true,
        preventDefault: () => {}
      })

      await wrapper.vm.$nextTick()
      window.dispatchEvent(new MouseEvent('mouseup'))
      await wrapper.vm.$nextTick()

      // Should have a second range
      expect(wrapper.selection.domain.value.ranges.length).toBe(2)
    })
  })

  describe('origin dragging', () => {
    it('drags origin tick to rotate the view', async () => {
      const wrapper = createWrapper()
      mockSvgRect(wrapper)
      const originTick = wrapper.find('.origin-label')
      expect(originTick.exists()).toBe(true)

      const initialOffset = wrapper.vm.circularGraphics.originOffset.value

      // Start origin drag at top of circle (position 0)
      const cg = wrapper.vm.circularGraphics
      await originTick.trigger('mousedown', {
        button: 0,
        clientX: cg.centerX.value,  // Position 0 is at top
        clientY: cg.centerY.value - cg.backboneRadius.value,
        preventDefault: () => {},
        stopPropagation: () => {}
      })

      // Drag to new position (right side)
      window.dispatchEvent(new MouseEvent('mousemove', {
        clientX: cg.centerX.value + 100,
        clientY: cg.centerY.value
      }))

      await wrapper.vm.$nextTick()

      // Origin offset should have changed
      expect(wrapper.vm.circularGraphics.originOffset.value).not.toBe(initialOffset)

      // End drag
      window.dispatchEvent(new MouseEvent('mouseup'))
      await wrapper.vm.$nextTick()
    })

    it('only responds to left-click for origin drag', async () => {
      const wrapper = createWrapper()
      mockSvgRect(wrapper)
      const originTick = wrapper.find('.origin-label')

      const initialOffset = wrapper.vm.circularGraphics.originOffset.value

      // Right-click should not start origin drag
      await originTick.trigger('mousedown', {
        button: 2,  // Right button
        clientX: 250,
        clientY: 50,
        preventDefault: () => {},
        stopPropagation: () => {}
      })

      window.dispatchEvent(new MouseEvent('mousemove', {
        clientX: 350,
        clientY: 150
      }))

      await wrapper.vm.$nextTick()

      // Origin offset should NOT have changed
      expect(wrapper.vm.circularGraphics.originOffset.value).toBe(initialOffset)
    })
  })

  describe('zoom dragging', () => {
    it('starts zoom on right-click in dead zone', async () => {
      const wrapper = createWrapper()
      mockSvgRect(wrapper)
      const svg = wrapper.find('svg.circular-view')
      const deadZone = getDeadZoneCoords(wrapper)

      expect(wrapper.vm.isZooming).toBe(false)

      // Right-click in dead zone
      await svg.trigger('mousedown', {
        button: 2,
        clientX: deadZone.x,
        clientY: deadZone.y,
        preventDefault: () => {},
        stopPropagation: () => {}
      })

      await wrapper.vm.$nextTick()

      expect(wrapper.vm.isZooming).toBe(true)
      expect(wrapper.vm.showZoomTooltip).toBe(true)
    })

    it('adjusts zoom scale on drag', async () => {
      const wrapper = createWrapper()
      mockSvgRect(wrapper)
      const svg = wrapper.find('svg.circular-view')
      const deadZone = getDeadZoneCoords(wrapper)

      const initialZoom = wrapper.vm.circularGraphics.zoomScale.value

      // Right-click in dead zone to start zoom
      await svg.trigger('mousedown', {
        button: 2,
        clientX: deadZone.x,
        clientY: deadZone.y,
        preventDefault: () => {},
        stopPropagation: () => {}
      })

      // Drag up to zoom in
      window.dispatchEvent(new MouseEvent('mousemove', {
        clientX: deadZone.x,
        clientY: deadZone.y - 100  // Drag up
      }))

      await wrapper.vm.$nextTick()

      // Zoom should have increased
      expect(wrapper.vm.circularGraphics.zoomScale.value).toBeGreaterThan(initialZoom)

      // End drag
      window.dispatchEvent(new MouseEvent('mouseup'))
      await wrapper.vm.$nextTick()

      expect(wrapper.vm.isZooming).toBe(false)
    })

    it('drag down decreases zoom', async () => {
      const wrapper = createWrapper()
      mockSvgRect(wrapper)
      const svg = wrapper.find('svg.circular-view')
      const deadZone = getDeadZoneCoords(wrapper)

      // Set initial zoom to something > 1 so we can zoom out
      wrapper.vm.circularGraphics.setZoom(1.5)
      const initialZoom = wrapper.vm.circularGraphics.zoomScale.value

      // Right-click in dead zone to start zoom
      await svg.trigger('mousedown', {
        button: 2,
        clientX: deadZone.x,
        clientY: deadZone.y,
        preventDefault: () => {},
        stopPropagation: () => {}
      })

      // Drag down to zoom out
      window.dispatchEvent(new MouseEvent('mousemove', {
        clientX: deadZone.x,
        clientY: deadZone.y + 100  // Drag down
      }))

      await wrapper.vm.$nextTick()

      // Zoom should have decreased
      expect(wrapper.vm.circularGraphics.zoomScale.value).toBeLessThan(initialZoom)

      window.dispatchEvent(new MouseEvent('mouseup'))
    })
  })

  describe('context menu', () => {
    it('emits contextmenu event on right-click on backbone', async () => {
      const wrapper = createWrapper()
      mockSvgRect(wrapper)
      const svg = wrapper.find('svg.circular-view')
      const coords = getPositionCoords(wrapper, 500)

      await svg.trigger('contextmenu', {
        clientX: coords.x,
        clientY: coords.y,
        preventDefault: () => {}
      })

      expect(wrapper.emitted('contextmenu')).toBeTruthy()
      expect(wrapper.emitted('contextmenu')[0][0]).toHaveProperty('event')
      expect(wrapper.emitted('contextmenu')[0][0]).toHaveProperty('position')
    })

    it('does not emit contextmenu for dead zone (zoom trigger)', async () => {
      const wrapper = createWrapper()
      mockSvgRect(wrapper)
      const svg = wrapper.find('svg.circular-view')
      const deadZone = getDeadZoneCoords(wrapper)

      await svg.trigger('contextmenu', {
        clientX: deadZone.x,
        clientY: deadZone.y,
        preventDefault: () => {}
      })

      // Should not emit contextmenu in dead zone
      expect(wrapper.emitted('contextmenu')).toBeFalsy()
    })

    it('prevents contextmenu during zoom operations', async () => {
      const wrapper = createWrapper()
      mockSvgRect(wrapper)
      const svg = wrapper.find('svg.circular-view')

      // Start zoom first
      wrapper.vm.isZooming = true
      await wrapper.vm.$nextTick()

      const coords = getPositionCoords(wrapper, 500)

      await svg.trigger('contextmenu', {
        clientX: coords.x,
        clientY: coords.y,
        preventDefault: () => {}
      })

      // Should not emit contextmenu during zoom
      expect(wrapper.emitted('contextmenu')).toBeFalsy()
    })
  })

  describe('child component events', () => {
    it('forwards annotation-click events from CircularAnnotationLayer', async () => {
      const annotations = [
        new Annotation({
          id: 'ann1',
          caption: 'GFP',
          type: 'gene',
          span: Span.parse('100..500')
        })
      ]

      const wrapper = createWrapper({ annotations })
      const annotationLayer = wrapper.findComponent({ name: 'CircularAnnotationLayer' })

      annotationLayer.vm.$emit('click', { annotation: annotations[0] })
      await wrapper.vm.$nextTick()

      expect(wrapper.emitted('annotation-click')).toBeTruthy()
    })

    it('forwards annotation-contextmenu events', async () => {
      const annotations = [
        new Annotation({
          id: 'ann1',
          caption: 'Test',
          type: 'CDS',
          span: Span.parse('200..600')
        })
      ]

      const wrapper = createWrapper({ annotations })
      const annotationLayer = wrapper.findComponent({ name: 'CircularAnnotationLayer' })

      annotationLayer.vm.$emit('contextmenu', { annotation: annotations[0], event: {} })
      await wrapper.vm.$nextTick()

      expect(wrapper.emitted('annotation-contextmenu')).toBeTruthy()
    })

    it('forwards annotation-hover events', async () => {
      const annotations = [
        new Annotation({
          id: 'ann1',
          caption: 'Hover Test',
          type: 'promoter',
          span: Span.parse('300..700')
        })
      ]

      const wrapper = createWrapper({ annotations })
      const annotationLayer = wrapper.findComponent({ name: 'CircularAnnotationLayer' })

      annotationLayer.vm.$emit('hover', { annotation: annotations[0], entering: true })
      await wrapper.vm.$nextTick()

      expect(wrapper.emitted('annotation-hover')).toBeTruthy()
    })

    it('forwards select events from CircularSelectionLayer', async () => {
      const wrapper = createWrapper()
      const selectionLayer = wrapper.findComponent({ name: 'CircularSelectionLayer' })

      selectionLayer.vm.$emit('select', { ranges: [{ start: 100, end: 500 }] })
      await wrapper.vm.$nextTick()

      expect(wrapper.emitted('select')).toBeTruthy()
    })

    it('forwards contextmenu events from CircularSelectionLayer', async () => {
      const wrapper = createWrapper()
      const selectionLayer = wrapper.findComponent({ name: 'CircularSelectionLayer' })

      selectionLayer.vm.$emit('contextmenu', { event: {}, source: 'selection' })
      await wrapper.vm.$nextTick()

      expect(wrapper.emitted('contextmenu')).toBeTruthy()
    })

    it('forwards handle-contextmenu events from CircularSelectionLayer', async () => {
      const wrapper = createWrapper()
      const selectionLayer = wrapper.findComponent({ name: 'CircularSelectionLayer' })

      selectionLayer.vm.$emit('handle-contextmenu', {
        event: {},
        rangeIndex: 0,
        handleType: 'start'
      })
      await wrapper.vm.$nextTick()

      expect(wrapper.emitted('handle-contextmenu')).toBeTruthy()
    })
  })

  describe('origin crossing selection', () => {
    it('creates wrapped selection when dragging past origin', async () => {
      const wrapper = createWrapper({}, { sequenceLength: 2000 })
      mockSvgRect(wrapper)
      const svg = wrapper.find('svg.circular-view')

      // Start near origin (position ~1900)
      const startCoords = getPositionCoords(wrapper, 1900)

      await svg.trigger('mousedown', {
        button: 0,
        clientX: startCoords.x,
        clientY: startCoords.y,
        preventDefault: () => {}
      })

      await wrapper.vm.$nextTick()

      // Drag past origin to position ~100
      // This requires simulating a large jump in position
      const endCoords = getPositionCoords(wrapper, 100)

      window.dispatchEvent(new MouseEvent('mousemove', {
        clientX: endCoords.x,
        clientY: endCoords.y
      }))

      await wrapper.vm.$nextTick()

      // End selection
      window.dispatchEvent(new MouseEvent('mouseup'))
      await wrapper.vm.$nextTick()

      // Selection should exist
      expect(wrapper.selection.isSelected.value).toBe(true)
    })
  })

  describe('isInDeadZone', () => {
    it('returns true for center coordinates', () => {
      const wrapper = createWrapper()
      mockSvgRect(wrapper)
      const deadZone = getDeadZoneCoords(wrapper)
      // Since isInDeadZone is internal, we test it via click behavior
      // Click in center should clear selection, not start one
      wrapper.selection.select('100..500')

      const svg = wrapper.find('svg.circular-view')
      svg.trigger('mousedown', {
        button: 0,
        clientX: deadZone.x,
        clientY: deadZone.y,
        preventDefault: () => {}
      })

      // Dead zone click clears selection
      expect(wrapper.selection.isSelected.value).toBe(false)
    })

    it('returns false for backbone coordinates', async () => {
      const wrapper = createWrapper()
      mockSvgRect(wrapper)
      const backboneCoords = getPositionCoords(wrapper, 500)

      const svg = wrapper.find('svg.circular-view')
      await svg.trigger('mousedown', {
        button: 0,
        clientX: backboneCoords.x,
        clientY: backboneCoords.y,
        preventDefault: () => {}
      })

      // Backbone click starts selection
      expect(wrapper.selection.isSelected.value).toBe(true)
    })
  })
})
