import { describe, it, expect, beforeAll } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  align,
  scoreMatch,
  buildCoordinateMap,
  buildAlignedToOriginalMap,
  normalizeCircularPosition,
  mapCoordinate,
  buildReverseCoordinateMap,
  extractGaps,
  mapAnnotationThroughAlignment,
  reverseComplementAnnotation
} from './alignment.js'
import { Range, Span, Orientation } from './dna.js'

/**
 * Smith-Waterman Local Alignment Tests
 *
 * These tests verify the Smith-Waterman algorithm implementation for
 * local pairwise DNA sequence alignment.
 */

describe('scoreMatch', () => {
  describe('exact matches', () => {
    it('scores exact base matches positively', () => {
      expect(scoreMatch('A', 'A')).toBe(2)
      expect(scoreMatch('T', 'T')).toBe(2)
      expect(scoreMatch('G', 'G')).toBe(2)
      expect(scoreMatch('C', 'C')).toBe(2)
    })

    it('is case insensitive', () => {
      expect(scoreMatch('a', 'A')).toBe(2)
      expect(scoreMatch('A', 'a')).toBe(2)
      expect(scoreMatch('t', 'T')).toBe(2)
    })
  })

  describe('mismatches', () => {
    it('scores mismatches negatively', () => {
      expect(scoreMatch('A', 'T')).toBe(-1)
      expect(scoreMatch('A', 'G')).toBe(-1)
      expect(scoreMatch('A', 'C')).toBe(-1)
      expect(scoreMatch('G', 'C')).toBe(-1)
    })
  })

  describe('IUPAC ambiguity codes', () => {
    it('N matches any base', () => {
      expect(scoreMatch('N', 'A')).toBe(1)
      expect(scoreMatch('N', 'T')).toBe(1)
      expect(scoreMatch('N', 'G')).toBe(1)
      expect(scoreMatch('N', 'C')).toBe(1)
      expect(scoreMatch('A', 'N')).toBe(1)
    })

    it('R matches purines (A/G)', () => {
      expect(scoreMatch('R', 'A')).toBe(1)
      expect(scoreMatch('R', 'G')).toBe(1)
      expect(scoreMatch('R', 'T')).toBe(-1)
      expect(scoreMatch('R', 'C')).toBe(-1)
    })

    it('Y matches pyrimidines (C/T)', () => {
      expect(scoreMatch('Y', 'C')).toBe(1)
      expect(scoreMatch('Y', 'T')).toBe(1)
      expect(scoreMatch('Y', 'A')).toBe(-1)
      expect(scoreMatch('Y', 'G')).toBe(-1)
    })

    it('S matches strong bases (G/C)', () => {
      expect(scoreMatch('S', 'G')).toBe(1)
      expect(scoreMatch('S', 'C')).toBe(1)
      expect(scoreMatch('S', 'A')).toBe(-1)
      expect(scoreMatch('S', 'T')).toBe(-1)
    })

    it('W matches weak bases (A/T)', () => {
      expect(scoreMatch('W', 'A')).toBe(1)
      expect(scoreMatch('W', 'T')).toBe(1)
      expect(scoreMatch('W', 'G')).toBe(-1)
      expect(scoreMatch('W', 'C')).toBe(-1)
    })

    it('K matches keto bases (G/T)', () => {
      expect(scoreMatch('K', 'G')).toBe(1)
      expect(scoreMatch('K', 'T')).toBe(1)
      expect(scoreMatch('K', 'A')).toBe(-1)
      expect(scoreMatch('K', 'C')).toBe(-1)
    })

    it('M matches amino bases (A/C)', () => {
      expect(scoreMatch('M', 'A')).toBe(1)
      expect(scoreMatch('M', 'C')).toBe(1)
      expect(scoreMatch('M', 'G')).toBe(-1)
      expect(scoreMatch('M', 'T')).toBe(-1)
    })

    it('three-letter codes work', () => {
      // B = not A (C, G, T)
      expect(scoreMatch('B', 'C')).toBe(1)
      expect(scoreMatch('B', 'G')).toBe(1)
      expect(scoreMatch('B', 'T')).toBe(1)
      expect(scoreMatch('B', 'A')).toBe(-1)

      // D = not C (A, G, T)
      expect(scoreMatch('D', 'A')).toBe(1)
      expect(scoreMatch('D', 'G')).toBe(1)
      expect(scoreMatch('D', 'T')).toBe(1)
      expect(scoreMatch('D', 'C')).toBe(-1)

      // H = not G (A, C, T)
      expect(scoreMatch('H', 'A')).toBe(1)
      expect(scoreMatch('H', 'C')).toBe(1)
      expect(scoreMatch('H', 'T')).toBe(1)
      expect(scoreMatch('H', 'G')).toBe(-1)

      // V = not T (A, C, G)
      expect(scoreMatch('V', 'A')).toBe(1)
      expect(scoreMatch('V', 'C')).toBe(1)
      expect(scoreMatch('V', 'G')).toBe(1)
      expect(scoreMatch('V', 'T')).toBe(-1)
    })

    it('handles symmetry for IUPAC codes', () => {
      // Both directions should give same result
      expect(scoreMatch('R', 'A')).toBe(scoreMatch('A', 'R'))
      expect(scoreMatch('Y', 'T')).toBe(scoreMatch('T', 'Y'))
      expect(scoreMatch('N', 'G')).toBe(scoreMatch('G', 'N'))
    })
  })
})

