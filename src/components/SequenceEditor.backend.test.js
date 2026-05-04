import { parseSpan, parseRange } from '../../test/parse-utils.js'
import { describe, it, expect, beforeEach, mock } from 'bun:test'
import { mount } from '@vue/test-utils'
import SequenceEditor from './SequenceEditor.vue'
import { STORAGE_KEY } from '../composables/usePersistedZoom.js'
import { SequenceDocument } from '../composables/SequenceDocument.js'
import { Span, Range, Orientation } from '../utils/dna.js'

// Helper to create a SequenceDocument for tests
function createDoc(sequence = '', annotations = [], circular = false, backend = null) {
  const normalizedAnnotations = annotations.map(annotation => ({
    ...annotation,
    span: typeof annotation.span === 'string' ? parseSpan(annotation.span) : annotation.span
  }))
  return new SequenceDocument({ sequence, annotations: normalizedAnnotations, circular, backend })
}

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
    selection.select(parseSpan(`${position}..${position}`))
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
          sequence: createDoc('ATCGATCGATCG', [], false, mockBackend),
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
          sequence: createDoc('ATCGATCG', [], false, mockBackend),
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
          sequence: createDoc('ATCGATCG', [], false, mockBackend),
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
          sequence: createDoc('ATCGATCGATCGATCG', [], false, mockBackend),
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
          sequence: createDoc('ATCGATCG', [], false, mockBackend),
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
    // Helper to confirm delete in the confirmation dialog (teleported to body)
    async function confirmDelete(wrapper) {
      await wrapper.vm.$nextTick()
      // The dialog is teleported to body, so we need to query from document
      const confirmBtn = document.querySelector('.confirm-dialog .btn-danger')
      if (confirmBtn) {
        confirmBtn.click()
        await wrapper.vm.$nextTick()
      }
    }

    it('calls backend.delete when user deletes selection via Backspace', async () => {
      const mockBackend = createMockBackend()
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: createDoc('ATCGATCG', [], false, mockBackend),
        }
      })
      await wrapper.vm.$nextTick()

      // Select positions 2..5 (indices 2,3,4 = 'CGA')
      const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
      selectionLayer.vm.selection.select([new Range(2, 5)])
      await wrapper.vm.$nextTick()

      await wrapper.find('.editor-svg').trigger('keydown', { key: 'Backspace' })
      await wrapper.vm.$nextTick()

      // Confirm the delete in the dialog
      await confirmDelete(wrapper)

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
          sequence: createDoc('ATCGATCG', [], false, mockBackend),
        }
      })
      await wrapper.vm.$nextTick()

      // Select positions 1..4
      const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
      selectionLayer.vm.selection.select([new Range(1, 4)])
      await wrapper.vm.$nextTick()

      await wrapper.find('.editor-svg').trigger('keydown', { key: 'Delete' })
      await wrapper.vm.$nextTick()

      // Confirm the delete in the dialog
      await confirmDelete(wrapper)

      expect(mockBackend.delete).toHaveBeenCalledTimes(1)
      const call = mockBackend.delete.mock.calls[0][0]
      expect(call.start).toBe(1)
      expect(call.end).toBe(4)
    })

    it('does not call backend.delete without a selection', async () => {
      const mockBackend = createMockBackend()
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: createDoc('ATCGATCG', [], false, mockBackend),
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
          sequence: createDoc('ATCGATCG', [], false, mockBackend),
        }
      })
      await wrapper.vm.$nextTick()

      // Zero-length selection (cursor at position 3)
      const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
      selectionLayer.vm.selection.select([new Range(3, 3)])
      await wrapper.vm.$nextTick()

      await wrapper.find('.editor-svg').trigger('keydown', { key: 'Backspace' })
      await wrapper.vm.$nextTick()

      expect(mockBackend.delete).not.toHaveBeenCalled()
    })

    it('applies delete locally (optimistic UI) before backend response', async () => {
      const mockBackend = createMockBackend()
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: createDoc('ATCGATCG', [], false, mockBackend),
        }
      })
      await wrapper.vm.$nextTick()

      // Select positions 2..5 (delete 'CGA')
      const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
      selectionLayer.vm.selection.select([new Range(2, 5)])
      await wrapper.vm.$nextTick()

      await wrapper.find('.editor-svg').trigger('keydown', { key: 'Delete' })
      await wrapper.vm.$nextTick()

      // Confirm the delete in the dialog
      await confirmDelete(wrapper)

      // Sequence should be updated immediately
      expect(wrapper.vm.getSequence()).toBe('ATTCG')
    })

    it('leaves cursor at deletion point after delete', async () => {
      const mockBackend = createMockBackend()
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: createDoc('ATCGATCG', [], false, mockBackend),
        }
      })
      await wrapper.vm.$nextTick()

      const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
      selectionLayer.vm.selection.select([new Range(2, 5)])
      await wrapper.vm.$nextTick()

      expect(selectionLayer.vm.selection.isSelected.value).toBe(true)

      await wrapper.find('.editor-svg').trigger('keydown', { key: 'Delete' })
      await wrapper.vm.$nextTick()

      // Confirm the delete in the dialog
      await confirmDelete(wrapper)

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
          sequence: createDoc('ATCGATCGATCGATCG', [], false, mockBackend),
        }
      })
      await wrapper.vm.$nextTick()

      const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })

      // First delete
      selectionLayer.vm.selection.select([new Range(2, 4)])
      await wrapper.vm.$nextTick()
      await wrapper.find('.editor-svg').trigger('keydown', { key: 'Delete' })
      await wrapper.vm.$nextTick()
      await confirmDelete(wrapper)

      // Second delete
      selectionLayer.vm.selection.select([new Range(5, 7)])
      await wrapper.vm.$nextTick()
      await wrapper.find('.editor-svg').trigger('keydown', { key: 'Delete' })
      await wrapper.vm.$nextTick()
      await confirmDelete(wrapper)

      expect(mockBackend.delete).toHaveBeenCalledTimes(2)
      const id1 = mockBackend.delete.mock.calls[0][0].id
      const id2 = mockBackend.delete.mock.calls[1][0].id
      expect(id1).not.toBe(id2)
    })

    it('emits multiple delete events for multi-range selection', async () => {
      const mockBackend = createMockBackend()
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: createDoc('ATCGATCGATCGATCG', [], false, mockBackend),
        }
      })
      await wrapper.vm.$nextTick()

      // Create multi-range selection: 2..4 and 8..10 (use ' + ' separator)
      const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
      selectionLayer.vm.selection.select([new Range(2, 4), new Range(8, 10)])
      await wrapper.vm.$nextTick()

      await wrapper.find('.editor-svg').trigger('keydown', { key: 'Delete' })
      await wrapper.vm.$nextTick()

      // Confirm the delete in the dialog
      await confirmDelete(wrapper)

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
          sequence: createDoc('ATCGATCGATCGATCG', [], false, mockBackend) // 16 chars
        }
      })
      await wrapper.vm.$nextTick()

      // Select 2..4 (CG) and 8..10 (AT) using ' + ' separator
      const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
      selectionLayer.vm.selection.select([new Range(2, 4), new Range(8, 10)])
      await wrapper.vm.$nextTick()

      await wrapper.find('.editor-svg').trigger('keydown', { key: 'Delete' })
      await wrapper.vm.$nextTick()

      // Confirm the delete in the dialog
      await confirmDelete(wrapper)

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
            sequence: createDoc('ATCGATCGATCG') // 12 chars
          }
        })
        await wrapper.vm.$nextTick()

        // Select positions 5..10
        const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
        selectionLayer.vm.selection.select([new Range(5, 10)])
        await wrapper.vm.$nextTick()

        // Delete the selection
        await wrapper.find('.editor-svg').trigger('keydown', { key: 'Delete' })
        await wrapper.vm.$nextTick()

        // Confirm the delete in the dialog
        await confirmDelete(wrapper)

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
            sequence: createDoc('ATCGATCGATCGATCG') // 16 chars
          }
        })
        await wrapper.vm.$nextTick()

        // Select 5..10 + 10..15 (adjacent ranges)
        const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
        selectionLayer.vm.selection.select([new Range(5, 10), new Range(10, 15)])
        await wrapper.vm.$nextTick()

        await wrapper.find('.editor-svg').trigger('keydown', { key: 'Delete' })
        await wrapper.vm.$nextTick()

        // Confirm the delete in the dialog
        await confirmDelete(wrapper)

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
            sequence: createDoc('ATCGATCGATCGATCGATCG') // 20 chars
          }
        })
        await wrapper.vm.$nextTick()

        // Select 5..10 + 15..18 (gap between 10 and 15)
        const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
        selectionLayer.vm.selection.select([new Range(5, 10), new Range(15, 18)])
        await wrapper.vm.$nextTick()

        await wrapper.find('.editor-svg').trigger('keydown', { key: 'Delete' })
        await wrapper.vm.$nextTick()

        // Confirm the delete in the dialog
        await confirmDelete(wrapper)

        // Should clear selection (no cursor)
        const domain = selectionLayer.vm.selection.domain.value
        expect(domain).toBeNull()
      })

      it('leaves cursor for circular wrap-around selection', async () => {
        const wrapper = mount(SequenceEditor, {
          props: {
            sequence: createDoc('ATCGATCGATCGATCGATCG', [], true) // 20 chars, circular
          }
        })
        await wrapper.vm.$nextTick()

        // Select 0..5 + 15..20 (wraps around origin on circular sequence)
        const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
        selectionLayer.vm.selection.select([new Range(0, 5), new Range(15, 20)])
        await wrapper.vm.$nextTick()

        await wrapper.find('.editor-svg').trigger('keydown', { key: 'Delete' })
        await wrapper.vm.$nextTick()

        // Confirm the delete in the dialog
        await confirmDelete(wrapper)

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
            sequence: createDoc('ATCGATCGATCGATCGATCG', [], true) // 20 chars, circular
          }
        })
        await wrapper.vm.$nextTick()

        // Select 0..5 + 10..15 (does NOT wrap - gap between 5 and 10, and between 15 and 20)
        const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
        selectionLayer.vm.selection.select([new Range(0, 5), new Range(10, 15)])
        await wrapper.vm.$nextTick()

        await wrapper.find('.editor-svg').trigger('keydown', { key: 'Delete' })
        await wrapper.vm.$nextTick()

        // Confirm the delete in the dialog
        await confirmDelete(wrapper)

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
          sequence: createDoc('ATCGATCG', [], false, mockBackend),
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
          sequence: createDoc('ATCGATCG')
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
          sequence: createDoc('ATCGATCG')
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
          sequence: createDoc('A'.repeat(100), annotations, false, mockBackend)
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
      expect(emitted[0][0][0].span.toJSON()).toBe('10..54')
    })

    it('calls backend.insert before annotation shifts it', async () => {
      const mockBackend = createMockBackend()
      const annotations = [
        { id: 'ann1', caption: 'Gene', type: 'gene', span: '20..40' }
      ]
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: createDoc('A'.repeat(100), annotations, false, mockBackend)
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
      expect(emitted[0][0][0].span.toJSON()).toBe('23..43')
    })
  })

  describe('multiple rapid inserts', () => {
    it('handles multiple inserts with unique IDs', async () => {
      const mockBackend = createMockBackend()
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: createDoc('A'.repeat(50), [], false, mockBackend)
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

  describe('reverse complement replacement', () => {
    it('should replace with reverse complement when selection is on minus strand', async () => {
      const mockBackend = createMockBackend()
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: createDoc('ATCGATCGATCG', [], false, mockBackend) // 12 bases
        }
      })
      await wrapper.vm.$nextTick()

      // Select positions 4..8 on minus strand
      const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
      selectionLayer.vm.selection.select([new Range(4, 8, Orientation.MINUS)]) // Minus strand selection
      await wrapper.vm.$nextTick()

      // Trigger insert modal
      const svg = wrapper.find('svg.editor-svg')
      await svg.trigger('keydown', { key: 'A' })
      await wrapper.vm.$nextTick()

      // Submit replacement text 'AAAA' - should be reverse complemented to 'TTTT'
      const insertModal = wrapper.findComponent({ name: 'InsertModal' })
      insertModal.vm.$emit('submit', 'AAAA', 'default')
      await wrapper.vm.$nextTick()

      // The sequence should have TTTT inserted (reverse complement of AAAA)
      // Original: ATCGATCGATCG, replacing positions 4..8 (ATCG) with TTTT
      const newSeq = wrapper.vm.getSequence()
      expect(newSeq).toBe('ATCGTTTTATCG')
    })

    it('should not reverse complement when selection is on plus strand', async () => {
      const mockBackend = createMockBackend()
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: createDoc('ATCGATCGATCG', [], false, mockBackend) // 12 bases
        }
      })
      await wrapper.vm.$nextTick()

      // Select positions 4..8 on plus strand (default)
      const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
      selectionLayer.vm.selection.select([new Range(4, 8)]) // Plus strand selection
      await wrapper.vm.$nextTick()

      // Trigger insert modal
      const svg = wrapper.find('svg.editor-svg')
      await svg.trigger('keydown', { key: 'A' })
      await wrapper.vm.$nextTick()

      // Submit replacement text 'AAAA' - should be inserted as-is
      const insertModal = wrapper.findComponent({ name: 'InsertModal' })
      insertModal.vm.$emit('submit', 'AAAA', 'default')
      await wrapper.vm.$nextTick()

      // The sequence should have AAAA inserted directly
      const newSeq = wrapper.vm.getSequence()
      expect(newSeq).toBe('ATCGAAAAATCG')
    })

    it('should reverse complement with IUPAC codes', async () => {
      const mockBackend = createMockBackend()
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: createDoc('ATCGATCGATCG', [], false, mockBackend),
        }
      })
      await wrapper.vm.$nextTick()

      // Select positions 4..8 on minus strand
      const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
      selectionLayer.vm.selection.select([new Range(4, 8, Orientation.MINUS)])
      await wrapper.vm.$nextTick()

      // Trigger insert modal
      const svg = wrapper.find('svg.editor-svg')
      await svg.trigger('keydown', { key: 'A' })
      await wrapper.vm.$nextTick()

      // Submit 'ATRY' - reverse complement:
      // A->T, T->A, R->Y, Y->R: complement of ATRY = TAYR
      // Reverse of TAYR = RYAT
      const insertModal = wrapper.findComponent({ name: 'InsertModal' })
      insertModal.vm.$emit('submit', 'ATRY', 'default')
      await wrapper.vm.$nextTick()

      const newSeq = wrapper.vm.getSequence()
      expect(newSeq).toBe('ATCGRYATATCG')
    })

    it('should preserve minus strand orientation in selection after replace', async () => {
      const mockBackend = createMockBackend()
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: createDoc('ATCGATCGATCG', [], false, mockBackend) // 12 bases
        }
      })
      await wrapper.vm.$nextTick()

      // Select positions 4..8 on minus strand
      const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
      selectionLayer.vm.selection.select([new Range(4, 8, Orientation.MINUS)]) // Minus strand selection
      await wrapper.vm.$nextTick()

      // Verify initial selection is minus strand
      expect(selectionLayer.vm.selection.domain.value.orientation).toBe(-1) // Orientation.MINUS

      // Trigger insert modal
      const svg = wrapper.find('svg.editor-svg')
      await svg.trigger('keydown', { key: 'A' })
      await wrapper.vm.$nextTick()

      // Submit replacement text 'AAAA'
      const insertModal = wrapper.findComponent({ name: 'InsertModal' })
      insertModal.vm.$emit('submit', 'AAAA', 'default')
      await wrapper.vm.$nextTick()

      // After replacement, selection should still be minus strand
      const domain = selectionLayer.vm.selection.domain.value
      expect(domain).toBeTruthy()
      expect(domain.ranges.length).toBe(1)
      expect(domain.orientation).toBe(-1) // Should still be Orientation.MINUS
    })

    it('should preserve plus strand orientation in selection after replace', async () => {
      const mockBackend = createMockBackend()
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: createDoc('ATCGATCGATCG', [], false, mockBackend) // 12 bases
        }
      })
      await wrapper.vm.$nextTick()

      // Select positions 4..8 on plus strand
      const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
      selectionLayer.vm.selection.select([new Range(4, 8)]) // Plus strand selection
      await wrapper.vm.$nextTick()

      // Verify initial selection is plus strand
      expect(selectionLayer.vm.selection.domain.value.orientation).toBe(1) // Orientation.PLUS

      // Trigger insert modal
      const svg = wrapper.find('svg.editor-svg')
      await svg.trigger('keydown', { key: 'A' })
      await wrapper.vm.$nextTick()

      // Submit replacement text 'AAAA'
      const insertModal = wrapper.findComponent({ name: 'InsertModal' })
      insertModal.vm.$emit('submit', 'AAAA', 'default')
      await wrapper.vm.$nextTick()

      // After replacement, selection should still be plus strand
      const domain = selectionLayer.vm.selection.domain.value
      expect(domain).toBeTruthy()
      expect(domain.ranges.length).toBe(1)
      expect(domain.orientation).toBe(1) // Should still be Orientation.PLUS
    })
  })

  describe('preserveAnnotations option', () => {
    it('should not alter annotations when annotationMode is preserve', async () => {
      const mockBackend = createMockBackend()
      const annotations = [
        { id: 'ann1', caption: 'Gene', type: 'gene', span: '10..30' }
      ]
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: createDoc('A'.repeat(100), annotations, false, mockBackend)
        }
      })
      await wrapper.vm.$nextTick()

      // Select positions 15..25 (inside the annotation)
      const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
      selectionLayer.vm.selection.select([new Range(15, 25)])
      await wrapper.vm.$nextTick()

      // Trigger insert modal to open (by typing a character)
      const svg = wrapper.find('svg.editor-svg')
      await svg.trigger('keydown', { key: 'A' })
      await wrapper.vm.$nextTick()

      // Submit with annotationMode='preserve' (equal length replacement: 10 chars -> 10 chars)
      const insertModal = wrapper.findComponent({ name: 'InsertModal' })
      insertModal.vm.$emit('submit', 'TTTTTTTTTT', 'preserve')
      await wrapper.vm.$nextTick()

      // Backend should receive delete and insert calls
      expect(mockBackend.delete).toHaveBeenCalledTimes(1)
      expect(mockBackend.insert).toHaveBeenCalledTimes(1)

      // Annotation should NOT be updated (preserved at original position)
      const emitted = wrapper.emitted('annotations-update')
      // When annotationMode is 'preserve', annotations-update should not be emitted
      // because adjustAnnotationsForReplace is skipped
      expect(emitted).toBeFalsy()
    })

    it('should alter annotations normally when annotationMode is default', async () => {
      const mockBackend = createMockBackend()
      const annotations = [
        { id: 'ann1', caption: 'Gene', type: 'gene', span: '10..30' }
      ]
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: createDoc('A'.repeat(100), annotations, false, mockBackend)
        }
      })
      await wrapper.vm.$nextTick()

      // Select positions 15..25 (inside the annotation)
      const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
      selectionLayer.vm.selection.select([new Range(15, 25)])
      await wrapper.vm.$nextTick()

      // Trigger insert modal
      const svg = wrapper.find('svg.editor-svg')
      await svg.trigger('keydown', { key: 'A' })
      await wrapper.vm.$nextTick()

      // Submit with annotationMode='default'
      const insertModal = wrapper.findComponent({ name: 'InsertModal' })
      insertModal.vm.$emit('submit', 'TTTTTTTTTT', 'default')
      await wrapper.vm.$nextTick()

      // Backend should receive delete and insert calls
      expect(mockBackend.delete).toHaveBeenCalledTimes(1)
      expect(mockBackend.insert).toHaveBeenCalledTimes(1)

      // Annotation should be updated (adjustment applied)
      const emitted = wrapper.emitted('annotations-update')
      expect(emitted).toBeTruthy()
      // For equal length replace within annotation, the annotation remains 10..30
      // (since net change is 0 and it contains the selection, end adjusts by 0)
      expect(emitted[0][0][0].span.toJSON()).toBe('10..30')
    })

    it('should collapse annotation when selection contains it and annotationMode is default', async () => {
      const mockBackend = createMockBackend()
      const annotations = [
        { id: 'ann1', caption: 'Gene', type: 'gene', span: '15..25' }
      ]
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: createDoc('A'.repeat(100), annotations, false, mockBackend)
        }
      })
      await wrapper.vm.$nextTick()

      // Select positions 10..30 (contains the annotation 15..25)
      const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
      selectionLayer.vm.selection.select([new Range(10, 30)])
      await wrapper.vm.$nextTick()

      // Trigger insert modal
      const svg = wrapper.find('svg.editor-svg')
      await svg.trigger('keydown', { key: 'A' })
      await wrapper.vm.$nextTick()

      // Submit with annotationMode='default', replacing 20 chars with 20 chars
      const insertModal = wrapper.findComponent({ name: 'InsertModal' })
      insertModal.vm.$emit('submit', 'T'.repeat(20), 'default')
      await wrapper.vm.$nextTick()

      // Annotation should be collapsed to zero-width at selection start
      const emitted = wrapper.emitted('annotations-update')
      expect(emitted).toBeTruthy()
      // Annotation that was contained by selection gets collapsed to zero-width at selStart
      // Zero-width spans serialize as just the position (e.g., "10" not "10..10")
      expect(emitted[0][0][0].span.toJSON()).toBe('10')
    })

    it('should keep annotation when selection contains it and annotationMode is preserve', async () => {
      const mockBackend = createMockBackend()
      const annotations = [
        { id: 'ann1', caption: 'Gene', type: 'gene', span: '15..25' }
      ]
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: createDoc('A'.repeat(100), annotations, false, mockBackend)
        }
      })
      await wrapper.vm.$nextTick()

      // Select positions 10..30 (contains the annotation 15..25)
      const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
      selectionLayer.vm.selection.select([new Range(10, 30)])
      await wrapper.vm.$nextTick()

      // Trigger insert modal
      const svg = wrapper.find('svg.editor-svg')
      await svg.trigger('keydown', { key: 'A' })
      await wrapper.vm.$nextTick()

      // Submit with annotationMode='preserve', replacing 20 chars with 20 chars
      const insertModal = wrapper.findComponent({ name: 'InsertModal' })
      insertModal.vm.$emit('submit', 'T'.repeat(20), 'preserve')
      await wrapper.vm.$nextTick()

      // Annotation should NOT be updated (preserved at original position)
      const emitted = wrapper.emitted('annotations-update')
      expect(emitted).toBeFalsy()
    })
  })

  describe('disciplined inserts', () => {
    it('should call backend.insert when inserting at annotation boundary', async () => {
      const mockBackend = createMockBackend()
      const annotations = [
        { id: 'ann1', caption: 'Gene', type: 'gene', span: '10..30' }
      ]
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: createDoc('A'.repeat(100), annotations, false, mockBackend)
        }
      })
      await wrapper.vm.$nextTick()

      // Insert at position 10 (start of annotation)
      await setupInsertAtPosition(wrapper, 10)

      const insertModal = wrapper.findComponent({ name: 'InsertModal' })
      insertModal.vm.$emit('submit', 'GGG', 'default', [])
      await wrapper.vm.$nextTick()

      // Backend should be called with correct position
      expect(mockBackend.insert).toHaveBeenCalledTimes(1)
      const call = mockBackend.insert.mock.calls[0][0]
      expect(call.position).toBe(10)
      expect(call.text).toBe('GGG')
      expect(call.id).toBeDefined()
    })

    it('should not extend annotation starting at insert position by default', async () => {
      const mockBackend = createMockBackend()
      const annotations = [
        { id: 'ann1', caption: 'Gene', type: 'gene', span: '10..30' }
      ]
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: createDoc('A'.repeat(100), annotations, false, mockBackend)
        }
      })
      await wrapper.vm.$nextTick()

      // Insert at position 10 (start of annotation)
      await setupInsertAtPosition(wrapper, 10)

      const insertModal = wrapper.findComponent({ name: 'InsertModal' })
      // Submit with empty extendAnnotationIds - annotation should shift entirely
      insertModal.vm.$emit('submit', 'GGG', 'default', [])
      await wrapper.vm.$nextTick()

      // Backend should be called
      expect(mockBackend.insert).toHaveBeenCalledTimes(1)

      // Annotation should shift entirely: 10..30 -> 13..33 (3-char insert)
      const emitted = wrapper.emitted('annotations-update')
      expect(emitted).toBeTruthy()
      expect(emitted[0][0][0].span.toJSON()).toBe('13..33')
    })

    it('should extend annotation starting at insert position when checked', async () => {
      const mockBackend = createMockBackend()
      const annotations = [
        { id: 'ann1', caption: 'Gene', type: 'gene', span: '10..30' }
      ]
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: createDoc('A'.repeat(100), annotations, false, mockBackend)
        }
      })
      await wrapper.vm.$nextTick()

      // Insert at position 10 (start of annotation)
      await setupInsertAtPosition(wrapper, 10)

      const insertModal = wrapper.findComponent({ name: 'InsertModal' })
      // Submit with ann1:start in extendSelections - annotation should expand at start
      insertModal.vm.$emit('submit', 'GGG', 'default', ['ann1:start'])
      await wrapper.vm.$nextTick()

      // Backend should be called
      expect(mockBackend.insert).toHaveBeenCalledTimes(1)

      // Annotation should expand: 10..30 -> 10..33 (start stays, end shifts)
      const emitted = wrapper.emitted('annotations-update')
      expect(emitted).toBeTruthy()
      expect(emitted[0][0][0].span.toJSON()).toBe('10..33')
    })

    it('should not extend annotation ending at insert position by default', async () => {
      const mockBackend = createMockBackend()
      const annotations = [
        { id: 'ann1', caption: 'Gene', type: 'gene', span: '10..30' }
      ]
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: createDoc('A'.repeat(100), annotations, false, mockBackend)
        }
      })
      await wrapper.vm.$nextTick()

      // Insert at position 30 (end of annotation)
      await setupInsertAtPosition(wrapper, 30)

      const insertModal = wrapper.findComponent({ name: 'InsertModal' })
      // Submit with empty extendAnnotationIds - annotation should NOT change
      insertModal.vm.$emit('submit', 'GGG', 'default', [])
      await wrapper.vm.$nextTick()

      // Backend should be called
      expect(mockBackend.insert).toHaveBeenCalledTimes(1)
      const call = mockBackend.insert.mock.calls[0][0]
      expect(call.position).toBe(30)

      // Annotation should NOT be updated (insert goes after)
      const emitted = wrapper.emitted('annotations-update')
      // No changes means annotations-update not emitted OR annotation unchanged
      if (emitted) {
        expect(emitted[0][0][0].span.toJSON()).toBe('10..30')
      }
    })

    it('should extend annotation ending at insert position when checked', async () => {
      const mockBackend = createMockBackend()
      const annotations = [
        { id: 'ann1', caption: 'Gene', type: 'gene', span: '10..30' }
      ]
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: createDoc('A'.repeat(100), annotations, false, mockBackend)
        }
      })
      await wrapper.vm.$nextTick()

      // Insert at position 30 (end of annotation)
      await setupInsertAtPosition(wrapper, 30)

      const insertModal = wrapper.findComponent({ name: 'InsertModal' })
      // Submit with ann1:end in extendSelections - annotation should expand at end
      insertModal.vm.$emit('submit', 'GGG', 'default', ['ann1:end'])
      await wrapper.vm.$nextTick()

      // Backend should be called
      expect(mockBackend.insert).toHaveBeenCalledTimes(1)

      // Annotation should expand: 10..30 -> 10..33
      const emitted = wrapper.emitted('annotations-update')
      expect(emitted).toBeTruthy()
      expect(emitted[0][0][0].span.toJSON()).toBe('10..33')
    })

    it('should handle multiple annotations touching same insert position', async () => {
      const mockBackend = createMockBackend()
      const annotations = [
        { id: 'ann1', caption: 'Gene1', type: 'gene', span: '10..30' },
        { id: 'ann2', caption: 'Gene2', type: 'gene', span: '30..50' }
      ]
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: createDoc('A'.repeat(100), annotations, false, mockBackend)
        }
      })
      await wrapper.vm.$nextTick()

      // Insert at position 30 (end of ann1, start of ann2)
      await setupInsertAtPosition(wrapper, 30)

      const insertModal = wrapper.findComponent({ name: 'InsertModal' })
      // Only extend ann1 at its end, not ann2
      insertModal.vm.$emit('submit', 'GGG', 'default', ['ann1:end'])
      await wrapper.vm.$nextTick()

      // Backend should be called
      expect(mockBackend.insert).toHaveBeenCalledTimes(1)

      // ann1 should expand: 10..30 -> 10..33
      // ann2 should shift: 30..50 -> 33..53
      const emitted = wrapper.emitted('annotations-update')
      expect(emitted).toBeTruthy()
      const updatedAnns = emitted[0][0]
      const ann1 = updatedAnns.find(a => a.id === 'ann1')
      const ann2 = updatedAnns.find(a => a.id === 'ann2')
      expect(ann1.span.toJSON()).toBe('10..33')
      expect(ann2.span.toJSON()).toBe('33..53')
    })

    it('should handle extending both annotations at same position', async () => {
      const mockBackend = createMockBackend()
      const annotations = [
        { id: 'ann1', caption: 'Gene1', type: 'gene', span: '10..30' },
        { id: 'ann2', caption: 'Gene2', type: 'gene', span: '30..50' }
      ]
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: createDoc('A'.repeat(100), annotations, false, mockBackend)
        }
      })
      await wrapper.vm.$nextTick()

      // Insert at position 30 (end of ann1, start of ann2)
      await setupInsertAtPosition(wrapper, 30)

      const insertModal = wrapper.findComponent({ name: 'InsertModal' })
      // Extend both annotations: ann1 at its end, ann2 at its start
      insertModal.vm.$emit('submit', 'GGG', 'default', ['ann1:end', 'ann2:start'])
      await wrapper.vm.$nextTick()

      // Backend should be called
      expect(mockBackend.insert).toHaveBeenCalledTimes(1)

      // ann1 should expand: 10..30 -> 10..33
      // ann2 should expand: 30..50 -> 30..53 (start stays at 30, end shifts)
      const emitted = wrapper.emitted('annotations-update')
      expect(emitted).toBeTruthy()
      const updatedAnns = emitted[0][0]
      const ann1 = updatedAnns.find(a => a.id === 'ann1')
      const ann2 = updatedAnns.find(a => a.id === 'ann2')
      expect(ann1.span.toJSON()).toBe('10..33')
      expect(ann2.span.toJSON()).toBe('30..53')
    })

    it('should not show extend options for replacements', async () => {
      const mockBackend = createMockBackend()
      const annotations = [
        { id: 'ann1', caption: 'Gene', type: 'gene', span: '10..30' }
      ]
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: createDoc('A'.repeat(100), annotations, false, mockBackend)
        }
      })
      await wrapper.vm.$nextTick()

      // Select a range (makes it a replacement)
      const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
      selectionLayer.vm.selection.select([new Range(10, 15)])
      await wrapper.vm.$nextTick()

      // Trigger insert modal (which becomes replace modal due to selection)
      const svg = wrapper.find('svg.editor-svg')
      await svg.trigger('keydown', { key: 'A' })
      await wrapper.vm.$nextTick()
      await wrapper.vm.$nextTick()

      // Verify modal is visible
      expect(wrapper.find('.modal-overlay').exists()).toBe(true)

      // touchingAnnotations should be empty for replacements
      // This is tested via the computed property in the component
      // We verify by checking the InsertModal receives empty array
      const insertModal = wrapper.findComponent({ name: 'InsertModal' })
      expect(insertModal.exists()).toBe(true)
      expect(insertModal.props('touchingAnnotations')).toEqual([])
    })

    it('should handle multi-range annotations with one range touching', async () => {
      const mockBackend = createMockBackend()
      const annotations = [
        { id: 'ann1', caption: 'Gene', type: 'gene', span: '10..20 + 30..40' }
      ]
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: createDoc('A'.repeat(100), annotations, false, mockBackend)
        }
      })
      await wrapper.vm.$nextTick()

      // Insert at position 20 (end of first range)
      await setupInsertAtPosition(wrapper, 20)

      const insertModal = wrapper.findComponent({ name: 'InsertModal' })
      // Extend the annotation at its end (position 20)
      insertModal.vm.$emit('submit', 'GGG', 'default', ['ann1:end'])
      await wrapper.vm.$nextTick()

      // Backend should be called
      expect(mockBackend.insert).toHaveBeenCalledTimes(1)

      // First range should expand: 10..20 -> 10..23
      // Second range should shift: 30..40 -> 33..43
      const emitted = wrapper.emitted('annotations-update')
      expect(emitted).toBeTruthy()
      expect(emitted[0][0][0].span.toJSON()).toBe('10..23 + 33..43')
    })

    it('should still emit edit event with insert type', async () => {
      const mockBackend = createMockBackend()
      const annotations = [
        { id: 'ann1', caption: 'Gene', type: 'gene', span: '10..30' }
      ]
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: createDoc('A'.repeat(100), annotations, false, mockBackend)
        }
      })
      await wrapper.vm.$nextTick()

      // Insert at position 10 (start of annotation)
      await setupInsertAtPosition(wrapper, 10)

      const insertModal = wrapper.findComponent({ name: 'InsertModal' })
      // Extend at start position
      insertModal.vm.$emit('submit', 'GGG', 'default', ['ann1:start'])
      await wrapper.vm.$nextTick()

      // Edit event should still be emitted
      const editEvents = wrapper.emitted('edit')
      expect(editEvents).toBeTruthy()
      expect(editEvents[0][0]).toEqual({
        type: 'insert',
        position: 10,
        text: 'GGG'
      })
    })
  })
})
