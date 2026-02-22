import { describe, it, expect } from 'bun:test'
import {
  CODON_TABLE,
  START_CODONS,
  STOP_CODONS,
  translate,
  iterateCodons,
  iterateCodonFragments
} from './translation.js'
import { Span, iterateSequence } from './dna.js'

describe('CODON_TABLE', () => {
  it('has all 64 codons', () => {
    expect(Object.keys(CODON_TABLE).length).toBe(64)
  })

  it('maps ATG to M (Methionine)', () => {
    expect(CODON_TABLE['ATG']).toBe('M')
  })

  it('maps stop codons to *', () => {
    expect(CODON_TABLE['TAA']).toBe('*')
    expect(CODON_TABLE['TAG']).toBe('*')
    expect(CODON_TABLE['TGA']).toBe('*')
  })

  it('maps some common codons correctly', () => {
    // Phenylalanine
    expect(CODON_TABLE['TTT']).toBe('F')
    expect(CODON_TABLE['TTC']).toBe('F')

    // Leucine
    expect(CODON_TABLE['TTA']).toBe('L')
    expect(CODON_TABLE['TTG']).toBe('L')
    expect(CODON_TABLE['CTT']).toBe('L')

    // Glycine
    expect(CODON_TABLE['GGT']).toBe('G')
    expect(CODON_TABLE['GGC']).toBe('G')
    expect(CODON_TABLE['GGA']).toBe('G')
    expect(CODON_TABLE['GGG']).toBe('G')
  })
})

describe('START_CODONS', () => {
  it('contains ATG', () => {
    expect(START_CODONS.has('ATG')).toBe(true)
  })

  it('has exactly 1 standard start codon', () => {
    expect(START_CODONS.size).toBe(1)
  })
})

describe('STOP_CODONS', () => {
  it('contains all three stop codons', () => {
    expect(STOP_CODONS.has('TAA')).toBe(true)
    expect(STOP_CODONS.has('TAG')).toBe(true)
    expect(STOP_CODONS.has('TGA')).toBe(true)
  })

  it('has exactly 3 stop codons', () => {
    expect(STOP_CODONS.size).toBe(3)
  })
})

describe('translate', () => {
  it('translates a simple sequence in frame 0', () => {
    // ATG = M, GGT = G, TAA = * (stop)
    const sequence = 'ATGGGTAA'
    const result = translate(sequence, 0)

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({
      codon: 'ATG',
      aminoAcid: 'M',
      position: 0,
      isStart: true,
      isStop: false
    })
    expect(result[1]).toEqual({
      codon: 'GGT',
      aminoAcid: 'G',
      position: 3,
      isStart: false,
      isStop: false
    })
  })

  it('translates with frame 1 offset', () => {
    // Skip first base: TGG = W, GTA = V, A (incomplete)
    const sequence = 'ATGGGTA'
    const result = translate(sequence, 1)

    expect(result).toHaveLength(2)
    expect(result[0].codon).toBe('TGG')
    expect(result[0].aminoAcid).toBe('W')
    expect(result[0].position).toBe(1)
    expect(result[1].codon).toBe('GTA')
    expect(result[1].aminoAcid).toBe('V')
    expect(result[1].position).toBe(4)
  })

  it('translates with frame 2 offset', () => {
    // Skip first two bases: GGG = G, TAA = * (stop)
    const sequence = 'ATGGGTAA'
    const result = translate(sequence, 2)

    expect(result).toHaveLength(2)
    expect(result[0].codon).toBe('GGG')
    expect(result[0].aminoAcid).toBe('G')
    expect(result[0].position).toBe(2)
  })

  it('marks stop codons correctly', () => {
    const sequence = 'ATGTAA'
    const result = translate(sequence, 0)

    expect(result).toHaveLength(2)
    expect(result[1]).toEqual({
      codon: 'TAA',
      aminoAcid: '*',
      position: 3,
      isStart: false,
      isStop: true
    })
  })

  it('handles incomplete codons at end', () => {
    const sequence = 'ATGGG' // Only 1.66 codons
    const result = translate(sequence, 0)

    expect(result).toHaveLength(1)
    expect(result[0].codon).toBe('ATG')
  })

  it('handles empty sequence', () => {
    const result = translate('', 0)
    expect(result).toHaveLength(0)
  })

  it('handles sequence shorter than frame offset', () => {
    const result = translate('AT', 2)
    expect(result).toHaveLength(0)
  })

  it('handles lowercase input', () => {
    const sequence = 'atgggtaa'
    const result = translate(sequence, 0)

    expect(result).toHaveLength(2)
    expect(result[0].aminoAcid).toBe('M')
  })

  it('defaults to frame 0', () => {
    const sequence = 'ATGGGT'
    const result = translate(sequence)

    expect(result).toHaveLength(2)
    expect(result[0].position).toBe(0)
  })
})