describe('align', () => {
  describe('exact match alignment', () => {
    it('aligns identical sequences', () => {
      const result = align('ATCGATCG', 'ATCGATCG')

      expect(result.queryAligned).toBe('ATCGATCG')
      expect(result.targetAligned).toBe('ATCGATCG')
      expect(result.queryStart).toBe(0)
      expect(result.queryEnd).toBe(8)
      expect(result.targetStart).toBe(0)
      expect(result.targetEnd).toBe(8)
      expect(result.identity).toBe(100)
    })

    it('finds exact match within longer target', () => {
      const result = align('ATCG', 'NNNATCGNNN')

      expect(result.queryAligned).toBe('ATCG')
      expect(result.targetAligned).toBe('ATCG')
      expect(result.queryStart).toBe(0)
      expect(result.queryEnd).toBe(4)
      expect(result.targetStart).toBe(3)
      expect(result.targetEnd).toBe(7)
    })

    it('finds exact match within longer query', () => {
      const result = align('NNNATCGNNN', 'ATCG')

      expect(result.queryAligned).toBe('ATCG')
      expect(result.targetAligned).toBe('ATCG')
      expect(result.queryStart).toBe(3)
      expect(result.queryEnd).toBe(7)
      expect(result.targetStart).toBe(0)
      expect(result.targetEnd).toBe(4)
    })
  })

  describe('reverse-complement query', () => {
    // When the query only matches the target on the opposite strand, `align`
    // with { tryReverseComplement: true } should detect it: try both
    // orientations, keep the better-scoring one, and report which won. The
    // returned queryAligned/targetAligned and coordinates describe the WINNING
    // orientation (so the rows line up under the match bars), and
    // result.reverseComplement flags that the query was flipped.
    it('detects a query that matches only as reverse complement', () => {
      const target = 'ATGCGTACGTTAGCCTAGGCTAATCGGATCCGGAATTCCTGCAG'
      // reverseComplement(target) — the antisense strand of the target.
      const query = 'CTGCAGGAATTCCGGATCCGATTAGCCTAGGCTAACGTACGCAT'

      const result = align(query, target, { tryReverseComplement: true })

      expect(result.reverseComplement).toBe(true)
      expect(result.identity).toBe(100)
      // The aligned query equals the RC of the original query (== target here),
      // so it lines up base-for-base with the target.
      expect(result.queryAligned).toBe(target)
      expect(result.targetAligned).toBe(target)
    })

    it('keeps forward orientation when the forward match is better', () => {
      const target = 'ATGCGTACGTTAGCCTAGGCTAATCGGATCCGGAATTCCTGCAG'
      const query = target // identical, forward

      const result = align(query, target, { tryReverseComplement: true })

      expect(result.reverseComplement).toBe(false)
      expect(result.identity).toBe(100)
      expect(result.queryAligned).toBe(target)
    })

    it('does not try reverse complement unless requested', () => {
      const target = 'ATGCGTACGTTAGCCTAGGCTAATCGGATCCGGAATTCCTGCAG'
      const query = 'CTGCAGGAATTCCGGATCCGATTAGCCTAGGCTAACGTACGCAT' // RC of target

      const result = align(query, target) // no flag

      // Without the flag the antisense query should NOT align well.
      expect(result.reverseComplement).toBeUndefined()
      expect(result.identity).toBeLessThan(100)
    })

    it('composes reverse complement with circular origin rotation', () => {
      // Query is the reverse complement of the target AND linearized at a
      // different origin: both transforms must be undone to recover identity.
      const target = 'ATGCGTACGTTAGCCTAGGCTAATCGGATCCGGAATTCCTGCAG'
      const rc = 'CTGCAGGAATTCCGGATCCGATTAGCCTAGGCTAACGTACGCAT' // RC(target)
      const offset = 19
      const query = rc.slice(offset) + rc.slice(0, offset)

      const result = align(query, target, { tryReverseComplement: true, circular: true, originKmerSize: 8 })

      expect(result.reverseComplement).toBe(true)
      expect(result.identity).toBe(100)
      // Full-length match recovered: the rows line up base-for-base (circular
      // rotation means the aligned strings start at a rotated origin, so they
      // equal each other rather than the un-rotated `target`).
      expect(result.queryAligned).toBe(result.targetAligned)
      expect(result.queryEnd - result.queryStart).toBe(target.length)
    })
  })

  describe('alignment with mismatches', () => {
    it('aligns sequences with single mismatch', () => {
      const result = align('ATCGATCG', 'ATCGTTCG')

      expect(result.queryAligned).toBe('ATCGATCG')
      expect(result.targetAligned).toBe('ATCGTTCG')
      // One mismatch in 8 bases = 87.5% identity
      expect(result.identity).toBe(87.5)
    })

    it('aligns sequences with multiple mismatches', () => {
      const result = align('ATCGATCG', 'ATGGATGG')

      expect(result.queryAligned).toBe('ATCGATCG')
      expect(result.targetAligned).toBe('ATGGATGG')
      // Two mismatches in 8 bases = 75% identity
      expect(result.identity).toBe(75)
    })
  })

  describe('alignment with gaps', () => {
    it('handles insertion in query', () => {
      const result = align('ATCGXXATCG', 'ATCGATCG')

      // Query has extra XX that needs to be gapped out
      expect(result.targetAligned).toContain('-')
      expect(result.queryAligned.replace(/-/g, '')).toContain('ATCG')
    })

    it('handles deletion in query', () => {
      const result = align('ATCGATCG', 'ATCGXXATCG')

      // Target has extra XX that needs to be gapped out
      expect(result.queryAligned).toContain('-')
      expect(result.targetAligned.replace(/-/g, '')).toContain('ATCG')
    })

    it('produces valid gap-aligned sequences', () => {
      const result = align('ATCGATCG', 'ATCGAATCG')

      // Both aligned sequences should have same length
      expect(result.queryAligned.length).toBe(result.targetAligned.length)
    })
  })

  describe('local alignment behavior', () => {
    it('finds best local match, ignoring poor flanking regions', () => {
      // Strong match in the middle, poor ends
      const result = align('XXXATCGATCGXXX', 'YYYATCGATCGYYY')

      // Should find the ATCGATCG portion
      expect(result.queryAligned).toBe('ATCGATCG')
      expect(result.targetAligned).toBe('ATCGATCG')
      expect(result.queryStart).toBe(3)
      expect(result.queryEnd).toBe(11)
      expect(result.targetStart).toBe(3)
      expect(result.targetEnd).toBe(11)
    })

    it('returns no match when sequences have no similarity', () => {
      const result = align('AAAAAAA', 'TTTTTTT')

      // No meaningful local alignment
      expect(result.score).toBe(0)
      expect(result.queryAligned).toBe('')
      expect(result.targetAligned).toBe('')
    })
  })

  describe('IUPAC ambiguity handling in alignment', () => {
    it('aligns with N wildcards', () => {
      const result = align('ATCGATCG', 'ATNGANCG')

      // N should match any base
      expect(result.identity).toBeGreaterThan(50)
    })

    it('aligns with R/Y ambiguity codes', () => {
      const result = align('ATCGATCG', 'RYCGRYCY')

      // R matches A/G, Y matches C/T
      // The algorithm should find some matching positions
      expect(result.score).toBeGreaterThan(0)
      expect(result.queryAligned.length).toBeGreaterThan(0)
    })
  })

  describe('edge cases', () => {
    it('handles empty query', () => {
      const result = align('', 'ATCG')

      expect(result.score).toBe(0)
      expect(result.queryAligned).toBe('')
      expect(result.targetAligned).toBe('')
    })

    it('handles empty target', () => {
      const result = align('ATCG', '')

      expect(result.score).toBe(0)
      expect(result.queryAligned).toBe('')
      expect(result.targetAligned).toBe('')
    })

    it('handles single base sequences', () => {
      const result = align('A', 'A')

      expect(result.score).toBe(2)
      expect(result.queryAligned).toBe('A')
      expect(result.targetAligned).toBe('A')
    })

    it('is case insensitive', () => {
      const result1 = align('ATCG', 'ATCG')
      const result2 = align('atcg', 'ATCG')
      const result3 = align('AtCg', 'aTcG')

      expect(result1.score).toBe(result2.score)
      expect(result1.score).toBe(result3.score)
    })
  })

  describe('scoring parameters', () => {
    it('uses default scoring when no options provided', () => {
      const result = align('ATCG', 'ATCG')

      // Default: match=2, 4 bases = 8 score
      expect(result.score).toBe(8)
    })

    it('accepts custom match score', () => {
      const result = align('ATCG', 'ATCG', { match: 5 })

      // Custom: match=5, 4 bases = 20 score
      expect(result.score).toBe(20)
    })

    it('accepts custom mismatch score', () => {
      const result1 = align('ATCG', 'ATGG', { mismatch: -1 })
      const result2 = align('ATCG', 'ATGG', { mismatch: -3 })

      // Harsher mismatch penalty should give lower score
      expect(result2.score).toBeLessThan(result1.score)
    })

    it('accepts custom gap penalties', () => {
      const result1 = align('ATCGATCG', 'ATCGAATCG', { gapOpen: -2, gapExtend: -1 })
      const result2 = align('ATCGATCG', 'ATCGAATCG', { gapOpen: -10, gapExtend: -5 })

      // Harsher gap penalties should give lower score or different alignment
      expect(result2.score).toBeLessThanOrEqual(result1.score)
    })
  })

  describe('result structure', () => {
    it('returns all expected fields', () => {
      const result = align('ATCG', 'ATCG')

      expect(result).toHaveProperty('score')
      expect(result).toHaveProperty('queryStart')
      expect(result).toHaveProperty('queryEnd')
      expect(result).toHaveProperty('targetStart')
      expect(result).toHaveProperty('targetEnd')
      expect(result).toHaveProperty('queryAligned')
      expect(result).toHaveProperty('targetAligned')
      expect(result).toHaveProperty('identity')
    })

    it('coordinates use fenced (0-based, half-open) system', () => {
      const result = align('ATCG', 'XXATCGXX')

      // queryStart=0, queryEnd=4 means positions 0,1,2,3 (4 bases)
      expect(result.queryEnd - result.queryStart).toBe(4)
      // targetStart=2, targetEnd=6 means positions 2,3,4,5 (4 bases)
      expect(result.targetEnd - result.targetStart).toBe(4)
    })
  })
})

