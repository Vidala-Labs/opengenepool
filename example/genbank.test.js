import { describe, it, expect } from 'bun:test'
import { parseGenBank } from './genbank-parser.js'
import { toGenBank } from './genbank-writer.js'
import { ezSpan, Span, Range, Orientation } from '../test/span-helpers.js'

describe('GenBank parser', () => {
  describe('location parsing', () => {
    it('parses simple range', () => {
      const gb = `LOCUS       Test             10 bp    DNA     linear   SYN 01-JAN-2025
FEATURES             Location/Qualifiers
     gene            1..10
                     /label=TestGene
ORIGIN
        1 atcgatcgat
//`
      const result = parseGenBank(gb)
      expect(result.annotations[0].span.toJSON()).toBe('0..10')
    })

    it('parses complement range', () => {
      const gb = `LOCUS       Test             10 bp    DNA     linear   SYN 01-JAN-2025
FEATURES             Location/Qualifiers
     gene            complement(1..10)
                     /label=TestGene
ORIGIN
        1 atcgatcgat
//`
      const result = parseGenBank(gb)
      expect(result.annotations[0].span.toJSON()).toBe('(0..10)')
    })

    it('parses join location', () => {
      const gb = `LOCUS       Test             100 bp   DNA     linear   SYN 01-JAN-2025
FEATURES             Location/Qualifiers
     CDS             join(1..10,21..30)
                     /label=SplicedGene
ORIGIN
        1 atcgatcgat atcgatcgat atcgatcgat atcgatcgat atcgatcgat
       51 atcgatcgat atcgatcgat atcgatcgat atcgatcgat atcgatcgat
//`
      const result = parseGenBank(gb)
      expect(result.annotations[0].span.toJSON()).toBe('0..10 + 20..30')
    })

    it('parses complement join location', () => {
      const gb = `LOCUS       Test             100 bp   DNA     linear   SYN 01-JAN-2025
FEATURES             Location/Qualifiers
     CDS             complement(join(1..10,21..30))
                     /label=SplicedGene
ORIGIN
        1 atcgatcgat atcgatcgat atcgatcgat atcgatcgat atcgatcgat
       51 atcgatcgat atcgatcgat atcgatcgat atcgatcgat atcgatcgat
//`
      const result = parseGenBank(gb)
      expect(result.annotations[0].span.toJSON()).toBe('(0..10) + (20..30)')
    })

    it('parses start indefinite location', () => {
      const gb = `LOCUS       Test             10 bp    DNA     linear   SYN 01-JAN-2025
FEATURES             Location/Qualifiers
     gene            <1..10
                     /label=TestGene
ORIGIN
        1 atcgatcgat
//`
      const result = parseGenBank(gb)
      expect(result.annotations[0].span.toJSON()).toBe('<0..10')
    })

    it('parses end indefinite location', () => {
      const gb = `LOCUS       Test             10 bp    DNA     linear   SYN 01-JAN-2025
FEATURES             Location/Qualifiers
     gene            1..>10
                     /label=TestGene
ORIGIN
        1 atcgatcgat
//`
      const result = parseGenBank(gb)
      expect(result.annotations[0].span.toJSON()).toBe('0..>10')
    })

    it('parses both indefinite location', () => {
      const gb = `LOCUS       Test             10 bp    DNA     linear   SYN 01-JAN-2025
FEATURES             Location/Qualifiers
     gene            <1..>10
                     /label=TestGene
ORIGIN
        1 atcgatcgat
//`
      const result = parseGenBank(gb)
      expect(result.annotations[0].span.toJSON()).toBe('<0..>10')
    })

    it('parses indefinite complement location', () => {
      const gb = `LOCUS       Test             10 bp    DNA     linear   SYN 01-JAN-2025
FEATURES             Location/Qualifiers
     gene            complement(<1..>10)
                     /label=TestGene
ORIGIN
        1 atcgatcgat
//`
      const result = parseGenBank(gb)
      expect(result.annotations[0].span.toJSON()).toBe('(<0..>10)')
    })
  })
})

