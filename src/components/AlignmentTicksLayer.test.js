import { describe, it, expect } from 'bun:test'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import AlignmentTicksLayer from './AlignmentTicksLayer.vue'

// Mock graphics provider
function createMockGraphics(textMode = true) {
  return {
    metrics: ref({
      lmargin: 50,
      charWidth: 8,
      blockWidth: 7,
      textMode
    }),
    lineHeight: ref(16)
  }
}

// Mock alignment lines. `start` is the ALIGNED column the line begins at
// (index * zoom); for index 1 at zoom 100 that is 100 — deliberately different
// from the ordinal so a contextmenu emit can't accidentally pass the index.
function createMockAlignmentLines() {
  return [
    {
      index: 0,
      start: 0,
      matchText: '|||  ||'
    },
    {
      index: 1,
      start: 100,
      matchText: '||||||||'
    }
  ]
}

describe('AlignmentTicksLayer', () => {
  it('renders nothing when not in alignment mode', () => {
    const wrapper = mount(AlignmentTicksLayer, {
      global: {
        provide: {
          graphics: createMockGraphics(true),
          isAlignmentMode: ref(false),
          alignmentLines: ref([]),
          alignmentBlockHeight: ref(0)
        }
      }
    })

    const layer = wrapper.find('.alignment-ticks-layer')
    expect(layer.exists()).toBe(false)
  })

  it('renders match ticks in alignment mode', () => {
    const alignmentLines = createMockAlignmentLines()

    const wrapper = mount(AlignmentTicksLayer, {
      global: {
        provide: {
          graphics: createMockGraphics(true),
          isAlignmentMode: ref(true),
          alignmentLines: ref(alignmentLines),
          alignmentBlockHeight: ref(48)
        }
      }
    })

    const layer = wrapper.find('.alignment-ticks-layer')
    expect(layer.exists()).toBe(true)

    const ticks = wrapper.findAll('.alignment-ticks')
    expect(ticks.length).toBe(2)
  })

  it('renders match text in text mode', () => {
    const alignmentLines = createMockAlignmentLines()

    const wrapper = mount(AlignmentTicksLayer, {
      global: {
        provide: {
          graphics: createMockGraphics(true),
          isAlignmentMode: ref(true),
          alignmentLines: ref(alignmentLines),
          alignmentBlockHeight: ref(48)
        }
      }
    })

    const matchTexts = wrapper.findAll('.alignment-match-text')
    expect(matchTexts.length).toBe(2)
    expect(matchTexts[0].text()).toBe('|||\u00A0\u00A0||')
    expect(matchTexts[1].text()).toBe('||||||||')
  })

  it('hides match text in bar mode', () => {
    const alignmentLines = createMockAlignmentLines()

    const wrapper = mount(AlignmentTicksLayer, {
      global: {
        provide: {
          graphics: createMockGraphics(false),
          isAlignmentMode: ref(true),
          alignmentLines: ref(alignmentLines),
          alignmentBlockHeight: ref(48)
        }
      }
    })

    const matchTexts = wrapper.findAll('.alignment-match-text')
    expect(matchTexts.length).toBe(0)
  })

  it('renders empty position label placeholder', () => {
    const alignmentLines = [{ index: 0, matchText: '|||' }]

    const wrapper = mount(AlignmentTicksLayer, {
      global: {
        provide: {
          graphics: createMockGraphics(true),
          isAlignmentMode: ref(true),
          alignmentLines: ref(alignmentLines),
          alignmentBlockHeight: ref(48)
        }
      }
    })

    const label = wrapper.find('.position-label')
    expect(label.exists()).toBe(true)
    expect(label.text()).toBe('')
  })

  it('positions ticks at correct Y offset (lineHeight below block start)', () => {
    const alignmentLines = [{ index: 0, matchText: '|||' }]

    const wrapper = mount(AlignmentTicksLayer, {
      global: {
        provide: {
          graphics: createMockGraphics(true),
          isAlignmentMode: ref(true),
          alignmentLines: ref(alignmentLines),
          alignmentBlockHeight: ref(48)
        }
      }
    })

    // The alignment-ticks group has the transform
    // First line (index 0) should be at Y = 0 * 48 + 16 = 16
    const ticksGroup = wrapper.find('.alignment-ticks')
    expect(ticksGroup.attributes('transform')).toBe('translate(0, 16)')
  })

  it('preserves whitespace in match text using non-breaking spaces', () => {
    // Multiple consecutive spaces should not be collapsed
    const alignmentLines = [{ index: 0, matchText: '||    ||' }]

    const wrapper = mount(AlignmentTicksLayer, {
      global: {
        provide: {
          graphics: createMockGraphics(true),
          isAlignmentMode: ref(true),
          alignmentLines: ref(alignmentLines),
          alignmentBlockHeight: ref(48)
        }
      }
    })

    const matchText = wrapper.find('.alignment-match-text')
    // Spaces are converted to non-breaking spaces (\u00A0) to prevent SVG collapse
    expect(matchText.text()).toBe('||\u00A0\u00A0\u00A0\u00A0||')
  })

  it('contextmenu emits the line ALIGNED START, not the ordinal index', () => {
    // Regression: the editor maps a match-line right-click's clientX to an aligned
    // column relative to the line's start offset. The overlay must therefore emit
    // line.start (e.g. 100 for the second line), not line.index (1). Emitting the
    // ordinal placed the resolved column near 0 \u2014 a matching column \u2014 so the
    // "Annotate mutation/indel" item never appeared.
    const alignmentLines = createMockAlignmentLines()

    const wrapper = mount(AlignmentTicksLayer, {
      global: {
        provide: {
          graphics: createMockGraphics(true),
          isAlignmentMode: ref(true),
          alignmentLines: ref(alignmentLines),
          alignmentBlockHeight: ref(48)
        }
      }
    })

    // Second line: index 1, start 100.
    const overlay = wrapper.findAll('rect.alignment-match-overlay')[1]
    expect(overlay.exists()).toBe(true)

    overlay.trigger('contextmenu')

    const emitted = wrapper.emitted('contextmenu')
    expect(emitted).toBeTruthy()
    expect(emitted[0][0].lineIndex).toBe(100) // line.start, not the ordinal 1
  })
})
