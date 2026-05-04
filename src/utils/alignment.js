/**
 * Smith-Waterman Local Pairwise Alignment
 *
 * Implements the Smith-Waterman algorithm for local DNA sequence alignment
 * with IUPAC ambiguity code support and affine gap penalties.
 */

import { Range, Span } from './dna.js'
import { Annotation } from './annotation.js'

/**
 * IUPAC ambiguity code definitions.
 * Each code maps to the set of bases it can represent.
 */
const IUPAC_CODES = {
  'A': new Set(['A']),
  'T': new Set(['T']),
  'G': new Set(['G']),
  'C': new Set(['C']),
  'N': new Set(['A', 'T', 'G', 'C']),
  'R': new Set(['A', 'G']),         // puRine
  'Y': new Set(['C', 'T']),         // pYrimidine
  'S': new Set(['G', 'C']),         // Strong
  'W': new Set(['A', 'T']),         // Weak
  'K': new Set(['G', 'T']),         // Keto
  'M': new Set(['A', 'C']),         // aMino
  'B': new Set(['C', 'G', 'T']),    // not A
  'D': new Set(['A', 'G', 'T']),    // not C
  'H': new Set(['A', 'C', 'T']),    // not G
  'V': new Set(['A', 'C', 'G'])     // not T
}

/**
 * Score the match between two bases, handling IUPAC ambiguity codes.
 *
 * @param {string} base1 - First base (may be IUPAC code)
 * @param {string} base2 - Second base (may be IUPAC code)
 * @param {number} [matchScore=2] - Score for exact match
 * @param {number} [ambiguousScore=1] - Score for IUPAC ambiguous match
 * @param {number} [mismatchScore=-1] - Score for mismatch
 * @returns {number} The match score
 */
export function scoreMatch(base1, base2, matchScore = 2, ambiguousScore = 1, mismatchScore = -1) {
  const b1 = base1.toUpperCase()
  const b2 = base2.toUpperCase()

  const set1 = IUPAC_CODES[b1]
  const set2 = IUPAC_CODES[b2]

  if (!set1 || !set2) {
    return mismatchScore
  }

  // Check for intersection
  const hasIntersection = [...set1].some(base => set2.has(base))

  if (!hasIntersection) {
    return mismatchScore
  }

  // Exact match (both are single standard bases and same)
  if (set1.size === 1 && set2.size === 1 && b1 === b2) {
    return matchScore
  }

  // Ambiguous match (intersection exists but not exact)
  return ambiguousScore
}

/**
 * @typedef {Object} AlignmentResult
 * @property {number} score - Alignment score
 * @property {number} queryStart - Start position in query (0-based, inclusive)
 * @property {number} queryEnd - End position in query (0-based, exclusive)
 * @property {number} targetStart - Start position in target (0-based, inclusive)
 * @property {number} targetEnd - End position in target (0-based, exclusive)
 * @property {string} queryAligned - Query sequence with gaps ('-')
 * @property {string} targetAligned - Target sequence with gaps ('-')
 * @property {number} identity - Percent identity (0-100)
 */

/**
 * Perform Smith-Waterman local alignment.
 *
 * @param {string} query - Query sequence
 * @param {string} target - Target sequence
 * @param {Object} [options] - Scoring options
 * @param {number} [options.match=2] - Match score
 * @param {number} [options.mismatch=-1] - Mismatch penalty
 * @param {number} [options.gapOpen=-3] - Gap opening penalty
 * @param {number} [options.gapExtend=-1] - Gap extension penalty
 * @returns {AlignmentResult}
 */
