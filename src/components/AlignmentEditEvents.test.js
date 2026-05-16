import { ezSpan, Span, Range, Orientation } from '../../test/span-helpers.js'
import { describe, it, expect, beforeEach } from 'bun:test'
import { mount } from '@vue/test-utils'
import SequenceEditor from './SequenceEditor.vue'
import AlignmentEditor from './AlignmentEditor.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import InsertModal from './InsertModal.vue'
import { STORAGE_KEY } from '../composables/usePersistedZoom.js'
import { SequenceDocument } from '../composables/SequenceDocument.js'

// Helper to create a SequenceDocument for tests
function createDoc(sequence = '', annotations = [], circular = false, backend = null) {
  return new SequenceDocument({ sequence, annotations, circular, backend })
}

describe('SequenceEditor Edit Events', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY)
  })

  describe('delete event', () => {
    it('emits delete event without "to" field in normal mode', async () => {
      const wrapper = mount(SequenceEditor, {
        props: { sequence: createDoc('ATCGATCGATCGATCGATCG'), initialZoom: 100 },
        global: {
          stubs: { Teleport: true }
        }
      })
      await wrapper.vm.$nextTick()

      // Select range and trigger delete via Delete key
      wrapper.vm.setSelection(ezSpan(5, 10))
      await wrapper.vm.$nextTick()

      const svg = wrapper.find('.editor-svg')
      await svg.trigger('keydown', { key: 'Delete' })
      await wrapper.vm.$nextTick()

      // Find the ConfirmDialog component and emit confirm
      const confirmDialog = wrapper.findComponent(ConfirmDialog)
      if (confirmDialog.exists()) {
        confirmDialog.vm.$emit('confirm')
        await wrapper.vm.$nextTick()
      }

      const editEvents = wrapper.emitted('edit')
      expect(editEvents).toBeTruthy()
      const deleteEvent = editEvents.find(e => e[0].type === 'delete')
      expect(deleteEvent).toBeTruthy()
      expect(deleteEvent[0].type).toBe('delete')
      expect(deleteEvent[0].ranges).toEqual([{ start: 5, end: 10 }])
      expect(deleteEvent[0].to).toBeUndefined()
    })

    it('emits delete event with ranges for the deleted selection', async () => {
      const wrapper = mount(SequenceEditor, {
        props: { sequence: createDoc('ATCGATCGATCGATCGATCG'), initialZoom: 100 },
        global: {
          stubs: { Teleport: true }
        }
      })
      await wrapper.vm.$nextTick()

      // Select range 3..8
      wrapper.vm.setSelection(ezSpan(3, 8))
      await wrapper.vm.$nextTick()

      const svg = wrapper.find('.editor-svg')
      await svg.trigger('keydown', { key: 'Delete' })
      await wrapper.vm.$nextTick()

      const confirmDialog = wrapper.findComponent(ConfirmDialog)
      if (confirmDialog.exists()) {
        confirmDialog.vm.$emit('confirm')
        await wrapper.vm.$nextTick()
      }

      const editEvents = wrapper.emitted('edit')
      const deleteEvent = editEvents.find(e => e[0].type === 'delete')
      expect(deleteEvent[0].ranges).toEqual([{ start: 3, end: 8 }])
    })
  })

  describe('insert event', () => {
    it('emits insert event without "to" field in normal mode', async () => {
      const wrapper = mount(SequenceEditor, {
        props: { sequence: createDoc('ATCGATCGATCGATCGATCG'), initialZoom: 100 },
        global: {
          stubs: { Teleport: true }
        }
      })
      await wrapper.vm.$nextTick()

      // Set cursor position (zero-width selection)
      wrapper.vm.setSelection(ezSpan(5, 5))
      await wrapper.vm.$nextTick()

      // Type a base to open insert modal
      const svg = wrapper.find('.editor-svg')
      await svg.trigger('keydown', { key: 'A' })
      await wrapper.vm.$nextTick()

      // Find the InsertModal component and emit submit
      const insertModal = wrapper.findComponent(InsertModal)
      if (insertModal.exists()) {
        insertModal.vm.$emit('submit', 'ATG')
        await wrapper.vm.$nextTick()
      }

      const editEvents = wrapper.emitted('edit')
      expect(editEvents).toBeTruthy()
      const insertEvent = editEvents.find(e => e[0].type === 'insert')
      expect(insertEvent).toBeTruthy()
      expect(insertEvent[0].to).toBeUndefined()
      expect(insertEvent[0].position).toBe(5)
      expect(insertEvent[0].text).toBeDefined()
    })
  })

  describe('replace operation', () => {
    it('emits delete then insert events for replace with ranges', async () => {
      const wrapper = mount(SequenceEditor, {
        props: { sequence: createDoc('ATCGATCGATCGATCGATCG'), initialZoom: 100 },
        global: {
          stubs: { Teleport: true }
        }
      })
      await wrapper.vm.$nextTick()

      // Select a range (not cursor) to trigger replace mode
      wrapper.vm.setSelection(ezSpan(5, 10))
      await wrapper.vm.$nextTick()

      // Type a base to open replace modal
      const svg = wrapper.find('.editor-svg')
      await svg.trigger('keydown', { key: 'G' })
      await wrapper.vm.$nextTick()

      // Find the InsertModal component and emit submit
      const insertModal = wrapper.findComponent(InsertModal)
      if (insertModal.exists()) {
        insertModal.vm.$emit('submit', 'GGG')
        await wrapper.vm.$nextTick()
      }

      const editEvents = wrapper.emitted('edit')
      expect(editEvents).toBeTruthy()

      // Should emit delete followed by insert
      const eventTypes = editEvents.map(e => e[0].type)
      expect(eventTypes).toContain('delete')
      expect(eventTypes).toContain('insert')

      // Delete event should include the ranges
      const deleteEvent = editEvents.find(e => e[0].type === 'delete')
      expect(deleteEvent[0].ranges).toEqual([{ start: 5, end: 10 }])
    })
  })

  describe('Ctrl+X removal', () => {
    it('does not emit cut event on Ctrl+X', async () => {
      const wrapper = mount(SequenceEditor, {
        props: { sequence: createDoc('ATCGATCGATCGATCGATCG'), initialZoom: 100 },
        global: {
          stubs: { Teleport: true }
        }
      })
      await wrapper.vm.$nextTick()

      // Select a range
      wrapper.vm.setSelection(ezSpan(5, 10))
      await wrapper.vm.$nextTick()

      // Try Ctrl+X
      const svg = wrapper.find('.editor-svg')
      await svg.trigger('keydown', { key: 'x', ctrlKey: true })
      await wrapper.vm.$nextTick()

      const editEvents = wrapper.emitted('edit')
      // Either no events or no 'cut' type events
      if (editEvents) {
        const cutEvent = editEvents.find(e => e[0].type === 'cut')
        expect(cutEvent).toBeUndefined()
      }
    })
  })
})

