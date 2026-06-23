import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import AnnotationModal from './AnnotationModal.vue'
import { PrimerBindExtension } from '../extensions/PrimerBindExtension/index.js'
import { Span, Range, Orientation } from '../utils/dna.js'
import { ezSpan } from '../../test/span-helpers.js'

describe('AnnotationModal', () => {
  describe('visibility', () => {
    it('is hidden when open is false', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: false }
      })
      expect(wrapper.find('.modal-overlay').exists()).toBe(false)
    })

    it('is visible when open is true', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(0, 10) }
      })
      expect(wrapper.find('.modal-overlay').exists()).toBe(true)
    })
  })

  describe('stable test selectors', () => {
    it('has data-role on modal header for test automation', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(0, 10) }
      })
      expect(wrapper.find('[data-role="annotation-editor"]').exists()).toBe(true)
    })

    it('has data-action on save button for test automation (create mode)', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(0, 10) }
      })
      expect(wrapper.find('[data-action="save-annotation"]').exists()).toBe(true)
    })

    it('has data-action on save button for test automation (edit mode)', () => {
      const wrapper = mount(AnnotationModal, {
        props: {
          open: true,
          span: ezSpan(0, 10),
          annotation: { caption: 'Gene', type: 'gene', span: ezSpan(0, 10), attributes: {} }
        }
      })
      expect(wrapper.find('[data-action="save-annotation"]').exists()).toBe(true)
    })
  })

  describe('ogp:hidden control', () => {
    const hiddenToggle = '[data-role="annotation-hidden-toggle"] input[type="checkbox"]'

    it('renders a hidden checkbox, unchecked by default in create mode', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(0, 10) }
      })
      const cb = wrapper.find(hiddenToggle)
      expect(cb.exists()).toBe(true)
      expect(cb.element.checked).toBe(false)
    })

    it('checks the box when editing an annotation with ogp:hidden true', () => {
      const wrapper = mount(AnnotationModal, {
        props: {
          open: true,
          span: ezSpan(0, 10),
          annotation: { caption: 'Gene', type: 'gene', span: ezSpan(0, 10), attributes: { 'ogp:hidden': true } }
        }
      })
      expect(wrapper.find(hiddenToggle).element.checked).toBe(true)
    })

    it('writes ogp:hidden true into attributes when checked (create)', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(0, 10) }
      })
      await wrapper.find('#annotation-caption').setValue('Test')
      await wrapper.find('#annotation-type').setValue('gene')
      await wrapper.find(hiddenToggle).setValue(true)
      await wrapper.find('.annotation-form').trigger('submit')

      const emitted = wrapper.emitted('create')[0][0]
      expect(emitted.attributes['ogp:hidden']).toBe(true)
    })

    it('omits ogp:hidden entirely when unchecked (edit from hidden -> shown)', async () => {
      const wrapper = mount(AnnotationModal, {
        props: {
          open: true,
          span: ezSpan(0, 10),
          annotation: { caption: 'Gene', type: 'gene', span: ezSpan(0, 10), attributes: { 'ogp:hidden': true } }
        }
      })
      // Uncheck it
      await wrapper.find(hiddenToggle).setValue(false)
      await wrapper.find('.annotation-form').trigger('submit')

      const emitted = wrapper.emitted('update')[0][0]
      expect('ogp:hidden' in emitted.attributes).toBe(false)
    })

    it('treats explicit ogp:hidden false as unchecked (backends that cannot drop keys)', () => {
      const wrapper = mount(AnnotationModal, {
        props: {
          open: true,
          span: ezSpan(0, 10),
          annotation: { caption: 'Gene', type: 'gene', span: ezSpan(0, 10), attributes: { 'ogp:hidden': false } }
        }
      })
      expect(wrapper.find(hiddenToggle).element.checked).toBe(false)
    })

    it('drops a pre-existing ogp:hidden false on submit when left unchecked', async () => {
      const wrapper = mount(AnnotationModal, {
        props: {
          open: true,
          span: ezSpan(0, 10),
          annotation: { caption: 'Gene', type: 'gene', span: ezSpan(0, 10), attributes: { 'ogp:hidden': false } }
        }
      })
      // Submit without touching the (already unchecked) checkbox
      await wrapper.find('.annotation-form').trigger('submit')

      const emitted = wrapper.emitted('update')[0][0]
      expect('ogp:hidden' in emitted.attributes).toBe(false)
    })

    it('does not list ogp:* keys as editable optional fields', () => {
      const wrapper = mount(AnnotationModal, {
        props: {
          open: true,
          span: ezSpan(0, 10),
          annotation: { caption: 'Gene', type: 'gene', span: ezSpan(0, 10), attributes: { 'ogp:hidden': true, note: 'visible' } }
        }
      })
      // The generic optional-field rows are keyed by attribute; ogp:* must not appear
      expect(wrapper.find('#annotation-attr-ogp\\:hidden').exists()).toBe(false)
      // but a normal attribute still shows
      expect(wrapper.find('#annotation-attr-note').exists()).toBe(true)
    })
  })

  describe('form fields', () => {
    it('shows caption input', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(0, 10) }
      })
      expect(wrapper.find('#annotation-caption').exists()).toBe(true)
    })

    it('shows type combo input (dropdown + text entry)', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(0, 10) }
      })
      // Should be an input with datalist for combo behavior
      expect(wrapper.find('#annotation-type').exists()).toBe(true)
      expect(wrapper.find('#annotation-type-list').exists()).toBe(true)
    })
  })

  describe('type combo control', () => {
    it('has standard annotation types in datalist', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(0, 10) }
      })
      const options = wrapper.findAll('#annotation-type-list option')
      const values = options.map(o => o.element.value)

      expect(values).toContain('gene')
      expect(values).toContain('CDS')
      expect(values).toContain('promoter')
      expect(values).toContain('terminator')
      expect(values).toContain('misc_feature')
    })

    it('allows typing custom type directly', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(0, 10) }
      })

      await wrapper.find('#annotation-type').setValue('my_custom_type')

      expect(wrapper.find('#annotation-type').element.value).toBe('my_custom_type')
    })
  })

  describe('ranges section', () => {
    it('shows ranges section', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(0, 10) }
      })
      expect(wrapper.find('.ranges-section').exists()).toBe(true)
    })

    it('shows "Range" label for single range', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(0, 10) }
      })
      expect(wrapper.find('.ranges-section label').text()).toBe('Range')
    })

    it('shows "Ranges" label for multiple ranges', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: new Span([new Range(0, 10), new Range(20, 30)]) }
      })
      expect(wrapper.find('.ranges-section label').text()).toBe('Ranges')
    })

    it('shows one range row for single-range span', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(5, 15) }
      })
      const rows = wrapper.findAll('.range-row')
      expect(rows.length).toBe(1)
    })

    it('shows multiple range rows for multi-range span', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: new Span([new Range(5, 15), new Range(20, 30)]) }
      })
      const rows = wrapper.findAll('.range-row')
      expect(rows.length).toBe(2)
    })

    it('has add range button', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(0, 10) }
      })
      expect(wrapper.find('.btn-add-range').exists()).toBe(true)
    })

    it('adds new range when + button clicked', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(0, 10) }
      })
      expect(wrapper.findAll('.range-row').length).toBe(1)

      await wrapper.find('.btn-add-range').trigger('click')

      expect(wrapper.findAll('.range-row').length).toBe(2)
    })

    it('new range inherits strand from last range', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(0, 10, Orientation.MINUS) } // reverse strand
      })

      await wrapper.find('.btn-add-range').trigger('click')

      const strandSelects = wrapper.findAll('.range-strand')
      expect(strandSelects[1].element.value).toBe('reverse')
    })

    it('does not show range controls when only one range', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(0, 10) }
      })
      expect(wrapper.find('.btn-remove-range').exists()).toBe(false)
      expect(wrapper.find('.btn-move-up').exists()).toBe(false)
      expect(wrapper.find('.btn-move-down').exists()).toBe(false)
    })

    it('shows trash button for each range when multiple ranges', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: new Span([new Range(0, 10), new Range(20, 30)]) }
      })
      const trashButtons = wrapper.findAll('.btn-remove-range')
      expect(trashButtons.length).toBe(2)
    })

    it('removes range when trash clicked', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: new Span([new Range(0, 10), new Range(20, 30)]) }
      })
      expect(wrapper.findAll('.range-row').length).toBe(2)

      await wrapper.findAll('.btn-remove-range')[0].trigger('click')

      expect(wrapper.findAll('.range-row').length).toBe(1)
      // Second range should remain (GenBank coords: fenced 20 → GenBank 21)
      expect(wrapper.find('.range-start').element.value).toBe('21')
    })

    it('shows up/down buttons for ranges when multiple ranges', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: new Span([new Range(0, 10), new Range(20, 30)]) }
      })
      // First range: no up, has down
      const firstRow = wrapper.findAll('.range-row')[0]
      expect(firstRow.find('.btn-move-up').exists()).toBe(false)
      expect(firstRow.find('.btn-move-down').exists()).toBe(true)

      // Last range: has up, no down
      const lastRow = wrapper.findAll('.range-row')[1]
      expect(lastRow.find('.btn-move-up').exists()).toBe(true)
      expect(lastRow.find('.btn-move-down').exists()).toBe(false)
    })

    it('moves range up when up button clicked', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: new Span([new Range(0, 10), new Range(20, 30)]) }
      })

      // Click up on second range
      await wrapper.findAll('.range-row')[1].find('.btn-move-up').trigger('click')

      // Now first range should be 20..30 (GenBank coords: fenced 20 → 21, fenced 0 → 1)
      expect(wrapper.findAll('.range-start')[0].element.value).toBe('21')
      expect(wrapper.findAll('.range-start')[1].element.value).toBe('1')
    })

    it('moves range down when down button clicked', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: new Span([new Range(0, 10), new Range(20, 30)]) }
      })

      // Click down on first range
      await wrapper.findAll('.range-row')[0].find('.btn-move-down').trigger('click')

      // Now first range should be 20..30 (GenBank coords: fenced 20 → 21, fenced 0 → 1)
      expect(wrapper.findAll('.range-start')[0].element.value).toBe('21')
      expect(wrapper.findAll('.range-start')[1].element.value).toBe('1')
    })

    it('each range row has start, end, and strand controls', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(0, 10) }
      })
      const row = wrapper.find('.range-row')

      expect(row.find('.range-start').exists()).toBe(true)
      expect(row.find('.range-end').exists()).toBe(true)
      expect(row.find('.range-strand').exists()).toBe(true)
    })

    it('pre-fills range values from span prop', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(100, 200) }
      })
      // Start is displayed in GenBank (1-based): fenced 100 → GenBank 101
      // End stays the same (fenced end = GenBank end due to half-open vs closed intervals)
      expect(wrapper.find('.range-start').element.value).toBe('101')
      expect(wrapper.find('.range-end').element.value).toBe('200')
    })

    it('sets max attribute on range inputs from sequenceLength prop', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(0, 10), sequenceLength: 500 }
      })
      expect(wrapper.find('.range-end').element.max).toBe('500')
    })

    it('sets end min to GenBank start', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(50, 100) }
      })
      // GenBank start is 51 (fenced 50 + 1), min for end is GenBank start
      expect(wrapper.find('.range-end').element.min).toBe('51')
    })

    it('sets start max to end', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(50, 100) }
      })
      // Max for GenBank start equals the fenced end (since GenBank start can equal fenced end for 1-base ranges)
      expect(wrapper.find('.range-start').element.max).toBe('100')
    })

    it('strand dropdown has Forward, Reverse, None options', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(0, 10) }
      })
      const options = wrapper.findAll('.range-strand option')
      const values = options.map(o => o.element.value)

      expect(values).toContain('forward')
      expect(values).toContain('reverse')
      expect(values).toContain('none')
    })

    it('pre-fills forward strand for plain span', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(0, 10) }
      })
      expect(wrapper.find('.range-strand').element.value).toBe('forward')
    })

    it('pre-fills reverse strand from parentheses span', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(0, 10, Orientation.MINUS) }
      })
      expect(wrapper.find('.range-strand').element.value).toBe('reverse')
    })

    it('pre-fills none strand from bracket span', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: new Span([new Range(0, 10, Orientation.NONE)]) }
      })
      expect(wrapper.find('.range-strand').element.value).toBe('none')
    })
  })

  describe('indefinite locations', () => {
    it('shows indefinite checkboxes for each range', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(0, 10) }
      })
      const checkboxes = wrapper.findAll('.indefinite-checkbox')
      expect(checkboxes.length).toBe(2) // start and end
    })

    it('indefinite checkboxes are unchecked by default', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(0, 10) }
      })
      const checkboxes = wrapper.findAll('.indefinite-checkbox input[type="checkbox"]')
      expect(checkboxes[0].element.checked).toBe(false)
      expect(checkboxes[1].element.checked).toBe(false)
    })

    it('pre-fills start indefinite from span with < marker', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(0, 10, Orientation.PLUS, true, false) }
      })
      const checkboxes = wrapper.findAll('.indefinite-checkbox input[type="checkbox"]')
      expect(checkboxes[0].element.checked).toBe(true)
      expect(checkboxes[1].element.checked).toBe(false)
    })

    it('pre-fills end indefinite from span with > marker', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(0, 10, Orientation.PLUS, false, true) }
      })
      const checkboxes = wrapper.findAll('.indefinite-checkbox input[type="checkbox"]')
      expect(checkboxes[0].element.checked).toBe(false)
      expect(checkboxes[1].element.checked).toBe(true)
    })

    it('pre-fills both indefinite from span with both markers', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(0, 10, Orientation.PLUS, true, true) }
      })
      const checkboxes = wrapper.findAll('.indefinite-checkbox input[type="checkbox"]')
      expect(checkboxes[0].element.checked).toBe(true)
      expect(checkboxes[1].element.checked).toBe(true)
    })

    it('emits span with < marker for start indefinite', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(0, 10) }
      })

      await wrapper.find('#annotation-caption').setValue('Test')
      await wrapper.find('#annotation-type').setValue('gene')

      // Check start indefinite
      const checkboxes = wrapper.findAll('.indefinite-checkbox input[type="checkbox"]')
      await checkboxes[0].setValue(true)

      await wrapper.find('.annotation-form').trigger('submit')

      const emitted = wrapper.emitted('create')[0][0]
      expect(emitted.span.toJSON()).toBe('<0..10')
    })

    it('emits span with > marker for end indefinite', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(0, 10) }
      })

      await wrapper.find('#annotation-caption').setValue('Test')
      await wrapper.find('#annotation-type').setValue('gene')

      // Check end indefinite
      const checkboxes = wrapper.findAll('.indefinite-checkbox input[type="checkbox"]')
      await checkboxes[1].setValue(true)

      await wrapper.find('.annotation-form').trigger('submit')

      const emitted = wrapper.emitted('create')[0][0]
      expect(emitted.span.toJSON()).toBe('0..>10')
    })

    it('emits span with both markers for both indefinite', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(0, 10) }
      })

      await wrapper.find('#annotation-caption').setValue('Test')
      await wrapper.find('#annotation-type').setValue('gene')

      // Check both indefinite
      const checkboxes = wrapper.findAll('.indefinite-checkbox input[type="checkbox"]')
      await checkboxes[0].setValue(true)
      await checkboxes[1].setValue(true)

      await wrapper.find('.annotation-form').trigger('submit')

      const emitted = wrapper.emitted('create')[0][0]
      expect(emitted.span.toJSON()).toBe('<0..>10')
    })

    it('works with reverse strand and indefinite', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(0, 10, Orientation.MINUS, true, true) }
      })

      await wrapper.find('#annotation-caption').setValue('Test')
      await wrapper.find('#annotation-type').setValue('gene')
      await wrapper.find('.annotation-form').trigger('submit')

      const emitted = wrapper.emitted('create')[0][0]
      expect(emitted.span.toJSON()).toBe('(<0..>10)')
    })

    it('works with multi-range and indefinite', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: new Span([new Range(0, 10, Orientation.PLUS, true, false), new Range(20, 30, Orientation.PLUS, false, true)]) }
      })

      await wrapper.find('#annotation-caption').setValue('Test')
      await wrapper.find('#annotation-type').setValue('gene')
      await wrapper.find('.annotation-form').trigger('submit')

      const emitted = wrapper.emitted('create')[0][0]
      expect(emitted.span.toJSON()).toBe('<0..10 + 20..>30')
    })

    it('newly added range has indefinite unchecked', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(0, 10, Orientation.PLUS, true, true) }
      })

      await wrapper.find('.btn-add-range').trigger('click')

      // Get all checkboxes (should be 4 now: 2 for first range, 2 for second)
      const checkboxes = wrapper.findAll('.indefinite-checkbox input[type="checkbox"]')
      expect(checkboxes.length).toBe(4)
      // New range checkboxes should be unchecked
      expect(checkboxes[2].element.checked).toBe(false)
      expect(checkboxes[3].element.checked).toBe(false)
    })
  })

  describe('optional fields', () => {
    it('shows add field dropdown', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(0, 10) }
      })
      expect(wrapper.find('.add-field-select').exists()).toBe(true)
    })

    it('adds optional field when selected from dropdown', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(0, 10) }
      })

      await wrapper.find('.add-field-select').setValue('gene')

      expect(wrapper.find('#annotation-attr-gene').exists()).toBe(true)
    })

    it('removes optional field when trash clicked', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(0, 10) }
      })

      await wrapper.find('.add-field-select').setValue('product')
      expect(wrapper.find('#annotation-attr-product').exists()).toBe(true)

      await wrapper.find('.btn-remove-field').trigger('click')

      expect(wrapper.find('#annotation-attr-product').exists()).toBe(false)
    })

    it('shows custom qualifier input', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(0, 10) }
      })
      expect(wrapper.find('.custom-field-input').exists()).toBe(true)
    })

    it('shows dropdown when custom input is empty', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(0, 10) }
      })

      expect(wrapper.find('.add-field-select').exists()).toBe(true)
      expect(wrapper.find('.add-field-button').exists()).toBe(false)
    })

    it('shows button when custom input has text', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(0, 10) }
      })

      await wrapper.find('.custom-field-input').setValue('my_qualifier')

      expect(wrapper.find('.add-field-select').exists()).toBe(false)
      expect(wrapper.find('.add-field-button').exists()).toBe(true)
      expect(wrapper.find('.add-field-button').text()).toBe('Add field:')
    })

    it('adds custom qualifier when button clicked', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(0, 10) }
      })

      await wrapper.find('.custom-field-input').setValue('my_qualifier')
      await wrapper.find('.add-field-button').trigger('click')

      expect(wrapper.find('#annotation-attr-my_qualifier').exists()).toBe(true)
    })

    it('clears custom qualifier input after adding', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(0, 10) }
      })

      await wrapper.find('.custom-field-input').setValue('my_qualifier')
      await wrapper.find('.add-field-button').trigger('click')

      expect(wrapper.find('.custom-field-input').element.value).toBe('')
    })

    it('includes custom qualifier in emitted attributes', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(0, 10) }
      })

      // Fill required fields
      await wrapper.find('#annotation-caption').setValue('Test')
      await wrapper.find('#annotation-type').setValue('gene')

      // Add custom qualifier
      await wrapper.find('.custom-field-input').setValue('custom_field')
      await wrapper.find('.add-field-button').trigger('click')

      // Wait for DOM to update
      await wrapper.vm.$nextTick()

      // Verify the field was added
      expect(wrapper.find('#annotation-attr-custom_field').exists()).toBe(true)

      await wrapper.find('#annotation-attr-custom_field').setValue('custom value')

      // Verify form is valid (button should be enabled)
      expect(wrapper.find('.btn-create').element.disabled).toBe(false)

      // Submit
      await wrapper.find('form').trigger('submit')

      const emitted = wrapper.emitted('create')
      expect(emitted).toHaveLength(1)
      expect(emitted[0][0].attributes).toEqual({ custom_field: 'custom value' })
    })

    it('does not show add button when custom input is empty', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(0, 10) }
      })

      // With empty input, button should not exist (dropdown shows instead)
      expect(wrapper.find('.add-field-button').exists()).toBe(false)
      expect(wrapper.find('.add-field-select').exists()).toBe(true)
    })
  })

  describe('form validation', () => {
    it('Create button is disabled when caption is empty', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(0, 10) }
      })
      expect(wrapper.find('.btn-create').element.disabled).toBe(true)
    })

    it('Create button is disabled when type is empty', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(0, 10) }
      })

      await wrapper.find('#annotation-caption').setValue('GFP')
      // Type is still empty

      expect(wrapper.find('.btn-create').element.disabled).toBe(true)
    })

    it('Create button is enabled when caption and type are filled', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(0, 10) }
      })

      await wrapper.find('#annotation-caption').setValue('GFP')
      await wrapper.find('#annotation-type').setValue('gene')

      expect(wrapper.find('.btn-create').element.disabled).toBe(false)
    })

    it('Create button works with custom type', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(0, 10) }
      })

      await wrapper.find('#annotation-caption').setValue('GFP')
      await wrapper.find('#annotation-type').setValue('my_custom_feature')

      expect(wrapper.find('.btn-create').element.disabled).toBe(false)
    })

    it('Create button is disabled when any range is incomplete', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(0, 10) }
      })

      await wrapper.find('#annotation-caption').setValue('GFP')
      await wrapper.find('#annotation-type').setValue('gene')

      // Add another range (which will be empty)
      await wrapper.find('.btn-add-range').trigger('click')

      expect(wrapper.find('.btn-create').element.disabled).toBe(true)
    })

    it('Create button is enabled when all ranges are complete', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(0, 10) }
      })

      await wrapper.find('#annotation-caption').setValue('GFP')
      await wrapper.find('#annotation-type').setValue('gene')

      // Add another range and fill it in
      await wrapper.find('.btn-add-range').trigger('click')
      const startInputs = wrapper.findAll('.range-start')
      const endInputs = wrapper.findAll('.range-end')
      await startInputs[1].setValue('20')
      await endInputs[1].setValue('30')

      expect(wrapper.find('.btn-create').element.disabled).toBe(false)
    })

    it('Create button is disabled when ranges overlap', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(0, 20) }
      })

      await wrapper.find('#annotation-caption').setValue('GFP')
      await wrapper.find('#annotation-type').setValue('gene')

      // Add overlapping range (10..30 overlaps with 0..20)
      await wrapper.find('.btn-add-range').trigger('click')
      const startInputs = wrapper.findAll('.range-start')
      const endInputs = wrapper.findAll('.range-end')
      await startInputs[1].setValue('10')
      await endInputs[1].setValue('30')

      expect(wrapper.find('.btn-create').element.disabled).toBe(true)
    })

    it('shows overlap error on second overlapping range', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(0, 20) }
      })

      // Add overlapping range
      await wrapper.find('.btn-add-range').trigger('click')
      const startInputs = wrapper.findAll('.range-start')
      const endInputs = wrapper.findAll('.range-end')
      await startInputs[1].setValue('10')
      await endInputs[1].setValue('30')

      const errorMessages = wrapper.findAll('.range-overlap-error')
      expect(errorMessages.length).toBe(1)
      // Error should be on the second range row
      const secondRow = wrapper.findAll('.range-row')[1]
      expect(secondRow.find('.range-overlap-error').exists()).toBe(true)
    })

    it('no overlap error when ranges do not overlap', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(0, 10) }
      })

      // Add non-overlapping range
      await wrapper.find('.btn-add-range').trigger('click')
      const startInputs = wrapper.findAll('.range-start')
      const endInputs = wrapper.findAll('.range-end')
      await startInputs[1].setValue('20')
      await endInputs[1].setValue('30')

      expect(wrapper.find('.range-overlap-error').exists()).toBe(false)
    })

    it('adjacent ranges do not count as overlapping', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(0, 10) }
      })

      await wrapper.find('#annotation-caption').setValue('GFP')
      await wrapper.find('#annotation-type').setValue('gene')

      // Add adjacent range (10..20 is adjacent to 0..10, not overlapping)
      await wrapper.find('.btn-add-range').trigger('click')
      const startInputs = wrapper.findAll('.range-start')
      const endInputs = wrapper.findAll('.range-end')
      await startInputs[1].setValue('10')
      await endInputs[1].setValue('20')

      expect(wrapper.find('.range-overlap-error').exists()).toBe(false)
      expect(wrapper.find('.btn-create').element.disabled).toBe(false)
    })
  })

  describe('create action', () => {
    it('emits create event with annotation data including span object', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(5, 15) }
      })

      await wrapper.find('#annotation-caption').setValue('GFP')
      await wrapper.find('#annotation-type').setValue('gene')
      await wrapper.find('.annotation-form').trigger('submit')

      expect(wrapper.emitted('create')).toBeTruthy()
      const emitted = wrapper.emitted('create')[0][0]
      expect(emitted.caption).toBe('GFP')
      expect(emitted.type).toBe('gene')
      expect(emitted.span).toBeInstanceOf(Span)
      expect(emitted.span.toJSON()).toBe('5..15')
    })

    it('emits span with parentheses for reverse strand', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(0, 10) }
      })

      await wrapper.find('#annotation-caption').setValue('Promoter')
      await wrapper.find('#annotation-type').setValue('promoter')
      await wrapper.find('.range-strand').setValue('reverse')
      await wrapper.find('.annotation-form').trigger('submit')

      const emitted = wrapper.emitted('create')[0][0]
      expect(emitted.span.toJSON()).toBe('(0..10)')
    })

    it('emits span with brackets for unoriented', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(0, 10) }
      })

      await wrapper.find('#annotation-caption').setValue('Feature')
      await wrapper.find('#annotation-type').setValue('misc_feature')
      await wrapper.find('.range-strand').setValue('none')
      await wrapper.find('.annotation-form').trigger('submit')

      const emitted = wrapper.emitted('create')[0][0]
      expect(emitted.span.toJSON()).toBe('[0..10]')
    })

    it('updates span when range inputs are changed', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(0, 10) }
      })

      // Input is GenBank (1-based): 21 converts to fenced 20
      await wrapper.find('.range-start').setValue('21')
      await wrapper.find('.range-end').setValue('30')
      await wrapper.find('#annotation-caption').setValue('Test')
      await wrapper.find('#annotation-type').setValue('gene')
      await wrapper.find('.annotation-form').trigger('submit')

      const emitted = wrapper.emitted('create')[0][0]
      // Output span is fenced coordinates
      expect(emitted.span.toJSON()).toBe('20..30')
    })

    it('builds multi-range span correctly', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: new Span([new Range(5, 10), new Range(20, 30)]) }
      })

      await wrapper.find('#annotation-caption').setValue('Split Gene')
      await wrapper.find('#annotation-type').setValue('gene')
      await wrapper.find('.annotation-form').trigger('submit')

      const emitted = wrapper.emitted('create')[0][0]
      expect(emitted.span.toJSON()).toBe('5..10 + 20..30')
    })

    it('includes optional attributes when filled', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(0, 10) }
      })

      await wrapper.find('#annotation-caption').setValue('lacZ')
      await wrapper.find('#annotation-type').setValue('gene')
      await wrapper.find('.add-field-select').setValue('product')
      await wrapper.find('#annotation-attr-product').setValue('beta-galactosidase')
      await wrapper.find('.annotation-form').trigger('submit')

      const emitted = wrapper.emitted('create')[0][0]
      expect(emitted.attributes.product).toBe('beta-galactosidase')
    })

    it('emits close after create', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(0, 10) }
      })

      await wrapper.find('#annotation-caption').setValue('Test')
      await wrapper.find('#annotation-type').setValue('gene')
      await wrapper.find('.annotation-form').trigger('submit')

      expect(wrapper.emitted('close')).toBeTruthy()
    })
  })

  describe('close behavior', () => {
    it('emits close when X clicked', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(0, 10) }
      })

      await wrapper.find('.modal-close').trigger('click')

      expect(wrapper.emitted('close')).toBeTruthy()
    })

    it('emits close when Cancel clicked', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(0, 10) }
      })

      await wrapper.find('.btn-cancel').trigger('click')

      expect(wrapper.emitted('close')).toBeTruthy()
    })

    it('emits close when overlay clicked', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(0, 10) }
      })

      await wrapper.find('.modal-overlay').trigger('click')

      expect(wrapper.emitted('close')).toBeTruthy()
    })

    it('does not close when modal content clicked', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(0, 10) }
      })

      await wrapper.find('.modal-content').trigger('click')

      expect(wrapper.emitted('close')).toBeFalsy()
    })
  })

  describe('readonly mode', () => {
    it('does not render in readonly mode', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: ezSpan(0, 10), readonly: true }
      })

      // Modal should not render at all in readonly mode
      expect(wrapper.find('.modal-overlay').exists()).toBe(false)
    })
  })

  describe('additionalFields prop', () => {
    const MockEditor = {
      props: ['modelValue', 'annotation'],
      emits: ['update:modelValue'],
      template: '<input class="mock-editor" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
    }

    const MockDisplay = {
      props: ['value'],
      template: '<span class="mock-display">{{ value }}</span>'
    }

    const testField = {
      key: 'test_field',
      label: 'Test Field',
      forTypes: ['primer'],
      editor: MockEditor,
      display: MockDisplay
    }

    it('shows additional field editor when annotation type matches', async () => {
      const wrapper = mount(AnnotationModal, {
        props: {
          open: true,
          span: ezSpan(0, 20),
          additionalFields: [testField]
        }
      })

      // Select primer type
      await wrapper.find('#annotation-type').setValue('primer')
      await wrapper.vm.$nextTick()

      // Should show the additional field editor
      expect(wrapper.find('.mock-editor').exists()).toBe(true)
    })

    it('does not show additional field when annotation type does not match', async () => {
      const wrapper = mount(AnnotationModal, {
        props: {
          open: true,
          span: ezSpan(0, 20),
          additionalFields: [testField]
        }
      })

      // Select gene type (not in forTypes)
      await wrapper.find('#annotation-type').setValue('gene')
      await wrapper.vm.$nextTick()

      // Should not show the additional field editor
      expect(wrapper.find('.mock-editor').exists()).toBe(false)
    })

    it('passes annotation context to editor component', async () => {
      const wrapper = mount(AnnotationModal, {
        props: {
          open: true,
          span: ezSpan(0, 25),  // 25 bp annotation
          additionalFields: [testField]
        }
      })

      await wrapper.find('#annotation-type').setValue('primer')
      await wrapper.vm.$nextTick()

      // Find the editor component and check its props
      const editor = wrapper.findComponent(MockEditor)
      expect(editor.exists()).toBe(true)
      expect(editor.props('annotation')).toBeDefined()
      expect(editor.props('annotation').length).toBe(25)
      expect(editor.props('annotation').type).toBe('primer')
    })

    it('includes additional field value in emitted attributes', async () => {
      const wrapper = mount(AnnotationModal, {
        props: {
          open: true,
          span: ezSpan(0, 20),
          additionalFields: [testField]
        }
      })

      // Fill required fields
      await wrapper.find('#annotation-caption').setValue('Test Primer')
      await wrapper.find('#annotation-type').setValue('primer')
      await wrapper.vm.$nextTick()

      // Set additional field value
      await wrapper.find('.mock-editor').setValue('test_value')
      await wrapper.vm.$nextTick()

      // Submit
      await wrapper.find('form').trigger('submit')

      const emitted = wrapper.emitted('create')
      expect(emitted).toHaveLength(1)
      expect(emitted[0][0].attributes.test_field).toBe('test_value')
    })

    it('displays field label', async () => {
      const wrapper = mount(AnnotationModal, {
        props: {
          open: true,
          span: ezSpan(0, 20),
          additionalFields: [testField]
        }
      })

      await wrapper.find('#annotation-type').setValue('primer')
      await wrapper.vm.$nextTick()

      expect(wrapper.text()).toContain('Test Field')
    })

    it('supports multiple additional fields', async () => {
      const secondField = {
        key: 'second_field',
        label: 'Second Field',
        forTypes: ['primer'],
        editor: MockEditor,
        display: MockDisplay
      }

      const wrapper = mount(AnnotationModal, {
        props: {
          open: true,
          span: ezSpan(0, 20),
          additionalFields: [testField, secondField]
        }
      })

      await wrapper.find('#annotation-type').setValue('primer')
      await wrapper.vm.$nextTick()

      expect(wrapper.findAll('.mock-editor').length).toBe(2)
    })

    it('hides additional field when type changes away from matching type', async () => {
      const wrapper = mount(AnnotationModal, {
        props: {
          open: true,
          span: ezSpan(0, 20),
          additionalFields: [testField]
        }
      })

      // Select primer type - field should appear
      await wrapper.find('#annotation-type').setValue('primer')
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.mock-editor').exists()).toBe(true)

      // Change to gene type - field should disappear
      await wrapper.find('#annotation-type').setValue('gene')
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.mock-editor').exists()).toBe(false)
    })

    it('pre-populates additional field value when editing existing annotation', async () => {
      const existingAnnotation = {
        caption: 'Test Primer',
        type: 'primer',
        span: ezSpan(0, 20),
        attributes: { test_field: 'existing_value' }
      }

      const wrapper = mount(AnnotationModal, {
        props: {
          open: true,
          span: ezSpan(0, 20),
          annotation: existingAnnotation,
          additionalFields: [testField]
        }
      })

      await wrapper.vm.$nextTick()

      // Editor should have the existing value
      const editor = wrapper.findComponent(MockEditor)
      expect(editor.exists()).toBe(true)
      expect(editor.props('modelValue')).toBe('existing_value')
    })

    it('does not include empty additional field values in emitted attributes', async () => {
      const wrapper = mount(AnnotationModal, {
        props: {
          open: true,
          span: ezSpan(0, 20),
          additionalFields: [testField]
        }
      })

      // Fill required fields
      await wrapper.find('#annotation-caption').setValue('Test Primer')
      await wrapper.find('#annotation-type').setValue('primer')
      await wrapper.vm.$nextTick()

      // Leave additional field empty (don't set any value)

      // Submit
      await wrapper.find('form').trigger('submit')

      const emitted = wrapper.emitted('create')
      expect(emitted).toHaveLength(1)
      // test_field should NOT be in attributes since it's empty
      expect(emitted[0][0].attributes).toEqual({})
    })

    it('clears additional field values when type changes', async () => {
      const wrapper = mount(AnnotationModal, {
        props: {
          open: true,
          span: ezSpan(0, 20),
          additionalFields: [testField]
        }
      })

      // Fill required fields and additional field
      await wrapper.find('#annotation-caption').setValue('Test')
      await wrapper.find('#annotation-type').setValue('primer')
      await wrapper.vm.$nextTick()
      await wrapper.find('.mock-editor').setValue('some_value')
      await wrapper.vm.$nextTick()

      // Change type to gene (no additional fields)
      await wrapper.find('#annotation-type').setValue('gene')
      await wrapper.vm.$nextTick()

      // Submit
      await wrapper.find('form').trigger('submit')

      const emitted = wrapper.emitted('create')
      expect(emitted).toHaveLength(1)
      // test_field should NOT be in attributes since type changed
      expect(emitted[0][0].attributes).toEqual({})
    })
  })

  describe('additionalFields - no duplicate display', () => {
    const MockEditor = {
      props: ['modelValue', 'annotation'],
      emits: ['update:modelValue'],
      template: '<input class="mock-editor" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
    }

    const MockDisplay = {
      props: ['value'],
      template: '<span class="mock-display">{{ value }}</span>'
    }

    const testField = {
      key: 'test_field',
      label: 'Test Field',
      forTypes: ['primer'],
      editor: MockEditor,
      display: MockDisplay
    }

    it('does not show attribute in visibleFields when handled by additionalField extension', async () => {
      // Bug: When editing annotation with test_field attribute, it shows up TWICE:
      // 1. In the generic attributes list (visibleFields)
      // 2. In the additionalFields section (extension editor)
      const existingAnnotation = {
        caption: 'Test Primer',
        type: 'primer',
        span: ezSpan(0, 20),
        attributes: { test_field: 'existing_value' }
      }

      const wrapper = mount(AnnotationModal, {
        props: {
          open: true,
          span: ezSpan(0, 20),
          annotation: existingAnnotation,
          additionalFields: [testField]
        }
      })

      await wrapper.vm.$nextTick()

      // Extension editor should show
      expect(wrapper.find('.mock-editor').exists()).toBe(true)

      // But the generic attribute field should NOT show (no duplicate)
      expect(wrapper.find('#annotation-attr-test_field').exists()).toBe(false)
    })

    it('filters extension keys from visibleFields in edit mode', async () => {
      const existingAnnotation = {
        caption: 'Test Primer',
        type: 'primer',
        span: ezSpan(0, 20),
        attributes: { test_field: 'value1', note: 'some note' }
      }

      const wrapper = mount(AnnotationModal, {
        props: {
          open: true,
          span: ezSpan(0, 20),
          annotation: existingAnnotation,
          additionalFields: [testField]
        }
      })

      await wrapper.vm.$nextTick()

      // note should show as regular attribute
      expect(wrapper.find('#annotation-attr-note').exists()).toBe(true)

      // test_field should NOT show as regular attribute (extension handles it)
      expect(wrapper.find('#annotation-attr-test_field').exists()).toBe(false)

      // Extension editor should show test_field
      expect(wrapper.find('.mock-editor').exists()).toBe(true)
    })
  })

  describe('additionalFields - clear/remove capability', () => {
    const MockEditor = {
      props: ['modelValue', 'annotation'],
      emits: ['update:modelValue'],
      template: '<input class="mock-editor" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
    }

    const MockDisplay = {
      props: ['value'],
      template: '<span class="mock-display">{{ value }}</span>'
    }

    const testField = {
      key: 'test_field',
      label: 'Test Field',
      forTypes: ['primer'],
      editor: MockEditor,
      display: MockDisplay
    }

    it('shows remove button for additional field when it has a value', async () => {
      const existingAnnotation = {
        caption: 'Test Primer',
        type: 'primer',
        span: ezSpan(0, 20),
        attributes: { test_field: 'existing_value' }
      }

      const wrapper = mount(AnnotationModal, {
        props: {
          open: true,
          span: ezSpan(0, 20),
          annotation: existingAnnotation,
          additionalFields: [testField]
        }
      })

      await wrapper.vm.$nextTick()

      // Should have a remove button for the additional field
      const additionalFieldGroup = wrapper.find('#annotation-additional-test_field').element.closest('.form-group')
      expect(additionalFieldGroup.querySelector('.btn-remove-field')).toBeTruthy()
    })

    it('clears additional field value when remove button clicked', async () => {
      const existingAnnotation = {
        caption: 'Test Primer',
        type: 'primer',
        span: ezSpan(0, 20),
        attributes: { test_field: 'existing_value' }
      }

      const wrapper = mount(AnnotationModal, {
        props: {
          open: true,
          span: ezSpan(0, 20),
          annotation: existingAnnotation,
          additionalFields: [testField]
        }
      })

      await wrapper.vm.$nextTick()

      // Find and click remove button for additional field
      const formGroups = wrapper.findAll('.form-group')
      const additionalFieldGroup = formGroups.find(g => g.find('.mock-editor').exists())
      await additionalFieldGroup.find('.btn-remove-field').trigger('click')
      await wrapper.vm.$nextTick()

      // Submit and verify field is not included
      await wrapper.find('form').trigger('submit')

      const emitted = wrapper.emitted('update')
      expect(emitted).toHaveLength(1)
      expect(emitted[0][0].attributes.test_field).toBeUndefined()
    })
  })

  describe('PrimerBindExtension integration', () => {
    it('shows primer_bind field with number input for primer type', async () => {
      const wrapper = mount(AnnotationModal, {
        props: {
          open: true,
          span: ezSpan(0, 20),
          additionalFields: [PrimerBindExtension]
        }
      })

      await wrapper.find('#annotation-type').setValue('primer')
      await wrapper.vm.$nextTick()

      // Should have number input
      const input = wrapper.find('input[type="number"].primer-bind-editor')
      expect(input.exists()).toBe(true)
    })

    it('sets max attribute on primer_bind input to annotation length - 1', async () => {
      const wrapper = mount(AnnotationModal, {
        props: {
          open: true,
          span: ezSpan(0, 25),  // 25 bp
          additionalFields: [PrimerBindExtension]
        }
      })

      await wrapper.find('#annotation-type').setValue('primer')
      await wrapper.vm.$nextTick()

      const input = wrapper.find('input[type="number"].primer-bind-editor')
      expect(input.element.max).toBe('24')  // length - 1 (cannot be full length)
    })

    it('saves primer_bind as integer in attributes', async () => {
      const wrapper = mount(AnnotationModal, {
        props: {
          open: true,
          span: ezSpan(0, 20),
          additionalFields: [PrimerBindExtension]
        }
      })

      await wrapper.find('#annotation-caption').setValue('Forward Primer')
      await wrapper.find('#annotation-type').setValue('primer')
      await wrapper.vm.$nextTick()

      await wrapper.find('.primer-bind-editor').setValue('15')
      await wrapper.vm.$nextTick()

      await wrapper.find('form').trigger('submit')

      const emitted = wrapper.emitted('create')
      expect(emitted).toHaveLength(1)
      expect(emitted[0][0].attributes.primer_bind).toBe(15)
    })

    it('pre-populates primer_bind when editing existing annotation', async () => {
      const existingAnnotation = {
        caption: 'Forward Primer',
        type: 'primer',
        span: ezSpan(0, 20),
        attributes: { primer_bind: 18 }
      }

      const wrapper = mount(AnnotationModal, {
        props: {
          open: true,
          span: ezSpan(0, 20),
          annotation: existingAnnotation,
          additionalFields: [PrimerBindExtension]
        }
      })

      await wrapper.vm.$nextTick()

      const input = wrapper.find('.primer-bind-editor')
      expect(input.exists()).toBe(true)
      expect(input.element.value).toBe('18')
    })

    it('preserves primer_bind when annotation is extended', async () => {
      // primer_bind is just a plain parameter - extending the annotation should NOT change it
      const existingAnnotation = {
        caption: 'Forward Primer',
        type: 'primer',
        span: ezSpan(0, 20, Orientation.PLUS),
        attributes: { primer_bind: 15 }
      }

      const wrapper = mount(AnnotationModal, {
        props: {
          open: true,
          span: ezSpan(0, 20, Orientation.PLUS),
          annotation: existingAnnotation,
          additionalFields: [PrimerBindExtension]
        }
      })

      await wrapper.vm.$nextTick()

      // Change the end position from 20 to 25 (extending the annotation)
      const endInput = wrapper.find('.range-end')
      await endInput.setValue('25')
      await wrapper.vm.$nextTick()

      // Submit the form
      await wrapper.find('form').trigger('submit')

      const emitted = wrapper.emitted('update')
      expect(emitted).toHaveLength(1)
      // primer_bind should remain 15, not be recalculated
      expect(emitted[0][0].attributes.primer_bind).toBe(15)
    })

    it('deletes primer_bind when annotation shrinks to length <= primer_bind', async () => {
      // primer_bind=15, annotation length=20
      // If annotation shrinks to length 15 or less, primer_bind is invalid and should be deleted
      const existingAnnotation = {
        caption: 'Forward Primer',
        type: 'primer',
        span: ezSpan(0, 20, Orientation.PLUS),
        attributes: { primer_bind: 15 }
      }

      const wrapper = mount(AnnotationModal, {
        props: {
          open: true,
          span: ezSpan(0, 20, Orientation.PLUS),
          annotation: existingAnnotation,
          additionalFields: [PrimerBindExtension]
        }
      })

      await wrapper.vm.$nextTick()

      // Shrink annotation to length 15 (primer_bind must be < length, so this is invalid)
      const endInput = wrapper.find('.range-end')
      await endInput.setValue('15')
      await wrapper.vm.$nextTick()

      // Submit the form
      await wrapper.find('form').trigger('submit')

      const emitted = wrapper.emitted('update')
      expect(emitted).toHaveLength(1)
      // primer_bind should be deleted since length (15) is not > primer_bind (15)
      expect(emitted[0][0].attributes.primer_bind).toBeUndefined()
    })

    it('preserves primer_bind when annotation shrinks but length > primer_bind', async () => {
      // primer_bind=10, annotation length=20
      // If annotation shrinks to length 15, primer_bind is still valid (15 > 10)
      const existingAnnotation = {
        caption: 'Forward Primer',
        type: 'primer',
        span: ezSpan(0, 20, Orientation.PLUS),
        attributes: { primer_bind: 10 }
      }

      const wrapper = mount(AnnotationModal, {
        props: {
          open: true,
          span: ezSpan(0, 20, Orientation.PLUS),
          annotation: existingAnnotation,
          additionalFields: [PrimerBindExtension]
        }
      })

      await wrapper.vm.$nextTick()

      // Shrink annotation to length 15 (primer_bind=10 is still valid since 15 > 10)
      const endInput = wrapper.find('.range-end')
      await endInput.setValue('15')
      await wrapper.vm.$nextTick()

      // Submit the form
      await wrapper.find('form').trigger('submit')

      const emitted = wrapper.emitted('update')
      expect(emitted).toHaveLength(1)
      // primer_bind should remain 10
      expect(emitted[0][0].attributes.primer_bind).toBe(10)
    })

    it('deletes primer_bind when adding a second segment', async () => {
      // primer_bind only makes sense for single-range annotations
      const existingAnnotation = {
        caption: 'Forward Primer',
        type: 'primer',
        span: ezSpan(0, 20, Orientation.PLUS),
        attributes: { primer_bind: 10 }
      }

      const wrapper = mount(AnnotationModal, {
        props: {
          open: true,
          span: ezSpan(0, 20, Orientation.PLUS),
          annotation: existingAnnotation,
          additionalFields: [PrimerBindExtension]
        }
      })

      await wrapper.vm.$nextTick()

      // Add a second range
      await wrapper.find('.btn-add-range').trigger('click')
      await wrapper.vm.$nextTick()

      // Fill in the second range
      const startInputs = wrapper.findAll('.range-start')
      const endInputs = wrapper.findAll('.range-end')
      await startInputs[1].setValue('30')
      await endInputs[1].setValue('40')
      await wrapper.vm.$nextTick()

      // Submit the form
      await wrapper.find('form').trigger('submit')

      const emitted = wrapper.emitted('update')
      expect(emitted).toHaveLength(1)
      // primer_bind should be deleted since we now have multiple ranges
      expect(emitted[0][0].attributes.primer_bind).toBeUndefined()
    })

    it('preserves user-edited primer_bind value when span is unchanged', async () => {
      // BUG: When editing an existing primer annotation, if user changes primer_bind
      // but not the span, the recalculation logic should NOT overwrite the user's input.
      // The current code recalculates primer_bind based on keeping the divider position,
      // but this overwrites explicit user edits.
      const existingAnnotation = {
        caption: 'Forward Primer',
        type: 'primer',
        span: ezSpan(0, 20, Orientation.PLUS),
        attributes: { primer_bind: 5 }
      }

      const wrapper = mount(AnnotationModal, {
        props: {
          open: true,
          span: ezSpan(0, 20, Orientation.PLUS),
          annotation: existingAnnotation,
          additionalFields: [PrimerBindExtension]
        }
      })

      await wrapper.vm.$nextTick()

      // Verify initial value
      const input = wrapper.find('.primer-bind-editor')
      expect(input.element.value).toBe('5')

      // User edits primer_bind to 8 (without changing the span)
      await input.setValue('8')
      await wrapper.vm.$nextTick()

      // Submit the form
      await wrapper.find('form').trigger('submit')

      const emitted = wrapper.emitted('update')
      expect(emitted).toHaveLength(1)
      // User explicitly set primer_bind to 8, this should be preserved
      expect(emitted[0][0].attributes.primer_bind).toBe(8)
    })

    it('hides primer_bind field for multi-range annotations', async () => {
      // Create a two-range primer annotation
      const multiRangeSpan = new Span([
        new Range(0, 10, Orientation.PLUS),
        new Range(20, 30, Orientation.PLUS)
      ])
      const existingAnnotation = {
        caption: 'Split Primer',
        type: 'primer',
        span: multiRangeSpan,
        attributes: { primer_bind: 5 }
      }

      const wrapper = mount(AnnotationModal, {
        props: {
          open: true,
          annotation: existingAnnotation,
          additionalFields: [PrimerBindExtension]
        }
      })

      await wrapper.vm.$nextTick()

      // primer_bind editor should not be shown for multi-range
      const input = wrapper.find('.primer-bind-editor')
      expect(input.exists()).toBe(false)
    })
  })
})
