import { describe, it, expect } from 'bun:test'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import SequenceLayer from './SequenceLayer.vue'

// Mock graphics provider
function createMockGraphics(textMode = true) {
  return {
    metrics: ref({
      lmargin: 50,
      charWidth: 8,
      blockWidth: 7,
      textMode,
      lineWidth: 400
    }),
    lineHeight: ref(16),
    getLineY: (lineIndex) => lineIndex * 16,
    pixelToLineIndex: (y, lineCount) => Math.min(Math.floor(y / 16), lineCount - 1),
    pixelToLinePosition: (x) => Math.floor((x - 50) / 8)
  }
}

// Mock editorState for normal mode
function createMockEditorState(lines = []) {
  return {
    lines: ref(lines),
    zoomLevel: ref(50),
    lineCount: ref(lines.length),
    sequenceLength: ref(lines.length * 50),
    lineToPosition: (lineIndex, linePos) => lineIndex * 50 + linePos,
    positionInLine: (pos) => pos % 50
  }
}

// Mock selection composable
function createMockSelection() {
  return {
    domain: ref(null),
    isSelected: ref(false),
    startSelection: () => {},
    updateSelection: () => {},
    endSelection: () => {},
    extendToPosition: () => {}
  }
}

// Mock alignment lines for alignment mode
function createMockAlignmentLines() {
  return [
    {
      index: 0,
      start: 0,
      end: 8,
      targetText: 'ATCGATCG',
      queryText: 'ATCGAT-G',
      matchText: '||||||  ',
      targetPosition: 1,
      queryPosition: 1
    }
  ]
}

