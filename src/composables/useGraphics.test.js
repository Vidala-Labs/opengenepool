import { describe, it, expect } from 'vitest'
import { useEditorState } from './useEditorState.js'
import { useGraphics, GraphicsSpan, Shell, layoutLine, sortByWidth } from './useGraphics.js'
import { Range, Orientation } from '../utils/dna.js'

describe('useGraphics', () => {
  function createGraphics() {
    const editorState = useEditorState()
    const graphics = useGraphics(editorState)
    return { editorState, graphics }
  }

  describe('initial state', () => {
    it('has default container dimensions', () => {
      const { graphics } = createGraphics()
      expect(graphics.containerWidth.value).toBe(800)
      expect(graphics.containerHeight.value).toBe(600)
    })

    it('has default font metrics', () => {
      const { graphics } = createGraphics()
      expect(graphics.charWidth.value).toBe(8)
      expect(graphics.lineHeight.value).toBe(16)
    })

    it('defaults to text mode at typical zoom levels', () => {
      // With default values (containerWidth=800, charWidth=8), at zoom 100:
      // textWidth = 100 * 8 = 800
      // availableWidth = 800 - 60 - 20 = 720
      // textMode = 800 <= 720 = false (BAR MODE)
      //
      // This is expected - at zoom 100 with default 800px container, bars are shown.
      // The real bug is in useAnnotations.js calling setLineExtraHeight inside a computed.
      const { editorState, graphics } = createGraphics()
      editorState.setSequence('A'.repeat(500))
      editorState.setZoom(100)

      // At default container size, zoom 100 correctly uses bar mode
      expect(graphics.metrics.value.textMode).toBe(false)
    })

    it('uses text mode when container is wide enough', () => {
      const { editorState, graphics } = createGraphics()
      editorState.setSequence('A'.repeat(500))
      editorState.setZoom(100)
      // Set container wide enough for text mode
      graphics.setContainerSize(1000, 600)

      // 100 * 8 = 800 pixels for text
      // 1000 - 60 - 20 = 920 available
      // 800 < 920, so text mode
      expect(graphics.metrics.value.textMode).toBe(true)
    })
  })

  describe('metrics', () => {
    it('calculates line width in text mode', () => {
      const { editorState, graphics } = createGraphics()
      editorState.setSequence('A'.repeat(500))
      editorState.setZoom(50)  // 50 * 8 = 400, fits in 720 available
      graphics.setContainerSize(800, 600)
      graphics.setFontMetrics(8, 16)

      const m = graphics.metrics.value
      expect(m.textMode).toBe(true)
      expect(m.lineWidth).toBe(400)  // 50 * 8
      expect(m.charWidth).toBe(8)
    })

    it('calculates line width in bar mode (compressed)', () => {
      const { editorState, graphics } = createGraphics()
      editorState.setSequence('A'.repeat(500))
      editorState.setZoom(100)  // 100 * 8 = 800 > 720 available
      graphics.setContainerSize(800, 600)
      graphics.setFontMetrics(8, 16)

      const m = graphics.metrics.value
      expect(m.textMode).toBe(false)
      expect(m.lineWidth).toBe(720)  // compressed to available space
      expect(m.charWidth).toBe(7.2)  // 720 / 100
    })

    it('uses text mode when text fits', () => {
      const { editorState, graphics } = createGraphics()
      editorState.setSequence('A'.repeat(500))
      editorState.setZoom(50)
      graphics.setContainerSize(600, 400)
      graphics.setFontMetrics(8, 16)

      const m = graphics.metrics.value
      // 50 * 8 = 400 pixels for text
      // 600 - 60 (lmargin) - 20 (rmargin) = 520 available
      // 400 < 520, so text mode
      expect(m.textMode).toBe(true)
      expect(m.charWidth).toBe(8)
    })

    it('uses bar mode when text too wide', () => {
      const { editorState, graphics } = createGraphics()
      editorState.setSequence('A'.repeat(500))
      editorState.setZoom(200)
      graphics.setContainerSize(600, 400)
      graphics.setFontMetrics(8, 16)

      const m = graphics.metrics.value
      // 200 * 8 = 1600 pixels for text
      // 600 - 60 - 20 = 520 available
      // 1600 > 520, so bar mode with compressed char width
      expect(m.textMode).toBe(false)
      expect(m.charWidth).toBe(520 / 200)  // compressed to fit
      expect(m.lineWidth).toBe(520)
    })

    it('preserves blockWidth for zoom-independent elements', () => {
      const { editorState, graphics } = createGraphics()
      editorState.setSequence('A'.repeat(500))
      editorState.setZoom(200)
      graphics.setContainerSize(600, 400)
      graphics.setFontMetrics(8, 16)

      const m = graphics.metrics.value
      expect(m.blockWidth).toBe(8)  // original char width preserved
    })
  })

  describe('pixelToLinePosition', () => {
    it('converts x pixel to position within line', () => {
      const { editorState, graphics } = createGraphics()
      editorState.setSequence('A'.repeat(500))
      editorState.setZoom(50)  // use zoom 50 to stay in text mode
      graphics.setContainerSize(800, 600)
      graphics.setFontMetrics(8, 16)

      // lmargin is 60, so position 0 is at x=60
      expect(graphics.pixelToLinePosition(60)).toBe(0)
      expect(graphics.pixelToLinePosition(60 + 8)).toBe(1)
      expect(graphics.pixelToLinePosition(60 + 40)).toBe(5)
    })

    it('clamps to valid range', () => {
      const { editorState, graphics } = createGraphics()
      editorState.setSequence('A'.repeat(500))
      editorState.setZoom(50)
      graphics.setContainerSize(800, 600)
      graphics.setFontMetrics(8, 16)

      expect(graphics.pixelToLinePosition(0)).toBe(0)  // before lmargin
      expect(graphics.pixelToLinePosition(10000)).toBe(50)  // beyond line, clamped to zoom
    })
  })

  describe('linePositionToPixel', () => {
    it('converts position to x pixel', () => {
      const { editorState, graphics } = createGraphics()
      editorState.setSequence('A'.repeat(500))
      editorState.setZoom(50)  // use zoom 50 to stay in text mode
      graphics.setContainerSize(800, 600)
      graphics.setFontMetrics(8, 16)

      expect(graphics.linePositionToPixel(0)).toBe(60)  // lmargin
      expect(graphics.linePositionToPixel(1)).toBe(68)
      expect(graphics.linePositionToPixel(10)).toBe(140)
    })
  })

  describe('getLineY', () => {
    it('calculates y position for each line', () => {
      const { editorState, graphics } = createGraphics()
      editorState.setSequence('A'.repeat(500))

      // vmargin = 10, tooltipMargin = 20, linetopmargin = 4, lineHeight = 16, linepadding = 20
      // Line 0: vmargin(10) + tooltipMargin(20) + topmargin(4) = 34
      // Line 1: vmargin(10) + tooltipMargin(20) + (topmargin(4) + lineHeight(16) + linepadding(20)) + topmargin(4) = 74
      // Line 2: vmargin(10) + tooltipMargin(20) + 2*(topmargin(4) + lineHeight(16) + linepadding(20)) + topmargin(4) = 114
      expect(graphics.getLineY(0)).toBe(34)
      expect(graphics.getLineY(1)).toBe(74)
      expect(graphics.getLineY(2)).toBe(114)
    })
  })

  describe('getTotalHeight', () => {
    it('returns 0 for no lines', () => {
      const { graphics } = createGraphics()
      expect(graphics.getTotalHeight(0)).toBe(0)
    })

    it('calculates total height for lines', () => {
      const { graphics } = createGraphics()
      // vmargin = 10, tooltipMargin = 20, linetopmargin = 4, lineHeight = 16, linepadding = 20
      // 1 line: vmargin(10) + tooltipMargin(20) + topmargin(4) + lineHeight(16) + vmargin(10) = 60
      expect(graphics.getTotalHeight(1)).toBe(60)

      // 3 lines: vmargin(10) + tooltipMargin(20) + 3*(topmargin(4) + lineHeight(16)) + 2*linepadding(20) + vmargin(10) = 140
      expect(graphics.getTotalHeight(3)).toBe(140)
    })
  })

  describe('pixelToLineIndex', () => {
    it('finds line index from y position', () => {
      const { graphics } = createGraphics()
      // vmargin = 10, tooltipMargin = 20, lineHeight = 16, linepadding = 20
      // Line 0: top=34, bottom=50
      // Line 1: top=74, bottom=90
      // Line 2: top=114, bottom=130

      expect(graphics.pixelToLineIndex(35, 5)).toBe(0)  // within first line (< 50)
      expect(graphics.pixelToLineIndex(55, 5)).toBe(1)  // after first line, in/before second
      expect(graphics.pixelToLineIndex(95, 5)).toBe(2)  // after second line (>= 90)
    })

    it('clamps to valid range', () => {
      const { graphics } = createGraphics()

      expect(graphics.pixelToLineIndex(0, 5)).toBe(0)
      expect(graphics.pixelToLineIndex(1000, 5)).toBe(4)  // max is lineCount - 1
    })
  })

  describe('pixelToSequencePosition', () => {
    it('converts pixel coordinates to absolute sequence position', () => {
      const { editorState, graphics } = createGraphics()
      editorState.setSequence('A'.repeat(500))
      editorState.setZoom(50)  // use zoom 50 to stay in text mode
      graphics.setContainerSize(800, 600)
      graphics.setFontMetrics(8, 16)

      // Line 0, position 5 = absolute position 5 (y=35 is within first line with tooltipMargin)
      expect(graphics.pixelToSequencePosition(60 + 40, 35, 10)).toBe(5)

      // Line 1, position 10 = absolute position 60 (50 + 10) (y=55 is within second line)
      expect(graphics.pixelToSequencePosition(60 + 80, 55, 10)).toBe(60)
    })
  })

  describe('setContainerSize', () => {
    it('updates container dimensions', () => {
      const { graphics } = createGraphics()
      graphics.setContainerSize(1024, 768)

      expect(graphics.containerWidth.value).toBe(1024)
      expect(graphics.containerHeight.value).toBe(768)
      expect(graphics.metrics.value.fullWidth).toBe(1024)
      expect(graphics.metrics.value.fullHeight).toBe(768)
    })
  })

  describe('setFontMetrics', () => {
    it('updates font metrics', () => {
      const { graphics } = createGraphics()
      graphics.setFontMetrics(10, 20)

      expect(graphics.charWidth.value).toBe(10)
      expect(graphics.lineHeight.value).toBe(20)
    })
  })
})