describe('coordinate mapping', () => {
  describe('buildCoordinateMap', () => {
    it('maps ungapped positions correctly', () => {
      const map = buildCoordinateMap('ATCG', 0)

      expect(map).toEqual([0, 1, 2, 3])
    })

    it('handles gaps in aligned sequence', () => {
      const map = buildCoordinateMap('AT--CG', 0)

      // Positions 0,1 map to 0,1; positions 2,3 are gaps; positions 4,5 map to 2,3
      // Map only includes non-gap positions
      expect(map).toEqual([0, 1, 4, 5])
    })

    it('offset parameter is used by mapCoordinate', () => {
      // Map always returns aligned positions (0-indexed)
      const map = buildCoordinateMap('ATCG', 10)

      // Map contains aligned positions for bases starting at original position 10
      expect(map).toEqual([0, 1, 2, 3])

      // mapCoordinate uses the offset to translate original coords
      expect(mapCoordinate(10, map, 10)).toBe(0)
      expect(mapCoordinate(11, map, 10)).toBe(1)
    })
  })

  describe('mapCoordinate', () => {
    it('maps original coordinate to aligned position', () => {
      // For 'AT--CG' aligned to original starting at 0:
      // original 0 -> aligned 0
      // original 1 -> aligned 1
      // original 2 -> aligned 4
      // original 3 -> aligned 5
      const map = buildCoordinateMap('AT--CG', 0)

      expect(mapCoordinate(0, map)).toBe(0)
      expect(mapCoordinate(1, map)).toBe(1)
      expect(mapCoordinate(2, map)).toBe(4)
      expect(mapCoordinate(3, map)).toBe(5)
    })

    it('returns null for out-of-range coordinates', () => {
      // Map for 4 bases starting at original position 5
      const map = buildCoordinateMap('ATCG', 5)

      // Original positions 5-8 are valid (4 bases)
      expect(mapCoordinate(4, map, 5)).toBeNull()  // Before start
      expect(mapCoordinate(5, map, 5)).toBe(0)     // At start
      expect(mapCoordinate(8, map, 5)).toBe(3)     // Last valid
      expect(mapCoordinate(9, map, 5)).toBeNull()  // After end
    })
  })
})

describe('extractGaps', () => {
  it('returns empty array for sequence with no gaps', () => {
    const gaps = extractGaps('ATCG', 0)
    expect(gaps).toEqual([])
  })

  it('extracts single gap from aligned sequence', () => {
    // 'AT--CG' has a gap of length 2 after position 1 (after T)
    const gaps = extractGaps('AT--CG', 0)
    expect(gaps).toEqual([{ position: 2, length: 2 }])
  })

  it('extracts multiple gaps from aligned sequence', () => {
    // 'A-T--CG-' has gaps at:
    // - length 1 after position 0 (after A)
    // - length 2 after position 1 (after T)
    // - length 1 after position 3 (after G)
    const gaps = extractGaps('A-T--CG-', 0)
    expect(gaps).toEqual([
      { position: 1, length: 1 },
      { position: 2, length: 2 },
      { position: 4, length: 1 }
    ])
  })

  it('handles gap at the start of sequence', () => {
    // '--ATCG' has a gap of length 2 before position 0
    const gaps = extractGaps('--ATCG', 0)
    expect(gaps).toEqual([{ position: 0, length: 2 }])
  })

  it('handles gap at the end of sequence', () => {
    // 'ATCG--' has a gap of length 2 after position 3 (after G)
    const gaps = extractGaps('ATCG--', 0)
    expect(gaps).toEqual([{ position: 4, length: 2 }])
  })

  it('respects originalStart offset', () => {
    // 'AT--CG' with originalStart=10 means positions are 10,11,12,13
    // Gap is after position 11 (original position)
    const gaps = extractGaps('AT--CG', 10)
    expect(gaps).toEqual([{ position: 12, length: 2 }])
  })

  it('handles consecutive single gaps', () => {
    // 'A-T-C-G' has three separate single-character gaps
    const gaps = extractGaps('A-T-C-G', 0)
    expect(gaps).toEqual([
      { position: 1, length: 1 },
      { position: 2, length: 1 },
      { position: 3, length: 1 }
    ])
  })

  it('handles all gaps (edge case)', () => {
    const gaps = extractGaps('----', 0)
    expect(gaps).toEqual([{ position: 0, length: 4 }])
  })

  it('handles empty string', () => {
    const gaps = extractGaps('', 0)
    expect(gaps).toEqual([])
  })
})

describe('circular coordinate mapping', () => {
  it('normalizes virtual positions into physical circular coordinates', () => {
    expect(normalizeCircularPosition(0, 4)).toBe(0)
    expect(normalizeCircularPosition(3, 4)).toBe(3)
    expect(normalizeCircularPosition(4, 4)).toBe(0)
    expect(normalizeCircularPosition(5, 4)).toBe(1)
    expect(normalizeCircularPosition(-1, 4)).toBe(3)
  })

  it('builds aligned-to-original maps with circular wrapping', () => {
    const map = buildAlignedToOriginalMap('AATT', 2, {
      circular: true,
      sequenceLength: 4
    })

    expect(map).toEqual([2, 3, 0, 1])
  })

  it('builds reverse maps with circular wrapping', () => {
    const map = buildReverseCoordinateMap('AATT', 2, {
      circular: true,
      sequenceLength: 4
    })

    expect(map).toEqual({
      0: 2,
      1: 3,
      2: 0,
      3: 1
    })
  })

  it('extracts circular gaps at physical coordinates', () => {
    const gaps = extractGaps('AA--TT', 2, {
      circular: true,
      sequenceLength: 4
    })

    expect(gaps).toEqual([{ position: 0, length: 2 }])
  })

  it('maps circular annotations after the virtual origin', () => {
    const annotation = {
      id: 'after-origin',
      caption: 'after-origin',
      type: 'gene',
      span: new Span([new Range(0, 2, Orientation.PLUS)])
    }
    const reverseMap = buildReverseCoordinateMap('AATT', 2, {
      circular: true,
      sequenceLength: 4
    })

    const mapped = mapAnnotationThroughAlignment(annotation, reverseMap, 2, 6, {
      circular: true,
      sequenceLength: 4
    })

    expect(mapped.span.ranges).toHaveLength(1)
    expect(mapped.span.ranges[0].start).toBe(2)
    expect(mapped.span.ranges[0].end).toBe(4)
  })

  it('maps split annotations that cross the physical origin', () => {
    const annotation = {
      id: 'cross-origin',
      caption: 'cross-origin',
      type: 'gene',
      span: new Span([
        new Range(3, 4, Orientation.MINUS),
        new Range(0, 1, Orientation.MINUS)
      ])
    }
    const reverseMap = buildReverseCoordinateMap('AATT', 2, {
      circular: true,
      sequenceLength: 4
    })

    const mapped = mapAnnotationThroughAlignment(annotation, reverseMap, 2, 6, {
      circular: true,
      sequenceLength: 4
    })

    expect(mapped.span.ranges).toHaveLength(2)
    expect(mapped.span.ranges[0].start).toBe(1)
    expect(mapped.span.ranges[0].end).toBe(2)
    expect(mapped.span.ranges[0].orientation).toBe(Orientation.MINUS)
    expect(mapped.span.ranges[1].start).toBe(2)
    expect(mapped.span.ranges[1].end).toBe(3)
    expect(mapped.span.ranges[1].orientation).toBe(Orientation.MINUS)
  })
})