describe('iterateCodons', () => {
  describe('plus strand', () => {
    it('groups bases into codons and translates', () => {
      const span = Span.parse('0..6')
      const sequence = 'ATGAAA'

      const bases = iterateSequence(span, sequence)
      const codons = [...iterateCodons(bases)]

      expect(codons).toHaveLength(2)
      expect(codons[0].aminoAcid).toBe('M')  // ATG = Methionine
      expect(codons[1].aminoAcid).toBe('K')  // AAA = Lysine
      expect(codons[0].bases.map(b => b.position)).toEqual([0, 1, 2])
      expect(codons[1].bases.map(b => b.position)).toEqual([3, 4, 5])
      expect(codons.map(c => c.codon)).toEqual(['ATG', 'AAA'])
    })

    it('handles incomplete final codon', () => {
      const span = Span.parse('0..5')  // Only 5 bases = 1 full codon + 2 leftover
      const sequence = 'ATGAA'

      const bases = iterateSequence(span, sequence)
      const codons = [...iterateCodons(bases)]

      expect(codons).toHaveLength(1)  // Only complete codons
      expect(codons[0].aminoAcid).toBe('M')
    })
  })

  describe('minus strand', () => {
    it('uses complemented bases from sequence iterator', () => {
      const span = Span.parse('(0..6)')
      const sequence = 'ATGAAA'

      // Walking high to low: positions [5,4,3,2,1,0]
      // Plus strand letters: A,A,A,G,T,A → complemented: T,T,T,C,A,T
      // Codon 1: TTT → F (Phenylalanine)
      // Codon 2: CAT → H (Histidine)

      const bases = iterateSequence(span, sequence)
      const codons = [...iterateCodons(bases)]

      expect(codons).toHaveLength(2)
      expect(codons[0].aminoAcid).toBe('F')  // TTT = Phenylalanine
      expect(codons[1].aminoAcid).toBe('H')  // CAT = Histidine
      expect(codons.map(c => c.codon)).toEqual(['TTT', 'CAT'])
    })

    it('preserves base positions through translation', () => {
      const span = Span.parse('(0..6)')
      const sequence = 'ATGAAA'

      const bases = iterateSequence(span, sequence)
      const codons = [...iterateCodons(bases)]

      // First codon should have bases at high positions (5,4,3)
      expect(codons[0].bases.map(b => b.position)).toEqual([5, 4, 3])
      // Second codon at low positions (2,1,0)
      expect(codons[1].bases.map(b => b.position)).toEqual([2, 1, 0])
    })
  })

  describe('translation cache', () => {
    it('accumulates amino acids in order', () => {
      const span = Span.parse('0..9')
      const sequence = 'ATGAAATTT'

      const bases = iterateSequence(span, sequence)
      const result = { aminoAcids: '' }
      // Consume the iterator to trigger accumulation
      ;[...iterateCodons(bases, result)]

      expect(result.aminoAcids).toBe('MKF')
    })

    it('accumulates in coding order for minus strand', () => {
      const span = Span.parse('(0..6)')
      const sequence = 'ATGAAA'

      const bases = iterateSequence(span, sequence)
      const result = { aminoAcids: '' }
      // Consume the iterator to trigger accumulation
      ;[...iterateCodons(bases, result)]

      // Coding order: TTT (F) then CAT (H)
      expect(result.aminoAcids).toBe('FH')
    })
  })
})