describe('GenBank writer', () => {
  describe('location writing', () => {
    it('writes simple range', () => {
      const data = {
        name: 'Test',
        sequence: 'ATCGATCGAT',
        annotations: [{ type: 'gene', span: ezSpan(0, 10), caption: 'TestGene' }]
      }
      const gb = toGenBank(data)
      expect(gb).toContain('gene            1..10')
    })

    it('writes complement range', () => {
      const data = {
        name: 'Test',
        sequence: 'ATCGATCGAT',
        annotations: [{ type: 'gene', span: ezSpan(0, 10, Orientation.MINUS), caption: 'TestGene' }]
      }
      const gb = toGenBank(data)
      expect(gb).toContain('gene            complement(1..10)')
    })

    it('writes join location', () => {
      const data = {
        name: 'Test',
        sequence: 'ATCGATCGAT'.repeat(10),
        annotations: [{ type: 'CDS', span: new Span([new Range(0, 10), new Range(20, 30)]), caption: 'SplicedGene' }]
      }
      const gb = toGenBank(data)
      expect(gb).toContain('CDS             join(1..10,21..30)')
    })

    it('writes complement join location', () => {
      const data = {
        name: 'Test',
        sequence: 'ATCGATCGAT'.repeat(10),
        annotations: [{ type: 'CDS', span: new Span([new Range(0, 10, Orientation.MINUS), new Range(20, 30, Orientation.MINUS)]), caption: 'SplicedGene' }]
      }
      const gb = toGenBank(data)
      expect(gb).toContain('CDS             complement(join(1..10,21..30))')
    })

    it('writes start indefinite location', () => {
      const data = {
        name: 'Test',
        sequence: 'ATCGATCGAT',
        annotations: [{ type: 'gene', span: ezSpan(0, 10, Orientation.PLUS, true, false), caption: 'TestGene' }]
      }
      const gb = toGenBank(data)
      expect(gb).toContain('gene            <1..10')
    })

    it('writes end indefinite location', () => {
      const data = {
        name: 'Test',
        sequence: 'ATCGATCGAT',
        annotations: [{ type: 'gene', span: ezSpan(0, 10, Orientation.PLUS, false, true), caption: 'TestGene' }]
      }
      const gb = toGenBank(data)
      expect(gb).toContain('gene            1..>10')
    })

    it('writes both indefinite location', () => {
      const data = {
        name: 'Test',
        sequence: 'ATCGATCGAT',
        annotations: [{ type: 'gene', span: ezSpan(0, 10, Orientation.PLUS, true, true), caption: 'TestGene' }]
      }
      const gb = toGenBank(data)
      expect(gb).toContain('gene            <1..>10')
    })

    it('writes indefinite complement location', () => {
      const data = {
        name: 'Test',
        sequence: 'ATCGATCGAT',
        annotations: [{ type: 'gene', span: ezSpan(0, 10, Orientation.MINUS, true, true), caption: 'TestGene' }]
      }
      const gb = toGenBank(data)
      expect(gb).toContain('gene            complement(<1..>10)')
    })
  })
})