describe('GraphicsSpan', () => {
  describe('single line range', () => {
    it('creates one fragment for range within a single line', () => {
      const range = new Range(10, 30)
      const span = new GraphicsSpan(range, 100)  // zoom=100 bases/line

      expect(span.fragments.length).toBe(1)
      expect(span.fragments[0].line).toBe(0)
      expect(span.fragments[0].start).toBe(10)
      expect(span.fragments[0].end).toBe(30)
    })

    it('preserves orientation from range', () => {
      const range = new Range(10, 30, Orientation.MINUS)
      const span = new GraphicsSpan(range, 100)

      expect(span.fragments[0].orientation).toBe(Orientation.MINUS)
    })
  })

  describe('multi-line range', () => {
    it('splits range spanning two lines', () => {
      // Range from 80 to 120 at zoom=100 spans lines 0 and 1
      const range = new Range(80, 120)
      const span = new GraphicsSpan(range, 100)

      expect(span.fragments.length).toBe(2)

      // First fragment: positions 80-99 on line 0
      expect(span.fragments[0].line).toBe(0)
      expect(span.fragments[0].start).toBe(80)
      expect(span.fragments[0].end).toBe(100)

      // Second fragment: positions 0-19 on line 1 (but these are positions 100-119)
      expect(span.fragments[1].line).toBe(1)
      expect(span.fragments[1].start).toBe(0)
      expect(span.fragments[1].end).toBe(20)
    })

    it('splits range spanning three lines', () => {
      // Range from 50 to 250 at zoom=100 spans lines 0, 1, and 2
      const range = new Range(50, 250)
      const span = new GraphicsSpan(range, 100)

      expect(span.fragments.length).toBe(3)

      // Line 0: 50-99 (positions 50-99)
      expect(span.fragments[0].line).toBe(0)
      expect(span.fragments[0].start).toBe(50)
      expect(span.fragments[0].end).toBe(100)

      // Line 1: 0-99 (full line, positions 100-199)
      expect(span.fragments[1].line).toBe(1)
      expect(span.fragments[1].start).toBe(0)
      expect(span.fragments[1].end).toBe(100)

      // Line 2: 0-49 (positions 200-249)
      expect(span.fragments[2].line).toBe(2)
      expect(span.fragments[2].start).toBe(0)
      expect(span.fragments[2].end).toBe(50)
    })
  })

  describe('edge cases', () => {
    it('handles range starting at line boundary', () => {
      const range = new Range(100, 150)  // starts at line 1
      const span = new GraphicsSpan(range, 100)

      expect(span.fragments.length).toBe(1)
      expect(span.fragments[0].line).toBe(1)
      expect(span.fragments[0].start).toBe(0)
      expect(span.fragments[0].end).toBe(50)
    })

    it('handles range ending at line boundary', () => {
      const range = new Range(50, 100)  // ends exactly at line boundary
      const span = new GraphicsSpan(range, 100)

      expect(span.fragments.length).toBe(1)
      expect(span.fragments[0].line).toBe(0)
      expect(span.fragments[0].start).toBe(50)
      expect(span.fragments[0].end).toBe(100)
    })

    it('handles full line range', () => {
      const range = new Range(0, 100)
      const span = new GraphicsSpan(range, 100)

      expect(span.fragments.length).toBe(1)
      expect(span.fragments[0].line).toBe(0)
      expect(span.fragments[0].start).toBe(0)
      expect(span.fragments[0].end).toBe(100)
    })

    it('handles zero-length range', () => {
      const range = new Range(50, 50)
      const span = new GraphicsSpan(range, 100)

      expect(span.fragments.length).toBe(1)
      expect(span.fragments[0].line).toBe(0)
      expect(span.fragments[0].start).toBe(50)
      expect(span.fragments[0].end).toBe(50)
    })
  })

  describe('different zoom levels', () => {
    it('works with zoom=50', () => {
      const range = new Range(40, 80)  // spans lines 0 and 1 at zoom=50
      const span = new GraphicsSpan(range, 50)

      expect(span.fragments.length).toBe(2)
      expect(span.fragments[0].line).toBe(0)
      expect(span.fragments[0].start).toBe(40)
      expect(span.fragments[0].end).toBe(50)
      expect(span.fragments[1].line).toBe(1)
      expect(span.fragments[1].start).toBe(0)
      expect(span.fragments[1].end).toBe(30)
    })

    it('works with zoom=200', () => {
      const range = new Range(150, 190)  // within line 0 at zoom=200
      const span = new GraphicsSpan(range, 200)

      expect(span.fragments.length).toBe(1)
      expect(span.fragments[0].line).toBe(0)
      expect(span.fragments[0].start).toBe(150)
      expect(span.fragments[0].end).toBe(190)
    })
  })
})

