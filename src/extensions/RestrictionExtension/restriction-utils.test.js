import { describe, it, expect } from 'bun:test'
import {
  findCutSites,
  findAllCutSites,
  countCutSites,
  getOverhangType,
  getOverhangLength
} from './restriction-utils.js'
import { ENZYMES } from './enzymes.js'

// Get enzyme by name
function getEnzyme(name) {
  return ENZYMES.find(e => e.name === name)
}

describe('findCutSites', () => {
  describe('EcoRI (GAATTC, 5\' overhang)', () => {
    const enzyme = getEnzyme('EcoRI')

    it('finds a single EcoRI site', () => {
      const sequence = 'ATGCGAATTCATGC'
      const sites = findCutSites(sequence, enzyme)

      expect(sites).toHaveLength(1)
      expect(sites[0]).toMatchObject({
        position: 5,  // After G in GAATTC
        strand: '+',
        enzyme: 'EcoRI',
        matchStart: 4,
        matchEnd: 10
      })
    })

    it('finds multiple EcoRI sites', () => {
      const sequence = 'GAATTCAAAAGAATTC'
      const sites = findCutSites(sequence, enzyme)

      expect(sites).toHaveLength(2)
      expect(sites[0].position).toBe(1)
      expect(sites[1].position).toBe(11)
    })

    it('returns empty array when no sites found', () => {
      const sequence = 'ATGCATGCATGC'
      const sites = findCutSites(sequence, enzyme)

      expect(sites).toHaveLength(0)
    })

    it('is case insensitive', () => {
      const sequence = 'atgcgaattcatgc'
      const sites = findCutSites(sequence, enzyme)

      expect(sites).toHaveLength(1)
    })

    it('calculates correct overhang region for 5\' overhang', () => {
      // EcoRI: cutPosition=1, cutPositionComplement=5
      // GAATTC -> G|AATTC (top) and CTTAA|G (bottom)
      // Overhang is AATT (positions 1-5 within the site)
      const sequence = 'ATGCGAATTCATGC'
      const sites = findCutSites(sequence, enzyme)

      expect(sites[0].overhangStart).toBe(5)  // pos + min(1, 5)
      expect(sites[0].overhangEnd).toBe(9)    // pos + max(1, 5)
    })
  })

  describe('PstI (CTGCAG, 3\' overhang)', () => {
    const enzyme = getEnzyme('PstI')

    it('finds PstI sites with 3\' overhang', () => {
      const sequence = 'ATGCCTGCAGATGC'
      const sites = findCutSites(sequence, enzyme)

      expect(sites).toHaveLength(1)
      // PstI: cutPosition=5, cutPositionComplement=1
      // CTGCAG -> CTGCA|G (top) and C|TGCAG (bottom)
      expect(sites[0].position).toBe(9)  // pos + 5
      expect(sites[0].overhangStart).toBe(5)  // pos + min(1, 5)
      expect(sites[0].overhangEnd).toBe(9)    // pos + max(1, 5)
    })
  })

  describe('EcoRV (GATATC, blunt)', () => {
    const enzyme = getEnzyme('EcoRV')

    it('finds EcoRV sites with blunt ends', () => {
      const sequence = 'ATGCGATATCATGC'
      const sites = findCutSites(sequence, enzyme)

      expect(sites).toHaveLength(1)
      // EcoRV: cutPosition=3, cutPositionComplement=3
      // GATATC -> GAT|ATC (both strands)
      expect(sites[0].position).toBe(7)  // pos + 3
      expect(sites[0].overhangStart).toBe(7)
      expect(sites[0].overhangEnd).toBe(7)
    })
  })

  describe('palindromic vs non-palindromic sites', () => {
    it('EcoRI is palindromic - only finds forward matches', () => {
      // GAATTC is palindromic (reverse complement = GAATTC)
      // So we should NOT find duplicate sites
      const sequence = 'ATGCGAATTCATGC'
      const sites = findCutSites(sequence, getEnzyme('EcoRI'))

      expect(sites).toHaveLength(1)
      expect(sites[0].strand).toBe('+')
    })

    it('handles non-palindromic enzymes on both strands', () => {
      // BglII: AGATCT is not palindromic
      // Reverse complement of AGATCT is AGATCT... wait, that's the same!
      // Let's use a different sequence for testing
      // Actually BglII is palindromic too. Let's check a truly non-palindromic one.
      // Most restriction enzymes recognize palindromic sequences.
      // For testing, we can create a mock enzyme
      const mockEnzyme = {
        name: 'MockI',
        recognitionSequence: 'AAAACC',  // Not palindromic
        cutPosition: 2,
        cutPositionComplement: 4
      }

      // Forward: AAAACC
      // Reverse complement: GGTTTT
      const sequence = 'AAAACCATGGTTTT'
      const sites = findCutSites(sequence, mockEnzyme)

      expect(sites).toHaveLength(2)
      expect(sites.some(s => s.strand === '+')).toBe(true)
      expect(sites.some(s => s.strand === '-')).toBe(true)
    })
  })

  describe('degenerate sequences (IUPAC codes)', () => {
    it('BglI matches degenerate sequence GCCNNNNNGGC', () => {
      // BglI: GCCNNNNNGGC where N = any base (5 N's between GCC and GGC)
      const enzyme = getEnzyme('BglI')

      // GCCAAAAAGGC matches (5 A's)
      const sequence1 = 'ATGCGCCAAAAAGGCATGC'
      expect(findCutSites(sequence1, enzyme)).toHaveLength(1)

      // GCCTTTTTGGC matches (5 T's)
      const sequence2 = 'ATGCGCCTTTTTGGCATGC'
      expect(findCutSites(sequence2, enzyme)).toHaveLength(1)

      // GCCAAAAGGC does not match (only 4 Ns, need 5)
      const sequence3 = 'ATGCGCCAAAAGGCATGC'
      expect(findCutSites(sequence3, enzyme)).toHaveLength(0)
    })
  })
})

