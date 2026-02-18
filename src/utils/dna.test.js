import { describe, it, expect } from 'bun:test'
import {
  reverseComplement,
  Range,
  Span,
  Orientation,
  iterateSequence
} from './dna.js'

/**
 * FENCED COORDINATE SYSTEM
 *
 * This module uses a fenced (0-based, half-open) coordinate system:
 *
 *   Sequence:    A  T  C  G  A  T
 *   Position:   0  1  2  3  4  5  6
 *               |  |  |  |  |  |  |
 *               └──┴──┴──┴──┴──┴──┘
 *
 * - Positions are "fences" between bases (or at the edges)
 * - Range [start, end) includes bases from position `start` up to but NOT including `end`
 * - A cursor is represented as Range(pos, pos) with length 0
 *
 * Examples for a sequence of length 6:
 *   0..0   → cursor at start (length 0)
 *   0..1   → first base only (length 1)
 *   0..6   → full sequence (length 6)
 *   6..6   → cursor at end (length 0)
 *   2..4   → bases at positions 2 and 3 (length 2)
 *   (0..6) → full sequence, minus strand
 */

describe('reverseComplement', () => {
  it('complements standard bases', () => {
    expect(reverseComplement('A')).toBe('T')
    expect(reverseComplement('T')).toBe('A')
    expect(reverseComplement('C')).toBe('G')
    expect(reverseComplement('G')).toBe('C')
  })

  it('reverses the sequence', () => {
    expect(reverseComplement('ATCG')).toBe('CGAT')
  })

  it('preserves case', () => {
    expect(reverseComplement('AtCg')).toBe('cGaT')
  })

  it('handles IUPAC ambiguity codes', () => {
    // RYSWKM reversed is MKWSYR, then complemented: M->K, K->M, W->W, S->S, Y->R, R->Y
    expect(reverseComplement('RYSWKM')).toBe('KMWSRY')
  })

  it('handles wildcards', () => {
    expect(reverseComplement('NXnx')).toBe('xnXN')
  })

  it('handles empty string', () => {
    expect(reverseComplement('')).toBe('')
  })
})

