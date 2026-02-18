import { describe, it, expect, beforeEach } from 'bun:test'
import { mount } from '@vue/test-utils'
import { ref, computed, provide } from 'vue'
import AnnotationLayer from './AnnotationLayer.vue'
import { Annotation } from '../utils/annotation.js'
import { Orientation } from '../utils/dna.js'

// Helper to create mock editorState and graphics
function createMockProviders(options = {}) {
  const zoomLevel = ref(options.zoomLevel || 100)
  const sequenceLength = ref(options.sequenceLength || 500)

  const editorState = {
    zoomLevel,
    sequenceLength,
    lineCount: computed(() => Math.ceil(sequenceLength.value / zoomLevel.value))
  }

  const graphics = {
    metrics: computed(() => ({
      lmargin: 60,
      charWidth: 8,
      lineHeight: 24,
      fullWidth: 800
    })),
    getLineY: (lineIndex) => lineIndex * 30,
    lineHeight: ref(24)
  }

  return { editorState, graphics }
}

// Helper to mount with providers
function mountWithProviders(props = {}, options = {}) {
  const { editorState, graphics } = createMockProviders(options)

  return mount(AnnotationLayer, {
    props,
    global: {
      provide: {
        editorState,
        graphics
      }
    }
  })
}

describe('AnnotationLayer', () => {
  describe('rendering', () => {
    it('renders empty when no annotations', () => {
      const wrapper = mountWithProviders({ annotations: [] })
      expect(wrapper.findAll('.annotation-fragment')).toHaveLength(0)
    })

    it('renders annotation fragments', () => {
      const annotation = new Annotation({
        id: 'ann1',
        caption: 'GFP',
        type: 'gene',
        span: '10..50'
      })

      const wrapper = mountWithProviders({ annotations: [annotation] })
      const fragments = wrapper.findAll('.annotation-fragment')
      expect(fragments).toHaveLength(1)
    })

    it('renders path for each fragment', () => {
      const annotation = new Annotation({
        id: 'ann1',
        caption: 'GFP',
        type: 'gene',
        span: '10..50'
      })

      const wrapper = mountWithProviders({ annotations: [annotation] })
      const paths = wrapper.findAll('.annotation-fragment path')
      expect(paths).toHaveLength(1)
    })

    it('positions fragments correctly on the x axis', () => {
      const annotation = new Annotation({
        id: 'ann1',
        caption: 'Test',
        type: 'gene',
        span: '20..40' // Fenced: start=20
      })

      const wrapper = mountWithProviders({ annotations: [annotation] })
      const path = wrapper.find('.annotation-fragment path')

      // x = lmargin(60) + start(20) * charWidth(8) = 60 + 160 = 220
      expect(path.attributes('d')).toContain('220')
    })

    it('calculates fragment width correctly', () => {
      const annotation = new Annotation({
        id: 'ann1',
        caption: 'Test',
        type: 'gene',
        span: '10..30' // Fenced: start=10, end=30
      })

      const wrapper = mountWithProviders({ annotations: [annotation] })
      const path = wrapper.find('.annotation-fragment path')

      // left = lmargin(60) + start(10) * charWidth(8) = 60 + 80 = 140
      // right = lmargin(60) + end(30) * charWidth(8) = 60 + 240 = 300
      expect(path.attributes('d')).toContain('140')
      expect(path.attributes('d')).toContain('300')
    })
  })

  describe('multi-line annotations', () => {
    it('creates fragments for each line spanned', () => {
      // Annotation spanning lines 0 and 1 at zoom 100
      const annotation = new Annotation({
        id: 'ann1',
        caption: 'Long Gene',
        type: 'gene',
        span: '80..170' // 80-99 on line 0, 0-69 on line 1
      })

      const wrapper = mountWithProviders({ annotations: [annotation] })
      const fragments = wrapper.findAll('.annotation-fragment')
      expect(fragments).toHaveLength(2)
    })
  })

  describe('positioning', () => {
    it('positions line with no annotations correctly (no group rendered)', () => {
      // No annotations means no line groups should be rendered
      const wrapper = mountWithProviders({ annotations: [] })
      const lineGroups = wrapper.findAll('.annotation-layer > g')
      expect(lineGroups).toHaveLength(0)
    })

    it('positions line with one annotation at correct Y', () => {
      const annotation = new Annotation({
        id: 'ann1',
        span: '10..50', // Fenced: start=10
        type: 'gene'
      })

      const wrapper = mountWithProviders({ annotations: [annotation] })

      // Line group should be at getLineY(0) = 0
      // Arrows draw upward from y=0 to y=-height, placing them above the sequence
      const lineGroup = wrapper.find('.annotation-layer > g')
      expect(lineGroup.attributes('transform')).toBe('translate(0, 0)')

      // Fragment should be positioned at correct X
      // x = lmargin(60) + start(10) * charWidth(8) = 60 + 80 = 140
      const path = wrapper.find('.annotation-fragment path')
      expect(path.attributes('d')).toContain('140')
    })

    it('positions two non-overlapping annotations on same line', () => {
      const annotations = [
        new Annotation({ id: 'ann1', span: '10..30', type: 'gene' }),     // Fenced: 10..30
        new Annotation({ id: 'ann2', span: '50..70', type: 'promoter' })  // Fenced: 50..70
      ]

      const wrapper = mountWithProviders({ annotations })
      const fragments = wrapper.findAll('.annotation-fragment')
      expect(fragments).toHaveLength(2)

      // Both should be on line 0 (single line group)
      const lineGroups = wrapper.findAll('.annotation-layer > g')
      expect(lineGroups).toHaveLength(1)

      // Check X positions (fenced coordinates):
      // ann1: left = 60 + 10*8 = 140, right = 60 + 30*8 = 300
      // ann2: left = 60 + 50*8 = 460, right = 60 + 70*8 = 620
      const paths = wrapper.findAll('.annotation-fragment path')
      expect(paths[0].attributes('d')).toContain('140')
      expect(paths[0].attributes('d')).toContain('300')
      expect(paths[1].attributes('d')).toContain('460')
      expect(paths[1].attributes('d')).toContain('620')
    })

    it('positions annotations across multiple lines correctly', () => {
      const annotations = [
        new Annotation({ id: 'ann1', span: '10..30', type: 'gene' }),      // line 0
        new Annotation({ id: 'ann2', span: '150..170', type: 'promoter' }) // line 1
      ]

      const wrapper = mountWithProviders({ annotations })

      // Should have 2 line groups (line 0 and line 1)
      const lineGroups = wrapper.findAll('.annotation-layer > g')
      expect(lineGroups).toHaveLength(2)

      // Line 0: getLineY(0) = 0*30 = 0
      // Line 1: getLineY(1) = 1*30 = 30
      expect(lineGroups[0].attributes('transform')).toBe('translate(0, 0)')
      expect(lineGroups[1].attributes('transform')).toBe('translate(0, 30)')
    })

    it('handles two lines with no annotations', () => {
      // Even with 200bp sequence (2 lines at zoom 100), no annotations = no line groups
      const wrapper = mountWithProviders({ annotations: [] }, { sequenceLength: 200 })
      const lineGroups = wrapper.findAll('.annotation-layer > g')
      expect(lineGroups).toHaveLength(0)
    })

    it('handles two lines with one annotation on each', () => {
      const annotations = [
        new Annotation({ id: 'ann1', span: '10..30', type: 'gene' }),      // line 0
        new Annotation({ id: 'ann2', span: '110..130', type: 'promoter' }) // line 1
      ]

      const wrapper = mountWithProviders({ annotations }, { sequenceLength: 200 })

      // Should have 2 line groups
      const lineGroups = wrapper.findAll('.annotation-layer > g')
      expect(lineGroups).toHaveLength(2)

      // Each line should have exactly 1 fragment
      const fragments = wrapper.findAll('.annotation-fragment')
      expect(fragments).toHaveLength(2)

      // Line 0 at Y=0, Line 1 at Y=30
      expect(lineGroups[0].attributes('transform')).toBe('translate(0, 0)')
      expect(lineGroups[1].attributes('transform')).toBe('translate(0, 30)')
    })

    it('handles two lines with annotation only on second line', () => {
      const annotations = [
        new Annotation({ id: 'ann1', span: '110..130', type: 'gene' }) // Fenced: line 1
      ]

      const wrapper = mountWithProviders({ annotations }, { sequenceLength: 200 })

      // Should have only 1 line group (for line 1)
      const lineGroups = wrapper.findAll('.annotation-layer > g')
      expect(lineGroups).toHaveLength(1)

      // Line 1 at Y=30 (getLineY(1) = 30)
      expect(lineGroups[0].attributes('transform')).toBe('translate(0, 30)')

      // Annotation X position: lmargin(60) + start(10) * charWidth(8) = 140
      // (fenced 110, position 110 is position 10 on line 1)
      const path = wrapper.find('.annotation-fragment path')
      expect(path.attributes('d')).toContain('140')
    })

    it('stacks overlapping annotations vertically', () => {
      const annotations = [
        new Annotation({ id: 'ann1', span: '10..50', type: 'gene' }),
        new Annotation({ id: 'ann2', span: '20..60', type: 'promoter' }) // overlaps with ann1
      ]

      const wrapper = mountWithProviders({ annotations })
      const fragments = wrapper.findAll('.annotation-fragment')
      expect(fragments).toHaveLength(2)

      // The two fragments should have different Y offsets due to collision detection
      // Extract transform attributes to check deltaY values
      const transforms = fragments.map(f => f.attributes('transform'))

      // Both should have translate transforms with deltaY
      // One should be at deltaY=0, the other pushed up (negative deltaY)
      expect(transforms[0]).not.toBe(transforms[1])
    })
  })

  describe('multiple annotations', () => {
    it('renders all annotations', () => {
      const annotations = [
        new Annotation({ id: 'ann1', span: '10..30', type: 'gene' }),
        new Annotation({ id: 'ann2', span: '40..60', type: 'promoter' }),
        new Annotation({ id: 'ann3', span: '70..90', type: 'terminator' })
      ]

      const wrapper = mountWithProviders({ annotations })
      const fragments = wrapper.findAll('.annotation-fragment')
      expect(fragments).toHaveLength(3)
    })
  })

  describe('captions', () => {
    it('shows caption text when showCaptions is true', () => {
      const annotation = new Annotation({
        id: 'ann1',
        caption: 'GFP',
        type: 'gene',
        span: '10..60' // wide enough for caption
      })

      const wrapper = mountWithProviders({
        annotations: [annotation],
        showCaptions: true
      })

      const text = wrapper.find('.annotation-caption')
      expect(text.exists()).toBe(true)
      expect(text.text()).toBe('GFP')
    })

    it('hides caption when showCaptions is false', () => {
      const annotation = new Annotation({
        id: 'ann1',
        caption: 'GFP',
        type: 'gene',
        span: '10..60'
      })

      const wrapper = mountWithProviders({
        annotations: [annotation],
        showCaptions: false
      })

      const text = wrapper.find('.annotation-caption')
      expect(text.exists()).toBe(false)
    })

    it('hides caption on narrow fragments', () => {
      const annotation = new Annotation({
        id: 'ann1',
        caption: 'GFP',
        type: 'gene',
        span: '10..13' // only 3 bases wide = 24px, too narrow
      })

      const wrapper = mountWithProviders({
        annotations: [annotation],
        showCaptions: true
      })

      const text = wrapper.find('.annotation-caption')
      expect(text.exists()).toBe(false)
    })
  })

  describe('arrows', () => {
    it('shows arrow for plus strand annotation at end', () => {
      const annotation = new Annotation({
        id: 'ann1',
        type: 'gene',
        span: '10..50'
      })

      const wrapper = mountWithProviders({ annotations: [annotation] })
      const path = wrapper.find('.annotation-fragment path')
      expect(path.exists()).toBe(true)
    })

    it('shows arrow for minus strand annotation at start', () => {
      const annotation = new Annotation({
        id: 'ann1',
        type: 'gene',
        span: '(10..50)' // minus strand
      })

      const wrapper = mountWithProviders({ annotations: [annotation] })
      const path = wrapper.find('.annotation-fragment path')
      expect(path.exists()).toBe(true)
    })
  })

  describe('colors', () => {
    it('uses type-based inline fill from persisted colors', () => {
      const annotation = new Annotation({
        id: 'ann1',
        type: 'gene',
        span: '10..50'
      })

      const wrapper = mountWithProviders({ annotations: [annotation] })
      const path = wrapper.find('.annotation-fragment path')

      // Gene color is #4CAF50 (from DEFAULT_COLORS in component)
      expect(path.attributes('fill')).toBe('#4CAF50')
    })

    it('uses default color for unknown types', () => {
      const annotation = new Annotation({
        id: 'ann1',
        type: 'unknown_type',
        span: '10..50'
      })

      const wrapper = mountWithProviders({ annotations: [annotation] })
      const path = wrapper.find('.annotation-fragment path')

      // Unknown type gets default color #607D8B
      expect(path.attributes('fill')).toBe('#607D8B')
    })
  })

  describe('events', () => {
    it('emits click event with annotation data', async () => {
      const annotation = new Annotation({
        id: 'ann1',
        caption: 'GFP',
        type: 'gene',
        span: '10..50'
      })

      const wrapper = mountWithProviders({ annotations: [annotation] })
      const fragment = wrapper.find('.annotation-fragment')

      await fragment.trigger('click')

      expect(wrapper.emitted('click')).toBeTruthy()
      const emitted = wrapper.emitted('click')[0][0]
      expect(emitted.annotation.id).toBe('ann1')
      expect(emitted.annotation.caption).toBe('GFP')
    })

    it('emits contextmenu event', async () => {
      const annotation = new Annotation({
        id: 'ann1',
        span: '10..50'
      })

      const wrapper = mountWithProviders({ annotations: [annotation] })
      const fragment = wrapper.find('.annotation-fragment')

      await fragment.trigger('contextmenu')

      expect(wrapper.emitted('contextmenu')).toBeTruthy()
    })

    it('emits hover events on mouse enter/leave', async () => {
      const annotation = new Annotation({
        id: 'ann1',
        span: '10..50'
      })

      const wrapper = mountWithProviders({ annotations: [annotation] })
      const fragment = wrapper.find('.annotation-fragment')

      await fragment.trigger('mouseenter')
      expect(wrapper.emitted('hover')).toBeTruthy()
      expect(wrapper.emitted('hover')[0][0].entering).toBe(true)

      await fragment.trigger('mouseleave')
      expect(wrapper.emitted('hover')[1][0].entering).toBe(false)
    })
  })

  describe('custom props', () => {
    it('positions annotations at line top so arrows extend above sequence', () => {
      const annotation = new Annotation({
        id: 'ann1',
        span: '10..50'
      })

      const wrapper = mountWithProviders({
        annotations: [annotation]
      })

      // Line 0 is at y=0, transform should be at getLineY(0) = 0
      // Arrows draw upward from y=0 to y=-height, placing them above the sequence
      const lineGroup = wrapper.find('.annotation-layer > g')
      expect(lineGroup.attributes('transform')).toBe('translate(0, 0)')
    })

    it('uses composable height for arrow paths', () => {
      const annotation = new Annotation({
        id: 'ann1',
        span: '10..50'
      })

      const wrapper = mountWithProviders({
        annotations: [annotation]
      })

      // Path coordinates include height values from composable (18px default)
      // The path uses negative y coordinates based on height:
      // halfHeight = 9, height = 18, arrowEdge = 2
      const path = wrapper.find('.annotation-fragment path')
      // Path should contain -9 (half height), -18 (full height), -16 (height-arrowEdge)
      expect(path.attributes('d')).toContain('-9')
      expect(path.attributes('d')).toContain('-18')
    })
  })

  describe('exposed methods', () => {
    it('exposes fragments computed', () => {
      const annotation = new Annotation({
        id: 'ann1',
        span: '10..50'
      })

      const wrapper = mountWithProviders({ annotations: [annotation] })
      expect(wrapper.vm.fragments).toHaveLength(1)
    })

    it('exposes fragmentsByLine computed', () => {
      const annotation = new Annotation({
        id: 'ann1',
        span: '10..50'
      })

      const wrapper = mountWithProviders({ annotations: [annotation] })
      expect(wrapper.vm.fragmentsByLine.get(0)).toHaveLength(1)
    })
  })

  describe('indefinite locations', () => {
    it('uses solid fill for definite annotations', () => {
      const annotation = new Annotation({
        id: 'ann1',
        type: 'gene',
        span: '10..50'
      })

      const wrapper = mountWithProviders({ annotations: [annotation] })
      const path = wrapper.find('.annotation-fragment path')
      expect(path.attributes('fill')).toBe('#4CAF50')
      expect(path.attributes('opacity')).toBe('0.7')
    })

    it('creates gradient for start indefinite annotation', () => {
      const annotation = new Annotation({
        id: 'ann1',
        type: 'gene',
        span: '<10..50'
      })

      const wrapper = mountWithProviders({ annotations: [annotation] })

      // Should have a gradient defined
      const gradient = wrapper.find('linearGradient')
      expect(gradient.exists()).toBe(true)

      // Path should reference the gradient
      const path = wrapper.find('.annotation-fragment path')
      expect(path.attributes('fill')).toContain('url(#grad-')
    })

    it('creates gradient for end indefinite annotation', () => {
      const annotation = new Annotation({
        id: 'ann1',
        type: 'gene',
        span: '10..>50'
      })

      const wrapper = mountWithProviders({ annotations: [annotation] })

      const gradient = wrapper.find('linearGradient')
      expect(gradient.exists()).toBe(true)

      const path = wrapper.find('.annotation-fragment path')
      expect(path.attributes('fill')).toContain('url(#grad-')
    })

    it('creates gradient for both ends indefinite', () => {
      const annotation = new Annotation({
        id: 'ann1',
        type: 'gene',
        span: '<10..>50'
      })

      const wrapper = mountWithProviders({ annotations: [annotation] })

      const gradient = wrapper.find('linearGradient')
      expect(gradient.exists()).toBe(true)

      // Gradient should have 4 stops for both-ends fade
      const stops = wrapper.findAll('linearGradient stop')
      expect(stops.length).toBe(4)
    })

    it('uses opacity 1 for indefinite annotations (gradient handles opacity)', () => {
      const annotation = new Annotation({
        id: 'ann1',
        type: 'gene',
        span: '<10..50'
      })

      const wrapper = mountWithProviders({ annotations: [annotation] })
      const path = wrapper.find('.annotation-fragment path')
      expect(path.attributes('opacity')).toBe('1')
    })

    it('gradient stops use annotation type color', () => {
      const annotation = new Annotation({
        id: 'ann1',
        type: 'gene',
        span: '<10..50'
      })

      const wrapper = mountWithProviders({ annotations: [annotation] })
      const stops = wrapper.findAll('linearGradient stop')

      // All stops should use the gene color
      for (const stop of stops) {
        expect(stop.attributes('stop-color')).toBe('#4CAF50')
      }
    })
  })
})