describe('findAllCutSites', () => {
  it('finds sites for multiple enzymes', () => {
    const sequence = 'GAATTCAAAGGATCC'
    const enzymes = [getEnzyme('EcoRI'), getEnzyme('BamHI')]
    const sites = findAllCutSites(sequence, enzymes)

    expect(sites).toHaveLength(2)
    expect(sites[0].enzyme).toBe('EcoRI')
    expect(sites[1].enzyme).toBe('BamHI')
  })

  it('returns sites sorted by position', () => {
    const sequence = 'GGATCCAAAGAATTC'  // BamHI first, then EcoRI
    const enzymes = [getEnzyme('EcoRI'), getEnzyme('BamHI')]
    const sites = findAllCutSites(sequence, enzymes)

    expect(sites[0].enzyme).toBe('BamHI')  // Position 1
    expect(sites[1].enzyme).toBe('EcoRI')  // Position 10
  })
})

describe('countCutSites', () => {
  it('counts sites for each enzyme', () => {
    const sequence = 'GAATTCAAAGAATTCAAAGGATCC'
    const enzymes = [getEnzyme('EcoRI'), getEnzyme('BamHI')]
    const counts = countCutSites(sequence, enzymes)

    expect(counts.get('EcoRI')).toBe(2)
    expect(counts.get('BamHI')).toBe(1)
  })

  it('returns 0 for enzymes with no sites', () => {
    const sequence = 'ATGCATGCATGC'
    const enzymes = [getEnzyme('EcoRI')]
    const counts = countCutSites(sequence, enzymes)

    expect(counts.get('EcoRI')).toBe(0)
  })
})

describe('getOverhangType', () => {
  it('identifies 5\' overhang', () => {
    expect(getOverhangType(getEnzyme('EcoRI'))).toBe('5prime')
    expect(getOverhangType(getEnzyme('BamHI'))).toBe('5prime')
  })

  it('identifies 3\' overhang', () => {
    expect(getOverhangType(getEnzyme('PstI'))).toBe('3prime')
    expect(getOverhangType(getEnzyme('KpnI'))).toBe('3prime')
  })

  it('identifies blunt end', () => {
    expect(getOverhangType(getEnzyme('EcoRV'))).toBe('blunt')
    expect(getOverhangType(getEnzyme('SmaI'))).toBe('blunt')
  })
})

describe('getOverhangLength', () => {
  it('returns correct overhang length', () => {
    expect(getOverhangLength(getEnzyme('EcoRI'))).toBe(4)   // 5-1 = 4
    expect(getOverhangLength(getEnzyme('PstI'))).toBe(4)    // |1-5| = 4
    expect(getOverhangLength(getEnzyme('EcoRV'))).toBe(0)   // 3-3 = 0
    expect(getOverhangLength(getEnzyme('NotI'))).toBe(4)    // 6-2 = 4
  })
})
