/**
 * DNA utility functions and classes.
 * Ported from OpenGenePool DNA.js to ES6 modules.
 *
 * FENCED COORDINATE SYSTEM
 * ========================
 * This module uses a fenced (0-based, half-open) coordinate system.
 *
 * Think of positions as "fences" between bases:
 *
 *   Sequence:    A  T  C  G  A  T
 *   Position:   0  1  2  3  4  5  6
 *               |  |  |  |  |  |  |
 *               └──┴──┴──┴──┴──┴──┘
 *
 * A Range [start, end) includes bases from position `start` up to but
 * NOT including `end`. This is identical to JavaScript's slice() behavior.
 *
 * Examples for a sequence of length N:
 *   0..0   → cursor at start (length 0, no bases selected)
 *   0..1   → first base only (length 1)
 *   0..N   → full sequence (length N)
 *   N..N   → cursor at end (length 0, no bases selected)
 *   (0..N) → full sequence, minus strand (reverse complement)
 */

// Complement map for DNA bases (shared by complement and reverseComplement)
const COMPLEMENT_MAP = {
  // Standard bases
  'a': 't', 't': 'a', 'c': 'g', 'g': 'c',
  'A': 'T', 'T': 'A', 'C': 'G', 'G': 'C',
  // Wildcards
  'n': 'n', 'x': 'x', 'N': 'N', 'X': 'X',
  // IUPAC two-letter codes
  'r': 'y', 'y': 'r', 'm': 'k', 'k': 'm', 's': 's', 'w': 'w',
  'R': 'Y', 'Y': 'R', 'M': 'K', 'K': 'M', 'S': 'S', 'W': 'W',
  // IUPAC three-letter codes
  'h': 'd', 'd': 'h', 'b': 'v', 'v': 'b',
  'H': 'D', 'D': 'H', 'B': 'V', 'V': 'B'
}

/**
 * Complement a single DNA base.
 * Supports standard bases (A, T, G, C) and IUPAC ambiguity codes.
 * @param {string} base - A single DNA base
 * @returns {string} The complementary base
 * @throws {Error} If the base is not a valid DNA base or IUPAC code
 */
export function complementBase(base) {
  const complement = COMPLEMENT_MAP[base]
  if (complement === undefined) {
    throw new Error(`Invalid DNA base: ${base}`)
  }
  return complement
}

/**
 * Reverse complement of a DNA sequence.
 * Handles IUPAC ambiguity codes and preserves case.
 * @param {string} sequence - The DNA sequence to reverse complement
 * @returns {string} The reverse complement
 */
export function reverseComplement(sequence) {
  let result = ''
  for (let i = sequence.length - 1; i >= 0; i--) {
    result += COMPLEMENT_MAP[sequence[i]] || sequence[i]
  }
  return result
}

/**
 * Orientation constants for DNA strands
 */
export const Orientation = {
  MINUS: -1,
  NONE: 0,
  PLUS: 1
}

/**
 * A Range represents a contiguous region of DNA.
 * Uses 0-based, half-open coordinates (like array slicing).
 */
export class Range {
  /**
   * @param {number} start - Start position (0-based, inclusive)
   * @param {number} end - End position (0-based, exclusive)
   * @param {number} [orientation=1] - Strand orientation (-1, 0, or 1)
   * @param {boolean} [startIndefinite=false] - 5' indefinite location (GenBank '<')
   * @param {boolean} [endIndefinite=false] - 3' indefinite location (GenBank '>')
   */
  constructor(start, end, orientation = Orientation.PLUS, startIndefinite = false, endIndefinite = false) {
    if (start < 0 || end < 0) {
      throw new Error('Range positions must be non-negative')
    }
    if (end < start) {
      throw new Error('Range end must be >= start')
    }

    this.start = start
    this.end = end
    this.orientation = orientation
    this.startIndefinite = startIndefinite
    this.endIndefinite = endIndefinite
  }

