import { describe, it, expect } from 'bun:test'
import { mount } from '@vue/test-utils'
import { PrimerBindExtension } from './index.js'
import PrimerBindEditor from './PrimerBindEditor.vue'
import PrimerBindDisplay from './PrimerBindDisplay.vue'

describe('PrimerBindExtension', () => {
  it('exports extension with correct structure', () => {
    expect(PrimerBindExtension.key).toBe('primer_bind')
    expect(PrimerBindExtension.label).toBe("3' Primer binding bases")
    expect(PrimerBindExtension.forTypes).toContain('primer')
    expect(PrimerBindExtension.editor).toBe(PrimerBindEditor)
    expect(PrimerBindExtension.display).toBe(PrimerBindDisplay)
  })
})

describe('PrimerBindEditor', () => {
  it('renders a number input', () => {
    const wrapper = mount(PrimerBindEditor, {
      props: {
        modelValue: 20,
        annotation: { length: 50 }
      }
    })

    const input = wrapper.find('input[type="number"]')
    expect(input.exists()).toBe(true)
  })

  it('sets max to annotation length', () => {
    const wrapper = mount(PrimerBindEditor, {
      props: {
        modelValue: 20,
        annotation: { length: 50 }
      }
    })

    const input = wrapper.find('input[type="number"]')
    expect(input.attributes('max')).toBe('50')
  })

  it('sets min to 0', () => {
    const wrapper = mount(PrimerBindEditor, {
      props: {
        modelValue: 20,
        annotation: { length: 50 }
      }
    })

    const input = wrapper.find('input[type="number"]')
    expect(input.attributes('min')).toBe('0')
  })

  it('displays current value', () => {
    const wrapper = mount(PrimerBindEditor, {
      props: {
        modelValue: 25,
        annotation: { length: 50 }
      }
    })

    const input = wrapper.find('input[type="number"]')
    expect(input.element.value).toBe('25')
  })

  it('emits update:modelValue on input', async () => {
    const wrapper = mount(PrimerBindEditor, {
      props: {
        modelValue: 20,
        annotation: { length: 50 }
      }
    })

    const input = wrapper.find('input[type="number"]')
    await input.setValue('30')

    expect(wrapper.emitted('update:modelValue')).toBeTruthy()
    expect(wrapper.emitted('update:modelValue')[0]).toEqual([30])
  })

  it('emits integer value, not string', async () => {
    const wrapper = mount(PrimerBindEditor, {
      props: {
        modelValue: 20,
        annotation: { length: 50 }
      }
    })

    const input = wrapper.find('input[type="number"]')
    await input.setValue('35')

    const emitted = wrapper.emitted('update:modelValue')[0][0]
    expect(typeof emitted).toBe('number')
    expect(emitted).toBe(35)
  })

  it('handles empty/null modelValue', () => {
    const wrapper = mount(PrimerBindEditor, {
      props: {
        modelValue: null,
        annotation: { length: 50 }
      }
    })

    const input = wrapper.find('input[type="number"]')
    expect(input.element.value).toBe('')
  })
})

describe('PrimerBindDisplay', () => {
  it('renders the value with "bp" suffix', () => {
    const wrapper = mount(PrimerBindDisplay, {
      props: {
        value: 25
      }
    })

    expect(wrapper.text()).toContain('25')
    expect(wrapper.text()).toContain('bp')
  })

  it('renders empty state when no value', () => {
    const wrapper = mount(PrimerBindDisplay, {
      props: {
        value: null
      }
    })

    expect(wrapper.text()).toBe('')
  })

  it('renders 0 as valid value', () => {
    const wrapper = mount(PrimerBindDisplay, {
      props: {
        value: 0
      }
    })

    expect(wrapper.text()).toContain('0')
  })
})
