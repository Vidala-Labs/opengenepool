import { describe, it, expect, beforeEach } from 'bun:test'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import CircularAnnotationLayer from './CircularAnnotationLayer.vue'
import { Annotation } from '../utils/annotation.js'
import { Span, Range } from '../utils/dna.js'
import { ezSpan } from '../../test/span-helpers.js'
import { useCircularGraphics } from '../composables/useCircularGraphics.js'
import { showAnnotations, __resetModuleState as resetAnnotationLayerState } from './AnnotationLayer.vue'

// Helper to create mock providers
function createMockProviders(options = {}) {
  const sequenceLength = ref(options.sequenceLength || 5000)
  const title = ref(options.title || 'Test')

  const editorState = {
    sequenceLength,
    title
  }

  // Create real circularGraphics with a mock editorState
  const circularGraphics = useCircularGraphics(editorState)

  const annotationColors = ref(null)

  return { editorState, circularGraphics, annotationColors }
}

// Helper to mount with providers
// Note: showAnnotations is now module-level state from AnnotationLayer, not injected
function mountWithProviders(props = {}, options = {}) {
  const { editorState, circularGraphics, annotationColors } = createMockProviders(options)

  // Set module-level showAnnotations state before mounting
  if (options.showAnnotations !== undefined) {
    showAnnotations.value = options.showAnnotations
  }

  return mount(CircularAnnotationLayer, {
    props: {
      annotations: props.annotations || [],
      showCaptions: props.showCaptions ?? true
    },
    global: {
      provide: {
        editorState,
        circularGraphics,
        annotationColors
      }
    }
  })
}