describe('SequenceLayer', () => {
  describe('Normal mode', () => {
    it('renders sequence rows in normal mode', () => {
      const lines = [
        { index: 0, start: 0, end: 8, position: 1, text: 'ATCGATCG' },
        { index: 1, start: 8, end: 16, position: 9, text: 'GCTAGCTA' }
      ]

      const wrapper = mount(SequenceLayer, {
        global: {
          provide: {
            editorState: createMockEditorState(lines),
            graphics: createMockGraphics(true),
            selection: createMockSelection()
          }
        }
      })

      // Normal mode uses .sequence-line class
      const rows = wrapper.findAll('.sequence-line')
      expect(rows.length).toBe(2)
    })

    it('renders position labels', () => {
      const lines = [
        { index: 0, start: 0, end: 8, position: 1, text: 'ATCGATCG' }
      ]

      const wrapper = mount(SequenceLayer, {
        global: {
          provide: {
            editorState: createMockEditorState(lines),
            graphics: createMockGraphics(true),
            selection: createMockSelection()
          }
        }
      })

      const label = wrapper.find('.position-label')
      expect(label.exists()).toBe(true)
      expect(label.text()).toBe('1')
    })

    it('renders sequence text in text mode', () => {
      const lines = [
        { index: 0, start: 0, end: 8, position: 1, text: 'ATCGATCG' }
      ]

      const wrapper = mount(SequenceLayer, {
        global: {
          provide: {
            editorState: createMockEditorState(lines),
            graphics: createMockGraphics(true),
            selection: createMockSelection()
          }
        }
      })

      const text = wrapper.find('.sequence-text')
      expect(text.exists()).toBe(true)
      expect(text.text()).toBe('ATCGATCG')
    })

    it('renders bar in bar mode', () => {
      const lines = [
        { index: 0, start: 0, end: 8, position: 1, text: 'ATCGATCG' }
      ]

      const wrapper = mount(SequenceLayer, {
        global: {
          provide: {
            editorState: createMockEditorState(lines),
            graphics: createMockGraphics(false),
            selection: createMockSelection()
          }
        }
      })

      const text = wrapper.find('.sequence-text')
      expect(text.exists()).toBe(false)

      const bar = wrapper.find('.sequence-bar')
      expect(bar.exists()).toBe(true)
    })

    it('has mouse overlay for each line', () => {
      const lines = [
        { index: 0, start: 0, end: 8, position: 1, text: 'ATCGATCG' }
      ]

      const wrapper = mount(SequenceLayer, {
        global: {
          provide: {
            editorState: createMockEditorState(lines),
            graphics: createMockGraphics(true),
            selection: createMockSelection()
          }
        }
      })

      const overlay = wrapper.find('.sequence-overlay')
      expect(overlay.exists()).toBe(true)
    })

    it('emits contextmenu event with line context', async () => {
      const lines = [
        { index: 0, start: 0, end: 8, position: 1, text: 'ATCGATCG' }
      ]

      const wrapper = mount(SequenceLayer, {
        global: {
          provide: {
            editorState: createMockEditorState(lines),
            graphics: createMockGraphics(true),
            selection: createMockSelection()
          }
        }
      })

      const overlay = wrapper.find('.sequence-overlay')
      await overlay.trigger('contextmenu')

      expect(wrapper.emitted('contextmenu')).toBeTruthy()
      expect(wrapper.emitted('contextmenu')[0][0]).toHaveProperty('lineIndex', 0)
    })
  })

  describe('Alignment mode - target', () => {
    it('renders target sequence with alignment-target-text class', () => {
      const alignmentLines = createMockAlignmentLines()

      const wrapper = mount(SequenceLayer, {
        props: {
          mode: 'target',
          lines: alignmentLines,
          positionMap: [0, 1, 2, 3, 4, 5, 6, 7],
          yOffset: 0,
          blockHeight: 48
        },
        global: {
          provide: {
            editorState: createMockEditorState([]),
            graphics: createMockGraphics(true),
            selection: createMockSelection()
          }
        }
      })

      const targetText = wrapper.find('.alignment-target-text')
      expect(targetText.exists()).toBe(true)
      expect(targetText.text()).toBe('ATCGATCG')
    })

    it('renders position labels for target', () => {
      const alignmentLines = createMockAlignmentLines()

      const wrapper = mount(SequenceLayer, {
        props: {
          mode: 'target',
          lines: alignmentLines,
          positionMap: [0, 1, 2, 3, 4, 5, 6, 7],
          yOffset: 0,
          blockHeight: 48
        },
        global: {
          provide: {
            editorState: createMockEditorState([]),
            graphics: createMockGraphics(true),
            selection: createMockSelection()
          }
        }
      })

      const label = wrapper.find('.position-label')
      expect(label.exists()).toBe(true)
      expect(label.text()).toBe('1')
    })
  })

  describe('Alignment mode - query', () => {
    it('renders query sequence with alignment-query-text class', () => {
      const alignmentLines = createMockAlignmentLines()

      const wrapper = mount(SequenceLayer, {
        props: {
          mode: 'query',
          lines: alignmentLines,
          positionMap: [0, 1, 2, 3, 4, 5, null, 6], // null for gap
          yOffset: 32,
          blockHeight: 48
        },
        global: {
          provide: {
            editorState: createMockEditorState([]),
            graphics: createMockGraphics(true),
            selection: createMockSelection()
          }
        }
      })

      const queryText = wrapper.find('.alignment-query-text')
      expect(queryText.exists()).toBe(true)
      expect(queryText.text()).toBe('ATCGAT-G')
    })

    it('renders position labels for query', () => {
      const alignmentLines = createMockAlignmentLines()

      const wrapper = mount(SequenceLayer, {
        props: {
          mode: 'query',
          lines: alignmentLines,
          positionMap: [0, 1, 2, 3, 4, 5, null, 6],
          yOffset: 32,
          blockHeight: 48
        },
        global: {
          provide: {
            editorState: createMockEditorState([]),
            graphics: createMockGraphics(true),
            selection: createMockSelection()
          }
        }
      })

      const label = wrapper.find('.position-label')
      expect(label.exists()).toBe(true)
      expect(label.text()).toBe('1')
    })
  })

  describe('Bar mode in alignment', () => {
    it('renders bar for target in bar mode', () => {
      const alignmentLines = createMockAlignmentLines()

      const wrapper = mount(SequenceLayer, {
        props: {
          mode: 'target',
          lines: alignmentLines,
          positionMap: [0, 1, 2, 3, 4, 5, 6, 7],
          yOffset: 0,
          blockHeight: 48
        },
        global: {
          provide: {
            editorState: createMockEditorState([]),
            graphics: createMockGraphics(false),
            selection: createMockSelection()
          }
        }
      })

      const bar = wrapper.find('.sequence-bar')
      expect(bar.exists()).toBe(true)

      const text = wrapper.find('.sequence-text')
      expect(text.exists()).toBe(false)
    })

    it('preserves whitespace in aligned sequences with gaps using non-breaking spaces', () => {
      // Aligned sequences with gaps (represented as spaces)
      const alignmentLines = [{
        index: 0,
        targetText: 'ATG  ATCG',  // Multiple consecutive gaps
        targetPosition: 1
      }]

      const wrapper = mount(SequenceLayer, {
        props: {
          mode: 'target',
          lines: alignmentLines,
          positionMap: [0, 1, 2, -1, -1, 3, 4, 5, 6],
          yOffset: 0,
          blockHeight: 48
        },
        global: {
          provide: {
            editorState: createMockEditorState([]),
            graphics: createMockGraphics(true),
            selection: createMockSelection()
          }
        }
      })

      const text = wrapper.find('.sequence-text')
      expect(text.exists()).toBe(true)
      // Spaces are converted to non-breaking spaces (\u00A0) to prevent SVG collapse
      expect(text.text()).toBe('ATG\u00A0\u00A0ATCG')
    })
  })
})
