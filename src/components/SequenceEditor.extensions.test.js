import { describe, it, expect, beforeEach } from 'bun:test'
import { mount } from '@vue/test-utils'
import SequenceEditor from './SequenceEditor.vue'
import { Annotation } from '../utils/annotation.js'
import { STORAGE_KEY } from '../composables/usePersistedZoom.js'

describe('SequenceEditor extension context menu API', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY)
  })

  // Helper to record context menu calls from extension
  function createTestExtension() {
    const contextCalls = []
    const extension = {
      id: 'test-context',
      name: 'Test Extension',
      contextMenuItems: (context) => {
        contextCalls.push(context)
        return [{ label: 'Test Item', action: () => {} }]
      }
    }
    return { extension, contextCalls }
  }

  describe('selection context', () => {
    it('provides selection context when right-clicking on selection', async () => {
      const { extension, contextCalls } = createTestExtension()
      const wrapper = mount(SequenceEditor, {
        props: { initialZoom: 100, extensions: [extension] }
      })
      wrapper.vm.setSequence('ATGCATGCATGC' + 'A'.repeat(88))
      await wrapper.vm.$nextTick()

      // Create selection
      const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
      selectionLayer.vm.selection.select('10..50')
      await wrapper.vm.$nextTick()

      // Right-click on selection
      selectionLayer.vm.$emit('contextmenu', {
        event: { clientX: 100, clientY: 100, preventDefault: () => {} },
        rangeIndex: 0,
        range: selectionLayer.vm.selection.domain.value.ranges[0]
      })
      await wrapper.vm.$nextTick()

      // Should have called extension with selection context
      expect(contextCalls.length).toBe(1)
      expect(contextCalls[0].type).toBe('selection')
      expect(contextCalls[0].data.sequence).toBeTruthy()
      expect(contextCalls[0].data.domain).toBeTruthy()
    })

    it('includes extension items in context menu after separator', async () => {
      const { extension } = createTestExtension()
      const wrapper = mount(SequenceEditor, {
        props: { initialZoom: 100, extensions: [extension] }
      })
      wrapper.vm.setSequence('A'.repeat(100))
      await wrapper.vm.$nextTick()

      // Create selection
      const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
      selectionLayer.vm.selection.select('10..50')
      await wrapper.vm.$nextTick()

      // Right-click on selection
      selectionLayer.vm.$emit('contextmenu', {
        event: { clientX: 100, clientY: 100, preventDefault: () => {} },
        rangeIndex: 0,
        range: selectionLayer.vm.selection.domain.value.ranges[0]
      })
      await wrapper.vm.$nextTick()

      // Find context menu
      const menuText = wrapper.find('.context-menu').text()
      expect(menuText).toContain('Test Item')
    })
  })

  describe('annotation context', () => {
    it('provides annotation context when right-clicking on annotation', async () => {
      const { extension, contextCalls } = createTestExtension()
      const annotation = new Annotation({
        id: 'ann1',
        caption: 'GFP',
        type: 'gene',
        span: '10..50'
      })

      const wrapper = mount(SequenceEditor, {
        props: {
          initialZoom: 100,
          annotations: [annotation],
          extensions: [extension]
        }
      })
      wrapper.vm.setSequence('A'.repeat(100))
      await wrapper.vm.$nextTick()

      // Right-click on annotation
      const annotationLayer = wrapper.findComponent({ name: 'AnnotationLayer' })
      annotationLayer.vm.$emit('contextmenu', {
        annotation,
        event: { clientX: 100, clientY: 100, preventDefault: () => {} },
        fragment: { rangeIndex: 0 }
      })
      await wrapper.vm.$nextTick()

      // Should have called extension with annotation context
      expect(contextCalls.length).toBe(1)
      expect(contextCalls[0].type).toBe('annotation')
      expect(contextCalls[0].data.annotation).toBeTruthy()
      expect(contextCalls[0].data.sequence).toBeTruthy()
      expect(contextCalls[0].data.fragment).toBeTruthy()
    })
  })

  describe('translation context', () => {
    it('provides translation context when right-clicking on amino acid', async () => {
      const { extension, contextCalls } = createTestExtension()
      const annotation = new Annotation({
        id: 'cds1',
        caption: 'Test CDS',
        type: 'CDS',
        span: '0..30'
      })

      const wrapper = mount(SequenceEditor, {
        props: {
          initialZoom: 100,
          annotations: [annotation],
          extensions: [extension]
        }
      })
      wrapper.vm.setSequence('ATGATGATGATGATGATGATGATGATGATG')
      await wrapper.vm.$nextTick()

      // Right-click on translation
      const translationLayer = wrapper.findComponent({ name: 'TranslationLayer' })
      translationLayer.vm.$emit('contextmenu', {
        event: { clientX: 100, clientY: 100, preventDefault: () => {} },
        element: { annotationId: 'cds1' },
        translation: 'MMMMMMMMMM'
      })
      await wrapper.vm.$nextTick()

      // Should have called extension with translation context
      expect(contextCalls.length).toBe(1)
      expect(contextCalls[0].type).toBe('translation')
      expect(contextCalls[0].data.translation).toBe('MMMMMMMMMM')
      expect(contextCalls[0].data.annotation).toBeTruthy()
    })
  })

  describe('handle context', () => {
    it('provides handle context when right-clicking on selection handle', async () => {
      const { extension, contextCalls } = createTestExtension()
      const wrapper = mount(SequenceEditor, {
        props: { initialZoom: 100, extensions: [extension] }
      })
      wrapper.vm.setSequence('A'.repeat(100))
      await wrapper.vm.$nextTick()

      // Create selection
      const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
      selectionLayer.vm.selection.select('10..50')
      await wrapper.vm.$nextTick()

      // Right-click on handle
      selectionLayer.vm.$emit('handle-contextmenu', {
        event: { clientX: 100, clientY: 100, preventDefault: () => {} },
        rangeIndex: 0,
        range: selectionLayer.vm.selection.domain.value.ranges[0],
        handleType: 'end',
        isCursor: false
      })
      await wrapper.vm.$nextTick()

      // Should have called extension with handle context
      expect(contextCalls.length).toBe(1)
      expect(contextCalls[0].type).toBe('handle')
      expect(contextCalls[0].data.range).toBeTruthy()
      expect(contextCalls[0].data.position).toBe('end')
    })
  })

  describe('sequence context', () => {
    it('provides sequence context when right-clicking on sequence background', async () => {
      const { extension, contextCalls } = createTestExtension()
      const wrapper = mount(SequenceEditor, {
        props: { initialZoom: 100, extensions: [extension] }
      })
      wrapper.vm.setSequence('A'.repeat(100))
      await wrapper.vm.$nextTick()

      // Right-click on sequence background (no selection)
      const overlay = wrapper.find('.sequence-overlay')
      await overlay.trigger('contextmenu', { clientX: 100, clientY: 20 })
      await wrapper.vm.$nextTick()

      // Should have called extension with sequence context
      expect(contextCalls.length).toBe(1)
      expect(contextCalls[0].type).toBe('sequence')
      expect(contextCalls[0].data.position).toBeDefined()
    })
  })

  describe('extension filtering', () => {
    it('does not call extensions without contextMenuItems function', async () => {
      const extensionWithoutContextMenu = {
        id: 'no-context',
        name: 'No Context Menu'
      }
      const { extension: testExtension, contextCalls } = createTestExtension()

      const wrapper = mount(SequenceEditor, {
        props: {
          initialZoom: 100,
          extensions: [extensionWithoutContextMenu, testExtension]
        }
      })
      wrapper.vm.setSequence('A'.repeat(100))
      await wrapper.vm.$nextTick()

      // Create selection and right-click
      const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
      selectionLayer.vm.selection.select('10..50')
      await wrapper.vm.$nextTick()

      selectionLayer.vm.$emit('contextmenu', {
        event: { clientX: 100, clientY: 100, preventDefault: () => {} },
        rangeIndex: 0,
        range: selectionLayer.vm.selection.domain.value.ranges[0]
      })
      await wrapper.vm.$nextTick()

      // Only the extension with contextMenuItems should be called
      expect(contextCalls.length).toBe(1)
    })

    it('handles extensions that return empty arrays', async () => {
      const emptyExtension = {
        id: 'empty',
        name: 'Empty Extension',
        contextMenuItems: () => []
      }

      const wrapper = mount(SequenceEditor, {
        props: { initialZoom: 100, extensions: [emptyExtension] }
      })
      wrapper.vm.setSequence('A'.repeat(100))
      await wrapper.vm.$nextTick()

      // Create selection and right-click
      const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
      selectionLayer.vm.selection.select('10..50')
      await wrapper.vm.$nextTick()

      selectionLayer.vm.$emit('contextmenu', {
        event: { clientX: 100, clientY: 100, preventDefault: () => {} },
        rangeIndex: 0,
        range: selectionLayer.vm.selection.domain.value.ranges[0]
      })
      await wrapper.vm.$nextTick()

      // Should still render context menu without extension items
      const contextMenu = wrapper.find('.context-menu')
      expect(contextMenu.exists()).toBe(true)
    })
  })

  describe('multiple extensions', () => {
    it('collects items from all extensions', async () => {
      const extension1 = {
        id: 'ext1',
        name: 'Extension 1',
        contextMenuItems: () => [{ label: 'Item 1', action: () => {} }]
      }
      const extension2 = {
        id: 'ext2',
        name: 'Extension 2',
        contextMenuItems: () => [{ label: 'Item 2', action: () => {} }]
      }

      const wrapper = mount(SequenceEditor, {
        props: { initialZoom: 100, extensions: [extension1, extension2] }
      })
      wrapper.vm.setSequence('A'.repeat(100))
      await wrapper.vm.$nextTick()

      // Create selection and right-click
      const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
      selectionLayer.vm.selection.select('10..50')
      await wrapper.vm.$nextTick()

      selectionLayer.vm.$emit('contextmenu', {
        event: { clientX: 100, clientY: 100, preventDefault: () => {} },
        rangeIndex: 0,
        range: selectionLayer.vm.selection.domain.value.ranges[0]
      })
      await wrapper.vm.$nextTick()

      // Both extension items should appear
      const menuText = wrapper.find('.context-menu').text()
      expect(menuText).toContain('Item 1')
      expect(menuText).toContain('Item 2')
    })
  })
})