describe('contiguous gap preference', () => {
  it('keeps deletions contiguous for repeated bases like CCC', () => {
    // Target: ATGCCCTAG, Query: ATGCTAG (missing two C's)
    // Should produce contiguous gap, NOT fragmented like ATG-C-TAG or A-GC-CTAG
    const result = align('ATGCTAG', 'ATGCCCTAG')

    expect(result.targetAligned).toBe('ATGCCCTAG')

    // The key requirement: gaps must be contiguous (only one gap region)
    // Position can vary (ATGC--TAG or ATG--CTAG) but must NOT be fragmented
    const gapMatches = result.queryAligned.match(/-+/g)
    expect(gapMatches).not.toBeNull()
    expect(gapMatches.length).toBe(1) // Only ONE gap region, not fragmented

    // Verify it's a 2-base gap
    expect(gapMatches[0]).toBe('--')
  })

  it('keeps deletions contiguous - no fragmented gaps like -C- instead of C--', () => {
    // Target: ATCGAAATCG, Query: ATCGATCG (missing two A's)
    // Should produce one contiguous gap.
    // NOT fragmented like: ATCG-A-TCG or AT-G-AATCG
    const result = align('ATCGATCG', 'ATCGAAATCG')

    expect(result.targetAligned).toBe('ATCGAAATCG')

    // Verify gaps are contiguous (only one gap region)
    const gapMatches = result.queryAligned.match(/-+/g)
    expect(gapMatches).not.toBeNull()
    expect(gapMatches.length).toBe(1) // Only one contiguous gap region
    expect(gapMatches[0]).toBe('--')
  })

  it('keeps insertions contiguous', () => {
    // Target: ATCGATCG, Query: ATCGAAATCG (extra AA)
    const result = align('ATCGAAATCG', 'ATCGATCG')

    expect(result.queryAligned).toBe('ATCGAAATCG')

    // Verify gaps are contiguous
    const gapMatches = result.targetAligned.match(/-+/g)
    expect(gapMatches).not.toBeNull()
    expect(gapMatches.length).toBe(1)
    expect(gapMatches[0]).toBe('--')
  })

  it('prefers one long gap over multiple short gaps', () => {
    // With affine gap penalties, one gap of length 3 should score better
    // than three gaps of length 1
    // Test: ATCGATCGATCG vs ATCGAAATCG (2 base deletion)
    const result = align('ATCGATCG', 'ATCGAAATCG')

    // Count gap regions - should be exactly 1
    const gapRegions = result.queryAligned.split(/[^-]+/).filter(s => s.length > 0)
    expect(gapRegions.length).toBe(1)
  })
})