describe('Range', () => {
  describe('constructor', () => {
    it('creates a range with start, end, and orientation', () => {
      const range = new Range(10, 20, Orientation.PLUS)
      expect(range.start).toBe(10)
      expect(range.end).toBe(20)
      expect(range.orientation).toBe(Orientation.PLUS)
    })

    it('defaults to plus strand orientation', () => {
      const range = new Range(10, 20)
      expect(range.orientation).toBe(Orientation.PLUS)
    })

    it('throws on negative positions', () => {
      expect(() => new Range(-1, 10)).toThrow('non-negative')
      expect(() => new Range(0, -1)).toThrow('non-negative')
    })

    it('throws when end < start', () => {
      expect(() => new Range(20, 10)).toThrow('end must be >= start')
    })
  })

  describe('parse', () => {
    it('parses fenced range notation', () => {
      const range = Range.parse('10..20')
      expect(range.start).toBe(10)
      expect(range.end).toBe(20)
      expect(range.orientation).toBe(Orientation.PLUS)
    })

    it('parses cursor position (start equals end)', () => {
      const range = Range.parse('15..15')
      expect(range.start).toBe(15)
      expect(range.end).toBe(15)
      expect(range.length).toBe(0)
    })

    it('parses single number as cursor position', () => {
      const range = Range.parse('15')
      expect(range.start).toBe(15)
      expect(range.end).toBe(15)
      expect(range.length).toBe(0)
    })

    it('parses minus strand notation with parentheses', () => {
      const range = Range.parse('(10..20)')
      expect(range.start).toBe(10)
      expect(range.end).toBe(20)
      expect(range.orientation).toBe(Orientation.MINUS)
    })

    it('parses unoriented notation with brackets', () => {
      const range = Range.parse('[10..20]')
      expect(range.start).toBe(10)
      expect(range.end).toBe(20)
      expect(range.orientation).toBe(Orientation.NONE)
    })

    it('handles whitespace', () => {
      const range = Range.parse('  10..20  ')
      expect(range.start).toBe(10)
      expect(range.end).toBe(20)
    })

    // Document fenced coordinate semantics
    it('correctly represents full sequence selection', () => {
      // For a sequence of length 100, full selection is 0..100
      const range = Range.parse('0..100')
      expect(range.start).toBe(0)
      expect(range.end).toBe(100)
      expect(range.length).toBe(100)
    })

    it('correctly represents single base selection', () => {
      // First base is 0..1, second base is 1..2, etc.
      const first = Range.parse('0..1')
      expect(first.length).toBe(1)
      expect(first.contains(0)).toBe(true)
      expect(first.contains(1)).toBe(false)

      const second = Range.parse('1..2')
      expect(second.length).toBe(1)
      expect(second.contains(0)).toBe(false)
      expect(second.contains(1)).toBe(true)
    })
  })

  describe('length', () => {
    it('returns the number of base pairs', () => {
      expect(new Range(10, 20).length).toBe(10)
      expect(new Range(0, 100).length).toBe(100)
      expect(new Range(5, 5).length).toBe(0)
    })
  })

  describe('contains', () => {
    const range = new Range(10, 20)

    it('checks if a position is contained', () => {
      expect(range.contains(10)).toBe(true)
      expect(range.contains(15)).toBe(true)
      expect(range.contains(19)).toBe(true)
      expect(range.contains(20)).toBe(false) // half-open
      expect(range.contains(9)).toBe(false)
    })

    it('checks if another range is contained', () => {
      expect(range.contains(new Range(10, 20))).toBe(true)
      expect(range.contains(new Range(12, 18))).toBe(true)
      expect(range.contains(new Range(5, 15))).toBe(false)
      expect(range.contains(new Range(15, 25))).toBe(false)
    })
  })

  describe('overlaps', () => {
    const range = new Range(10, 20)

    it('detects overlapping ranges', () => {
      expect(range.overlaps(new Range(15, 25))).toBe(true)
      expect(range.overlaps(new Range(5, 15))).toBe(true)
      expect(range.overlaps(new Range(12, 18))).toBe(true)
    })

    it('detects non-overlapping ranges', () => {
      expect(range.overlaps(new Range(0, 10))).toBe(false)
      expect(range.overlaps(new Range(20, 30))).toBe(false)
    })
  })

  describe('extract', () => {
    const sequence = 'ATCGATCGATCG'

    it('extracts subsequence for plus strand', () => {
      const range = new Range(0, 4, Orientation.PLUS)
      expect(range.extract(sequence)).toBe('ATCG')
    })

    it('extracts and reverse complements for minus strand', () => {
      const range = new Range(0, 4, Orientation.MINUS)
      expect(range.extract(sequence)).toBe('CGAT')
    })
  })

  describe('shift', () => {
    it('creates a new shifted range', () => {
      const range = new Range(10, 20, Orientation.MINUS)
      const shifted = range.shift(5)

      expect(shifted.start).toBe(15)
      expect(shifted.end).toBe(25)
      expect(shifted.orientation).toBe(Orientation.MINUS)
      // Original unchanged
      expect(range.start).toBe(10)
    })
  })

  describe('flip', () => {
    it('creates a range with flipped orientation', () => {
      const plus = new Range(10, 20, Orientation.PLUS)
      expect(plus.flip().orientation).toBe(Orientation.MINUS)

      const minus = new Range(10, 20, Orientation.MINUS)
      expect(minus.flip().orientation).toBe(Orientation.PLUS)
    })
  })

  describe('toString', () => {
    it('formats plus strand ranges', () => {
      expect(new Range(10, 20).toString()).toBe('10..20')
    })

    it('formats minus strand ranges with parentheses', () => {
      expect(new Range(10, 20, Orientation.MINUS).toString()).toBe('(10..20)')
    })

    it('formats unoriented ranges with brackets', () => {
      expect(new Range(10, 20, Orientation.NONE).toString()).toBe('[10..20]')
    })

    it('formats single positions', () => {
      expect(new Range(15, 15).toString()).toBe('15')
    })
  })

  describe('indefinite locations', () => {
    describe('constructor', () => {
      it('defaults indefinite flags to false', () => {
        const range = new Range(10, 20)
        expect(range.startIndefinite).toBe(false)
        expect(range.endIndefinite).toBe(false)
      })

      it('accepts indefinite flags', () => {
        const range = new Range(10, 20, Orientation.PLUS, true, true)
        expect(range.startIndefinite).toBe(true)
        expect(range.endIndefinite).toBe(true)
      })
    })

    describe('parse', () => {
      it('parses start indefinite marker (<)', () => {
        const range = Range.parse('<10..20')
        expect(range.start).toBe(10)
        expect(range.end).toBe(20)
        expect(range.startIndefinite).toBe(true)
        expect(range.endIndefinite).toBe(false)
      })

      it('parses end indefinite marker (>)', () => {
        const range = Range.parse('10..>20')
        expect(range.start).toBe(10)
        expect(range.end).toBe(20)
        expect(range.startIndefinite).toBe(false)
        expect(range.endIndefinite).toBe(true)
      })

      it('parses both indefinite markers', () => {
        const range = Range.parse('<10..>20')
        expect(range.start).toBe(10)
        expect(range.end).toBe(20)
        expect(range.startIndefinite).toBe(true)
        expect(range.endIndefinite).toBe(true)
      })

      it('parses indefinite with minus strand', () => {
        const range = Range.parse('(<10..>20)')
        expect(range.start).toBe(10)
        expect(range.end).toBe(20)
        expect(range.orientation).toBe(Orientation.MINUS)
        expect(range.startIndefinite).toBe(true)
        expect(range.endIndefinite).toBe(true)
      })

      it('parses indefinite with unoriented notation', () => {
        const range = Range.parse('[<10..>20]')
        expect(range.orientation).toBe(Orientation.NONE)
        expect(range.startIndefinite).toBe(true)
        expect(range.endIndefinite).toBe(true)
      })
    })

    describe('toString', () => {
      it('formats start indefinite', () => {
        const range = new Range(10, 20, Orientation.PLUS, true, false)
        expect(range.toString()).toBe('<10..20')
      })

      it('formats end indefinite', () => {
        const range = new Range(10, 20, Orientation.PLUS, false, true)
        expect(range.toString()).toBe('10..>20')
      })

      it('formats both indefinite', () => {
        const range = new Range(10, 20, Orientation.PLUS, true, true)
        expect(range.toString()).toBe('<10..>20')
      })

      it('formats indefinite with minus strand', () => {
        const range = new Range(10, 20, Orientation.MINUS, true, true)
        expect(range.toString()).toBe('(<10..>20)')
      })

      it('formats indefinite with unoriented notation', () => {
        const range = new Range(10, 20, Orientation.NONE, true, true)
        expect(range.toString()).toBe('[<10..>20]')
      })
    })

    describe('shift preserves indefinite flags', () => {
      it('preserves indefinite flags when shifting', () => {
        const range = new Range(10, 20, Orientation.PLUS, true, true)
        const shifted = range.shift(5)
        expect(shifted.start).toBe(15)
        expect(shifted.end).toBe(25)
        expect(shifted.startIndefinite).toBe(true)
        expect(shifted.endIndefinite).toBe(true)
      })
    })

    describe('flip preserves indefinite flags', () => {
      it('preserves indefinite flags when flipping', () => {
        const range = new Range(10, 20, Orientation.PLUS, true, false)
        const flipped = range.flip()
        expect(flipped.orientation).toBe(Orientation.MINUS)
        expect(flipped.startIndefinite).toBe(true)
        expect(flipped.endIndefinite).toBe(false)
      })
    })

    describe('round-trip', () => {
      it('parses and stringifies correctly', () => {
        const tests = [
          '<10..20',
          '10..>20',
          '<10..>20',
          '(<10..>20)',
          '[<10..>20]'
        ]
        for (const str of tests) {
          expect(Range.parse(str).toString()).toBe(str)
        }
      })
    })
  })

})

