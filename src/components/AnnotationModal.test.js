import { describe, it, expect, mock } from 'bun:test'
import { mount } from '@vue/test-utils'
import AnnotationModal from './AnnotationModal.vue'

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
        props: { open: true, span: '0..10' }
      })
      expect(wrapper.find('.modal-overlay').exists()).toBe(true)
    })
  })

  describe('form fields', () => {
    it('shows caption input', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: '0..10' }
      })
      expect(wrapper.find('#annotation-caption').exists()).toBe(true)
    })

    it('shows type combo input (dropdown + text entry)', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: '0..10' }
      })
      // Should be an input with datalist for combo behavior
      expect(wrapper.find('#annotation-type').exists()).toBe(true)
      expect(wrapper.find('#annotation-type-list').exists()).toBe(true)
    })
  })

  describe('type combo control', () => {
    it('has standard annotation types in datalist', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: '0..10' }
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
        props: { open: true, span: '0..10' }
      })

      await wrapper.find('#annotation-type').setValue('my_custom_type')

      expect(wrapper.find('#annotation-type').element.value).toBe('my_custom_type')
    })
  })

  describe('ranges section', () => {
    it('shows ranges section', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: '0..10' }
      })
      expect(wrapper.find('.ranges-section').exists()).toBe(true)
    })

    it('shows "Range" label for single range', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: '0..10' }
      })
      expect(wrapper.find('.ranges-section label').text()).toBe('Range')
    })

    it('shows "Ranges" label for multiple ranges', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: '0..10 + 20..30' }
      })
      expect(wrapper.find('.ranges-section label').text()).toBe('Ranges')
    })

    it('shows one range row for single-range span', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: '5..15' }
      })
      const rows = wrapper.findAll('.range-row')
      expect(rows.length).toBe(1)
    })

    it('shows multiple range rows for multi-range span', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: '5..15 + 20..30' }
      })
      const rows = wrapper.findAll('.range-row')
      expect(rows.length).toBe(2)
    })

    it('has add range button', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: '0..10' }
      })
      expect(wrapper.find('.btn-add-range').exists()).toBe(true)
    })

    it('adds new range when + button clicked', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: '0..10' }
      })
      expect(wrapper.findAll('.range-row').length).toBe(1)

      await wrapper.find('.btn-add-range').trigger('click')

      expect(wrapper.findAll('.range-row').length).toBe(2)
    })

    it('new range inherits strand from last range', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: '(0..10)' } // reverse strand
      })

      await wrapper.find('.btn-add-range').trigger('click')

      const strandSelects = wrapper.findAll('.range-strand')
      expect(strandSelects[1].element.value).toBe('reverse')
    })

    it('does not show range controls when only one range', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: '0..10' }
      })
      expect(wrapper.find('.btn-remove-range').exists()).toBe(false)
      expect(wrapper.find('.btn-move-up').exists()).toBe(false)
      expect(wrapper.find('.btn-move-down').exists()).toBe(false)
    })

    it('shows trash button for each range when multiple ranges', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: '0..10 + 20..30' }
      })
      const trashButtons = wrapper.findAll('.btn-remove-range')
      expect(trashButtons.length).toBe(2)
    })

    it('removes range when trash clicked', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: '0..10 + 20..30' }
      })
      expect(wrapper.findAll('.range-row').length).toBe(2)

      await wrapper.findAll('.btn-remove-range')[0].trigger('click')

      expect(wrapper.findAll('.range-row').length).toBe(1)
      // Second range should remain (GenBank coords: fenced 20 → GenBank 21)
      expect(wrapper.find('.range-start').element.value).toBe('21')
    })

    it('shows up/down buttons for ranges when multiple ranges', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: '0..10 + 20..30' }
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
        props: { open: true, span: '0..10 + 20..30' }
      })

      // Click up on second range
      await wrapper.findAll('.range-row')[1].find('.btn-move-up').trigger('click')

      // Now first range should be 20..30 (GenBank coords: fenced 20 → 21, fenced 0 → 1)
      expect(wrapper.findAll('.range-start')[0].element.value).toBe('21')
      expect(wrapper.findAll('.range-start')[1].element.value).toBe('1')
    })

    it('moves range down when down button clicked', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: '0..10 + 20..30' }
      })

      // Click down on first range
      await wrapper.findAll('.range-row')[0].find('.btn-move-down').trigger('click')

      // Now first range should be 20..30 (GenBank coords: fenced 20 → 21, fenced 0 → 1)
      expect(wrapper.findAll('.range-start')[0].element.value).toBe('21')
      expect(wrapper.findAll('.range-start')[1].element.value).toBe('1')
    })

    it('each range row has start, end, and strand controls', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: '0..10' }
      })
      const row = wrapper.find('.range-row')

      expect(row.find('.range-start').exists()).toBe(true)
      expect(row.find('.range-end').exists()).toBe(true)
      expect(row.find('.range-strand').exists()).toBe(true)
    })

    it('pre-fills range values from span prop', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: '100..200' }
      })
      // Start is displayed in GenBank (1-based): fenced 100 → GenBank 101
      // End stays the same (fenced end = GenBank end due to half-open vs closed intervals)
      expect(wrapper.find('.range-start').element.value).toBe('101')
      expect(wrapper.find('.range-end').element.value).toBe('200')
    })

    it('sets max attribute on range inputs from sequenceLength prop', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: '0..10', sequenceLength: 500 }
      })
      expect(wrapper.find('.range-end').element.max).toBe('500')
    })

    it('sets end min to GenBank start', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: '50..100' }
      })
      // GenBank start is 51 (fenced 50 + 1), min for end is GenBank start
      expect(wrapper.find('.range-end').element.min).toBe('51')
    })

    it('sets start max to end', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: '50..100' }
      })
      // Max for GenBank start equals the fenced end (since GenBank start can equal fenced end for 1-base ranges)
      expect(wrapper.find('.range-start').element.max).toBe('100')
    })

    it('strand dropdown has Forward, Reverse, None options', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: '0..10' }
      })
      const options = wrapper.findAll('.range-strand option')
      const values = options.map(o => o.element.value)

      expect(values).toContain('forward')
      expect(values).toContain('reverse')
      expect(values).toContain('none')
    })

    it('pre-fills forward strand for plain span', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: '0..10' }
      })
      expect(wrapper.find('.range-strand').element.value).toBe('forward')
    })

    it('pre-fills reverse strand from parentheses span', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: '(0..10)' }
      })
      expect(wrapper.find('.range-strand').element.value).toBe('reverse')
    })

    it('pre-fills none strand from bracket span', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: '[0..10]' }
      })
      expect(wrapper.find('.range-strand').element.value).toBe('none')
    })
  })

  describe('indefinite locations', () => {
    it('shows indefinite checkboxes for each range', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: '0..10' }
      })
      const checkboxes = wrapper.findAll('.indefinite-checkbox')
      expect(checkboxes.length).toBe(2) // start and end
    })

    it('indefinite checkboxes are unchecked by default', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: '0..10' }
      })
      const checkboxes = wrapper.findAll('.indefinite-checkbox input[type="checkbox"]')
      expect(checkboxes[0].element.checked).toBe(false)
      expect(checkboxes[1].element.checked).toBe(false)
    })

    it('pre-fills start indefinite from span with < marker', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: '<0..10' }
      })
      const checkboxes = wrapper.findAll('.indefinite-checkbox input[type="checkbox"]')
      expect(checkboxes[0].element.checked).toBe(true)
      expect(checkboxes[1].element.checked).toBe(false)
    })

    it('pre-fills end indefinite from span with > marker', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: '0..>10' }
      })
      const checkboxes = wrapper.findAll('.indefinite-checkbox input[type="checkbox"]')
      expect(checkboxes[0].element.checked).toBe(false)
      expect(checkboxes[1].element.checked).toBe(true)
    })

    it('pre-fills both indefinite from span with both markers', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: '<0..>10' }
      })
      const checkboxes = wrapper.findAll('.indefinite-checkbox input[type="checkbox"]')
      expect(checkboxes[0].element.checked).toBe(true)
      expect(checkboxes[1].element.checked).toBe(true)
    })

    it('emits span with < marker for start indefinite', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: '0..10' }
      })

      await wrapper.find('#annotation-caption').setValue('Test')
      await wrapper.find('#annotation-type').setValue('gene')

      // Check start indefinite
      const checkboxes = wrapper.findAll('.indefinite-checkbox input[type="checkbox"]')
      await checkboxes[0].setValue(true)

      await wrapper.find('.annotation-form').trigger('submit')

      const emitted = wrapper.emitted('create')[0][0]
      expect(emitted.span).toBe('<0..10')
    })

    it('emits span with > marker for end indefinite', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: '0..10' }
      })

      await wrapper.find('#annotation-caption').setValue('Test')
      await wrapper.find('#annotation-type').setValue('gene')

      // Check end indefinite
      const checkboxes = wrapper.findAll('.indefinite-checkbox input[type="checkbox"]')
      await checkboxes[1].setValue(true)

      await wrapper.find('.annotation-form').trigger('submit')

      const emitted = wrapper.emitted('create')[0][0]
      expect(emitted.span).toBe('0..>10')
    })

    it('emits span with both markers for both indefinite', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: '0..10' }
      })

      await wrapper.find('#annotation-caption').setValue('Test')
      await wrapper.find('#annotation-type').setValue('gene')

      // Check both indefinite
      const checkboxes = wrapper.findAll('.indefinite-checkbox input[type="checkbox"]')
      await checkboxes[0].setValue(true)
      await checkboxes[1].setValue(true)

      await wrapper.find('.annotation-form').trigger('submit')

      const emitted = wrapper.emitted('create')[0][0]
      expect(emitted.span).toBe('<0..>10')
    })

    it('works with reverse strand and indefinite', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: '(<0..>10)' }
      })

      await wrapper.find('#annotation-caption').setValue('Test')
      await wrapper.find('#annotation-type').setValue('gene')
      await wrapper.find('.annotation-form').trigger('submit')

      const emitted = wrapper.emitted('create')[0][0]
      expect(emitted.span).toBe('(<0..>10)')
    })

    it('works with multi-range and indefinite', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: '<0..10 + 20..>30' }
      })

      await wrapper.find('#annotation-caption').setValue('Test')
      await wrapper.find('#annotation-type').setValue('gene')
      await wrapper.find('.annotation-form').trigger('submit')

      const emitted = wrapper.emitted('create')[0][0]
      expect(emitted.span).toBe('<0..10 + 20..>30')
    })

    it('newly added range has indefinite unchecked', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: '<0..>10' }
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
        props: { open: true, span: '0..10' }
      })
      expect(wrapper.find('.add-field-select').exists()).toBe(true)
    })

    it('adds optional field when selected from dropdown', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: '0..10' }
      })

      await wrapper.find('.add-field-select').setValue('gene')

      expect(wrapper.find('#annotation-attr-gene').exists()).toBe(true)
    })

    it('removes optional field when trash clicked', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: '0..10' }
      })

      await wrapper.find('.add-field-select').setValue('product')
      expect(wrapper.find('#annotation-attr-product').exists()).toBe(true)

      await wrapper.find('.btn-remove-field').trigger('click')

      expect(wrapper.find('#annotation-attr-product').exists()).toBe(false)
    })

    it('shows custom qualifier input', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: '0..10' }
      })
      expect(wrapper.find('.custom-field-input').exists()).toBe(true)
    })

    it('shows dropdown when custom input is empty', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: '0..10' }
      })

      expect(wrapper.find('.add-field-select').exists()).toBe(true)
      expect(wrapper.find('.add-field-button').exists()).toBe(false)
    })

    it('shows button when custom input has text', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: '0..10' }
      })

      await wrapper.find('.custom-field-input').setValue('my_qualifier')

      expect(wrapper.find('.add-field-select').exists()).toBe(false)
      expect(wrapper.find('.add-field-button').exists()).toBe(true)
      expect(wrapper.find('.add-field-button').text()).toBe('Add field:')
    })

    it('adds custom qualifier when button clicked', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: '0..10' }
      })

      await wrapper.find('.custom-field-input').setValue('my_qualifier')
      await wrapper.find('.add-field-button').trigger('click')

      expect(wrapper.find('#annotation-attr-my_qualifier').exists()).toBe(true)
    })

    it('clears custom qualifier input after adding', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: '0..10' }
      })

      await wrapper.find('.custom-field-input').setValue('my_qualifier')
      await wrapper.find('.add-field-button').trigger('click')

      expect(wrapper.find('.custom-field-input').element.value).toBe('')
    })

    it('includes custom qualifier in emitted attributes', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: '0..10' }
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
        props: { open: true, span: '0..10' }
      })

      // With empty input, button should not exist (dropdown shows instead)
      expect(wrapper.find('.add-field-button').exists()).toBe(false)
      expect(wrapper.find('.add-field-select').exists()).toBe(true)
    })
  })

  describe('form validation', () => {
    it('Create button is disabled when caption is empty', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: '0..10' }
      })
      expect(wrapper.find('.btn-create').element.disabled).toBe(true)
    })

    it('Create button is disabled when type is empty', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: '0..10' }
      })

      await wrapper.find('#annotation-caption').setValue('GFP')
      // Type is still empty

      expect(wrapper.find('.btn-create').element.disabled).toBe(true)
    })

    it('Create button is enabled when caption and type are filled', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: '0..10' }
      })

      await wrapper.find('#annotation-caption').setValue('GFP')
      await wrapper.find('#annotation-type').setValue('gene')

      expect(wrapper.find('.btn-create').element.disabled).toBe(false)
    })

    it('Create button works with custom type', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: '0..10' }
      })

      await wrapper.find('#annotation-caption').setValue('GFP')
      await wrapper.find('#annotation-type').setValue('my_custom_feature')

      expect(wrapper.find('.btn-create').element.disabled).toBe(false)
    })

    it('Create button is disabled when any range is incomplete', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: '0..10' }
      })

      await wrapper.find('#annotation-caption').setValue('GFP')
      await wrapper.find('#annotation-type').setValue('gene')

      // Add another range (which will be empty)
      await wrapper.find('.btn-add-range').trigger('click')

      expect(wrapper.find('.btn-create').element.disabled).toBe(true)
    })

    it('Create button is enabled when all ranges are complete', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: '0..10' }
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
        props: { open: true, span: '0..20' }
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
        props: { open: true, span: '0..20' }
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
        props: { open: true, span: '0..10' }
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
        props: { open: true, span: '0..10' }
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
    it('emits create event with annotation data including span string', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: '5..15' }
      })

      await wrapper.find('#annotation-caption').setValue('GFP')
      await wrapper.find('#annotation-type').setValue('gene')
      await wrapper.find('.annotation-form').trigger('submit')

      expect(wrapper.emitted('create')).toBeTruthy()
      const emitted = wrapper.emitted('create')[0][0]
      expect(emitted.caption).toBe('GFP')
      expect(emitted.type).toBe('gene')
      expect(emitted.span).toBe('5..15') // forward strand string
    })

    it('emits span with parentheses for reverse strand', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: '0..10' }
      })

      await wrapper.find('#annotation-caption').setValue('Promoter')
      await wrapper.find('#annotation-type').setValue('promoter')
      await wrapper.find('.range-strand').setValue('reverse')
      await wrapper.find('.annotation-form').trigger('submit')

      const emitted = wrapper.emitted('create')[0][0]
      expect(emitted.span).toBe('(0..10)')
    })

    it('emits span with brackets for unoriented', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: '0..10' }
      })

      await wrapper.find('#annotation-caption').setValue('Feature')
      await wrapper.find('#annotation-type').setValue('misc_feature')
      await wrapper.find('.range-strand').setValue('none')
      await wrapper.find('.annotation-form').trigger('submit')

      const emitted = wrapper.emitted('create')[0][0]
      expect(emitted.span).toBe('[0..10]')
    })

    it('updates span when range inputs are changed', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: '0..10' }
      })

      // Input is GenBank (1-based): 21 converts to fenced 20
      await wrapper.find('.range-start').setValue('21')
      await wrapper.find('.range-end').setValue('30')
      await wrapper.find('#annotation-caption').setValue('Test')
      await wrapper.find('#annotation-type').setValue('gene')
      await wrapper.find('.annotation-form').trigger('submit')

      const emitted = wrapper.emitted('create')[0][0]
      // Output span is fenced coordinates
      expect(emitted.span).toBe('20..30')
    })

    it('builds multi-range span correctly', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: '5..10 + 20..30' }
      })

      await wrapper.find('#annotation-caption').setValue('Split Gene')
      await wrapper.find('#annotation-type').setValue('gene')
      await wrapper.find('.annotation-form').trigger('submit')

      const emitted = wrapper.emitted('create')[0][0]
      expect(emitted.span).toBe('5..10 + 20..30')
    })

    it('includes optional attributes when filled', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: '0..10' }
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
        props: { open: true, span: '0..10' }
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
        props: { open: true, span: '0..10' }
      })

      await wrapper.find('.modal-close').trigger('click')

      expect(wrapper.emitted('close')).toBeTruthy()
    })

    it('emits close when Cancel clicked', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: '0..10' }
      })

      await wrapper.find('.btn-cancel').trigger('click')

      expect(wrapper.emitted('close')).toBeTruthy()
    })

    it('emits close when overlay clicked', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: '0..10' }
      })

      await wrapper.find('.modal-overlay').trigger('click')

      expect(wrapper.emitted('close')).toBeTruthy()
    })

    it('does not close when modal content clicked', async () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: '0..10' }
      })

      await wrapper.find('.modal-content').trigger('click')

      expect(wrapper.emitted('close')).toBeFalsy()
    })
  })

  describe('readonly mode', () => {
    it('does not render in readonly mode', () => {
      const wrapper = mount(AnnotationModal, {
        props: { open: true, span: '0..10', readonly: true }
      })

      // Modal should not render at all in readonly mode
      expect(wrapper.find('.modal-overlay').exists()).toBe(false)
    })
  })
})