describe('GenBank round-trip', () => {
  it('round-trips simple annotation', () => {
    const original = {
      name: 'TestSeq',
      sequence: 'ATCGATCGATCGATCGATCG',
      annotations: [{ type: 'gene', span: ezSpan(5, 15), caption: 'MyGene', attributes: {} }],
      metadata: { molecule_type: 'DNA', circular: false }
    }

    const gb = toGenBank(original)
    const parsed = parseGenBank(gb)

    expect(parsed.name).toBe('TestSeq')
    expect(parsed.sequence).toBe('ATCGATCGATCGATCGATCG')
    expect(parsed.annotations[0].type).toBe('gene')
    expect(parsed.annotations[0].span.toJSON()).toBe('5..15')
    expect(parsed.annotations[0].caption).toBe('MyGene')
  })

  it('round-trips complement annotation', () => {
    const original = {
      name: 'TestSeq',
      sequence: 'ATCGATCGATCGATCGATCG',
      annotations: [{ type: 'promoter', span: ezSpan(5, 15, Orientation.MINUS), caption: 'MyPromoter', attributes: {} }],
      metadata: {}
    }

    const gb = toGenBank(original)
    const parsed = parseGenBank(gb)

    expect(parsed.annotations[0].span.toJSON()).toBe('(5..15)')
  })

  it('round-trips join annotation', () => {
    const original = {
      name: 'TestSeq',
      sequence: 'ATCGATCGAT'.repeat(10),
      annotations: [{ type: 'CDS', span: new Span([new Range(0, 10), new Range(50, 60)]), caption: 'SplicedCDS', attributes: {} }],
      metadata: {}
    }

    const gb = toGenBank(original)
    const parsed = parseGenBank(gb)

    expect(parsed.annotations[0].span.toJSON()).toBe('0..10 + 50..60')
  })

  it('round-trips complement join annotation', () => {
    const original = {
      name: 'TestSeq',
      sequence: 'ATCGATCGAT'.repeat(10),
      annotations: [{ type: 'CDS', span: new Span([new Range(0, 10, Orientation.MINUS), new Range(50, 60, Orientation.MINUS)]), caption: 'SplicedCDS', attributes: {} }],
      metadata: {}
    }

    const gb = toGenBank(original)
    const parsed = parseGenBank(gb)

    expect(parsed.annotations[0].span.toJSON()).toBe('(0..10) + (50..60)')
  })

  it('round-trips indefinite start annotation', () => {
    const original = {
      name: 'TestSeq',
      sequence: 'ATCGATCGATCGATCGATCG',
      annotations: [{ type: 'gene', span: ezSpan(5, 15, Orientation.PLUS, true, false), caption: 'PartialGene', attributes: {} }],
      metadata: {}
    }

    const gb = toGenBank(original)
    const parsed = parseGenBank(gb)

    expect(parsed.annotations[0].span.toJSON()).toBe('<5..15')
  })

  it('round-trips indefinite end annotation', () => {
    const original = {
      name: 'TestSeq',
      sequence: 'ATCGATCGATCGATCGATCG',
      annotations: [{ type: 'gene', span: ezSpan(5, 15, Orientation.PLUS, false, true), caption: 'PartialGene', attributes: {} }],
      metadata: {}
    }

    const gb = toGenBank(original)
    const parsed = parseGenBank(gb)

    expect(parsed.annotations[0].span.toJSON()).toBe('5..>15')
  })

  it('round-trips both indefinite annotation', () => {
    const original = {
      name: 'TestSeq',
      sequence: 'ATCGATCGATCGATCGATCG',
      annotations: [{ type: 'gene', span: ezSpan(5, 15, Orientation.PLUS, true, true), caption: 'PartialGene', attributes: {} }],
      metadata: {}
    }

    const gb = toGenBank(original)
    const parsed = parseGenBank(gb)

    expect(parsed.annotations[0].span.toJSON()).toBe('<5..>15')
  })

  it('round-trips indefinite complement annotation', () => {
    const original = {
      name: 'TestSeq',
      sequence: 'ATCGATCGATCGATCGATCG',
      annotations: [{ type: 'gene', span: ezSpan(5, 15, Orientation.MINUS, true, true), caption: 'PartialGene', attributes: {} }],
      metadata: {}
    }

    const gb = toGenBank(original)
    const parsed = parseGenBank(gb)

    expect(parsed.annotations[0].span.toJSON()).toBe('(<5..>15)')
  })

  it('round-trips multiple annotations', () => {
    const original = {
      name: 'TestSeq',
      sequence: 'ATCGATCGAT'.repeat(20),
      annotations: [
        { type: 'promoter', span: ezSpan(0, 20), caption: 'Promoter1', attributes: {} },
        { type: 'gene', span: ezSpan(25, 100), caption: 'Gene1', attributes: {} },
        { type: 'CDS', span: new Span([new Range(110, 150, Orientation.MINUS), new Range(160, 180, Orientation.MINUS)]), caption: 'CDS1', attributes: {} },
        { type: 'terminator', span: ezSpan(185, 195, Orientation.PLUS, true, true), caption: 'Term1', attributes: {} }
      ],
      metadata: { circular: true }
    }

    const gb = toGenBank(original)
    const parsed = parseGenBank(gb)

    expect(parsed.annotations).toHaveLength(4)
    expect(parsed.annotations[0].span.toJSON()).toBe('0..20')
    expect(parsed.annotations[1].span.toJSON()).toBe('25..100')
    expect(parsed.annotations[2].span.toJSON()).toBe('(110..150) + (160..180)')
    expect(parsed.annotations[3].span.toJSON()).toBe('<185..>195')
    expect(parsed.metadata.circular).toBe(true)
  })
})
