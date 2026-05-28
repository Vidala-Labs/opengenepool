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
   * Fenced coordinate representation.
   * @returns {string}
   */
  toFencedString() {
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

  /**
   * JSON representation for persistence and API boundaries.
   * Uses the same fenced coordinate syntax as the text form.
   * @returns {string}
   */
  toJSON() {
    return this.toFencedString()
  }

  /**
   * Parse a fenced coordinate string into a Range.
   * @param {string} str - Fenced string like "10..50", "(10..50)", "[10..50]", "<10..50", "10..>50", "25"
   * @returns {Range}
   */
  static parse(str) {
    str = str.trim()

    // Detect orientation from brackets
    let orientation = Orientation.PLUS
    if (str.startsWith('(') && str.endsWith(')')) {
      orientation = Orientation.MINUS
      str = str.slice(1, -1)
    } else if (str.startsWith('[') && str.endsWith(']')) {
      orientation = Orientation.NONE
      str = str.slice(1, -1)
    }

    // Check for indefinite markers
    let startIndefinite = false
    let endIndefinite = false
    if (str.startsWith('<')) {
      startIndefinite = true
      str = str.slice(1)
    }

    // Handle cursor position (single number)
    if (!str.includes('..')) {
      const pos = parseInt(str, 10)
      return new Range(pos, pos, orientation, startIndefinite, false)
    }

    const [startStr, endStr] = str.split('..')
    if (endStr.startsWith('>')) {
      endIndefinite = true
    }

    const start = parseInt(startStr, 10)
    const end = parseInt(endStr.replace('>', ''), 10)

    return new Range(start, end, orientation, startIndefinite, endIndefinite)
  }

  /**
   * GenBank format representation (1-based, inclusive coordinates)
   * @returns {string} GenBank location string
   */
  toGenBank() {
    // Convert fenced (0-based, half-open) to GenBank (1-based, inclusive)
    const gbStart = this.start + 1
    const gbEnd = this.end  // end stays same: fenced exclusive == GenBank inclusive

    let content
    if (this.start === this.end) {
      content = `${gbStart}`
    } else {
      const startStr = this.startIndefinite ? `<${gbStart}` : `${gbStart}`
      const endStr = this.endIndefinite ? `>${gbEnd}` : `${gbEnd}`
      content = `${startStr}..${endStr}`
    }

    if (this.orientation === Orientation.MINUS) {
      return `complement(${content})`
    }
    return content
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
   * Parse a fenced coordinate string into a Span.
   * @param {string} str - Fenced string like "10..50" or "10..50 + 60..70"
   * @returns {Span}
   */
  static parse(str) {
    const parts = str.split(' + ').map(s => s.trim())
    const ranges = parts.map(part => Range.parse(part))
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
   * Fenced coordinate representation.
   * @returns {string}
   */
  toFencedString() {
    return this.ranges.map(r => r.toFencedString()).join(' + ')
  }

  /**
   * JSON representation for persistence and API boundaries.
   * Uses the same fenced coordinate syntax as the text form.
   * @returns {string}
   */
  toJSON() {
    return this.toFencedString()
  }

  /**
   * GenBank format representation (1-based, inclusive coordinates)
   * Uses join() for multiple ranges, complement() for minus strand
   * @returns {string} GenBank location string
   */
  toGenBank() {
    if (this.ranges.length === 0) return ''
    if (this.ranges.length === 1) return this.ranges[0].toGenBank()

    // Check if all ranges have the same orientation
    const allMinus = this.ranges.every(r => r.orientation === Orientation.MINUS)

    if (allMinus) {
      // For all-minus ranges, wrap in complement(join(...))
      const innerParts = this.ranges.map(r => {
        const gbStart = r.start + 1
        const gbEnd = r.end
        const startStr = r.startIndefinite ? `<${gbStart}` : `${gbStart}`
        const endStr = r.endIndefinite ? `>${gbEnd}` : `${gbEnd}`
        return `${startStr}..${endStr}`
      })
      return `complement(join(${innerParts.join(',')}))`
    }

    // Mixed or all-plus: use join with individual complement() as needed
    const parts = this.ranges.map(r => r.toGenBank())
    return `join(${parts.join(',')})`
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

/**
 * Nearest-neighbor thermodynamic parameters for Tm calculation.
 * Values from SantaLucia 1998 (unified parameters).
 * ΔH in kcal/mol, ΔS in cal/mol·K
 */
const NN_PARAMS = {
  'AA': { dH: -7.9, dS: -22.2 },
  'TT': { dH: -7.9, dS: -22.2 },
  'AT': { dH: -7.2, dS: -20.4 },
  'TA': { dH: -7.2, dS: -21.3 },
  'CA': { dH: -8.5, dS: -22.7 },
  'TG': { dH: -8.5, dS: -22.7 },
  'GT': { dH: -8.4, dS: -22.4 },
  'AC': { dH: -8.4, dS: -22.4 },
  'CT': { dH: -7.8, dS: -21.0 },
  'AG': { dH: -7.8, dS: -21.0 },
  'GA': { dH: -8.2, dS: -22.2 },
  'TC': { dH: -8.2, dS: -22.2 },
  'CG': { dH: -10.6, dS: -27.2 },
  'GC': { dH: -9.8, dS: -24.4 },
  'GG': { dH: -8.0, dS: -19.9 },
  'CC': { dH: -8.0, dS: -19.9 }
}

// Initiation parameters
const INIT_PARAMS = {
  // Terminal A/T penalty
  AT_TERM: { dH: 2.3, dS: 4.1 },
  // Terminal G/C (no penalty)
  GC_TERM: { dH: 0, dS: 0 }
}

/**
 * Calculate melting temperature using nearest-neighbor method.
 * @param {string} sequence - DNA sequence (A, T, G, C only)
 * @param {Object} options - Calculation options
 * @param {number} [options.oligoConc=50e-9] - Oligo concentration in M (default 50 nM)
 * @param {number} [options.saltConc=0.05] - Salt concentration in M (default 50 mM)
 * @returns {number|null} Tm in °C, or null if sequence contains non-ATGC bases
 */
export function calculateTm(sequence, options = {}) {
  const { oligoConc = 50e-9, saltConc = 0.05 } = options

  if (!sequence || sequence.length < 2) {
    return null
  }

  const seq = sequence.toUpperCase()

  // Validate sequence (only A, T, G, C allowed for accurate Tm)
  if (!/^[ATGC]+$/.test(seq)) {
    return null
  }

  // Sum nearest-neighbor contributions
  let dH = 0  // kcal/mol
  let dS = 0  // cal/mol·K

  for (let i = 0; i < seq.length - 1; i++) {
    const dinuc = seq[i] + seq[i + 1]
    const params = NN_PARAMS[dinuc]
    if (!params) {
      return null  // Unknown dinucleotide
    }
    dH += params.dH
    dS += params.dS
  }

  // Add terminal penalties
  const firstBase = seq[0]
  const lastBase = seq[seq.length - 1]

  if (firstBase === 'A' || firstBase === 'T') {
    dH += INIT_PARAMS.AT_TERM.dH
    dS += INIT_PARAMS.AT_TERM.dS
  }
  if (lastBase === 'A' || lastBase === 'T') {
    dH += INIT_PARAMS.AT_TERM.dH
    dS += INIT_PARAMS.AT_TERM.dS
  }

  // Convert dH to cal/mol (dS is already in cal/mol·K)
  const dH_cal = dH * 1000

  // Gas constant
  const R = 1.987  // cal/mol·K

  // Salt correction (SantaLucia 1998)
  const saltCorrectedDS = dS + 0.368 * (seq.length - 1) * Math.log(saltConc)

  // Tm calculation: Tm = ΔH / (ΔS + R·ln(Ct/4)) - 273.15
  // For self-complementary: Ct/4, for non-self-complementary: Ct
  // We assume non-self-complementary (typical case)
  const Tm = (dH_cal / (saltCorrectedDS + R * Math.log(oligoConc))) - 273.15

  return Math.round(Tm * 10) / 10  // Round to 1 decimal place
}
