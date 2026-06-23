import { ezSpan, Span, Range, Orientation } from '../../test/span-helpers.js'
import { describe, it, expect } from 'vitest'
import { Annotation, AnnotationFragment, ANNOTATION_COLORS, getAnnotationColor, OGP_ATTR_PREFIX, OGP_HIDDEN_ATTR, isOgpAttr, isAnnotationHidden } from './annotation.js'

/**
 * Annotation tests use FENCED coordinates (0-based, half-open).
 * See dna.test.js for coordinate system documentation.
 */

describe('Annotation', () => {
  describe('constructor', () => {
    it('creates annotation with all properties', () => {
      const span = new Span([new Range(10, 50, Orientation.PLUS)])
      const ann = new Annotation({
        id: 'ann1',
        caption: 'GFP',
        type: 'gene',
        span,
        attributes: { color: 'green' }
      })

      expect(ann.id).toBe('ann1')
      expect(ann.caption).toBe('GFP')
      expect(ann.type).toBe('gene')
      expect(ann.span).toBe(span)
      expect(ann.attributes).toEqual({ color: 'green' })
    })

    it('uses defaults for optional properties', () => {
      const ann = new Annotation({ id: 'ann1' })

      expect(ann.caption).toBe('')
      expect(ann.type).toBe('misc_feature')
      expect(ann.attributes).toEqual({})
    })

    it('accepts Span objects', () => {
      const ann = new Annotation({
        id: 'ann1',
        span: ezSpan(10, 50)  // Fenced: positions 10-49
      })

      expect(ann.span.ranges).toHaveLength(1)
      expect(ann.span.ranges[0].start).toBe(10)
      expect(ann.span.ranges[0].end).toBe(50)
    })

    it('accepts array of Range objects', () => {
      const ranges = [
        new Range(10, 30, Orientation.PLUS),
        new Range(40, 60, Orientation.PLUS)
      ]
      const ann = new Annotation({
        id: 'ann1',
        span: ranges
      })

      expect(ann.span.ranges).toHaveLength(2)
      expect(ann.span.ranges[0].start).toBe(10)
      expect(ann.span.ranges[1].start).toBe(40)
    })

    it('creates empty span when none provided', () => {
      const ann = new Annotation({ id: 'ann1' })
      expect(ann.span.ranges).toHaveLength(0)
    })

    it('throws when span is provided as a plain string', () => {
      expect(() => new Annotation({
        id: 'ann1',
        span: '10..50'
      })).toThrow('Annotation requires span to be a Span, Range[], or object with ranges property')
    })
  })

  describe('orientation', () => {
    it('returns plus for forward annotation', () => {
      const ann = new Annotation({
        id: 'ann1',
        span: ezSpan(10, 50)
      })
      expect(ann.orientation).toBe(Orientation.PLUS)
    })

    it('returns minus for complement annotation', () => {
      const ann = new Annotation({
        id: 'ann1',
        span: ezSpan(10, 50, Orientation.MINUS) // minus strand
      })
      expect(ann.orientation).toBe(Orientation.MINUS)
    })
  })

  describe('length', () => {
    it('returns total length of annotation', () => {
      const ann = new Annotation({
        id: 'ann1',
        span: ezSpan(10, 50)  // Fenced: 40 bases (positions 10-49)
      })
      expect(ann.length).toBe(40)
    })

    it('returns combined length for multi-range annotation', () => {
      const ann = new Annotation({
        id: 'ann1',
        span: new Span([new Range(10, 30), new Range(40, 60)])  // Fenced: 20 + 20 = 40 bases
      })
      expect(ann.length).toBe(40)
    })
  })

  describe('cssClass', () => {
    it('generates CSS class from type and id', () => {
      const ann = new Annotation({
        id: 'gfp1',
        type: 'gene'
      })
      expect(ann.cssClass).toBe('annotation annotation-gene annotation-gfp1')
    })
  })

  describe('bounds', () => {
    it('returns bounding range', () => {
      const ann = new Annotation({
        id: 'ann1',
        span: new Span([new Range(10, 30), new Range(50, 70)])  // Fenced coordinates
      })
      const bounds = ann.bounds
      expect(bounds.start).toBe(10)
      expect(bounds.end).toBe(70)
    })
  })

  describe('overlaps', () => {
    it('returns true when annotation overlaps range', () => {
      const ann = new Annotation({
        id: 'ann1',
        span: ezSpan(20, 40)
      })
      expect(ann.overlaps(10, 30)).toBe(true)
      expect(ann.overlaps(30, 50)).toBe(true)
    })

    it('returns false when annotation does not overlap', () => {
      const ann = new Annotation({
        id: 'ann1',
        span: ezSpan(20, 40)
      })
      expect(ann.overlaps(0, 10)).toBe(false)
      expect(ann.overlaps(50, 60)).toBe(false)
    })

    it('returns false for empty annotation', () => {
      const ann = new Annotation({ id: 'ann1' })
      expect(ann.overlaps(0, 100)).toBe(false)
    })
  })

  describe('toFragments', () => {
    it('creates single fragment for annotation within one line', () => {
      const ann = new Annotation({
        id: 'ann1',
        span: ezSpan(10, 40)  // Fenced: positions 10-39 on line 0
      })
      const fragments = ann.toFragments(100)

      expect(fragments).toHaveLength(1)
      expect(fragments[0].line).toBe(0)
      expect(fragments[0].start).toBe(10)
      expect(fragments[0].end).toBe(40)
      expect(fragments[0].isStart).toBe(true)
      expect(fragments[0].isEnd).toBe(true)
    })

    it('creates multiple fragments for multi-line annotation', () => {
      const ann = new Annotation({
        id: 'ann1',
        span: ezSpan(80, 170)  // Fenced: spans lines 0, 1 at zoom 100
      })
      const fragments = ann.toFragments(100)

      expect(fragments).toHaveLength(2)

      // First line fragment
      expect(fragments[0].line).toBe(0)
      expect(fragments[0].start).toBe(80)
      expect(fragments[0].end).toBe(100)
      expect(fragments[0].isStart).toBe(true)
      expect(fragments[0].isEnd).toBe(false)

      // Second line fragment
      expect(fragments[1].line).toBe(1)
      expect(fragments[1].start).toBe(0)
      expect(fragments[1].end).toBe(70)
      expect(fragments[1].isStart).toBe(false)
      expect(fragments[1].isEnd).toBe(true)
    })

    it('creates fragment for each line in long annotation', () => {
      const ann = new Annotation({
        id: 'ann1',
        span: ezSpan(50, 350)  // Fenced: spans 4 lines at zoom 100
      })
      const fragments = ann.toFragments(100)

      expect(fragments).toHaveLength(4)
      expect(fragments[0].line).toBe(0)
      expect(fragments[1].line).toBe(1)
      expect(fragments[2].line).toBe(2)
      expect(fragments[3].line).toBe(3)

      // Middle fragments are full width
      expect(fragments[1].start).toBe(0)
      expect(fragments[1].end).toBe(100)
      expect(fragments[1].isStart).toBe(false)
      expect(fragments[1].isEnd).toBe(false)
    })

    it('handles multi-range annotations', () => {
      const ann = new Annotation({
        id: 'ann1',
        span: new Span([new Range(10, 30), new Range(60, 80)])  // Fenced: two separate regions
      })
      const fragments = ann.toFragments(100)

      expect(fragments).toHaveLength(2)
      expect(fragments[0].start).toBe(10)
      expect(fragments[0].end).toBe(30)
      expect(fragments[1].start).toBe(60)
      expect(fragments[1].end).toBe(80)
    })
  })

  describe('toString', () => {
    it('returns readable string representation', () => {
      const ann = new Annotation({
        id: 'ann1',
        caption: 'GFP',
        type: 'gene',
        span: ezSpan(100, 500)  // Fenced coordinates
      })

      expect(ann.toString()).toBe('GFP (gene): 100..500')
    })
  })
})

