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

    return mount(CircularView, {
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
})
