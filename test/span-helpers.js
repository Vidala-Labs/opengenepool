/**
 * Test helper for creating Span/Range objects concisely.
 */

import { Span, Range, Orientation } from '../src/utils/dna.js'

/**
 * Create a simple Span with one Range.
 * @param {number} start - Start position
 * @param {number} end - End position
 * @param {number} [orientation=Orientation.PLUS] - Orientation (use Orientation.MINUS for reverse)
 * @param {boolean} [startIndefinite=false] - Start indefinite flag
 * @param {boolean} [endIndefinite=false] - End indefinite flag
 * @returns {Span}
 */
export function ezSpan(start, end, orientation = Orientation.PLUS, startIndefinite = false, endIndefinite = false) {
  return new Span([new Range(start, end, orientation, startIndefinite, endIndefinite)])
}

// Re-export for convenience
export { Span, Range, Orientation }
