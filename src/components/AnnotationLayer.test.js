import { describe, it, expect, beforeEach, mock } from 'bun:test'
import { mount } from '@vue/test-utils'
import { ref, computed, nextTick } from 'vue'
import AnnotationLayer, { __resetModuleState, allAnnotationTypes } from './AnnotationLayer.vue'
import { __resetModuleState as resetTranslationState } from './TranslationLayer.vue'
import { Annotation } from '../utils/annotation.js'
import { Orientation, Span, Range } from '../utils/dna.js'
import { ezSpan } from '../../test/span-helpers.js'

const STORAGE_KEY = 'ogp-hidden-annotation-types'

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
  beforeEach(() => {
    __resetModuleState()
    resetTranslationState()
    localStorage.removeItem(STORAGE_KEY)
  })

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
        span: ezSpan(10, 50)
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
        span: ezSpan(10, 50)
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
        span: ezSpan(20, 40) // Fenced: start=20
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
        span: ezSpan(10, 30) // Fenced: start=10, end=30
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
        span: ezSpan(80, 170) // 80-99 on line 0, 0-69 on line 1
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
        span: ezSpan(10, 50), // Fenced: start=10
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
        new Annotation({ id: 'ann1', span: ezSpan(10, 30), type: 'gene' }),     // Fenced: 10..30
        new Annotation({ id: 'ann2', span: ezSpan(50, 70), type: 'promoter' })  // Fenced: 50..70
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
        new Annotation({ id: 'ann1', span: ezSpan(10, 30), type: 'gene' }),      // line 0
        new Annotation({ id: 'ann2', span: ezSpan(150, 170), type: 'promoter' }) // line 1
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
        new Annotation({ id: 'ann1', span: ezSpan(10, 30), type: 'gene' }),      // line 0
        new Annotation({ id: 'ann2', span: ezSpan(110, 130), type: 'promoter' }) // line 1
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
        new Annotation({ id: 'ann1', span: ezSpan(110, 130), type: 'gene' }) // Fenced: line 1
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
        new Annotation({ id: 'ann1', span: ezSpan(10, 50), type: 'gene' }),
        new Annotation({ id: 'ann2', span: ezSpan(20, 60), type: 'promoter' }) // overlaps with ann1
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
        new Annotation({ id: 'ann1', span: ezSpan(10, 30), type: 'gene' }),
        new Annotation({ id: 'ann2', span: ezSpan(40, 60), type: 'promoter' }),
        new Annotation({ id: 'ann3', span: ezSpan(70, 90), type: 'terminator' })
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
        span: ezSpan(10, 60) // wide enough for caption
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
        span: ezSpan(10, 60)
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
        span: ezSpan(10, 13) // only 3 bases wide = 24px, too narrow
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
        span: ezSpan(10, 50)
      })

      const wrapper = mountWithProviders({ annotations: [annotation] })
      const path = wrapper.find('.annotation-fragment path')
      expect(path.exists()).toBe(true)
    })

    it('shows arrow for minus strand annotation at start', () => {
      const annotation = new Annotation({
        id: 'ann1',
        type: 'gene',
        span: ezSpan(10, 50, Orientation.MINUS) // minus strand
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
        span: ezSpan(10, 50)
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
        span: ezSpan(10, 50)
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
        span: ezSpan(10, 50)
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
        span: ezSpan(10, 50)
      })

      const wrapper = mountWithProviders({ annotations: [annotation] })
      const fragment = wrapper.find('.annotation-fragment')

      await fragment.trigger('contextmenu')

      expect(wrapper.emitted('contextmenu')).toBeTruthy()
    })

    it('emits hover events on mouse enter/leave', async () => {
      const annotation = new Annotation({
        id: 'ann1',
        span: ezSpan(10, 50)
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
        span: ezSpan(10, 50)
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
        span: ezSpan(10, 50)
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
        span: ezSpan(10, 50)
      })

      const wrapper = mountWithProviders({ annotations: [annotation] })
      expect(wrapper.vm.fragments).toHaveLength(1)
    })

    it('exposes fragmentsByLine computed', () => {
      const annotation = new Annotation({
        id: 'ann1',
        span: ezSpan(10, 50)
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
        span: ezSpan(10, 50)
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
        span: ezSpan(10, 50, Orientation.PLUS, true, false)
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
        span: ezSpan(10, 50, Orientation.PLUS, false, true)
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
        span: ezSpan(10, 50, Orientation.PLUS, true, true)
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
        span: ezSpan(10, 50, Orientation.PLUS, true, false)
      })

      const wrapper = mountWithProviders({ annotations: [annotation] })
      const path = wrapper.find('.annotation-fragment path')
      expect(path.attributes('opacity')).toBe('1')
    })

    it('gradient stops use annotation type color', () => {
      const annotation = new Annotation({
        id: 'ann1',
        type: 'gene',
        span: ezSpan(10, 50, Orientation.PLUS, true, false)
      })

      const wrapper = mountWithProviders({ annotations: [annotation] })
      const stops = wrapper.findAll('linearGradient stop')

      // All stops should use the gene color
      for (const stop of stops) {
        expect(stop.attributes('stop-color')).toBe('#4CAF50')
      }
    })
  })

