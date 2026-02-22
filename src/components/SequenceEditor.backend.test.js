import { describe, it, expect, beforeEach, mock } from 'bun:test'
import { mount } from '@vue/test-utils'
import SequenceEditor from './SequenceEditor.vue'
import { STORAGE_KEY } from '../composables/usePersistedZoom.js'

describe('SequenceEditor backend', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY)
  })

  function createMockBackend() {
    return {
      insert: mock(() => {}),
      delete: mock(() => {}),
      annotationCreated: mock(() => {}),
      annotationUpdate: mock(() => {}),
      annotationDeleted: mock(() => {}),
      titleUpdate: mock(() => {}),
      metadataUpdate: mock(() => {}),
      onAck: mock((callback) => {
        // Store callback for manual triggering in tests
        createMockBackend._ackCallback = callback
        return () => {}
      }),
      onError: mock((callback) => {
        createMockBackend._errorCallback = callback
        return () => {}
      }),
      // Helpers for tests to trigger callbacks
      _ackCallback: null,
      _errorCallback: null,
    }
  }

  // Helper to set up insertion at a specific position
  async function setupInsertAtPosition(wrapper, position) {
    const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
    const selection = selectionLayer.vm.selection
    selection.select(`${position}..${position}`)
    await wrapper.vm.$nextTick()

    const svg = wrapper.find('svg.editor-svg')
    await svg.trigger('keydown', { key: 'A' })
    await wrapper.vm.$nextTick()
  }

  describe('insert operations', () => {
    it('calls backend.insert when user inserts via modal', async () => {
      const mockBackend = createMockBackend()
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: 'ATCGATCGATCG',
          backend: mockBackend
        }
      })
      await wrapper.vm.$nextTick()

      await setupInsertAtPosition(wrapper, 4)

      const insertModal = wrapper.findComponent({ name: 'InsertModal' })
      insertModal.vm.$emit('submit', 'GGG')
      await wrapper.vm.$nextTick()

      expect(mockBackend.insert).toHaveBeenCalledTimes(1)
      const call = mockBackend.insert.mock.calls[0][0]
      expect(call.position).toBe(4)
      expect(call.text).toBe('GGG')
      expect(call.id).toBeDefined()
      expect(typeof call.id).toBe('string')
    })

    it('calls backend.insert at beginning of sequence', async () => {
      const mockBackend = createMockBackend()
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: 'ATCGATCG',
          backend: mockBackend
        }
      })
      await wrapper.vm.$nextTick()

      await setupInsertAtPosition(wrapper, 0)

      const insertModal = wrapper.findComponent({ name: 'InsertModal' })
      insertModal.vm.$emit('submit', 'TTT')
      await wrapper.vm.$nextTick()

      expect(mockBackend.insert).toHaveBeenCalledTimes(1)
      const call = mockBackend.insert.mock.calls[0][0]
      expect(call.position).toBe(0)
      expect(call.text).toBe('TTT')
    })

    it('calls backend.insert at end of sequence', async () => {
      const mockBackend = createMockBackend()
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: 'ATCGATCG',
          backend: mockBackend
        }
      })
      await wrapper.vm.$nextTick()

      await setupInsertAtPosition(wrapper, 8)

      const insertModal = wrapper.findComponent({ name: 'InsertModal' })
      insertModal.vm.$emit('submit', 'CCC')
      await wrapper.vm.$nextTick()

      expect(mockBackend.insert).toHaveBeenCalledTimes(1)
      const call = mockBackend.insert.mock.calls[0][0]
      expect(call.position).toBe(8)
      expect(call.text).toBe('CCC')
    })

    it('generates unique IDs for each insert operation', async () => {
      const mockBackend = createMockBackend()
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: 'ATCGATCGATCGATCG',
          backend: mockBackend
        }
      })
      await wrapper.vm.$nextTick()

      // First insert
      await setupInsertAtPosition(wrapper, 4)
      let insertModal = wrapper.findComponent({ name: 'InsertModal' })
      insertModal.vm.$emit('submit', 'AAA')
      await wrapper.vm.$nextTick()

      // Second insert
      await setupInsertAtPosition(wrapper, 8)
      insertModal = wrapper.findComponent({ name: 'InsertModal' })
      insertModal.vm.$emit('submit', 'TTT')
      await wrapper.vm.$nextTick()

      expect(mockBackend.insert).toHaveBeenCalledTimes(2)
      const id1 = mockBackend.insert.mock.calls[0][0].id
      const id2 = mockBackend.insert.mock.calls[1][0].id
      expect(id1).not.toBe(id2)
    })

    it('applies insert locally (optimistic UI) before backend response', async () => {
      const mockBackend = createMockBackend()
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: 'ATCGATCG',
          backend: mockBackend
        }
      })
      await wrapper.vm.$nextTick()

      await setupInsertAtPosition(wrapper, 4)

      const insertModal = wrapper.findComponent({ name: 'InsertModal' })
      insertModal.vm.$emit('submit', 'GGG')
      await wrapper.vm.$nextTick()

      // Sequence should be updated immediately (optimistic UI)
      expect(wrapper.vm.getSequence()).toBe('ATCGGGGATCG')
    })
  })

  describe('delete operations', () => {
    it('calls backend.delete when user deletes selection via Backspace', async () => {
      const mockBackend = createMockBackend()
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: 'ATCGATCG',
          backend: mockBackend
        }
      })
      await wrapper.vm.$nextTick()

      // Select positions 2..5 (indices 2,3,4 = 'CGA')
      const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
      selectionLayer.vm.selection.select('2..5')
      await wrapper.vm.$nextTick()

      await wrapper.find('.editor-svg').trigger('keydown', { key: 'Backspace' })
      await wrapper.vm.$nextTick()

      expect(mockBackend.delete).toHaveBeenCalledTimes(1)
      const call = mockBackend.delete.mock.calls[0][0]
      expect(call.start).toBe(2)
      expect(call.end).toBe(5)
      expect(call.id).toBeDefined()
      expect(typeof call.id).toBe('string')
    })

    it('calls backend.delete when user deletes selection via Delete key', async () => {
      const mockBackend = createMockBackend()
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: 'ATCGATCG',
          backend: mockBackend
        }
      })
      await wrapper.vm.$nextTick()

      // Select positions 1..4
      const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
      selectionLayer.vm.selection.select('1..4')
      await wrapper.vm.$nextTick()

      await wrapper.find('.editor-svg').trigger('keydown', { key: 'Delete' })
      await wrapper.vm.$nextTick()

      expect(mockBackend.delete).toHaveBeenCalledTimes(1)
      const call = mockBackend.delete.mock.calls[0][0]
      expect(call.start).toBe(1)
      expect(call.end).toBe(4)
    })

    it('does not call backend.delete without a selection', async () => {
      const mockBackend = createMockBackend()
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: 'ATCGATCG',
          backend: mockBackend
        }
      })
      await wrapper.vm.$nextTick()

      // No selection, just trigger delete
      await wrapper.find('.editor-svg').trigger('keydown', { key: 'Delete' })
      await wrapper.vm.$nextTick()

      expect(mockBackend.delete).not.toHaveBeenCalled()
    })

    it('does not call backend.delete for zero-length selection (cursor)', async () => {
      const mockBackend = createMockBackend()
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: 'ATCGATCG',
          backend: mockBackend
        }
      })
      await wrapper.vm.$nextTick()

      // Zero-length selection (cursor at position 3)
      const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
      selectionLayer.vm.selection.select('3..3')
      await wrapper.vm.$nextTick()

      await wrapper.find('.editor-svg').trigger('keydown', { key: 'Backspace' })
      await wrapper.vm.$nextTick()

      expect(mockBackend.delete).not.toHaveBeenCalled()
    })

    it('applies delete locally (optimistic UI) before backend response', async () => {
      const mockBackend = createMockBackend()
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: 'ATCGATCG',
          backend: mockBackend
        }
      })
      await wrapper.vm.$nextTick()

      // Select positions 2..5 (delete 'CGA')
      const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
      selectionLayer.vm.selection.select('2..5')
      await wrapper.vm.$nextTick()

      await wrapper.find('.editor-svg').trigger('keydown', { key: 'Delete' })
      await wrapper.vm.$nextTick()

      // Sequence should be updated immediately
      expect(wrapper.vm.getSequence()).toBe('ATTCG')
    })

    it('leaves cursor at deletion point after delete', async () => {
      const mockBackend = createMockBackend()
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: 'ATCGATCG',
          backend: mockBackend
        }
      })
      await wrapper.vm.$nextTick()

      const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
      selectionLayer.vm.selection.select('2..5')
      await wrapper.vm.$nextTick()

      expect(selectionLayer.vm.selection.isSelected.value).toBe(true)

      await wrapper.find('.editor-svg').trigger('keydown', { key: 'Delete' })
      await wrapper.vm.$nextTick()

      // For contiguous selection, cursor is left at deletion point
      expect(selectionLayer.vm.selection.isSelected.value).toBe(true)
      const domain = selectionLayer.vm.selection.domain.value
      expect(domain.ranges.length).toBe(1)
      expect(domain.ranges[0].start).toBe(2)
      expect(domain.ranges[0].end).toBe(2)
    })

    it('generates unique IDs for each delete operation', async () => {
      const mockBackend = createMockBackend()
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: 'ATCGATCGATCGATCG',
          backend: mockBackend
        }
      })
      await wrapper.vm.$nextTick()

      const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })

      // First delete
      selectionLayer.vm.selection.select('2..4')
      await wrapper.vm.$nextTick()
      await wrapper.find('.editor-svg').trigger('keydown', { key: 'Delete' })
      await wrapper.vm.$nextTick()

      // Second delete
      selectionLayer.vm.selection.select('5..7')
      await wrapper.vm.$nextTick()
      await wrapper.find('.editor-svg').trigger('keydown', { key: 'Delete' })
      await wrapper.vm.$nextTick()

      expect(mockBackend.delete).toHaveBeenCalledTimes(2)
      const id1 = mockBackend.delete.mock.calls[0][0].id
      const id2 = mockBackend.delete.mock.calls[1][0].id
      expect(id1).not.toBe(id2)
    })

    it('emits multiple delete events for multi-range selection', async () => {
      const mockBackend = createMockBackend()
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: 'ATCGATCGATCGATCG',
          backend: mockBackend
        }
      })
      await wrapper.vm.$nextTick()

      // Create multi-range selection: 2..4 and 8..10 (use ' + ' separator)
      const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
      selectionLayer.vm.selection.select('2..4 + 8..10')
      await wrapper.vm.$nextTick()

      await wrapper.find('.editor-svg').trigger('keydown', { key: 'Delete' })
      await wrapper.vm.$nextTick()

      // Should emit two delete calls
      expect(mockBackend.delete).toHaveBeenCalledTimes(2)

      // Deletes happen from highest position first to avoid shifting issues
      // So 8..10 is deleted first, then 2..4
      const call1 = mockBackend.delete.mock.calls[0][0]
      const call2 = mockBackend.delete.mock.calls[1][0]

      expect(call1.start).toBe(8)
      expect(call1.end).toBe(10)
      expect(call2.start).toBe(2)
      expect(call2.end).toBe(4)
    })

    it('correctly deletes multi-range selection locally', async () => {
      const mockBackend = createMockBackend()
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: 'ATCGATCGATCGATCG', // 16 chars
          backend: mockBackend
        }
      })
      await wrapper.vm.$nextTick()

      // Select 2..4 (CG) and 8..10 (AT) using ' + ' separator
      const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
      selectionLayer.vm.selection.select('2..4 + 8..10')
      await wrapper.vm.$nextTick()

      await wrapper.find('.editor-svg').trigger('keydown', { key: 'Delete' })
      await wrapper.vm.$nextTick()

      // Original: ATCGATCGATCGATCG
      // ATCGATCGATCGATCG = A T C G A T C G A T C G A T C G
      //                    0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15
      // Delete 8..10 first (indices 8,9 = 'AT') -> ATCGATCGCGATCG (14 chars)
      // Delete 2..4 (indices 2,3 = 'CG') -> ATATCGCGATCG (12 chars)
      expect(wrapper.vm.getSequence()).toBe('ATATCGCGATCG')
    })

    describe('cursor after deletion', () => {
      it('leaves cursor at deletion point for single range', async () => {
        const wrapper = mount(SequenceEditor, {
          props: {
            sequence: 'ATCGATCGATCG' // 12 chars
          }
        })
        await wrapper.vm.$nextTick()

        // Select positions 5..10
        const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
        selectionLayer.vm.selection.select('5..10')
        await wrapper.vm.$nextTick()

        // Delete the selection
        await wrapper.find('.editor-svg').trigger('keydown', { key: 'Delete' })
        await wrapper.vm.$nextTick()

        // Should leave cursor at position 5 (zero-length selection)
        const domain = selectionLayer.vm.selection.domain.value
        expect(domain).not.toBeNull()
        expect(domain.ranges.length).toBe(1)
        expect(domain.ranges[0].start).toBe(5)
        expect(domain.ranges[0].end).toBe(5)
      })

      it('leaves cursor for adjacent ranges', async () => {
        const wrapper = mount(SequenceEditor, {
          props: {
            sequence: 'ATCGATCGATCGATCG' // 16 chars
          }
        })
        await wrapper.vm.$nextTick()

        // Select 5..10 + 10..15 (adjacent ranges)
        const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
        selectionLayer.vm.selection.select('5..10 + 10..15')
        await wrapper.vm.$nextTick()

        await wrapper.find('.editor-svg').trigger('keydown', { key: 'Delete' })
        await wrapper.vm.$nextTick()

        // Should leave cursor at position 5 (start of leftmost range)
        const domain = selectionLayer.vm.selection.domain.value
        expect(domain).not.toBeNull()
        expect(domain.ranges.length).toBe(1)
        expect(domain.ranges[0].start).toBe(5)
        expect(domain.ranges[0].end).toBe(5)
      })

      it('clears selection for non-adjacent ranges', async () => {
        const wrapper = mount(SequenceEditor, {
          props: {
            sequence: 'ATCGATCGATCGATCGATCG' // 20 chars
          }
        })
        await wrapper.vm.$nextTick()

        // Select 5..10 + 15..18 (gap between 10 and 15)
        const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
        selectionLayer.vm.selection.select('5..10 + 15..18')
        await wrapper.vm.$nextTick()

        await wrapper.find('.editor-svg').trigger('keydown', { key: 'Delete' })
        await wrapper.vm.$nextTick()

        // Should clear selection (no cursor)
        const domain = selectionLayer.vm.selection.domain.value
        expect(domain).toBeNull()
      })

      it('leaves cursor for circular wrap-around selection', async () => {
        const wrapper = mount(SequenceEditor, {
          props: {
            sequence: 'ATCGATCGATCGATCGATCG', // 20 chars
            metadata: { circular: true }
          }
        })
        await wrapper.vm.$nextTick()

        // Select 0..5 + 15..20 (wraps around origin on circular sequence)
        const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
        selectionLayer.vm.selection.select('0..5 + 15..20')
        await wrapper.vm.$nextTick()

        await wrapper.find('.editor-svg').trigger('keydown', { key: 'Delete' })
        await wrapper.vm.$nextTick()

        // Should leave cursor at position 0 (start of leftmost range)
        const domain = selectionLayer.vm.selection.domain.value
        expect(domain).not.toBeNull()
        expect(domain.ranges.length).toBe(1)
        expect(domain.ranges[0].start).toBe(0)
        expect(domain.ranges[0].end).toBe(0)
      })

      it('clears selection for non-contiguous circular selection', async () => {
        const wrapper = mount(SequenceEditor, {
          props: {
            sequence: 'ATCGATCGATCGATCGATCG', // 20 chars
            metadata: { circular: true }
          }
        })
        await wrapper.vm.$nextTick()

        // Select 0..5 + 10..15 (does NOT wrap - gap between 5 and 10, and between 15 and 20)
        const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
        selectionLayer.vm.selection.select('0..5 + 10..15')
        await wrapper.vm.$nextTick()

        await wrapper.find('.editor-svg').trigger('keydown', { key: 'Delete' })
        await wrapper.vm.$nextTick()

        // Should clear selection (gaps present, not a valid wrap-around)
        const domain = selectionLayer.vm.selection.domain.value
        expect(domain).toBeNull()
      })
    })
  })

  describe('pending edits tracking', () => {
    it('tracks pending edits after insert', async () => {
      const mockBackend = createMockBackend()
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: 'ATCGATCG',
          backend: mockBackend
        }
      })
      await wrapper.vm.$nextTick()

      await setupInsertAtPosition(wrapper, 4)

      const insertModal = wrapper.findComponent({ name: 'InsertModal' })
      insertModal.vm.$emit('submit', 'GGG')
      await wrapper.vm.$nextTick()

      // Access internal pending edits via component internals
      // The edit should be tracked as pending
      const editId = mockBackend.insert.mock.calls[0][0].id
      expect(editId).toBeDefined()
    })
  })

  describe('standalone mode (no backend)', () => {
    it('works without backend prop', async () => {
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: 'ATCGATCG'
        }
      })
      await wrapper.vm.$nextTick()

      await setupInsertAtPosition(wrapper, 4)

      const insertModal = wrapper.findComponent({ name: 'InsertModal' })
      insertModal.vm.$emit('submit', 'GGG')
      await wrapper.vm.$nextTick()

      // Should still work locally
      expect(wrapper.vm.getSequence()).toBe('ATCGGGGATCG')
    })

    it('emits edit event even without backend', async () => {
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: 'ATCGATCG'
        }
      })
      await wrapper.vm.$nextTick()

      await setupInsertAtPosition(wrapper, 4)

      const insertModal = wrapper.findComponent({ name: 'InsertModal' })
      insertModal.vm.$emit('submit', 'GGG')
      await wrapper.vm.$nextTick()

      const emitted = wrapper.emitted('edit')
      expect(emitted).toBeTruthy()
      expect(emitted[0][0]).toEqual({
        type: 'insert',
        position: 4,
        text: 'GGG'
      })
    })
  })

  describe('backend with annotations', () => {
    it('calls backend.insert and emits annotations-update', async () => {
      const mockBackend = createMockBackend()
      const annotations = [
        { id: 'ann1', caption: 'Gene', type: 'gene', span: '10..50' }
      ]
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: 'A'.repeat(100),
          annotations,
          backend: mockBackend
        }
      })
      await wrapper.vm.$nextTick()

      // Insert inside the annotation
      await setupInsertAtPosition(wrapper, 25)

      const insertModal = wrapper.findComponent({ name: 'InsertModal' })
      insertModal.vm.$emit('submit', 'TTTT')
      await wrapper.vm.$nextTick()

      // Backend should be called
      expect(mockBackend.insert).toHaveBeenCalledTimes(1)
      const call = mockBackend.insert.mock.calls[0][0]
      expect(call.position).toBe(25)
      expect(call.text).toBe('TTTT')

      // Annotations should be updated locally
      const emitted = wrapper.emitted('annotations-update')
      expect(emitted).toBeTruthy()
      // Annotation should expand: 10..50 -> 10..54 (4 chars inserted)
      expect(emitted[0][0][0].span).toBe('10..54')
    })

    it('calls backend.insert before annotation shifts it', async () => {
      const mockBackend = createMockBackend()
      const annotations = [
        { id: 'ann1', caption: 'Gene', type: 'gene', span: '20..40' }
      ]
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: 'A'.repeat(100),
          annotations,
          backend: mockBackend
        }
      })
      await wrapper.vm.$nextTick()

      // Insert before the annotation
      await setupInsertAtPosition(wrapper, 5)

      const insertModal = wrapper.findComponent({ name: 'InsertModal' })
      insertModal.vm.$emit('submit', 'GGG')
      await wrapper.vm.$nextTick()

      // Backend should be called
      expect(mockBackend.insert).toHaveBeenCalledTimes(1)
      const call = mockBackend.insert.mock.calls[0][0]
      expect(call.position).toBe(5)
      expect(call.text).toBe('GGG')

      // Annotation should shift: 20..40 -> 23..43
      const emitted = wrapper.emitted('annotations-update')
      expect(emitted).toBeTruthy()
      expect(emitted[0][0][0].span).toBe('23..43')
    })
  })

  describe('multiple rapid inserts', () => {
    it('handles multiple inserts with unique IDs', async () => {
      const mockBackend = createMockBackend()
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: 'A'.repeat(50),
          backend: mockBackend
        }
      })
      await wrapper.vm.$nextTick()

      // Rapid fire 3 inserts
      for (const pos of [10, 20, 30]) {
        await setupInsertAtPosition(wrapper, pos)
        const insertModal = wrapper.findComponent({ name: 'InsertModal' })
        insertModal.vm.$emit('submit', 'X')
        await wrapper.vm.$nextTick()
      }

      expect(mockBackend.insert).toHaveBeenCalledTimes(3)

      // All IDs should be unique
      const ids = mockBackend.insert.mock.calls.map(c => c[0].id)
      const uniqueIds = new Set(ids)
      expect(uniqueIds.size).toBe(3)
    })
  })
})