describe('linear operation compatibility regressions', () => {
  function expectSingleGapRun(value, length) {
    const gapMatches = value.match(/-+/g)
    expect(gapMatches).not.toBeNull()
    expect(gapMatches.length).toBe(1)
    expect(gapMatches[0].length).toBe(length)
  }

  it('aligns small exact matches through the linear compatibility path', () => {
    const result = align('ATCG', 'ATCG')

    expect(result).toMatchObject({
      score: 8,
      queryStart: 0,
      queryEnd: 4,
      targetStart: 0,
      targetEnd: 4,
      queryAligned: 'ATCG',
      targetAligned: 'ATCG',
      identity: 100
    })
  })

  it('keeps deterministic mismatch output for small alignments', () => {
    const result = align('ATCGATCG', 'ATCGTTCG')

    expect(result.queryAligned).toBe('ATCGATCG')
    expect(result.targetAligned).toBe('ATCGTTCG')
    expect(result.identity).toBe(87.5)
  })

  it('trims poor flanks from local alignments', () => {
    const result = align('XXXATCGATCGXXX', 'YYYATCGATCGYYY')

    expect(result.queryAligned).toBe('ATCGATCG')
    expect(result.targetAligned).toBe('ATCGATCG')
    expect(result.queryStart).toBe(3)
    expect(result.targetStart).toBe(3)
  })

  it('returns the empty compatibility shape for no meaningful match', () => {
    const result = align('AAAAAAA', 'TTTTTTT')

    expect(result).toEqual({
      score: 0,
      queryStart: 0,
      queryEnd: 0,
      targetStart: 0,
      targetEnd: 0,
      queryAligned: '',
      targetAligned: '',
      identity: 0
    })
  })

  it('handles a single-base match', () => {
    const result = align('A', 'A')

    expect(result.score).toBe(2)
    expect(result.queryAligned).toBe('A')
    expect(result.targetAligned).toBe('A')
    expect(result.identity).toBe(100)
  })

  it('handles a single-base mismatch as no local alignment', () => {
    const result = align('A', 'T')

    expect(result.score).toBe(0)
    expect(result.queryAligned).toBe('')
    expect(result.targetAligned).toBe('')
  })

  it('expands target-only operations into query gaps', () => {
    const result = align('ATCGATCG', 'ATCGAAATCG')

    expect(result.queryAligned.replace(/-/g, '')).toBe('ATCGATCG')
    expect(result.targetAligned).toBe('ATCGAAATCG')
    expectSingleGapRun(result.queryAligned, 2)
  })

  it('expands query-only operations into target gaps', () => {
    const result = align('ATCGAAATCG', 'ATCGATCG')

    expect(result.queryAligned).toBe('ATCGAAATCG')
    expect(result.targetAligned.replace(/-/g, '')).toBe('ATCGATCG')
    expectSingleGapRun(result.targetAligned, 2)
  })

  it('coalesces adjacent target-only operations into one visible gap', () => {
    const result = align('ATGCTAG', 'ATGCCCTAG')

    expect(result.targetAligned).toBe('ATGCCCTAG')
    expectSingleGapRun(result.queryAligned, 2)
  })

  it('keeps compatibility strings at equal length for gapped alignments', () => {
    const result = align('ATCGAAATCG', 'ATCGATCG')

    expect(result.queryAligned.length).toBe(result.targetAligned.length)
  })

  it('normalizes aligned output to uppercase', () => {
    const result = align('atCg', 'aTcG')

    expect(result.queryAligned).toBe('ATCG')
    expect(result.targetAligned).toBe('ATCG')
  })

  it('keeps exported scoreMatch IUPAC semantics', () => {
    expect(scoreMatch('A', 'A')).toBe(2)
    expect(scoreMatch('N', 'G')).toBe(1)
    expect(scoreMatch('R', 'A')).toBe(1)
    expect(scoreMatch('R', 'T')).toBe(-1)
  })

  it('aligns through N wildcard positions', () => {
    const result = align('ATCGATCG', 'ATNGANCG')

    expect(result.score).toBeGreaterThan(0)
    expect(result.queryAligned.length).toBe(result.targetAligned.length)
  })

  it('aligns through mixed ambiguity codes', () => {
    const result = align('ATCGATCG', 'RYCGRYCY')

    expect(result.score).toBeGreaterThan(0)
    expect(result.queryAligned.length).toBeGreaterThan(0)
  })

  it('honors custom match scoring', () => {
    const result = align('ATCG', 'ATCG', { match: 5 })

    expect(result.score).toBe(20)
  })

  it('extracts gaps from compatibility strings with original offsets', () => {
    const gaps = extractGaps('AT--CG', 10)

    expect(gaps).toEqual([{ position: 12, length: 2 }])
  })

  it('builds reverse coordinate maps across gaps', () => {
    const map = buildReverseCoordinateMap('AT--CG', 5)

    expect(map).toEqual({
      5: 0,
      6: 1,
      7: 4,
      8: 5
    })
  })

  it('maps original coordinates to aligned positions with offsets', () => {
    const map = buildCoordinateMap('AT--CG', 5)

    expect(mapCoordinate(5, map, 5)).toBe(0)
    expect(mapCoordinate(6, map, 5)).toBe(1)
    expect(mapCoordinate(7, map, 5)).toBe(4)
    expect(mapCoordinate(8, map, 5)).toBe(5)
  })

  it('returns null when mapping annotations outside the aligned region', () => {
    const annotation = {
      id: 'outside',
      caption: 'outside',
      type: 'gene',
      span: new Span([new Range(20, 25, Orientation.PLUS)])
    }

    const mapped = mapAnnotationThroughAlignment(annotation, buildReverseCoordinateMap('ATCG', 0), 0, 4)

    expect(mapped).toBeNull()
  })

  it('clips mapped annotations and preserves orientation', () => {
    const annotation = {
      id: 'partial',
      caption: 'partial',
      type: 'CDS',
      span: new Span([new Range(4, 9, Orientation.MINUS)])
    }
    const reverseMap = buildReverseCoordinateMap('AT--CGTA', 5)

    const mapped = mapAnnotationThroughAlignment(annotation, reverseMap, 5, 9)

    expect(mapped.id).toBe('partial')
    expect(mapped.span.ranges).toHaveLength(1)
    expect(mapped.span.ranges[0].start).toBe(0)
    expect(mapped.span.ranges[0].end).toBe(6)
    expect(mapped.span.ranges[0].orientation).toBe(Orientation.MINUS)
  })

  describe('query annotation projection across an insertion, deletion, and mutation', () => {
    // A query that differs from the target by all three edit kinds at once:
    //   - SNP at query/target position 10 (C -> A)
    //   - a deletion in the query around position 20 (target has a base the
    //     query lacks -> a gap in queryAligned)
    //   - a 3bp insertion in the query around position 30 (query has bases the
    //     target lacks -> a gap in targetAligned)
    // This exercises mapAnnotationThroughAlignment for the query row: positions
    // before the deletion map straight through; positions after it shift by the
    // gap, and the insertion widens the aligned span.
    const target = 'ATCGATCGATCAATCGATCGCGTACGTACGTAAGCTAGCTA'
    const queryArr = target.split('')
    queryArr[10] = 'A' // SNP
    queryArr.splice(30, 0, 'T', 'T', 'T') // insertion (do before deletion so indices below are target-based)
    queryArr.splice(20, 1) // deletion
    const query = queryArr.join('')

    let result
    let queryReverseMap
    beforeAll(() => {
      result = align(query, target)
      queryReverseMap = buildReverseCoordinateMap(result.queryAligned, result.queryStart)
    })

    it('aligns with a deletion gap, an insertion gap, and a single mismatch', () => {
      // gap in the query (deletion), gap in the target (insertion), 100%-ish identity
      expect(result.queryAligned).toContain('-')
      expect(result.targetAligned).toContain('-')
      expect(result.identity).toBeGreaterThan(95)
      expect(result.identity).toBeLessThan(100)
    })

    it('projects a query annotation before the deletion at identity coordinates', () => {
      // Query positions 5..15 are upstream of the deletion (col 20), so no gap
      // shift applies — they map straight through.
      const ann = {
        id: 'q-upstream',
        caption: 'q-upstream',
        type: 'misc_feature',
        span: new Span([new Range(5, 15, Orientation.PLUS)])
      }
      const mapped = mapAnnotationThroughAlignment(ann, queryReverseMap, result.queryStart, result.queryEnd, {})

      expect(mapped).not.toBeNull()
      expect(mapped.span.ranges).toHaveLength(1)
      expect(mapped.span.ranges[0].start).toBe(5)
      expect(mapped.span.ranges[0].end).toBe(15)
      expect(mapped.span.ranges[0].orientation).toBe(Orientation.PLUS)
    })

    it('shifts a query annotation downstream of the deletion by the gap width', () => {
      // Query positions 28..34 sit after the deletion, so the aligned columns are
      // pushed by +1 (one deleted target base => one gap column in queryAligned).
      const ann = {
        id: 'q-downstream',
        caption: 'q-downstream',
        type: 'misc_feature',
        span: new Span([new Range(28, 34, Orientation.PLUS)])
      }
      const mapped = mapAnnotationThroughAlignment(ann, queryReverseMap, result.queryStart, result.queryEnd, {})

      expect(mapped).not.toBeNull()
      expect(mapped.span.ranges).toHaveLength(1)
      expect(mapped.span.ranges[0].start).toBe(29)
      expect(mapped.span.ranges[0].end).toBe(35)
    })
  })
})

describe('reverseComplementAnnotation', () => {
  // When the query aligned on the antisense strand, the aligned query row shows
  // reverseComplement(query). A query annotation in forward query coordinates
  // must be flipped into that RC frame BEFORE it is projected through the
  // alignment: each range [s, e) over a length-L query becomes [L - e, L - s),
  // and its strand orientation inverts (the displayed bases are the other
  // strand). This is a pure transform; gap-projection happens afterward.
  it('flips a plus-strand range into reverse-complement coordinates and inverts orientation', () => {
    const ann = {
      id: 'f',
      caption: 'f',
      type: 'misc_feature',
      span: new Span([new Range(5, 15, Orientation.PLUS)])
    }

    const flipped = reverseComplementAnnotation(ann, 44)

    expect(flipped.span.ranges).toHaveLength(1)
    expect(flipped.span.ranges[0].start).toBe(29) // 44 - 15
    expect(flipped.span.ranges[0].end).toBe(39) // 44 - 5
    expect(flipped.span.ranges[0].orientation).toBe(Orientation.MINUS)
  })

  it('inverts a minus-strand range back to plus', () => {
    const ann = {
      id: 'r',
      caption: 'r',
      type: 'CDS',
      span: new Span([new Range(0, 4, Orientation.MINUS)])
    }

    const flipped = reverseComplementAnnotation(ann, 10)

    expect(flipped.span.ranges[0].start).toBe(6) // 10 - 4
    expect(flipped.span.ranges[0].end).toBe(10) // 10 - 0
    expect(flipped.span.ranges[0].orientation).toBe(Orientation.PLUS)
  })

  it('leaves NONE orientation unchanged and preserves identity metadata', () => {
    const ann = {
      id: 'keep-me',
      caption: 'keep-me',
      type: 'misc_feature',
      span: new Span([new Range(2, 6, Orientation.NONE)])
    }

    const flipped = reverseComplementAnnotation(ann, 20)

    expect(flipped.id).toBe('keep-me')
    expect(flipped.span.ranges[0].start).toBe(14) // 20 - 6
    expect(flipped.span.ranges[0].end).toBe(18) // 20 - 2
    expect(flipped.span.ranges[0].orientation).toBe(Orientation.NONE)
  })

  it('flips a multi-range span and reverses range order', () => {
    const ann = {
      id: 'joined',
      caption: 'joined',
      type: 'misc_feature',
      span: new Span([
        new Range(0, 3, Orientation.PLUS),
        new Range(10, 14, Orientation.PLUS)
      ])
    }

    const flipped = reverseComplementAnnotation(ann, 20)

    // After flipping, the originally-later range becomes the earlier one.
    const sorted = [...flipped.span.ranges].sort((a, b) => a.start - b.start)
    expect(sorted[0].start).toBe(6) // 20 - 14
    expect(sorted[0].end).toBe(10) // 20 - 10
    expect(sorted[1].start).toBe(17) // 20 - 3
    expect(sorted[1].end).toBe(20) // 20 - 0
  })
})

