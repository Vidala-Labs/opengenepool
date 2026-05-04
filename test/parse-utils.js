/**
 * Test utilities for parsing span/range strings.
 *
 * These are ONLY for test convenience. Production code should construct
 * Range and Span objects directly. The only production boundary for
 * string parsing is the GenBank parser.
 */

import { Span, Range, Orientation } from '../src/utils/dna.js'

/**
 * Parse a range string into a Range object.
 * @param {string} str - Range string like "10..20", "(10..20)", "<10..>20"
 * @returns {Range}
 */
export function parseRange(str) {
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

  const startIndefinite = inner.startsWith('<')
  const endIndefinite = inner.includes('..>') || (inner.endsWith('>') && !inner.includes('..'))
  const cleaned = inner.replace(/[<>]/g, '')
  const parts = cleaned.split('..')
  const start = parseInt(parts[0], 10)
  const end = parts[1] !== undefined ? parseInt(parts[1], 10) : start

  if (isNaN(start) || isNaN(end)) {
    throw new Error(`Invalid range string: ${str}`)
  }

  return new Range(start, end, orientation, startIndefinite, endIndefinite)
}

/**
 * Parse a span string into a Span object.
 * @param {string} str - Span string like "10..20" or "10..20 + 30..40"
 * @returns {Span}
 */
export function parseSpan(str) {
  const parts = str.split('+').map(s => s.trim()).filter(s => s)
  const ranges = parts.map(p => parseRange(p))
  return new Span(ranges)
}