describe('Span', () => {
  describe('constructor', () => {
    it('creates an empty span', () => {
      const span = new Span()
      expect(span.length).toBe(0)
    })

    it('creates a span from ranges', () => {
      const span = new Span([new Range(0, 10), new Range(20, 30)])
      expect(span.length).toBe(2)
    })
  })

  describe('parse', () => {
    it('parses single fenced range', () => {
      const span = Span.parse('10..20')
      expect(span.length).toBe(1)
      expect(span.ranges[0].start).toBe(10)
      expect(span.ranges[0].end).toBe(20)
    })

    it('parses multiple ranges joined with +', () => {
      const span = Span.parse('10..20 + 30..40')
      expect(span.length).toBe(2)
      expect(span.ranges[0].start).toBe(10)
      expect(span.ranges[0].end).toBe(20)
      expect(span.ranges[1].start).toBe(30)
      expect(span.ranges[1].end).toBe(40)
    })

    it('parses mixed orientations', () => {
      const span = Span.parse('0..10 + (20..30)')
      expect(span.length).toBe(2)
      expect(span.ranges[0].orientation).toBe(Orientation.PLUS)
      expect(span.ranges[1].orientation).toBe(Orientation.MINUS)
    })
  })

  describe('totalLength', () => {
    it('sums the lengths of all ranges', () => {
      const span = new Span([new Range(0, 10), new Range(20, 30)])
      expect(span.totalLength).toBe(20)
    })
  })

  describe('bounds', () => {
    it('returns the bounding range', () => {
      const span = new Span([new Range(10, 20), new Range(40, 50)])
      const bounds = span.bounds
      expect(bounds.start).toBe(10)
      expect(bounds.end).toBe(50)
    })

    it('handles empty span', () => {
      const span = new Span()
      const bounds = span.bounds
      expect(bounds.start).toBe(0)
      expect(bounds.end).toBe(0)
    })
  })

  describe('orientation', () => {
    it('returns dominant orientation based on length', () => {
      const span = new Span([
        new Range(0, 100, Orientation.PLUS),
        new Range(200, 210, Orientation.MINUS)
      ])
      expect(span.orientation).toBe(Orientation.PLUS)
    })
  })

  describe('contains', () => {
    it('returns true if position is in any range', () => {
      const span = new Span([new Range(10, 20), new Range(30, 40)])
      expect(span.contains(15)).toBe(true)
      expect(span.contains(35)).toBe(true)
    })

    it('returns false if position is not in any range', () => {
      const span = new Span([new Range(10, 20), new Range(30, 40)])
      expect(span.contains(5)).toBe(false)
      expect(span.contains(25)).toBe(false)
      expect(span.contains(45)).toBe(false)
    })

    it('handles empty span', () => {
      const span = new Span()
      expect(span.contains(10)).toBe(false)
    })
  })
})

