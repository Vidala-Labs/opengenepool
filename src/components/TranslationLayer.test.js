import { describe, it, expect, beforeEach } from 'bun:test'
import { mount } from '@vue/test-utils'
import { ref, computed, nextTick } from 'vue'
import TranslationLayer, { __resetModuleState } from './TranslationLayer.vue'
import { __resetModuleState as resetAnnotationState } from './AnnotationLayer.vue'
import { Annotation } from '../utils/annotation.js'
import { Span } from '../utils/dna.js'

const STORAGE_KEY = 'ogp-hidden-annotation-types'

// Helper to create mock providers
function createMockProviders(options = {}) {
  const zoomLevel = ref(options.zoomLevel || 100)
  const sequenceLength = ref(options.sequenceLength || 500)
  const sequence = ref(options.sequence || 'ATGATGATGATGATGATG'.repeat(30))

  const editorState = {
    zoomLevel,
    sequenceLength,
    sequence,
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

  return mount(TranslationLayer, {
    props,
    global: {
      provide: {
        editorState,
        graphics
      }
    }
  })
}

describe('TranslationLayer', () => {
  beforeEach(() => {
    __resetModuleState()
    resetAnnotationState()
    localStorage.removeItem(STORAGE_KEY)
  })
  describe('rendering', () => {
    it('renders empty when no CDS annotations', () => {
      const wrapper = mountWithProviders({ annotations: [] })
      expect(wrapper.findAll('.translation-fragment')).toHaveLength(0)
    })

    it('renders translation for CDS annotation', () => {
      const annotation = new Annotation({
        id: 'cds1',
        caption: 'GFP',
        type: 'CDS',
        span: Span.parse('0..30')
      })

      const wrapper = mountWithProviders(
        { annotations: [annotation] },
        { sequence: 'ATGATGATGATGATGATGATGATGATGATG' }
      )
      // Check for amino acid elements (the actual class used in TranslationLayer)
      const aaElements = wrapper.findAll('.aa-element')
      expect(aaElements.length).toBeGreaterThan(0)
    })

    it('ignores non-CDS annotations', () => {
      const annotation = new Annotation({
        id: 'gene1',
        caption: 'Test',
        type: 'gene',
        span: Span.parse('0..30')
      })

      const wrapper = mountWithProviders({ annotations: [annotation] })
      expect(wrapper.findAll('.translation-fragment')).toHaveLength(0)
    })
  })

  describe('visibility', () => {
    it('hides when showTranslation is toggled off via configItems onChange', async () => {
      const annotation = new Annotation({
        id: 'cds1',
        type: 'CDS',
        span: Span.parse('0..30')
      })

      const wrapper = mountWithProviders(
        { annotations: [annotation] },
        { sequence: 'ATGATGATGATGATGATGATGATGATGATG' }
      )

      // Initially visible
      expect(wrapper.find('.translation-layer').exists()).toBe(true)

      // Get configItems and toggle off
      const configItems = wrapper.vm.configItems
      const toggleItem = configItems.find(item => item.type === 'toggle')
      expect(toggleItem).toBeDefined()

      toggleItem.onChange()
      await nextTick()

      expect(wrapper.find('.translation-layer').exists()).toBe(false)
    })

    it('shows when showTranslation is true', () => {
      const annotation = new Annotation({
        id: 'cds1',
        type: 'CDS',
        span: Span.parse('0..30')
      })

      const wrapper = mountWithProviders(
        { annotations: [annotation] },
        { showTranslation: true, sequence: 'ATGATGATGATGATGATGATGATGATGATG' }
      )

      const layer = wrapper.find('.translation-layer')
      expect(layer.exists()).toBe(true)
    })
  })

  describe('amino acid display', () => {
    it('translates codons to amino acids', () => {
      // ATG = M (Methionine)
      const annotation = new Annotation({
        id: 'cds1',
        type: 'CDS',
        span: Span.parse('0..9') // 3 codons
      })

      const wrapper = mountWithProviders(
        { annotations: [annotation] },
        { sequence: 'ATGATGATG', sequenceLength: 9 }
      )

      // Should contain M (Methionine) text
      const text = wrapper.text()
      expect(text).toContain('M')
    })
  })

  describe('events', () => {
    it('emits click event with annotation data', async () => {
      const annotation = new Annotation({
        id: 'cds1',
        caption: 'GFP',
        type: 'CDS',
        span: Span.parse('0..30')
      })

      const wrapper = mountWithProviders(
        { annotations: [annotation] },
        { sequence: 'ATGATGATGATGATGATGATGATGATGATG' }
      )

      const fragment = wrapper.find('.aa-element')
      if (fragment.exists()) {
        await fragment.trigger('click')
        expect(wrapper.emitted('click')).toBeTruthy()
      }
    })

    it('emits contextmenu with translation in coding order for plus strand', async () => {
      // ATG AAA = M K
      const annotation = new Annotation({
        id: 'cds1',
        caption: 'Test',
        type: 'CDS',
        span: Span.parse('0..6')
      })

      const wrapper = mountWithProviders(
        { annotations: [annotation] },
        { sequence: 'ATGAAA', sequenceLength: 6 }
      )

      const fragment = wrapper.find('.aa-element')
      expect(fragment.exists()).toBe(true)
      await fragment.trigger('contextmenu')

      const emitted = wrapper.emitted('contextmenu')
      expect(emitted).toBeTruthy()
      expect(emitted[0][0].translation).toBe('MK')
    })

    it('emits contextmenu with translation in coding order for minus strand', async () => {
      // Minus strand: (0..6) on sequence 'ATGAAA'
      // Walking high to low: positions 5,4,3,2,1,0 -> A,A,A,G,T,A
      // Complemented: T,T,T,C,A,T -> TTT CAT -> F H
      // The translation should be 'FH' in coding order (N to C terminus)
      const annotation = new Annotation({
        id: 'cds1',
        caption: 'Test',
        type: 'CDS',
        span: Span.parse('(0..6)')  // Minus strand
      })

      const wrapper = mountWithProviders(
        { annotations: [annotation] },
        { sequence: 'ATGAAA', sequenceLength: 6 }
      )

      const fragment = wrapper.find('.aa-element')
      expect(fragment.exists()).toBe(true)
      await fragment.trigger('contextmenu')

      const emitted = wrapper.emitted('contextmenu')
      expect(emitted).toBeTruthy()
      // Translation should be in coding order (N to C), not reversed
      expect(emitted[0][0].translation).toBe('FH')
    })

    it('handles mixed orientation spans by processing each range per its orientation', async () => {
      // Mixed orientation: 0..6 (plus) + (10..16) (minus)
      // Sequence: 'ATGAAACCC' + 'G' + 'TTTGGG' = 'ATGAAACCCGTTTGGG'
      //                                          0123456789...
      // Plus range 0..6: ATG AAA = M K
      // Minus range (10..16): positions 15,14,13,12,11,10 = G,G,G,T,T,T
      //   complemented: C,C,C,A,A,A = CCC AAA = P K
      // Combined translation: M K P K
      const annotation = new Annotation({
        id: 'cds1',
        caption: 'Test',
        type: 'CDS',
        span: Span.parse('0..6 + (10..16)')
      })

      const wrapper = mountWithProviders(
        { annotations: [annotation] },
        { sequence: 'ATGAAACCCGTTTGGG', sequenceLength: 16 }
      )

      const fragment = wrapper.find('.aa-element')
      expect(fragment.exists()).toBe(true)
      await fragment.trigger('contextmenu')

      const emitted = wrapper.emitted('contextmenu')
      expect(emitted).toBeTruthy()
      // Each range processed per its orientation, accumulated in range order
      expect(emitted[0][0].translation).toBe('MKPK')
    })
  })

  describe('coordination with AnnotationLayer', () => {
    it('hides when AnnotationLayer showAnnotations is off', async () => {
      const annotation = new Annotation({
        id: 'cds1', type: 'CDS', span: Span.parse('0..30')
      })

      const wrapper = mountWithProviders(
        { annotations: [annotation] },
        { sequence: 'ATGATGATGATGATGATGATGATGATGATG' }
      )

      expect(wrapper.find('.translation-layer').exists()).toBe(true)

      const { showAnnotations } = await import('./AnnotationLayer.vue')
      showAnnotations.value = false
      await nextTick()

      expect(wrapper.find('.translation-layer').exists()).toBe(false)
    })

    it('hides when CDS type is hidden in AnnotationLayer', async () => {
      const annotation = new Annotation({
        id: 'cds1', type: 'CDS', span: Span.parse('0..30')
      })

      const wrapper = mountWithProviders(
        { annotations: [annotation] },
        { sequence: 'ATGATGATGATGATGATGATGATGATGATG' }
      )

      expect(wrapper.find('.translation-layer').exists()).toBe(true)

      const { hiddenTypes } = await import('./AnnotationLayer.vue')
      hiddenTypes.value = new Set(['CDS'])
      await nextTick()

      expect(wrapper.find('.translation-layer').exists()).toBe(false)
    })

    it('shows when CDS type is unhidden', async () => {
      const annotation = new Annotation({
        id: 'cds1', type: 'CDS', span: Span.parse('0..30')
      })

      const { hiddenTypes } = await import('./AnnotationLayer.vue')
      hiddenTypes.value = new Set(['CDS'])

      const wrapper = mountWithProviders(
        { annotations: [annotation] },
        { sequence: 'ATGATGATGATGATGATGATGATGATGATG' }
      )

      expect(wrapper.find('.translation-layer').exists()).toBe(false)

      hiddenTypes.value = new Set()
      await nextTick()

      expect(wrapper.find('.translation-layer').exists()).toBe(true)
    })
  })
})