describe('CircularAnnotationLayer', () => {
  // Reset module-level state before each test
  beforeEach(() => {
    resetAnnotationLayerState()
  })

  describe('rendering', () => {
    it('renders empty when no annotations', () => {
      const wrapper = mountWithProviders({ annotations: [] })
      expect(wrapper.findAll('.annotation')).toHaveLength(0)
    })

    it('renders annotation arcs', () => {
      const annotation = new Annotation({
        id: 'ann1',
        caption: 'GFP',
        type: 'gene',
        span: ezSpan(100, 500)
      })

      const wrapper = mountWithProviders({ annotations: [annotation] })
      const annotations = wrapper.findAll('.annotation')
      expect(annotations).toHaveLength(1)
    })

    it('renders path for each annotation', () => {
      const annotation = new Annotation({
        id: 'ann1',
        caption: 'GFP',
        type: 'gene',
        span: ezSpan(100, 500)
      })

      const wrapper = mountWithProviders({ annotations: [annotation] })
      const paths = wrapper.findAll('.annotation-path')
      expect(paths).toHaveLength(1)
    })
  })

  describe('visibility', () => {
    it('hides when showAnnotations is false', () => {
      const annotation = new Annotation({
        id: 'ann1',
        type: 'gene',
        span: ezSpan(100, 500)
      })

      const wrapper = mountWithProviders(
        { annotations: [annotation] },
        { showAnnotations: false }
      )

      const layer = wrapper.find('.circular-annotation-layer')
      expect(layer.exists()).toBe(false)
    })

    it('shows when showAnnotations is true', () => {
      const annotation = new Annotation({
        id: 'ann1',
        type: 'gene',
        span: ezSpan(100, 500)
      })

      const wrapper = mountWithProviders(
        { annotations: [annotation] },
        { showAnnotations: true }
      )

      const layer = wrapper.find('.circular-annotation-layer')
      expect(layer.exists()).toBe(true)
    })

    it('does not render an annotation with ogp:hidden true', () => {
      const annotations = [
        new Annotation({ id: 'shown', type: 'gene', span: ezSpan(100, 500) }),
        new Annotation({ id: 'hidden', type: 'gene', span: ezSpan(600, 1000), attributes: { 'ogp:hidden': true } })
      ]
      const wrapper = mountWithProviders({ annotations })
      expect(wrapper.findAll('.annotation')).toHaveLength(1)
    })

    it('still renders an annotation with explicit ogp:hidden false', () => {
      const annotations = [
        new Annotation({ id: 'ann1', type: 'gene', span: ezSpan(100, 500), attributes: { 'ogp:hidden': false } })
      ]
      const wrapper = mountWithProviders({ annotations })
      expect(wrapper.findAll('.annotation')).toHaveLength(1)
    })

    it('reveals hidden annotations when showHiddenAnnotations is on', async () => {
      const { showHiddenAnnotations } = await import('./AnnotationLayer.vue')
      const annotations = [
        new Annotation({ id: 'hidden', type: 'gene', span: ezSpan(600, 1000), attributes: { 'ogp:hidden': true } })
      ]
      const wrapper = mountWithProviders({ annotations })
      expect(wrapper.findAll('.annotation')).toHaveLength(0)

      showHiddenAnnotations.value = true
      await wrapper.vm.$nextTick()
      expect(wrapper.findAll('.annotation')).toHaveLength(1)
    })
  })

  describe('row stacking', () => {
    it('stacks overlapping annotations on different rows', () => {
      const annotations = [
        new Annotation({ id: 'ann1', type: 'gene', span: ezSpan(100, 500) }),
        new Annotation({ id: 'ann2', type: 'promoter', span: ezSpan(200, 600) }) // overlaps
      ]

      const wrapper = mountWithProviders({ annotations })
      const annotationElements = wrapper.findAll('.annotation')
      expect(annotationElements).toHaveLength(2)
    })

    it('places non-overlapping annotations on same row', () => {
      const annotations = [
        new Annotation({ id: 'ann1', type: 'gene', span: ezSpan(100, 500) }),
        new Annotation({ id: 'ann2', type: 'promoter', span: ezSpan(1000, 1500) }) // no overlap
      ]

      const wrapper = mountWithProviders({ annotations })
      const annotationElements = wrapper.findAll('.annotation')
      expect(annotationElements).toHaveLength(2)
    })

    it('allows annotations to fit between gaps of multi-part annotations', () => {
      // Multi-part annotation with gap: 1..10 + 40..50
      // Single annotation in gap: 20..30
      // Both should render (detailed row assignment tested in useCircularAnnotations.test.js)
      const multiPartAnnotation = new Annotation({
        id: 'multi',
        type: 'gene',
        caption: 'Multi',
        span: new Span([new Range(1, 10), new Range(40, 50)])
      })

      const gapAnnotation = new Annotation({
        id: 'gap',
        type: 'gene',
        caption: 'Gap',
        span: ezSpan(20, 30)
      })

      const wrapper = mountWithProviders({ annotations: [multiPartAnnotation, gapAnnotation] })

      // Both annotations should render - the multi-part annotation renders 2 paths (one per range)
      // and the gap annotation renders 1 path
      const paths = wrapper.findAll('.annotation-path')
      expect(paths.length).toBe(3) // 2 from multi-part + 1 from gap
    })
  })

  describe('colors', () => {
    it('uses type-based colors', () => {
      const annotation = new Annotation({
        id: 'ann1',
        type: 'gene',
        span: ezSpan(100, 500)
      })

      const wrapper = mountWithProviders({ annotations: [annotation] })
      const path = wrapper.find('.annotation-path')

      // Gene color is #4CAF50
      expect(path.attributes('fill')).toBe('#4CAF50')
    })

    it('uses default color for unknown types', () => {
      const annotation = new Annotation({
        id: 'ann1',
        type: 'unknown_type',
        span: ezSpan(100, 500)
      })

      const wrapper = mountWithProviders({ annotations: [annotation] })
      const path = wrapper.find('.annotation-path')

      // Unknown type gets default color #607D8B
      expect(path.attributes('fill')).toBe('#607D8B')
    })
  })

  describe('captions', () => {
    it('shows caption when showCaptions is true and fits', () => {
      const annotation = new Annotation({
        id: 'ann1',
        caption: 'GFP',
        type: 'gene',
        span: ezSpan(0, 1000) // wide enough for caption
      })

      const wrapper = mountWithProviders({
        annotations: [annotation],
        showCaptions: true
      })

      const caption = wrapper.find('.annotation-caption')
      expect(caption.exists()).toBe(true)
    })

    it('hides caption when showCaptions is false', () => {
      const annotation = new Annotation({
        id: 'ann1',
        caption: 'GFP',
        type: 'gene',
        span: ezSpan(0, 1000)
      })

      const wrapper = mountWithProviders({
        annotations: [annotation],
        showCaptions: false
      })

      const caption = wrapper.find('.annotation-caption')
      expect(caption.exists()).toBe(false)
    })
  })

  describe('events', () => {
    it('emits click event with annotation data', async () => {
      const annotation = new Annotation({
        id: 'ann1',
        caption: 'GFP',
        type: 'gene',
        span: ezSpan(100, 500)
      })

      const wrapper = mountWithProviders({ annotations: [annotation] })
      const annotationEl = wrapper.find('.annotation')

      await annotationEl.trigger('click')

      expect(wrapper.emitted('click')).toBeTruthy()
      const emitted = wrapper.emitted('click')[0][0]
      expect(emitted.annotation.id).toBe('ann1')
    })

    it('emits contextmenu event', async () => {
      const annotation = new Annotation({
        id: 'ann1',
        span: ezSpan(100, 500)
      })

      const wrapper = mountWithProviders({ annotations: [annotation] })
      const annotationEl = wrapper.find('.annotation')

      await annotationEl.trigger('contextmenu')

      expect(wrapper.emitted('contextmenu')).toBeTruthy()
    })

    it('emits hover events on mouse enter/leave', async () => {
      const annotation = new Annotation({
        id: 'ann1',
        span: ezSpan(100, 500)
      })

      const wrapper = mountWithProviders({ annotations: [annotation] })
      const annotationEl = wrapper.find('.annotation')

      await annotationEl.trigger('mouseenter')
      expect(wrapper.emitted('hover')).toBeTruthy()
      expect(wrapper.emitted('hover')[0][0].entering).toBe(true)

      await annotationEl.trigger('mouseleave')
      expect(wrapper.emitted('hover')[1][0].entering).toBe(false)
    })
  })

  describe('text paths', () => {
    it('creates text path definitions for curved text', () => {
      const annotation = new Annotation({
        id: 'ann1',
        caption: 'GFP',
        type: 'gene',
        span: ezSpan(0, 1000)
      })

      const wrapper = mountWithProviders({ annotations: [annotation] })
      const defs = wrapper.find('defs')
      expect(defs.exists()).toBe(true)
    })
  })
})