describe('large sequence handling', () => {
  it('handles large sequences without excessive memory (linear-space algorithm)', () => {
    // 5000 bp sequences - would require 25M cells with O(mn) algorithm
    // Linear-space algorithm should handle this efficiently
    const query = 'ATCG'.repeat(1250)  // 5000 bp
    const target = 'ATCG'.repeat(1250) // 5000 bp

    const result = align(query, target)

    expect(result.identity).toBe(100)
    expect(result.queryAligned.length).toBe(5000)
    expect(result.targetAligned.length).toBe(5000)
    expect(result.score).toBe(10000) // 5000 bases * 2 match score
  }, 30000)

  it('correctly aligns large sequences with mismatches', () => {
    // Create sequences with some mismatches
    const base = 'ATCG'.repeat(500) // 2000 bp
    const query = base
    // Introduce 10 mismatches by changing some bases
    let target = base.split('')
    for (let i = 0; i < 10; i++) {
      const pos = 100 + i * 180
      target[pos] = target[pos] === 'A' ? 'T' : 'A'
    }
    target = target.join('')

    const result = align(query, target)

    // Should find a high-identity alignment
    expect(result.identity).toBeGreaterThan(99) // 1990/2000 = 99.5%
    expect(result.queryAligned.length).toBe(2000)
  })

  it('handles sequences just above the threshold', () => {
    // Create sequences that are just above the 1M cell threshold (1000x1001)
    const query = 'ATCGATCGATCG'.repeat(84)  // 1008 bp
    const target = 'ATCGATCGATCG'.repeat(84) // 1008 bp (1008*1008 > 1M)

    const result = align(query, target)

    expect(result.identity).toBe(100)
    expect(result.queryEnd - result.queryStart).toBe(1008)
  })
})

describe('banded alignment fast path', () => {
  it('uses the default banded path for near-identical sequences while preserving score and coordinates', () => {
    const query = 'ATCG'.repeat(300)
    const target = `${'ATCG'.repeat(150)}AA${'ATCG'.repeat(150)}`

    const banded = align(query, target)
    const linear = align(query, target, { mode: 'linear' })

    expect(banded.score).toBe(linear.score)
    expect(banded.queryStart).toBe(linear.queryStart)
    expect(banded.queryEnd).toBe(linear.queryEnd)
    expect(banded.targetStart).toBe(linear.targetStart)
    expect(banded.targetEnd).toBe(linear.targetEnd)
    expect(banded.queryAligned.length).toBe(banded.targetAligned.length)
  })

  it('keeps explicit linear mode available as the canonical fallback', () => {
    const result = align('ATCGATCG', 'ATCGAAATCG', { mode: 'linear' })

    expect(result.queryAligned).toBe('ATCG--ATCG')
    expect(result.targetAligned).toBe('ATCGAAATCG')
  })

  it('falls back to linear when the length difference cannot fit in the band', () => {
    const query = 'ATCGATCG'
    const target = `ATCG${'A'.repeat(10)}ATCG`

    expect(align(query, target, { bandWidth: 4 })).toEqual(align(query, target, { mode: 'linear' }))
  })

  it('estimates circular target origin offset before banded alignment', () => {
    const target = 'AAAACCCCGGGGTTTT'
    const query = 'GGGGTTTTAAAACCCC'

    const result = align(query, target, { circular: true, originKmerSize: 4 })

    expect(result.score).toBe(query.length * 2)
    expect(result.identity).toBe(100)
    expect(result.queryAligned).toBe(query)
    expect(result.targetAligned).toBe(query)
    expect(result.targetOriginOffset).toBe(8)
    expect(result.targetStart).toBe(8)
    expect(result.targetEnd).toBe(24)
  })

  it('aligns a rotated query sequence against a circular target', () => {
    const target = 'ATGCGTACGTTAGCCTAGGCTAATCGGATCCGGAATTCCTGCAG'
    const originOffset = 19
    const query = target.slice(originOffset) + target.slice(0, originOffset)

    const result = align(query, target, { circular: true, originKmerSize: 8 })

    expect(result.score).toBe(query.length * 2)
    expect(result.identity).toBe(100)
    expect(result.queryAligned).toBe(query)
    expect(result.targetAligned).toBe(query)
    expect(result.targetOriginOffset).toBe(originOffset)
    expect(result.targetStart).toBe(originOffset)
    expect(result.targetEnd).toBe(originOffset + target.length)
  })

  it('recovers a rotation larger than the band width', () => {
    // Rotation magnitude never bounds what circular alignment can recover: the
    // detected offset is removed by rotating the target *before* banded
    // alignment, so the band only absorbs indel drift, not the rotation. Use a
    // non-degenerate (unique-k-mer) sequence with a rotation well past the
    // 128-base default band to confirm a clean, exact recovery. Deterministic
    // xorshift, no Math.random.
    const BASES = 'ACGT'
    const LEN = 600
    const OFFSET = 320 // > DEFAULT_BAND_WIDTH (128)
    let x = 0x12345678 >>> 0
    let target = ''
    for (let i = 0; i < LEN; i++) {
      x ^= x << 13; x >>>= 0
      x ^= x >> 17
      x ^= x << 5; x >>>= 0
      target += BASES[x & 3]
    }
    const query = target.slice(OFFSET) + target.slice(0, OFFSET)

    const result = align(query, target, { circular: true })

    expect(result.score).toBe(query.length * 2)
    expect(result.identity).toBe(100)
    expect(result.queryStart).toBe(0)
    expect(result.queryEnd).toBe(LEN)
    expect(result.targetOriginOffset).toBe(OFFSET)
    expect(result.targetStart).toBe(OFFSET)
    expect(result.targetEnd).toBe(OFFSET + LEN)
    expect(result.queryAligned).toBe(query)
    expect(result.targetAligned).toBe(query)
  })

  it('aligns pUC19 file rotations as 100% circular sequence matches', () => {
    const offsets = [0, 100, 200, 500, 1000, 1500]
    const target = readFileSync(join(process.cwd(), 'testfile/pUC19_rot0.txt'), 'utf8').trim()

    for (const offset of offsets) {
      const query = readFileSync(join(process.cwd(), `testfile/pUC19_rot${offset}.txt`), 'utf8').trim()
      const result = align(query, target, { circular: true })

      expect(query.length).toBe(target.length)
      expect(result.score).toBe(query.length * 2)
      expect(result.identity).toBe(100)
      expect(result.queryStart).toBe(0)
      expect(result.queryEnd).toBe(query.length)
      expect(result.targetOriginOffset ?? 0).toBe(offset)
      expect(result.targetStart).toBe(offset)
      expect(result.targetEnd).toBe(offset + target.length)
      expect(result.queryAligned).toBe(query)
      expect(result.targetAligned).toBe(query)
    }
  })

  it('recovers a large rotation when small indels smear the diagonal', () => {
    // Two circular sequences that are the same plasmid linearized at different
    // origins, related by a large rotation AND a few small indels. The indels
    // make each downstream matching k-mer vote for a slightly different offset,
    // smearing one true rotation's votes across adjacent buckets. The old
    // exact-bucket vote + "1.5x runner-up" gate mistook that smear for competing
    // origins and gave up (offset 0), so only the non-wrapping fragment aligned.
    // Seed-and-chain diagonal clustering recovers it. Sequence is synthetic and
    // deterministic (xorshift), no Math.random.
    const BASES = 'ACGT'
    const SEQ_LEN = 4000
    const ROTATION = 1500
    let x = 0x9e3779b9 >>> 0
    let base = ''
    for (let i = 0; i < SEQ_LEN; i++) {
      x ^= x << 13; x >>>= 0
      x ^= x >> 17
      x ^= x << 5; x >>>= 0
      base += BASES[x & 3]
    }
    const target = base
    const rotated = base.slice(ROTATION) + base.slice(0, ROTATION)
    // Two single-base deletions => two diagonal steps.
    const del1 = Math.floor(SEQ_LEN / 3)
    const del2 = Math.floor((SEQ_LEN * 2) / 3)
    const query = rotated.slice(0, del1) + rotated.slice(del1 + 1, del2) + rotated.slice(del2 + 1)

    const result = align(query, target, { circular: true })

    // Essentially the whole query is present in the target (minus 2 deleted
    // bases): correct circular alignment should cover nearly all of it.
    expect(result.identity).toBeGreaterThanOrEqual(99)
    expect(result.queryEnd - result.queryStart).toBeGreaterThanOrEqual(query.length - 10)
  })

  it('does not rotate target origin unless circular alignment is requested', () => {
    const target = 'AAAACCCCGGGGTTTT'
    const query = 'GGGGTTTTAAAACCCC'

    const result = align(query, target, { originKmerSize: 4 })

    expect(result.score).toBeLessThan(query.length * 2)
    expect(result.targetOriginOffset).toBeUndefined()
  })
})

