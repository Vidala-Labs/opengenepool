import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref, nextTick } from 'vue'
import ContextMenu from './ContextMenu.vue'

describe('ContextMenu', () => {
  describe('visibility', () => {
    it('is hidden by default', () => {
      const wrapper = mount(ContextMenu)
      expect(wrapper.find('.context-menu').exists()).toBe(false)
    })

    it('shows when visible prop is true', () => {
      const wrapper = mount(ContextMenu, {
        props: { visible: true, x: 100, y: 100 }
      })
      expect(wrapper.find('.context-menu').exists()).toBe(true)
    })

    it('hides when visible becomes false', async () => {
      const wrapper = mount(ContextMenu, {
        props: { visible: true, x: 100, y: 100 }
      })
      expect(wrapper.find('.context-menu').exists()).toBe(true)

      await wrapper.setProps({ visible: false })
      expect(wrapper.find('.context-menu').exists()).toBe(false)
    })
  })

  describe('positioning', () => {
    it('positions at x and y coordinates', () => {
      const wrapper = mount(ContextMenu, {
        props: { visible: true, x: 150, y: 200 }
      })

      const menu = wrapper.find('.context-menu')
      const style = menu.attributes('style')
      expect(style).toContain('left: 150px')
      expect(style).toContain('top: 200px')
    })

    it('updates position when props change', async () => {
      const wrapper = mount(ContextMenu, {
        props: { visible: true, x: 100, y: 100 }
      })

      await wrapper.setProps({ x: 250, y: 300 })

      const style = wrapper.find('.context-menu').attributes('style')
      expect(style).toContain('left: 250px')
      expect(style).toContain('top: 300px')
    })
  })

  describe('menu items', () => {
    it('renders menu items', () => {
      const items = [
        { label: 'Select All', action: () => {} },
        { label: 'Copy', action: () => {} }
      ]

      const wrapper = mount(ContextMenu, {
        props: { visible: true, x: 100, y: 100, items }
      })

      const menuItems = wrapper.findAll('.menu-item')
      expect(menuItems).toHaveLength(2)
      expect(menuItems[0].text()).toBe('Select All')
      expect(menuItems[1].text()).toBe('Copy')
    })

    it('renders separator items', () => {
      const items = [
        { label: 'Select All', action: () => {} },
        { separator: true },
        { label: 'Copy', action: () => {} }
      ]

      const wrapper = mount(ContextMenu, {
        props: { visible: true, x: 100, y: 100, items }
      })

      const separators = wrapper.findAll('.menu-separator')
      expect(separators).toHaveLength(1)
    })

    it('calls action when item is clicked', async () => {
      const actionFn = vi.fn(() => {})
      const items = [
        { label: 'Select All', action: actionFn }
      ]

      const wrapper = mount(ContextMenu, {
        props: { visible: true, x: 100, y: 100, items }
      })

      await wrapper.find('.menu-item').trigger('click')
      expect(actionFn).toHaveBeenCalled()
    })

    it('emits close event after action is called', async () => {
      const items = [
        { label: 'Select All', action: () => {} }
      ]

      const wrapper = mount(ContextMenu, {
        props: { visible: true, x: 100, y: 100, items }
      })

      await wrapper.find('.menu-item').trigger('click')
      expect(wrapper.emitted('close')).toBeTruthy()
    })

    it('does not call action for disabled items', async () => {
      const actionFn = vi.fn(() => {})
      const items = [
        { label: 'Disabled Item', action: actionFn, disabled: true }
      ]

      const wrapper = mount(ContextMenu, {
        props: { visible: true, x: 100, y: 100, items }
      })

      await wrapper.find('.menu-item').trigger('click')
      expect(actionFn).not.toHaveBeenCalled()
    })

    it('shows disabled styling for disabled items', () => {
      const items = [
        { label: 'Disabled Item', action: () => {}, disabled: true }
      ]

      const wrapper = mount(ContextMenu, {
        props: { visible: true, x: 100, y: 100, items }
      })

      const menuItem = wrapper.find('.menu-item')
      expect(menuItem.classes()).toContain('disabled')
    })

    it('renders data-action attribute from item id', () => {
      const items = [
        { label: 'Select All', id: 'select-all', action: () => {} },
        { label: 'Copy', id: 'copy', action: () => {} }
      ]

      const wrapper = mount(ContextMenu, {
        props: { visible: true, x: 100, y: 100, items }
      })

      expect(wrapper.find('[data-action="select-all"]').exists()).toBe(true)
      expect(wrapper.find('[data-action="copy"]').exists()).toBe(true)
    })

    it('falls back to kebab-cased label when no id provided', () => {
      const items = [
        { label: 'Create Annotation', action: () => {} },
        { label: 'Replace sequence with...', action: () => {} }
      ]

      const wrapper = mount(ContextMenu, {
        props: { visible: true, x: 100, y: 100, items }
      })

      expect(wrapper.find('[data-action="create-annotation"]').exists()).toBe(true)
      expect(wrapper.find('[data-action="replace-sequence-with"]').exists()).toBe(true)
    })
  })

  describe('empty state', () => {
    it('shows message when no items', () => {
      const wrapper = mount(ContextMenu, {
        props: { visible: true, x: 100, y: 100, items: [] }
      })

      expect(wrapper.text()).toContain('No actions available')
    })
  })

  describe('keyboard interaction', () => {
    it('emits close on Escape key', async () => {
      const wrapper = mount(ContextMenu, {
        props: { visible: true, x: 100, y: 100 }
      })

      await wrapper.find('.context-menu').trigger('keydown', { key: 'Escape' })
      expect(wrapper.emitted('close')).toBeTruthy()
    })
  })

  describe('click outside', () => {
    it('emits close when clicking the backdrop', async () => {
      const wrapper = mount(ContextMenu, {
        props: { visible: true, x: 100, y: 100 }
      })

      await wrapper.find('.context-menu-backdrop').trigger('click')
      expect(wrapper.emitted('close')).toBeTruthy()
    })

    it('does not close when clicking the menu itself', async () => {
      const wrapper = mount(ContextMenu, {
        props: { visible: true, x: 100, y: 100, items: [{ label: 'Test' }] }
      })

      await wrapper.find('.context-menu').trigger('click')
      // Should not have emitted close from this click
      expect(wrapper.emitted('close')).toBeFalsy()
    })
  })
})