  /**
   * Parse a range from fenced coordinate notation.
   *
   * Formats:
   *   "10..20"    → Range from 10 to 20 (plus strand)
   *   "(10..20)"  → Range from 10 to 20 (minus strand)
   *   "[10..20]"  → Range from 10 to 20 (unoriented)
   *   "15"        → Cursor at position 15 (same as "15..15")
   *   "<10..20"   → Range with 5' indefinite (start is uncertain)
   *   "10..>20"   → Range with 3' indefinite (end is uncertain)
   *   "<10..>20"  → Range with both ends indefinite
   *
   * Ranges must be in ascending order (start ≤ end). Use "(10..20)" for minus
   * strand, not "(20..10)".
   *
   * @param {string} str - The range string in fenced coordinates
   * @returns {Range}
   * @throws {Error} If end < start
   */
  static parse(str) {
    const trimmed = str.trim()
    let orientation = Orientation.PLUS
    let inner = trimmed

    if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
      orientation = Orientation.MINUS
      inner = trimmed.slice(1, -1)
    } else if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      orientation = Orientation.NONE
      inner = trimmed.slice(1, -1)
    }

    // Check for indefinite markers
    const startIndefinite = inner.startsWith('<')
    const endIndefinite = inner.includes('..>') || (inner.endsWith('>') && !inner.includes('..'))

    // Remove indefinite markers for parsing
    const cleaned = inner.replace(/[<>]/g, '')

    const parts = cleaned.split('..')
    const start = parseInt(parts[0], 10)
    // Single number means cursor position (start == end)
    const end = parts[1] !== undefined ? parseInt(parts[1], 10) : start

    if (isNaN(start) || isNaN(end)) {
      throw new Error(`Invalid range string: ${str}`)
    }

    return new Range(start, end, orientation, startIndefinite, endIndefinite)
  }

  /**
   * Length of this range in base pairs
   */
  get length() {
    return this.end - this.start
  }

  /**
   * Check if this range contains a position or another range.
   * @param {number|Range} target - Position or range to check
   * @returns {boolean}
   */
  contains(target) {
    if (target instanceof Range) {
      return target.start >= this.start && target.end <= this.end
    }
    return target >= this.start && target < this.end
  }

  /**
   * Check if this range overlaps with another range.
   * @param {Range} other - The other range
   * @returns {boolean}
   */
  overlaps(other) {
    return !(other.end <= this.start || other.start >= this.end)
  }

  /**
   * Extract the sequence from this range.
   * @param {string} sequence - The full DNA sequence
   * @returns {string} The extracted subsequence (reverse complemented if minus strand)
   */
  extract(sequence) {
    const sub = sequence.slice(this.start, this.end)
    return this.orientation === Orientation.MINUS ? reverseComplement(sub) : sub
  }

  /**
   * Create a new range shifted by an offset.
   * @param {number} offset - The amount to shift
   * @returns {Range}
   */
  shift(offset) {
    return new Range(this.start + offset, this.end + offset, this.orientation, this.startIndefinite, this.endIndefinite)
  }

  /**
   * Create a new range with flipped orientation.
   * @returns {Range}
   */
  flip() {
    return new Range(this.start, this.end, this.orientation * -1, this.startIndefinite, this.endIndefinite)
  }

  /**
   * String representation (fenced coordinates)
   */
  toString() {
    let content
    if (this.start === this.end) {
      content = `${this.start}`
    } else {
      const startStr = this.startIndefinite ? `<${this.start}` : `${this.start}`
      const endStr = this.endIndefinite ? `>${this.end}` : `${this.end}`
      content = `${startStr}..${endStr}`
    }

    switch (this.orientation) {
      case Orientation.MINUS: return `(${content})`
      case Orientation.NONE: return `[${content}]`
      default: return content
    }
  }
}