describe('WASM implementation', () => {
  let wasmModule = null
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  const WASM_RESULT_HEADER_SIZE = 40
  const WASM_STATUS_OK = 0

  function readWasmResult(resultPtr, queryOutPtr, targetOutPtr) {
    const view = new DataView(wasmModule.memory.buffer)
    let offset = resultPtr
    const score = view.getInt32(offset, true); offset += 4
    const queryStart = view.getInt32(offset, true); offset += 4
    const queryEnd = view.getInt32(offset, true); offset += 4
    const targetStart = view.getInt32(offset, true); offset += 4
    const targetEnd = view.getInt32(offset, true); offset += 4
    const queryAlignedLen = view.getInt32(offset, true); offset += 4
    const targetAlignedLen = view.getInt32(offset, true); offset += 4
    const targetOriginOffset = view.getInt32(offset, true)
    offset += 4
    const identity = view.getFloat64(offset, true)

    const memoryBytes = new Uint8Array(wasmModule.memory.buffer)
    const queryAligned = decoder.decode(memoryBytes.slice(queryOutPtr, queryOutPtr + queryAlignedLen))
    const targetAligned = decoder.decode(memoryBytes.slice(targetOutPtr, targetOutPtr + targetAlignedLen))

    const result = {
      score,
      queryStart,
      queryEnd,
      targetStart,
      targetEnd,
      queryAligned,
      targetAligned,
      identity
    }
    if (targetOriginOffset !== 0) {
      result.targetOriginOffset = targetOriginOffset
    }
    return result
  }

  function withWasmInputs(query, target, callback) {
    wasmModule.reset()

    const queryBytes = encoder.encode(query)
    const targetBytes = encoder.encode(target)
    const outCapacity = queryBytes.length + targetBytes.length

    const queryPtr = wasmModule.alloc(queryBytes.length)
    const targetPtr = wasmModule.alloc(targetBytes.length)
    const queryOutPtr = wasmModule.alloc(outCapacity)
    const targetOutPtr = wasmModule.alloc(outCapacity)
    const resultPtr = wasmModule.alloc(WASM_RESULT_HEADER_SIZE)

    const memory = new Uint8Array(wasmModule.memory.buffer)
    memory.set(queryBytes, queryPtr)
    memory.set(targetBytes, targetPtr)

    const status = callback(
      queryPtr, queryBytes.length,
      targetPtr, targetBytes.length,
      queryOutPtr, targetOutPtr,
      outCapacity,
      resultPtr
    )

    wasmModule.free(queryPtr)
    wasmModule.free(targetPtr)
    wasmModule.free(queryOutPtr)
    wasmModule.free(targetOutPtr)
    wasmModule.free(resultPtr)

    if (status !== WASM_STATUS_OK) return null

    return readWasmResult(resultPtr, queryOutPtr, targetOutPtr)
  }

  // Helper to call WASM linear alignment
  function alignWasm(query, target, options = {}) {
    const {
      match = 2,
      mismatch = -1,
      gapOpen = -3,
      gapExtend = -1
    } = options

    return withWasmInputs(query, target, (queryPtr, queryLen, targetPtr, targetLen, queryOutPtr, targetOutPtr, outCapacity, resultPtr) =>
      wasmModule.alignSequencesInto(
        queryPtr, queryLen,
        targetPtr, targetLen,
        queryOutPtr, targetOutPtr,
        outCapacity,
        resultPtr,
        match, mismatch, gapOpen, gapExtend
      )
    )
  }

  function alignWasmBanded(query, target, options = {}) {
    const {
      match = 2,
      mismatch = -1,
      gapOpen = -3,
      gapExtend = -1,
      bandWidth = 128
    } = options

    return withWasmInputs(query, target, (queryPtr, queryLen, targetPtr, targetLen, queryOutPtr, targetOutPtr, outCapacity, resultPtr) =>
      wasmModule.alignSequencesBandedInto(
        queryPtr, queryLen,
        targetPtr, targetLen,
        queryOutPtr, targetOutPtr,
        outCapacity,
        resultPtr,
        match, mismatch, gapOpen, gapExtend,
        bandWidth
      )
    )
  }

  function alignWasmCircular(query, target, options = {}) {
    const {
      match = 2,
      mismatch = -1,
      gapOpen = -3,
      gapExtend = -1,
      bandWidth = 128,
      originKmerSize = 15,
      originMinVotes = 3
    } = options

    return withWasmInputs(query, target, (queryPtr, queryLen, targetPtr, targetLen, queryOutPtr, targetOutPtr, outCapacity, resultPtr) =>
      wasmModule.alignSequencesBandedCircularInto(
        queryPtr, queryLen,
        targetPtr, targetLen,
        queryOutPtr, targetOutPtr,
        outCapacity,
        resultPtr,
        match, mismatch, gapOpen, gapExtend,
        bandWidth,
        originKmerSize,
        originMinVotes
      )
    )
  }

  // Load WASM before tests
  beforeAll(async () => {
    const wasmPath = new URL('./alignment.wasm', import.meta.url)
    const wasmBytes = await Bun.file(wasmPath).arrayBuffer()
    const { instance } = await WebAssembly.instantiate(wasmBytes, {})
    wasmModule = instance.exports
  })

  it('loads WASM module successfully', () => {
    expect(wasmModule).not.toBeNull()
    expect(typeof wasmModule.alignSequencesInto).toBe('function')
    expect(typeof wasmModule.alignSequencesBandedInto).toBe('function')
    expect(typeof wasmModule.alignSequencesBandedCircularInto).toBe('function')
    expect(typeof wasmModule.alloc).toBe('function')
    expect(typeof wasmModule.free).toBe('function')
    expect(typeof wasmModule.memory).toBe('object')
  })

  it('aligns identical sequences same as JS', () => {
    const query = 'ATCGATCG'
    const target = 'ATCGATCG'

    const jsResult = align(query, target, { mode: 'linear' })
    const wasmResult = alignWasm(query, target)

    expect(wasmResult.score).toBe(jsResult.score)
    expect(wasmResult.queryStart).toBe(jsResult.queryStart)
    expect(wasmResult.queryEnd).toBe(jsResult.queryEnd)
    expect(wasmResult.targetStart).toBe(jsResult.targetStart)
    expect(wasmResult.targetEnd).toBe(jsResult.targetEnd)
    expect(wasmResult.identity).toBe(jsResult.identity)
  })

  it('aligns sequences with mismatches same as JS', () => {
    const query = 'ATCGATCG'
    const target = 'ATCGTTCG'

    const jsResult = align(query, target)
    const wasmResult = alignWasm(query, target)

    expect(wasmResult.score).toBe(jsResult.score)
    expect(wasmResult.identity).toBe(jsResult.identity)
    expect(wasmResult.queryAligned.length).toBe(jsResult.queryAligned.length)
  })

  it('handles gaps same as JS', () => {
    const query = 'ATCGATCG'
    const target = 'ATCGAAATCG'

    const jsResult = align(query, target)
    const wasmResult = alignWasm(query, target)

    expect(wasmResult.score).toBe(jsResult.score)
    // Both should have gaps
    expect(wasmResult.queryAligned).toContain('-')
    expect(jsResult.queryAligned).toContain('-')
  })

  it('matches JS full result for query insertion against target', () => {
    const query = 'ATCGAAATCG'
    const target = 'ATCGATCG'

    const jsResult = align(query, target)
    const wasmResult = alignWasm(query, target)

    expect(wasmResult).toEqual(jsResult)
  })

  it('matches JS full results for deterministic alignment cases', () => {
    const cases = [
      ['ATCGATCG', 'ATCGATCG'],
      ['ATCG', 'NNNATCGNNN'],
      ['NNNATCGNNN', 'ATCG'],
      ['ATCGATCG', 'ATCGTTCG'],
      ['ATCGATCG', 'ATGGATGG'],
      ['ATCGATCG', 'ATCGAAATCG'],
      ['ATCGAAATCG', 'ATCGATCG'],
      ['ATGCTAG', 'ATGCCCTAG'],
      ['XXXATCGATCGXXX', 'YYYATCGATCGYYY'],
      ['AAAAAAA', 'TTTTTTT'],
      ['ATCGATCG', 'ATNGANCG'],
      ['ATCGATCG', 'RYCGRYCY'],
      ['', 'ATCG'],
      ['ATCG', ''],
      ['A', 'A'],
      ['A', 'T'],
      ['atCg', 'aTcG'],
      ['ATCG', 'ATCG', { match: 5 }],
      ['ATCG', 'ATGG', { mismatch: -3 }],
      ['ATCGATCG', 'ATCGAATCG', { gapOpen: -10, gapExtend: -5 }]
    ]

    for (const [query, target, options] of cases) {
      expect(alignWasm(query, target, options)).toEqual(align(query, target, { ...options, mode: 'linear' }))
    }
  })

  it('finds local alignment same as JS', () => {
    const query = 'XXXATCGATCGXXX'
    const target = 'YYYATCGATCGYYY'

    const jsResult = align(query, target)
    const wasmResult = alignWasm(query, target)

    expect(wasmResult.score).toBe(jsResult.score)
    expect(wasmResult.queryStart).toBe(jsResult.queryStart)
    expect(wasmResult.queryEnd).toBe(jsResult.queryEnd)
    expect(wasmResult.targetStart).toBe(jsResult.targetStart)
    expect(wasmResult.targetEnd).toBe(jsResult.targetEnd)
  })

  it('handles empty sequences', () => {
    const wasmResult = alignWasm('', 'ATCG')

    expect(wasmResult.score).toBe(0)
    expect(wasmResult.queryAligned).toBe('')
    expect(wasmResult.targetAligned).toBe('')
  })

  it('handles no match sequences', () => {
    const query = 'AAAAAAA'
    const target = 'TTTTTTT'

    const jsResult = align(query, target)
    const wasmResult = alignWasm(query, target)

    expect(wasmResult.score).toBe(jsResult.score)
    expect(wasmResult.score).toBe(0)
  })

  it('respects custom scoring parameters', () => {
    const query = 'ATCG'
    const target = 'ATCG'
    const options = { match: 5 }

    const jsResult = align(query, target, options)
    const wasmResult = alignWasm(query, target, options)

    expect(wasmResult.score).toBe(jsResult.score)
    expect(wasmResult.score).toBe(20) // 4 bases * 5 match score
  })

  it('handles IUPAC ambiguity codes', () => {
    const query = 'ATCGATCG'
    const target = 'ATNGANCG' // N matches any base

    const jsResult = align(query, target)
    const wasmResult = alignWasm(query, target)

    expect(wasmResult.score).toBe(jsResult.score)
    expect(wasmResult.identity).toBe(jsResult.identity)
  })

  it('handles larger sequences efficiently', () => {
    const query = 'ATCG'.repeat(250)  // 1000 bp
    const target = 'ATCG'.repeat(250) // 1000 bp

    const wasmResult = alignWasm(query, target)

    expect(wasmResult.identity).toBe(100)
    expect(wasmResult.score).toBe(2000) // 1000 bases * 2 match score
  })

  it('banded WASM matches JS banded for near-identical sequences', () => {
    const query = 'ATCG'.repeat(80)
    const target = `${'ATCG'.repeat(40)}AA${'ATCG'.repeat(40)}`

    expect(alignWasmBanded(query, target)).toEqual(align(query, target))
  })

  it('banded WASM returns null when the band cannot contain the length delta', () => {
    const query = 'ATCGATCG'
    const target = `ATCG${'A'.repeat(10)}ATCG`

    expect(alignWasmBanded(query, target, { bandWidth: 4 })).toBeNull()
  })

  it('circular WASM aligns pUC19 file rotations as 100% sequence matches', () => {
    const offsets = [0, 100, 200, 500, 1000, 1500]
    const target = readFileSync(join(process.cwd(), 'testfile/pUC19_rot0.txt'), 'utf8').trim()

    for (const offset of offsets) {
      const query = readFileSync(join(process.cwd(), `testfile/pUC19_rot${offset}.txt`), 'utf8').trim()
      const result = alignWasmCircular(query, target)

      expect(result.score).toBe(query.length * 2)
      expect(result.identity).toBe(100)
      expect(result.queryStart).toBe(0)
      expect(result.queryEnd).toBe(query.length)
      expect(result.targetOriginOffset ?? 0).toBe(offset)
      expect(result.targetStart).toBe(offset)
      expect(result.targetEnd).toBe(offset + target.length)
      expect(result.queryAligned).toBe(query)
      expect(result.targetAligned).toBe(query)
    }
  })
})
