import { describe, it, expect, beforeEach, mock } from 'bun:test'
import { mount } from '@vue/test-utils'
import SequenceEditor from './SequenceEditor.vue'
import { Annotation } from '../utils/annotation.js'
import { STORAGE_KEY } from '../composables/usePersistedZoom.js'

describe('SequenceEditor annotations', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY)
  })

  describe('annotations', () => {
    it('renders AnnotationLayer when annotations provided', async () => {
      const wrapper = mount(SequenceEditor, {
        props: { initialZoom: 100 }
      })

      wrapper.vm.setSequence('A'.repeat(500))
      await wrapper.vm.$nextTick()

      const annotation = new Annotation({
        id: 'ann1',
        caption: 'GFP',
        type: 'gene',
        span: '10..50'
      })

      await wrapper.setProps({ annotations: [annotation] })
      await wrapper.vm.$nextTick()

      const layer = wrapper.findComponent({ name: 'AnnotationLayer' })
      expect(layer.exists()).toBe(true)
    })

    it('does not render AnnotationLayer when no annotations', async () => {
      const wrapper = mount(SequenceEditor, {
        props: {
          initialZoom: 100,
          annotations: []
        }
      })

      wrapper.vm.setSequence('A'.repeat(500))
      await wrapper.vm.$nextTick()

      const layer = wrapper.findComponent({ name: 'AnnotationLayer' })
      expect(layer.exists()).toBe(false)
    })

    it('passes showAnnotationCaptions prop to AnnotationLayer', async () => {
      const annotation = new Annotation({
        id: 'ann1',
        caption: 'GFP',
        type: 'gene',
        span: '10..60'
      })

      const wrapper = mount(SequenceEditor, {
        props: {
          initialZoom: 100,
          annotations: [annotation],
          showAnnotationCaptions: false
        }
      })

      wrapper.vm.setSequence('A'.repeat(500))
      await wrapper.vm.$nextTick()

      const layer = wrapper.findComponent({ name: 'AnnotationLayer' })
      expect(layer.props('showCaptions')).toBe(false)
    })

    it('emits annotation-click event', async () => {
      const annotation = new Annotation({
        id: 'ann1',
        caption: 'GFP',
        type: 'gene',
        span: '10..50'
      })

      const wrapper = mount(SequenceEditor, {
        props: {
          initialZoom: 100,
          annotations: [annotation]
        }
      })

      wrapper.vm.setSequence('A'.repeat(500))
      await wrapper.vm.$nextTick()

      const layer = wrapper.findComponent({ name: 'AnnotationLayer' })
      layer.vm.$emit('click', { annotation, fragment: {} })

      expect(wrapper.emitted('annotation-click')).toBeTruthy()
    })

    it('regular click on annotation selects annotation span', async () => {
      const annotation = new Annotation({
        id: 'ann1',
        caption: 'GFP',
        type: 'gene',
        span: '10..50'
      })

      const wrapper = mount(SequenceEditor, {
        props: {
          initialZoom: 100,
          annotations: [annotation]
        }
      })

      wrapper.vm.setSequence('A'.repeat(500))
      await wrapper.vm.$nextTick()

      const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
      const selection = selectionLayer.vm.selection

      const layer = wrapper.findComponent({ name: 'AnnotationLayer' })
      layer.vm.$emit('click', { annotation, event: {}, fragment: {} })
      await wrapper.vm.$nextTick()

      expect(selection.isSelected.value).toBe(true)
      expect(selection.domain.value.ranges[0].start).toBe(10)
      expect(selection.domain.value.ranges[0].end).toBe(50)
    })

    it('shift-click on annotation with existing selection extends selection', async () => {
      const annotation = new Annotation({
        id: 'ann1',
        caption: 'GFP',
        type: 'gene',
        span: '100..150'
      })

      const wrapper = mount(SequenceEditor, {
        props: {
          initialZoom: 100,
          annotations: [annotation]
        }
      })

      wrapper.vm.setSequence('A'.repeat(500))
      await wrapper.vm.$nextTick()

      const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
      const selection = selectionLayer.vm.selection

      // Create initial selection at 10..50
      selection.select('10..50')
      await wrapper.vm.$nextTick()
      expect(selection.isSelected.value).toBe(true)

      // Shift-click on annotation at 100..150 should extend selection
      const layer = wrapper.findComponent({ name: 'AnnotationLayer' })
      layer.vm.$emit('click', { annotation, event: { shiftKey: true }, fragment: {} })
      await wrapper.vm.$nextTick()

      // Selection should now span from 10 to 150
      expect(selection.domain.value.ranges[0].start).toBe(10)
      expect(selection.domain.value.ranges[0].end).toBe(150)
    })

    it('shift-click on annotation with no selection shows context menu', async () => {
      const annotation = new Annotation({
        id: 'ann1',
        caption: 'GFP',
        type: 'gene',
        span: '10..50'
      })

      const wrapper = mount(SequenceEditor, {
        props: {
          initialZoom: 100,
          annotations: [annotation]
        }
      })

      wrapper.vm.setSequence('A'.repeat(500))
      await wrapper.vm.$nextTick()

      const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
      const selection = selectionLayer.vm.selection

      // Ensure no selection
      expect(selection.isSelected.value).toBe(false)

      // Shift-click should trigger context menu behavior
      const layer = wrapper.findComponent({ name: 'AnnotationLayer' })
      layer.vm.$emit('click', {
        annotation,
        event: { shiftKey: true, clientX: 100, clientY: 100 },
        fragment: {}
      })
      await wrapper.vm.$nextTick()

      // Context menu should be visible
      expect(wrapper.find('.context-menu').exists()).toBe(true)
    })

    it('ctrl-click on annotation adds to existing selection', async () => {
      const annotation = new Annotation({
        id: 'ann1',
        caption: 'GFP',
        type: 'gene',
        span: '100..150'
      })

      const wrapper = mount(SequenceEditor, {
        props: {
          initialZoom: 100,
          annotations: [annotation]
        }
      })

      wrapper.vm.setSequence('A'.repeat(500))
      await wrapper.vm.$nextTick()

      const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
      const selection = selectionLayer.vm.selection

      // Create initial selection at 10..50
      selection.select('10..50')
      await wrapper.vm.$nextTick()

      // Ctrl-click on annotation should add it as a new range
      const layer = wrapper.findComponent({ name: 'AnnotationLayer' })
      layer.vm.$emit('click', { annotation, event: { ctrlKey: true }, fragment: {} })
      await wrapper.vm.$nextTick()

      // Should now have two ranges
      expect(selection.domain.value.ranges).toHaveLength(2)
      expect(selection.domain.value.ranges[0].start).toBe(10)
      expect(selection.domain.value.ranges[0].end).toBe(50)
      expect(selection.domain.value.ranges[1].start).toBe(100)
      expect(selection.domain.value.ranges[1].end).toBe(150)
    })
  })

  describe('translation click behavior', () => {
    it('regular click on translation codon selects the codon', async () => {
      const annotation = new Annotation({
        id: 'cds1',
        caption: 'GFP',
        type: 'CDS',
        span: '0..30'
      })

      const wrapper = mount(SequenceEditor, {
        props: {
          initialZoom: 100,
          annotations: [annotation]
        }
      })

      wrapper.vm.setSequence('ATGATGATGATGATGATGATGATGATGATG')
      await wrapper.vm.$nextTick()

      const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
      const selection = selectionLayer.vm.selection

      // Simulate translation click (codon at positions 0-3)
      const layer = wrapper.findComponent({ name: 'TranslationLayer' })
      layer.vm.$emit('click', {
        event: {},
        element: { orientation: 1, codonStart: 0, codonEnd: 3 },
        codonStart: 0,
        codonEnd: 3
      })
      await wrapper.vm.$nextTick()

      expect(selection.isSelected.value).toBe(true)
      expect(selection.domain.value.ranges[0].start).toBe(0)
      expect(selection.domain.value.ranges[0].end).toBe(3)
    })

    it('shift-click on translation codon extends selection', async () => {
      const annotation = new Annotation({
        id: 'cds1',
        caption: 'GFP',
        type: 'CDS',
        span: '0..30'
      })

      const wrapper = mount(SequenceEditor, {
        props: {
          initialZoom: 100,
          annotations: [annotation]
        }
      })

      wrapper.vm.setSequence('ATGATGATGATGATGATGATGATGATGATG')
      await wrapper.vm.$nextTick()

      const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
      const selection = selectionLayer.vm.selection

      // Create initial selection at first codon
      selection.select('0..3')
      await wrapper.vm.$nextTick()

      // Shift-click on a later codon (positions 9-12)
      const layer = wrapper.findComponent({ name: 'TranslationLayer' })
      layer.vm.$emit('click', {
        event: { shiftKey: true },
        element: { orientation: 1, codonStart: 9, codonEnd: 12 },
        codonStart: 9,
        codonEnd: 12
      })
      await wrapper.vm.$nextTick()

      // Selection should extend from 0 to 12
      expect(selection.domain.value.ranges[0].start).toBe(0)
      expect(selection.domain.value.ranges[0].end).toBe(12)
    })

    it('ctrl-click on translation codon adds to selection', async () => {
      const annotation = new Annotation({
        id: 'cds1',
        caption: 'GFP',
        type: 'CDS',
        span: '0..30'
      })

      const wrapper = mount(SequenceEditor, {
        props: {
          initialZoom: 100,
          annotations: [annotation]
        }
      })

      wrapper.vm.setSequence('ATGATGATGATGATGATGATGATGATGATG')
      await wrapper.vm.$nextTick()

      const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
      const selection = selectionLayer.vm.selection

      // Create initial selection at first codon
      selection.select('0..3')
      await wrapper.vm.$nextTick()

      // Ctrl-click on a later codon (positions 9-12)
      const layer = wrapper.findComponent({ name: 'TranslationLayer' })
      layer.vm.$emit('click', {
        event: { ctrlKey: true },
        element: { orientation: 1, codonStart: 9, codonEnd: 12 },
        codonStart: 9,
        codonEnd: 12
      })
      await wrapper.vm.$nextTick()

      // Should have two separate ranges
      expect(selection.domain.value.ranges).toHaveLength(2)
      expect(selection.domain.value.ranges[0].start).toBe(0)
      expect(selection.domain.value.ranges[0].end).toBe(3)
      expect(selection.domain.value.ranges[1].start).toBe(9)
      expect(selection.domain.value.ranges[1].end).toBe(12)
    })
  })

  describe('annotation adjustment on insert', () => {
    // Helper to set up insertion at a specific position
    async function setupInsertAtPosition(wrapper, position) {
      // Create a zero-width selection (cursor) at the desired position
      const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
      const selection = selectionLayer.vm.selection
      selection.select(`${position}..${position}`)
      await wrapper.vm.$nextTick()

      // Open the insert modal via keypress (DNA base triggers modal)
      const svg = wrapper.find('svg.editor-svg')
      await svg.trigger('keydown', { key: 'A' })
      await wrapper.vm.$nextTick()
    }

    it('emits annotations-update when inserting text inside an annotation', async () => {
      const annotations = [
        { id: 'ann1', caption: 'Test', type: 'gene', span: '10..50' }
      ]

      const wrapper = mount(SequenceEditor, {
        props: { annotations, initialZoom: 100 }
      })
      wrapper.vm.setSequence('A'.repeat(100))
      await wrapper.vm.$nextTick()

      // Set up insert at position 20 (inside annotation 10..50)
      await setupInsertAtPosition(wrapper, 20)

      // Submit 5 characters via the modal
      const insertModal = wrapper.findComponent({ name: 'InsertModal' })
      insertModal.vm.$emit('submit', 'ATCGA')
      await wrapper.vm.$nextTick()

      // Check that annotations-update was emitted
      const emitted = wrapper.emitted('annotations-update')
      expect(emitted).toBeTruthy()
      expect(emitted.length).toBe(1)

      // Annotation should expand: start stays 10, end becomes 55 (50 + 5)
      const updatedAnnotations = emitted[0][0]
      expect(updatedAnnotations[0].span).toBe('10..55')
    })

    it('shifts annotation right when inserting before it', async () => {
      const annotations = [
        { id: 'ann1', caption: 'Test', type: 'gene', span: '20..40' }
      ]

      const wrapper = mount(SequenceEditor, {
        props: { annotations, initialZoom: 100 }
      })
      wrapper.vm.setSequence('A'.repeat(100))
      await wrapper.vm.$nextTick()

      // Set up insert at position 5 (before annotation starts at 20)
      await setupInsertAtPosition(wrapper, 5)

      const insertModal = wrapper.findComponent({ name: 'InsertModal' })
      insertModal.vm.$emit('submit', 'GGG')  // 3 characters
      await wrapper.vm.$nextTick()

      const emitted = wrapper.emitted('annotations-update')
      expect(emitted).toBeTruthy()

      // Both start and end should shift: 20+3=23, 40+3=43
      const updatedAnnotations = emitted[0][0]
      expect(updatedAnnotations[0].span).toBe('23..43')
    })

    it('does not modify annotation when inserting after it', async () => {
      const annotations = [
        { id: 'ann1', caption: 'Test', type: 'gene', span: '10..20' }
      ]

      const wrapper = mount(SequenceEditor, {
        props: { annotations, initialZoom: 100 }
      })
      wrapper.vm.setSequence('A'.repeat(100))
      await wrapper.vm.$nextTick()

      // Set up insert at position 50 (after annotation ends at 20)
      await setupInsertAtPosition(wrapper, 50)

      const insertModal = wrapper.findComponent({ name: 'InsertModal' })
      insertModal.vm.$emit('submit', 'TTTT')  // 4 characters
      await wrapper.vm.$nextTick()

      const emitted = wrapper.emitted('annotations-update')
      expect(emitted).toBeTruthy()

      // Annotation should remain unchanged
      const updatedAnnotations = emitted[0][0]
      expect(updatedAnnotations[0].span).toBe('10..20')
    })

    it('handles multiple annotations correctly', async () => {
      const annotations = [
        { id: 'ann1', caption: 'Before', type: 'gene', span: '5..15' },
        { id: 'ann2', caption: 'Contains', type: 'promoter', span: '20..40' },
        { id: 'ann3', caption: 'After', type: 'terminator', span: '50..60' }
      ]

      const wrapper = mount(SequenceEditor, {
        props: { annotations, initialZoom: 100 }
      })
      wrapper.vm.setSequence('A'.repeat(100))
      await wrapper.vm.$nextTick()

      // Set up insert at position 25 (inside ann2, after ann1, before ann3)
      await setupInsertAtPosition(wrapper, 25)

      const insertModal = wrapper.findComponent({ name: 'InsertModal' })
      insertModal.vm.$emit('submit', 'CC')  // 2 characters
      await wrapper.vm.$nextTick()

      const emitted = wrapper.emitted('annotations-update')
      expect(emitted).toBeTruthy()

      const updatedAnnotations = emitted[0][0]

      // ann1 (5..15): insertion at 25, both start and end < 25, so unchanged
      expect(updatedAnnotations[0].span).toBe('5..15')

      // ann2 (20..40): insertion at 25, start < 25 (unchanged), end > 25 (becomes 42)
      expect(updatedAnnotations[1].span).toBe('20..42')

      // ann3 (50..60): insertion at 25, both start and end > 25, both shift
      expect(updatedAnnotations[2].span).toBe('52..62')
    })

    it('expands annotation when inserting at its start position', async () => {
      const annotations = [
        { id: 'ann1', caption: 'Test', type: 'gene', span: '10..30' }
      ]

      const wrapper = mount(SequenceEditor, {
        props: { annotations, initialZoom: 100 }
      })
      wrapper.vm.setSequence('A'.repeat(100))
      await wrapper.vm.$nextTick()

      // Set up insert at position 10 (exactly at annotation start)
      await setupInsertAtPosition(wrapper, 10)

      const insertModal = wrapper.findComponent({ name: 'InsertModal' })
      insertModal.vm.$emit('submit', 'AAA')  // 3 characters
      await wrapper.vm.$nextTick()

      const emitted = wrapper.emitted('annotations-update')
      expect(emitted).toBeTruthy()

      // start=10, not > 10, so stays 10; end=30 > 10, so becomes 33
      // Result: annotation expands to include inserted text
      const updatedAnnotations = emitted[0][0]
      expect(updatedAnnotations[0].span).toBe('10..33')
    })

    it('does not expand annotation when inserting at its end position', async () => {
      const annotations = [
        { id: 'ann1', caption: 'Test', type: 'gene', span: '10..30' }
      ]

      const wrapper = mount(SequenceEditor, {
        props: { annotations, initialZoom: 100 }
      })
      wrapper.vm.setSequence('A'.repeat(100))
      await wrapper.vm.$nextTick()

      // Set up insert at position 30 (exactly at annotation end)
      await setupInsertAtPosition(wrapper, 30)

      const insertModal = wrapper.findComponent({ name: 'InsertModal' })
      insertModal.vm.$emit('submit', 'GGG')  // 3 characters
      await wrapper.vm.$nextTick()

      const emitted = wrapper.emitted('annotations-update')
      expect(emitted).toBeTruthy()

      // start=10, not > 30, unchanged; end=30, not > 30, unchanged
      // Result: annotation stays the same (insert is at boundary, not inside)
      const updatedAnnotations = emitted[0][0]
      expect(updatedAnnotations[0].span).toBe('10..30')
    })

    it('handles join spans with multiple ranges', async () => {
      const annotations = [
        { id: 'ann1', caption: 'Joined', type: 'CDS', span: '10..20 + 40..60' }
      ]

      const wrapper = mount(SequenceEditor, {
        props: { annotations, initialZoom: 100 }
      })
      wrapper.vm.setSequence('A'.repeat(100))
      await wrapper.vm.$nextTick()

      // Set up insert at position 30 (between the two ranges)
      await setupInsertAtPosition(wrapper, 30)

      const insertModal = wrapper.findComponent({ name: 'InsertModal' })
      insertModal.vm.$emit('submit', 'AAAA')  // 4 characters
      await wrapper.vm.$nextTick()

      const emitted = wrapper.emitted('annotations-update')
      expect(emitted).toBeTruthy()

      const updatedAnnotations = emitted[0][0]
      // First range (10..20): start and end both < 30, unchanged
      // Second range (40..60): start and end both > 30, both shift by 4
      expect(updatedAnnotations[0].span).toBe('10..20 + 44..64')
    })

    it('INTEGRATION: inserting inside annotation preserves start position and expands end', async () => {
      const annotations = [
        { id: 'ann_test', caption: 'TestAnnotation', type: 'gene', span: '230..247' }
      ]

      const wrapper = mount(SequenceEditor, {
        props: { annotations, initialZoom: 100 }
      })
      wrapper.vm.setSequence('A'.repeat(500))
      await wrapper.vm.$nextTick()

      // Verify initial annotation state
      const annotationLayer = wrapper.findComponent({ name: 'AnnotationLayer' })
      const initialFragments = annotationLayer.vm.fragments
      const initialFragment = initialFragments.find(f => f.annotation.id === 'ann_test')
      expect(initialFragment).toBeTruthy()
      expect(initialFragment.annotation.span.ranges[0].start).toBe(230)
      expect(initialFragment.annotation.span.ranges[0].end).toBe(247)

      // Set up insert at position 231 (inside annotation, 1 base after start)
      await setupInsertAtPosition(wrapper, 231)

      // Submit 4 characters via the modal
      const insertModal = wrapper.findComponent({ name: 'InsertModal' })
      insertModal.vm.$emit('submit', 'ATCG')
      await wrapper.vm.$nextTick()

      // Check that annotations-update was emitted with correct coordinates
      const emitted = wrapper.emitted('annotations-update')
      expect(emitted).toBeTruthy()
      expect(emitted.length).toBe(1)

      const updatedAnnotations = emitted[0][0]
      const updatedSpan = updatedAnnotations[0].span

      // CRITICAL: Start position must stay at 230 (not shift to 231)
      // End position should be 247 + 4 = 251
      expect(updatedSpan).toBe('230..251')

      // Also verify the rendered annotation fragment position is correct
      await wrapper.vm.$nextTick()
      const updatedFragments = annotationLayer.vm.fragments
      const updatedFragment = updatedFragments.find(f => f.annotation.id === 'ann_test')
      expect(updatedFragment).toBeTruthy()
      expect(updatedFragment.annotation.span.ranges[0].start).toBe(230)
      expect(updatedFragment.annotation.span.ranges[0].end).toBe(251)
    })

    it('INTEGRATION: inserting at exact start position expands annotation', async () => {
      const annotations = [
        { id: 'ann_test', caption: 'TestAnnotation', type: 'gene', span: '100..150' }
      ]

      const wrapper = mount(SequenceEditor, {
        props: { annotations, initialZoom: 100 }
      })
      wrapper.vm.setSequence('A'.repeat(300))
      await wrapper.vm.$nextTick()

      // Insert at position 100 (exact start)
      await setupInsertAtPosition(wrapper, 100)

      const insertModal = wrapper.findComponent({ name: 'InsertModal' })
      insertModal.vm.$emit('submit', 'GGG')
      await wrapper.vm.$nextTick()

      const emitted = wrapper.emitted('annotations-update')
      expect(emitted).toBeTruthy()

      // Start stays 100, end becomes 150 + 3 = 153
      expect(emitted[0][0][0].span).toBe('100..153')
    })

    it('INTEGRATION: inserting 1 base before start shifts entire annotation', async () => {
      const annotations = [
        { id: 'ann_test', caption: 'TestAnnotation', type: 'gene', span: '100..150' }
      ]

      const wrapper = mount(SequenceEditor, {
        props: { annotations, initialZoom: 100 }
      })
      wrapper.vm.setSequence('A'.repeat(300))
      await wrapper.vm.$nextTick()

      // Insert at position 99 (1 base before start)
      await setupInsertAtPosition(wrapper, 99)

      const insertModal = wrapper.findComponent({ name: 'InsertModal' })
      insertModal.vm.$emit('submit', 'TTT')
      await wrapper.vm.$nextTick()

      const emitted = wrapper.emitted('annotations-update')
      expect(emitted).toBeTruthy()

      // Both start and end shift by 3: 100+3=103, 150+3=153
      expect(emitted[0][0][0].span).toBe('103..153')
    })
  })

  describe('annotation adjustment on replace', () => {
    // Helper to set up replace mode at a specific selection range
    async function setupReplaceAtSelection(wrapper, start, end) {
      // Create selection
      const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
      const selection = selectionLayer.vm.selection
      selection.select(`${start}..${end}`)
      await wrapper.vm.$nextTick()

      // Simulate opening replace modal by typing a DNA base (which triggers showInsertModal)
      // This sets up insertModalIsReplace based on whether there's a non-zero selection
      const svg = wrapper.find('svg.editor-svg')
      await svg.trigger('keydown', { key: 'A' })
      await wrapper.vm.$nextTick()
    }

    it('updates selection to match replacement length', async () => {
      const wrapper = mount(SequenceEditor, {
        props: { annotations: [], initialZoom: 100 }
      })
      wrapper.vm.setSequence('A'.repeat(100))
      await wrapper.vm.$nextTick()

      // Select 7 bases (positions 10-17)
      await setupReplaceAtSelection(wrapper, 10, 17)

      // Replace with 3 characters
      const insertModal = wrapper.findComponent({ name: 'InsertModal' })
      insertModal.vm.$emit('submit', 'GGG')
      await wrapper.vm.$nextTick()

      // Selection should now be 3 bases (10-13)
      const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
      const selection = selectionLayer.vm.selection
      expect(selection.domain.value.ranges[0].start).toBe(10)
      expect(selection.domain.value.ranges[0].end).toBe(13)
    })

    it('shifts annotation after selection by net change', async () => {
      const annotations = [
        { id: 'ann1', caption: 'After', type: 'gene', span: '50..70' }
      ]

      const wrapper = mount(SequenceEditor, {
        props: { annotations, initialZoom: 100 }
      })
      wrapper.vm.setSequence('A'.repeat(100))
      await wrapper.vm.$nextTick()

      // Select 10 bases (20-30), replace with 4 (net change: -6)
      await setupReplaceAtSelection(wrapper, 20, 30)

      const insertModal = wrapper.findComponent({ name: 'InsertModal' })
      insertModal.vm.$emit('submit', 'AAAA')
      await wrapper.vm.$nextTick()

      const emitted = wrapper.emitted('annotations-update')
      expect(emitted).toBeTruthy()

      // Annotation shifts left by 6: 50-6=44, 70-6=64
      const updatedAnnotations = emitted[0][0]
      expect(updatedAnnotations[0].span).toBe('44..64')
    })

    it('does not modify annotation before selection', async () => {
      const annotations = [
        { id: 'ann1', caption: 'Before', type: 'gene', span: '5..15' }
      ]

      const wrapper = mount(SequenceEditor, {
        props: { annotations, initialZoom: 100 }
      })
      wrapper.vm.setSequence('A'.repeat(100))
      await wrapper.vm.$nextTick()

      // Select bases 30-40, replace with 2 chars
      await setupReplaceAtSelection(wrapper, 30, 40)

      const insertModal = wrapper.findComponent({ name: 'InsertModal' })
      insertModal.vm.$emit('submit', 'CC')
      await wrapper.vm.$nextTick()

      const emitted = wrapper.emitted('annotations-update')
      expect(emitted).toBeTruthy()

      // Annotation before selection is unchanged
      const updatedAnnotations = emitted[0][0]
      expect(updatedAnnotations[0].span).toBe('5..15')
    })

    it('shrinks annotation that spans across selection', async () => {
      const annotations = [
        { id: 'ann1', caption: 'Spanning', type: 'gene', span: '10..50' }
      ]

      const wrapper = mount(SequenceEditor, {
        props: { annotations, initialZoom: 100 }
      })
      wrapper.vm.setSequence('A'.repeat(100))
      await wrapper.vm.$nextTick()

      // Select 20-30 (inside annotation), replace with 2 chars (net: -8)
      await setupReplaceAtSelection(wrapper, 20, 30)

      const insertModal = wrapper.findComponent({ name: 'InsertModal' })
      insertModal.vm.$emit('submit', 'TT')
      await wrapper.vm.$nextTick()

      const emitted = wrapper.emitted('annotations-update')
      expect(emitted).toBeTruthy()

      // Start stays 10, end shrinks: 50-8=42
      const updatedAnnotations = emitted[0][0]
      expect(updatedAnnotations[0].span).toBe('10..42')
    })

    it('expands annotation that spans across selection when replacement is longer', async () => {
      const annotations = [
        { id: 'ann1', caption: 'Spanning', type: 'gene', span: '10..50' }
      ]

      const wrapper = mount(SequenceEditor, {
        props: { annotations, initialZoom: 100 }
      })
      wrapper.vm.setSequence('A'.repeat(100))
      await wrapper.vm.$nextTick()

      // Select 20-25 (5 bases inside annotation), replace with 15 chars (net: +10)
      await setupReplaceAtSelection(wrapper, 20, 25)

      const insertModal = wrapper.findComponent({ name: 'InsertModal' })
      insertModal.vm.$emit('submit', 'AAAAAGGGGGCCCCC')  // 15 chars
      await wrapper.vm.$nextTick()

      const emitted = wrapper.emitted('annotations-update')
      expect(emitted).toBeTruthy()

      // Start stays 10, end expands: 50+10=60
      const updatedAnnotations = emitted[0][0]
      expect(updatedAnnotations[0].span).toBe('10..60')
    })

    it('collapses annotation contained within selection to zero length', async () => {
      const annotations = [
        { id: 'ann1', caption: 'Inside', type: 'gene', span: '25..35' }
      ]

      const wrapper = mount(SequenceEditor, {
        props: { annotations, initialZoom: 100 }
      })
      wrapper.vm.setSequence('A'.repeat(100))
      await wrapper.vm.$nextTick()

      // Select 20-40 (contains the entire annotation)
      await setupReplaceAtSelection(wrapper, 20, 40)

      const insertModal = wrapper.findComponent({ name: 'InsertModal' })
      insertModal.vm.$emit('submit', 'XXX')
      await wrapper.vm.$nextTick()

      const emitted = wrapper.emitted('annotations-update')
      expect(emitted).toBeTruthy()

      // Annotation collapses to zero length at selection start
      const updatedAnnotations = emitted[0][0]
      expect(updatedAnnotations[0].span).toBe('20')
    })

    it('truncates annotation that overlaps left side of selection', async () => {
      const annotations = [
        { id: 'ann1', caption: 'OverlapLeft', type: 'gene', span: '15..35' }
      ]

      const wrapper = mount(SequenceEditor, {
        props: { annotations, initialZoom: 100 }
      })
      wrapper.vm.setSequence('A'.repeat(100))
      await wrapper.vm.$nextTick()

      // Select 30-50 (annotation starts before, ends inside selection)
      await setupReplaceAtSelection(wrapper, 30, 50)

      const insertModal = wrapper.findComponent({ name: 'InsertModal' })
      insertModal.vm.$emit('submit', 'AAAA')
      await wrapper.vm.$nextTick()

      const emitted = wrapper.emitted('annotations-update')
      expect(emitted).toBeTruthy()

      // Annotation truncated: start stays 15, end becomes 30 (selection start)
      const updatedAnnotations = emitted[0][0]
      expect(updatedAnnotations[0].span).toBe('15..30')
    })

    it('moves annotation that overlaps right side of selection', async () => {
      const annotations = [
        { id: 'ann1', caption: 'OverlapRight', type: 'gene', span: '25..45' }
      ]

      const wrapper = mount(SequenceEditor, {
        props: { annotations, initialZoom: 100 }
      })
      wrapper.vm.setSequence('A'.repeat(100))
      await wrapper.vm.$nextTick()

      // Select 20-30 (annotation starts inside, ends after selection)
      // Replace 10 chars with 4 chars (net: -6)
      await setupReplaceAtSelection(wrapper, 20, 30)

      const insertModal = wrapper.findComponent({ name: 'InsertModal' })
      insertModal.vm.$emit('submit', 'GGGG')  // 4 chars
      await wrapper.vm.$nextTick()

      const emitted = wrapper.emitted('annotations-update')
      expect(emitted).toBeTruthy()

      // Start moves to after inserted text: 20+4=24
      // End shifts by net change: 45-6=39
      const updatedAnnotations = emitted[0][0]
      expect(updatedAnnotations[0].span).toBe('24..39')
    })

    it('handles multiple annotations with different overlap scenarios', async () => {
      const annotations = [
        { id: 'ann1', caption: 'Before', type: 'gene', span: '5..15' },
        { id: 'ann2', caption: 'Spanning', type: 'promoter', span: '25..55' },
        { id: 'ann3', caption: 'Inside', type: 'terminator', span: '35..45' },
        { id: 'ann4', caption: 'After', type: 'CDS', span: '70..90' }
      ]

      const wrapper = mount(SequenceEditor, {
        props: { annotations, initialZoom: 100 }
      })
      wrapper.vm.setSequence('A'.repeat(100))
      await wrapper.vm.$nextTick()

      // Select 30-50, replace 20 chars with 5 chars (net: -15)
      await setupReplaceAtSelection(wrapper, 30, 50)

      const insertModal = wrapper.findComponent({ name: 'InsertModal' })
      insertModal.vm.$emit('submit', 'XXXXX')  // 5 chars
      await wrapper.vm.$nextTick()

      const emitted = wrapper.emitted('annotations-update')
      expect(emitted).toBeTruthy()

      const updated = emitted[0][0]

      // ann1 (5..15): entirely before, unchanged
      expect(updated[0].span).toBe('5..15')

      // ann2 (25..55): spans selection, end shrinks by 15: 55-15=40
      expect(updated[1].span).toBe('25..40')

      // ann3 (35..45): contained in selection, collapses to start
      expect(updated[2].span).toBe('30')

      // ann4 (70..90): after selection, shifts by -15: 55..75
      expect(updated[3].span).toBe('55..75')
    })
  })

  describe('annotation adjustment on multi-range delete', () => {
    it('preserves multi-range annotation structure when deleting overlapping multi-range selection', async () => {
      // Annotation with two segments: 1..5 and 10..20
      // Selection: 2..7 and 15..24 (overlaps both segments)
      // After delete: should have two segments with adjusted positions
      const annotations = [
        { id: 'ann1', caption: 'Split Gene', type: 'gene', span: '1..5 + 10..20' }
      ]

      const wrapper = mount(SequenceEditor, {
        props: { annotations, initialZoom: 100 }
      })
      wrapper.vm.setSequence('A'.repeat(50))
      await wrapper.vm.$nextTick()

      // Create multi-range selection: 2..7 + 15..24
      const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
      selectionLayer.vm.selection.select('2..7 + 15..24')
      await wrapper.vm.$nextTick()

      // Delete the selection
      await wrapper.find('.editor-svg').trigger('keydown', { key: 'Delete' })
      await wrapper.vm.$nextTick()

      // Check that annotations-update was emitted
      const emitted = wrapper.emitted('annotations-update')
      expect(emitted).toBeTruthy()

      // Get the final annotation state (last emission)
      const finalAnnotations = emitted[emitted.length - 1][0]
      const ann = finalAnnotations.find(a => a.id === 'ann1')
      expect(ann).toBeTruthy()

      // The annotation should still have two segments
      // Original: 1..5 + 10..20
      // Delete 15..24 first (from high to low):
      //   - 1..5: unchanged (before deletion)
      //   - 10..20: overlaps 15..24, truncated to 10..15
      // Then delete 2..7:
      //   - 1..5: overlaps 2..7, truncated to 1..2
      //   - 10..15: shifts left by 5 (deletion length), becomes 5..10
      // Final: 1..2 + 5..10
      expect(ann.span).toBe('1..2 + 5..10')
    })
  })

  describe('annotation CRUD operations', () => {
    describe('create annotation', () => {
      it('adds annotation to local state when created via modal', async () => {
        const wrapper = mount(SequenceEditor, {
          props: { initialZoom: 100 }
        })
        wrapper.vm.setSequence('A'.repeat(100))
        await wrapper.vm.$nextTick()

        // Make a selection
        const selectionLayer = wrapper.findComponent({ name: 'SelectionLayer' })
        selectionLayer.vm.selection.select('10..50')
        await wrapper.vm.$nextTick()

        // Open context menu and click Create Annotation
        const overlay = wrapper.find('.sequence-overlay')
        await overlay.trigger('contextmenu', { clientX: 100, clientY: 20 })
        await wrapper.vm.$nextTick()

        const menuItems = wrapper.findAll('.menu-item')
        const createItem = menuItems.find(item => item.text().includes('Create Annotation'))
        await createItem.trigger('click')
        await wrapper.vm.$nextTick()

        // Fill out and submit the annotation modal
        const annotationModal = wrapper.findComponent({ name: 'AnnotationModal' })
        annotationModal.vm.$emit('create', {
          caption: 'Test Gene',
          type: 'gene',
          span: '10..50',
          attributes: {}
        })
        await wrapper.vm.$nextTick()

        // Should emit annotations-update with the new annotation
        const emitted = wrapper.emitted('annotations-update')
        expect(emitted).toBeTruthy()
        expect(emitted[0][0]).toHaveLength(1)
        expect(emitted[0][0][0].caption).toBe('Test Gene')
        expect(emitted[0][0][0].type).toBe('gene')
        expect(emitted[0][0][0].span).toBe('10..50')
      })

      it('generates unique ID for new annotation', async () => {
        const wrapper = mount(SequenceEditor, {
          props: { initialZoom: 100 }
        })
        wrapper.vm.setSequence('A'.repeat(100))
        await wrapper.vm.$nextTick()

        // Trigger annotation creation via modal emit
        const annotationModal = wrapper.findComponent({ name: 'AnnotationModal' })
        annotationModal.vm.$emit('create', {
          caption: 'Test',
          type: 'gene',
          span: '10..20',
          attributes: {}
        })
        await wrapper.vm.$nextTick()

        const emitted = wrapper.emitted('annotations-update')
        expect(emitted[0][0][0].id).toBeTruthy()
        expect(typeof emitted[0][0][0].id).toBe('string')
      })

      it('computes translation for CDS annotations', async () => {
        const wrapper = mount(SequenceEditor, {
          props: { initialZoom: 100 }
        })
        // ATG = M (Methionine start codon)
        wrapper.vm.setSequence('ATGATGATG' + 'A'.repeat(91))
        await wrapper.vm.$nextTick()

        const annotationModal = wrapper.findComponent({ name: 'AnnotationModal' })
        annotationModal.vm.$emit('create', {
          caption: 'Test CDS',
          type: 'CDS',
          span: '0..9',
          attributes: {}
        })
        await wrapper.vm.$nextTick()

        const emitted = wrapper.emitted('annotations-update')
        expect(emitted[0][0][0].attributes.translation).toBe('MMM')
      })

      it('calls backend.annotationCreated when backend provided', async () => {
        const mockBackend = {
          annotationCreated: mock(() => {})
        }
        const wrapper = mount(SequenceEditor, {
          props: { initialZoom: 100, backend: mockBackend }
        })
        wrapper.vm.setSequence('A'.repeat(100))
        await wrapper.vm.$nextTick()

        const annotationModal = wrapper.findComponent({ name: 'AnnotationModal' })
        annotationModal.vm.$emit('create', {
          caption: 'Test',
          type: 'gene',
          span: '10..20',
          attributes: {}
        })
        await wrapper.vm.$nextTick()

        expect(mockBackend.annotationCreated).toHaveBeenCalledTimes(1)
        const call = mockBackend.annotationCreated.mock.calls[0][0]
        expect(call.caption).toBe('Test')
        expect(call.type).toBe('gene')
      })
    })

    describe('update annotation', () => {
      it('updates annotation in local state when edited via modal', async () => {
        const annotations = [
          { id: 'ann1', caption: 'Original', type: 'gene', span: '10..50' }
        ]
        const wrapper = mount(SequenceEditor, {
          props: { annotations, initialZoom: 100 }
        })
        wrapper.vm.setSequence('A'.repeat(100))
        await wrapper.vm.$nextTick()

        // Simulate opening edit modal and submitting update
        // First, we need to set the editingAnnotation by clicking on annotation context menu
        const annotationLayer = wrapper.findComponent({ name: 'AnnotationLayer' })
        annotationLayer.vm.$emit('contextmenu', {
          annotation: annotations[0],
          event: { clientX: 100, clientY: 100, preventDefault: () => {} },
          fragment: {}
        })
        await wrapper.vm.$nextTick()

        // Click Edit Annotation
        const menuItems = wrapper.findAll('.menu-item')
        const editItem = menuItems.find(item => item.text().includes('Edit Annotation'))
        await editItem.trigger('click')
        await wrapper.vm.$nextTick()

        // Submit update via modal
        const annotationModal = wrapper.findComponent({ name: 'AnnotationModal' })
        annotationModal.vm.$emit('update', {
          caption: 'Updated',
          type: 'CDS',
          span: '10..60',
          attributes: { gene: 'testGene' }
        })
        await wrapper.vm.$nextTick()

        const emitted = wrapper.emitted('annotations-update')
        expect(emitted).toBeTruthy()
        expect(emitted[0][0]).toHaveLength(1)
        expect(emitted[0][0][0].id).toBe('ann1')
        expect(emitted[0][0][0].caption).toBe('Updated')
        expect(emitted[0][0][0].type).toBe('CDS')
        expect(emitted[0][0][0].span).toBe('10..60')
        expect(emitted[0][0][0].attributes.gene).toBe('testGene')
      })

      it('calls backend.annotationUpdate when backend provided', async () => {
        const mockBackend = {
          annotationUpdate: mock(() => {})
        }
        const annotations = [
          { id: 'ann1', caption: 'Original', type: 'gene', span: '10..50' }
        ]
        const wrapper = mount(SequenceEditor, {
          props: { annotations, initialZoom: 100, backend: mockBackend }
        })
        wrapper.vm.setSequence('A'.repeat(100))
        await wrapper.vm.$nextTick()

        // Open edit modal
        const annotationLayer = wrapper.findComponent({ name: 'AnnotationLayer' })
        annotationLayer.vm.$emit('contextmenu', {
          annotation: annotations[0],
          event: { clientX: 100, clientY: 100, preventDefault: () => {} },
          fragment: {}
        })
        await wrapper.vm.$nextTick()

        const menuItems = wrapper.findAll('.menu-item')
        const editItem = menuItems.find(item => item.text().includes('Edit Annotation'))
        await editItem.trigger('click')
        await wrapper.vm.$nextTick()

        const annotationModal = wrapper.findComponent({ name: 'AnnotationModal' })
        annotationModal.vm.$emit('update', {
          caption: 'Updated',
          type: 'CDS',
          span: '10..60',
          attributes: {}
        })
        await wrapper.vm.$nextTick()

        expect(mockBackend.annotationUpdate).toHaveBeenCalledTimes(1)
        const call = mockBackend.annotationUpdate.mock.calls[0][0]
        expect(call.annotationId).toBe('ann1')
        expect(call.caption).toBe('Updated')
      })
    })

    describe('delete annotation', () => {
      it('removes annotation from local state when deleted via context menu', async () => {
        const annotations = [
          { id: 'ann1', caption: 'Gene1', type: 'gene', span: '10..50' },
          { id: 'ann2', caption: 'Gene2', type: 'gene', span: '60..90' }
        ]
        const wrapper = mount(SequenceEditor, {
          props: { annotations, initialZoom: 100 }
        })
        wrapper.vm.setSequence('A'.repeat(100))
        await wrapper.vm.$nextTick()

        // Right-click on annotation
        const annotationLayer = wrapper.findComponent({ name: 'AnnotationLayer' })
        annotationLayer.vm.$emit('contextmenu', {
          annotation: annotations[0],
          event: { clientX: 100, clientY: 100, preventDefault: () => {} },
          fragment: {}
        })
        await wrapper.vm.$nextTick()

        // Click Delete Annotation
        const menuItems = wrapper.findAll('.menu-item')
        const deleteItem = menuItems.find(item => item.text().includes('Delete Annotation'))
        await deleteItem.trigger('click')
        await wrapper.vm.$nextTick()

        const emitted = wrapper.emitted('annotations-update')
        expect(emitted).toBeTruthy()
        expect(emitted[0][0]).toHaveLength(1)
        expect(emitted[0][0][0].id).toBe('ann2')
      })

      it('calls backend.annotationDeleted when backend provided', async () => {
        const mockBackend = {
          annotationDeleted: mock(() => {})
        }
        const annotations = [
          { id: 'ann1', caption: 'Gene1', type: 'gene', span: '10..50' }
        ]
        const wrapper = mount(SequenceEditor, {
          props: { annotations, initialZoom: 100, backend: mockBackend }
        })
        wrapper.vm.setSequence('A'.repeat(100))
        await wrapper.vm.$nextTick()

        // Right-click on annotation
        const annotationLayer = wrapper.findComponent({ name: 'AnnotationLayer' })
        annotationLayer.vm.$emit('contextmenu', {
          annotation: annotations[0],
          event: { clientX: 100, clientY: 100, preventDefault: () => {} },
          fragment: {}
        })
        await wrapper.vm.$nextTick()

        const menuItems = wrapper.findAll('.menu-item')
        const deleteItem = menuItems.find(item => item.text().includes('Delete Annotation'))
        await deleteItem.trigger('click')
        await wrapper.vm.$nextTick()

        expect(mockBackend.annotationDeleted).toHaveBeenCalledTimes(1)
        const call = mockBackend.annotationDeleted.mock.calls[0][0]
        expect(call.annotationId).toBe('ann1')
      })

      it('does not show delete option in readonly mode', async () => {
        const annotations = [
          { id: 'ann1', caption: 'Gene1', type: 'gene', span: '10..50' }
        ]
        const wrapper = mount(SequenceEditor, {
          props: { annotations, initialZoom: 100, readonly: true }
        })
        wrapper.vm.setSequence('A'.repeat(100))
        await wrapper.vm.$nextTick()

        // Right-click on annotation
        const annotationLayer = wrapper.findComponent({ name: 'AnnotationLayer' })
        annotationLayer.vm.$emit('contextmenu', {
          annotation: annotations[0],
          event: { clientX: 100, clientY: 100, preventDefault: () => {} },
          fragment: {}
        })
        await wrapper.vm.$nextTick()

        const menuText = wrapper.find('.context-menu').text()
        expect(menuText).not.toContain('Delete Annotation')
        expect(menuText).not.toContain('Edit Annotation')
      })
    })

    describe('merge annotation segments', () => {
      it('shows merge options for adjacent segments with same orientation', async () => {
        // Create an annotation with two adjacent ranges (10..20 + 20..30)
        const annotations = [
          { id: 'ann1', caption: 'Split Gene', type: 'gene', span: '10..20 + 20..30' }
        ]
        const wrapper = mount(SequenceEditor, {
          props: { annotations, initialZoom: 100 }
        })
        wrapper.vm.setSequence('A'.repeat(100))
        await wrapper.vm.$nextTick()

        // Get the annotation layer and find the fragments
        const annotationLayer = wrapper.findComponent({ name: 'AnnotationLayer' })
        const fragments = annotationLayer.vm.fragments

        // Should have 2 fragments (one for each range)
        expect(fragments.length).toBe(2)

        // Right-click on the first fragment (rangeIndex = 0)
        // Should show "Merge with right segment"
        annotationLayer.vm.$emit('contextmenu', {
          annotation: fragments[0].annotation,
          event: { clientX: 100, clientY: 100, preventDefault: () => {} },
          fragment: fragments[0]
        })
        await wrapper.vm.$nextTick()

        const menuText = wrapper.find('.context-menu').text()
        expect(menuText).toContain('Merge with right segment')
        expect(menuText).not.toContain('Merge with left segment')
      })

      it('shows merge with left option when right-clicking on second segment', async () => {
        const annotations = [
          { id: 'ann1', caption: 'Split Gene', type: 'gene', span: '10..20 + 20..30' }
        ]
        const wrapper = mount(SequenceEditor, {
          props: { annotations, initialZoom: 100 }
        })
        wrapper.vm.setSequence('A'.repeat(100))
        await wrapper.vm.$nextTick()

        const annotationLayer = wrapper.findComponent({ name: 'AnnotationLayer' })
        const fragments = annotationLayer.vm.fragments

        // Right-click on the second fragment (rangeIndex = 1)
        // Should show "Merge with left segment"
        annotationLayer.vm.$emit('contextmenu', {
          annotation: fragments[1].annotation,
          event: { clientX: 100, clientY: 100, preventDefault: () => {} },
          fragment: fragments[1]
        })
        await wrapper.vm.$nextTick()

        const menuText = wrapper.find('.context-menu').text()
        expect(menuText).toContain('Merge with left segment')
        expect(menuText).not.toContain('Merge with right segment')
      })

      it('shows both merge options for middle segment', async () => {
        // Three adjacent segments
        const annotations = [
          { id: 'ann1', caption: 'Split Gene', type: 'gene', span: '10..20 + 20..30 + 30..40' }
        ]
        const wrapper = mount(SequenceEditor, {
          props: { annotations, initialZoom: 100 }
        })
        wrapper.vm.setSequence('A'.repeat(100))
        await wrapper.vm.$nextTick()

        const annotationLayer = wrapper.findComponent({ name: 'AnnotationLayer' })
        const fragments = annotationLayer.vm.fragments

        // Should have 3 fragments
        expect(fragments.length).toBe(3)

        // Right-click on the middle fragment (rangeIndex = 1)
        annotationLayer.vm.$emit('contextmenu', {
          annotation: fragments[1].annotation,
          event: { clientX: 100, clientY: 100, preventDefault: () => {} },
          fragment: fragments[1]
        })
        await wrapper.vm.$nextTick()

        const menuText = wrapper.find('.context-menu').text()
        expect(menuText).toContain('Merge with left segment')
        expect(menuText).toContain('Merge with right segment')
      })

      it('does not show merge options for non-adjacent segments', async () => {
        // Non-adjacent ranges (gap between 20 and 30)
        const annotations = [
          { id: 'ann1', caption: 'Split Gene', type: 'gene', span: '10..20 + 30..40' }
        ]
        const wrapper = mount(SequenceEditor, {
          props: { annotations, initialZoom: 100 }
        })
        wrapper.vm.setSequence('A'.repeat(100))
        await wrapper.vm.$nextTick()

        const annotationLayer = wrapper.findComponent({ name: 'AnnotationLayer' })
        const fragments = annotationLayer.vm.fragments

        // Right-click on first fragment
        annotationLayer.vm.$emit('contextmenu', {
          annotation: fragments[0].annotation,
          event: { clientX: 100, clientY: 100, preventDefault: () => {} },
          fragment: fragments[0]
        })
        await wrapper.vm.$nextTick()

        const menuText = wrapper.find('.context-menu').text()
        expect(menuText).not.toContain('Merge with')
      })

      it('does not show merge options for segments with different orientations', async () => {
        // Adjacent but different orientations
        const annotations = [
          { id: 'ann1', caption: 'Split Gene', type: 'gene', span: '10..20 + (20..30)' }
        ]
        const wrapper = mount(SequenceEditor, {
          props: { annotations, initialZoom: 100 }
        })
        wrapper.vm.setSequence('A'.repeat(100))
        await wrapper.vm.$nextTick()

        const annotationLayer = wrapper.findComponent({ name: 'AnnotationLayer' })
        const fragments = annotationLayer.vm.fragments

        // Right-click on first fragment
        annotationLayer.vm.$emit('contextmenu', {
          annotation: fragments[0].annotation,
          event: { clientX: 100, clientY: 100, preventDefault: () => {} },
          fragment: fragments[0]
        })
        await wrapper.vm.$nextTick()

        const menuText = wrapper.find('.context-menu').text()
        expect(menuText).not.toContain('Merge with')
      })

      it('merges segments when clicking merge option', async () => {
        const annotations = [
          { id: 'ann1', caption: 'Split Gene', type: 'gene', span: '10..20 + 20..30' }
        ]
        const wrapper = mount(SequenceEditor, {
          props: { annotations, initialZoom: 100 }
        })
        wrapper.vm.setSequence('A'.repeat(100))
        await wrapper.vm.$nextTick()

        const annotationLayer = wrapper.findComponent({ name: 'AnnotationLayer' })
        const fragments = annotationLayer.vm.fragments

        // Right-click on first fragment
        annotationLayer.vm.$emit('contextmenu', {
          annotation: fragments[0].annotation,
          event: { clientX: 100, clientY: 100, preventDefault: () => {} },
          fragment: fragments[0]
        })
        await wrapper.vm.$nextTick()

        // Click "Merge with right segment"
        const menuItems = wrapper.findAll('.menu-item')
        const mergeItem = menuItems.find(item => item.text().includes('Merge with right segment'))
        await mergeItem.trigger('click')
        await wrapper.vm.$nextTick()

        // Check that annotations-update was emitted with merged span
        const emitted = wrapper.emitted('annotations-update')
        expect(emitted).toBeTruthy()

        // The merged span should be 10..30
        const updatedAnnotations = emitted[emitted.length - 1][0]
        const mergedAnnotation = updatedAnnotations.find(a => a.id === 'ann1')
        expect(mergedAnnotation.span).toBe('10..30')
      })

      it('does not show merge options for single-range annotations', async () => {
        const annotations = [
          { id: 'ann1', caption: 'Single Gene', type: 'gene', span: '10..30' }
        ]
        const wrapper = mount(SequenceEditor, {
          props: { annotations, initialZoom: 100 }
        })
        wrapper.vm.setSequence('A'.repeat(100))
        await wrapper.vm.$nextTick()

        const annotationLayer = wrapper.findComponent({ name: 'AnnotationLayer' })
        const fragments = annotationLayer.vm.fragments

        annotationLayer.vm.$emit('contextmenu', {
          annotation: fragments[0].annotation,
          event: { clientX: 100, clientY: 100, preventDefault: () => {} },
          fragment: fragments[0]
        })
        await wrapper.vm.$nextTick()

        const menuText = wrapper.find('.context-menu').text()
        expect(menuText).not.toContain('Merge with')
      })
    })

    describe('subtract annotation from selection', () => {
      it('subtracts multi-range annotation from multi-range selection', async () => {
        // Annotation: 1..5 + 10..20
        // Selection: 2..7 + 15..24
        // After subtraction: 5..7 + 20..24 (the parts not covered by the annotation)
        const annotations = [
          { id: 'ann1', caption: 'MultiRange', type: 'gene', span: '1..5 + 10..20' }
        ]
        const wrapper = mount(SequenceEditor, {
          props: { annotations, initialZoom: 100 }
        })
        wrapper.vm.setSequence('A'.repeat(100))
        await wrapper.vm.$nextTick()

        // Create multi-range selection: 2..7 + 15..24
        wrapper.vm.selection.select('2..7 + 15..24')
        await wrapper.vm.$nextTick()

        // Right-click on annotation to get context menu
        const annotationLayer = wrapper.findComponent({ name: 'AnnotationLayer' })
        const fragments = annotationLayer.vm.fragments

        annotationLayer.vm.$emit('contextmenu', {
          annotation: fragments[0].annotation,
          event: { clientX: 100, clientY: 100, preventDefault: () => {} },
          fragment: fragments[0]
        })
        await wrapper.vm.$nextTick()

        // Click "Subtract from selection"
        const menuItems = wrapper.findAll('.menu-item')
        const subtractItem = menuItems.find(item => item.text().includes('Subtract from selection'))
        expect(subtractItem).toBeTruthy()
        await subtractItem.trigger('click')
        await wrapper.vm.$nextTick()

        // Verify selection has two segments: 5..7 and 20..24
        const domain = wrapper.vm.selection.domain.value
        expect(domain.ranges).toHaveLength(2)
        expect(domain.ranges[0].start).toBe(5)
        expect(domain.ranges[0].end).toBe(7)
        expect(domain.ranges[1].start).toBe(20)
        expect(domain.ranges[1].end).toBe(24)
      })

      it('subtracts multi-range annotation from single selection spanning gap', async () => {
        // Annotation: 1..5 + 10..20
        // Selection: 2..12
        // After subtraction: 5..10 (the gap between annotation ranges)
        const annotations = [
          { id: 'ann1', caption: 'MultiRange', type: 'gene', span: '1..5 + 10..20' }
        ]
        const wrapper = mount(SequenceEditor, {
          props: { annotations, initialZoom: 100 }
        })
        wrapper.vm.setSequence('A'.repeat(100))
        await wrapper.vm.$nextTick()

        // Create selection spanning both annotation ranges: 2..12
        wrapper.vm.selection.select('2..12')
        await wrapper.vm.$nextTick()

        // Right-click on annotation to get context menu
        const annotationLayer = wrapper.findComponent({ name: 'AnnotationLayer' })
        const fragments = annotationLayer.vm.fragments

        annotationLayer.vm.$emit('contextmenu', {
          annotation: fragments[0].annotation,
          event: { clientX: 100, clientY: 100, preventDefault: () => {} },
          fragment: fragments[0]
        })
        await wrapper.vm.$nextTick()

        // Click "Subtract from selection"
        const menuItems = wrapper.findAll('.menu-item')
        const subtractItem = menuItems.find(item => item.text().includes('Subtract from selection'))
        expect(subtractItem).toBeTruthy()
        await subtractItem.trigger('click')
        await wrapper.vm.$nextTick()

        // Verify selection is just the gap: 5..10
        const domain = wrapper.vm.selection.domain.value
        expect(domain.ranges).toHaveLength(1)
        expect(domain.ranges[0].start).toBe(5)
        expect(domain.ranges[0].end).toBe(10)
      })
    })
  })
})