export function align(query, target, options = {}) {
  const {
    match = 2,
    mismatch = -1,
    gapOpen = -3,
    gapExtend = -1
  } = options

  const m = query.length
  const n = target.length

  // Handle empty sequences
  if (m === 0 || n === 0) {
    return {
      score: 0,
      queryStart: 0,
      queryEnd: 0,
      targetStart: 0,
      targetEnd: 0,
      queryAligned: '',
      targetAligned: '',
      identity: 0
    }
  }

  // Initialize scoring matrices
  // H[i][j] = best alignment score ending at query[i-1], target[j-1]
  // E[i][j] = best score ending with gap in query (deletion)
  // F[i][j] = best score ending with gap in target (insertion)
  const H = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0))
  const E = Array(m + 1).fill(null).map(() => Array(n + 1).fill(-Infinity))
  const F = Array(m + 1).fill(null).map(() => Array(n + 1).fill(-Infinity))

  // Track maximum score position
  let maxScore = 0
  let maxI = 0
  let maxJ = 0

  // Fill matrices
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      // Score for match/mismatch
      const matchScore = scoreMatch(query[i - 1], target[j - 1], match, 1, mismatch)

      // E[i][j] = max(H[i][j-1] + gapOpen, E[i][j-1] + gapExtend)
      E[i][j] = Math.max(
        H[i][j - 1] + gapOpen + gapExtend,
        E[i][j - 1] + gapExtend
      )

      // F[i][j] = max(H[i-1][j] + gapOpen, F[i-1][j] + gapExtend)
      F[i][j] = Math.max(
        H[i - 1][j] + gapOpen + gapExtend,
        F[i - 1][j] + gapExtend
      )

      // H[i][j] = max(0, H[i-1][j-1] + matchScore, E[i][j], F[i][j])
      H[i][j] = Math.max(
        0,
        H[i - 1][j - 1] + matchScore,
        E[i][j],
        F[i][j]
      )

      // Track maximum
      if (H[i][j] > maxScore) {
        maxScore = H[i][j]
        maxI = i
        maxJ = j
      }
    }
  }

  // No alignment found
  if (maxScore === 0) {
    return {
      score: 0,
      queryStart: 0,
      queryEnd: 0,
      targetStart: 0,
      targetEnd: 0,
      queryAligned: '',
      targetAligned: '',
      identity: 0
    }
  }

  // Traceback from maximum score position
  let queryAligned = ''
  let targetAligned = ''
  let i = maxI
  let j = maxJ

  while (i > 0 && j > 0 && H[i][j] > 0) {
    const current = H[i][j]
    const matchScore = scoreMatch(query[i - 1], target[j - 1], match, 1, mismatch)
    const diagonal = H[i - 1][j - 1] + matchScore

    if (current === diagonal) {
      // Match/mismatch
      queryAligned = query[i - 1] + queryAligned
      targetAligned = target[j - 1] + targetAligned
      i--
      j--
    } else if (current === E[i][j]) {
      // Gap in query (deletion from query perspective)
      queryAligned = '-' + queryAligned
      targetAligned = target[j - 1] + targetAligned
      j--
      // Continue through gap
      while (j > 0 && E[i][j] === E[i][j - 1] + gapExtend) {
        queryAligned = '-' + queryAligned
        targetAligned = target[j - 1] + targetAligned
        j--
      }
    } else {
      // Gap in target (insertion from query perspective)
      queryAligned = query[i - 1] + queryAligned
      targetAligned = '-' + targetAligned
      i--
      // Continue through gap
      while (i > 0 && F[i][j] === F[i - 1][j] + gapExtend) {
        queryAligned = query[i - 1] + queryAligned
        targetAligned = '-' + targetAligned
        i--
      }
    }
  }

  // Calculate identity
  let matches = 0
  let alignedLength = queryAligned.length
  for (let k = 0; k < alignedLength; k++) {
    if (queryAligned[k] !== '-' && targetAligned[k] !== '-') {
      const qBase = queryAligned[k].toUpperCase()
      const tBase = targetAligned[k].toUpperCase()
      if (qBase === tBase) {
        matches++
      }
    }
  }

  // Count non-gap positions for identity calculation
  let nonGapPositions = 0
  for (let k = 0; k < alignedLength; k++) {
    if (queryAligned[k] !== '-' && targetAligned[k] !== '-') {
      nonGapPositions++
    }
  }

  const identity = nonGapPositions > 0 ? Math.round((matches / nonGapPositions) * 1000) / 10 : 0

  return {
    score: maxScore,
    queryStart: i,
    queryEnd: maxI,
    targetStart: j,
    targetEnd: maxJ,
    queryAligned,
    targetAligned,
    identity
  }
}

/**
 * Build a coordinate map from aligned sequence back to alignment positions.
 *
 * This creates an array where index is the original sequence position
 * and value is the position in the aligned string.
 *
 * @param {string} alignedSequence - Sequence with gaps ('-')
 * @param {number} originalStart - Start position in original sequence
 * @returns {number[]} Map from original position to aligned position
 */
