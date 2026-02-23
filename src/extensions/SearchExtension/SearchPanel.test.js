import { describe, it, expect, beforeEach } from 'bun:test'
import { mount } from '@vue/test-utils'
import { ref, nextTick, watch } from 'vue'
import SearchPanel from './SearchPanel.vue'
import { searchVisible } from './state.js'

describe('SearchPanel', () => {
  let selectionChangeHandler = null

  const mockExtensionAPI = {
    getSequence: () => 'ATCGATCGATCG',
    getSelectedSequence: () => '',
    setSelection: () => {},
    clearSelection: () => {},
    scrollToPosition: () => {},
    onSelectionChange: (handler) => {
      selectionChangeHandler = handler
      return () => { selectionChangeHandler = null }
    }
  }

  beforeEach(() => {
    searchVisible.value = false
    selectionChangeHandler = null
  })

  it('subscribes to selection changes via onSelectionChange callback', async () => {
    // This test verifies the panel uses onSelectionChange (which should be
    // backed by a watcher on selection.domain, not eventBus 'select' events)
    let subscribeCalled = false
    const apiWithTracking = {
      ...mockExtensionAPI,
      onSelectionChange: (handler) => {
        subscribeCalled = true
        selectionChangeHandler = handler
        return () => { selectionChangeHandler = null }
      }
    }

    mount(SearchPanel, {
      global: {
        provide: {
          extensionAPI: apiWithTracking
        }
      }
    })

    // Panel should subscribe on mount
    expect(subscribeCalled).toBe(true)
    expect(selectionChangeHandler).not.toBeNull()
  })

  it('closes panel when selection changes externally', async () => {
    const wrapper = mount(SearchPanel, {
      global: {
        provide: {
          extensionAPI: mockExtensionAPI
        }
      }
    })

    // Open the search panel
    searchVisible.value = true
    await nextTick()

    // Verify panel is visible
    expect(wrapper.find('.search-overlay').exists()).toBe(true)

    // Simulate external selection change (as would happen from watcher)
    expect(selectionChangeHandler).not.toBeNull()
    selectionChangeHandler()
    await nextTick()

    // Panel should be closed
    expect(searchVisible.value).toBe(false)
  })

  it('does not close panel when navigating matches', async () => {
    const setSelectionCalls = []
    const apiWithTracking = {
      ...mockExtensionAPI,
      getSequence: () => 'ATCGATCGATCGATCG',
      setSelection: (spec) => {
        setSelectionCalls.push(spec)
      }
    }

    const wrapper = mount(SearchPanel, {
      global: {
        provide: {
          extensionAPI: apiWithTracking
        }
      }
    })

    // Open the search panel
    searchVisible.value = true
    await nextTick()

    // Type a search query
    const input = wrapper.find('.search-input')
    await input.setValue('ATCG')
    await nextTick()

    // Should have found matches and set selection
    expect(setSelectionCalls.length).toBeGreaterThan(0)

    // Panel should still be visible (navigation doesn't close it)
    expect(searchVisible.value).toBe(true)
  })

  it('pre-fills search with selected sequence on open', async () => {
    const apiWithSelection = {
      ...mockExtensionAPI,
      getSelectedSequence: () => 'GAATTC'
    }

    const wrapper = mount(SearchPanel, {
      global: {
        provide: {
          extensionAPI: apiWithSelection
        }
      }
    })

    // Open the search panel
    searchVisible.value = true
    await nextTick()

    // Search input should be pre-filled
    const input = wrapper.find('.search-input')
    expect(input.element.value).toBe('GAATTC')
  })

  it('unsubscribes from selection changes on unmount', async () => {
    const wrapper = mount(SearchPanel, {
      global: {
        provide: {
          extensionAPI: mockExtensionAPI
        }
      }
    })

    // Handler should be registered
    searchVisible.value = true
    await nextTick()
    expect(selectionChangeHandler).not.toBeNull()

    // Unmount
    wrapper.unmount()

    // Handler should be unsubscribed
    expect(selectionChangeHandler).toBeNull()
  })
})
