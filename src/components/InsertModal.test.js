import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import InsertModal from './InsertModal.vue'

describe('InsertModal', () => {
  describe('visibility', () => {
    it('does not render when visible is false', () => {
      const wrapper = mount(InsertModal, {
        props: { visible: false }
      })
      expect(wrapper.find('.modal-overlay').exists()).toBe(false)
    })

    it('renders when visible is true', () => {
      const wrapper = mount(InsertModal, {
        props: { visible: true }
      })
      expect(wrapper.find('.modal-overlay').exists()).toBe(true)
    })
  })

  describe('prompt text', () => {
    it('shows insert prompt for non-replace mode', () => {
      const wrapper = mount(InsertModal, {
        props: { visible: true, isReplace: false, position: 123 }
      })
      expect(wrapper.find('.modal-label').text()).toBe('Insert sequence at 123:')
    })

    it('shows replace prompt for replace mode', () => {
      const wrapper = mount(InsertModal, {
        props: { visible: true, isReplace: true, position: 123 }
      })
      expect(wrapper.find('.modal-label').text()).toBe('Replace sequence with:')
    })
  })

  describe('initial text', () => {
    it('populates input with initialText', async () => {
      const wrapper = mount(InsertModal, {
        props: { visible: true, initialText: 'ATG' }
      })
      await nextTick()
      await nextTick()
      const input = wrapper.find('textarea')
      expect(input.element.value).toBe('ATG')
    })

    it('starts with empty input when no initialText', async () => {
      const wrapper = mount(InsertModal, {
        props: { visible: true, initialText: '' }
      })
      await nextTick()
      await nextTick()
      const input = wrapper.find('textarea')
      expect(input.element.value).toBe('')
    })
  })

  describe('submit', () => {
    it('emits submit with uppercase text and default annotation mode on button click', async () => {
      const wrapper = mount(InsertModal, {
        props: { visible: true, initialText: 'atg' }
      })
      await nextTick()
      await nextTick()
      await wrapper.find('.btn-submit').trigger('click')
      expect(wrapper.emitted('submit')).toHaveLength(1)
      // Emits [text, annotationMode]
      expect(wrapper.emitted('submit')[0]).toEqual(['ATG', 'default'])
    })

    it('emits submit on Enter key', async () => {
      const wrapper = mount(InsertModal, {
        props: { visible: true, initialText: 'ATG' }
      })
      await nextTick()
      await nextTick()
      await wrapper.find('textarea').trigger('keydown', { key: 'Enter' })
      expect(wrapper.emitted('submit')).toHaveLength(1)
      expect(wrapper.emitted('submit')[0]).toEqual(['ATG', 'default'])
    })

    it('filters out invalid characters', async () => {
      const wrapper = mount(InsertModal, {
        props: { visible: true, initialText: 'ATG123XYZ' }
      })
      await nextTick()
      await nextTick()
      await wrapper.find('.btn-submit').trigger('click')
      // Only valid IUPAC codes should remain: X and Z are not valid, Y is valid
      expect(wrapper.emitted('submit')[0]).toEqual(['ATGY', 'default'])
    })

    it('does not emit submit with empty text', async () => {
      const wrapper = mount(InsertModal, {
        props: { visible: true, initialText: '' }
      })
      await nextTick()
      await nextTick()
      await wrapper.find('.btn-submit').trigger('click')
      expect(wrapper.emitted('submit')).toBeUndefined()
    })
  })

  describe('cancel', () => {
    it('emits cancel on button click', async () => {
      const wrapper = mount(InsertModal, {
        props: { visible: true }
      })
      await wrapper.find('.btn-cancel').trigger('click')
      expect(wrapper.emitted('cancel')).toHaveLength(1)
    })

    it('emits cancel on Escape key', async () => {
      const wrapper = mount(InsertModal, {
        props: { visible: true }
      })
      await wrapper.find('textarea').trigger('keydown', { key: 'Escape' })
      expect(wrapper.emitted('cancel')).toHaveLength(1)
    })

    it('emits cancel when clicking overlay', async () => {
      const wrapper = mount(InsertModal, {
        props: { visible: true }
      })
      await wrapper.find('.modal-overlay').trigger('click')
      expect(wrapper.emitted('cancel')).toHaveLength(1)
    })

    it('does not emit cancel when clicking modal content', async () => {
      const wrapper = mount(InsertModal, {
        props: { visible: true }
      })
      await wrapper.find('.modal-content').trigger('click')
      expect(wrapper.emitted('cancel')).toBeUndefined()
    })
  })

  describe('IUPAC validation', () => {
    it('accepts all standard bases', async () => {
      const wrapper = mount(InsertModal, {
        props: { visible: true, initialText: 'ATCG' }
      })
      await nextTick()
      await nextTick()
      await wrapper.find('.btn-submit').trigger('click')
      expect(wrapper.emitted('submit')[0]).toEqual(['ATCG', 'default'])
    })

    it('accepts N wildcard', async () => {
      const wrapper = mount(InsertModal, {
        props: { visible: true, initialText: 'ATNGC' }
      })
      await nextTick()
      await nextTick()
      await wrapper.find('.btn-submit').trigger('click')
      expect(wrapper.emitted('submit')[0]).toEqual(['ATNGC', 'default'])
    })

    it('accepts two-letter IUPAC codes', async () => {
      const wrapper = mount(InsertModal, {
        props: { visible: true, initialText: 'RYSWKM' }
      })
      await nextTick()
      await nextTick()
      await wrapper.find('.btn-submit').trigger('click')
      expect(wrapper.emitted('submit')[0]).toEqual(['RYSWKM', 'default'])
    })

    it('accepts three-letter IUPAC codes', async () => {
      const wrapper = mount(InsertModal, {
        props: { visible: true, initialText: 'BDHV' }
      })
      await nextTick()
      await nextTick()
      await wrapper.find('.btn-submit').trigger('click')
      expect(wrapper.emitted('submit')[0]).toEqual(['BDHV', 'default'])
    })
  })

  describe('annotation toggle', () => {
    it('does not show annotation toggle when overlayAnnotationCount is 0', async () => {
      const wrapper = mount(InsertModal, {
        props: { visible: true, overlayAnnotationCount: 0 }
      })
      expect(wrapper.find('.annotation-toggle').exists()).toBe(false)
    })

    it('shows annotation toggle when overlayAnnotationCount > 0', async () => {
      const wrapper = mount(InsertModal, {
        props: { visible: true, overlayAnnotationCount: 3 }
      })
      expect(wrapper.find('.annotation-toggle').exists()).toBe(true)
      expect(wrapper.find('.annotation-toggle').text()).toContain('Include 3 annotations')
    })

    it('shows singular "annotation" when count is 1', async () => {
      const wrapper = mount(InsertModal, {
        props: { visible: true, overlayAnnotationCount: 1 }
      })
      expect(wrapper.find('.annotation-toggle').text()).toContain('Include 1 annotation')
      expect(wrapper.find('.annotation-toggle').text()).not.toContain('annotations')
    })

    it('toggle is checked by default', async () => {
      const wrapper = mount(InsertModal, {
        props: { visible: true, overlayAnnotationCount: 2 }
      })
      const checkbox = wrapper.find('.annotation-toggle input[type="checkbox"]')
      expect(checkbox.element.checked).toBe(true)
    })

    it('emits default mode when toggle is unchecked', async () => {
      const wrapper = mount(InsertModal, {
        props: { visible: true, initialText: 'ATG', overlayAnnotationCount: 2 }
      })
      await nextTick()
      await nextTick()

      // Uncheck the toggle
      const checkbox = wrapper.find('.annotation-toggle input[type="checkbox"]')
      await checkbox.setValue(false)

      await wrapper.find('.btn-submit').trigger('click')
      // When unchecked, we don't include overlay annotations -> 'default' mode
      expect(wrapper.emitted('submit')[0]).toEqual(['ATG', 'default'])
    })

    it('emits include mode when toggle is checked', async () => {
      const wrapper = mount(InsertModal, {
        props: { visible: true, initialText: 'ATG', overlayAnnotationCount: 2 }
      })
      await nextTick()
      await nextTick()

      // Toggle is checked by default
      await wrapper.find('.btn-submit').trigger('click')
      // When checked, we include overlay annotations -> 'include' mode
      expect(wrapper.emitted('submit')[0]).toEqual(['ATG', 'include'])
    })

    it('resets toggle to checked when modal reopens', async () => {
      const wrapper = mount(InsertModal, {
        props: { visible: true, overlayAnnotationCount: 2 }
      })

      // Uncheck the toggle
      let checkbox = wrapper.find('.annotation-toggle input[type="checkbox"]')
      await checkbox.setValue(false)
      expect(checkbox.element.checked).toBe(false)

      // Close and reopen modal
      await wrapper.setProps({ visible: false })
      await wrapper.setProps({ visible: true })
      await nextTick()

      // Re-query the checkbox after modal reopened
      checkbox = wrapper.find('.annotation-toggle input[type="checkbox"]')
      // Toggle should be checked again
      expect(checkbox.element.checked).toBe(true)
    })
  })
})