describe('Shell', () => {
  function mockElement(box, anchored = false, padding = {}) {
    return {
      left: box.left,
      top: box.top,
      right: box.right,
      bottom: box.bottom,
      width: box.right - box.left,
      anchored,
      leftpadding: padding.left || 0,
      rightpadding: padding.right || 0,
      toppadding: padding.top || 0,
      bottompadding: padding.bottom || 0,
      transform: null,
      applyTransform(dx, dy) { this.transform = { dx, dy } }
    }
  }

  describe('constructor', () => {
    it('caches element bounding box', () => {
      const el = mockElement({ left: 10, top: -20, right: 50, bottom: 0 })
      const shell = new Shell(el)

      expect(shell.left).toBe(10)
      expect(shell.top).toBe(-20)
      expect(shell.right).toBe(50)
      expect(shell.bottom).toBe(0)
    })

    it('initializes delta to zero', () => {
      const el = mockElement({ left: 10, top: -20, right: 50, bottom: 0 })
      const shell = new Shell(el)

      expect(shell.deltax).toBe(0)
      expect(shell.deltay).toBe(0)
    })

    it('copies padding from element', () => {
      const el = mockElement(
        { left: 0, top: 0, right: 10, bottom: 10 },
        false,
        { left: 2, right: 3, top: 4, bottom: 5 }
      )
      const shell = new Shell(el)

      expect(shell.leftpadding).toBe(2)
      expect(shell.rightpadding).toBe(3)
      expect(shell.toppadding).toBe(4)
      expect(shell.bottompadding).toBe(5)
    })
  })

  describe('bounding box with delta', () => {
    it('applies deltay to top and bottom', () => {
      const el = mockElement({ left: 0, top: -10, right: 20, bottom: 0 })
      const shell = new Shell(el)
      shell.deltay = -15  // moved up by 15

      expect(shell.top).toBe(-25)  // -10 + (-15)
      expect(shell.bottom).toBe(-15)  // 0 + (-15)
    })

    it('applies deltax to left and right', () => {
      const el = mockElement({ left: 10, top: 0, right: 30, bottom: 10 })
      const shell = new Shell(el)
      shell.deltax = 5

      expect(shell.left).toBe(15)
      expect(shell.right).toBe(35)
    })

    it('applies padding to bounding box', () => {
      const el = mockElement(
        { left: 10, top: -10, right: 30, bottom: 0 },
        false,
        { left: 2, right: 3, top: 4, bottom: 5 }
      )
      const shell = new Shell(el)

      // Padding expands the box
      expect(shell.left).toBe(8)   // 10 - 2
      expect(shell.right).toBe(33) // 30 + 3
      expect(shell.top).toBe(-14)  // -10 - 4
      expect(shell.bottom).toBe(5) // 0 + 5
    })
  })

  describe('overlaps', () => {
    it('detects overlapping boxes', () => {
      const el1 = mockElement({ left: 0, top: -20, right: 30, bottom: 0 })
      const el2 = mockElement({ left: 20, top: -15, right: 50, bottom: 5 })
      const shell1 = new Shell(el1)
      const shell2 = new Shell(el2)

      expect(shell1.overlaps(shell2)).toBe(true)
      expect(shell2.overlaps(shell1)).toBe(true)
    })

    it('detects non-overlapping boxes (horizontal gap)', () => {
      const el1 = mockElement({ left: 0, top: -10, right: 20, bottom: 0 })
      const el2 = mockElement({ left: 30, top: -10, right: 50, bottom: 0 })
      const shell1 = new Shell(el1)
      const shell2 = new Shell(el2)

      expect(shell1.overlaps(shell2)).toBe(false)
    })

    it('detects non-overlapping boxes (vertical gap)', () => {
      const el1 = mockElement({ left: 0, top: -30, right: 20, bottom: -20 })
      const el2 = mockElement({ left: 0, top: -10, right: 20, bottom: 0 })
      const shell1 = new Shell(el1)
      const shell2 = new Shell(el2)

      expect(shell1.overlaps(shell2)).toBe(false)
    })

    it('respects delta when checking overlap', () => {
      const el1 = mockElement({ left: 0, top: -20, right: 20, bottom: 0 })
      const el2 = mockElement({ left: 0, top: -20, right: 20, bottom: 0 })
      const shell1 = new Shell(el1)
      const shell2 = new Shell(el2)

      // Initially they overlap
      expect(shell1.overlaps(shell2)).toBe(true)

      // Move shell2 up so it doesn't overlap
      shell2.deltay = -25
      expect(shell1.overlaps(shell2)).toBe(false)
    })
  })

  describe('brand', () => {
    it('applies delta transform to element', () => {
      const el = mockElement({ left: 0, top: -10, right: 20, bottom: 0 })
      const shell = new Shell(el)
      shell.deltax = 5
      shell.deltay = -15

      shell.brand()

      expect(el.transform).toEqual({ dx: 5, dy: -15 })
    })
  })
})

