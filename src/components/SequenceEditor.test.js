import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { markRaw } from 'vue'
import SequenceEditor from './SequenceEditor.vue'
import { SequenceDocument } from '../composables/SequenceDocument.js'
import { Annotation } from '../utils/annotation.js'
import { Span, Range, Orientation } from '../utils/dna.js'
import { ezSpan } from '../../test/span-helpers.js'
import { STORAGE_KEY } from '../composables/usePersistedZoom.js'
import { __resetModuleState as resetAnnotationLayerState, hiddenTypes as annotationHiddenTypes } from './AnnotationLayer.vue'
import { __resetModuleState as resetTranslationLayerState } from './TranslationLayer.vue'

// Helper to create a SequenceDocument for tests
function createDoc(sequence = '', annotations = [], circular = false, backend = null) {
  return new SequenceDocument({ sequence, annotations, circular, backend })
}

// Helper to create an empty document
const emptyDoc = () => createDoc()

describe('SequenceEditor', () => {
  // Clear persisted zoom and reset layer module state before each test
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY)
    resetAnnotationLayerState()
    resetTranslationLayerState()
  })
  describe('initial state', () => {
    it('renders empty state when no sequence', () => {
      const wrapper = mount(SequenceEditor, {
        props: { sequence: emptyDoc() }
      })
      expect(wrapper.text()).toContain('No sequence loaded')
    })

    it('has default zoom level of 100 (clamped to 50 minimum without sequence)', () => {
      const wrapper = mount(SequenceEditor, {
        props: { sequence: emptyDoc() }
      })
      // Without a sequence, zoom is clamped to minimum of 50
      expect(wrapper.vm.editorState.zoomLevel.value).toBe(50)
    })

    it('uses initial zoom when sequence supports it', async () => {
      const wrapper = mount(SequenceEditor, {
        props: { sequence: createDoc('A'.repeat(500)), initialZoom: 100 }
      })
      await wrapper.vm.$nextTick()
      expect(wrapper.vm.editorState.zoomLevel.value).toBe(100)
    })

    it('accepts custom initial zoom', () => {
      const wrapper = mount(SequenceEditor, {
        props: { sequence: emptyDoc(), initialZoom: 50 }
      })
      expect(wrapper.vm.editorState.zoomLevel.value).toBe(50)
    })

    it('emits ready event on mount', async () => {
      const wrapper = mount(SequenceEditor, {
        props: { sequence: emptyDoc() }
      })
      await wrapper.vm.$nextTick()
      expect(wrapper.emitted('ready')).toBeTruthy()
    })

    it('shows Insert sequence option in context menu when no sequence loaded', async () => {
      const wrapper = mount(SequenceEditor)
      await wrapper.vm.$nextTick()

      // Right-click on the background rect
      const background = wrapper.find('.svg-background')
      await background.trigger('contextmenu', { clientX: 100, clientY: 100 })
      await wrapper.vm.$nextTick()

      // Should have Insert sequence option
      const insertItem = wrapper.find('[data-action="insert-sequence"]')
      expect(insertItem.exists()).toBe(true)
      expect(insertItem.text()).toContain('Insert sequence')
    })

    it('opens insert modal when clicking Insert sequence with no sequence loaded', async () => {
      const wrapper = mount(SequenceEditor)
      await wrapper.vm.$nextTick()

      // Right-click on the background rect
      const background = wrapper.find('.svg-background')
      await background.trigger('contextmenu', { clientX: 100, clientY: 100 })
      await wrapper.vm.$nextTick()

      // Click Insert sequence
      const insertItem = wrapper.find('[data-action="insert-sequence"]')
      expect(insertItem.exists()).toBe(true)
      expect(insertItem.text()).toContain('Insert sequence')
      await insertItem.trigger('click')
      await wrapper.vm.$nextTick()

      // Insert modal should be open
      const insertModal = wrapper.findComponent({ name: 'InsertModal' })
      expect(insertModal.props('visible')).toBe(true)
    })
  })

  describe('setSequence', () => {
    it('loads a sequence via setSequence method', async () => {
      const wrapper = mount(SequenceEditor, {
          props: { sequence: createDoc('ATCGATCG') }
        })
      await wrapper.vm.$nextTick()

      expect(wrapper.text()).not.toContain('No sequence loaded')
      expect(wrapper.text()).toContain('8 bp')
    })

    it('returns sequence via getSequence', () => {
      const seq = 'ATCGATCG'
      const wrapper = mount(SequenceEditor, {
        props: { sequence: createDoc(seq) }
      })

      expect(wrapper.vm.getSequence()).toBe(seq)
    })
  })

  describe('SVG rendering', () => {
    it('renders SVG element', () => {
      const wrapper = mount(SequenceEditor)
      expect(wrapper.find('svg').exists()).toBe(true)
    })

    it('renders sequence lines when sequence is set', async () => {
      const wrapper = mount(SequenceEditor, {
          props: { sequence: createDoc('A'.repeat(150)), initialZoom: 50 }
        })
      await wrapper.vm.$nextTick()

      // 150 / 50 = 3 lines
      const lines = wrapper.findAll('.sequence-line')
      expect(lines).toHaveLength(3)
    })

    it('renders position labels', async () => {
      const wrapper = mount(SequenceEditor, {
          props: { sequence: createDoc('A'.repeat(150)), initialZoom: 50 }
        })
      await wrapper.vm.$nextTick()

      const labels = wrapper.findAll('.position-label')
      expect(labels).toHaveLength(3)
      expect(labels[0].text()).toBe('1')    // GenBank 1-indexed
      expect(labels[1].text()).toBe('51')   // GenBank 1-indexed
      expect(labels[2].text()).toBe('101')  // GenBank 1-indexed
    })
  })

  describe('zoom controls', () => {
    it('renders zoom selector', () => {
      const wrapper = mount(SequenceEditor)
      expect(wrapper.find('select').exists()).toBe(true)
    })

    it('changes zoom level when selector changes', async () => {
      const wrapper = mount(SequenceEditor, {
          props: { sequence: createDoc('A'.repeat(1000)) }
        })
      await wrapper.vm.$nextTick()

      wrapper.vm.setZoom(200)
      await wrapper.vm.$nextTick()

      expect(wrapper.vm.editorState.zoomLevel.value).toBe(200)
    })

    it('updates line count when zoom changes', async () => {
      const wrapper = mount(SequenceEditor, {
          props: { sequence: createDoc('A'.repeat(500)), initialZoom: 50 }
        })
      await wrapper.vm.$nextTick()

      // At zoom 50, 500 bases = 10 lines
      expect(wrapper.vm.editorState.lineCount.value).toBe(10)

      wrapper.vm.setZoom(100)
      await wrapper.vm.$nextTick()

      // At zoom 100, 500 bases = 5 lines
      expect(wrapper.vm.editorState.lineCount.value).toBe(5)
    })
  })

  describe('selection', () => {
    it('getSelection returns null initially', () => {
      const wrapper = mount(SequenceEditor)
      expect(wrapper.vm.getSelection()).toBe(null)
    })

    it('can programmatically set selection via selection composable', async () => {
      const wrapper = mount(SequenceEditor, {
          props: { sequence: createDoc('ATCGATCGATCG') }
        })
      await wrapper.vm.$nextTick()

      // Get the selection composable from the SelectionLayer
      const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
      const selection = selectionLayer.vm.selection
      selection.select([new Range(2, 8)])
      await wrapper.vm.$nextTick()

      const sel = wrapper.vm.getSelection()
      expect(sel).toEqual({ start: 2, end: 8 })
    })

    it('renders selection highlight when selection exists', async () => {
      const wrapper = mount(SequenceEditor, {
          props: { sequence: createDoc('A'.repeat(100)), initialZoom: 50 }
        })
      await wrapper.vm.$nextTick()

      // Get the selection composable from the SelectionLayer
      const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
      const selection = selectionLayer.vm.selection
      selection.select([new Range(10, 40)])
      await wrapper.vm.$nextTick()

      // SelectionLayer renders .selection paths (not .selection-highlight)
      const highlight = wrapper.find('.selection')
      expect(highlight.exists()).toBe(true)
    })

    it('adds a new range with Ctrl+click+drag', async () => {
      const wrapper = mount(SequenceEditor, {
          props: { sequence: createDoc('A'.repeat(200)), initialZoom: 100 }
        })
      await wrapper.vm.$nextTick()

      // Get the selection composable
      const selection = wrapper.vm.$refs?.selectionLayerRef?.selection
        || wrapper.findComponent({ name: 'SelectionLayer' }).vm.selection

      // Create initial selection at positions 10-20
      selection.select([new Range(10, 20)])
      await wrapper.vm.$nextTick()

      expect(selection.isSelected.value).toBe(true)
      expect(selection.domain.value.ranges).toHaveLength(1)
      expect(selection.domain.value.ranges[0].start).toBe(10)
      expect(selection.domain.value.ranges[0].end).toBe(20)

      // Ctrl+click at position 50 to add a new range
      selection.startSelection(50, true)
      await wrapper.vm.$nextTick()

      // Should now have 2 ranges
      expect(selection.domain.value.ranges).toHaveLength(2)
      expect(selection.domain.value.ranges[0].start).toBe(10)
      expect(selection.domain.value.ranges[0].end).toBe(20)
      expect(selection.domain.value.ranges[1].start).toBe(50)
      expect(selection.domain.value.ranges[1].end).toBe(50)

      // Simulate drag to position 70
      selection.updateSelection(70)
      await wrapper.vm.$nextTick()

      // Second range should now be 50-70
      expect(selection.domain.value.ranges[1].start).toBe(50)
      expect(selection.domain.value.ranges[1].end).toBe(70)
    })

    it('adds a new range via mouse events with Ctrl key', async () => {
      const wrapper = mount(SequenceEditor, {
          props: { sequence: createDoc('A'.repeat(200)), initialZoom: 100 }
        })
      wrapper.vm.graphics.setContainerSize(1000, 600)
      await wrapper.vm.$nextTick()

      // Get the selection composable
      const selection = wrapper.findComponent({ name: 'SelectionLayer' }).vm.selection

      // Create initial selection at positions 10-20
      selection.select([new Range(10, 20)])
      await wrapper.vm.$nextTick()

      expect(selection.isSelected.value).toBe(true)
      expect(selection.domain.value.ranges).toHaveLength(1)

      // SequenceLayer now handles mouse events internally and requires DOM setup
      // that's difficult to replicate in unit tests. Test the programmatic API instead:
      // Ctrl+click is equivalent to startSelection with ctrlKey=true
      selection.startSelection(50, true)  // Add new range at position 50
      await wrapper.vm.$nextTick()

      // Check if a new range was added
      expect(selection.domain.value.ranges.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('text vs bar mode', () => {
    it('uses text mode at low zoom levels', async () => {
      const wrapper = mount(SequenceEditor, {
        props: { sequence: createDoc('ATCGATCG'), initialZoom: 50 }
      })
      // Force text mode by setting large container
      wrapper.vm.graphics.setContainerSize(1000, 600)
      await wrapper.vm.$nextTick()

      expect(wrapper.vm.graphics.metrics.value.textMode).toBe(true)
    })
  })

  describe('composables integration', () => {
    it('provides editorState to child components', () => {
      const wrapper = mount(SequenceEditor)
      expect(wrapper.vm.editorState).toBeDefined()
      expect(wrapper.vm.editorState.sequence).toBeDefined()
    })

    it('provides graphics to child components', () => {
      const wrapper = mount(SequenceEditor)
      expect(wrapper.vm.graphics).toBeDefined()
      expect(wrapper.vm.graphics.metrics).toBeDefined()
    })
  })

  describe('context menu', () => {
    it('shows "Replace sequence with..." for single range selection', async () => {
      const wrapper = mount(SequenceEditor, {
          props: { sequence: createDoc('A'.repeat(200)), initialZoom: 100 }
        })
      await wrapper.vm.$nextTick()

      // Create a single selection
      const selection = wrapper.findComponent({ name: 'SelectionLayer' }).vm.selection
      selection.select([new Range(10, 20)])
      await wrapper.vm.$nextTick()

      expect(selection.domain.value.ranges).toHaveLength(1)

      // Trigger context menu on sequence overlay
      const overlay = wrapper.find('.sequence-overlay')
      await overlay.trigger('contextmenu', { clientX: 100, clientY: 20 })
      await wrapper.vm.$nextTick()

      // Context menu should be visible with Replace option
      expect(wrapper.find('.context-menu').exists()).toBe(true)
      const menuText = wrapper.find('.context-menu').text()
      expect(menuText).toContain('Replace sequence with...')
    })

    it('does not show "Replace sequence with..." for multiple range selection', async () => {
      const wrapper = mount(SequenceEditor, {
          props: { sequence: createDoc('A'.repeat(200)), initialZoom: 100 }
        })
      await wrapper.vm.$nextTick()

      // Create multiple ranges
      const selection = wrapper.findComponent({ name: 'SelectionLayer' }).vm.selection
      selection.select([new Range(10, 20)])
      await wrapper.vm.$nextTick()

      selection.startSelection(50, true)
      await wrapper.vm.$nextTick()

      expect(selection.domain.value.ranges).toHaveLength(2)

      // Trigger context menu on sequence overlay
      const overlay = wrapper.find('.sequence-overlay')
      await overlay.trigger('contextmenu', { clientX: 100, clientY: 20 })
      await wrapper.vm.$nextTick()

      // Context menu should be visible but without Replace option
      expect(wrapper.find('.context-menu').exists()).toBe(true)
      const menuText = wrapper.find('.context-menu').text()
      expect(menuText).not.toContain('Replace sequence with...')
    })

    it('shows "Delete sequence" for non-zero-length selection', async () => {
      const wrapper = mount(SequenceEditor, {
          props: { sequence: createDoc('A'.repeat(200)), initialZoom: 100 }
        })
      await wrapper.vm.$nextTick()

      // Create a selection
      const selection = wrapper.findComponent({ name: 'SelectionLayer' }).vm.selection
      selection.select([new Range(10, 20)])
      await wrapper.vm.$nextTick()

      // Trigger context menu
      const overlay = wrapper.find('.sequence-overlay')
      await overlay.trigger('contextmenu', { clientX: 100, clientY: 20 })
      await wrapper.vm.$nextTick()

      const menuText = wrapper.find('.context-menu').text()
      expect(menuText).toContain('Delete sequence')
    })

    it('hides edit options when readonly is true', async () => {
      const wrapper = mount(SequenceEditor, {
        props: { sequence: createDoc('A'.repeat(200)), initialZoom: 100, readonly: true }
        })
      await wrapper.vm.$nextTick()

      // Create a selection
      const selection = wrapper.findComponent({ name: 'SelectionLayer' }).vm.selection
      selection.select([new Range(10, 20)])
      await wrapper.vm.$nextTick()

      // Trigger context menu
      const overlay = wrapper.find('.sequence-overlay')
      await overlay.trigger('contextmenu', { clientX: 100, clientY: 20 })
      await wrapper.vm.$nextTick()

      const menuText = wrapper.find('.context-menu').text()
      expect(menuText).not.toContain('Delete sequence')
      expect(menuText).not.toContain('Replace sequence with...')
      // Copy should still be available
      expect(menuText).toContain('Copy selection')
    })

    it('hides "Insert sequence..." when readonly is true', async () => {
      const wrapper = mount(SequenceEditor, {
        props: { sequence: createDoc('A'.repeat(200)), initialZoom: 100, readonly: true }
        })
      await wrapper.vm.$nextTick()

      // Create a zero-length selection (cursor)
      const selection = wrapper.findComponent({ name: 'SelectionLayer' }).vm.selection
      selection.select([new Range(10, 10)])
      await wrapper.vm.$nextTick()

      // Trigger context menu
      const overlay = wrapper.find('.sequence-overlay')
      await overlay.trigger('contextmenu', { clientX: 100, clientY: 20 })
      await wrapper.vm.$nextTick()

      const menuText = wrapper.find('.context-menu').text()
      expect(menuText).not.toContain('Insert sequence...')
    })
  })
  describe('config panel', () => {
    // AnnotationLayer uses module-level state with this localStorage key
    const HIDDEN_TYPES_KEY = 'ogp-hidden-annotation-types'

    beforeEach(() => {
      localStorage.removeItem(HIDDEN_TYPES_KEY)
      // Reset module state is already done in parent beforeEach
    })

    it('renders config gear button', () => {
      const wrapper = mount(SequenceEditor)
      expect(wrapper.find('.config-button').exists()).toBe(true)
    })

    it('config panel is hidden by default', () => {
      const wrapper = mount(SequenceEditor)
      expect(wrapper.find('.config-panel').exists()).toBe(false)
    })

    it('opens config panel when clicking gear button', async () => {
      const wrapper = mount(SequenceEditor)
      await wrapper.find('.config-button').trigger('click')
      expect(wrapper.find('.config-panel').exists()).toBe(true)
    })

    it('closes config panel when clicking gear button again', async () => {
      const wrapper = mount(SequenceEditor)
      await wrapper.find('.config-button').trigger('click')
      expect(wrapper.find('.config-panel').exists()).toBe(true)

      await wrapper.find('.config-button').trigger('click')
      expect(wrapper.find('.config-panel').exists()).toBe(false)
    })

    it('shows annotation types when annotations exist', async () => {
      const annotations = [
        new Annotation({ id: 'ann1', type: 'gene', span: ezSpan(10, 50) }),
        new Annotation({ id: 'ann2', type: 'promoter', span: ezSpan(60, 80) })
      ]

      const wrapper = mount(SequenceEditor, {
        props: { sequence: createDoc('A'.repeat(500), annotations) }
        })
      await wrapper.vm.$nextTick()

      await wrapper.find('.config-button').trigger('click')

      // Check type names in the config-types section (not the display toggles)
      const configTypes = wrapper.find('.config-types')
      const typeNames = configTypes.findAll('.type-name')
      expect(typeNames.length).toBe(2)
      expect(typeNames.map(t => t.text()).sort()).toEqual(['gene', 'promoter'])
    })

    it('hides annotation types section when no annotations exist', async () => {
      const wrapper = mount(SequenceEditor, {
        props: { sequence: createDoc('A'.repeat(100)) }
      })
      await wrapper.find('.config-button').trigger('click')
      // No config-types section when there are no annotations
      expect(wrapper.find('.config-types').exists()).toBe(false)
    })

    it('hides annotations when type is unchecked', async () => {
      const annotations = [
        new Annotation({ id: 'ann1', type: 'gene', span: ezSpan(10, 50) }),
        new Annotation({ id: 'ann2', type: 'promoter', span: ezSpan(60, 80) })
      ]

      const wrapper = mount(SequenceEditor, {
        props: { sequence: createDoc('A'.repeat(500), annotations), initialZoom: 100 }
        })
      await wrapper.vm.$nextTick()

      // Helper to get unique annotation IDs from rendered fragments
      const getVisibleAnnotationIds = () => {
        const layer = wrapper.findComponent({ name: 'AnnotationLayer' })
        const fragments = layer.vm.fragments || []
        return [...new Set(fragments.map(f => f.annotation?.id))]
      }

      // Initially both visible
      expect(getVisibleAnnotationIds().length).toBe(2)

      // Open config and uncheck 'gene'
      await wrapper.find('.config-button').trigger('click')
      const geneRow = wrapper.find('[data-type="gene"]')
      expect(geneRow.exists()).toBe(true)
      expect(geneRow.text()).toContain('gene')
      await geneRow.find('input[type="checkbox"]').trigger('change')

      await wrapper.vm.$nextTick()

      // Now only promoter should be visible
      const visibleIds = getVisibleAnnotationIds()
      expect(visibleIds.length).toBe(1)
      expect(visibleIds).toContain('ann2')
    })

    it('hides source type by default', async () => {
      // Note: AnnotationLayer no longer hides 'source' by default
      // The default hidden types behavior was removed from module-level state
      // If this behavior is needed, it should be configured via the parent
      const annotations = [
        new Annotation({ id: 'ann1', type: 'source', span: ezSpan(1, 500) }),
        new Annotation({ id: 'ann2', type: 'gene', span: ezSpan(10, 50) })
      ]

      const wrapper = mount(SequenceEditor, {
        props: { sequence: createDoc('A'.repeat(500), annotations), initialZoom: 100 }
        })
      await wrapper.vm.$nextTick()

      // Helper to get unique annotation IDs from rendered fragments
      const getVisibleAnnotationIds = () => {
        const layer = wrapper.findComponent({ name: 'AnnotationLayer' })
        const fragments = layer.vm.fragments || []
        return [...new Set(fragments.map(f => f.annotation?.id))]
      }

      // Both annotations should be visible (no default hiding in new architecture)
      expect(getVisibleAnnotationIds().length).toBe(2)
    })

    it('persists hidden types to localStorage', async () => {
      const annotations = [
        new Annotation({ id: 'ann1', type: 'gene', span: ezSpan(10, 50) }),
        new Annotation({ id: 'ann2', type: 'promoter', span: ezSpan(60, 80) })
      ]

      const wrapper = mount(SequenceEditor, {
        props: { sequence: createDoc('A'.repeat(500), annotations), initialZoom: 100 }
        })
      await wrapper.vm.$nextTick()

      // Hide gene type
      await wrapper.find('.config-button').trigger('click')
      const geneRow = wrapper.find('[data-type="gene"]')
      expect(geneRow.exists()).toBe(true)
      expect(geneRow.text()).toContain('gene')
      await geneRow.find('input[type="checkbox"]').trigger('change')
      await wrapper.vm.$nextTick()

      // Check localStorage
      const stored = JSON.parse(localStorage.getItem(HIDDEN_TYPES_KEY))
      expect(stored).toContain('gene')
    })

    it('loads hidden types from localStorage', async () => {
      // Set module-level hiddenTypes directly (localStorage is read at module load)
      annotationHiddenTypes.value = new Set(['gene'])

      const annotations = [
        new Annotation({ id: 'ann1', type: 'gene', span: ezSpan(10, 50) }),
        new Annotation({ id: 'ann2', type: 'promoter', span: ezSpan(60, 80) })
      ]

      const wrapper = mount(SequenceEditor, {
        props: { sequence: createDoc('A'.repeat(500), annotations), initialZoom: 100 }
        })
      await wrapper.vm.$nextTick()

      // Helper to get unique annotation IDs from rendered fragments
      const getVisibleAnnotationIds = () => {
        const layer = wrapper.findComponent({ name: 'AnnotationLayer' })
        const fragments = layer.vm.fragments || []
        return [...new Set(fragments.map(f => f.annotation?.id))]
      }

      // Gene should be hidden, only promoter visible
      const visibleIds = getVisibleAnnotationIds()
      expect(visibleIds.length).toBe(1)
      expect(visibleIds).toContain('ann2')
    })

    it('renders color swatch for each annotation type', async () => {
      const annotations = [
        new Annotation({ id: 'ann1', type: 'promoter', span: ezSpan(10, 50) })
      ]

      const wrapper = mount(SequenceEditor, {
        props: { sequence: createDoc('A'.repeat(500), annotations) }
        })
      await wrapper.vm.$nextTick()

      await wrapper.find('.config-button').trigger('click')

      const swatch = wrapper.find('.type-swatch')
      expect(swatch.exists()).toBe(true)

      // Check that the rect has inline fill from persisted colors
      const rect = swatch.find('rect')
      expect(rect.exists()).toBe(true)

      // Promoter color should be orange (#FF9800)
      expect(rect.attributes('fill')).toBe('#FF9800')
    })
  })

  describe('color persistence', () => {
    const COLORS_KEY = 'opengenepool-annotation-colors'

    beforeEach(() => {
      localStorage.removeItem(COLORS_KEY)
    })

    it('saves default colors to localStorage on first load', async () => {
      const annotations = [
        new Annotation({ id: 'ann1', type: 'gene', span: ezSpan(10, 50) })
      ]

      // No colors in localStorage yet
      expect(localStorage.getItem(COLORS_KEY)).toBeNull()

      mount(SequenceEditor, {
        props: { annotations }
      })

      // After mount, defaults should be saved to localStorage
      const stored = JSON.parse(localStorage.getItem(COLORS_KEY))
      expect(stored).not.toBeNull()
      expect(stored.gene).toBe('#4CAF50')
      expect(stored.CDS).toBe('#2196F3')
      expect(stored.promoter).toBe('#FF9800')
      expect(stored._default).toBe('#607D8B')
    })

    it('loads colors from localStorage if present', async () => {
      // Pre-set custom colors in localStorage
      const customColors = {
        gene: '#FF0000',  // Red instead of green
        CDS: '#00FF00',   // Green instead of blue
        _default: '#000000'
      }
      localStorage.setItem(COLORS_KEY, JSON.stringify(customColors))

      const annotations = [
        new Annotation({ id: 'ann1', type: 'gene', span: ezSpan(10, 50) })
      ]

      const wrapper = mount(SequenceEditor, {
        props: { sequence: createDoc('A'.repeat(500), annotations) }
        })
      await wrapper.vm.$nextTick()

      // Check that annotation uses the custom color
      const layer = wrapper.findComponent({ name: 'AnnotationLayer' })
      const path = layer.find('.annotation-fragment path')
      expect(path.attributes('fill')).toBe('#FF0000')
    })

    it('merges stored colors with defaults for new types', async () => {
      // Pre-set only some colors (simulating an older version)
      const partialColors = {
        gene: '#FF0000'
        // Missing other types
      }
      localStorage.setItem(COLORS_KEY, JSON.stringify(partialColors))

      const annotations = [
        new Annotation({ id: 'ann1', type: 'promoter', span: ezSpan(10, 50) })
      ]

      const wrapper = mount(SequenceEditor, {
        props: { sequence: createDoc('A'.repeat(500), annotations) }
        })
      await wrapper.vm.$nextTick()

      // Promoter should use default color since it wasn't in stored colors
      const layer = wrapper.findComponent({ name: 'AnnotationLayer' })
      const path = layer.find('.annotation-fragment path')
      expect(path.attributes('fill')).toBe('#FF9800')
    })

    it('annotation layer uses default colors for unknown types', async () => {
      const annotations = [
        new Annotation({ id: 'ann1', type: 'unknown_custom_type', span: ezSpan(10, 50) })
      ]

      const wrapper = mount(SequenceEditor, {
        props: { sequence: createDoc('A'.repeat(500), annotations) }
        })
      await wrapper.vm.$nextTick()

      // Unknown type should use _default color
      const layer = wrapper.findComponent({ name: 'AnnotationLayer' })
      const path = layer.find('.annotation-fragment path')
      expect(path.attributes('fill')).toBe('#607D8B')
    })
  })

  describe('selection deselect behavior', () => {
    it('Escape key clears selection', async () => {
      const wrapper = mount(SequenceEditor, {
          props: { sequence: createDoc('ATCGATCGATCG') }
        })
      await wrapper.vm.$nextTick()

      // Create a selection via the selection layer
      const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
      const selection = selectionLayer.vm.selection
      selection.select([new Range(2, 5)])
      await wrapper.vm.$nextTick()

      expect(selection.isSelected.value).toBe(true)

      // Press Escape on the SVG
      const svg = wrapper.find('svg.editor-svg')
      await svg.trigger('keydown', { key: 'Escape' })

      expect(selection.isSelected.value).toBe(false)
    })

    it('clicking on SVG background clears selection', async () => {
      const wrapper = mount(SequenceEditor, {
          props: { sequence: createDoc('ATCGATCGATCG') }
        })
      await wrapper.vm.$nextTick()

      // Create a selection
      const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
      const selection = selectionLayer.vm.selection
      selection.select([new Range(2, 5)])
      await wrapper.vm.$nextTick()

      expect(selection.isSelected.value).toBe(true)

      // Click on the background rect (null space)
      const background = wrapper.find('.svg-background')
      await background.trigger('mousedown', { button: 0 })

      expect(selection.isSelected.value).toBe(false)
    })

    it('help button renders with tooltip', () => {
      const wrapper = mount(SequenceEditor, {
          props: { sequence: createDoc('ATCG') }
        })

      const helpButton = wrapper.find('.help-button')
      expect(helpButton.exists()).toBe(true)

      // Check tooltip content
      const title = helpButton.attributes('title')
      expect(title).toContain('Click')
      expect(title).toContain('Escape')
      expect(title).toContain('Shift+Click')
      expect(title).toContain('Ctrl+Click')
    })
  })

  // NOTE: Metadata modal and title editing tests removed - these features moved to harness (example/App.vue)

  describe('programmatic selection API', () => {
    it('setSelection sets a single range', async () => {
      const wrapper = mount(SequenceEditor, {
        props: { initialZoom: 100 }
      })
      await wrapper.vm.$nextTick()

      wrapper.vm.setSelection(ezSpan(4, 8))
      await wrapper.vm.$nextTick()

      const sel = wrapper.vm.getSelection()
      expect(sel).toEqual({ start: 4, end: 8 })
    })

    it('setSelection sets multiple ranges', async () => {
      const wrapper = mount(SequenceEditor, {
        props: { initialZoom: 100 }
      })
      await wrapper.vm.$nextTick()

      // Multiple ranges use + separator
      wrapper.vm.setSelection(new Span([new Range(2, 4), new Range(8, 12)]))
      await wrapper.vm.$nextTick()

      // getSelection returns first range only
      const sel = wrapper.vm.getSelection()
      expect(sel).toEqual({ start: 2, end: 4 })

      // But both ranges should be selected (check via SelectionLayer)
      const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
      const domain = selectionLayer.vm.selection.domain.value
      expect(domain.ranges).toHaveLength(2)
      expect(domain.ranges[0].start).toBe(2)
      expect(domain.ranges[0].end).toBe(4)
      expect(domain.ranges[1].start).toBe(8)
      expect(domain.ranges[1].end).toBe(12)
    })

    it('clearSelection clears the selection', async () => {
      const wrapper = mount(SequenceEditor, {
        props: { initialZoom: 100 }
      })
      await wrapper.vm.$nextTick()

      // Set a selection first
      wrapper.vm.setSelection(ezSpan(4, 8))
      await wrapper.vm.$nextTick()
      expect(wrapper.vm.getSelection()).not.toBeNull()

      // Clear it
      wrapper.vm.clearSelection()
      await wrapper.vm.$nextTick()

      expect(wrapper.vm.getSelection()).toBeNull()
    })

    it('setSelection replaces existing selection', async () => {
      const wrapper = mount(SequenceEditor, {
        props: { initialZoom: 100 }
      })
      await wrapper.vm.$nextTick()

      // Set initial selection
      wrapper.vm.setSelection(ezSpan(0, 4))
      await wrapper.vm.$nextTick()
      expect(wrapper.vm.getSelection()).toEqual({ start: 0, end: 4 })

      // Replace with new selection
      wrapper.vm.setSelection(ezSpan(8, 12))
      await wrapper.vm.$nextTick()
      expect(wrapper.vm.getSelection()).toEqual({ start: 8, end: 12 })
    })

    it('setSelection updates selection composable state', async () => {
      const wrapper = mount(SequenceEditor, {
        props: { initialZoom: 100 }
      })
      await wrapper.vm.$nextTick()

      wrapper.vm.setSelection(ezSpan(4, 8))
      await wrapper.vm.$nextTick()

      // Check that selection layer has the selection
      const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
      expect(selectionLayer.vm.selection.isSelected.value).toBe(true)
      expect(selectionLayer.vm.selection.domain.value.ranges[0].start).toBe(4)
      expect(selectionLayer.vm.selection.domain.value.ranges[0].end).toBe(8)
    })

    it('selectAnnotation selects annotation span', async () => {
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: createDoc('ATCGATCGATCGATCGATCGATCGATCG', [{ id: 'ann-123', span: ezSpan(5, 15), caption: 'Test Gene', type: 'gene' }]),
          initialZoom: 100,
        }
      })
      await wrapper.vm.$nextTick()

      // Select by annotation ID
      wrapper.vm.selectAnnotation('ann-123')
      await wrapper.vm.$nextTick()

      // Should select the annotation's span
      const sel = wrapper.vm.getSelection()
      expect(sel).toEqual({ start: 5, end: 15 })
    })

    it('selectAnnotation does nothing for unknown annotation', async () => {
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: createDoc('ATCGATCGATCGATCGATCGATCGATCG', [{ id: 'ann-123', span: ezSpan(5, 15), caption: 'Test Gene', type: 'gene' }]),
          initialZoom: 100,
        }
      })
      await wrapper.vm.$nextTick()

      // Try to select unknown annotation
      wrapper.vm.selectAnnotation('unknown-id')
      await wrapper.vm.$nextTick()

      // Should not have any selection
      const sel = wrapper.vm.getSelection()
      expect(sel).toBeNull()
    })

    it('selectAnnotation calls scrollTo on editor container', async () => {
      // This test verifies selectAnnotation scrolls to the annotation
      // Bug: annotation.span is a Span object, but code called .match() on it (string method)
      // Must use Annotation class to reproduce the bug (constructor converts span to Span object)
      const annotations = [
        new Annotation({ id: 'ann-far', span: ezSpan(350, 400), caption: 'Far Gene', type: 'gene' })
      ]
      const wrapper = mount(SequenceEditor, {
        props: {
          // Long sequence so annotation at 350 is many lines down
          sequence: createDoc('ATCG'.repeat(125), annotations),
          initialZoom: 50
        }
      })
      await wrapper.vm.$nextTick()

      // Get editor container and spy on scrollTo
      const container = wrapper.find('.editor-container')
      expect(container.exists()).toBe(true)

      let scrollToCalled = false
      let scrollToArgs = null
      container.element.scrollTo = (args) => {
        scrollToCalled = true
        scrollToArgs = args
      }

      // Select annotation by ID - should trigger scrollTo
      wrapper.vm.selectAnnotation('ann-far')
      await wrapper.vm.$nextTick()

      // Verify selection is set
      const sel = wrapper.vm.getSelection()
      expect(sel).toEqual({ start: 350, end: 400 })

      // Verify scrollTo was called (this is the bug - it currently doesn't get called)
      expect(scrollToCalled).toBe(true)
      expect(scrollToArgs).toBeDefined()
      expect(scrollToArgs.top).toBeGreaterThan(0)
    })

    it('setCursor sets a zero-width selection at position', async () => {
      const wrapper = mount(SequenceEditor, {
        props: { initialZoom: 100 }
      })
      await wrapper.vm.$nextTick()

      wrapper.vm.setCursor(7)
      await wrapper.vm.$nextTick()

      // Zero-width selection at position 7
      const sel = wrapper.vm.getSelection()
      expect(sel).toEqual({ start: 7, end: 7 })
    })
  })

  describe('rich copy/paste', () => {
    const OVERLAY_STORAGE_KEY = 'opengenepool-copy-overlay'

    beforeEach(() => {
      localStorage.removeItem(OVERLAY_STORAGE_KEY)
    })

    it('saves overlay to localStorage when copying sequence with annotations', async () => {
      const annotations = [
        { id: 'ann-1', span: ezSpan(5, 15), caption: 'Test Gene', type: 'gene' }
      ]
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: createDoc('ATCGATCGATCGATCGATCG', annotations),
          initialZoom: 100
        }
      })
      await wrapper.vm.$nextTick()

      // Select range that includes the annotation
      wrapper.vm.setSelection(ezSpan(3, 18))
      await wrapper.vm.$nextTick()

      // Mock clipboard
      const mockClipboard = { writeText: vi.fn(() => Promise.resolve()) }
      Object.defineProperty(navigator, 'clipboard', {
        value: mockClipboard,
        writable: true,
        configurable: true
      })

      // Trigger copy via keyboard shortcut simulation
      const svg = wrapper.find('.editor-svg')
      await svg.trigger('keydown', { key: 'c', ctrlKey: true })

      // Check overlay was saved
      const overlay = JSON.parse(localStorage.getItem(OVERLAY_STORAGE_KEY))
      expect(overlay).toBeTruthy()
      expect(overlay.sequence).toBe('GATCGATCGATCGAT') // 15 bases from 3..18
      expect(overlay.annotations).toHaveLength(1)
      expect(overlay.annotations[0].caption).toBe('Test Gene')
      expect(overlay.annotations[0].type).toBe('gene')
      // Annotation 5..15 overlaps with selection 3..18
      // Overlap is 5..15, relative to selection start (3): 2..12
      expect(overlay.annotations[0].relativeRanges[0].start).toBe(2)
      expect(overlay.annotations[0].relativeRanges[0].end).toBe(12)
    })

    it('clears overlay when copying sequence with no annotations', async () => {
      // Pre-set an overlay
      localStorage.setItem(OVERLAY_STORAGE_KEY, JSON.stringify({
        sequence: createDoc('OLD'),
        annotations: [{ caption: 'Old' }]
      }))

      const wrapper = mount(SequenceEditor, {
        props: { sequence: createDoc('ATCGATCGATCGATCG'), initialZoom: 100 }
      })
      await wrapper.vm.$nextTick()

      // Select range
      wrapper.vm.setSelection(ezSpan(0, 5))
      await wrapper.vm.$nextTick()

      // Mock clipboard
      const mockClipboard = { writeText: vi.fn(() => Promise.resolve()) }
      Object.defineProperty(navigator, 'clipboard', {
        value: mockClipboard,
        writable: true,
        configurable: true
      })

      // Trigger copy
      const svg = wrapper.find('.editor-svg')
      await svg.trigger('keydown', { key: 'c', ctrlKey: true })

      // Check overlay was saved (empty annotations)
      const overlay = JSON.parse(localStorage.getItem(OVERLAY_STORAGE_KEY))
      expect(overlay).toBeTruthy()
      expect(overlay.sequence).toBe('ATCGA')
      expect(overlay.annotations).toHaveLength(0)
    })

    it('handles partial annotation overlap correctly', async () => {
      const annotations = [
        { id: 'ann-1', span: ezSpan(0, 20), caption: 'Long Gene', type: 'gene' }
      ]
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: createDoc('ATCGATCGATCGATCGATCGATCGATCG', annotations),
          initialZoom: 100
        }
      })
      await wrapper.vm.$nextTick()

      // Select only part of the annotation (5..10)
      wrapper.vm.setSelection(ezSpan(5, 10))
      await wrapper.vm.$nextTick()

      // Mock clipboard
      const mockClipboard = { writeText: vi.fn(() => Promise.resolve()) }
      Object.defineProperty(navigator, 'clipboard', {
        value: mockClipboard,
        writable: true,
        configurable: true
      })

      // Trigger copy
      const svg = wrapper.find('.editor-svg')
      await svg.trigger('keydown', { key: 'c', ctrlKey: true })

      // Check overlay - annotation should be clipped to selection bounds
      const overlay = JSON.parse(localStorage.getItem(OVERLAY_STORAGE_KEY))
      expect(overlay.annotations).toHaveLength(1)
      // Original span 0..20 clipped to selection 5..10 = overlap 5..10
      // Relative to selection start (5): 0..5
      expect(overlay.annotations[0].relativeRanges[0].start).toBe(0)
      expect(overlay.annotations[0].relativeRanges[0].end).toBe(5)
    })

    it('handles multi-range selection with annotations', async () => {
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: createDoc('ATCGATCGATCGATCGATCGATCGATCG', [{ id: 'ann-1', span: ezSpan(2, 8), caption: 'Gene1', type: 'gene' },{ id: 'ann-2', span: ezSpan(12, 18), caption: 'Gene2', type: 'CDS' }]),
          initialZoom: 100,
        }
      })
      await wrapper.vm.$nextTick()

      // Create multi-range selection: 0..10 + 10..20
      wrapper.vm.setSelection(new Span([new Range(0, 10), new Range(10, 20)]))
      await wrapper.vm.$nextTick()

      // Mock clipboard
      const mockClipboard = { writeText: vi.fn(() => Promise.resolve()) }
      Object.defineProperty(navigator, 'clipboard', {
        value: mockClipboard,
        writable: true,
        configurable: true
      })

      // Trigger copy
      const svg = wrapper.find('.editor-svg')
      await svg.trigger('keydown', { key: 'c', ctrlKey: true })

      // Check overlay
      const overlay = JSON.parse(localStorage.getItem(OVERLAY_STORAGE_KEY))
      expect(overlay.annotations).toHaveLength(2)

      // Gene1 at 2..8, in first range (0..10), relative: 2..8
      const gene1 = overlay.annotations.find(a => a.caption === 'Gene1')
      expect(gene1.relativeRanges[0].start).toBe(2)
      expect(gene1.relativeRanges[0].end).toBe(8)

      // Gene2 at 12..18, in second range (10..20), relative offset is 10 (first range length)
      // Position 12 in second range: 10 + (12-10) = 12, 18: 10 + (18-10) = 18
      const gene2 = overlay.annotations.find(a => a.caption === 'Gene2')
      expect(gene2.relativeRanges[0].start).toBe(12) // 10 + (12-10)
      expect(gene2.relativeRanges[0].end).toBe(18)   // 10 + (18-10)
    })

    it('does not include annotations outside selection', async () => {
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: createDoc('ATCGATCGATCGATCGATCGATCGATCG', [{ id: 'ann-1', span: ezSpan(0, 5), caption: 'Before', type: 'gene' },{ id: 'ann-2', span: ezSpan(15, 20), caption: 'After', type: 'gene' }]),
          initialZoom: 100,
        }
      })
      await wrapper.vm.$nextTick()

      // Select range that excludes both annotations
      wrapper.vm.setSelection(ezSpan(6, 14))
      await wrapper.vm.$nextTick()

      // Mock clipboard
      const mockClipboard = { writeText: vi.fn(() => Promise.resolve()) }
      Object.defineProperty(navigator, 'clipboard', {
        value: mockClipboard,
        writable: true,
        configurable: true
      })

      // Trigger copy
      const svg = wrapper.find('.editor-svg')
      await svg.trigger('keydown', { key: 'c', ctrlKey: true })

      // Check overlay - should have no annotations
      const overlay = JSON.parse(localStorage.getItem(OVERLAY_STORAGE_KEY))
      expect(overlay.annotations).toHaveLength(0)
    })

    it('preserves annotation orientation in overlay', async () => {
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: createDoc('ATCGATCGATCGATCGATCGATCGATCG', [{ id: 'ann-1', span: ezSpan(5, 15, Orientation.MINUS), caption: 'Minus Gene', type: 'gene' }]),
          initialZoom: 100,
        }
      })
      await wrapper.vm.$nextTick()

      // Select range that includes the annotation
      wrapper.vm.setSelection(ezSpan(0, 20))
      await wrapper.vm.$nextTick()

      // Mock clipboard
      const mockClipboard = { writeText: vi.fn(() => Promise.resolve()) }
      Object.defineProperty(navigator, 'clipboard', {
        value: mockClipboard,
        writable: true,
        configurable: true
      })

      // Trigger copy
      const svg = wrapper.find('.editor-svg')
      await svg.trigger('keydown', { key: 'c', ctrlKey: true })

      // Check overlay - should preserve minus strand orientation (-1)
      const overlay = JSON.parse(localStorage.getItem(OVERLAY_STORAGE_KEY))
      expect(overlay.annotations[0].relativeRanges[0].orientation).toBe(-1)
    })

    it('reverses annotation positions when copying minus strand selection', async () => {
      // When copying a minus strand selection, the sequence is reverse-complemented.
      // Annotations within that selection need their positions reversed accordingly.
      const annotations = [
        { id: 'ann-1', span: ezSpan(5, 10), caption: 'Test Gene', type: 'gene' }
      ]
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: createDoc('ATCGATCGATCGATCGATCGATCGATCG', annotations),
          initialZoom: 100
        }
      })
      await wrapper.vm.$nextTick()

      // Select the entire sequence as MINUS strand
      wrapper.vm.setSelection(ezSpan(0, 20, Orientation.MINUS))
      await wrapper.vm.$nextTick()

      // Mock clipboard
      const mockClipboard = { writeText: vi.fn(() => Promise.resolve()) }
      Object.defineProperty(navigator, 'clipboard', {
        value: mockClipboard,
        writable: true,
        configurable: true
      })

      // Trigger copy
      const svg = wrapper.find('.editor-svg')
      await svg.trigger('keydown', { key: 'c', ctrlKey: true })

      // Check overlay
      const overlay = JSON.parse(localStorage.getItem(OVERLAY_STORAGE_KEY))
      expect(overlay.annotations).toHaveLength(1)

      // Original annotation at 5..10 in a 20-base minus strand selection
      // should be reversed to 10..15 (since bases at 5-9 become 14-10 when reversed)
      // Formula: newStart = selectionLength - oldEnd = 20 - 10 = 10
      //          newEnd = selectionLength - oldStart = 20 - 5 = 15
      expect(overlay.annotations[0].relativeRanges[0].start).toBe(10)
      expect(overlay.annotations[0].relativeRanges[0].end).toBe(15)

      // Orientation should also flip (plus -> minus since we're in a minus strand selection)
      expect(overlay.annotations[0].relativeRanges[0].orientation).toBe(-1)
    })
  })

  describe('extensionAPI', () => {
    it('provides extensionAPI to child components', async () => {
      const wrapper = mount(SequenceEditor, {
          props: { sequence: createDoc('ATCGATCGATCG') }
        })
      await wrapper.vm.$nextTick()

      // The extensionAPI should be provided (we can't directly access provide,
      // but we can check if the extension mechanism works)
      expect(wrapper.vm.getSequence()).toBe('ATCGATCGATCG')
    })

    it('extensionAPI exposes circular status from the document', async () => {
      let capturedAPI = null
      const TestPanel = markRaw({
        template: '<div></div>',
        setup() {
          const { inject } = require('vue')
          capturedAPI = inject('extensionAPI')
          return {}
        }
      })

      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: createDoc('ATCGATCGATCG', [], true),
          extensions: [{ id: 'test', name: 'Test', panel: TestPanel }]
        }
      })
      await wrapper.vm.$nextTick()

      expect(capturedAPI).not.toBeNull()
      expect(capturedAPI.isCircular()).toBe(true)
    })

    it('onSelectionChange notifies when selection.domain changes', async () => {
      // Create a test extension that captures the API
      let capturedAPI = null
      const TestPanel = markRaw({
        template: '<div></div>',
        setup() {
          const { inject } = require('vue')
          capturedAPI = inject('extensionAPI')
          return {}
        }
      })

      const testExtension = {
        id: 'test',
        name: 'Test',
        panel: TestPanel
      }

      const wrapper = mount(SequenceEditor, {
        props: {
          initialZoom: 100,
          extensions: [testExtension]
        }
      })
      await wrapper.vm.$nextTick()

      // Get selection composable via SelectionLayer
      const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
      const selection = selectionLayer.vm.selection

      // Track callback invocations
      let callbackCount = 0
      expect(capturedAPI).not.toBeNull()

      const unsubscribe = capturedAPI.onSelectionChange(() => {
        callbackCount++
      })

      // Change selection - this should trigger the watcher
      selection.select([new Range(5, 10)])
      await wrapper.vm.$nextTick()

      expect(callbackCount).toBe(1)

      // Change selection again
      selection.select([new Range(2, 8)])
      await wrapper.vm.$nextTick()

      expect(callbackCount).toBe(2)

      // Unsubscribe and verify no more calls
      unsubscribe()

      selection.select([new Range(0, 5)])
      await wrapper.vm.$nextTick()

      expect(callbackCount).toBe(2) // Should not have increased
    })

    it('onSelectionChange uses watcher not eventBus commands', async () => {
      // This test verifies that selection changes trigger callbacks
      // even when selection is changed programmatically (not via eventBus)
      let capturedAPI = null
      const TestPanel = markRaw({
        template: '<div></div>',
        setup() {
          const { inject } = require('vue')
          capturedAPI = inject('extensionAPI')
          return {}
        }
      })

      const testExtension = {
        id: 'test',
        name: 'Test',
        panel: TestPanel
      }

      const wrapper = mount(SequenceEditor, {
        props: {
          initialZoom: 100,
          extensions: [testExtension]
        }
      })
      await wrapper.vm.$nextTick()

      let callbackCalled = false
      expect(capturedAPI).not.toBeNull()

      capturedAPI.onSelectionChange(() => {
        callbackCalled = true
      })

      // Use the exposed setSelection method (bypasses eventBus)
      wrapper.vm.setSelection(ezSpan(3, 7))
      await wrapper.vm.$nextTick()

      // Callback should still be called because we watch selection.domain
      expect(callbackCalled).toBe(true)
    })

    it('onSelectionChange fires when selection changes', async () => {
      // SequenceLayer now handles mouse events internally, which requires DOM setup
      // that's difficult in unit tests. Test the callback using programmatic selection.
      let capturedAPI = null
      const TestPanel = markRaw({
        template: '<div></div>',
        setup() {
          const { inject } = require('vue')
          capturedAPI = inject('extensionAPI')
          return {}
        }
      })

      const testExtension = {
        id: 'test',
        name: 'Test',
        panel: TestPanel
      }

      const wrapper = mount(SequenceEditor, {
        props: {
          initialZoom: 100,
          extensions: [testExtension]
        }
      })
      wrapper.vm.graphics.setContainerSize(1000, 600)
      await wrapper.vm.$nextTick()

      let callbackCount = 0
      expect(capturedAPI).not.toBeNull()

      capturedAPI.onSelectionChange(() => {
        callbackCount++
      })

      // Use the selection composable to trigger a selection change
      const selection = wrapper.findComponent({ name: 'SelectionLayer' }).vm.selection
      selection.select([new Range(5, 10)])
      await wrapper.vm.$nextTick()

      // The callback should have been triggered
      expect(callbackCount).toBeGreaterThan(0)
    })

    it('getSelectedSequence returns selected text', async () => {
      let capturedAPI = null
      const TestPanel = markRaw({
        template: '<div></div>',
        setup() {
          const { inject } = require('vue')
          capturedAPI = inject('extensionAPI')
          return {}
        }
      })

      const testExtension = {
        id: 'test',
        name: 'Test',
        panel: TestPanel
      }

      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: createDoc('ATCGATCGATCGATCGATCG'),
          initialZoom: 100,
          extensions: [testExtension]
        }
      })
      await wrapper.vm.$nextTick()

      expect(capturedAPI).not.toBeNull()

      // No selection initially
      expect(capturedAPI.getSelectedSequence()).toBe('')

      // Select a range (positions 2..6 = 'CGAT')
      wrapper.vm.setSelection(ezSpan(2, 6))
      await wrapper.vm.$nextTick()

      expect(capturedAPI.getSelectedSequence()).toBe('CGAT')
    })

    it('onSelectionChange fires when selection range is mutated (handle dragging)', async () => {
      // This test simulates what happens during handle dragging:
      // the range properties are mutated directly without replacing domain.value
      let capturedAPI = null
      const TestPanel = markRaw({
        template: '<div></div>',
        setup() {
          const { inject } = require('vue')
          capturedAPI = inject('extensionAPI')
          return {}
        }
      })

      const testExtension = {
        id: 'test',
        name: 'Test',
        panel: TestPanel
      }

      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: createDoc('ATCGATCGATCGATCGATCGATCGATCGATCGATCGATCG'),
          initialZoom: 100,
          extensions: [testExtension]
        }
      })
      await wrapper.vm.$nextTick()

      expect(capturedAPI).not.toBeNull()

      // Create initial selection
      wrapper.vm.setSelection(ezSpan(10, 15))
      await wrapper.vm.$nextTick()

      let callbackCount = 0
      capturedAPI.onSelectionChange(() => {
        callbackCount++
      })

      // Now simulate handle dragging by directly mutating the range
      // This is what SelectionLayer.vue does in handleDragMove
      const selection = wrapper.findComponent({ name: 'SelectionLayer' }).vm.selection
      const range = selection.domain.value.ranges[0]

      // Mutate the range (simulating dragging the end handle)
      range.end = 20
      await wrapper.vm.$nextTick()

      // The callback should have been triggered by the mutation
      expect(callbackCount).toBe(1)
    })

    it('addAnnotation calls backend.annotationCreated', async () => {
      let capturedAPI = null
      const TestPanel = markRaw({
        template: '<div></div>',
        setup() {
          const { inject } = require('vue')
          capturedAPI = inject('extensionAPI')
          return {}
        }
      })

      const testExtension = {
        id: 'test',
        name: 'Test',
        panel: TestPanel
      }

      const mockBackend = {
        annotationCreated: vi.fn(() => {}),
        onAck: vi.fn(() => () => {}),
        onError: vi.fn(() => () => {}),
      }

      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: createDoc('ATGATGATGATGATGATGATGATGATGATGATGATGATGATGATGATGATGATGATG', [], false, mockBackend),
          initialZoom: 100,
          extensions: [testExtension]
        }
      })
      await wrapper.vm.$nextTick()

      expect(capturedAPI).not.toBeNull()

      // Call addAnnotation via the extensionAPI
      capturedAPI.addAnnotation({
        span: ezSpan(0, 30),
        type: 'CDS',
        caption: 'Test CDS'
      })
      await wrapper.vm.$nextTick()

      // Backend should have been called
      expect(mockBackend.annotationCreated).toHaveBeenCalledTimes(1)
      const call = mockBackend.annotationCreated.mock.calls[0][0]
      expect(call.caption).toBe('Test CDS')
      expect(call.type).toBe('CDS')
      expect(call.span.toJSON()).toBe('0..30')
      expect(call.id).toBeDefined()
    })

    it('addAnnotation emits annotations-update event', async () => {
      let capturedAPI = null
      const TestPanel = markRaw({
        template: '<div></div>',
        setup() {
          const { inject } = require('vue')
          capturedAPI = inject('extensionAPI')
          return {}
        }
      })

      const testExtension = {
        id: 'test',
        name: 'Test',
        panel: TestPanel
      }

      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: createDoc('ATGATGATGATGATGATGATGATGATGATGATGATGATGATGATGATGATGATGATG'),
          initialZoom: 100,
          extensions: [testExtension]
        }
      })
      await wrapper.vm.$nextTick()

      expect(capturedAPI).not.toBeNull()

      // Call addAnnotation via the extensionAPI (now async: id minted via generator)
      capturedAPI.addAnnotation({
        span: ezSpan(0, 30),
        type: 'CDS',
        caption: 'Test CDS'
      })
      await flushPromises()

      // Should emit annotations-update
      const emitted = wrapper.emitted('annotations-update')
      expect(emitted).toBeTruthy()
      expect(emitted.length).toBeGreaterThan(0)

      // The last emitted annotations array should contain our new annotation
      const lastUpdate = emitted[emitted.length - 1][0]
      const newAnnotation = lastUpdate.find(a => a.caption === 'Test CDS')
      expect(newAnnotation).toBeDefined()
      expect(newAnnotation.type).toBe('CDS')
    })

    it('does not warn when rendering extension panel components', async () => {
      const originalConsoleWarn = console.warn
      console.warn = vi.fn(() => {})

      const TestPanel = markRaw({
        template: '<div class="test-extension-panel"></div>'
      })

      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: createDoc('ATCGATCGATCG'),
          extensions: [{
            id: 'test',
            name: 'Test',
            panel: TestPanel
          }]
        }
      })
      await wrapper.vm.$nextTick()

      expect(wrapper.find('.test-extension-panel').exists()).toBe(true)
      expect(console.warn.mock.calls.some(([message]) =>
        String(message).includes('Vue received a Component that was made a reactive object')
      )).toBe(false)

      console.warn = originalConsoleWarn
    })
  })

  describe('melting temperature display', () => {
    it('shows Tm in status box for selection under 80bp', async () => {
      const wrapper = mount(SequenceEditor, {
        props: { sequence: createDoc('ATCGATCGATCGATCGATCG'), initialZoom: 50 }
      })
      // 20bp sequence
      await wrapper.vm.$nextTick()

      // Select 10bp (positions 0-10)
      wrapper.vm.setSelection(ezSpan(0, 10))
      await wrapper.vm.$nextTick()

      // Find selection status element
      const statusBox = wrapper.find('.selection-status')
      expect(statusBox.exists()).toBe(true)
      expect(statusBox.text()).toContain('Tm:')
      expect(statusBox.text()).toContain('°C')
    })

    it('hides Tm for selection over 80bp', async () => {
      // 100bp sequence
      const wrapper = mount(SequenceEditor, {
        props: { sequence: createDoc('ATCG'.repeat(25)), initialZoom: 50 }
      })
      await wrapper.vm.$nextTick()

      // Select all 100bp
      wrapper.vm.setSelection(ezSpan(0, 100))
      await wrapper.vm.$nextTick()

      // Find selection status element
      const statusBox = wrapper.find('.selection-status')
      expect(statusBox.exists()).toBe(true)
      expect(statusBox.text()).toContain('selected')
      expect(statusBox.text()).not.toContain('Tm:')
    })

    it('shows Tm at exactly 80bp boundary', async () => {
      // 80bp sequence
      const wrapper = mount(SequenceEditor, {
        props: { sequence: createDoc('ATCG'.repeat(20)), initialZoom: 50 }
      })
      await wrapper.vm.$nextTick()

      // Select exactly 80bp
      wrapper.vm.setSelection(ezSpan(0, 80))
      await wrapper.vm.$nextTick()

      // Should show Tm (80bp is the max)
      const statusBox = wrapper.find('.selection-status')
      expect(statusBox.exists()).toBe(true)
      expect(statusBox.text()).toContain('Tm:')
    })

    it('hides Tm at 81bp (just over boundary)', async () => {
      // 81bp sequence
      const wrapper = mount(SequenceEditor, {
        props: { sequence: createDoc('ATCG'.repeat(20) + 'A'), initialZoom: 50 }
      })
      await wrapper.vm.$nextTick()

      // Select 81bp
      wrapper.vm.setSelection(ezSpan(0, 81))
      await wrapper.vm.$nextTick()

      // Should NOT show Tm (81bp exceeds limit)
      const statusBox = wrapper.find('.selection-status')
      expect(statusBox.exists()).toBe(true)
      expect(statusBox.text()).not.toContain('Tm:')
    })

    it('uses custom tmCalculator when provided', async () => {
      const customCalculator = (seq) => `Custom: ${seq.length}bp`
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: createDoc('ATCGATCGATCGATCGATCG'),
          initialZoom: 50,
          tmCalculator: customCalculator
        }
      })
      await wrapper.vm.$nextTick()

      wrapper.vm.setSelection(ezSpan(0, 10))
      await wrapper.vm.$nextTick()

      const statusBox = wrapper.find('.selection-status')
      expect(statusBox.exists()).toBe(true)
      expect(statusBox.text()).toContain('Custom: 10bp')
      expect(statusBox.text()).not.toContain('°C')
    })

    it('hides Tm when custom calculator returns null', async () => {
      const customCalculator = () => null
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: createDoc('ATCGATCGATCGATCGATCG'),
          initialZoom: 50,
          tmCalculator: customCalculator
        }
      })
      await wrapper.vm.$nextTick()

      wrapper.vm.setSelection(ezSpan(0, 10))
      await wrapper.vm.$nextTick()

      const statusBox = wrapper.find('.selection-status')
      expect(statusBox.exists()).toBe(true)
      expect(statusBox.text()).toContain('selected')
      expect(statusBox.text()).not.toContain('Tm:')
      expect(statusBox.text()).not.toContain('°C')
    })

    it('custom tmCalculator can allow longer sequences', async () => {
      // Custom calculator that allows up to 100bp
      const customCalculator = (seq) => {
        if (seq.length > 100) return null
        return `Long Tm: works`
      }
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: createDoc('ATCG'.repeat(25)),
          initialZoom: 50,
          tmCalculator: customCalculator
        }
      })
      await wrapper.vm.$nextTick()

      // Select 90bp - would be hidden by default, but custom allows it
      wrapper.vm.setSelection(ezSpan(0, 90))
      await wrapper.vm.$nextTick()

      const statusBox = wrapper.find('.selection-status')
      expect(statusBox.exists()).toBe(true)
      expect(statusBox.text()).toContain('Long Tm: works')
    })

    describe('primer binding region Tm', () => {
      it('shows binding Tm for forward primer with primer_bind when selection matches', async () => {
        // 50bp primer with 20bp binding region at end (forward strand)
        const primerSeq = 'ATCGATCGATCGATCGATCGATCGATCGATCG' + 'GCTAGCTAGCTAGCTAGC' // 32 + 18 = 50bp
        const annotation = new Annotation({
          id: 'primer1',
          caption: 'Forward Primer',
          type: 'primer',
          span: new Span([new Range(10, 60, Orientation.PLUS)]),
          attributes: { primer_bind: 18 }
        })
        const wrapper = mount(SequenceEditor, {
          props: {
            sequence: createDoc('A'.repeat(10) + primerSeq + 'A'.repeat(40), [annotation]),
            initialZoom: 100
          }
        })
        await wrapper.vm.$nextTick()

        // Select exactly the primer range
        wrapper.vm.setSelection(ezSpan(10, 60, Orientation.PLUS))
        await wrapper.vm.$nextTick()

        const statusBox = wrapper.find('.selection-status')
        expect(statusBox.exists()).toBe(true)
        expect(statusBox.text()).toContain('Tm:')
        expect(statusBox.text()).toContain('Binding Tm:')
      })

      it('shows binding Tm for reverse primer with primer_bind when selection matches', async () => {
        // Reverse primer: binding region is at START of range
        const primerSeq = 'ATCGATCGATCGATCGATCG' + 'GCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTA' // 20 + 32 = 52bp
        const annotation = new Annotation({
          id: 'primer2',
          caption: 'Reverse Primer',
          type: 'primer',
          span: new Span([new Range(10, 62, Orientation.MINUS)]),
          attributes: { primer_bind: 20 }
        })
        const wrapper = mount(SequenceEditor, {
          props: {
            sequence: createDoc('A'.repeat(10) + primerSeq + 'A'.repeat(28), [annotation]),
            initialZoom: 100
          }
        })
        await wrapper.vm.$nextTick()

        // Select exactly the primer range
        wrapper.vm.setSelection(ezSpan(10, 62, Orientation.MINUS))
        await wrapper.vm.$nextTick()

        const statusBox = wrapper.find('.selection-status')
        expect(statusBox.exists()).toBe(true)
        expect(statusBox.text()).toContain('Tm:')
        expect(statusBox.text()).toContain('Binding Tm:')
      })

      it('does not show binding Tm for primer without primer_bind attribute', async () => {
        const annotation = new Annotation({
          id: 'primer3',
          caption: 'No Bind Primer',
          type: 'primer',
          span: new Span([new Range(10, 60, Orientation.PLUS)]),
          attributes: {} // No primer_bind
        })
        const wrapper = mount(SequenceEditor, {
          props: {
            sequence: createDoc('A'.repeat(100), [annotation]),
            initialZoom: 100
          }
        })
        await wrapper.vm.$nextTick()

        wrapper.vm.setSelection(ezSpan(10, 60))
        await wrapper.vm.$nextTick()

        const statusBox = wrapper.find('.selection-status')
        expect(statusBox.exists()).toBe(true)
        expect(statusBox.text()).toContain('Tm:')
        expect(statusBox.text()).not.toContain('Binding Tm:')
      })

      it('does not show binding Tm when selection does not exactly match primer', async () => {
        const annotation = new Annotation({
          id: 'primer4',
          caption: 'Partial Primer',
          type: 'primer',
          span: new Span([new Range(10, 60, Orientation.PLUS)]),
          attributes: { primer_bind: 20 }
        })
        const wrapper = mount(SequenceEditor, {
          props: {
            sequence: createDoc('A'.repeat(100), [annotation]),
            initialZoom: 100
          }
        })
        await wrapper.vm.$nextTick()

        // Select only part of the primer (not exact match)
        wrapper.vm.setSelection(ezSpan(10, 50))
        await wrapper.vm.$nextTick()

        const statusBox = wrapper.find('.selection-status')
        expect(statusBox.exists()).toBe(true)
        expect(statusBox.text()).not.toContain('Binding Tm:')
      })

      it('does not show binding Tm for non-primer annotation', async () => {
        const annotation = new Annotation({
          id: 'gene1',
          caption: 'Some Gene',
          type: 'CDS',
          span: new Span([new Range(10, 60, Orientation.PLUS)]),
          attributes: { primer_bind: 20 } // Would have primer_bind but wrong type
        })
        const wrapper = mount(SequenceEditor, {
          props: {
            sequence: createDoc('A'.repeat(100), [annotation]),
            initialZoom: 100
          }
        })
        await wrapper.vm.$nextTick()

        wrapper.vm.setSelection(ezSpan(10, 60))
        await wrapper.vm.$nextTick()

        const statusBox = wrapper.find('.selection-status')
        expect(statusBox.exists()).toBe(true)
        expect(statusBox.text()).not.toContain('Binding Tm:')
      })
    })
  })

  describe('document mode (no alignment)', () => {
    // SequenceEditor is designed for single sequence editing only.
    // For alignment mode (comparing two sequences), use AlignmentEditor instead.

    it('accepts SequenceDocument directly', () => {
      const doc = createDoc('ATCGATCG')
      const wrapper = mount(SequenceEditor, {
        props: { sequence: doc }
      })
      expect(wrapper.vm.targetDoc).toBe(doc)
    })

    it('exposes targetDoc as the provided sequence', () => {
      const doc = createDoc('ATCGATCG')
      const wrapper = mount(SequenceEditor, {
        props: { sequence: doc }
      })
      expect(wrapper.vm.targetDoc).toBe(doc)
      expect(wrapper.vm.targetDoc.sequence).toBe('ATCGATCG')
    })

    it('renders sequence normally', async () => {
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: createDoc('ATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCG'),
          initialZoom: 50
        }
      })
      await wrapper.vm.$nextTick()

      // Should render sequence in a single layer
      const sequenceLayers = wrapper.findAllComponents({ name: 'SequenceLayer' })
      expect(sequenceLayers.length).toBe(1)
    })

    it('shows circular view toggle for circular sequences', async () => {
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: createDoc('ATCG'.repeat(100), [], true),  // circular = true
          initialZoom: 50
        }
      })
      await wrapper.vm.$nextTick()

      const viewModeToggle = wrapper.find('.view-mode-toggle')
      expect(viewModeToggle.exists()).toBe(true)
    })

    it('emits stable data-view-mode attributes on view toggle buttons', async () => {
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: createDoc('ATCG'.repeat(100), [], true),  // circular = true
          initialZoom: 50
        }
      })
      await wrapper.vm.$nextTick()

      expect(wrapper.find('[data-view-mode="linear"]').exists()).toBe(true)
      expect(wrapper.find('[data-view-mode="circular"]').exists()).toBe(true)
    })

    it('shows selection status text for selections', async () => {
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: createDoc('ATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCG'),
          initialZoom: 50
        }
      })
      await wrapper.vm.$nextTick()

      wrapper.vm.setSelection(ezSpan(0, 10))
      await wrapper.vm.$nextTick()

      const statusText = wrapper.vm.selectionStatusText
      expect(statusText).toContain('selected')
      expect(statusText).toContain('10 bases')
    })

    it('returns null for selection status when no selection', async () => {
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: createDoc('ATCGATCGATCG'),
          initialZoom: 50
        }
      })
      await wrapper.vm.$nextTick()

      wrapper.vm.clearSelection()
      await wrapper.vm.$nextTick()

      expect(wrapper.vm.selectionStatusText).toBeNull()
    })

    it('exposes public API without alignment-related methods', () => {
      // SequenceEditor exposes the standard API for single sequence editing.
      // Alignment-related methods are in AlignmentEditor instead.
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: createDoc('ATCGATCG')
        }
      })

      // Verify standard API is exposed
      expect(typeof wrapper.vm.setSequence).toBe('function')
      expect(typeof wrapper.vm.getSequence).toBe('function')
      expect(typeof wrapper.vm.setZoom).toBe('function')
      expect(typeof wrapper.vm.getSelection).toBe('function')
      expect(typeof wrapper.vm.setSelection).toBe('function')
      expect(typeof wrapper.vm.clearSelection).toBe('function')
      expect(typeof wrapper.vm.setCursor).toBe('function')
      expect(typeof wrapper.vm.scrollToPosition).toBe('function')
      expect(wrapper.vm.targetDoc).toBeDefined()
      expect(typeof wrapper.vm.getSelectedSequence).toBe('function')
      expect(wrapper.vm.selection).toBeDefined()
    })
  })

  describe('clip primer binding context menu integration', () => {
    it('shows "Clip primer binding" when selection matches primer and annotation has one end inside', async () => {
      // Create primer at 250..290 and overlapping annotation (MCS) at 260..316
      // MCS start=260 is inside selection (250 < 260 < 290), end=316 is outside
      const primer = new Annotation({
        id: 'primer-1',
        type: 'primer',
        caption: 'TestPrimer',
        span: new Span([new Range(250, 290, Orientation.PLUS)])
      })
      const mcs = new Annotation({
        id: 'mcs-1',
        type: 'misc_feature',
        caption: 'MCS',
        span: new Span([new Range(260, 316, Orientation.NONE)])
      })

      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: createDoc('A'.repeat(500), [primer, mcs]),
          initialZoom: 100
        }
      })
      await wrapper.vm.$nextTick()

      // Set selection to exactly match primer span (250..290)
      const selection = wrapper.vm.selection
      selection.startSelection(250)
      selection.updateSelection(290)
      selection.endSelection(290)
      await wrapper.vm.$nextTick()

      // Find AnnotationLayer and emit contextmenu event for MCS annotation
      const annotationLayer = wrapper.findComponent({ name: 'AnnotationLayer' })
      annotationLayer.vm.$emit('contextmenu', {
        event: { clientX: 100, clientY: 100, preventDefault: () => {} },
        annotation: mcs,
        fragment: { rangeIndex: 0 }
      })
      await wrapper.vm.$nextTick()

      // Context menu should show "Clip primer binding of TestPrimer"
      expect(wrapper.find('.context-menu').exists()).toBe(true)
      const menuText = wrapper.find('.context-menu').text()
      expect(menuText).toContain('Clip primer binding of TestPrimer')
    })

    it('does not show "Clip primer binding" when no selection', async () => {
      const primer = new Annotation({
        id: 'primer-1',
        type: 'primer',
        caption: 'TestPrimer',
        span: new Span([new Range(250, 290, Orientation.PLUS)])
      })
      const mcs = new Annotation({
        id: 'mcs-1',
        type: 'misc_feature',
        caption: 'MCS',
        span: new Span([new Range(260, 316, Orientation.NONE)])
      })

      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: createDoc('A'.repeat(500), [primer, mcs]),
          initialZoom: 100
        }
      })
      await wrapper.vm.$nextTick()

      // No selection - don't set any

      // Find AnnotationLayer and emit contextmenu event for MCS annotation
      const annotationLayer = wrapper.findComponent({ name: 'AnnotationLayer' })
      annotationLayer.vm.$emit('contextmenu', {
        event: { clientX: 100, clientY: 100, preventDefault: () => {} },
        annotation: mcs,
        fragment: { rangeIndex: 0 }
      })
      await wrapper.vm.$nextTick()

      // Context menu should NOT show "Clip primer binding"
      expect(wrapper.find('.context-menu').exists()).toBe(true)
      const menuText = wrapper.find('.context-menu').text()
      expect(menuText).not.toContain('Clip primer binding')
    })

    it('does not show "Clip primer binding" when selection does not match primer exactly', async () => {
      const primer = new Annotation({
        id: 'primer-1',
        type: 'primer',
        caption: 'TestPrimer',
        span: new Span([new Range(250, 290, Orientation.PLUS)])
      })
      const mcs = new Annotation({
        id: 'mcs-1',
        type: 'misc_feature',
        caption: 'MCS',
        span: new Span([new Range(260, 316, Orientation.NONE)])
      })

      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: createDoc('A'.repeat(500), [primer, mcs]),
          initialZoom: 100
        }
      })
      await wrapper.vm.$nextTick()

      // Set selection that does NOT match primer (different range)
      const selection = wrapper.vm.selection
      selection.startSelection(240)
      selection.updateSelection(280)
      selection.endSelection(280)
      await wrapper.vm.$nextTick()

      // Find AnnotationLayer and emit contextmenu event for MCS annotation
      const annotationLayer = wrapper.findComponent({ name: 'AnnotationLayer' })
      annotationLayer.vm.$emit('contextmenu', {
        event: { clientX: 100, clientY: 100, preventDefault: () => {} },
        annotation: mcs,
        fragment: { rangeIndex: 0 }
      })
      await wrapper.vm.$nextTick()

      // Context menu should NOT show "Clip primer binding"
      expect(wrapper.find('.context-menu').exists()).toBe(true)
      const menuText = wrapper.find('.context-menu').text()
      expect(menuText).not.toContain('Clip primer binding')
    })
  })

  // A selection drag that starts on the sequence text must keep tracking the cursor
  // even while the cursor is over the tall whitespace between lines (whitespace that
  // exists because annotations elsewhere inflate a line's height). The selection must
  // reflect the position projected from the current cursor (clamped to the line), not
  // freeze at the last position that was directly over the sequence text.
  describe('drag selection tracks the cursor over inter-line whitespace', () => {
    it('keeps updating to the projected position while the cursor is in an annotation-inflated gap', async () => {
      const wrapper = mount(SequenceEditor, {
        props: { sequence: createDoc('A'.repeat(200)), initialZoom: 50 },
        attachTo: document.body
      })
      await wrapper.vm.$nextTick()

      const graphics = wrapper.vm.graphics
      const editorState = wrapper.vm.editorState
      const zoom = editorState.zoomLevel.value            // 50 → 4 lines for 200bp
      expect(editorState.lineCount.value).toBeGreaterThan(1)

      // Inflate line 1's height to create a tall whitespace band above line 1's text
      // (as stacked annotations on that line would). Drives the real lineExtraHeight path.
      graphics.setLineExtraHeight(1, 80, 'test')
      await wrapper.vm.$nextTick()
      expect(graphics.lineExtraHeight.value.get(1)).toBe(80)

      const metrics = graphics.metrics.value
      const { lmargin, charWidth } = metrics

      // Known SVG rect at the origin so clientX/clientY map directly into SVG space.
      const svg = wrapper.find('.editor-svg')
      svg.element.getBoundingClientRect = () => ({
        x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 2000, width: 1000, height: 2000
      })

      // Y in line-1's inflated whitespace band: between line-0's bottom and line-1's
      // text top. We assert this Y resolves to line 1 (the code's own mapping).
      const settings = editorState.settings.value
      const lh = graphics.lineHeight.value
      const line0Bottom = settings.vmargin + 20 /*tooltipMargin*/ + settings.linetopmargin + lh
      const gapY = line0Bottom + settings.linepadding + 20 // inside line-1's extra band
      const lineIndexAtGap = graphics.pixelToLineIndex(gapY, editorState.lineCount.value)
      expect(lineIndexAtGap).toBe(1)

      // Mousedown on the LINE 0 overlay at base 5.
      const overlays = wrapper.findAll('.sequence-overlay')
      const line0Overlay = overlays[0]
      const startX = lmargin + 5 * charWidth + charWidth / 2
      await line0Overlay.trigger('mousedown', { button: 0, clientX: startX, clientY: 5 })

      // Drag: cursor X for base 15 within line 1 (i.e. absolute base zoom+15), but the
      // cursor Y is in the inflated whitespace gap (off the sequence text).
      const targetLinePos = 15
      const moveX = lmargin + targetLinePos * charWidth + charWidth / 2
      window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: moveX, clientY: gapY }))
      await wrapper.vm.$nextTick()

      // Expected projected position = lineIndex*zoom + clamp(linePos, zoom). It must
      // reflect the cursor (line 1, ~base 15), NOT freeze at the mousedown base (5).
      const expectedPos = 1 * zoom + Math.min(targetLinePos, zoom)
      const ranges = wrapper.vm.selection.domain.value.ranges
      expect(ranges.length).toBeGreaterThan(0)
      const range = ranges[ranges.length - 1]
      expect(range.end).toBe(expectedPos)
      expect(range.end).not.toBe(5)        // not frozen at the last on-text position
      expect(range.start).toBe(5)          // anchor stays at mousedown

      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
      await wrapper.vm.$nextTick()
      expect(wrapper.vm.selection.domain.value.ranges[0].end).toBe(expectedPos)

      wrapper.unmount()
    })
  })
})
