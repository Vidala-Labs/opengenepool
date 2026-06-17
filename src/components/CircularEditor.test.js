import { ezSpan, Span, Range, Orientation } from '../../test/span-helpers.js'
import { describe, it, expect } from 'bun:test'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import CircularEditor from './CircularEditor.vue'
import { SequenceDocument } from '../composables/SequenceDocument.js'
import { Annotation } from '../utils/annotation.js'

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

    it('renders center title from the document name', async () => {
      const wrapper = createWrapper({}, { name: 'My Plasmid' })
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
          span: ezSpan(100, 500)
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

  describe('sequence editing (document mutation)', () => {
    it('Delete key removes the selected bases from the document', async () => {
      const doc = createDocument({ sequence: 'ATCGATCGATCGATCG' })  // 16bp
      const wrapper = createWrapper({ sequence: doc })
      mockSvgRect(wrapper)
      const container = wrapper.find('.editor-container')

      wrapper.vm.selection.select([new Range(4, 8)])
      await wrapper.vm.$nextTick()

      await container.trigger('keydown', { key: 'Delete' })
      await wrapper.vm.$nextTick()

      // Previously a no-op: handleDelete called doc.deleteSequence(), which does
      // not exist on SequenceDocument (the real method is delete([{start,end}])).
      expect(doc.sequence).toBe('ATCGATCGATCG')  // 12bp, '4..8' removed
      expect(doc.sequence.length).toBe(12)
    })

    it('insert modal submit inserts bases into the document', async () => {
      const doc = createDocument({ sequence: 'ATCGATCG' })  // 8bp
      const wrapper = createWrapper({ sequence: doc })
      mockSvgRect(wrapper)

      // Cursor at position 4, open the insert modal (insert mode), then submit.
      wrapper.vm.selection.select([new Range(4, 4)])
      await wrapper.vm.$nextTick()
      wrapper.vm.openInsertModal(false)
      wrapper.vm.handleModalSubmit({ text: 'GGG', preserveAnnotations: false })
      await wrapper.vm.$nextTick()

      // Previously a no-op: handleModalSubmit called doc.insertSequence().
      expect(doc.sequence).toBe('ATCGGGGATCG')  // GGG inserted at 4
      expect(doc.sequence.length).toBe(11)
    })

    it('insert modal submit in replace mode replaces the selected bases', async () => {
      const doc = createDocument({ sequence: 'ATCGATCG' })  // 8bp
      const wrapper = createWrapper({ sequence: doc })
      mockSvgRect(wrapper)

      // Select 4..8, open the modal in replace mode, then submit.
      wrapper.vm.selection.select([new Range(4, 8)])
      await wrapper.vm.$nextTick()
      wrapper.vm.openInsertModal(true)
      wrapper.vm.handleModalSubmit({ text: 'TT', preserveAnnotations: false })
      await wrapper.vm.$nextTick()

      // Previously a no-op: handleModalSubmit called doc.replaceSequence().
      expect(doc.sequence).toBe('ATCGTT')  // '4..8' (ATCG) replaced by 'TT'
      expect(doc.sequence.length).toBe(6)
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

    it('shows the unified annotation menu (Edit/Delete/Hide) on annotation right-click', async () => {
      const annotations = [new Annotation({ id: 'ann1', caption: 'Gene', type: 'gene', span: ezSpan(100, 500) })]
      const wrapper = createWrapper({ sequence: createDocument({ annotations }) })
      await wrapper.vm.$nextTick()

      // Emit the contextmenu event the CircularAnnotationLayer emits at runtime.
      const annLayer = wrapper.findComponent({ name: 'CircularAnnotationLayer' })
      annLayer.vm.$emit('contextmenu', {
        event: { clientX: 100, clientY: 100, preventDefault: () => {} },
        annotation: annotations[0]
      })
      await wrapper.vm.$nextTick()

      const actions = wrapper.findAll('.context-menu .menu-item').map(i => i.attributes('data-action'))
      expect(actions).toContain('edit-annotation')
      expect(actions).toContain('delete-annotation')
      expect(actions).toContain('hide-annotation')
      expect(actions).toContain('create-annotation')
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
    // Build a selection-row menu through the contributor service.
    function selectionMenu(wrapper) {
      return wrapper.vm.contextMenu.buildMenu({
        mode: 'circular',
        targets: [{ layer: 'selection', rangeIndex: 0, range: wrapper.vm.selection.domain.value.ranges[0] }],
        selection: wrapper.vm.selection,
        readonly: true,
        sequenceLength: wrapper.vm.editorState.sequenceLength.value
      })
    }

    it('does not show edit options in readonly mode', async () => {
      const wrapper = createWrapper({ readonly: true })
      mockSvgRect(wrapper)
      wrapper.vm.selection.select([new Range(100, 500)])
      await wrapper.vm.$nextTick()

      const labels = selectionMenu(wrapper).map(i => i.label).filter(Boolean)
      expect(labels).not.toContain('Replace sequence with...')
      expect(labels).not.toContain('Delete sequence')
    })

    it('still shows Copy in readonly mode', async () => {
      const wrapper = createWrapper({ readonly: true })
      mockSvgRect(wrapper)
      wrapper.vm.selection.select([new Range(100, 500)])
      await wrapper.vm.$nextTick()

      const labels = selectionMenu(wrapper).map(i => i.label).filter(Boolean)
      expect(labels).toContain('Copy selection')
    })

    it('does not offer "Insert sequence..." at a cursor in readonly mode', async () => {
      const wrapper = createWrapper({ readonly: true })
      mockSvgRect(wrapper)
      // Cursor (zero-width selection) is what surfaces the Insert item.
      wrapper.vm.selection.select([new Range(100, 100)])
      await wrapper.vm.$nextTick()

      const menu = wrapper.vm.contextMenu.buildMenu({
        mode: 'circular',
        targets: [{ layer: 'selection', rangeIndex: 0, range: wrapper.vm.selection.domain.value.ranges[0] }],
        selection: wrapper.vm.selection,
        readonly: true,
        sequenceLength: wrapper.vm.editorState.sequenceLength.value
      })
      const labels = menu.map(i => i.label).filter(Boolean)
      expect(labels).not.toContain('Insert sequence...')
    })

    it('the editor injects its readonly prop into the resolved menu (write ops absent)', async () => {
      // Use the editor's own context builder so we verify props.readonly flows
      // through, not just a hand-passed readonly:true.
      const doc = createDocument({ sequence: 'ATCGATCGATCGATCG' })
      const wrapper = createWrapper({ sequence: doc, readonly: true })
      mockSvgRect(wrapper)
      wrapper.vm.selection.select([new Range(4, 8)])
      await wrapper.vm.$nextTick()

      const menu = wrapper.vm.contextMenu.buildMenu({
        mode: 'circular',
        targets: [{ layer: 'selection', rangeIndex: 0, range: wrapper.vm.selection.domain.value.ranges[0] }],
        selection: wrapper.vm.selection,
        readonly: wrapper.props('readonly'),
        sequenceLength: wrapper.vm.editorState.sequenceLength.value
      })
      const labels = menu.map(i => i.label).filter(Boolean)
      expect(labels).not.toContain('Delete sequence')
      expect(labels).not.toContain('Replace sequence with...')
      expect(labels).not.toContain('Insert sequence...')
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