describe('AlignmentEditor Edit Events', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY)
  })

  describe('delete event', () => {
    it('emits delete event with "to" field for target', async () => {
      const targetDoc = createDoc('ATCGATCGATCGATCGATCG')
      const queryDoc = createDoc('ATCGATCG')

      const wrapper = mount(AlignmentEditor, {
        props: {
          target: targetDoc,
          query: queryDoc,
          initialZoom: 100
        },
        global: {
          stubs: { Teleport: true }
        }
      })
      await wrapper.vm.$nextTick()

      // Select on target
      wrapper.vm.selection.startSelection(0, false, 'target')
      wrapper.vm.selection.updateSelection(5)
      wrapper.vm.selection.endSelection()
      await wrapper.vm.$nextTick()

      // Delete via confirmDelete
      wrapper.vm.confirmDelete()
      await wrapper.vm.$nextTick()

      const editEvents = wrapper.emitted('edit')
      expect(editEvents).toBeTruthy()
      const deleteEvent = editEvents.find(e => e[0].type === 'delete')
      expect(deleteEvent).toBeTruthy()
      expect(deleteEvent[0].to).toBe('target')
      expect(deleteEvent[0].ranges).toEqual([{ start: 0, end: 5 }])
    })

    it('emits delete event with "to" field for query', async () => {
      const targetDoc = createDoc('ATCGATCGATCGATCGATCG')
      const queryDoc = createDoc('ATCGATCGATCGATCGATCG')

      const wrapper = mount(AlignmentEditor, {
        props: {
          target: targetDoc,
          query: queryDoc,
          initialZoom: 100
        },
        global: {
          stubs: { Teleport: true }
        }
      })
      await wrapper.vm.$nextTick()

      // Select on query
      wrapper.vm.selection.startSelection(0, false, 'query')
      wrapper.vm.selection.updateSelection(5)
      wrapper.vm.selection.endSelection()
      await wrapper.vm.$nextTick()

      // Delete via confirmDelete
      wrapper.vm.confirmDelete()
      await wrapper.vm.$nextTick()

      const editEvents = wrapper.emitted('edit')
      expect(editEvents).toBeTruthy()
      const deleteEvent = editEvents.find(e => e[0].type === 'delete')
      expect(deleteEvent).toBeTruthy()
      expect(deleteEvent[0].to).toBe('query')
      expect(deleteEvent[0].ranges).toEqual([{ start: 0, end: 5 }])
    })
  })

  describe('alignment integration tests', () => {
    it('aligns two sequences, deletes from query, alignment updates', async () => {
      const targetDoc = createDoc('ATCGATCGAATTTTTCGATCGATCG')
      const queryDoc = createDoc('ATCGATCGAAGGGGGCGATCGATCG')

      const wrapper = mount(AlignmentEditor, {
        props: {
          target: targetDoc,
          query: queryDoc,
          initialZoom: 100
        },
        global: {
          stubs: { Teleport: true }
        }
      })
      await wrapper.vm.$nextTick()

      // Verify alignment mode is active
      expect(wrapper.vm.hasAlignment).toBe(true)

      // Get initial alignment
      const initialAlignment = wrapper.vm.alignmentResult

      // Select middle 5bp (positions 10-15) in query
      wrapper.vm.selection.startSelection(10, false, 'query')
      wrapper.vm.selection.updateSelection(15)
      wrapper.vm.selection.endSelection()
      await wrapper.vm.$nextTick()

      // Delete
      wrapper.vm.confirmDelete()
      await wrapper.vm.$nextTick()

      // Verify delete event emitted
      const editEvents = wrapper.emitted('edit')
      const deleteEvent = editEvents.find(e => e[0].type === 'delete')
      expect(deleteEvent[0].to).toBe('query')

      // Verify query document was modified
      expect(queryDoc.sequence.length).toBe(20)

      // Verify alignment recomputed
      const newAlignment = wrapper.vm.alignmentResult
      expect(newAlignment).not.toBe(initialAlignment)
    })

    it('aligns two sequences, deletes from target, alignment updates', async () => {
      const targetDoc = createDoc('ATCGATCGAATTTTTCGATCGATCG')
      const queryDoc = createDoc('ATCGATCGAAGGGGGCGATCGATCG')

      const wrapper = mount(AlignmentEditor, {
        props: {
          target: targetDoc,
          query: queryDoc,
          initialZoom: 100
        },
        global: {
          stubs: { Teleport: true }
        }
      })
      await wrapper.vm.$nextTick()

      // Verify alignment mode is active
      expect(wrapper.vm.hasAlignment).toBe(true)

      // Get initial alignment
      const initialAlignment = wrapper.vm.alignmentResult

      // Select middle 5bp (positions 10-15) in target
      wrapper.vm.selection.startSelection(10, false, 'target')
      wrapper.vm.selection.updateSelection(15)
      wrapper.vm.selection.endSelection()
      await wrapper.vm.$nextTick()

      // Delete
      wrapper.vm.confirmDelete()
      await wrapper.vm.$nextTick()

      // Verify delete event emitted
      const editEvents = wrapper.emitted('edit')
      const deleteEvent = editEvents.find(e => e[0].type === 'delete')
      expect(deleteEvent[0].to).toBe('target')

      // Verify target document was modified
      expect(targetDoc.sequence.length).toBe(20)

      // Verify alignment recomputed
      const newAlignment = wrapper.vm.alignmentResult
      expect(newAlignment).not.toBe(initialAlignment)
    })
  })
})
