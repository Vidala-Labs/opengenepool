import { describe, it, expect, beforeEach } from 'bun:test'
import { mount } from '@vue/test-utils'
import SequenceEditor from './SequenceEditor.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import InsertModal from './InsertModal.vue'
import { STORAGE_KEY } from '../composables/usePersistedZoom.js'
import { SequenceDocument } from '../composables/SequenceDocument.js'

// Helper to create a SequenceDocument for tests
function createDoc(sequence = '', annotations = [], circular = false, backend = null) {
  return new SequenceDocument({ sequence, annotations, circular, backend })
}

function createAlignmentDocs(targetSeq, querySeq, targetAnnotations = [], queryAnnotations = []) {
  return {
    target: createDoc(targetSeq, targetAnnotations),
    query: createDoc(querySeq, queryAnnotations)
  }
}

describe('Alignment Edit Events', () => {
  // Clear persisted zoom before each test so initialZoom prop takes effect
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY)
  })

  describe('delete event', () => {
    it('emits delete event without "to" field in normal mode', async () => {
      const wrapper = mount(SequenceEditor, {
        props: { sequence: createDoc('ATCGATCGATCGATCGATCG'), initialZoom: 100 },
        global: {
          stubs: {
            Teleport: true
          }
        }
      })
      await wrapper.vm.$nextTick()

      // Select range and trigger delete via Delete key
      wrapper.vm.setSelection('5..10')
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
          stubs: {
            Teleport: true
          }
        }
      })
      await wrapper.vm.$nextTick()

      // Select range 3..8
      wrapper.vm.setSelection('3..8')
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

    it('emits delete event with "to" field and ranges in alignment mode', async () => {
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: createAlignmentDocs('ATCGATCGATCGATCGATCG', 'ATCGATCG'),
          initialZoom: 100
        },
        global: {
          stubs: {
            Teleport: true
          }
        }
      })
      await wrapper.vm.$nextTick()

      // Set selection, then set source (select() resets source to null)
      wrapper.vm.setSelection('0..5')
      wrapper.vm.selection.source.value = 'query'
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
      expect(deleteEvent[0].to).toBe('query')
      expect(deleteEvent[0].ranges).toEqual([{ start: 0, end: 5 }])
    })
  })

  describe('insert event', () => {
    it('emits insert event without "to" field in normal mode', async () => {
      const wrapper = mount(SequenceEditor, {
        props: { sequence: createDoc('ATCGATCGATCGATCGATCG'), initialZoom: 100 },
        global: {
          stubs: {
            Teleport: true
          }
        }
      })
      await wrapper.vm.$nextTick()

      // Set cursor position (zero-width selection)
      wrapper.vm.setSelection('5..5')
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

    it('emits insert event with "to" field in alignment mode', async () => {
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: createAlignmentDocs('ATCGATCGATCGATCGATCG', 'ATCGATCG'),
          initialZoom: 100
        },
        global: {
          stubs: {
            Teleport: true
          }
        }
      })
      await wrapper.vm.$nextTick()

      // Set selection, then set source (select() resets source to null)
      wrapper.vm.setSelection('5..5')
      wrapper.vm.selection.source.value = 'target'
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
      expect(insertEvent[0].to).toBe('target')
    })
  })

  describe('replace operation', () => {
    it('emits delete then insert events for replace with ranges', async () => {
      const wrapper = mount(SequenceEditor, {
        props: { sequence: createDoc('ATCGATCGATCGATCGATCG'), initialZoom: 100 },
        global: {
          stubs: {
            Teleport: true
          }
        }
      })
      await wrapper.vm.$nextTick()

      // Select a range (not cursor) to trigger replace mode
      wrapper.vm.setSelection('5..10')
      await wrapper.vm.$nextTick()

      // Type a base to open replace modal
      const svg = wrapper.find('.editor-svg')
      await svg.trigger('keydown', { key: 'G' })
      await wrapper.vm.$nextTick()

      // Find the InsertModal component and emit submit (replace is handled based on selection having width)
      const insertModal = wrapper.findComponent(InsertModal)
      if (insertModal.exists()) {
        insertModal.vm.$emit('submit', 'GGG')
        await wrapper.vm.$nextTick()
      }

      const editEvents = wrapper.emitted('edit')
      expect(editEvents).toBeTruthy()

      // Should emit delete followed by insert (no replace event)
      const eventTypes = editEvents.map(e => e[0].type)
      expect(eventTypes).toContain('delete')
      expect(eventTypes).toContain('insert')
      expect(eventTypes).not.toContain('replace')

      // Delete should come before insert
      const deleteIndex = eventTypes.indexOf('delete')
      const insertIndex = eventTypes.indexOf('insert')
      expect(deleteIndex).toBeLessThan(insertIndex)

      // Delete event should include the ranges
      const deleteEvent = editEvents.find(e => e[0].type === 'delete')
      expect(deleteEvent[0].ranges).toEqual([{ start: 5, end: 10 }])
    })

    it('replace emits delete and insert with "to" field and ranges in alignment mode', async () => {
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: createAlignmentDocs('ATCGATCGATCGATCGATCG', 'ATCGATCG'),
          initialZoom: 100
        },
        global: {
          stubs: {
            Teleport: true
          }
        }
      })
      await wrapper.vm.$nextTick()

      // Set selection, then set source (select() resets source to null)
      wrapper.vm.setSelection('5..10')
      wrapper.vm.selection.source.value = 'query'
      await wrapper.vm.$nextTick()

      // Type a base to open replace modal
      const svg = wrapper.find('.editor-svg')
      await svg.trigger('keydown', { key: 'G' })
      await wrapper.vm.$nextTick()

      // Find the InsertModal component and emit submit (replace is handled based on selection having width)
      const insertModal = wrapper.findComponent(InsertModal)
      if (insertModal.exists()) {
        insertModal.vm.$emit('submit', 'GGG')
        await wrapper.vm.$nextTick()
      }

      const editEvents = wrapper.emitted('edit')
      expect(editEvents).toBeTruthy()

      const deleteEvent = editEvents.find(e => e[0].type === 'delete')
      const insertEvent = editEvents.find(e => e[0].type === 'insert')

      expect(deleteEvent[0].to).toBe('query')
      expect(deleteEvent[0].ranges).toEqual([{ start: 5, end: 10 }])
      expect(insertEvent[0].to).toBe('query')
    })
  })

  describe('alignment integration tests', () => {
    it('aligns two 25bp sequences, selects middle 5bp, deletes from query, updates alignment', async () => {
      // Two 25bp sequences
      const target = 'ATCGATCGAATTTTTCGATCGATCG'
      let query = 'ATCGATCGAAGGGGGCGATCGATCG'

      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: createAlignmentDocs(target, query),
          initialZoom: 100
        },
        global: {
          stubs: { Teleport: true }
        }
      })
      await wrapper.vm.$nextTick()

      // Verify alignment mode is active (alignment stats are shown)
      expect(wrapper.text()).toContain('Identity')

      // Select middle 5bp (positions 10-15: GGGGG) in query
      wrapper.vm.setSelection('10..15')
      wrapper.vm.selection.source.value = 'query'
      await wrapper.vm.$nextTick()

      // Verify selection is active
      const selectionDomain = wrapper.vm.selection.domain.value
      expect(selectionDomain.ranges[0].start).toBe(10)
      expect(selectionDomain.ranges[0].end).toBe(15)

      // Trigger delete
      const svg = wrapper.find('.editor-svg')
      await svg.trigger('keydown', { key: 'Delete' })
      await wrapper.vm.$nextTick()

      // Confirm deletion
      const confirmDialog = wrapper.findComponent(ConfirmDialog)
      expect(confirmDialog.exists()).toBe(true)
      confirmDialog.vm.$emit('confirm')
      await wrapper.vm.$nextTick()

      // Verify delete event emitted with correct target
      const editEvents = wrapper.emitted('edit')
      const deleteEvent = editEvents.find(e => e[0].type === 'delete')
      expect(deleteEvent[0].to).toBe('query')

      // Simulate parent applying the edit - update query sequence
      const newQuery = query.slice(0, 10) + query.slice(15) // 'ATCGATCGAACGATCGATCG' (20bp)
      expect(newQuery.length).toBe(20)
      await wrapper.setProps({ sequence: createAlignmentDocs(target, newQuery) })
      await wrapper.vm.$nextTick()

      // Verify alignment re-rendered with new query
      expect(wrapper.vm.queryDoc.sequence).toBe(newQuery)
    })

    it('aligns two identical 25bp sequences, selects TTTTT, replaces with CCCCC', async () => {
      // Identical sequences with TTTTT at positions 10-15
      const sequence = 'ATCGATCGAATTTTTCGATCGATCG'

      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: createAlignmentDocs(sequence, sequence),
          initialZoom: 100
        },
        global: {
          stubs: { Teleport: true }
        }
      })
      await wrapper.vm.$nextTick()

      // Select TTTTT (positions 10-15) in query
      wrapper.vm.setSelection('10..15')
      wrapper.vm.selection.source.value = 'query'
      await wrapper.vm.$nextTick()

      // Verify we selected 5 bases
      const selectionDomain = wrapper.vm.selection.domain.value
      expect(selectionDomain.ranges[0].end - selectionDomain.ranges[0].start).toBe(5)

      // Type to trigger replace modal
      const svg = wrapper.find('.editor-svg')
      await svg.trigger('keydown', { key: 'C' })
      await wrapper.vm.$nextTick()

      // Submit replacement
      const insertModal = wrapper.findComponent(InsertModal)
      expect(insertModal.exists()).toBe(true)
      insertModal.vm.$emit('submit', 'CCCCC')
      await wrapper.vm.$nextTick()

      // Verify delete + insert events with correct target
      const editEvents = wrapper.emitted('edit')
      const deleteEvent = editEvents.find(e => e[0].type === 'delete')
      const insertEvent = editEvents.find(e => e[0].type === 'insert')

      expect(deleteEvent[0].to).toBe('query')
      expect(insertEvent[0].to).toBe('query')
      expect(insertEvent[0].text).toBe('CCCCC')
      expect(insertEvent[0].position).toBe(10)

      // Simulate parent applying the edit
      const newQuery = sequence.slice(0, 10) + 'CCCCC' + sequence.slice(15)
      // Note: slice(15) starts with 'C', so we get 6 consecutive Cs (5 new + 1 existing)
      expect(newQuery).toBe('ATCGATCGAACCCCCCGATCGATCG')
      await wrapper.setProps({ sequence: createAlignmentDocs(sequence, newQuery) })
      await wrapper.vm.$nextTick()

      // Verify alignment updated
      expect(wrapper.vm.queryDoc.sequence).toBe(newQuery)
    })

    it('aligns two 20bp sequences, positions cursor in middle, inserts 5bp', async () => {
      // Two identical 20bp sequences
      const sequence = 'ATCGATCGATCGATCGATCG'

      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: createAlignmentDocs(sequence, sequence),
          initialZoom: 100
        },
        global: {
          stubs: { Teleport: true }
        }
      })
      await wrapper.vm.$nextTick()

      // Position cursor at middle (position 10) - zero-width selection
      wrapper.vm.setSelection('10..10')
      wrapper.vm.selection.source.value = 'query'
      await wrapper.vm.$nextTick()

      // Verify cursor position (zero-width)
      const selectionDomain = wrapper.vm.selection.domain.value
      expect(selectionDomain.ranges[0].start).toBe(10)
      expect(selectionDomain.ranges[0].end).toBe(10)

      // Type to open insert modal
      const svg = wrapper.find('.editor-svg')
      await svg.trigger('keydown', { key: 'G' })
      await wrapper.vm.$nextTick()

      // Submit insertion
      const insertModal = wrapper.findComponent(InsertModal)
      expect(insertModal.exists()).toBe(true)
      insertModal.vm.$emit('submit', 'GGGGG')
      await wrapper.vm.$nextTick()

      // Verify insert event
      const editEvents = wrapper.emitted('edit')
      const insertEvent = editEvents.find(e => e[0].type === 'insert')

      expect(insertEvent[0].to).toBe('query')
      expect(insertEvent[0].position).toBe(10)
      expect(insertEvent[0].text).toBe('GGGGG')

      // Simulate parent applying the edit
      const newQuery = sequence.slice(0, 10) + 'GGGGG' + sequence.slice(10)
      expect(newQuery).toBe('ATCGATCGATGGGGGCGATCGATCG')
      expect(newQuery.length).toBe(25)
      await wrapper.setProps({ sequence: createAlignmentDocs(sequence, newQuery) })
      await wrapper.vm.$nextTick()

      // Verify alignment updated with longer query
      expect(wrapper.vm.queryDoc.sequence).toBe(newQuery)
      expect(wrapper.vm.queryDoc.sequence.length).toBe(25)
    })

    // Target editing tests

    it('aligns two 25bp sequences, selects middle 5bp, deletes from target, updates alignment', async () => {
      // Two 25bp sequences
      const target = 'ATCGATCGAATTTTTCGATCGATCG'
      const query = 'ATCGATCGAAGGGGGCGATCGATCG'

      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: createAlignmentDocs(target, query),
          initialZoom: 100
        },
        global: {
          stubs: { Teleport: true }
        }
      })
      await wrapper.vm.$nextTick()

      // Verify alignment mode is active
      expect(wrapper.text()).toContain('Identity')

      // Select middle 5bp (positions 10-15: TTTTT) in target
      wrapper.vm.setSelection('10..15')
      wrapper.vm.selection.source.value = 'target'
      await wrapper.vm.$nextTick()

      // Verify selection is active
      const selectionDomain = wrapper.vm.selection.domain.value
      expect(selectionDomain.ranges[0].start).toBe(10)
      expect(selectionDomain.ranges[0].end).toBe(15)

      // Trigger delete
      const svg = wrapper.find('.editor-svg')
      await svg.trigger('keydown', { key: 'Delete' })
      await wrapper.vm.$nextTick()

      // Confirm deletion
      const confirmDialog = wrapper.findComponent(ConfirmDialog)
      expect(confirmDialog.exists()).toBe(true)
      confirmDialog.vm.$emit('confirm')
      await wrapper.vm.$nextTick()

      // Verify delete event emitted with correct target
      const editEvents = wrapper.emitted('edit')
      const deleteEvent = editEvents.find(e => e[0].type === 'delete')
      expect(deleteEvent[0].to).toBe('target')

      // Simulate parent applying the edit - update target sequence
      const newTarget = target.slice(0, 10) + target.slice(15) // 'ATCGATCGAACGATCGATCG' (20bp)
      expect(newTarget.length).toBe(20)
      wrapper.vm.setSequence(newTarget)
      await wrapper.vm.$nextTick()

      // Verify alignment re-rendered with new target (now 20bp vs 25bp query)
      expect(wrapper.vm.getSequence()).toBe(newTarget)
    })

    it('aligns two identical 25bp sequences, selects TTTTT in target, replaces with CCCCC', async () => {
      // Identical sequences with TTTTT at positions 10-15
      const sequence = 'ATCGATCGAATTTTTCGATCGATCG'

      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: createAlignmentDocs(sequence, sequence),
          initialZoom: 100
        },
        global: {
          stubs: { Teleport: true }
        }
      })
      await wrapper.vm.$nextTick()

      // Select TTTTT (positions 10-15) in target
      wrapper.vm.setSelection('10..15')
      wrapper.vm.selection.source.value = 'target'
      await wrapper.vm.$nextTick()

      // Verify we selected 5 bases
      const selectionDomain = wrapper.vm.selection.domain.value
      expect(selectionDomain.ranges[0].end - selectionDomain.ranges[0].start).toBe(5)

      // Type to trigger replace modal
      const svg = wrapper.find('.editor-svg')
      await svg.trigger('keydown', { key: 'C' })
      await wrapper.vm.$nextTick()

      // Submit replacement
      const insertModal = wrapper.findComponent(InsertModal)
      expect(insertModal.exists()).toBe(true)
      insertModal.vm.$emit('submit', 'CCCCC')
      await wrapper.vm.$nextTick()

      // Verify delete + insert events with correct target
      const editEvents = wrapper.emitted('edit')
      const deleteEvent = editEvents.find(e => e[0].type === 'delete')
      const insertEvent = editEvents.find(e => e[0].type === 'insert')

      expect(deleteEvent[0].to).toBe('target')
      expect(insertEvent[0].to).toBe('target')
      expect(insertEvent[0].text).toBe('CCCCC')
      expect(insertEvent[0].position).toBe(10)

      // Simulate parent applying the edit
      const newTarget = sequence.slice(0, 10) + 'CCCCC' + sequence.slice(15)
      // Note: slice(15) starts with 'C', so we get 6 consecutive Cs (5 new + 1 existing)
      expect(newTarget).toBe('ATCGATCGAACCCCCCGATCGATCG')
      wrapper.vm.setSequence(newTarget)
      await wrapper.vm.$nextTick()

      // Verify alignment updated
      expect(wrapper.vm.getSequence()).toBe(newTarget)
    })

    it('aligns two 20bp sequences, positions cursor in middle of target, inserts 5bp', async () => {
      // Two identical 20bp sequences
      const sequence = 'ATCGATCGATCGATCGATCG'

      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: createAlignmentDocs(sequence, sequence),
          initialZoom: 100
        },
        global: {
          stubs: { Teleport: true }
        }
      })
      await wrapper.vm.$nextTick()

      // Position cursor at middle (position 10) in target - zero-width selection
      wrapper.vm.setSelection('10..10')
      wrapper.vm.selection.source.value = 'target'
      await wrapper.vm.$nextTick()

      // Verify cursor position (zero-width)
      const selectionDomain = wrapper.vm.selection.domain.value
      expect(selectionDomain.ranges[0].start).toBe(10)
      expect(selectionDomain.ranges[0].end).toBe(10)

      // Type to open insert modal
      const svg = wrapper.find('.editor-svg')
      await svg.trigger('keydown', { key: 'G' })
      await wrapper.vm.$nextTick()

      // Submit insertion
      const insertModal = wrapper.findComponent(InsertModal)
      expect(insertModal.exists()).toBe(true)
      insertModal.vm.$emit('submit', 'GGGGG')
      await wrapper.vm.$nextTick()

      // Verify insert event
      const editEvents = wrapper.emitted('edit')
      const insertEvent = editEvents.find(e => e[0].type === 'insert')

      expect(insertEvent[0].to).toBe('target')
      expect(insertEvent[0].position).toBe(10)
      expect(insertEvent[0].text).toBe('GGGGG')

      // Simulate parent applying the edit
      const newTarget = sequence.slice(0, 10) + 'GGGGG' + sequence.slice(10)
      expect(newTarget).toBe('ATCGATCGATGGGGGCGATCGATCG')
      expect(newTarget.length).toBe(25)
      wrapper.vm.setSequence(newTarget)
      await wrapper.vm.$nextTick()

      // Verify alignment updated with longer target
      expect(wrapper.vm.getSequence()).toBe(newTarget)
      expect(wrapper.vm.getSequence().length).toBe(25)
    })
  })

  describe('Ctrl+X removal', () => {
    it('does not emit cut event on Ctrl+X', async () => {
      const wrapper = mount(SequenceEditor, {
        props: { sequence: createDoc('ATCGATCGATCGATCGATCG'), initialZoom: 100 },
        global: {
          stubs: {
            Teleport: true
          }
        }
      })
      await wrapper.vm.$nextTick()

      // Select a range
      wrapper.vm.setSelection('5..10')
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