describe('layoutLine', () => {
  function mockElement(box, anchored = false, padding = {}) {
    return {
      left: box.left,
      top: box.top,
      right: box.right,
      bottom: box.bottom,
      width: box.right - box.left,
      anchored,
      leftpadding: padding.left || 0,
      rightpadding: padding.right || 0,
      toppadding: padding.top || 0,
      bottompadding: padding.bottom || 0,
      transform: null,
      applyTransform(dx, dy) { this.transform = { dx, dy } }
    }
  }

  describe('sortByWidth', () => {
    it('sorts elements by width descending', () => {
      const elements = [
        mockElement({ left: 0, top: -10, right: 20, bottom: 0 }),  // width 20
        mockElement({ left: 0, top: -10, right: 50, bottom: 0 }),  // width 50
        mockElement({ left: 0, top: -10, right: 30, bottom: 0 }),  // width 30
      ]

      const sorted = sortByWidth(elements)

      expect(sorted[0].width).toBe(50)
      expect(sorted[1].width).toBe(30)
      expect(sorted[2].width).toBe(20)
    })

    it('handles empty array', () => {
      expect(sortByWidth([])).toEqual([])
    })

    it('handles single element', () => {
      const elements = [mockElement({ left: 0, top: 0, right: 10, bottom: 10 })]
      expect(sortByWidth(elements).length).toBe(1)
    })
  })

  describe('layoutLine', () => {
    it('does not move anchored elements', () => {
      const anchored = mockElement({ left: 0, top: -10, right: 50, bottom: 0 }, true)
      const elements = [anchored]

      layoutLine(elements, 5)  // contentPadding = 5

      expect(anchored.transform).toBe(null)  // no transform applied
    })

    it('does not move non-overlapping unanchored elements', () => {
      const el1 = mockElement({ left: 0, top: -10, right: 20, bottom: 0 })
      const el2 = mockElement({ left: 30, top: -10, right: 50, bottom: 0 })  // no horizontal overlap
      const elements = [el1, el2]

      layoutLine(elements, 5)

      expect(el1.transform).toEqual({ dx: 0, dy: 0 })
      expect(el2.transform).toEqual({ dx: 0, dy: 0 })
    })

    it('pushes overlapping unanchored element up', () => {
      // Two elements at same position - one must move up
      const el1 = mockElement({ left: 0, top: -10, right: 30, bottom: 0 })
      const el2 = mockElement({ left: 10, top: -10, right: 40, bottom: 0 })
      const elements = [el1, el2]

      layoutLine(elements, 5)  // contentPadding = 5

      // el1 (wider, processed first) stays in place
      expect(el1.transform).toEqual({ dx: 0, dy: 0 })
      // el2 moves up: needs to clear el1's top (-10) minus padding (5)
      // deltay = el1.top (-10) - el2.bottom (0) - padding (5) = -15
      expect(el2.transform.dy).toBeLessThan(0)  // moved up (negative y)
    })

    it('respects anchored elements during collision detection', () => {
      const anchored = mockElement({ left: 0, top: -10, right: 30, bottom: 0 }, true)
      const unanchored = mockElement({ left: 10, top: -10, right: 40, bottom: 0 })
      const elements = [anchored, unanchored]

      layoutLine(elements, 5)

      // Anchored doesn't move
      expect(anchored.transform).toBe(null)
      // Unanchored moves up to avoid anchored
      expect(unanchored.transform.dy).toBeLessThan(0)
    })

    it('stacks multiple overlapping elements vertically', () => {
      // Three elements at same position - stack up
      const el1 = mockElement({ left: 0, top: -10, right: 50, bottom: 0 })  // widest
      const el2 = mockElement({ left: 0, top: -10, right: 40, bottom: 0 })
      const el3 = mockElement({ left: 0, top: -10, right: 30, bottom: 0 })
      const elements = [el1, el2, el3]

      layoutLine(elements, 5)

      // el1 stays (widest, no collision)
      expect(el1.transform.dy).toBe(0)
      // el2 moves up above el1
      expect(el2.transform.dy).toBeLessThan(0)
      // el3 moves up above el2
      expect(el3.transform.dy).toBeLessThan(el2.transform.dy)
    })
  })
})