describe('iterateSequence', () => {
  describe('plus strand', () => {
    it('yields bases low to high for single range', () => {
      const span = Span.parse('0..6')
      const sequence = 'ATGAAA'

      const bases = [...iterateSequence(span, sequence)]

      expect(bases).toHaveLength(6)
      expect(bases.map(b => b.position)).toEqual([0, 1, 2, 3, 4, 5])
      expect(bases.map(b => b.letter)).toEqual(['A', 'T', 'G', 'A', 'A', 'A'])
      expect(bases.every(b => b.direction === true)).toBe(true)
    })

    it('yields bases in range order for multi-range', () => {
      const span = Span.parse('0..3 + 6..9')
      const sequence = 'ATGXXXTAA'

      const bases = [...iterateSequence(span, sequence)]

      expect(bases.map(b => b.position)).toEqual([0, 1, 2, 6, 7, 8])
      expect(bases.map(b => b.letter)).toEqual(['A', 'T', 'G', 'T', 'A', 'A'])
    })
  })

  describe('minus strand', () => {
    it('yields complemented bases high to low for single range', () => {
      const span = Span.parse('(0..6)')
      const sequence = 'ATGAAA'

      const bases = [...iterateSequence(span, sequence)]

      expect(bases).toHaveLength(6)
      expect(bases.map(b => b.position)).toEqual([5, 4, 3, 2, 1, 0])
      // Yields complemented bases: A→T, A→T, A→T, G→C, T→A, A→T
      expect(bases.map(b => b.letter)).toEqual(['T', 'T', 'T', 'C', 'A', 'T'])
      expect(bases.every(b => b.direction === false)).toBe(true)
    })

    it('yields complemented bases in reversed range order for multi-range', () => {
      const span = Span.parse('(0..2) + (5..9)')
      const sequence = 'ATXXXXGTAA'

      const bases = [...iterateSequence(span, sequence)]

      // For minus strand, ranges are reversed AND positions within each range are reversed
      // Range order: (5..9) first, then (0..2)
      // Within (5..9): positions 8,7,6,5 → letters A,T,G,X → complemented T,A,C,X
      // Within (0..2): positions 1,0 → letters T,A → complemented A,T
      expect(bases.map(b => b.position)).toEqual([8, 7, 6, 5, 1, 0])
      expect(bases.map(b => b.letter)).toEqual(['T', 'A', 'C', 'X', 'A', 'T'])
    })

    it('handles three ranges in scrambled order', () => {
      const span = Span.parse('(4..6) + (0..2) + (8..10)')
      const sequence = 'ATXXCGXXTA'

      const bases = [...iterateSequence(span, sequence)]

      // Ranges reversed: (8..10), (0..2), (4..6)
      // Within each, walk high to low and complement:
      // [9,8] → A,T → complemented T,A
      // [1,0] → T,A → complemented A,T
      // [5,4] → G,C → complemented C,G
      expect(bases.map(b => b.position)).toEqual([9, 8, 1, 0, 5, 4])
      expect(bases.map(b => b.letter)).toEqual(['T', 'A', 'A', 'T', 'C', 'G'])
    })
  })

  describe('mixed strand', () => {
    it('handles mixed plus and minus ranges', () => {
      const span = Span.parse('1..4 + (6..10)')
      const sequence = 'XATGXXCATG'

      const bases = [...iterateSequence(span, sequence)]

      // Plus range 1..4: positions 1,2,3 (low to high), no complement → A,T,G
      // Minus range (6..10): positions 9,8,7,6 (high to low), complemented
      // Letters at 6,7,8,9 are C,A,T,G → complemented G,T,A,C
      expect(bases.map(b => b.position)).toEqual([1, 2, 3, 9, 8, 7, 6])
      expect(bases.map(b => b.letter)).toEqual(['A', 'T', 'G', 'C', 'A', 'T', 'G'])
      expect(bases.map(b => b.direction)).toEqual([true, true, true, false, false, false, false])
    })
  })
})