describe('AnnotationFragment', () => {
  const createAnnotation = () => new Annotation({
    id: 'ann1',
    caption: 'Test',
    type: 'gene',
    span: ezSpan(10, 50)
  })

  describe('width', () => {
    it('returns width in bases', () => {
      const frag = new AnnotationFragment({
        annotation: createAnnotation(),
        line: 0,
        start: 10,
        end: 40,
        orientation: Orientation.PLUS,
        isStart: true,
        isEnd: true
      })

      expect(frag.width).toBe(30)
    })
  })

  describe('showArrow', () => {
    it('shows arrow at end for plus orientation', () => {
      const ann = createAnnotation()

      const startFrag = new AnnotationFragment({
        annotation: ann,
        line: 0,
        start: 10,
        end: 50,
        orientation: Orientation.PLUS,
        isStart: true,
        isEnd: false
      })

      const endFrag = new AnnotationFragment({
        annotation: ann,
        line: 1,
        start: 0,
        end: 30,
        orientation: Orientation.PLUS,
        isStart: false,
        isEnd: true
      })

      expect(startFrag.showArrow).toBe(false)
      expect(endFrag.showArrow).toBe(true)
    })

    it('shows arrow at start for minus orientation', () => {
      const ann = new Annotation({
        id: 'ann1',
        span: ezSpan(10, 100, Orientation.MINUS) // minus strand
      })

      const startFrag = new AnnotationFragment({
        annotation: ann,
        line: 0,
        start: 10,
        end: 50,
        orientation: Orientation.MINUS,
        isStart: true,
        isEnd: false
      })

      const endFrag = new AnnotationFragment({
        annotation: ann,
        line: 1,
        start: 0,
        end: 30,
        orientation: Orientation.MINUS,
        isStart: false,
        isEnd: true
      })

      expect(startFrag.showArrow).toBe(true)
      expect(endFrag.showArrow).toBe(false)
    })

    it('returns false for no orientation', () => {
      const frag = new AnnotationFragment({
        annotation: createAnnotation(),
        line: 0,
        start: 10,
        end: 40,
        orientation: Orientation.NONE,
        isStart: true,
        isEnd: true
      })

      expect(frag.showArrow).toBe(false)
    })
  })

  describe('parent annotation properties', () => {
    it('delegates id, caption, type, cssClass to parent', () => {
      const ann = new Annotation({
        id: 'gfp1',
        caption: 'GFP',
        type: 'gene',
        span: ezSpan(10, 50)
      })

      const frag = new AnnotationFragment({
        annotation: ann,
        line: 0,
        start: 10,
        end: 50,
        orientation: Orientation.PLUS,
        isStart: true,
        isEnd: true
      })

      expect(frag.id).toBe('gfp1')
      expect(frag.caption).toBe('GFP')
      expect(frag.type).toBe('gene')
      expect(frag.cssClass).toBe('annotation annotation-gene annotation-gfp1')
    })
  })
})

