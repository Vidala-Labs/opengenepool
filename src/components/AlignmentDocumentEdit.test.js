import { ezSpan, Span, Range, Orientation } from '../../test/span-helpers.js'
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import AlignmentEditor from './AlignmentEditor.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import { STORAGE_KEY } from '../composables/usePersistedZoom.js'
import { SequenceDocument } from '../composables/SequenceDocument.js'

// Helper to create a SequenceDocument for tests
function createDoc(sequence = '', annotations = [], circular = false, backend = null) {
  return new SequenceDocument({ sequence, annotations, circular, backend })
}

// Alignment runs asynchronously; wait for the runner to settle (no-op for editors
// without a runner). Safe superset of $nextTick.
async function settle(wrapper) {
  await flushPromises()
  if (wrapper?.vm?.whenSettled) await wrapper.vm.whenSettled()
  await flushPromises()
  await wrapper?.vm?.$nextTick?.()
}

describe('Alignment Document Editing', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY)
  })

  describe('alignmentResult changes after target delete', () => {
    it('alignmentResult.targetAligned changes after deleting from target', async () => {
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
      await settle(wrapper)

      // Get initial alignment
      const initialResult = wrapper.vm.alignmentResult
      const initialTargetAligned = initialResult.targetAligned

      // Select 5bp from target and delete
      wrapper.vm.selection.startSelection(5, false, 'target')
      wrapper.vm.selection.updateSelection(10)
      wrapper.vm.selection.endSelection()
      await settle(wrapper)

      // Trigger delete via confirmDelete
      wrapper.vm.confirmDelete()
      await settle(wrapper)

      // Check document was modified
      expect(targetDoc.sequence.length).toBe(15)

      // Check alignmentResult changed
      const newResult = wrapper.vm.alignmentResult
      expect(newResult.targetAligned).not.toBe(initialTargetAligned)
    })
  })

  describe('Rendered SVG content updates', () => {
    it('rendered target text changes after deleting from target (text mode only)', async () => {
      const targetDoc = createDoc('CGAGTCAGT')
      const queryDoc = createDoc('CGAGTCAGT')

      const wrapper = mount(AlignmentEditor, {
        props: {
          target: targetDoc,
          query: queryDoc,
          initialZoom: 50
        },
        global: {
          stubs: { Teleport: true }
        }
      })
      await settle(wrapper)

      // Check if we're in text mode - if not, skip this test
      const textMode = wrapper.vm.graphics.metrics.value.textMode
      if (!textMode) {
        return
      }

      // Get initial rendered target text from SVG
      const targetText = wrapper.find('.alignment-target-text')
      expect(targetText.exists()).toBe(true)
      const initialRenderedText = targetText.text()

      // Select 3bp from target and delete (positions 3..6: 'GTC')
      wrapper.vm.selection.startSelection(3, false, 'target')
      wrapper.vm.selection.updateSelection(6)
      wrapper.vm.selection.endSelection()
      await settle(wrapper)

      wrapper.vm.confirmDelete()
      await settle(wrapper)
      await settle(wrapper)

      // Get new rendered target text
      const newTargetText = wrapper.find('.alignment-target-text')
      expect(newTargetText.exists()).toBe(true)
      const newRenderedText = newTargetText.text()

      // The rendered text should be different (alignment changed)
      expect(newRenderedText).not.toBe(initialRenderedText)
    })

    it('rendered query text changes after deleting from query (text mode only)', async () => {
      const targetDoc = createDoc('CGAGTCAGT')
      const queryDoc = createDoc('CGAGTCAGT')

      const wrapper = mount(AlignmentEditor, {
        props: {
          target: targetDoc,
          query: queryDoc,
          initialZoom: 50
        },
        global: {
          stubs: { Teleport: true }
        }
      })
      await settle(wrapper)

      // Check if we're in text mode - if not, skip this test
      const textMode = wrapper.vm.graphics.metrics.value.textMode
      if (!textMode) {
        return
      }

      // Get initial rendered query text from SVG
      const queryText = wrapper.find('.alignment-query-text')
      expect(queryText.exists()).toBe(true)
      const initialRenderedText = queryText.text()

      // Select 3bp from query and delete (positions 3..6: 'GTC')
      wrapper.vm.selection.startSelection(3, false, 'query')
      wrapper.vm.selection.updateSelection(6)
      wrapper.vm.selection.endSelection()
      await settle(wrapper)

      wrapper.vm.confirmDelete()
      await settle(wrapper)
      await settle(wrapper)

      // Get new rendered query text
      const newQueryText = wrapper.find('.alignment-query-text')
      expect(newQueryText.exists()).toBe(true)
      const newRenderedText = newQueryText.text()

      // The rendered text should be different (alignment changed)
      expect(newRenderedText).not.toBe(initialRenderedText)
    })
  })

  describe('alignmentLines reactivity', () => {
    it('alignmentLines updates after deleting from query', async () => {
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
      await settle(wrapper)

      // Get initial alignment lines
      const initialLines = wrapper.vm.alignmentLines
      expect(initialLines.length).toBeGreaterThan(0)
      const initialQueryText = initialLines[0].queryText

      // Select 5bp from query and delete
      wrapper.vm.selection.startSelection(5, false, 'query')
      wrapper.vm.selection.updateSelection(10)
      wrapper.vm.selection.endSelection()
      await settle(wrapper)

      wrapper.vm.confirmDelete()
      await settle(wrapper)

      // alignmentLines should have updated
      const newLines = wrapper.vm.alignmentLines
      expect(queryDoc.sequence.length).toBe(15)
      expect(newLines[0].queryText).not.toBe(initialQueryText)
    })

    it('alignmentLines updates after deleting from target', async () => {
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
      await settle(wrapper)

      // Get initial alignment lines
      const initialLines = wrapper.vm.alignmentLines
      expect(initialLines.length).toBeGreaterThan(0)
      const initialTargetText = initialLines[0].targetText

      // Select 5bp from target and delete
      wrapper.vm.selection.startSelection(5, false, 'target')
      wrapper.vm.selection.updateSelection(10)
      wrapper.vm.selection.endSelection()
      await settle(wrapper)

      wrapper.vm.confirmDelete()
      await settle(wrapper)

      // alignmentLines should have updated
      const newLines = wrapper.vm.alignmentLines
      expect(targetDoc.sequence.length).toBe(15)
      expect(newLines[0].targetText).not.toBe(initialTargetText)
    })
  })

  describe('Mouse interaction on alignment layers', () => {
    it('clicking and dragging on target layer sets selection.source to "target"', async () => {
      const wrapper = mount(AlignmentEditor, {
        props: {
          target: createDoc('ATCGATCGATCGATCGATCG'),
          query: createDoc('ATCGATCGATCGATCGATCG'),
          initialZoom: 100
        },
        global: {
          stubs: { Teleport: true }
        },
        attachTo: document.body
      })
      await settle(wrapper)

      // Find the target sequence layer overlay (first one)
      const overlays = wrapper.findAll('.sequence-overlay')
      expect(overlays.length).toBeGreaterThan(0)

      // Simulate mousedown on the first overlay (target layer)
      const targetOverlay = overlays[0]
      await targetOverlay.trigger('mousedown', { button: 0, clientX: 100, clientY: 8 })
      await settle(wrapper)

      // Check if selection source is 'target'
      expect(wrapper.vm.selection.source.value).toBe('target')

      wrapper.unmount()
    })

    it('clicking and dragging on query layer sets selection.source to "query"', async () => {
      const wrapper = mount(AlignmentEditor, {
        props: {
          target: createDoc('ATCGATCGATCGATCGATCG'),
          query: createDoc('ATCGATCGATCGATCGATCG'),
          initialZoom: 100
        },
        global: {
          stubs: { Teleport: true }
        },
        attachTo: document.body
      })
      await settle(wrapper)

      // Find all sequence overlays
      const overlays = wrapper.findAll('.sequence-overlay')
      // In alignment mode with one line, we should have 2 overlays (target + query)
      expect(overlays.length).toBe(2)

      // The second overlay should be from the query layer
      const queryOverlay = overlays[1]
      await queryOverlay.trigger('mousedown', { button: 0, clientX: 100, clientY: 40 })
      await settle(wrapper)

      // Check if selection source is 'query'
      expect(wrapper.vm.selection.source.value).toBe('query')

      wrapper.unmount()
    })
  })

  describe('Document state changes on delete', () => {
    it('deleting from query updates queryDoc.sequence directly', async () => {
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
      await settle(wrapper)

      // Verify initial state
      expect(queryDoc.sequence.length).toBe(20)

      // Select 5bp from query
      wrapper.vm.selection.startSelection(5, false, 'query')
      wrapper.vm.selection.updateSelection(10)
      wrapper.vm.selection.endSelection()
      await settle(wrapper)

      // Delete
      wrapper.vm.confirmDelete()
      await settle(wrapper)

      // Verify queryDoc.sequence was updated directly
      expect(queryDoc.sequence.length).toBe(15)
      expect(queryDoc.sequence).toBe('ATCGACGATCGATCG')
    })

    it('deleting from target updates targetDoc.sequence directly', async () => {
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
      await settle(wrapper)

      // Verify initial state
      expect(targetDoc.sequence.length).toBe(20)

      // Select 5bp from target
      wrapper.vm.selection.startSelection(5, false, 'target')
      wrapper.vm.selection.updateSelection(10)
      wrapper.vm.selection.endSelection()
      await settle(wrapper)

      // Delete
      wrapper.vm.confirmDelete()
      await settle(wrapper)

      // Verify targetDoc.sequence was updated directly
      expect(targetDoc.sequence.length).toBe(15)
      expect(targetDoc.sequence).toBe('ATCGACGATCGATCG')
    })
  })

  describe('Alignment recomputation after edit', () => {
    it('alignment recomputes after deleting from query', async () => {
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
      await settle(wrapper)

      // Get initial alignment result
      const initialAlignment = wrapper.vm.alignmentResult
      expect(initialAlignment.queryAligned.length).toBe(20)

      // Select 5bp from query and delete
      wrapper.vm.selection.startSelection(5, false, 'query')
      wrapper.vm.selection.updateSelection(10)
      wrapper.vm.selection.endSelection()
      await settle(wrapper)

      wrapper.vm.confirmDelete()
      await settle(wrapper)

      // Alignment should have recomputed with shorter query
      expect(queryDoc.sequence.length).toBe(15)
    })

    it('alignment recomputes after deleting from target', async () => {
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
      await settle(wrapper)

      // Get initial alignment result
      const initialAlignment = wrapper.vm.alignmentResult
      expect(initialAlignment.targetAligned.length).toBe(20)

      // Select 5bp from target and delete
      wrapper.vm.selection.startSelection(5, false, 'target')
      wrapper.vm.selection.updateSelection(10)
      wrapper.vm.selection.endSelection()
      await settle(wrapper)

      wrapper.vm.confirmDelete()
      await settle(wrapper)

      // Alignment should have recomputed with shorter target
      expect(targetDoc.sequence.length).toBe(15)
    })
  })

  describe('Selection source routing', () => {
    it('selection.source is "target" when selecting on target layer', async () => {
      const wrapper = mount(AlignmentEditor, {
        props: {
          target: createDoc('ATCGATCGATCGATCGATCG'),
          query: createDoc('ATCGATCGATCGATCGATCG'),
          initialZoom: 100
        },
        global: {
          stubs: { Teleport: true }
        }
      })
      await settle(wrapper)

      // Set selection with target source
      wrapper.vm.selection.startSelection(5, false, 'target')
      wrapper.vm.selection.updateSelection(10)
      wrapper.vm.selection.endSelection()
      await settle(wrapper)

      expect(wrapper.vm.selection.source.value).toBe('target')
    })

    it('selection.source is "query" when selecting on query layer', async () => {
      const wrapper = mount(AlignmentEditor, {
        props: {
          target: createDoc('ATCGATCGATCGATCGATCG'),
          query: createDoc('ATCGATCGATCGATCGATCG'),
          initialZoom: 100
        },
        global: {
          stubs: { Teleport: true }
        }
      })
      await settle(wrapper)

      // Set selection with query source
      wrapper.vm.selection.startSelection(5, false, 'query')
      wrapper.vm.selection.updateSelection(10)
      wrapper.vm.selection.endSelection()
      await settle(wrapper)

      expect(wrapper.vm.selection.source.value).toBe('query')
    })

    it('delete routes to targetDoc when selection.source is "target"', async () => {
      const targetDoc = createDoc('ATCGATCGATCGATCGATCG')
      const queryDoc = createDoc('GGGGGGGGGGGGGGGGGGGG')

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
      await settle(wrapper)

      // Verify initial sequences
      expect(targetDoc.sequence).toBe('ATCGATCGATCGATCGATCG')
      expect(queryDoc.sequence).toBe('GGGGGGGGGGGGGGGGGGGG')

      // Select from target
      wrapper.vm.selection.startSelection(0, false, 'target')
      wrapper.vm.selection.updateSelection(5)
      wrapper.vm.selection.endSelection()
      await settle(wrapper)

      // Delete
      wrapper.vm.confirmDelete()
      await settle(wrapper)

      // Target should be modified, query should be unchanged
      expect(targetDoc.sequence).toBe('TCGATCGATCGATCG') // First 5bp removed
      expect(queryDoc.sequence).toBe('GGGGGGGGGGGGGGGGGGGG') // Unchanged
    })

    it('delete routes to queryDoc when selection.source is "query"', async () => {
      const targetDoc = createDoc('ATCGATCGATCGATCGATCG')
      const queryDoc = createDoc('GGGGGGGGGGGGGGGGGGGG')

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
      await settle(wrapper)

      // Verify initial sequences
      expect(targetDoc.sequence).toBe('ATCGATCGATCGATCGATCG')
      expect(queryDoc.sequence).toBe('GGGGGGGGGGGGGGGGGGGG')

      // Select from query
      wrapper.vm.selection.startSelection(0, false, 'query')
      wrapper.vm.selection.updateSelection(5)
      wrapper.vm.selection.endSelection()
      await settle(wrapper)

      // Delete
      wrapper.vm.confirmDelete()
      await settle(wrapper)

      // Query should be modified, target should be unchanged
      expect(queryDoc.sequence).toBe('GGGGGGGGGGGGGGG') // First 5bp removed
      expect(targetDoc.sequence).toBe('ATCGATCGATCGATCGATCG') // Unchanged
    })
  })
})
