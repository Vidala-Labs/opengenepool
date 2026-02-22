import { describe, it, expect, beforeEach, mock } from 'bun:test'
import { useSelection, SelectionDomain } from './useSelection.js'
import { useEditorState } from './useEditorState.js'
import { useGraphics } from './useGraphics.js'
import { createEventBus } from './useEventBus.js'
import { Range, Span, Orientation } from '../utils/dna.js'

describe('SelectionDomain', () => {
  describe('constructor', () => {
    it('creates empty domain', () => {
      const domain = new SelectionDomain()
      expect(domain.ranges.length).toBe(0)
    })

    it('parses string spec', () => {
      const domain = new SelectionDomain('10..20')
      expect(domain.ranges.length).toBe(1)
      expect(domain.ranges[0].start).toBe(10)
      expect(domain.ranges[0].end).toBe(20)
    })

    it('parses multi-range string', () => {
      const domain = new SelectionDomain('10..20 + 30..40')
      expect(domain.ranges.length).toBe(2)
    })

    it('accepts Range array', () => {
      const ranges = [new Range(10, 20), new Range(30, 40)]
      const domain = new SelectionDomain(ranges)
      expect(domain.ranges.length).toBe(2)
    })
  })

  describe('contains', () => {
    it('returns true when position is in a range', () => {
      const domain = new SelectionDomain('10..20 + 30..40')
      expect(domain.contains(15)).toBe(true)
      expect(domain.contains(35)).toBe(true)
    })

    it('returns false when position is not in any range', () => {
      const domain = new SelectionDomain('10..20 + 30..40')
      expect(domain.contains(5)).toBe(false)
      expect(domain.contains(25)).toBe(false)
      expect(domain.contains(45)).toBe(false)
    })
  })

  describe('addRange', () => {
    it('adds a new range', () => {
      const domain = new SelectionDomain('10..20')
      domain.addRange(new Range(30, 40))
      expect(domain.ranges.length).toBe(2)
    })
  })

  describe('removeRange', () => {
    it('removes a range by index', () => {
      const domain = new SelectionDomain('10..20 + 30..40')
      domain.removeRange(0)
      expect(domain.ranges.length).toBe(1)
      expect(domain.ranges[0].start).toBe(30)
    })
  })

  describe('orientation', () => {
    it('returns dominant orientation', () => {
      const domain = new SelectionDomain([
        new Range(0, 100, Orientation.PLUS),
        new Range(200, 210, Orientation.MINUS)
      ])
      expect(domain.orientation).toBe(Orientation.PLUS)
    })
  })
})