describe('ANNOTATION_COLORS', () => {
  it('has colors for common types', () => {
    expect(ANNOTATION_COLORS.gene).toBe('#4CAF50')
    expect(ANNOTATION_COLORS.CDS).toBe('#2196F3')
    expect(ANNOTATION_COLORS.promoter).toBe('#FF9800')
    expect(ANNOTATION_COLORS.terminator).toBe('#F44336')
  })

  it('has a default color', () => {
    expect(ANNOTATION_COLORS._default).toBe('#607D8B')
  })
})

describe('getAnnotationColor', () => {
  it('returns color for known type', () => {
    expect(getAnnotationColor('gene')).toBe('#4CAF50')
    expect(getAnnotationColor('CDS')).toBe('#2196F3')
  })

  it('returns default for unknown type', () => {
    expect(getAnnotationColor('unknown_type')).toBe('#607D8B')
  })
})

describe('ogp: namespace helpers', () => {
  it('exposes the namespace constants', () => {
    expect(OGP_ATTR_PREFIX).toBe('ogp:')
    expect(OGP_HIDDEN_ATTR).toBe('ogp:hidden')
  })

  describe('isOgpAttr', () => {
    it('is true for keys in the ogp: namespace', () => {
      expect(isOgpAttr('ogp:hidden')).toBe(true)
      expect(isOgpAttr('ogp:anything')).toBe(true)
    })

    it('is false for normal and underscore keys', () => {
      expect(isOgpAttr('note')).toBe(false)
      expect(isOgpAttr('gene')).toBe(false)
      expect(isOgpAttr('_originalAnnotation')).toBe(false)
      expect(isOgpAttr('ogp')).toBe(false)  // no colon
    })
  })

  describe('isAnnotationHidden', () => {
    it('is true only when ogp:hidden === true', () => {
      expect(isAnnotationHidden({ attributes: { 'ogp:hidden': true } })).toBe(true)
    })

    it('is false when absent, false, or truthy-but-not-true', () => {
      expect(isAnnotationHidden({ attributes: {} })).toBe(false)
      expect(isAnnotationHidden({ attributes: { 'ogp:hidden': false } })).toBe(false)
      expect(isAnnotationHidden({ attributes: { 'ogp:hidden': 'true' } })).toBe(false)
      expect(isAnnotationHidden({})).toBe(false)
      expect(isAnnotationHidden(null)).toBe(false)
      expect(isAnnotationHidden(undefined)).toBe(false)
    })
  })
})