describe('iterateCodonFragments', () => {
  // Helper to create a mock codon
  function mockCodon(positions, aminoAcid, direction = true) {
    return {
      bases: positions.map(p => ({ letter: 'A', direction, position: p })),
      aminoAcid,
      codon: 'AAA'
    }
  }

  describe('no boundaries', () => {
    it('yields one fragment per codon with width 3', () => {
      const codons = [mockCodon([0, 1, 2], 'M')]

      const fragments = [...iterateCodonFragments(codons, 100)]

      expect(fragments).toHaveLength(1)
      expect(fragments[0].width).toBe(3)
      expect(fragments[0].start).toBe(0)
      expect(fragments[0].startEdge).toBe('flat')    // First codon has flat first
      expect(fragments[0].endEdge).toBe('flat')   // Last codon has flat last
      expect(fragments[0].letter).toBe(1)  // Middle base
    })

    it('yields multiple fragments for multiple codons', () => {
      const codons = [
        mockCodon([0, 1, 2], 'M'),
        mockCodon([3, 4, 5], 'K')
      ]

      const fragments = [...iterateCodonFragments(codons, 100)]

      expect(fragments).toHaveLength(2)
      expect(fragments[0].aminoAcid).toBe('M')
      expect(fragments[1].aminoAcid).toBe('K')
    })
  })

  describe('segment boundaries', () => {
    it('splits codon at segment boundary', () => {
      // Codon with position discontinuity [0,1,5] - gap between 1 and 5 indicates segment boundary
      const codons = [mockCodon([0, 1, 5], 'M')]

      const fragments = [...iterateCodonFragments(codons, 100)]

      expect(fragments).toHaveLength(2)
      expect(fragments[0].width).toBe(2)
      expect(fragments[1].width).toBe(1)
    })

    it('uses flat edges at segment boundaries', () => {
      // Position discontinuity triggers flat edges at the boundary
      const codons = [mockCodon([0, 1, 5], 'M')]

      const fragments = [...iterateCodonFragments(codons, 100)]

      expect(fragments[0].endEdge).toBe('flat')
      expect(fragments[1].startEdge).toBe('flat')
    })
  })

  describe('line boundaries', () => {
    it('splits codon at line boundary', () => {
      // zoom=100, codon at positions [98,99,100]
      // Line 0: 0-99, Line 1: 100-199
      const codons = [mockCodon([98, 99, 100], 'M')]

      const fragments = [...iterateCodonFragments(codons, 100)]

      expect(fragments).toHaveLength(2)
      expect(fragments[0].width).toBe(2)  // positions 98, 99
      expect(fragments[1].width).toBe(1)  // position 100
      expect(fragments[0].lineIndex).toBe(0)
      expect(fragments[1].lineIndex).toBe(1)
    })

    it('uses flat edges at line boundaries', () => {
      const codons = [mockCodon([98, 99, 100], 'M')]

      const fragments = [...iterateCodonFragments(codons, 100)]

      expect(fragments[0].endEdge).toBe('flat')
      expect(fragments[1].startEdge).toBe('flat')
    })

    it('detects line boundary using fenced indexes (left edge)', () => {
      // Fragment starting at position 100 has left fence at 100
      // 100 % 100 === 0, so left edge should be flat
      const codons = [mockCodon([100, 101, 102], 'M')]

      const fragments = [...iterateCodonFragments(codons, 100)]

      expect(fragments[0].startEdge).toBe('flat')  // At line start (fence 100)
    })

    it('detects line boundary using fenced indexes (right edge)', () => {
      // Fragment ending at position 99 has right fence at 100
      // (99 + 1) % 100 === 0, so right edge should be flat
      const codons = [mockCodon([97, 98, 99], 'M')]

      const fragments = [...iterateCodonFragments(codons, 100)]

      expect(fragments[0].endEdge).toBe('flat')  // At line end (fence 100)
    })

    it('non-boundary positions have chevron edges', () => {
      // Fragment at positions 50,51,52 is mid-line and mid-sequence
      // Left fence 50 % 100 !== 0, right fence 53 % 100 !== 0
      const codons = [
        mockCodon([47, 48, 49], 'M'),  // First codon
        mockCodon([50, 51, 52], 'K'),  // Middle codon
        mockCodon([53, 54, 55], 'F')   // Last codon
      ]

      const fragments = [...iterateCodonFragments(codons, 100)]

      // Second fragment (middle codon) should have chevrons on both sides
      expect(fragments[1].startEdge).toBe('chevron')
      expect(fragments[1].endEdge).toBe('chevron')
    })
  })

  describe('letter positioning', () => {
    it('letter=1 for full codon (middle base)', () => {
      const codons = [mockCodon([0, 1, 2], 'M')]
      const fragments = [...iterateCodonFragments(codons, 100)]

      expect(fragments[0].letter).toBe(1)
    })

    it('letter=0 when middle base is first in fragment', () => {
      // Codon split after first base: [0] [1,2]
      // Second fragment has bases 1,2 of codon, so codon's middle (index 1) is at fragment index 0
      const codons = [mockCodon([99, 100, 101], 'M')]  // Line break after 99
      const fragments = [...iterateCodonFragments(codons, 100)]

      expect(fragments[0].letter).toBe(null)  // First base only, no middle
      expect(fragments[1].letter).toBe(0)     // Middle base is first in this fragment
    })

    it('letter=null when fragment has no middle base', () => {
      // Codon split so first fragment only has base 0 (not middle)
      const codons = [mockCodon([99, 100, 101], 'M')]
      const fragments = [...iterateCodonFragments(codons, 100)]

      expect(fragments[0].letter).toBe(null)  // Only has base 0, not middle
    })
  })

  describe('mixed orientation within codon', () => {
    it('each fragment uses its own orientation, not the codon first base', () => {
      // A codon split across two segments with different orientations:
      // First two bases from plus strand, third base from minus strand
      // This is biologically unusual but the code should handle it correctly
      const mixedCodon = {
        bases: [
          { letter: 'A', direction: true, position: 0 },   // plus strand
          { letter: 'T', direction: true, position: 1 },   // plus strand
          { letter: 'G', direction: false, position: 10 }  // minus strand (different segment)
        ],
        aminoAcid: 'M',
        codon: 'ATG'
      }
      const fragments = [...iterateCodonFragments([mixedCodon], 100)]

      // Should have 2 fragments (split at segment boundary due to position discontinuity)
      expect(fragments.length).toBe(2)

      // First fragment (positions 0,1) should have plus orientation
      expect(fragments[0].orientation).toBe(1)

      // Second fragment (position 10) should have minus orientation
      expect(fragments[1].orientation).toBe(-1)
    })
  })

  describe('minus strand', () => {
    it('fragments have orientation -1', () => {
      const codons = [mockCodon([5, 4, 3], 'F', false)]  // direction=false for minus
      const fragments = [...iterateCodonFragments(codons, 100)]

      expect(fragments[0].orientation).toBe(-1)
    })

    it('posInLine calculated correctly for high-to-low positions', () => {
      // Minus strand at positions [5,4,3]: leftmost position is 3
      const codons = [mockCodon([5, 4, 3], 'F', false)]
      const fragments = [...iterateCodonFragments(codons, 100)]

      expect(fragments[0].posInLine).toBe(3)  // Leftmost genomic position
    })

    it('start is the leftmost position for minus strand', () => {
      const codons = [mockCodon([5, 4, 3], 'F', false)]
      const fragments = [...iterateCodonFragments(codons, 100)]

      expect(fragments[0].start).toBe(3)  // Leftmost, not first in coding order
    })

    it('first codon (N-terminus) has flat start edge', () => {
      const codons = [
        mockCodon([5, 4, 3], 'F', false),  // First codon (N-terminus)
        mockCodon([2, 1, 0], 'H', false)   // Last codon (C-terminus)
      ]
      const fragments = [...iterateCodonFragments(codons, 100)]

      // First codon has flat startEdge (N-terminus edge)
      // For minus strand, startEdge is visually on the right
      expect(fragments[0].startEdge).toBe('flat')
      expect(fragments[0].endEdge).toBe('chevron')
    })

    it('last codon (C-terminus) has flat end edge', () => {
      const codons = [
        mockCodon([5, 4, 3], 'F', false),
        mockCodon([2, 1, 0], 'H', false)
      ]
      const fragments = [...iterateCodonFragments(codons, 100)]

      // Last codon has flat endEdge (C-terminus edge)
      // For minus strand, endEdge is visually on the left
      expect(fragments[1].startEdge).toBe('chevron')
      expect(fragments[1].endEdge).toBe('flat')
    })
  })

  describe('first and last codon edges (plus strand)', () => {
    it('first codon has flat left edge', () => {
      const codons = [
        mockCodon([0, 1, 2], 'M'),
        mockCodon([3, 4, 5], 'K')
      ]
      const fragments = [...iterateCodonFragments(codons, 100)]

      expect(fragments[0].startEdge).toBe('flat')  // First codon
      expect(fragments[1].startEdge).toBe('chevron')  // Second codon
    })

    it('last codon has flat right edge', () => {
      const codons = [
        mockCodon([0, 1, 2], 'M'),
        mockCodon([3, 4, 5], 'K')
      ]
      const fragments = [...iterateCodonFragments(codons, 100)]

      expect(fragments[0].endEdge).toBe('chevron')  // First codon
      expect(fragments[1].endEdge).toBe('flat')     // Last codon
    })
  })
})
