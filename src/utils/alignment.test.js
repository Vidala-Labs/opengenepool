import { describe, it, expect } from 'bun:test'
import {
  align,
  scoreMatch,
  buildCoordinateMap,
  mapCoordinate,
  extractGaps
} from './alignment.js'

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