describe('coordination with TranslationLayer', () => {
    function createCdsAnnotation(id = 'cds1', span = ezSpan(0, 30)) {
      return new Annotation({ id, caption: 'Test CDS', type: 'CDS', span })
    }

    it('CDS annotation reserves extra space when translation is visible', async () => {
      const cds = createCdsAnnotation()
      await import('./TranslationLayer.vue')

      const wrapper = mountWithProviders({ annotations: [cds] }, { sequenceLength: 100 })
      const fragment = wrapper.find('.annotation-fragment')
      expect(fragment.exists()).toBe(true)

      const transform = fragment.attributes('transform')
      expect(transform).toContain('-18')
    })

    it('CDS annotation does NOT reserve extra space when translation is off', async () => {
      const cds = createCdsAnnotation()
      const { showTranslation } = await import('./TranslationLayer.vue')
      showTranslation.value = false

      const wrapper = mountWithProviders({ annotations: [cds] }, { sequenceLength: 100 })
      const fragment = wrapper.find('.annotation-fragment')
      expect(fragment.exists()).toBe(true)

      const transform = fragment.attributes('transform')
      expect(transform).toBe('translate(0, 0)')
    })

    it('CDS annotation does NOT reserve space when CDS type is hidden', async () => {
      const cds = createCdsAnnotation()
      const { hiddenTypes } = await import('./AnnotationLayer.vue')
      hiddenTypes.value = new Set(['CDS'])

      const wrapper = mountWithProviders({ annotations: [cds] }, { sequenceLength: 100 })
      expect(wrapper.findAll('.annotation-fragment')).toHaveLength(0)
    })

    it('non-CDS annotations are not affected by translation visibility', async () => {
      const gene = new Annotation({ id: 'gene1', caption: 'Test', type: 'gene', span: ezSpan(0, 30) })
      await import('./TranslationLayer.vue')

      const wrapper = mountWithProviders({ annotations: [gene] }, { sequenceLength: 100 })
      const fragment = wrapper.find('.annotation-fragment')
      expect(fragment.exists()).toBe(true)

      const transform = fragment.attributes('transform')
      expect(transform).toBe('translate(0, 0)')
    })
  })

  describe('configItems', () => {
    it('allAnnotationTypes updates reactively when second instance mounts', async () => {
      // This test verifies the Set reactivity fix:
      // When mutating a Set with .add(), Vue doesn't detect the change.
      // We must create a new Set to trigger reactivity.

      const { editorState, graphics } = createMockProviders()
      const globalConfig = { provide: { editorState, graphics } }

      // Mount first instance with 'CDS' type
      const wrapper1 = mount(AnnotationLayer, {
        props: {
          annotations: [new Annotation({ id: 'ann1', type: 'CDS', span: ezSpan(10, 50) })],
          mode: 'target'
        },
        global: globalConfig
      })
      await nextTick()

      // allAnnotationTypes should have CDS
      expect(allAnnotationTypes.value.has('CDS')).toBe(true)
      const sizeAfterFirst = allAnnotationTypes.value.size

      // Mount second instance with 'promoter' type (different type)
      const wrapper2 = mount(AnnotationLayer, {
        props: {
          annotations: [new Annotation({ id: 'ann2', type: 'promoter', span: ezSpan(60, 100) })],
          mode: 'query'
        },
        global: globalConfig
      })
      await nextTick()

      // BUG: With Set.add() mutation, Vue reactivity doesn't detect the change
      // allAnnotationTypes should now have BOTH CDS and promoter
      expect(allAnnotationTypes.value.has('CDS')).toBe(true)
      expect(allAnnotationTypes.value.has('promoter')).toBe(true)

      // The configItems from first instance should include both types
      // This is the actual bug: sortedAnnotationTypes (computed) doesn't update
      // because it depends on allAnnotationTypes which wasn't reactively updated
      const configItems = wrapper1.vm.configItems
      const typeFilter = configItems.find(item => item.type === 'type-filter')
      expect(typeFilter).toBeTruthy()
      expect(typeFilter.types).toContain('CDS')
      expect(typeFilter.types).toContain('promoter') // This fails without the fix!

      wrapper1.unmount()
      wrapper2.unmount()
    })

    it('includes type-filter when annotations exist (single instance)', async () => {
      const annotations = [
        new Annotation({ id: 'ann1', type: 'CDS', span: ezSpan(10, 50) }),
        new Annotation({ id: 'ann2', type: 'gene', span: ezSpan(60, 100) })
      ]

      const wrapper = mountWithProviders({ annotations })
      await nextTick()

      const configItems = wrapper.vm.configItems
      expect(configItems.length).toBe(3)
      expect(configItems[0].type).toBe('toggle')
      expect(configItems[0].label).toBe('Annotations')
      expect(configItems[1].type).toBe('type-filter')
      expect(configItems[1].types).toContain('CDS')
      expect(configItems[1].types).toContain('gene')
      expect(configItems[2].type).toBe('toggle')
      expect(configItems[2].label).toBe('Show hidden annotations')
    })

    it('includes type-filter when multiple instances exist (alignment mode)', async () => {
      // Simulate alignment mode: two AnnotationLayers mounted with same annotations
      const annotations = [
        new Annotation({ id: 'ann1', type: 'CDS', span: ezSpan(10, 50) }),
        new Annotation({ id: 'ann2', type: 'promoter', span: ezSpan(60, 100) })
      ]

      const { editorState, graphics } = createMockProviders()
      const globalConfig = {
        provide: { editorState, graphics }
      }

      // Mount first instance (target)
      const wrapper1 = mount(AnnotationLayer, {
        props: { annotations, mode: 'target' },
        global: globalConfig
      })

      // Mount second instance (query)
      const wrapper2 = mount(AnnotationLayer, {
        props: { annotations, mode: 'query' },
        global: globalConfig
      })

      await nextTick()

      // First instance should publish configItems with type-filter
      const configItems = wrapper1.vm.configItems
      expect(configItems.length).toBe(3)
      expect(configItems[0].type).toBe('toggle')
      expect(configItems[1].type).toBe('type-filter')
      expect(configItems[1].types).toContain('CDS')
      expect(configItems[1].types).toContain('promoter')
      expect(configItems[2].label).toBe('Show hidden annotations')

      // Second instance should return empty (only first publishes)
      expect(wrapper2.vm.configItems).toHaveLength(0)

      // Cleanup
      wrapper1.unmount()
      wrapper2.unmount()
    })

    it('includes a "Show hidden annotations" toggle', async () => {
      const annotations = [
        new Annotation({ id: 'ann1', type: 'CDS', span: ezSpan(10, 50) })
      ]
      const wrapper = mountWithProviders({ annotations })
      await nextTick()

      const toggle = wrapper.vm.configItems.find(
        item => item.type === 'toggle' && item.label === 'Show hidden annotations'
      )
      expect(toggle).toBeTruthy()
      expect(toggle.value).toBe(false)
    })
  })

  describe('ogp:hidden per-annotation visibility', () => {
    it('does not render an annotation with ogp:hidden true', () => {
      const annotations = [
        new Annotation({ id: 'shown', type: 'gene', span: ezSpan(10, 50) }),
        new Annotation({ id: 'hidden', type: 'gene', span: ezSpan(60, 100), attributes: { 'ogp:hidden': true } })
      ]
      const wrapper = mountWithProviders({ annotations })
      const fragments = wrapper.findAll('.annotation-fragment')
      expect(fragments).toHaveLength(1)
    })

    it('still renders an annotation with ogp:hidden false', () => {
      const annotations = [
        new Annotation({ id: 'ann1', type: 'gene', span: ezSpan(10, 50), attributes: { 'ogp:hidden': false } })
      ]
      const wrapper = mountWithProviders({ annotations })
      expect(wrapper.findAll('.annotation-fragment')).toHaveLength(1)
    })

    it('reveals hidden annotations when showHiddenAnnotations is on', async () => {
      const { showHiddenAnnotations } = await import('./AnnotationLayer.vue')
      const annotations = [
        new Annotation({ id: 'hidden', type: 'gene', span: ezSpan(60, 100), attributes: { 'ogp:hidden': true } })
      ]
      const wrapper = mountWithProviders({ annotations })
      expect(wrapper.findAll('.annotation-fragment')).toHaveLength(0)

      showHiddenAnnotations.value = true
      await nextTick()
      expect(wrapper.findAll('.annotation-fragment')).toHaveLength(1)
    })
  })

  describe('primer_bind line indicator', () => {
    it('draws vertical dotted line for forward primer with primer_bind', () => {
      // Forward primer from position 10-30 with primer_bind=5
      // The 3' end is at position 30, so line should be at position 30 - 5 = 25
      const annotation = new Annotation({
        id: 'primer1',
        caption: 'Test Primer',
        type: 'primer',
        span: ezSpan(10, 30, Orientation.PLUS),
        attributes: { primer_bind: 5 }
      })

      const wrapper = mountWithProviders({ annotations: [annotation] })
      const line = wrapper.find('.primer-bind-line')
      expect(line.exists()).toBe(true)

      // x position = lmargin(60) + (end - primer_bind)(25) * charWidth(8) = 60 + 200 = 260
      expect(line.attributes('x1')).toBe('260')
      expect(line.attributes('x2')).toBe('260')
      expect(line.attributes('stroke-dasharray')).toBeTruthy()
    })

    it('draws vertical dotted line for reverse primer with primer_bind', () => {
      // Reverse primer from position 10-30 with primer_bind=5
      // The 3' end is at position 10 (start), so line should be at position 10 + 5 = 15
      const annotation = new Annotation({
        id: 'primer1',
        caption: 'Test Primer',
        type: 'primer',
        span: ezSpan(10, 30, Orientation.MINUS),
        attributes: { primer_bind: 5 }
      })

      const wrapper = mountWithProviders({ annotations: [annotation] })
      const line = wrapper.find('.primer-bind-line')
      expect(line.exists()).toBe(true)

      // x position = lmargin(60) + (start + primer_bind)(15) * charWidth(8) = 60 + 120 = 180
      expect(line.attributes('x1')).toBe('180')
      expect(line.attributes('x2')).toBe('180')
    })

    it('does not draw line for primer without primer_bind attribute', () => {
      const annotation = new Annotation({
        id: 'primer1',
        caption: 'Test Primer',
        type: 'primer',
        span: ezSpan(10, 30, Orientation.PLUS)
      })

      const wrapper = mountWithProviders({ annotations: [annotation] })
      expect(wrapper.find('.primer-bind-line').exists()).toBe(false)
    })

    it('does not draw line for non-primer type even with primer_bind attribute', () => {
      const annotation = new Annotation({
        id: 'gene1',
        caption: 'Test Gene',
        type: 'gene',
        span: ezSpan(10, 30, Orientation.PLUS),
        attributes: { primer_bind: 5 }
      })

      const wrapper = mountWithProviders({ annotations: [annotation] })
      expect(wrapper.find('.primer-bind-line').exists()).toBe(false)
    })

    it('draws line only on correct fragment for multi-line forward primer', () => {
      // Forward primer from 80-150 (spans lines at zoom=100)
      // primer_bind=20, so line at position 130 (on line 1, not line 0)
      const annotation = new Annotation({
        id: 'primer1',
        caption: 'Multi-line Primer',
        type: 'primer',
        span: ezSpan(80, 150, Orientation.PLUS),
        attributes: { primer_bind: 20 }
      })

      const wrapper = mountWithProviders({ annotations: [annotation] })
      const lines = wrapper.findAll('.primer-bind-line')

      // Should only have ONE line, not two
      expect(lines).toHaveLength(1)

      // Line should be at position 130: lmargin(60) + 30*charWidth(8) = 300
      // (position 130 is at offset 30 on line 1)
      expect(lines[0].attributes('x1')).toBe('300')
    })

    it('draws line only on correct fragment for multi-line reverse primer', () => {
      // Reverse primer from 80-150 (spans lines at zoom=100)
      // primer_bind=15, so line at position 95 (on line 0)
      const annotation = new Annotation({
        id: 'primer1',
        caption: 'Multi-line Primer',
        type: 'primer',
        span: ezSpan(80, 150, Orientation.MINUS),
        attributes: { primer_bind: 15 }
      })

      const wrapper = mountWithProviders({ annotations: [annotation] })
      const lines = wrapper.findAll('.primer-bind-line')

      // Should only have ONE line
      expect(lines).toHaveLength(1)

      // Line should be at position 95: lmargin(60) + 95*charWidth(8) = 820
      expect(lines[0].attributes('x1')).toBe('820')
    })
  })

  describe('clip primer binding context menu', () => {
    // Helper to mount with selection provider
    function mountWithSelection(props = {}, selectionState = {}, options = {}) {
      const { editorState, graphics } = createMockProviders(options)

      const selection = {
        isSelected: ref(selectionState.isSelected ?? false),
        domain: ref(selectionState.domain ?? null)
      }

      return mount(AnnotationLayer, {
        props,
        global: {
          provide: {
            editorState,
            graphics,
            selection
          }
        }
      })
    }

    // Helper to create selection domain matching a range
    function selectionDomainFor(start, end) {
      return { ranges: [new Range(start, end, Orientation.NONE)] }
    }

    describe('positive tests', () => {
      it('shows clip option for forward primer when annotation end is inside selection', () => {
        // Primer spans 10-30 (forward), selection is 10-30
        // Gene annotation spans 5-20, so its END (20) is inside selection
        const primer = new Annotation({
          id: 'primer1',
          caption: 'FWD Primer',
          type: 'primer',
          span: ezSpan(10, 30, Orientation.PLUS)
        })
        const gene = new Annotation({
          id: 'gene1',
          caption: 'Gene',
          type: 'gene',
          span: ezSpan(5, 20, Orientation.PLUS)
        })

        const wrapper = mountWithSelection(
          { annotations: [primer, gene] },
          { isSelected: true, domain: selectionDomainFor(10, 30) }
        )

        const items = wrapper.vm.getMenuItemsForElement({
          layer: 'annotation',
          annotationId: 'gene1',
          rangeIndex: '0'
        })

        const clipItem = items.find(i => i.label.includes('Clip primer binding'))
        expect(clipItem).toBeTruthy()
        expect(clipItem.label).toBe('Clip primer binding of FWD Primer')
      })

      it('shows clip option for reverse primer when annotation start is inside selection', () => {
        // Primer spans 10-30 (reverse), selection is 10-30
        // Gene annotation spans 15-35, so its START (15) is inside selection
        const primer = new Annotation({
          id: 'primer1',
          caption: 'REV Primer',
          type: 'primer',
          span: ezSpan(10, 30, Orientation.MINUS)
        })
        const gene = new Annotation({
          id: 'gene1',
          caption: 'Gene',
          type: 'gene',
          span: ezSpan(15, 35, Orientation.PLUS)
        })

        const wrapper = mountWithSelection(
          { annotations: [primer, gene] },
          { isSelected: true, domain: selectionDomainFor(10, 30) }
        )

        const items = wrapper.vm.getMenuItemsForElement({
          layer: 'annotation',
          annotationId: 'gene1',
          rangeIndex: '0'
        })

        const clipItem = items.find(i => i.label.includes('Clip primer binding'))
        expect(clipItem).toBeTruthy()
        expect(clipItem.label).toBe('Clip primer binding of REV Primer')
      })

      it('shows multiple menu items when multiple primers match selection', () => {
        // Two primers both span 10-30
        // Annotation spans 5-20, its END (20) is inside selection
        const primer1 = new Annotation({
          id: 'primer1',
          caption: 'Primer A',
          type: 'primer',
          span: ezSpan(10, 30, Orientation.PLUS)
        })
        const primer2 = new Annotation({
          id: 'primer2',
          caption: 'Primer B',
          type: 'primer',
          span: ezSpan(10, 30, Orientation.MINUS)
        })
        const gene = new Annotation({
          id: 'gene1',
          caption: 'Gene',
          type: 'gene',
          span: ezSpan(5, 20, Orientation.PLUS)
        })

        const wrapper = mountWithSelection(
          { annotations: [primer1, primer2, gene] },
          { isSelected: true, domain: selectionDomainFor(10, 30) }
        )

        const items = wrapper.vm.getMenuItemsForElement({
          layer: 'annotation',
          annotationId: 'gene1',
          rangeIndex: '0'
        })

        const clipItems = items.filter(i => i.label.includes('Clip primer binding'))
        expect(clipItems).toHaveLength(2)
        expect(clipItems.map(i => i.label)).toContain('Clip primer binding of Primer A')
        expect(clipItems.map(i => i.label)).toContain('Clip primer binding of Primer B')
      })
    })

    describe('negative tests', () => {
      it('no option when no selection exists', () => {
        const primer = new Annotation({
          id: 'primer1',
          caption: 'FWD Primer',
          type: 'primer',
          span: ezSpan(10, 30, Orientation.PLUS)
        })
        const gene = new Annotation({
          id: 'gene1',
          caption: 'Gene',
          type: 'gene',
          span: ezSpan(5, 20, Orientation.PLUS)
        })

        const wrapper = mountWithSelection(
          { annotations: [primer, gene] },
          { isSelected: false, domain: null }
        )

        const items = wrapper.vm.getMenuItemsForElement({
          layer: 'annotation',
          annotationId: 'gene1',
          rangeIndex: '0'
        })

        const clipItem = items.find(i => i.label.includes('Clip primer binding'))
        expect(clipItem).toBeUndefined()
      })

      it('no option when selection does not exactly match primer span', () => {
        // Primer spans 10-30, selection is 10-25 (partial match)
        const primer = new Annotation({
          id: 'primer1',
          caption: 'FWD Primer',
          type: 'primer',
          span: ezSpan(10, 30, Orientation.PLUS)
        })
        const gene = new Annotation({
          id: 'gene1',
          caption: 'Gene',
          type: 'gene',
          span: ezSpan(5, 20, Orientation.PLUS)
        })

        const wrapper = mountWithSelection(
          { annotations: [primer, gene] },
          { isSelected: true, domain: selectionDomainFor(10, 25) }
        )

        const items = wrapper.vm.getMenuItemsForElement({
          layer: 'annotation',
          annotationId: 'gene1',
          rangeIndex: '0'
        })

        const clipItem = items.find(i => i.label.includes('Clip primer binding'))
        expect(clipItem).toBeUndefined()
      })

      it('no option when primer is multi-segment', () => {
        // Multi-range primer (two segments)
        const primer = new Annotation({
          id: 'primer1',
          caption: 'Multi Primer',
          type: 'primer',
          span: new Span([
            new Range(10, 20, Orientation.PLUS),
            new Range(25, 35, Orientation.PLUS)
          ])
        })
        const gene = new Annotation({
          id: 'gene1',
          caption: 'Gene',
          type: 'gene',
          span: ezSpan(5, 15, Orientation.PLUS)
        })

        // Selection matches first segment only
        const wrapper = mountWithSelection(
          { annotations: [primer, gene] },
          { isSelected: true, domain: selectionDomainFor(10, 20) }
        )

        const items = wrapper.vm.getMenuItemsForElement({
          layer: 'annotation',
          annotationId: 'gene1',
          rangeIndex: '0'
        })

        const clipItem = items.find(i => i.label.includes('Clip primer binding'))
        expect(clipItem).toBeUndefined()
      })

      it('no option when primer already has primer_bind set', () => {
        const primer = new Annotation({
          id: 'primer1',
          caption: 'FWD Primer',
          type: 'primer',
          span: ezSpan(10, 30, Orientation.PLUS),
          attributes: { primer_bind: 5 }
        })
        const gene = new Annotation({
          id: 'gene1',
          caption: 'Gene',
          type: 'gene',
          span: ezSpan(5, 20, Orientation.PLUS)
        })

        const wrapper = mountWithSelection(
          { annotations: [primer, gene] },
          { isSelected: true, domain: selectionDomainFor(10, 30) }
        )

        const items = wrapper.vm.getMenuItemsForElement({
          layer: 'annotation',
          annotationId: 'gene1',
          rangeIndex: '0'
        })

        const clipItem = items.find(i => i.label.includes('Clip primer binding'))
        expect(clipItem).toBeUndefined()
      })

      it('no option when both annotation ends are inside selection', () => {
        // Annotation spans 15-25, both ends inside selection 10-30
        const primer = new Annotation({
          id: 'primer1',
          caption: 'FWD Primer',
          type: 'primer',
          span: ezSpan(10, 30, Orientation.PLUS)
        })
        const gene = new Annotation({
          id: 'gene1',
          caption: 'Gene',
          type: 'gene',
          span: ezSpan(15, 25, Orientation.PLUS)
        })

        const wrapper = mountWithSelection(
          { annotations: [primer, gene] },
          { isSelected: true, domain: selectionDomainFor(10, 30) }
        )

        const items = wrapper.vm.getMenuItemsForElement({
          layer: 'annotation',
          annotationId: 'gene1',
          rangeIndex: '0'
        })

        const clipItem = items.find(i => i.label.includes('Clip primer binding'))
        expect(clipItem).toBeUndefined()
      })

      it('no option when neither annotation end is inside selection', () => {
        // Annotation spans 5-35, both ends OUTSIDE selection 10-30
        const primer = new Annotation({
          id: 'primer1',
          caption: 'FWD Primer',
          type: 'primer',
          span: ezSpan(10, 30, Orientation.PLUS)
        })
        const gene = new Annotation({
          id: 'gene1',
          caption: 'Gene',
          type: 'gene',
          span: ezSpan(5, 35, Orientation.PLUS)
        })

        const wrapper = mountWithSelection(
          { annotations: [primer, gene] },
          { isSelected: true, domain: selectionDomainFor(10, 30) }
        )

        const items = wrapper.vm.getMenuItemsForElement({
          layer: 'annotation',
          annotationId: 'gene1',
          rangeIndex: '0'
        })

        const clipItem = items.find(i => i.label.includes('Clip primer binding'))
        expect(clipItem).toBeUndefined()
      })
    })

    describe('clip primer with selection (reverse operation)', () => {
      // Right-click on primer, selection has one terminus inside primer
      // Shows "Clip this primer with selection"

      describe('positive tests', () => {
        it('shows option when selection end is inside forward primer', () => {
          // Primer 10..50, selection 30..70 - selection start (30) inside primer
          const primer = new Annotation({
            id: 'primer1',
            caption: 'FWD Primer',
            type: 'primer',
            span: ezSpan(10, 50, Orientation.PLUS)
          })

          const wrapper = mountWithSelection(
            { annotations: [primer] },
            { isSelected: true, domain: selectionDomainFor(30, 70) }
          )

          const items = wrapper.vm.getMenuItemsForElement({
            layer: 'annotation',
            annotationId: 'primer1',
            rangeIndex: '0'
          })

          const clipItem = items.find(i => i.label === 'Clip this primer with selection')
          expect(clipItem).toBeDefined()
        })

        it('shows option when selection start is inside reverse primer', () => {
          // Primer 10..50, selection 5..30 - selection end (30) inside primer
          const primer = new Annotation({
            id: 'primer1',
            caption: 'REV Primer',
            type: 'primer',
            span: ezSpan(10, 50, Orientation.MINUS)
          })

          const wrapper = mountWithSelection(
            { annotations: [primer] },
            { isSelected: true, domain: selectionDomainFor(5, 30) }
          )

          const items = wrapper.vm.getMenuItemsForElement({
            layer: 'annotation',
            annotationId: 'primer1',
            rangeIndex: '0'
          })

          const clipItem = items.find(i => i.label === 'Clip this primer with selection')
          expect(clipItem).toBeDefined()
        })

        it('sets correct primer_bind for forward primer clipped at selection start', () => {
          // Primer 10..50 (40bp), selection start at 30
          // primer_bind should be 50 - 30 = 20 (bases from 3' end to clip point)
          const primer = new Annotation({
            id: 'primer1',
            caption: 'FWD Primer',
            type: 'primer',
            span: ezSpan(10, 50, Orientation.PLUS)
          })

          const mockDoc = {
            updateAnnotation: mock()
          }

          const wrapper = mountWithSelection(
            { annotations: [primer], document: mockDoc },
            { isSelected: true, domain: selectionDomainFor(30, 70) }
          )

          const items = wrapper.vm.getMenuItemsForElement({
            layer: 'annotation',
            annotationId: 'primer1',
            rangeIndex: '0'
          })

          const clipItem = items.find(i => i.label === 'Clip this primer with selection')
          clipItem.action()

          expect(mockDoc.updateAnnotation).toHaveBeenCalledWith({
            id: 'primer1',
            attributes: { primer_bind: 20 }
          })
        })

        it('sets correct primer_bind for reverse primer clipped at selection end', () => {
          // Primer 10..50 (40bp), selection end at 30
          // For reverse primer: primer_bind = 30 - 10 = 20 (bases from 3' end to clip point)
          const primer = new Annotation({
            id: 'primer1',
            caption: 'REV Primer',
            type: 'primer',
            span: ezSpan(10, 50, Orientation.MINUS)
          })

          const mockDoc = {
            updateAnnotation: mock()
          }

          const wrapper = mountWithSelection(
            { annotations: [primer], document: mockDoc },
            { isSelected: true, domain: selectionDomainFor(5, 30) }
          )

          const items = wrapper.vm.getMenuItemsForElement({
            layer: 'annotation',
            annotationId: 'primer1',
            rangeIndex: '0'
          })

          const clipItem = items.find(i => i.label === 'Clip this primer with selection')
          clipItem.action()

          expect(mockDoc.updateAnnotation).toHaveBeenCalledWith({
            id: 'primer1',
            attributes: { primer_bind: 20 }
          })
        })
      })

      describe('negative tests', () => {
        it('no option when no selection', () => {
          const primer = new Annotation({
            id: 'primer1',
            caption: 'FWD Primer',
            type: 'primer',
            span: ezSpan(10, 50, Orientation.PLUS)
          })

          const wrapper = mountWithSelection(
            { annotations: [primer] },
            { isSelected: false, domain: null }
          )

          const items = wrapper.vm.getMenuItemsForElement({
            layer: 'annotation',
            annotationId: 'primer1',
            rangeIndex: '0'
          })

          const clipItem = items.find(i => i.label === 'Clip this primer with selection')
          expect(clipItem).toBeUndefined()
        })

        it('no option when clicked annotation is not a primer', () => {
          const gene = new Annotation({
            id: 'gene1',
            caption: 'Gene',
            type: 'gene',
            span: ezSpan(10, 50, Orientation.PLUS)
          })

          const wrapper = mountWithSelection(
            { annotations: [gene] },
            { isSelected: true, domain: selectionDomainFor(30, 70) }
          )

          const items = wrapper.vm.getMenuItemsForElement({
            layer: 'annotation',
            annotationId: 'gene1',
            rangeIndex: '0'
          })

          const clipItem = items.find(i => i.label === 'Clip this primer with selection')
          expect(clipItem).toBeUndefined()
        })

        it('no option when primer is multi-segment', () => {
          const primer = new Annotation({
            id: 'primer1',
            caption: 'Multi Primer',
            type: 'primer',
            span: new Span([new Range(10, 30), new Range(40, 60)])
          })

          const wrapper = mountWithSelection(
            { annotations: [primer] },
            { isSelected: true, domain: selectionDomainFor(25, 70) }
          )

          const items = wrapper.vm.getMenuItemsForElement({
            layer: 'annotation',
            annotationId: 'primer1',
            rangeIndex: '0'
          })

          const clipItem = items.find(i => i.label === 'Clip this primer with selection')
          expect(clipItem).toBeUndefined()
        })

        it('no option when primer already has primer_bind', () => {
          const primer = new Annotation({
            id: 'primer1',
            caption: 'FWD Primer',
            type: 'primer',
            span: ezSpan(10, 50, Orientation.PLUS),
            attributes: { primer_bind: 15 }
          })

          const wrapper = mountWithSelection(
            { annotations: [primer] },
            { isSelected: true, domain: selectionDomainFor(30, 70) }
          )

          const items = wrapper.vm.getMenuItemsForElement({
            layer: 'annotation',
            annotationId: 'primer1',
            rangeIndex: '0'
          })

          const clipItem = items.find(i => i.label === 'Clip this primer with selection')
          expect(clipItem).toBeUndefined()
        })

        it('no option when both selection ends are inside primer', () => {
          // Primer 10..50, selection 20..40 - both ends inside primer
          const primer = new Annotation({
            id: 'primer1',
            caption: 'FWD Primer',
            type: 'primer',
            span: ezSpan(10, 50, Orientation.PLUS)
          })

          const wrapper = mountWithSelection(
            { annotations: [primer] },
            { isSelected: true, domain: selectionDomainFor(20, 40) }
          )

          const items = wrapper.vm.getMenuItemsForElement({
            layer: 'annotation',
            annotationId: 'primer1',
            rangeIndex: '0'
          })

          const clipItem = items.find(i => i.label === 'Clip this primer with selection')
          expect(clipItem).toBeUndefined()
        })

        it('no option when neither selection end is inside primer', () => {
          // Primer 10..50, selection 5..60 - both ends outside primer
          const primer = new Annotation({
            id: 'primer1',
            caption: 'FWD Primer',
            type: 'primer',
            span: ezSpan(10, 50, Orientation.PLUS)
          })

          const wrapper = mountWithSelection(
            { annotations: [primer] },
            { isSelected: true, domain: selectionDomainFor(5, 60) }
          )

          const items = wrapper.vm.getMenuItemsForElement({
            layer: 'annotation',
            annotationId: 'primer1',
            rangeIndex: '0'
          })

          const clipItem = items.find(i => i.label === 'Clip this primer with selection')
          expect(clipItem).toBeUndefined()
        })

        it('no option when selection has multiple ranges', () => {
          const primer = new Annotation({
            id: 'primer1',
            caption: 'FWD Primer',
            type: 'primer',
            span: ezSpan(10, 50, Orientation.PLUS)
          })

          // Multi-range selection
          const multiRangeDomain = {
            ranges: [new Range(30, 35), new Range(60, 70)]
          }

          const wrapper = mountWithSelection(
            { annotations: [primer] },
            { isSelected: true, domain: multiRangeDomain }
          )

          const items = wrapper.vm.getMenuItemsForElement({
            layer: 'annotation',
            annotationId: 'primer1',
            rangeIndex: '0'
          })

          const clipItem = items.find(i => i.label === 'Clip this primer with selection')
          expect(clipItem).toBeUndefined()
        })
      })
    })
  })
})
