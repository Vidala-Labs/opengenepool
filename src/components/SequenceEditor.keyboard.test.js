import { describe, it, expect, beforeEach, mock } from 'bun:test'
import { mount } from '@vue/test-utils'
import SequenceEditor from './SequenceEditor.vue'
import { STORAGE_KEY } from '../composables/usePersistedZoom.js'

describe('SequenceEditor keyboard', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY)
  })

  describe('keyboard input', () => {
    it('opens insert modal on DNA base keypress', async () => {
      const wrapper = mount(SequenceEditor, {
        props: { initialZoom: 100 }
      })
      wrapper.vm.setSequence('ATCG')
      wrapper.vm.editorState.setCursor(2)
      await wrapper.vm.$nextTick()

      await wrapper.find('.editor-svg').trigger('keydown', { key: 'G' })
      await wrapper.vm.$nextTick()

      // Modal should open with the pressed key as initial text
      expect(wrapper.find('.modal-overlay').exists()).toBe(true)
      expect(wrapper.find('.modal-input').element.value).toBe('G')
    })

    it('handles backspace with selection', async () => {
      const wrapper = mount(SequenceEditor, {
        props: { initialZoom: 100 }
      })
      wrapper.vm.setSequence('ATCGATCG')
      await wrapper.vm.$nextTick()

      // Select positions 2..4 (indices 2,3 = 'CG')
      const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
      selectionLayer.vm.selection.select('2..4')
      await wrapper.vm.$nextTick()

      await wrapper.find('.editor-svg').trigger('keydown', { key: 'Backspace' })
      // 'ATCGATCG' with positions 2-4 deleted = 'AT' + 'ATCG' = 'ATATCG'
      expect(wrapper.vm.getSequence()).toBe('ATATCG')
    })

    it('backspace does nothing without selection', async () => {
      const wrapper = mount(SequenceEditor, {
        props: { initialZoom: 100 }
      })
      wrapper.vm.setSequence('ATCG')
      wrapper.vm.editorState.setCursor(2)
      await wrapper.vm.$nextTick()

      await wrapper.find('.editor-svg').trigger('keydown', { key: 'Backspace' })
      // No change - backspace only works with non-zero selection
      expect(wrapper.vm.getSequence()).toBe('ATCG')
    })

    it('handles delete key with selection', async () => {
      const wrapper = mount(SequenceEditor, {
        props: { initialZoom: 100 }
      })
      wrapper.vm.setSequence('ATCGATCG')
      await wrapper.vm.$nextTick()

      // Select positions 1..3 (indices 1,2 = 'TC')
      const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
      selectionLayer.vm.selection.select('1..3')
      await wrapper.vm.$nextTick()

      await wrapper.find('.editor-svg').trigger('keydown', { key: 'Delete' })
      // 'ATCGATCG' with positions 1-3 deleted = 'A' + 'GATCG' = 'AGATCG'
      expect(wrapper.vm.getSequence()).toBe('AGATCG')
    })

    it('delete does nothing without selection', async () => {
      const wrapper = mount(SequenceEditor, {
        props: { initialZoom: 100 }
      })
      wrapper.vm.setSequence('ATCG')
      wrapper.vm.editorState.setCursor(1)
      await wrapper.vm.$nextTick()

      await wrapper.find('.editor-svg').trigger('keydown', { key: 'Delete' })
      // No change - delete only works with non-zero selection
      expect(wrapper.vm.getSequence()).toBe('ATCG')
    })

    it('ignores non-DNA characters', async () => {
      const wrapper = mount(SequenceEditor, {
        props: { initialZoom: 100 }
      })
      wrapper.vm.setSequence('ATCG')
      wrapper.vm.editorState.setCursor(2)
      await wrapper.vm.$nextTick()

      await wrapper.find('.editor-svg').trigger('keydown', { key: 'X' })
      expect(wrapper.vm.getSequence()).toBe('ATCG') // unchanged
    })

    it('emits edit event when modal submits', async () => {
      const wrapper = mount(SequenceEditor, {
        props: { initialZoom: 100 }
      })
      wrapper.vm.setSequence('ATCG')
      wrapper.vm.editorState.setCursor(2)
      await wrapper.vm.$nextTick()

      // Open modal with a DNA key
      await wrapper.find('.editor-svg').trigger('keydown', { key: 'G' })
      await wrapper.vm.$nextTick()

      // Submit the modal
      await wrapper.find('.btn-submit').trigger('click')
      await wrapper.vm.$nextTick()

      expect(wrapper.emitted('edit')).toBeTruthy()
    })
  })

  describe('insert modal', () => {
    it('opens modal on DNA base keypress', async () => {
      const wrapper = mount(SequenceEditor, {
        props: { initialZoom: 100 }
      })
      wrapper.vm.setSequence('ATCGATCG')
      await wrapper.vm.$nextTick()

      await wrapper.find('.editor-svg').trigger('keydown', { key: 'A' })
      await wrapper.vm.$nextTick()

      expect(wrapper.find('.modal-overlay').exists()).toBe(true)
    })

    it('closes modal on cancel', async () => {
      const wrapper = mount(SequenceEditor, {
        props: { initialZoom: 100 }
      })
      wrapper.vm.setSequence('ATCGATCG')
      await wrapper.vm.$nextTick()

      await wrapper.find('.editor-svg').trigger('keydown', { key: 'A' })
      await wrapper.vm.$nextTick()

      await wrapper.find('.btn-cancel').trigger('click')
      await wrapper.vm.$nextTick()

      expect(wrapper.find('.modal-overlay').exists()).toBe(false)
    })

    it('does not open modal when readonly', async () => {
      const wrapper = mount(SequenceEditor, {
        props: { initialZoom: 100, readonly: true }
      })
      wrapper.vm.setSequence('ATCGATCG')
      await wrapper.vm.$nextTick()

      await wrapper.find('.editor-svg').trigger('keydown', { key: 'A' })
      await wrapper.vm.$nextTick()

      expect(wrapper.find('.modal-overlay').exists()).toBe(false)
    })

    it('does not open modal when multiple ranges are selected', async () => {
      const wrapper = mount(SequenceEditor, {
        props: { initialZoom: 100 }
      })
      wrapper.vm.setSequence('A'.repeat(200))
      await wrapper.vm.$nextTick()

      // Get the selection composable and create multiple ranges
      const selection = wrapper.findComponent({ name: 'SelectionLayer' }).vm.selection
      selection.select('10..20')
      await wrapper.vm.$nextTick()

      // Add a second range
      selection.startSelection(50, true)
      await wrapper.vm.$nextTick()

      // Verify we have 2 ranges
      expect(selection.domain.value.ranges).toHaveLength(2)

      // Try to open modal with DNA key
      await wrapper.find('.editor-svg').trigger('keydown', { key: 'A' })
      await wrapper.vm.$nextTick()

      // Modal should NOT open
      expect(wrapper.find('.modal-overlay').exists()).toBe(false)
    })
  })

  describe('Ctrl+V paste', () => {
    // Helper to mock clipboard API
    function mockClipboard(readTextFn) {
      const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
      Object.defineProperty(navigator, 'clipboard', {
        value: { readText: readTextFn },
        writable: true,
        configurable: true
      })
      return () => {
        if (originalClipboard) {
          Object.defineProperty(navigator, 'clipboard', originalClipboard)
        } else {
          delete navigator.clipboard
        }
      }
    }

    it('opens insert modal with clipboard content on Ctrl+V', async () => {
      const restore = mockClipboard(mock(() => Promise.resolve('GATTACA')))

      const wrapper = mount(SequenceEditor, {
        props: { initialZoom: 100 }
      })
      wrapper.vm.setSequence('ATCGATCG')
      wrapper.vm.setCursor(4)  // Creates a cursor selection at position 4
      await wrapper.vm.$nextTick()

      // Trigger Ctrl+V
      await wrapper.find('.editor-svg').trigger('keydown', { key: 'v', ctrlKey: true })
      await wrapper.vm.$nextTick()

      // Wait for async clipboard read
      await new Promise(resolve => setTimeout(resolve, 10))
      await wrapper.vm.$nextTick()

      // Modal should open with clipboard content
      expect(wrapper.find('.modal-overlay').exists()).toBe(true)
      expect(wrapper.find('.modal-input').element.value).toBe('GATTACA')

      restore()
    })

    it('does nothing when readonly', async () => {
      const mockReadText = mock(() => Promise.resolve('GATTACA'))
      const restore = mockClipboard(mockReadText)

      const wrapper = mount(SequenceEditor, {
        props: { initialZoom: 100, readonly: true }
      })
      wrapper.vm.setSequence('ATCGATCG')
      await wrapper.vm.$nextTick()

      // Trigger Ctrl+V
      await wrapper.find('.editor-svg').trigger('keydown', { key: 'v', ctrlKey: true })
      await wrapper.vm.$nextTick()

      // Modal should NOT open
      expect(wrapper.find('.modal-overlay').exists()).toBe(false)
      // Clipboard should NOT be read
      expect(mockReadText).not.toHaveBeenCalled()

      restore()
    })

    it('handles clipboard read error gracefully', async () => {
      const originalConsoleWarn = console.warn
      console.warn = mock(() => {})
      const restore = mockClipboard(mock(() => Promise.reject(new Error('Clipboard access denied'))))

      const wrapper = mount(SequenceEditor, {
        props: { initialZoom: 100 }
      })
      wrapper.vm.setSequence('ATCGATCG')
      wrapper.vm.setCursor(4)  // Creates a cursor selection at position 4
      await wrapper.vm.$nextTick()

      // Trigger Ctrl+V - should not throw
      await wrapper.find('.editor-svg').trigger('keydown', { key: 'v', ctrlKey: true })
      await wrapper.vm.$nextTick()

      // Wait for async clipboard read to fail
      await new Promise(resolve => setTimeout(resolve, 10))
      await wrapper.vm.$nextTick()

      // Modal should NOT open (no content)
      expect(wrapper.find('.modal-overlay').exists()).toBe(false)
      // Warning should be logged
      expect(console.warn).toHaveBeenCalled()

      restore()
      console.warn = originalConsoleWarn
    })

    it('does nothing when clipboard is empty', async () => {
      const restore = mockClipboard(mock(() => Promise.resolve('')))

      const wrapper = mount(SequenceEditor, {
        props: { initialZoom: 100 }
      })
      wrapper.vm.setSequence('ATCGATCG')
      wrapper.vm.setCursor(4)  // Creates a cursor selection at position 4
      await wrapper.vm.$nextTick()

      // Trigger Ctrl+V
      await wrapper.find('.editor-svg').trigger('keydown', { key: 'v', ctrlKey: true })
      await wrapper.vm.$nextTick()

      // Wait for async clipboard read
      await new Promise(resolve => setTimeout(resolve, 10))
      await wrapper.vm.$nextTick()

      // Modal should NOT open (empty clipboard)
      expect(wrapper.find('.modal-overlay').exists()).toBe(false)

      restore()
    })

    it('works with Cmd+V on Mac', async () => {
      const restore = mockClipboard(mock(() => Promise.resolve('ACGT')))

      const wrapper = mount(SequenceEditor, {
        props: { initialZoom: 100 }
      })
      wrapper.vm.setSequence('ATCGATCG')
      wrapper.vm.setCursor(4)  // Creates a cursor selection at position 4
      await wrapper.vm.$nextTick()

      // Trigger Cmd+V (metaKey instead of ctrlKey)
      await wrapper.find('.editor-svg').trigger('keydown', { key: 'v', metaKey: true })
      await wrapper.vm.$nextTick()

      // Wait for async clipboard read
      await new Promise(resolve => setTimeout(resolve, 10))
      await wrapper.vm.$nextTick()

      // Modal should open
      expect(wrapper.find('.modal-overlay').exists()).toBe(true)
      expect(wrapper.find('.modal-input').element.value).toBe('ACGT')

      restore()
    })

    it('opens in replace mode when there is a selection', async () => {
      const restore = mockClipboard(mock(() => Promise.resolve('GATTACA')))

      const wrapper = mount(SequenceEditor, {
        props: { initialZoom: 100 }
      })
      wrapper.vm.setSequence('ATCGATCG')
      await wrapper.vm.$nextTick()

      // Select positions 2..5
      const selection = wrapper.findComponent({ name: 'SelectionLayer' }).vm.selection
      selection.select('2..5')
      await wrapper.vm.$nextTick()

      // Trigger Ctrl+V
      await wrapper.find('.editor-svg').trigger('keydown', { key: 'v', ctrlKey: true })
      await wrapper.vm.$nextTick()

      // Wait for async clipboard read
      await new Promise(resolve => setTimeout(resolve, 10))
      await wrapper.vm.$nextTick()

      // Modal should open in replace mode
      expect(wrapper.find('.modal-overlay').exists()).toBe(true)
      expect(wrapper.find('.modal-label').text()).toContain('Replace')

      restore()
    })
  })
})