export function buildCoordinateMap(alignedSequence, originalStart) {
  const map = []
  let alignedPos = 0

  for (let i = 0; i < alignedSequence.length; i++) {
    if (alignedSequence[i] !== '-') {
      map.push(i)
    }
  }

  // Adjust indices to be relative to the aligned string positions
  // The returned map[i] gives the aligned position for original position (originalStart + i)
  return map
}

/**
 * Map an original sequence coordinate to an aligned sequence position.
 *
 * @param {number} originalPos - Position in original sequence (0-based)
 * @param {number[]} coordinateMap - Map built by buildCoordinateMap
 * @param {number} [originalStart=0] - Start position used when building the map
 * @returns {number|null} Position in aligned sequence, or null if out of range
 */
export function mapCoordinate(originalPos, coordinateMap, originalStart = 0) {
  const index = originalPos - originalStart

  if (index < 0 || index >= coordinateMap.length) {
    return null
  }

  return coordinateMap[index]
}

/**
 * Build a reverse coordinate map from original position to aligned position.
 * This creates an object where keys are original positions and values are aligned positions.
 *
 * @param {string} alignedSequence - Sequence with gaps ('-')
 * @param {number} originalStart - Start position in original sequence
 * @returns {Object} Map from original position to aligned position
 */
export function buildReverseCoordinateMap(alignedSequence, originalStart) {
  const map = {}
  let origPos = originalStart

  for (let alignedPos = 0; alignedPos < alignedSequence.length; alignedPos++) {
    if (alignedSequence[alignedPos] !== '-') {
      map[origPos] = alignedPos
      origPos++
    }
  }

  return map
}

/**
 * Extract gap positions from an aligned sequence string.
 *
 * @param {string} alignedSequence - Sequence with gaps ('-')
 * @param {number} originalStart - Start position in original sequence
 * @returns {Array<{position: number, length: number}>} Array of gap objects
 */
export function extractGaps(alignedSequence, originalStart) {
  const gaps = []
  let originalPos = originalStart
  let i = 0

  while (i < alignedSequence.length) {
    if (alignedSequence[i] === '-') {
      // Found a gap, count its length
      let gapLength = 0
      while (i < alignedSequence.length && alignedSequence[i] === '-') {
        gapLength++
        i++
      }
      gaps.push({ position: originalPos, length: gapLength })
    } else {
      // Non-gap character
      originalPos++
      i++
    }
  }

  return gaps
}

/**
 * Map an annotation through alignment, adjusting coordinates for gaps.
 *
 * @param {Object} annotation - Annotation with span property
 * @param {Object} reverseMap - Map from original to aligned positions
 * @param {number} originalStart - Start position in original sequence
 * @param {number} originalEnd - End position in original sequence (exclusive)
 * @returns {Object|null} Annotation with mapped coordinates, or null if outside alignment
 */
export function mapAnnotationThroughAlignment(annotation, reverseMap, originalStart, originalEnd) {
  if (!annotation.span || !annotation.span.ranges) return null

  const mappedRanges = []

  for (const range of annotation.span.ranges) {
    // Check if range overlaps with aligned region
    if (range.end <= originalStart || range.start >= originalEnd) {
      continue // Range is completely outside alignment
    }

    // Clamp range to aligned region
    const clampedStart = Math.max(range.start, originalStart)
    const clampedEnd = Math.min(range.end, originalEnd)

    // Map coordinates
    const mappedStart = reverseMap[clampedStart]
    const mappedEnd = reverseMap[clampedEnd - 1]

    if (mappedStart === undefined || mappedEnd === undefined) {
      continue // Coordinates couldn't be mapped
    }

    mappedRanges.push({
      start: mappedStart,
      end: mappedEnd + 1, // Convert back to exclusive end
      orientation: range.orientation
    })
  }

  if (mappedRanges.length === 0) return null

  // Create proper Range instances from mapped ranges
  const ranges = mappedRanges.map(r => new Range(r.start, r.end, r.orientation))

  // Create a new Annotation with the mapped span
  return new Annotation({
    id: annotation.id,
    caption: annotation.caption,
    type: annotation.type,
    span: new Span(ranges),
    attributes: {
      ...annotation.attributes,
      _originalAnnotation: annotation
    }
  })
}
