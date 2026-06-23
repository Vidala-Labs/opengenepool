import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import MetadataModal from './MetadataModal.vue'

describe('MetadataModal', () => {
  describe('visibility', () => {
    it('is hidden when open is false', () => {
      const wrapper = mount(MetadataModal, {
        props: { open: false, metadata: {} }
      })
      expect(wrapper.find('.modal-overlay').exists()).toBe(false)
    })

    it('is visible when open is true', () => {
      const wrapper = mount(MetadataModal, {
        props: { open: true, metadata: {} }
      })
      expect(wrapper.find('.modal-overlay').exists()).toBe(true)
    })
  })

  describe('view mode', () => {
    it('displays metadata fields', async () => {
      const wrapper = mount(MetadataModal, {
        props: {
          open: true,
          metadata: { molecule_type: 'DNA', circular: false, locus_name: 'pUC19' }
        }
      })

      expect(wrapper.text()).toContain('DNA')
      expect(wrapper.text()).toContain('linear')
      expect(wrapper.text()).toContain('pUC19')
    })

    it('shows Edit button when not readonly', () => {
      const wrapper = mount(MetadataModal, {
        props: { open: true, metadata: { molecule_type: 'DNA' } }
      })

      expect(wrapper.find('.edit-button').exists()).toBe(true)
    })

    it('hides Edit button when readonly', () => {
      const wrapper = mount(MetadataModal, {
        props: { open: true, metadata: { molecule_type: 'DNA' }, readonly: true }
      })

      expect(wrapper.find('.edit-button').exists()).toBe(false)
    })
  })

  describe('edit mode', () => {
    it('enters edit mode when Edit clicked', async () => {
      const wrapper = mount(MetadataModal, {
        props: { open: true, metadata: { molecule_type: 'DNA' } }
      })

      await wrapper.find('.edit-button').trigger('click')

      expect(wrapper.find('.metadata-edit-form').exists()).toBe(true)
    })

    it('populates form with current values', async () => {
      const wrapper = mount(MetadataModal, {
        props: {
          open: true,
          metadata: { molecule_type: 'RNA', circular: true, locus_name: 'Test' }
        }
      })

      await wrapper.find('.edit-button').trigger('click')

      expect(wrapper.find('#edit-type').element.value).toBe('RNA')
      expect(wrapper.find('#edit-locus').element.value).toBe('Test')
    })

    it('calls backend.metadataUpdate on save with full metadata', async () => {
      const mockBackend = { metadataUpdate: vi.fn(() => {}) }
      const wrapper = mount(MetadataModal, {
        props: {
          open: true,
          metadata: { molecule_type: 'DNA', circular: false },
          backend: mockBackend
        }
      })

      await wrapper.find('.edit-button').trigger('click')

      // Change molecule_type to RNA
      await wrapper.find('#edit-type').setValue('RNA')
      // Trigger form submit instead of button click
      await wrapper.find('.metadata-edit-form').trigger('submit')

      expect(mockBackend.metadataUpdate).toHaveBeenCalled()
      const callArg = mockBackend.metadataUpdate.mock.calls[0][0]
      expect(callArg.metadata.molecule_type).toBe('RNA')
      expect(callArg.metadata.circular).toBe(false)
      expect(callArg.id).toBeDefined()
    })

    it('returns to view mode on cancel', async () => {
      const wrapper = mount(MetadataModal, {
        props: { open: true, metadata: { molecule_type: 'DNA' } }
      })

      await wrapper.find('.edit-button').trigger('click')
      expect(wrapper.find('.metadata-edit-form').exists()).toBe(true)

      await wrapper.find('.btn-cancel').trigger('click')

      expect(wrapper.find('.metadata-edit-form').exists()).toBe(false)
      expect(wrapper.find('.metadata-list').exists()).toBe(true)
    })

    it('returns to view mode after save', async () => {
      const mockBackend = { metadataUpdate: vi.fn(() => {}) }
      const wrapper = mount(MetadataModal, {
        props: {
          open: true,
          metadata: { molecule_type: 'DNA' },
          backend: mockBackend
        }
      })

      await wrapper.find('.edit-button').trigger('click')
      expect(wrapper.find('.metadata-edit-form').exists()).toBe(true)

      // Trigger form submit instead of button click
      await wrapper.find('.metadata-edit-form').trigger('submit')

      expect(wrapper.find('.metadata-edit-form').exists()).toBe(false)
    })
  })

  describe('reference management', () => {
    it('shows references in view mode', () => {
      const wrapper = mount(MetadataModal, {
        props: {
          open: true,
          metadata: {
            references: [{ title: 'Test Paper', authors: 'Author A', journal: 'Nature', pubmed: '12345' }]
          }
        }
      })

      expect(wrapper.text()).toContain('Test Paper')
    })

    it('adds blank reference when + clicked', async () => {
      const wrapper = mount(MetadataModal, {
        props: { open: true, metadata: { references: [] } }
      })

      await wrapper.find('.edit-button').trigger('click')
      await wrapper.find('.btn-add-reference').trigger('click')

      expect(wrapper.findAll('.reference-item-edit').length).toBe(1)
    })

    it('removes reference when trash clicked', async () => {
      const wrapper = mount(MetadataModal, {
        props: {
          open: true,
          metadata: { references: [{ title: 'Ref 1' }, { title: 'Ref 2' }] }
        }
      })

      await wrapper.find('.edit-button').trigger('click')
      expect(wrapper.findAll('.reference-item-edit').length).toBe(2)

      await wrapper.findAll('.btn-remove-reference')[0].trigger('click')

      expect(wrapper.findAll('.reference-item-edit').length).toBe(1)
    })
  })

  describe('close behavior', () => {
    it('emits close when X clicked', async () => {
      const wrapper = mount(MetadataModal, {
        props: { open: true, metadata: {} }
      })

      await wrapper.find('.modal-close').trigger('click')

      expect(wrapper.emitted('close')).toBeTruthy()
    })

    it('emits close when overlay clicked', async () => {
      const wrapper = mount(MetadataModal, {
        props: { open: true, metadata: {} }
      })

      await wrapper.find('.modal-overlay').trigger('click')

      expect(wrapper.emitted('close')).toBeTruthy()
    })

    it('does not close when modal content clicked', async () => {
      const wrapper = mount(MetadataModal, {
        props: { open: true, metadata: {} }
      })

      await wrapper.find('.modal-content').trigger('click')

      expect(wrapper.emitted('close')).toBeFalsy()
    })
  })
})