/**
 * A Span is a collection of ranges (for complex annotations like joins).
 *
 * TODO: Consider adding support for GenBank location format parsing:
 *   - complement(10..50) for minus strand (currently uses parentheses: "(10..50)")
 *   - join(10..30,40..60) for multi-range (currently uses plus: "10..30 + 40..60")
 *   - order(...) for unordered ranges
 *   - <10..>50 for partial locations
 */
export class Span {
  /**
   * @param {Range[]} [ranges=[]] - Initial ranges
   */
  constructor(ranges = []) {
    this.ranges = [...ranges]
  }

  /**
   * Parse a span from fenced coordinate notation.
   *
   * Format: "10..20 + 30..40" (multiple ranges joined with +)
   *
   * Each range can have its own orientation:
   *   "0..10 + (20..30)" → first range plus strand, second minus strand
   *
   * @param {string} str - The span string in fenced coordinates
   * @returns {Span}
   */
  static parse(str) {
    const parts = str.split('+').map(s => s.trim()).filter(s => s)
    const ranges = parts.map(p => Range.parse(p))
    return new Span(ranges)
  }

  /**
   * Add a range to this span.
   * @param {Range} range
   */
  push(range) {
    this.ranges.push(range)
  }

  /**
   * Number of ranges in this span
   */
  get length() {
    return this.ranges.length
  }

  /**
   * Total base pairs covered by all ranges
   */
  get totalLength() {
    return this.ranges.reduce((sum, r) => sum + r.length, 0)
  }

  /**
   * Get the bounding range that encompasses all ranges.
   * @returns {Range}
   */
  get bounds() {
    if (this.ranges.length === 0) {
      return new Range(0, 0)
    }
    const start = Math.min(...this.ranges.map(r => r.start))
    const end = Math.max(...this.ranges.map(r => r.end))
    return new Range(start, end, Orientation.NONE)
  }

  /**
   * Determine the dominant orientation.
   * @returns {number}
   */
  get orientation() {
    let plusLength = 0
    let minusLength = 0

    for (const range of this.ranges) {
      if (range.orientation === Orientation.PLUS) {
        plusLength += range.length
      } else if (range.orientation === Orientation.MINUS) {
        minusLength += range.length
      }
    }

    return plusLength >= minusLength ? Orientation.PLUS : Orientation.MINUS
  }

  /**
   * Check if a position is contained in any of the ranges.
   * @param {number} position - The position to check
   * @returns {boolean}
   */
  contains(position) {
    return this.ranges.some(range => range.contains(position))
  }

  /**
   * String representation (fenced coordinates)
   */
  toString() {
    return this.ranges.map(r => r.toString()).join(' + ')
  }
}

/**
 * Iterate over bases in a span in coding order.
 * Plus strand: low to high genomic position
 * Minus strand: high to low genomic position (with complemented bases)
 *
 * @param {Span} span - The annotation span
 * @param {string} sequence - The full DNA sequence
 * @yields {{letter: string, direction: boolean, position: number}}
 */
export function* iterateSequence(span, sequence) {
  if (!span || !span.ranges || span.ranges.length === 0) return

  const ranges = span.ranges

  // Determine overall direction from first range (for range ordering)
  const overallMinus = ranges[0].orientation === Orientation.MINUS

  // For minus strand CDS, reverse the range order (last exon first in coding order)
  const codingRanges = overallMinus ? [...ranges].reverse() : ranges

  for (const range of codingRanges) {
    const rangeIsMinus = range.orientation === Orientation.MINUS

    if (rangeIsMinus) {
      // Walk high to low for minus strand range, yielding complemented bases
      for (let p = range.end - 1; p >= range.start; p--) {
        yield {
          letter: complementBase(sequence[p]),
          direction: false,
          position: p
        }
      }
    } else {
      // Walk low to high for plus strand range
      for (let p = range.start; p < range.end; p++) {
        yield {
          letter: sequence[p],
          direction: true,
          position: p
        }
      }
    }
  }
}
