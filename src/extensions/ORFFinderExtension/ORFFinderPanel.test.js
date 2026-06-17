import { describe, it, expect, beforeEach } from 'bun:test'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import ORFFinderPanel from './ORFFinderPanel.vue'
import { orfFinderVisible } from './state.js'

describe('ORFFinderPanel', () => {
  beforeEach(() => {
    orfFinderVisible.value = false
  })

  function mountPanel(extensionAPI) {
    return mount(ORFFinderPanel, {
      global: {
        provide: {
          extensionAPI: {
            getAnnotations: () => [],
            getSelectedSequence: () => '',
            setSelection: () => {},
            addAnnotation: () => {},
            ...extensionAPI
          }
        }
      }
    })
  }

  async function scanWithMinLength(wrapper, minLength) {
    orfFinderVisible.value = true
    await nextTick()

    const input = wrapper.find('.length-input')
    await input.setValue(minLength)
    await wrapper.find('.scan-btn').trigger('click')
    await nextTick()
  }

  it('does not report origin-spanning ORFs for linear sequences', async () => {
    const wrapper = mountPanel({
      getSequence: () => 'TAACCCCCCATG',
      isCircular: () => false
    })

    await scanWithMinLength(wrapper, 1)

    expect(wrapper.findAll('.result-item')).toHaveLength(0)
    expect(wrapper.text()).toContain('No ORFs found')
  })

  it('reports origin-spanning ORFs for circular sequences', async () => {
    const wrapper = mountPanel({
      getSequence: () => 'TAACCCCCCATG',
      isCircular: () => true
    })

    await scanWithMinLength(wrapper, 1)

    const results = wrapper.findAll('.result-item')
    expect(results).toHaveLength(1)
    expect(results[0].text()).toContain('10..3')
    expect(results[0].text()).toContain('1 aa')
  })
})
