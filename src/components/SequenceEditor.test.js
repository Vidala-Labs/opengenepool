import { describe, it, expect, beforeEach, mock } from 'bun:test'
import { mount } from '@vue/test-utils'
import SequenceEditor from './SequenceEditor.vue'
import { Annotation } from '../utils/annotation.js'
import { STORAGE_KEY } from '../composables/usePersistedZoom.js'

describe('SequenceEditor', () => {
  // Clear persisted zoom before each test so initialZoom prop takes effect
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY)
  })
  describe('initial state', () => {
    it('renders empty state when no sequence', () => {
      const wrapper = mount(SequenceEditor)
      expect(wrapper.text()).toContain('No sequence loaded')
    })

    it('has default zoom level of 100 (clamped to 50 minimum without sequence)', () => {
      const wrapper = mount(SequenceEditor)
      // Without a sequence, zoom is clamped to minimum of 50
      expect(wrapper.vm.editorState.zoomLevel.value).toBe(50)
    })

    it('uses initial zoom when sequence supports it', async () => {
      const wrapper = mount(SequenceEditor, {
        props: { initialZoom: 100 }
      })
      wrapper.vm.setSequence('A'.repeat(500))
      await wrapper.vm.$nextTick()
      wrapper.vm.setZoom(100)
      await wrapper.vm.$nextTick()
      expect(wrapper.vm.editorState.zoomLevel.value).toBe(100)
    })

    it('accepts custom initial zoom', () => {
      const wrapper = mount(SequenceEditor, {
        props: { initialZoom: 50 }
      })
      expect(wrapper.vm.editorState.zoomLevel.value).toBe(50)
    })

    it('emits ready event on mount', async () => {
      const wrapper = mount(SequenceEditor)
      await wrapper.vm.$nextTick()
      expect(wrapper.emitted('ready')).toBeTruthy()
    })
  })

  describe('setSequence', () => {
    it('loads a sequence via setSequence method', async () => {
      const wrapper = mount(SequenceEditor)

      wrapper.vm.setSequence('ATCGATCG', 'Test Sequence')
      await wrapper.vm.$nextTick()

      expect(wrapper.text()).not.toContain('No sequence loaded')
      expect(wrapper.text()).toContain('8 bp')
      expect(wrapper.text()).toContain('Test Sequence')
    })

    it('returns sequence via getSequence', () => {
      const wrapper = mount(SequenceEditor)
      const seq = 'ATCGATCG'

      wrapper.vm.setSequence(seq)

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
        props: { initialZoom: 50 }
      })

      wrapper.vm.setSequence('A'.repeat(150))
      await wrapper.vm.$nextTick()

      // 150 / 50 = 3 lines
      const lines = wrapper.findAll('.sequence-line')
      expect(lines).toHaveLength(3)
    })

    it('renders position labels', async () => {
      const wrapper = mount(SequenceEditor, {
        props: { initialZoom: 50 }
      })

      wrapper.vm.setSequence('A'.repeat(150))
      await wrapper.vm.$nextTick()

      const labels = wrapper.findAll('.position-label')
      expect(labels).toHaveLength(3)
      expect(labels[0].text()).toBe('0')
      expect(labels[1].text()).toBe('50')
      expect(labels[2].text()).toBe('100')
    })
  })

  describe('zoom controls', () => {
    it('renders zoom selector', () => {
      const wrapper = mount(SequenceEditor)
      expect(wrapper.find('select').exists()).toBe(true)
    })

    it('changes zoom level when selector changes', async () => {
      const wrapper = mount(SequenceEditor)
      wrapper.vm.setSequence('A'.repeat(1000))
      await wrapper.vm.$nextTick()

      wrapper.vm.setZoom(200)
      await wrapper.vm.$nextTick()

      expect(wrapper.vm.editorState.zoomLevel.value).toBe(200)
    })

    it('updates line count when zoom changes', async () => {
      const wrapper = mount(SequenceEditor, {
        props: { initialZoom: 50 }
      })
      wrapper.vm.setSequence('A'.repeat(500))
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
      const wrapper = mount(SequenceEditor)
      wrapper.vm.setSequence('ATCGATCGATCG')
      await wrapper.vm.$nextTick()

      // Get the selection composable from the SelectionLayer
      const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
      const selection = selectionLayer.vm.selection
      selection.select('2..8')
      await wrapper.vm.$nextTick()

      const sel = wrapper.vm.getSelection()
      expect(sel).toEqual({ start: 2, end: 8 })
    })

    it('renders selection highlight when selection exists', async () => {
      const wrapper = mount(SequenceEditor, {
        props: { initialZoom: 50 }
      })
      wrapper.vm.setSequence('A'.repeat(100))
      await wrapper.vm.$nextTick()

      // Get the selection composable from the SelectionLayer
      const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
      const selection = selectionLayer.vm.selection
      selection.select('10..40')
      await wrapper.vm.$nextTick()

      const highlight = wrapper.find('.selection-highlight')
      expect(highlight.exists()).toBe(true)
    })

    it('adds a new range with Ctrl+click+drag', async () => {
      const wrapper = mount(SequenceEditor, {
        props: { initialZoom: 100 }
      })
      wrapper.vm.setSequence('A'.repeat(200))
      await wrapper.vm.$nextTick()

      // Get the selection composable
      const selection = wrapper.vm.$refs?.selectionLayerRef?.selection
        || wrapper.findComponent({ name: 'SelectionLayer' }).vm.selection

      // Create initial selection at positions 10-20
      selection.select('10..20')
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
        props: { initialZoom: 100 }
      })
      wrapper.vm.setSequence('A'.repeat(200))
      wrapper.vm.graphics.setContainerSize(1000, 600)
      await wrapper.vm.$nextTick()

      // Get the selection composable
      const selection = wrapper.findComponent({ name: 'SelectionLayer' }).vm.selection

      // Create initial selection at positions 10-20
      selection.select('10..20')
      await wrapper.vm.$nextTick()

      expect(selection.isSelected.value).toBe(true)
      expect(selection.domain.value.ranges).toHaveLength(1)

      // Find the sequence overlay and trigger Ctrl+mousedown
      const overlay = wrapper.find('.sequence-overlay')

      await overlay.trigger('mousedown', {
        button: 0,
        ctrlKey: true,
        clientX: 500,  // Somewhere in the middle
        clientY: 20
      })
      await wrapper.vm.$nextTick()

      // Check if a new range was added
      expect(selection.domain.value.ranges.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('text vs bar mode', () => {
    it('uses text mode at low zoom levels', async () => {
      const wrapper = mount(SequenceEditor, {
        props: { initialZoom: 50 }
      })
      // Force text mode by setting large container
      wrapper.vm.graphics.setContainerSize(1000, 600)
      wrapper.vm.setSequence('ATCGATCG')
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
        props: { initialZoom: 100 }
      })
      wrapper.vm.setSequence('A'.repeat(200))
      await wrapper.vm.$nextTick()

      // Create a single selection
      const selection = wrapper.findComponent({ name: 'SelectionLayer' }).vm.selection
      selection.select('10..20')
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
        props: { initialZoom: 100 }
      })
      wrapper.vm.setSequence('A'.repeat(200))
      await wrapper.vm.$nextTick()

      // Create multiple ranges
      const selection = wrapper.findComponent({ name: 'SelectionLayer' }).vm.selection
      selection.select('10..20')
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
        props: { initialZoom: 100 }
      })
      wrapper.vm.setSequence('A'.repeat(200))
      await wrapper.vm.$nextTick()

      // Create a selection
      const selection = wrapper.findComponent({ name: 'SelectionLayer' }).vm.selection
      selection.select('10..20')
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
        props: { initialZoom: 100, readonly: true }
      })
      wrapper.vm.setSequence('A'.repeat(200))
      await wrapper.vm.$nextTick()

      // Create a selection
      const selection = wrapper.findComponent({ name: 'SelectionLayer' }).vm.selection
      selection.select('10..20')
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
        props: { initialZoom: 100, readonly: true }
      })
      wrapper.vm.setSequence('A'.repeat(200))
      await wrapper.vm.$nextTick()

      // Create a zero-length selection (cursor)
      const selection = wrapper.findComponent({ name: 'SelectionLayer' }).vm.selection
      selection.select('10..10')
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
    const HIDDEN_TYPES_KEY = 'opengenepool-hidden-annotation-types'

    beforeEach(() => {
      localStorage.removeItem(HIDDEN_TYPES_KEY)
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
        new Annotation({ id: 'ann1', type: 'gene', span: '10..50' }),
        new Annotation({ id: 'ann2', type: 'promoter', span: '60..80' })
      ]

      const wrapper = mount(SequenceEditor, {
        props: { annotations }
      })
      wrapper.vm.setSequence('A'.repeat(500))
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
        props: { annotations: [] }
      })
      await wrapper.find('.config-button').trigger('click')
      // No config-types section when there are no annotations
      expect(wrapper.find('.config-types').exists()).toBe(false)
    })

    it('hides annotations when type is unchecked', async () => {
      const annotations = [
        new Annotation({ id: 'ann1', type: 'gene', span: '10..50' }),
        new Annotation({ id: 'ann2', type: 'promoter', span: '60..80' })
      ]

      const wrapper = mount(SequenceEditor, {
        props: { annotations, initialZoom: 100 }
      })
      wrapper.vm.setSequence('A'.repeat(500))
      await wrapper.vm.$nextTick()

      // Initially both visible
      let layer = wrapper.findComponent({ name: 'AnnotationLayer' })
      expect(layer.props('annotations').length).toBe(2)

      // Open config and uncheck 'gene'
      await wrapper.find('.config-button').trigger('click')
      const checkboxes = wrapper.findAll('.type-row input[type="checkbox"]')
      const geneRow = wrapper.findAll('.type-row').find(r => r.text().includes('gene'))
      await geneRow.find('input[type="checkbox"]').trigger('change')

      await wrapper.vm.$nextTick()

      // Now only promoter should be visible
      layer = wrapper.findComponent({ name: 'AnnotationLayer' })
      expect(layer.props('annotations').length).toBe(1)
      expect(layer.props('annotations')[0].type).toBe('promoter')
    })

    it('hides source type by default', async () => {
      const annotations = [
        new Annotation({ id: 'ann1', type: 'source', span: '1..500' }),
        new Annotation({ id: 'ann2', type: 'gene', span: '10..50' })
      ]

      const wrapper = mount(SequenceEditor, {
        props: { annotations, initialZoom: 100 }
      })
      wrapper.vm.setSequence('A'.repeat(500))
      await wrapper.vm.$nextTick()

      // source should be hidden by default, only gene visible
      const layer = wrapper.findComponent({ name: 'AnnotationLayer' })
      expect(layer.props('annotations').length).toBe(1)
      expect(layer.props('annotations')[0].type).toBe('gene')
    })

    it('persists hidden types to localStorage', async () => {
      const annotations = [
        new Annotation({ id: 'ann1', type: 'gene', span: '10..50' }),
        new Annotation({ id: 'ann2', type: 'promoter', span: '60..80' })
      ]

      const wrapper = mount(SequenceEditor, {
        props: { annotations, initialZoom: 100 }
      })
      wrapper.vm.setSequence('A'.repeat(500))
      await wrapper.vm.$nextTick()

      // Hide gene type
      await wrapper.find('.config-button').trigger('click')
      const geneRow = wrapper.findAll('.type-row').find(r => r.text().includes('gene'))
      await geneRow.find('input[type="checkbox"]').trigger('change')
      await wrapper.vm.$nextTick()

      // Check localStorage
      const stored = JSON.parse(localStorage.getItem(HIDDEN_TYPES_KEY))
      expect(stored).toContain('gene')
    })

    it('loads hidden types from localStorage', async () => {
      // Pre-set localStorage to hide 'gene'
      localStorage.setItem(HIDDEN_TYPES_KEY, JSON.stringify(['gene']))

      const annotations = [
        new Annotation({ id: 'ann1', type: 'gene', span: '10..50' }),
        new Annotation({ id: 'ann2', type: 'promoter', span: '60..80' })
      ]

      const wrapper = mount(SequenceEditor, {
        props: { annotations, initialZoom: 100 }
      })
      wrapper.vm.setSequence('A'.repeat(500))
      await wrapper.vm.$nextTick()

      // Gene should be hidden based on localStorage
      const layer = wrapper.findComponent({ name: 'AnnotationLayer' })
      expect(layer.props('annotations').length).toBe(1)
      expect(layer.props('annotations')[0].type).toBe('promoter')
    })

    it('renders color swatch for each annotation type', async () => {
      const annotations = [
        new Annotation({ id: 'ann1', type: 'promoter', span: '10..50' })
      ]

      const wrapper = mount(SequenceEditor, {
        props: { annotations }
      })
      wrapper.vm.setSequence('A'.repeat(500))
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
        new Annotation({ id: 'ann1', type: 'gene', span: '10..50' })
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
        new Annotation({ id: 'ann1', type: 'gene', span: '10..50' })
      ]

      const wrapper = mount(SequenceEditor, {
        props: { annotations }
      })
      wrapper.vm.setSequence('A'.repeat(500))
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
        new Annotation({ id: 'ann1', type: 'promoter', span: '10..50' })
      ]

      const wrapper = mount(SequenceEditor, {
        props: { annotations }
      })
      wrapper.vm.setSequence('A'.repeat(500))
      await wrapper.vm.$nextTick()

      // Promoter should use default color since it wasn't in stored colors
      const layer = wrapper.findComponent({ name: 'AnnotationLayer' })
      const path = layer.find('.annotation-fragment path')
      expect(path.attributes('fill')).toBe('#FF9800')
    })

    it('annotation layer uses default colors for unknown types', async () => {
      const annotations = [
        new Annotation({ id: 'ann1', type: 'unknown_custom_type', span: '10..50' })
      ]

      const wrapper = mount(SequenceEditor, {
        props: { annotations }
      })
      wrapper.vm.setSequence('A'.repeat(500))
      await wrapper.vm.$nextTick()

      // Unknown type should use _default color
      const layer = wrapper.findComponent({ name: 'AnnotationLayer' })
      const path = layer.find('.annotation-fragment path')
      expect(path.attributes('fill')).toBe('#607D8B')
    })
  })

  describe('selection deselect behavior', () => {
    it('Escape key clears selection', async () => {
      const wrapper = mount(SequenceEditor)
      wrapper.vm.setSequence('ATCGATCGATCG')
      await wrapper.vm.$nextTick()

      // Create a selection via the selection layer
      const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
      const selection = selectionLayer.vm.selection
      selection.select('2..5')
      await wrapper.vm.$nextTick()

      expect(selection.isSelected.value).toBe(true)

      // Press Escape on the SVG
      const svg = wrapper.find('svg.editor-svg')
      await svg.trigger('keydown', { key: 'Escape' })

      expect(selection.isSelected.value).toBe(false)
    })

    it('clicking on SVG background clears selection', async () => {
      const wrapper = mount(SequenceEditor)
      wrapper.vm.setSequence('ATCGATCGATCG')
      await wrapper.vm.$nextTick()

      // Create a selection
      const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
      const selection = selectionLayer.vm.selection
      selection.select('2..5')
      await wrapper.vm.$nextTick()

      expect(selection.isSelected.value).toBe(true)

      // Click on the background rect (null space)
      const background = wrapper.find('.svg-background')
      await background.trigger('mousedown', { button: 0 })

      expect(selection.isSelected.value).toBe(false)
    })

    it('help button renders with tooltip', () => {
      const wrapper = mount(SequenceEditor)
      wrapper.vm.setSequence('ATCG')

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
  describe('metadata modal edit mode', () => {
    it('shows Edit button when not readonly', async () => {
      const wrapper = mount(SequenceEditor, {
        props: {
          metadata: { molecule_type: 'DNA', definition: 'Test sequence' }
        }
      })
      wrapper.vm.setSequence('ATCG')
      await wrapper.vm.$nextTick()

      // Open metadata modal
      wrapper.vm.openMetadataModal()
      await wrapper.vm.$nextTick()

      expect(wrapper.find('.edit-button').exists()).toBe(true)
    })

    it('does not render Edit button when readonly', async () => {
      const wrapper = mount(SequenceEditor, {
        props: {
          readonly: true,
          metadata: { molecule_type: 'DNA', definition: 'Test sequence' }
        }
      })
      wrapper.vm.setSequence('ATCG')
      await wrapper.vm.$nextTick()

      // Open metadata modal
      wrapper.vm.openMetadataModal()
      await wrapper.vm.$nextTick()

      expect(wrapper.find('.edit-button').exists()).toBe(false)
    })

    it('enters edit mode when Edit button clicked', async () => {
      const wrapper = mount(SequenceEditor, {
        props: {
          metadata: {
            molecule_type: 'DNA',
            circular: true,
            definition: 'Test definition',
            locus_name: 'TestLocus'
          }
        }
      })
      wrapper.vm.setSequence('ATCG')
      await wrapper.vm.$nextTick()

      wrapper.vm.openMetadataModal()
      await wrapper.vm.$nextTick()

      await wrapper.find('.edit-button').trigger('click')
      await wrapper.vm.$nextTick()

      // Edit form should be visible
      expect(wrapper.find('.metadata-edit-form').exists()).toBe(true)

      // Form fields should be populated with current values
      expect(wrapper.find('#edit-type').element.value).toBe('DNA')
      // Circular toggle - the "Circular" button should be active
      const circularBtn = wrapper.findAll('.toggle-option').at(1)
      expect(circularBtn.classes()).toContain('active')
      expect(wrapper.find('#edit-definition').element.value).toBe('Test definition')
      expect(wrapper.find('#edit-locus').element.value).toBe('TestLocus')
    })

    it('cancels edit mode and returns to view mode', async () => {
      const wrapper = mount(SequenceEditor, {
        props: {
          metadata: { molecule_type: 'DNA', definition: 'Test' }
        }
      })
      wrapper.vm.setSequence('ATCG')
      await wrapper.vm.$nextTick()

      wrapper.vm.openMetadataModal()
      await wrapper.vm.$nextTick()

      // Enter edit mode
      await wrapper.find('.edit-button').trigger('click')
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.metadata-edit-form').exists()).toBe(true)

      // Cancel
      await wrapper.find('.btn-cancel').trigger('click')
      await wrapper.vm.$nextTick()

      // Should return to view mode
      expect(wrapper.find('.metadata-edit-form').exists()).toBe(false)
      expect(wrapper.find('.metadata-list').exists()).toBe(true)
    })

    it('calls backend.metadataUpdate on save with changed fields', async () => {
      const mockBackend = {
        metadataUpdate: mock(() => {}),
        onAck: mock(() => () => {}),
        onError: mock(() => () => {}),
      }
      const wrapper = mount(SequenceEditor, {
        props: {
          backend: mockBackend,
          metadata: { molecule_type: 'DNA', definition: 'Original' }
        }
      })
      wrapper.vm.setSequence('ATCG')
      await wrapper.vm.$nextTick()

      wrapper.vm.openMetadataModal()
      await wrapper.vm.$nextTick()

      // Enter edit mode
      await wrapper.find('.edit-button').trigger('click')
      await wrapper.vm.$nextTick()

      // Change definition
      await wrapper.find('#edit-definition').setValue('Updated definition')
      await wrapper.vm.$nextTick()

      // Save via form submit
      await wrapper.find('.metadata-edit-form').trigger('submit')
      await wrapper.vm.$nextTick()

      expect(mockBackend.metadataUpdate).toHaveBeenCalledTimes(1)
      const call = mockBackend.metadataUpdate.mock.calls[0][0]
      expect(call.metadata.definition).toBe('Updated definition')
      expect(call.id).toBeDefined()
    })

    it('calls backend.metadataUpdate with all changed fields', async () => {
      const mockBackend = {
        metadataUpdate: mock(() => {}),
        onAck: mock(() => () => {}),
        onError: mock(() => () => {}),
      }
      const wrapper = mount(SequenceEditor, {
        props: {
          backend: mockBackend,
          metadata: { molecule_type: 'DNA', circular: false, definition: 'Original', locus_name: 'OldLocus' }
        }
      })
      wrapper.vm.setSequence('ATCG')
      await wrapper.vm.$nextTick()

      wrapper.vm.openMetadataModal()
      await wrapper.vm.$nextTick()

      await wrapper.find('.edit-button').trigger('click')
      await wrapper.vm.$nextTick()

      // Change multiple fields
      await wrapper.find('#edit-type').setValue('RNA')
      // Click the "Circular" toggle button (index 1) to change from false to true
      await wrapper.findAll('.toggle-option').at(1).trigger('click')
      await wrapper.find('#edit-definition').setValue('New definition')
      await wrapper.find('#edit-locus').setValue('NewLocus')
      await wrapper.vm.$nextTick()

      // Save via form submit
      await wrapper.find('.metadata-edit-form').trigger('submit')
      await wrapper.vm.$nextTick()

      // Should call metadataUpdate once with full metadata
      expect(mockBackend.metadataUpdate).toHaveBeenCalledTimes(1)

      const call = mockBackend.metadataUpdate.mock.calls[0][0]
      expect(call.id).toBeDefined()
      expect(call.metadata.molecule_type).toBe('RNA')
      expect(call.metadata.circular).toBe(true)
      expect(call.metadata.definition).toBe('New definition')
      expect(call.metadata.locus_name).toBe('NewLocus')
    })

    it('calls backend.metadataUpdate with full metadata even if no fields changed', async () => {
      const mockBackend = {
        metadataUpdate: mock(() => {}),
        onAck: mock(() => () => {}),
        onError: mock(() => () => {}),
      }
      const wrapper = mount(SequenceEditor, {
        props: {
          backend: mockBackend,
          metadata: { molecule_type: 'DNA', definition: 'Test' }
        }
      })
      wrapper.vm.setSequence('ATCG')
      await wrapper.vm.$nextTick()

      wrapper.vm.openMetadataModal()
      await wrapper.vm.$nextTick()

      await wrapper.find('.edit-button').trigger('click')
      await wrapper.vm.$nextTick()

      // Don't change anything, just save - full metadata is always sent
      await wrapper.find('.metadata-edit-form').trigger('submit')
      await wrapper.vm.$nextTick()

      expect(mockBackend.metadataUpdate).toHaveBeenCalledTimes(1)
      const call = mockBackend.metadataUpdate.mock.calls[0][0]
      expect(call.metadata.molecule_type).toBe('DNA')
      expect(call.metadata.definition).toBe('Test')
    })

    it('closes edit form after save', async () => {
      const mockBackend = {
        metadataUpdate: mock(() => {}),
        onAck: mock(() => () => {}),
        onError: mock(() => () => {}),
      }
      const wrapper = mount(SequenceEditor, {
        props: {
          backend: mockBackend,
          metadata: { molecule_type: 'DNA', definition: 'Test' }
        }
      })
      wrapper.vm.setSequence('ATCG')
      await wrapper.vm.$nextTick()

      wrapper.vm.openMetadataModal()
      await wrapper.vm.$nextTick()

      await wrapper.find('.edit-button').trigger('click')
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.metadata-edit-form').exists()).toBe(true)

      // Save via form submit
      await wrapper.find('.metadata-edit-form').trigger('submit')
      await wrapper.vm.$nextTick()

      // Should return to view mode
      expect(wrapper.find('.metadata-edit-form').exists()).toBe(false)
      expect(wrapper.find('.metadata-list').exists()).toBe(true)
    })

    it('hides Edit button while in edit mode', async () => {
      const wrapper = mount(SequenceEditor, {
        props: {
          metadata: { molecule_type: 'DNA', definition: 'Test' }
        }
      })
      wrapper.vm.setSequence('ATCG')
      await wrapper.vm.$nextTick()

      wrapper.vm.openMetadataModal()
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.edit-button').exists()).toBe(true)

      await wrapper.find('.edit-button').trigger('click')
      await wrapper.vm.$nextTick()

      // Edit button should be hidden while editing
      expect(wrapper.find('.edit-button').exists()).toBe(false)
    })
  })

  describe('metadata modal reference management', () => {
    it('removes a reference when trash button is clicked', async () => {
      const wrapper = mount(SequenceEditor, {
        props: {
          metadata: {
            molecule_type: 'DNA',
            references: [
              { title: 'First Ref', authors: 'Author A' },
              { title: 'Second Ref', authors: 'Author B' },
              { title: 'Third Ref', authors: 'Author C' }
            ]
          }
        }
      })
      wrapper.vm.setSequence('ATCG')
      await wrapper.vm.$nextTick()

      wrapper.vm.openMetadataModal()
      await wrapper.vm.$nextTick()

      await wrapper.find('.edit-button').trigger('click')
      await wrapper.vm.$nextTick()

      // Should have 3 references initially
      expect(wrapper.findAll('.reference-item-edit').length).toBe(3)

      // Click trash on the second reference
      const trashButtons = wrapper.findAll('.btn-remove-reference')
      await trashButtons[1].trigger('click')
      await wrapper.vm.$nextTick()

      // Should have 2 references now
      expect(wrapper.findAll('.reference-item-edit').length).toBe(2)
      // First and third should remain
      expect(wrapper.findAll('.ref-title')[0].text()).toBe('First Ref')
      expect(wrapper.findAll('.ref-title')[1].text()).toBe('Third Ref')
    })

    it('moves a reference up when up arrow is clicked', async () => {
      const wrapper = mount(SequenceEditor, {
        props: {
          metadata: {
            molecule_type: 'DNA',
            references: [
              { title: 'First Ref', authors: 'Author A' },
              { title: 'Second Ref', authors: 'Author B' },
              { title: 'Third Ref', authors: 'Author C' }
            ]
          }
        }
      })
      wrapper.vm.setSequence('ATCG')
      await wrapper.vm.$nextTick()

      wrapper.vm.openMetadataModal()
      await wrapper.vm.$nextTick()

      await wrapper.find('.edit-button').trigger('click')
      await wrapper.vm.$nextTick()

      // Get titles in initial order
      let titles = wrapper.findAll('.ref-title')
      expect(titles[0].text()).toBe('First Ref')
      expect(titles[1].text()).toBe('Second Ref')
      expect(titles[2].text()).toBe('Third Ref')

      // Click up arrow on the second reference (index 1)
      const referenceItems = wrapper.findAll('.reference-item-edit')
      const secondRefUpArrow = referenceItems[1].find('[title="Move up"]')
      await secondRefUpArrow.trigger('click')
      await wrapper.vm.$nextTick()

      // Order should now be: Second, First, Third
      titles = wrapper.findAll('.ref-title')
      expect(titles[0].text()).toBe('Second Ref')
      expect(titles[1].text()).toBe('First Ref')
      expect(titles[2].text()).toBe('Third Ref')
    })

    it('moves a reference down when down arrow is clicked', async () => {
      const wrapper = mount(SequenceEditor, {
        props: {
          metadata: {
            molecule_type: 'DNA',
            references: [
              { title: 'First Ref', authors: 'Author A' },
              { title: 'Second Ref', authors: 'Author B' },
              { title: 'Third Ref', authors: 'Author C' }
            ]
          }
        }
      })
      wrapper.vm.setSequence('ATCG')
      await wrapper.vm.$nextTick()

      wrapper.vm.openMetadataModal()
      await wrapper.vm.$nextTick()

      await wrapper.find('.edit-button').trigger('click')
      await wrapper.vm.$nextTick()

      // Get titles in initial order
      let titles = wrapper.findAll('.ref-title')
      expect(titles[0].text()).toBe('First Ref')
      expect(titles[1].text()).toBe('Second Ref')
      expect(titles[2].text()).toBe('Third Ref')

      // Click down arrow on the first reference (index 0)
      const referenceItems = wrapper.findAll('.reference-item-edit')
      const firstRefDownArrow = referenceItems[0].find('[title="Move down"]')
      await firstRefDownArrow.trigger('click')
      await wrapper.vm.$nextTick()

      // Order should now be: Second, First, Third
      titles = wrapper.findAll('.ref-title')
      expect(titles[0].text()).toBe('Second Ref')
      expect(titles[1].text()).toBe('First Ref')
      expect(titles[2].text()).toBe('Third Ref')
    })

    it('does not show up arrow on the first reference', async () => {
      const wrapper = mount(SequenceEditor, {
        props: {
          metadata: {
            molecule_type: 'DNA',
            references: [
              { title: 'First Ref', authors: 'Author A' },
              { title: 'Second Ref', authors: 'Author B' }
            ]
          }
        }
      })
      wrapper.vm.setSequence('ATCG')
      await wrapper.vm.$nextTick()

      wrapper.vm.openMetadataModal()
      await wrapper.vm.$nextTick()

      await wrapper.find('.edit-button').trigger('click')
      await wrapper.vm.$nextTick()

      const referenceItems = wrapper.findAll('.reference-item-edit')

      // First reference should not have up arrow
      expect(referenceItems[0].find('[title="Move up"]').exists()).toBe(false)
      // First reference should have down arrow
      expect(referenceItems[0].find('[title="Move down"]').exists()).toBe(true)

      // Second reference should have up arrow
      expect(referenceItems[1].find('[title="Move up"]').exists()).toBe(true)
    })

    it('does not show down arrow on the last reference', async () => {
      const wrapper = mount(SequenceEditor, {
        props: {
          metadata: {
            molecule_type: 'DNA',
            references: [
              { title: 'First Ref', authors: 'Author A' },
              { title: 'Second Ref', authors: 'Author B' }
            ]
          }
        }
      })
      wrapper.vm.setSequence('ATCG')
      await wrapper.vm.$nextTick()

      wrapper.vm.openMetadataModal()
      await wrapper.vm.$nextTick()

      await wrapper.find('.edit-button').trigger('click')
      await wrapper.vm.$nextTick()

      const referenceItems = wrapper.findAll('.reference-item-edit')

      // Last reference should not have down arrow
      expect(referenceItems[1].find('[title="Move down"]').exists()).toBe(false)
      // Last reference should have up arrow
      expect(referenceItems[1].find('[title="Move up"]').exists()).toBe(true)

      // First reference should have down arrow
      expect(referenceItems[0].find('[title="Move down"]').exists()).toBe(true)
    })

    it('single reference has neither up nor down arrow', async () => {
      const wrapper = mount(SequenceEditor, {
        props: {
          metadata: {
            molecule_type: 'DNA',
            references: [
              { title: 'Only Ref', authors: 'Author A' }
            ]
          }
        }
      })
      wrapper.vm.setSequence('ATCG')
      await wrapper.vm.$nextTick()

      wrapper.vm.openMetadataModal()
      await wrapper.vm.$nextTick()

      await wrapper.find('.edit-button').trigger('click')
      await wrapper.vm.$nextTick()

      const referenceItems = wrapper.findAll('.reference-item-edit')
      expect(referenceItems.length).toBe(1)

      // Single reference should have neither arrow
      expect(referenceItems[0].find('[title="Move up"]').exists()).toBe(false)
      expect(referenceItems[0].find('[title="Move down"]').exists()).toBe(false)
    })

    it('shows edit form when edit reference button is clicked', async () => {
      const wrapper = mount(SequenceEditor, {
        props: {
          metadata: {
            molecule_type: 'DNA',
            references: [
              { title: 'Test Title', authors: 'Test Author', journal: 'Test Journal', pubmed: '12345' }
            ]
          }
        }
      })
      wrapper.vm.setSequence('ATCG')
      await wrapper.vm.$nextTick()

      wrapper.vm.openMetadataModal()
      await wrapper.vm.$nextTick()

      await wrapper.find('.edit-button').trigger('click')
      await wrapper.vm.$nextTick()

      // Click edit on the reference
      await wrapper.find('.btn-edit-reference').trigger('click')
      await wrapper.vm.$nextTick()

      // Should show the edit form
      expect(wrapper.find('.reference-edit-form').exists()).toBe(true)
      expect(wrapper.find('#ref-title-0').element.value).toBe('Test Title')
      expect(wrapper.find('#ref-authors-0').element.value).toBe('Test Author')
      expect(wrapper.find('#ref-journal-0').element.value).toBe('Test Journal')
      expect(wrapper.find('#ref-pubmed-0').element.value).toBe('12345')
    })

    it('updates reference when edited and Done clicked', async () => {
      const wrapper = mount(SequenceEditor, {
        props: {
          metadata: {
            molecule_type: 'DNA',
            references: [
              { title: 'Original Title', authors: 'Original Author' }
            ]
          }
        }
      })
      wrapper.vm.setSequence('ATCG')
      await wrapper.vm.$nextTick()

      wrapper.vm.openMetadataModal()
      await wrapper.vm.$nextTick()

      await wrapper.find('.edit-button').trigger('click')
      await wrapper.vm.$nextTick()

      // Click edit on the reference
      await wrapper.find('.btn-edit-reference').trigger('click')
      await wrapper.vm.$nextTick()

      // Change the title
      await wrapper.find('#ref-title-0').setValue('Updated Title')
      await wrapper.vm.$nextTick()

      // Click Done
      await wrapper.find('.btn-ref-save').trigger('click')
      await wrapper.vm.$nextTick()

      // Should exit edit form and show updated content
      expect(wrapper.find('.reference-edit-form').exists()).toBe(false)
      expect(wrapper.find('.ref-title').text()).toBe('Updated Title')
    })

    it('cancels reference edit without saving changes', async () => {
      const wrapper = mount(SequenceEditor, {
        props: {
          metadata: {
            molecule_type: 'DNA',
            references: [
              { title: 'Original Title', authors: 'Original Author' }
            ]
          }
        }
      })
      wrapper.vm.setSequence('ATCG')
      await wrapper.vm.$nextTick()

      wrapper.vm.openMetadataModal()
      await wrapper.vm.$nextTick()

      await wrapper.find('.edit-button').trigger('click')
      await wrapper.vm.$nextTick()

      // Click edit on the reference
      await wrapper.find('.btn-edit-reference').trigger('click')
      await wrapper.vm.$nextTick()

      // Change the title
      await wrapper.find('#ref-title-0').setValue('Changed Title')
      await wrapper.vm.$nextTick()

      // Click Cancel
      await wrapper.find('.btn-ref-cancel').trigger('click')
      await wrapper.vm.$nextTick()

      // Should exit edit form - but note: changes are kept in editMetadata since we're using v-model
      // The cancel just closes the inline form, it doesn't revert the changes to editMetadata
      expect(wrapper.find('.reference-edit-form').exists()).toBe(false)
    })
  })

  describe('title editing', () => {
    it('enters edit mode on double-click when not readonly', async () => {
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: 'ATCGATCG',
          title: 'My Sequence'
        }
      })
      await wrapper.vm.$nextTick()

      // Title should be displayed
      const titleDisplay = wrapper.find('.title-display')
      expect(titleDisplay.exists()).toBe(true)
      expect(titleDisplay.text()).toBe('My Sequence')

      // Double-click to edit
      await titleDisplay.trigger('dblclick')
      await wrapper.vm.$nextTick()

      // Should show input field
      expect(wrapper.find('.title-input').exists()).toBe(true)
      expect(wrapper.find('.title-input').element.value).toBe('My Sequence')

      // Should show confirm and cancel buttons
      expect(wrapper.find('.title-edit-confirm').exists()).toBe(true)
      expect(wrapper.find('.title-edit-cancel').exists()).toBe(true)
    })

    it('does not enter edit mode on double-click when readonly', async () => {
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: 'ATCGATCG',
          title: 'My Sequence',
          readonly: true
        }
      })
      await wrapper.vm.$nextTick()

      const titleDisplay = wrapper.find('.title-display')
      await titleDisplay.trigger('dblclick')
      await wrapper.vm.$nextTick()

      // Should NOT show input field
      expect(wrapper.find('.title-input').exists()).toBe(false)
    })

    it('confirms edit on Enter key and calls backend', async () => {
      const mockBackend = {
        titleUpdate: mock(() => {}),
        onAck: mock(() => () => {}),
        onError: mock(() => () => {}),
      }
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: 'ATCGATCG',
          title: 'Original Title',
          backend: mockBackend
        }
      })
      await wrapper.vm.$nextTick()

      // Enter edit mode
      await wrapper.find('.title-display').trigger('dblclick')
      await wrapper.vm.$nextTick()

      // Change the title
      const input = wrapper.find('.title-input')
      await input.setValue('New Title')
      await wrapper.vm.$nextTick()

      // Press Enter
      await input.trigger('keydown', { key: 'Enter' })
      await wrapper.vm.$nextTick()

      // Should exit edit mode
      expect(wrapper.find('.title-input').exists()).toBe(false)
      expect(wrapper.find('.title-display').text()).toBe('New Title')

      // Should call backend
      expect(mockBackend.titleUpdate).toHaveBeenCalledTimes(1)
      const call = mockBackend.titleUpdate.mock.calls[0][0]
      expect(call.title).toBe('New Title')
      expect(call.id).toBeDefined()
    })

    it('confirms edit on confirm button click', async () => {
      const mockBackend = {
        titleUpdate: mock(() => {}),
        onAck: mock(() => () => {}),
        onError: mock(() => () => {}),
      }
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: 'ATCGATCG',
          title: 'Original Title',
          backend: mockBackend
        }
      })
      await wrapper.vm.$nextTick()

      // Enter edit mode
      await wrapper.find('.title-display').trigger('dblclick')
      await wrapper.vm.$nextTick()

      // Change the title
      await wrapper.find('.title-input').setValue('Updated Title')
      await wrapper.vm.$nextTick()

      // Click confirm button (use mousedown.prevent as in the component)
      await wrapper.find('.title-edit-confirm').trigger('mousedown')
      await wrapper.vm.$nextTick()

      // Should exit edit mode and call backend
      expect(wrapper.find('.title-input').exists()).toBe(false)
      expect(mockBackend.titleUpdate).toHaveBeenCalledTimes(1)
      expect(mockBackend.titleUpdate.mock.calls[0][0].title).toBe('Updated Title')
    })

    it('cancels edit on Escape key', async () => {
      const mockBackend = {
        titleUpdate: mock(() => {}),
        onAck: mock(() => () => {}),
        onError: mock(() => () => {}),
      }
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: 'ATCGATCG',
          title: 'Original Title',
          backend: mockBackend
        }
      })
      await wrapper.vm.$nextTick()

      // Enter edit mode
      await wrapper.find('.title-display').trigger('dblclick')
      await wrapper.vm.$nextTick()

      // Change the title
      await wrapper.find('.title-input').setValue('Changed Title')
      await wrapper.vm.$nextTick()

      // Press Escape
      await wrapper.find('.title-input').trigger('keydown', { key: 'Escape' })
      await wrapper.vm.$nextTick()

      // Should exit edit mode without saving
      expect(wrapper.find('.title-input').exists()).toBe(false)
      expect(wrapper.find('.title-display').text()).toBe('Original Title')

      // Should NOT call backend
      expect(mockBackend.titleUpdate).not.toHaveBeenCalled()
    })

    it('cancels edit on cancel button click', async () => {
      const mockBackend = {
        titleUpdate: mock(() => {}),
        onAck: mock(() => () => {}),
        onError: mock(() => () => {}),
      }
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: 'ATCGATCG',
          title: 'Original Title',
          backend: mockBackend
        }
      })
      await wrapper.vm.$nextTick()

      // Enter edit mode
      await wrapper.find('.title-display').trigger('dblclick')
      await wrapper.vm.$nextTick()

      // Change the title
      await wrapper.find('.title-input').setValue('Changed Title')
      await wrapper.vm.$nextTick()

      // Click cancel button
      await wrapper.find('.title-edit-cancel').trigger('mousedown')
      await wrapper.vm.$nextTick()

      // Should exit edit mode without saving
      expect(wrapper.find('.title-input').exists()).toBe(false)
      expect(mockBackend.titleUpdate).not.toHaveBeenCalled()
    })

    it('does not call backend if title unchanged', async () => {
      const mockBackend = {
        titleUpdate: mock(() => {}),
        onAck: mock(() => () => {}),
        onError: mock(() => () => {}),
      }
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: 'ATCGATCG',
          title: 'Same Title',
          backend: mockBackend
        }
      })
      await wrapper.vm.$nextTick()

      // Enter edit mode
      await wrapper.find('.title-display').trigger('dblclick')
      await wrapper.vm.$nextTick()

      // Don't change the title, just press Enter
      await wrapper.find('.title-input').trigger('keydown', { key: 'Enter' })
      await wrapper.vm.$nextTick()

      // Should NOT call backend
      expect(mockBackend.titleUpdate).not.toHaveBeenCalled()
    })

    it('does not call backend if title is empty after trim', async () => {
      const mockBackend = {
        titleUpdate: mock(() => {}),
        onAck: mock(() => () => {}),
        onError: mock(() => () => {}),
      }
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: 'ATCGATCG',
          title: 'Original Title',
          backend: mockBackend
        }
      })
      await wrapper.vm.$nextTick()

      // Enter edit mode
      await wrapper.find('.title-display').trigger('dblclick')
      await wrapper.vm.$nextTick()

      // Set title to whitespace only
      await wrapper.find('.title-input').setValue('   ')
      await wrapper.vm.$nextTick()

      // Press Enter
      await wrapper.find('.title-input').trigger('keydown', { key: 'Enter' })
      await wrapper.vm.$nextTick()

      // Should NOT call backend
      expect(mockBackend.titleUpdate).not.toHaveBeenCalled()
    })

    it('shows editable cursor style when not readonly', async () => {
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: 'ATCGATCG',
          title: 'My Sequence'
        }
      })
      await wrapper.vm.$nextTick()

      const titleDisplay = wrapper.find('.title-display')
      expect(titleDisplay.classes()).toContain('title-editable')
    })

    it('does not show editable cursor style when readonly', async () => {
      const wrapper = mount(SequenceEditor, {
        props: {
          sequence: 'ATCGATCG',
          title: 'My Sequence',
          readonly: true
        }
      })
      await wrapper.vm.$nextTick()

      const titleDisplay = wrapper.find('.title-display')
      expect(titleDisplay.classes()).not.toContain('title-editable')
    })
  })

  describe('programmatic selection API', () => {
    it('setSelection sets a single range', async () => {
      const wrapper = mount(SequenceEditor, {
        props: { initialZoom: 100 }
      })
      wrapper.vm.setSequence('ATCGATCGATCGATCG')
      await wrapper.vm.$nextTick()

      wrapper.vm.setSelection('4..8')
      await wrapper.vm.$nextTick()

      const sel = wrapper.vm.getSelection()
      expect(sel).toEqual({ start: 4, end: 8 })
    })

    it('setSelection sets multiple ranges', async () => {
      const wrapper = mount(SequenceEditor, {
        props: { initialZoom: 100 }
      })
      wrapper.vm.setSequence('ATCGATCGATCGATCG')
      await wrapper.vm.$nextTick()

      // Multiple ranges use + separator
      wrapper.vm.setSelection('2..4 + 8..12')
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
      wrapper.vm.setSequence('ATCGATCGATCGATCG')
      await wrapper.vm.$nextTick()

      // Set a selection first
      wrapper.vm.setSelection('4..8')
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
      wrapper.vm.setSequence('ATCGATCGATCGATCG')
      await wrapper.vm.$nextTick()

      // Set initial selection
      wrapper.vm.setSelection('0..4')
      await wrapper.vm.$nextTick()
      expect(wrapper.vm.getSelection()).toEqual({ start: 0, end: 4 })

      // Replace with new selection
      wrapper.vm.setSelection('8..12')
      await wrapper.vm.$nextTick()
      expect(wrapper.vm.getSelection()).toEqual({ start: 8, end: 12 })
    })

    it('setSelection updates selection composable state', async () => {
      const wrapper = mount(SequenceEditor, {
        props: { initialZoom: 100 }
      })
      wrapper.vm.setSequence('ATCGATCGATCGATCG')
      await wrapper.vm.$nextTick()

      wrapper.vm.setSelection('4..8')
      await wrapper.vm.$nextTick()

      // Check that selection layer has the selection
      const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
      expect(selectionLayer.vm.selection.isSelected.value).toBe(true)
      expect(selectionLayer.vm.selection.domain.value.ranges[0].start).toBe(4)
      expect(selectionLayer.vm.selection.domain.value.ranges[0].end).toBe(8)
    })

    it('setSelection with a:<id> selects annotation span', async () => {
      const wrapper = mount(SequenceEditor, {
        props: {
          initialZoom: 100,
          annotations: [
            { id: 'ann-123', span: '5..15', caption: 'Test Gene', type: 'gene' }
          ]
        }
      })
      wrapper.vm.setSequence('ATCGATCGATCGATCGATCG')
      await wrapper.vm.$nextTick()

      // Select by annotation ID
      wrapper.vm.setSelection('a:ann-123')
      await wrapper.vm.$nextTick()

      // Should select the annotation's span
      const sel = wrapper.vm.getSelection()
      expect(sel).toEqual({ start: 5, end: 15 })
    })

    it('setSelection with a:<id> does nothing for unknown annotation', async () => {
      const wrapper = mount(SequenceEditor, {
        props: {
          initialZoom: 100,
          annotations: [
            { id: 'ann-123', span: '5..15', caption: 'Test Gene', type: 'gene' }
          ]
        }
      })
      wrapper.vm.setSequence('ATCGATCGATCGATCGATCG')
      await wrapper.vm.$nextTick()

      // Try to select unknown annotation
      wrapper.vm.setSelection('a:unknown-id')
      await wrapper.vm.$nextTick()

      // Should not have any selection
      const sel = wrapper.vm.getSelection()
      expect(sel).toBeNull()
    })

    it('setCursor sets a zero-width selection at position', async () => {
      const wrapper = mount(SequenceEditor, {
        props: { initialZoom: 100 }
      })
      wrapper.vm.setSequence('ATCGATCGATCGATCG')
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
      const wrapper = mount(SequenceEditor, {
        props: {
          initialZoom: 100,
          annotations: [
            { id: 'ann-1', span: '5..15', caption: 'Test Gene', type: 'gene' }
          ]
        }
      })
      wrapper.vm.setSequence('ATCGATCGATCGATCGATCG')
      await wrapper.vm.$nextTick()

      // Select range that includes the annotation
      wrapper.vm.setSelection('3..18')
      await wrapper.vm.$nextTick()

      // Mock clipboard
      const mockClipboard = { writeText: mock(() => Promise.resolve()) }
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
        sequence: 'OLD',
        annotations: [{ caption: 'Old' }]
      }))

      const wrapper = mount(SequenceEditor, {
        props: { initialZoom: 100, annotations: [] }
      })
      wrapper.vm.setSequence('ATCGATCGATCGATCGATCG')
      await wrapper.vm.$nextTick()

      // Select range
      wrapper.vm.setSelection('0..5')
      await wrapper.vm.$nextTick()

      // Mock clipboard
      const mockClipboard = { writeText: mock(() => Promise.resolve()) }
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
      const wrapper = mount(SequenceEditor, {
        props: {
          initialZoom: 100,
          annotations: [
            { id: 'ann-1', span: '0..20', caption: 'Long Gene', type: 'gene' }
          ]
        }
      })
      wrapper.vm.setSequence('ATCGATCGATCGATCGATCGATCGATCG')
      await wrapper.vm.$nextTick()

      // Select only part of the annotation (5..10)
      wrapper.vm.setSelection('5..10')
      await wrapper.vm.$nextTick()

      // Mock clipboard
      const mockClipboard = { writeText: mock(() => Promise.resolve()) }
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
          initialZoom: 100,
          annotations: [
            { id: 'ann-1', span: '2..8', caption: 'Gene1', type: 'gene' },
            { id: 'ann-2', span: '12..18', caption: 'Gene2', type: 'CDS' }
          ]
        }
      })
      wrapper.vm.setSequence('ATCGATCGATCGATCGATCGATCGATCG')
      await wrapper.vm.$nextTick()

      // Create multi-range selection: 0..10 + 10..20
      wrapper.vm.setSelection('0..10 + 10..20')
      await wrapper.vm.$nextTick()

      // Mock clipboard
      const mockClipboard = { writeText: mock(() => Promise.resolve()) }
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
          initialZoom: 100,
          annotations: [
            { id: 'ann-1', span: '0..5', caption: 'Before', type: 'gene' },
            { id: 'ann-2', span: '15..20', caption: 'After', type: 'gene' }
          ]
        }
      })
      wrapper.vm.setSequence('ATCGATCGATCGATCGATCGATCGATCG')
      await wrapper.vm.$nextTick()

      // Select range that excludes both annotations
      wrapper.vm.setSelection('6..14')
      await wrapper.vm.$nextTick()

      // Mock clipboard
      const mockClipboard = { writeText: mock(() => Promise.resolve()) }
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
          initialZoom: 100,
          annotations: [
            { id: 'ann-1', span: '(5..15)', caption: 'Minus Gene', type: 'gene' }
          ]
        }
      })
      wrapper.vm.setSequence('ATCGATCGATCGATCGATCG')
      await wrapper.vm.$nextTick()

      // Select range that includes the annotation
      wrapper.vm.setSelection('0..20')
      await wrapper.vm.$nextTick()

      // Mock clipboard
      const mockClipboard = { writeText: mock(() => Promise.resolve()) }
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
      const wrapper = mount(SequenceEditor, {
        props: {
          initialZoom: 100,
          annotations: [
            // Annotation at positions 5..10 within a 20-base region
            { id: 'ann-1', span: '5..10', caption: 'Test Gene', type: 'gene' }
          ]
        }
      })
      wrapper.vm.setSequence('ATCGATCGATCGATCGATCG') // 20 bases
      await wrapper.vm.$nextTick()

      // Select the entire sequence as MINUS strand
      wrapper.vm.setSelection('(0..20)')
      await wrapper.vm.$nextTick()

      // Mock clipboard
      const mockClipboard = { writeText: mock(() => Promise.resolve()) }
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
      const wrapper = mount(SequenceEditor)
      wrapper.vm.setSequence('ATCGATCGATCG')
      await wrapper.vm.$nextTick()

      // The extensionAPI should be provided (we can't directly access provide,
      // but we can check if the extension mechanism works)
      expect(wrapper.vm.getSequence()).toBe('ATCGATCGATCG')
    })

    it('onSelectionChange notifies when selection.domain changes', async () => {
      // Create a test extension that captures the API
      let capturedAPI = null
      const TestPanel = {
        template: '<div></div>',
        setup() {
          const { inject } = require('vue')
          capturedAPI = inject('extensionAPI')
          return {}
        }
      }

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
      wrapper.vm.setSequence('ATCGATCGATCGATCG')
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
      selection.select('5..10')
      await wrapper.vm.$nextTick()

      expect(callbackCount).toBe(1)

      // Change selection again
      selection.select('2..8')
      await wrapper.vm.$nextTick()

      expect(callbackCount).toBe(2)

      // Unsubscribe and verify no more calls
      unsubscribe()

      selection.select('0..5')
      await wrapper.vm.$nextTick()

      expect(callbackCount).toBe(2) // Should not have increased
    })

    it('onSelectionChange uses watcher not eventBus commands', async () => {
      // This test verifies that selection changes trigger callbacks
      // even when selection is changed programmatically (not via eventBus)
      let capturedAPI = null
      const TestPanel = {
        template: '<div></div>',
        setup() {
          const { inject } = require('vue')
          capturedAPI = inject('extensionAPI')
          return {}
        }
      }

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
      wrapper.vm.setSequence('ATCGATCGATCGATCG')
      await wrapper.vm.$nextTick()

      let callbackCalled = false
      expect(capturedAPI).not.toBeNull()

      capturedAPI.onSelectionChange(() => {
        callbackCalled = true
      })

      // Use the exposed setSelection method (bypasses eventBus)
      wrapper.vm.setSelection('3..7')
      await wrapper.vm.$nextTick()

      // Callback should still be called because we watch selection.domain
      expect(callbackCalled).toBe(true)
    })

    it('onSelectionChange fires when user clicks in sequence (mouse event)', async () => {
      // This test simulates real UI interaction - clicking in the sequence
      // to change selection, rather than calling selection.select() directly
      let capturedAPI = null
      const TestPanel = {
        template: '<div></div>',
        setup() {
          const { inject } = require('vue')
          capturedAPI = inject('extensionAPI')
          return {}
        }
      }

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
      wrapper.vm.setSequence('ATCGATCGATCGATCG')
      wrapper.vm.graphics.setContainerSize(1000, 600)
      await wrapper.vm.$nextTick()

      let callbackCount = 0
      expect(capturedAPI).not.toBeNull()

      capturedAPI.onSelectionChange(() => {
        callbackCount++
      })

      // Simulate mouse click on the sequence overlay (like a user would)
      const overlay = wrapper.find('.sequence-overlay')
      await overlay.trigger('mousedown', {
        button: 0,
        clientX: 200,
        clientY: 20
      })
      await overlay.trigger('mouseup')
      await wrapper.vm.$nextTick()

      // The callback should have been triggered
      expect(callbackCount).toBeGreaterThan(0)
    })

    it('getSelectedSequence returns selected text', async () => {
      let capturedAPI = null
      const TestPanel = {
        template: '<div></div>',
        setup() {
          const { inject } = require('vue')
          capturedAPI = inject('extensionAPI')
          return {}
        }
      }

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
      wrapper.vm.setSequence('ATCGATCGATCGATCG')
      await wrapper.vm.$nextTick()

      expect(capturedAPI).not.toBeNull()

      // No selection initially
      expect(capturedAPI.getSelectedSequence()).toBe('')

      // Select a range
      wrapper.vm.setSelection('2..6')
      await wrapper.vm.$nextTick()

      expect(capturedAPI.getSelectedSequence()).toBe('CGAT')
    })

    it('onSelectionChange fires when selection range is mutated (handle dragging)', async () => {
      // This test simulates what happens during handle dragging:
      // the range properties are mutated directly without replacing domain.value
      let capturedAPI = null
      const TestPanel = {
        template: '<div></div>',
        setup() {
          const { inject } = require('vue')
          capturedAPI = inject('extensionAPI')
          return {}
        }
      }

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
      wrapper.vm.setSequence('ATCGATCGATCGATCGATCGATCGATCGATCGATCGATCG')
      await wrapper.vm.$nextTick()

      expect(capturedAPI).not.toBeNull()

      // Create initial selection
      wrapper.vm.setSelection('10..15')
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
      const TestPanel = {
        template: '<div></div>',
        setup() {
          const { inject } = require('vue')
          capturedAPI = inject('extensionAPI')
          return {}
        }
      }

      const testExtension = {
        id: 'test',
        name: 'Test',
        panel: TestPanel
      }

      const mockBackend = {
        annotationCreated: mock(() => {}),
        onAck: mock(() => () => {}),
        onError: mock(() => () => {}),
      }

      const wrapper = mount(SequenceEditor, {
        props: {
          initialZoom: 100,
          extensions: [testExtension],
          backend: mockBackend
        }
      })
      wrapper.vm.setSequence('ATGATGATGATGATGATGATGATGATGATGATGATGATGATGATGATGATGATGATG')
      await wrapper.vm.$nextTick()

      expect(capturedAPI).not.toBeNull()

      // Call addAnnotation via the extensionAPI
      capturedAPI.addAnnotation({
        span: '0..30',
        type: 'CDS',
        caption: 'Test CDS'
      })
      await wrapper.vm.$nextTick()

      // Backend should have been called
      expect(mockBackend.annotationCreated).toHaveBeenCalledTimes(1)
      const call = mockBackend.annotationCreated.mock.calls[0][0]
      expect(call.caption).toBe('Test CDS')
      expect(call.type).toBe('CDS')
      expect(call.span).toBe('0..30')
      expect(call.id).toBeDefined()
    })

    it('addAnnotation emits annotations-update event', async () => {
      let capturedAPI = null
      const TestPanel = {
        template: '<div></div>',
        setup() {
          const { inject } = require('vue')
          capturedAPI = inject('extensionAPI')
          return {}
        }
      }

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
      wrapper.vm.setSequence('ATGATGATGATGATGATGATGATGATGATGATGATGATGATGATGATGATGATGATG')
      await wrapper.vm.$nextTick()

      expect(capturedAPI).not.toBeNull()

      // Call addAnnotation via the extensionAPI
      capturedAPI.addAnnotation({
        span: '0..30',
        type: 'CDS',
        caption: 'Test CDS'
      })
      await wrapper.vm.$nextTick()

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
  })
})
