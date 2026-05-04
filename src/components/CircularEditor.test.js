import { parseSpan, parseRange } from '../../test/parse-utils.js'
import { describe, it, expect } from 'bun:test'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import CircularEditor from './CircularEditor.vue'
import { SequenceDocument } from '../composables/SequenceDocument.js'
import { Annotation } from '../utils/annotation.js'
import { Span, Range } from '../utils/dna.js'

describe('CircularEditor', () => {
  function createDocument(options = {}) {
    const sequence = options.sequence || 'A'.repeat(options.sequenceLength || 5000)
    return new SequenceDocument({
      sequence,
      name: options.name || 'Test Plasmid',
      circular: options.circular ?? true,
      annotations: options.annotations || []
    })
  }

  function createWrapper(props = {}, options = {}) {
    const doc = props.sequence || createDocument(options)

    return mount(CircularEditor, {
      props: {
        sequence: doc,
        showAnnotationCaptions: props.showAnnotationCaptions ?? true,
        readonly: props.readonly ?? false,
        ...props
      }
    })
  }

  function mockSvgRect(wrapper) {
    const svg = wrapper.find('svg.circular-view').element
    if (svg) {
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

  describe('rendering', () => {
    it('renders the component', () => {
      const wrapper = createWrapper()
      expect(wrapper.find('.circular-editor').exists()).toBe(true)
    })

    it('renders SVG with viewBox', () => {
      const wrapper = createWrapper()
      const svg = wrapper.find('svg.circular-view')
      expect(svg.exists()).toBe(true)
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

    it('renders Toolbar', () => {
      const wrapper = createWrapper()
      const toolbar = wrapper.findComponent({ name: 'Toolbar' })
      expect(toolbar.exists()).toBe(true)
    })

    it('renders Indicator', () => {
      const wrapper = createWrapper()
      const indicator = wrapper.findComponent({ name: 'Indicator' })
      expect(indicator.exists()).toBe(true)
    })

    it('renders center title', async () => {
      const wrapper = createWrapper()
      // Set title manually as SequenceDocument doesn't have name property
      wrapper.vm.editorState.title.value = 'My Plasmid'
      await wrapper.vm.$nextTick()

      const title = wrapper.find('.center-title')
      expect(title.exists()).toBe(true)
      expect(title.text()).toBe('My Plasmid')
    })

    it('renders sequence length', () => {
      const wrapper = createWrapper({}, { sequenceLength: 5000 })
      const length = wrapper.find('.center-length')
      expect(length.exists()).toBe(true)
      expect(length.text()).toContain('5,000')
      expect(length.text()).toContain('bp')
    })
  })

  describe('layers', () => {
    it('renders CircularSelectionLayer', () => {
      const wrapper = createWrapper()
      const selectionLayer = wrapper.findComponent({ name: 'CircularSelectionLayer' })
      expect(selectionLayer.exists()).toBe(true)
    })

    it('renders CircularAnnotationLayer', () => {
      const wrapper = createWrapper()
      const annotationLayer = wrapper.findComponent({ name: 'CircularAnnotationLayer' })
      expect(annotationLayer.exists()).toBe(true)
    })

    it('passes annotations to CircularAnnotationLayer', () => {
      const annotations = [
        new Annotation({
          id: 'ann1',
          caption: 'GFP',
          type: 'gene',
          span: parseSpan('100..500')
        })
      ]
      const doc = createDocument({ annotations })
      const wrapper = createWrapper({ sequence: doc })
      const annotationLayer = wrapper.findComponent({ name: 'CircularAnnotationLayer' })
      expect(annotationLayer.exists()).toBe(true)
    })
  })

  describe('keyboard handling', () => {
    it('handles Escape to clear selection', async () => {
      const wrapper = createWrapper()
      mockSvgRect(wrapper)
      const container = wrapper.find('.editor-container')

      // Make a selection first
      wrapper.vm.selection.select([new Range(100, 500)])
      await wrapper.vm.$nextTick()
      expect(wrapper.vm.selection.isSelected.value).toBe(true)

      // Press Escape
      await container.trigger('keydown', { key: 'Escape' })
      await wrapper.vm.$nextTick()

      expect(wrapper.vm.selection.isSelected.value).toBe(false)
    })

    it('handles Ctrl+A to select all', async () => {
      const wrapper = createWrapper()
      const container = wrapper.find('.editor-container')

      await container.trigger('keydown', { key: 'a', ctrlKey: true })
      await wrapper.vm.$nextTick()

      expect(wrapper.vm.selection.isSelected.value).toBe(true)
      const range = wrapper.vm.selection.domain.value.ranges[0]
      expect(range.start).toBe(0)
      expect(range.end).toBe(5000)
    })
  })

  describe('context menu', () => {
    it('has ContextMenu component', () => {
      const wrapper = createWrapper()
      const contextMenu = wrapper.findComponent({ name: 'ContextMenu' })
      expect(contextMenu.exists()).toBe(true)
    })

    it('shows context menu on right-click', async () => {
      const wrapper = createWrapper()
      mockSvgRect(wrapper)

      expect(wrapper.vm.contextMenuVisible).toBe(false)

      const svg = wrapper.find('svg.circular-view')
      const cg = wrapper.vm.circularGraphics
      const coords = {
        x: cg.centerX.value + cg.backboneRadius.value,
        y: cg.centerY.value
      }

      await svg.trigger('contextmenu', {
        clientX: coords.x,
        clientY: coords.y,
        preventDefault: () => {}
      })

      expect(wrapper.vm.contextMenuVisible).toBe(true)
    })
  })

  describe('modals', () => {
    it('has InsertModal component', () => {
      const wrapper = createWrapper()
      const modal = wrapper.findComponent({ name: 'InsertModal' })
      expect(modal.exists()).toBe(true)
    })

    it('has AnnotationModal component', () => {
      const wrapper = createWrapper()
      const modal = wrapper.findComponent({ name: 'AnnotationModal' })
      expect(modal.exists()).toBe(true)
    })

    it('has ExtendModal component', () => {
      const wrapper = createWrapper()
      const modal = wrapper.findComponent({ name: 'ExtendModal' })
      expect(modal.exists()).toBe(true)
    })

    it('has ConfirmDialog component', () => {
      const wrapper = createWrapper()
      const dialog = wrapper.findComponent({ name: 'ConfirmDialog' })
      expect(dialog.exists()).toBe(true)
    })
  })

  describe('selection status', () => {
    it('shows cursor position for zero-width selection', async () => {
      const wrapper = createWrapper()
      wrapper.vm.selection.select([new Range(100, 100)])
      await wrapper.vm.$nextTick()

      expect(wrapper.vm.selectionStatusText).toContain('Cursor at')
      expect(wrapper.vm.selectionStatusText).toContain('100')
    })

    it('shows range for selection', async () => {
      const wrapper = createWrapper()
      wrapper.vm.selection.select([new Range(100, 500)])
      await wrapper.vm.$nextTick()

      expect(wrapper.vm.selectionStatusText).toContain('100')
      expect(wrapper.vm.selectionStatusText).toContain('500')
      expect(wrapper.vm.selectionStatusText).toContain('400 bp')
    })

    it('shows multi-range info for multiple ranges', async () => {
      const wrapper = createWrapper()
      wrapper.vm.selection.select([new Range(100, 200)])
      wrapper.vm.selection.startSelection(300, true)
      wrapper.vm.selection.updateSelection(400)
      wrapper.vm.selection.endSelection()
      await wrapper.vm.$nextTick()

      expect(wrapper.vm.selectionStatusText).toContain('2 ranges')
      expect(wrapper.vm.selectionStatusText).toContain('200 bp total')
    })
  })

  describe('expose', () => {
    it('exposes circularGraphics', () => {
      const wrapper = createWrapper()
      expect(wrapper.vm.circularGraphics).toBeDefined()
      expect(wrapper.vm.circularGraphics.centerX).toBeDefined()
    })

    it('exposes isZooming', () => {
      const wrapper = createWrapper()
      expect(wrapper.vm.isZooming).toBe(false)
    })

    it('exposes selection', () => {
      const wrapper = createWrapper()
      expect(wrapper.vm.selection).toBeDefined()
      expect(wrapper.vm.selection.isSelected).toBeDefined()
    })

    it('exposes editorState', () => {
      const wrapper = createWrapper()
      expect(wrapper.vm.editorState).toBeDefined()
      expect(wrapper.vm.editorState.sequenceLength).toBeDefined()
    })
  })

  describe('readonly mode', () => {
    it('does not show edit options in readonly mode', async () => {
      const wrapper = createWrapper({ readonly: true })
      mockSvgRect(wrapper)

      // Create a selection
      wrapper.vm.selection.select([new Range(100, 500)])
      await wrapper.vm.$nextTick()

      // Build context menu items
      const items = wrapper.vm.buildContextMenuItems({ source: 'selection' })

      // Should not have Replace or Delete options
      const labels = items.map(i => i.label).filter(Boolean)
      expect(labels).not.toContain('Replace selection...')
      expect(labels).not.toContain('Delete selection')
    })

    it('still shows Copy in readonly mode', async () => {
      const wrapper = createWrapper({ readonly: true })
      mockSvgRect(wrapper)

      // Create a selection
      wrapper.vm.selection.select([new Range(100, 500)])
      await wrapper.vm.$nextTick()

      // Build context menu items
      const items = wrapper.vm.buildContextMenuItems({ source: 'selection' })

      // Should have Copy option
      const labels = items.map(i => i.label).filter(Boolean)
      expect(labels).toContain('Copy selection')
    })
  })

  describe('slots', () => {
    it('renders title slot', () => {
      const wrapper = mount(CircularEditor, {
        props: {
          sequence: createDocument()
        },
        slots: {
          title: 'Custom Title'
        }
      })

      const toolbar = wrapper.findComponent({ name: 'Toolbar' })
      expect(toolbar.text()).toContain('Custom Title')
    })

    it('renders toolbar slot', () => {
      const wrapper = mount(CircularEditor, {
        props: {
          sequence: createDocument()
        },
        slots: {
          toolbar: '<button class="custom-btn">Save</button>'
        }
      })

      expect(wrapper.find('.custom-btn').exists()).toBe(true)
    })
  })
})