describe('useSelection', () => {
  let editorState
  let graphics
  let eventBus
  let selection

  function createSelection() {
    editorState = useEditorState()
    editorState.setSequence('A'.repeat(500))
    editorState.setZoom(100)
    graphics = useGraphics(editorState)
    eventBus = createEventBus()
    selection = useSelection(editorState, graphics, eventBus)
    return selection
  }

  describe('initial state', () => {
    it('starts with no selection', () => {
      const sel = createSelection()
      expect(sel.isSelected.value).toBe(false)
      expect(sel.domain.value).toBe(null)
    })
  })

  describe('startSelection', () => {
    it('creates new selection at position', () => {
      const sel = createSelection()
      sel.startSelection(50)

      expect(sel.isSelected.value).toBe(true)
      expect(sel.domain.value.ranges.length).toBe(1)
      expect(sel.domain.value.ranges[0].start).toBe(50)
      expect(sel.domain.value.ranges[0].end).toBe(50)
    })

    it('clears existing selection when not extending', () => {
      const sel = createSelection()
      sel.select('10..20')
      sel.startSelection(50, false)

      expect(sel.domain.value.ranges.length).toBe(1)
      expect(sel.domain.value.ranges[0].start).toBe(50)
    })

    it('adds new range when extending', () => {
      const sel = createSelection()
      sel.select('10..20')
      sel.startSelection(50, true)

      expect(sel.domain.value.ranges.length).toBe(2)
    })

    it('does not add range when extending into existing selection', () => {
      const sel = createSelection()
      sel.select('10..60')
      sel.startSelection(50, true)

      expect(sel.domain.value.ranges.length).toBe(1)
    })
  })

  describe('updateSelection', () => {
    it('updates end position during drag', () => {
      const sel = createSelection()
      sel.startSelection(50)
      sel.updateSelection(70)

      expect(sel.domain.value.ranges[0].start).toBe(50)
      expect(sel.domain.value.ranges[0].end).toBe(70)
    })

    it('flips orientation when dragging backwards', () => {
      const sel = createSelection()
      sel.startSelection(50)
      sel.updateSelection(30)

      expect(sel.domain.value.ranges[0].start).toBe(30)
      expect(sel.domain.value.ranges[0].end).toBe(50)
      expect(sel.domain.value.ranges[0].orientation).toBe(Orientation.MINUS)
    })

    it('respects drag limits from other ranges', () => {
      const sel = createSelection()
      sel.select('10..20')
      sel.startSelection(50, true)
      sel.updateSelection(15)  // Try to drag into existing range

      // Should be clamped to the end of the first range
      expect(sel.domain.value.ranges[1].start).toBe(20)
    })
  })

  describe('select', () => {
    it('creates selection from string spec', () => {
      const sel = createSelection()
      sel.select('10..50')

      expect(sel.isSelected.value).toBe(true)
      expect(sel.domain.value.ranges[0].start).toBe(10)
      expect(sel.domain.value.ranges[0].end).toBe(50)
    })

    it('creates selection from Domain object', () => {
      const sel = createSelection()
      const domain = new SelectionDomain('10..50')
      sel.select(domain)

      expect(sel.domain.value.ranges.length).toBe(1)
    })
  })

  describe('unselect', () => {
    it('clears the selection', () => {
      const sel = createSelection()
      sel.select('10..50')
      sel.unselect()

      expect(sel.isSelected.value).toBe(false)
      expect(sel.domain.value).toBe(null)
    })
  })

  describe('selectAll', () => {
    it('selects entire sequence', () => {
      const sel = createSelection()
      sel.selectAll()

      expect(sel.domain.value.ranges[0].start).toBe(0)
      expect(sel.domain.value.ranges[0].end).toBe(500)
    })
  })

  describe('range operations', () => {
    describe('flip', () => {
      it('flips range orientation', () => {
        const sel = createSelection()
        sel.select('10..50')
        sel.flip(0)

        expect(sel.domain.value.ranges[0].orientation).toBe(Orientation.MINUS)
      })

      it('flips back to plus', () => {
        const sel = createSelection()
        sel.select('(10..50)')  // minus strand
        sel.flip(0)

        expect(sel.domain.value.ranges[0].orientation).toBe(Orientation.PLUS)
      })
    })

    describe('setOrientation', () => {
      it('sets to plus', () => {
        const sel = createSelection()
        sel.select('10..50')
        sel.setOrientation(0, Orientation.PLUS)
        expect(sel.domain.value.ranges[0].orientation).toBe(Orientation.PLUS)
      })

      it('sets to minus', () => {
        const sel = createSelection()
        sel.select('10..50')
        sel.setOrientation(0, Orientation.MINUS)
        expect(sel.domain.value.ranges[0].orientation).toBe(Orientation.MINUS)
      })

      it('sets to undirected', () => {
        const sel = createSelection()
        sel.select('10..50')
        sel.setOrientation(0, Orientation.NONE)
        expect(sel.domain.value.ranges[0].orientation).toBe(Orientation.NONE)
      })
    })

    describe('splitRange', () => {
      it('splits range at position', () => {
        const sel = createSelection()
        sel.select('10..50')
        sel.splitRange(30)

        expect(sel.domain.value.ranges.length).toBe(2)
        expect(sel.domain.value.ranges[0].end).toBe(30)
        expect(sel.domain.value.ranges[1].start).toBe(30)
      })

      it('preserves orientation in split', () => {
        const sel = createSelection()
        sel.select('(10..50)')  // minus strand
        sel.splitRange(30)

        expect(sel.domain.value.ranges[0].orientation).toBe(Orientation.MINUS)
        expect(sel.domain.value.ranges[1].orientation).toBe(Orientation.MINUS)
      })
    })

    describe('deleteRange', () => {
      it('removes range from domain', () => {
        const sel = createSelection()
        sel.select('10..20 + 30..40')
        sel.deleteRange(0)

        expect(sel.domain.value.ranges.length).toBe(1)
        expect(sel.domain.value.ranges[0].start).toBe(30)
      })

      it('clears selection when last range deleted', () => {
        const sel = createSelection()
        sel.select('10..20')
        sel.deleteRange(0)

        expect(sel.isSelected.value).toBe(false)
      })
    })

    describe('moveRange', () => {
      it('moves range up in order', () => {
        const sel = createSelection()
        sel.select('10..20 + 30..40 + 50..60')
        sel.moveRange(2, 0)  // Move last to first

        expect(sel.domain.value.ranges[0].start).toBe(50)
        expect(sel.domain.value.ranges[1].start).toBe(10)
      })

      it('moves range down in order', () => {
        const sel = createSelection()
        sel.select('10..20 + 30..40 + 50..60')
        sel.moveRange(0, 2)  // Move first to last

        expect(sel.domain.value.ranges[2].start).toBe(10)
      })
    })
  })

  describe('getSelectionPath', () => {
    it('returns empty string when no selection', () => {
      const sel = createSelection()
      expect(sel.getSelectionPath(0)).toBe('')
    })

    it('returns rectangle path for single-line selection', () => {
      const sel = createSelection()
      sel.select('10..30')
      graphics.setContainerSize(800, 600)

      const path = sel.getSelectionPath(0)
      expect(path).toContain('M')  // Move command
      expect(path).toContain('H')  // Horizontal line
      expect(path).toContain('V')  // Vertical line
      expect(path).toContain('Z')  // Close path
    })
  })

  describe('event bus integration', () => {
    it('responds to startselect event', () => {
      const sel = createSelection()
      eventBus.emit('startselect', { pos: 50, mode: false })

      expect(sel.isSelected.value).toBe(true)
    })

    it('responds to select event', () => {
      const sel = createSelection()
      eventBus.emit('select', { domain: '10..50' })

      expect(sel.domain.value.ranges[0].start).toBe(10)
    })

    it('responds to unselect event', () => {
      const sel = createSelection()
      sel.select('10..50')
      eventBus.emit('unselect')

      expect(sel.isSelected.value).toBe(false)
    })

    it('responds to extendselect event by adding range to existing selection', () => {
      const sel = createSelection()
      sel.select('10..50')
      eventBus.emit('extendselect', { domain: '100..150' })

      expect(sel.domain.value.ranges.length).toBe(2)
      expect(sel.domain.value.ranges[0].start).toBe(10)
      expect(sel.domain.value.ranges[0].end).toBe(50)
      expect(sel.domain.value.ranges[1].start).toBe(100)
      expect(sel.domain.value.ranges[1].end).toBe(150)
    })

    it('responds to extendselect by creating new selection if none exists', () => {
      const sel = createSelection()
      eventBus.emit('extendselect', { domain: '100..150' })

      expect(sel.isSelected.value).toBe(true)
      expect(sel.domain.value.ranges.length).toBe(1)
      expect(sel.domain.value.ranges[0].start).toBe(100)
      expect(sel.domain.value.ranges[0].end).toBe(150)
    })

    it('merges overlapping ranges when extending selection', () => {
      const sel = createSelection()
      sel.select('10..50')
      eventBus.emit('extendselect', { domain: '30..70' })

      // Should merge into single range
      expect(sel.domain.value.ranges.length).toBe(1)
      expect(sel.domain.value.ranges[0].start).toBe(10)
      expect(sel.domain.value.ranges[0].end).toBe(70)
    })

    it('merges fully contained range when extending selection', () => {
      const sel = createSelection()
      sel.select('10..100')
      eventBus.emit('extendselect', { domain: '30..50' })

      // New range is fully contained - should stay as original
      expect(sel.domain.value.ranges.length).toBe(1)
      expect(sel.domain.value.ranges[0].start).toBe(10)
      expect(sel.domain.value.ranges[0].end).toBe(100)
    })

    it('merges when new range fully contains existing', () => {
      const sel = createSelection()
      sel.select('30..50')
      eventBus.emit('extendselect', { domain: '10..100' })

      // New range contains existing - should expand to new range
      expect(sel.domain.value.ranges.length).toBe(1)
      expect(sel.domain.value.ranges[0].start).toBe(10)
      expect(sel.domain.value.ranges[0].end).toBe(100)
    })

    it('converts all ranges to new orientation when extending with opposite direction', () => {
      const sel = createSelection()
      sel.select('10..50')  // plus strand
      eventBus.emit('extendselect', { domain: '(30..70)' })  // minus strand, overlapping

      // Should merge and adopt the new orientation
      expect(sel.domain.value.ranges.length).toBe(1)
      expect(sel.domain.value.ranges[0].start).toBe(10)
      expect(sel.domain.value.ranges[0].end).toBe(70)
      expect(sel.domain.value.ranges[0].orientation).toBe(Orientation.MINUS)
    })

    it('converts multiple existing ranges to new orientation', () => {
      const sel = createSelection()
      sel.select('10..30 + 50..70')  // two plus strand ranges
      eventBus.emit('extendselect', { domain: '(20..60)' })  // minus strand, overlaps both

      // Should merge all into one minus strand range
      expect(sel.domain.value.ranges.length).toBe(1)
      expect(sel.domain.value.ranges[0].start).toBe(10)
      expect(sel.domain.value.ranges[0].end).toBe(70)
      expect(sel.domain.value.ranges[0].orientation).toBe(Orientation.MINUS)
    })

    it('keeps non-overlapping ranges separate', () => {
      const sel = createSelection()
      sel.select('10..30')
      eventBus.emit('extendselect', { domain: '50..70' })

      // No overlap - should have two separate ranges
      expect(sel.domain.value.ranges.length).toBe(2)
      expect(sel.domain.value.ranges[0].start).toBe(10)
      expect(sel.domain.value.ranges[0].end).toBe(30)
      expect(sel.domain.value.ranges[1].start).toBe(50)
      expect(sel.domain.value.ranges[1].end).toBe(70)
    })
  })

  describe('extendToPosition', () => {
    it('extends range end when clicking beyond current end', () => {
      const sel = createSelection()
      sel.select('10..50')

      const result = sel.extendToPosition(80)

      expect(result).toBe(true)
      expect(sel.domain.value.ranges.length).toBe(1)
      expect(sel.domain.value.ranges[0].start).toBe(10)
      expect(sel.domain.value.ranges[0].end).toBe(80)
    })

    it('extends range start when clicking before current start', () => {
      const sel = createSelection()
      sel.select('50..100')

      const result = sel.extendToPosition(20)

      expect(result).toBe(true)
      expect(sel.domain.value.ranges.length).toBe(1)
      expect(sel.domain.value.ranges[0].start).toBe(20)
      expect(sel.domain.value.ranges[0].end).toBe(100)
    })

    it('preserves plus orientation when extending backwards', () => {
      const sel = createSelection()
      sel.select('50..100')  // plus strand by default

      sel.extendToPosition(20)

      expect(sel.domain.value.ranges[0].orientation).toBe(Orientation.PLUS)
    })

    it('preserves minus orientation when extending forwards', () => {
      const sel = createSelection()
      sel.select('(50..100)')  // minus strand

      sel.extendToPosition(150)

      expect(sel.domain.value.ranges[0].orientation).toBe(Orientation.MINUS)
    })

    it('extends leftmost range when clicking before all ranges', () => {
      const sel = createSelection()
      sel.select('30..50 + 70..90')

      const result = sel.extendToPosition(10)

      expect(result).toBe(true)
      expect(sel.domain.value.ranges.length).toBe(2)
      expect(sel.domain.value.ranges[0].start).toBe(10)
      expect(sel.domain.value.ranges[0].end).toBe(50)
      expect(sel.domain.value.ranges[1].start).toBe(70)
      expect(sel.domain.value.ranges[1].end).toBe(90)
    })

    it('extends rightmost range when clicking after all ranges', () => {
      const sel = createSelection()
      sel.select('10..30 + 50..70')

      const result = sel.extendToPosition(100)

      expect(result).toBe(true)
      expect(sel.domain.value.ranges.length).toBe(2)
      expect(sel.domain.value.ranges[0].start).toBe(10)
      expect(sel.domain.value.ranges[0].end).toBe(30)
      expect(sel.domain.value.ranges[1].start).toBe(50)
      expect(sel.domain.value.ranges[1].end).toBe(100)
    })

    it('merges two ranges when clicking between them', () => {
      const sel = createSelection()
      sel.select('10..30 + 50..70')

      const result = sel.extendToPosition(40)

      expect(result).toBe(true)
      expect(sel.domain.value.ranges.length).toBe(1)
      expect(sel.domain.value.ranges[0].start).toBe(10)
      expect(sel.domain.value.ranges[0].end).toBe(70)
    })

    it('merges correct pair when clicking between middle ranges', () => {
      const sel = createSelection()
      sel.select('10..20 + 40..50 + 70..80')

      const result = sel.extendToPosition(55)

      // Click at 55 is between range[1] (40..50) and range[2] (70..80)
      expect(result).toBe(true)
      expect(sel.domain.value.ranges.length).toBe(2)
      expect(sel.domain.value.ranges[0].start).toBe(10)
      expect(sel.domain.value.ranges[0].end).toBe(20)
      expect(sel.domain.value.ranges[1].start).toBe(40)
      expect(sel.domain.value.ranges[1].end).toBe(80)
    })

    it('preserves orientation when extending leftmost range', () => {
      const sel = createSelection()
      sel.select('(30..50) + 70..90')  // First range is minus strand

      sel.extendToPosition(10)

      expect(sel.domain.value.ranges[0].orientation).toBe(Orientation.MINUS)
    })

    it('preserves orientation when extending rightmost range', () => {
      const sel = createSelection()
      sel.select('10..30 + (50..70)')  // Second range is minus strand

      sel.extendToPosition(100)

      expect(sel.domain.value.ranges[1].orientation).toBe(Orientation.MINUS)
    })

    it('does nothing if no selection exists', () => {
      const sel = createSelection()

      const result = sel.extendToPosition(50)

      expect(result).toBe(false)
      expect(sel.isSelected.value).toBe(false)
    })

    it('does nothing if position is within existing range', () => {
      const sel = createSelection()
      sel.select('10..100')

      const result = sel.extendToPosition(50)

      expect(result).toBe(true)  // Returns true but no change
      expect(sel.domain.value.ranges[0].start).toBe(10)
      expect(sel.domain.value.ranges[0].end).toBe(100)
    })

    it('responds to extendtoposition event', () => {
      const sel = createSelection()
      sel.select('10..50')

      eventBus.emit('extendtoposition', { pos: 80 })

      expect(sel.domain.value.ranges[0].end).toBe(80)
    })

    it('circular mode: merges two ranges when clicking between them', () => {
      const sel = createSelection()
      sel.select('10..30')
      sel.domain.value.addRange(new Range(50, 70, Orientation.PLUS))

      const result = sel.extendToPosition(40, true)

      expect(result).toBe(true)
      expect(sel.domain.value.ranges).toHaveLength(1)
      expect(sel.domain.value.ranges[0].start).toBe(10)
      expect(sel.domain.value.ranges[0].end).toBe(70)
    })

    it('circular mode: merges when clicking before all ranges (wraparound gap)', () => {
      const sel = createSelection()
      sel.select('50..70')
      sel.domain.value.addRange(new Range(100, 120, Orientation.PLUS))

      // Click at 20 - in wraparound gap (120 -> seqLen -> 0 -> 50)
      const result = sel.extendToPosition(20, true)

      // Should merge via wraparound (same as "around the horn")
      expect(result).toBe(true)
      expect(sel.domain.value.ranges).toHaveLength(1)
      // Rightmost (100..120) extends to include leftmost (50..70)
      expect(sel.domain.value.ranges[0].start).toBe(100)
      expect(sel.domain.value.ranges[0].end).toBe(70)
    })

    it('circular mode: merges when clicking after all ranges (wraparound gap)', () => {
      const sel = createSelection()
      sel.select('10..30')
      sel.domain.value.addRange(new Range(50, 70, Orientation.PLUS))

      // Click at 100 - in wraparound gap (70 -> seqLen -> 0 -> 10)
      const result = sel.extendToPosition(100, true)

      // Should merge via wraparound (same as "around the horn")
      expect(result).toBe(true)
      expect(sel.domain.value.ranges).toHaveLength(1)
      // Rightmost (50..70) extends to include leftmost (10..30)
      expect(sel.domain.value.ranges[0].start).toBe(50)
      expect(sel.domain.value.ranges[0].end).toBe(30)
    })

    it('circular mode: merges ranges when clicking in wraparound gap (around the horn)', () => {
      const sel = createSelection()
      sel.select('100..200')
      sel.domain.value.addRange(new Range(400, 500, Orientation.PLUS))

      // Click at position 50 - in the gap that wraps around origin (500 -> 0 -> 100)
      const result = sel.extendToPosition(50, true)

      expect(result).toBe(true)
      expect(sel.domain.value.ranges).toHaveLength(1)
      // Rightmost (400..500) extends to include leftmost (100..200)
      expect(sel.domain.value.ranges[0].start).toBe(400)
      expect(sel.domain.value.ranges[0].end).toBe(200)
    })

    it('circular mode: single range still extends directionally', () => {
      const sel = createSelection()
      sel.select('100..200')

      const result = sel.extendToPosition(50, true)

      expect(result).toBe(true)
      expect(sel.domain.value.ranges).toHaveLength(1)
      expect(sel.domain.value.ranges[0].start).toBe(50)
      expect(sel.domain.value.ranges[0].end).toBe(200)
    })
  })

  describe('subtractSpan', () => {
    it('does nothing when annotation does not overlap selection', () => {
      const sel = createSelection()
      sel.select('10..20')
      const span = Span.parse('30..40')

      sel.subtractSpan(span)

      expect(sel.domain.value.ranges).toHaveLength(1)
      expect(sel.domain.value.ranges[0].start).toBe(10)
      expect(sel.domain.value.ranges[0].end).toBe(20)
    })

    it('removes range when annotation fully contains it', () => {
      const sel = createSelection()
      sel.select('15..25')
      const span = Span.parse('10..30')

      sel.subtractSpan(span)

      expect(sel.isSelected.value).toBe(false)
      expect(sel.domain.value).toBe(null)
    })

    it('splits range when selection contains annotation', () => {
      const sel = createSelection()
      sel.select('10..50')
      const span = Span.parse('20..30')

      sel.subtractSpan(span)

      expect(sel.domain.value.ranges).toHaveLength(2)
      expect(sel.domain.value.ranges[0].start).toBe(10)
      expect(sel.domain.value.ranges[0].end).toBe(20)
      expect(sel.domain.value.ranges[1].start).toBe(30)
      expect(sel.domain.value.ranges[1].end).toBe(50)
    })

    it('trims range when annotation overlaps start', () => {
      const sel = createSelection()
      sel.select('20..40')
      const span = Span.parse('10..30')

      sel.subtractSpan(span)

      expect(sel.domain.value.ranges).toHaveLength(1)
      expect(sel.domain.value.ranges[0].start).toBe(30)
      expect(sel.domain.value.ranges[0].end).toBe(40)
    })

    it('trims range when annotation overlaps end', () => {
      const sel = createSelection()
      sel.select('20..40')
      const span = Span.parse('30..50')

      sel.subtractSpan(span)

      expect(sel.domain.value.ranges).toHaveLength(1)
      expect(sel.domain.value.ranges[0].start).toBe(20)
      expect(sel.domain.value.ranges[0].end).toBe(30)
    })

    it('handles annotation end matching selection end', () => {
      const sel = createSelection()
      sel.select('10..30')
      const span = Span.parse('20..30')

      sel.subtractSpan(span)

      expect(sel.domain.value.ranges).toHaveLength(1)
      expect(sel.domain.value.ranges[0].start).toBe(10)
      expect(sel.domain.value.ranges[0].end).toBe(20)
    })

    it('handles annotation start matching selection start', () => {
      const sel = createSelection()
      sel.select('10..30')
      const span = Span.parse('10..20')

      sel.subtractSpan(span)

      expect(sel.domain.value.ranges).toHaveLength(1)
      expect(sel.domain.value.ranges[0].start).toBe(20)
      expect(sel.domain.value.ranges[0].end).toBe(30)
    })

    it('removes range when annotation exactly matches', () => {
      const sel = createSelection()
      sel.select('10..30')
      const span = Span.parse('10..30')

      sel.subtractSpan(span)

      expect(sel.isSelected.value).toBe(false)
      expect(sel.domain.value).toBe(null)
    })

    it('handles multiple selection ranges with partial overlap', () => {
      const sel = createSelection()
      sel.select('10..20 + 30..40 + 50..60')
      const span = Span.parse('15..35')

      sel.subtractSpan(span)

      expect(sel.domain.value.ranges).toHaveLength(3)
      expect(sel.domain.value.ranges[0].start).toBe(10)
      expect(sel.domain.value.ranges[0].end).toBe(15)
      expect(sel.domain.value.ranges[1].start).toBe(35)
      expect(sel.domain.value.ranges[1].end).toBe(40)
      expect(sel.domain.value.ranges[2].start).toBe(50)
      expect(sel.domain.value.ranges[2].end).toBe(60)
    })

    it('handles multi-range annotation span', () => {
      const sel = createSelection()
      sel.select('10..100')
      const span = Span.parse('20..30 + 50..60')

      sel.subtractSpan(span)

      expect(sel.domain.value.ranges).toHaveLength(3)
      expect(sel.domain.value.ranges[0].start).toBe(10)
      expect(sel.domain.value.ranges[0].end).toBe(20)
      expect(sel.domain.value.ranges[1].start).toBe(30)
      expect(sel.domain.value.ranges[1].end).toBe(50)
      expect(sel.domain.value.ranges[2].start).toBe(60)
      expect(sel.domain.value.ranges[2].end).toBe(100)
    })

    it('removes selection when annotation is strictly bigger', () => {
      const sel = createSelection()
      sel.select('20..30')
      const span = Span.parse('10..50')

      sel.subtractSpan(span)

      expect(sel.isSelected.value).toBe(false)
      expect(sel.domain.value).toBe(null)
    })

    it('preserves orientation when splitting range', () => {
      const sel = createSelection()
      sel.select('(10..50)')  // minus strand
      const span = Span.parse('20..30')

      sel.subtractSpan(span)

      expect(sel.domain.value.ranges).toHaveLength(2)
      expect(sel.domain.value.ranges[0].orientation).toBe(Orientation.MINUS)
      expect(sel.domain.value.ranges[1].orientation).toBe(Orientation.MINUS)
    })

    it('does nothing when no selection exists', () => {
      const sel = createSelection()
      const span = Span.parse('10..20')

      sel.subtractSpan(span)

      expect(sel.isSelected.value).toBe(false)
      expect(sel.domain.value).toBe(null)
    })
  })
})
