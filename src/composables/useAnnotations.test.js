import { describe, it, expect, beforeEach } from 'bun:test'
import { useAnnotations, generateArrowPath, AnnotationElement } from './useAnnotations.js'
import { useEditorState } from './useEditorState.js'
import { useGraphics } from './useGraphics.js'
import { createEventBus } from './useEventBus.js'
import { Annotation } from '../utils/annotation.js'
import { Orientation } from '../utils/dna.js'

describe('generateArrowPath', () => {
  const blockWidth = 8
  const height = 16
  const arrowEdge = 2  // rounded edge offset

  describe('plus strand (arrow pointing right)', () => {
    it('generates arrow path for right-pointing arrow', () => {
      const path = generateArrowPath({
        left: 100,
        right: 200,
        height: 16,
        blockWidth: 8,
        arrowEdge: 2,
        orientation: Orientation.PLUS
      })

      // Plus strand: arrow point at right, shaft on left
      // Path: M right,-h/2 L right-block,0 V -edge H left V -(h-edge) H right-block V -h Z
      expect(path).toContain('M 200')  // Start at right edge
      expect(path).toContain('L 192')  // Arrow point goes to right-blockWidth
      expect(path).toContain('H 100')  // Horizontal to left
    })

    it('generates rectangle for short annotations', () => {
      const path = generateArrowPath({
        left: 100,
        right: 108,  // Only 8px wide, same as blockWidth
        height: 16,
        blockWidth: 8,
        arrowEdge: 2,
        orientation: Orientation.PLUS
      })

      // Should be a simple rectangle for narrow annotations
      expect(path).toContain('M 100')
      expect(path).toContain('H 108')
    })
  })

  describe('minus strand (arrow pointing left)', () => {
    it('generates arrow path for left-pointing arrow', () => {
      const path = generateArrowPath({
        left: 100,
        right: 200,
        height: 16,
        blockWidth: 8,
        arrowEdge: 2,
        orientation: Orientation.MINUS
      })

      // Minus strand: arrow point at left, shaft on right
      expect(path).toContain('M 100')  // Start at left edge
      expect(path).toContain('L 108')  // Arrow point
      expect(path).toContain('H 200')  // Horizontal to right
    })
  })

  describe('undirected', () => {
    it('generates rectangle for undirected annotations', () => {
      const path = generateArrowPath({
        left: 100,
        right: 200,
        height: 16,
        blockWidth: 8,
        arrowEdge: 2,
        orientation: Orientation.NONE
      })

      // Should be a simple rectangle
      expect(path).toMatch(/M 100.*H 200.*V.*H 100.*Z/)
    })
  })
})

describe('AnnotationElement', () => {
  it('computes bounding box for layout', () => {
    const elem = new AnnotationElement({
      left: 100,
      top: 0,
      right: 200,
      bottom: 16,
      fragment: null,
      path: ''
    })

    expect(elem.left).toBe(100)
    expect(elem.top).toBe(0)
    expect(elem.right).toBe(200)
    expect(elem.bottom).toBe(16)
  })

  it('applies transform after layout', () => {
    const elem = new AnnotationElement({
      left: 100,
      top: 0,
      right: 200,
      bottom: 16,
      fragment: null,
      path: ''
    })

    elem.applyTransform(0, -20)

    expect(elem.deltaY).toBe(-20)
    expect(elem.transformedTop).toBe(-20)
    expect(elem.transformedBottom).toBe(-4)
  })

  it('tracks width for sorting', () => {
    const elem = new AnnotationElement({
      left: 100,
      top: 0,
      right: 200,
      bottom: 16,
      fragment: null,
      path: ''
    })

    expect(elem.width).toBe(100)
  })
})

describe('useAnnotations', () => {
  let editorState
  let graphics
  let eventBus
  let annotations

  function createAnnotations() {
    editorState = useEditorState()
    editorState.setSequence('A'.repeat(1000))
    editorState.setZoom(100)
    graphics = useGraphics(editorState)
    graphics.setContainerSize(800, 600)
    graphics.setFontMetrics(8, 16)
    eventBus = createEventBus()
    annotations = useAnnotations(editorState, graphics, eventBus)
    return annotations
  }

  describe('setAnnotations', () => {
    it('sets annotation list', () => {
      const ann = createAnnotations()
      const annotationList = [
        new Annotation({ id: '1', caption: 'Gene A', type: 'gene', span: '10..50' })
      ]

      ann.setAnnotations(annotationList)

      expect(ann.annotations.value.length).toBe(1)
      expect(ann.annotations.value[0].caption).toBe('Gene A')
    })
  })

  describe('elements computation', () => {
    it('creates elements for annotation fragments', () => {
      const ann = createAnnotations()
      ann.setAnnotations([
        new Annotation({ id: '1', caption: 'Gene A', type: 'gene', span: '10..50' })
      ])

      const lineElements = ann.getElementsByLine.value.get(0)
      expect(lineElements).toBeDefined()
      expect(lineElements.length).toBe(1)
    })

    it('splits annotations across lines', () => {
      const ann = createAnnotations()
      // At zoom=100, this annotation spans lines 0, 1, and 2
      ann.setAnnotations([
        new Annotation({ id: '1', caption: 'Gene A', type: 'gene', span: '50..250' })
      ])

      expect(ann.getElementsByLine.value.get(0)).toBeDefined()  // 50-99
      expect(ann.getElementsByLine.value.get(1)).toBeDefined()  // 100-199
      expect(ann.getElementsByLine.value.get(2)).toBeDefined()  // 200-250
    })

    it('generates arrow paths for directional annotations', () => {
      const ann = createAnnotations()
      ann.setAnnotations([
        new Annotation({ id: '1', caption: 'Gene A', type: 'gene', span: '10..50' })  // plus strand
      ])

      const elem = ann.getElementsByLine.value.get(0)[0]
      expect(elem.path).toContain('M')  // Has SVG path
    })
  })

  describe('layout', () => {
    it('stacks overlapping annotations vertically', () => {
      const ann = createAnnotations()
      ann.setAnnotations([
        new Annotation({ id: '1', caption: 'Gene A', type: 'gene', span: '10..80' }),
        new Annotation({ id: '2', caption: 'Gene B', type: 'promoter', span: '30..60' })
      ])

      const lineElements = ann.getElementsByLine.value.get(0)
      expect(lineElements.length).toBe(2)

      // After layout, one should be pushed up (negative deltaY)
      // The wider one stays at baseline, narrower one moves up
      const deltaYs = lineElements.map(e => e.deltaY)
      expect(deltaYs.some(d => d < 0)).toBe(true)  // At least one moved up
    })

    it('does not stack non-overlapping annotations', () => {
      const ann = createAnnotations()
      ann.setAnnotations([
        new Annotation({ id: '1', caption: 'Gene A', type: 'gene', span: '10..30' }),
        new Annotation({ id: '2', caption: 'Gene B', type: 'promoter', span: '50..70' })
      ])

      const lineElements = ann.getElementsByLine.value.get(0)
      expect(lineElements.length).toBe(2)

      // Neither should be moved
      const deltaYs = lineElements.map(e => e.deltaY)
      expect(deltaYs.every(d => d === 0)).toBe(true)
    })

    it('stacks multi-range annotations correctly per fragment', () => {
      // Bug fix test: multi-range annotations should have each fragment
      // stacked independently, not all fragments using the first fragment's row
      const ann = createAnnotations()
      ann.setAnnotations([
        // Multi-range annotation with fragments at 1..10 and 16..25
        new Annotation({ id: '1', caption: 'Multi', type: 'gene', span: '1..10+16..25' }),
        // Annotation that overlaps only the second fragment (16..25)
        new Annotation({ id: '2', caption: 'Overlap', type: 'gene', span: '12..75' })
      ])

      const lineElements = ann.getElementsByLine.value.get(0)
      // Should have 3 elements: two fragments from multi-range, one from overlapping
      expect(lineElements.length).toBe(3)

      // Find the fragment for positions 1..10 and 16..25
      const frag1 = lineElements.find(e => e.fragment.start === 1 && e.fragment.end === 10)
      const frag2 = lineElements.find(e => e.fragment.start === 16 && e.fragment.end === 25)
      const overlapAnnotation = lineElements.find(e => e.fragment.annotation?.id === '2')

      expect(frag1).toBeDefined()
      expect(frag2).toBeDefined()
      expect(overlapAnnotation).toBeDefined()

      // The key test: frag1 (1..10) doesn't overlap with the overlap annotation (12..75),
      // so frag1 should NOT be stacked (deltaY = 0)
      // frag2 (16..25) DOES overlap with the overlap annotation (12..75),
      // so one of them should be stacked (deltaY < 0)
      expect(frag1.deltaY).toBe(0) // First fragment doesn't overlap, should be at baseline

      // Either frag2 or overlapAnnotation should be stacked (one at row 0, one at row 1)
      const stackedCount = [frag2, overlapAnnotation].filter(e => e.deltaY < 0).length
      expect(stackedCount).toBe(1) // Exactly one should be stacked due to overlap
    })
  })

  describe('tooltip', () => {
    it('tracks hovered annotation', () => {
      const ann = createAnnotations()
      ann.setAnnotations([
        new Annotation({ id: '1', caption: 'Gene A', type: 'gene', span: '10..50' })
      ])

      ann.showTooltip(ann.annotations.value[0], { x: 100, y: 200 })

      expect(ann.hoveredAnnotation.value).toBe(ann.annotations.value[0])
      expect(ann.tooltipPosition.value).toEqual({ x: 100, y: 200 })
    })

    it('hides tooltip', () => {
      const ann = createAnnotations()
      ann.setAnnotations([
        new Annotation({ id: '1', caption: 'Gene A', type: 'gene', span: '10..50' })
      ])

      ann.showTooltip(ann.annotations.value[0], { x: 100, y: 200 })
      ann.hideTooltip()

      expect(ann.hoveredAnnotation.value).toBe(null)
    })
  })

  describe('event bus integration', () => {
    it('emits annotation-click on click', () => {
      const ann = createAnnotations()
      const testAnnotation = new Annotation({ id: '1', caption: 'Gene A', type: 'gene', span: '10..50' })
      ann.setAnnotations([testAnnotation])

      let emittedData = null
      eventBus.on('annotation-click', (data) => {
        emittedData = data
      })

      ann.handleClick(testAnnotation, { clientX: 100, clientY: 200 })

      expect(emittedData).toBeDefined()
      expect(emittedData.annotation).toBe(testAnnotation)
    })

    it('emits annotation-contextmenu on right-click', () => {
      const ann = createAnnotations()
      const testAnnotation = new Annotation({ id: '1', caption: 'Gene A', type: 'gene', span: '10..50' })
      ann.setAnnotations([testAnnotation])

      let emittedData = null
      eventBus.on('annotation-contextmenu', (data) => {
        emittedData = data
      })

      ann.handleContextMenu(testAnnotation, { clientX: 100, clientY: 200 })

      expect(emittedData).toBeDefined()
      expect(emittedData.annotation).toBe(testAnnotation)
    })

    it('emits extendselect on shift-click to add annotation to existing selection', () => {
      const ann = createAnnotations()
      const testAnnotation = new Annotation({ id: '1', caption: 'Gene A', type: 'gene', span: '100..150' })
      ann.setAnnotations([testAnnotation])

      let selectEvent = null
      let extendEvent = null
      eventBus.on('select', (data) => {
        selectEvent = data
      })
      eventBus.on('extendselect', (data) => {
        extendEvent = data
      })

      // Shift-click on annotation
      ann.handleClick(testAnnotation, { shiftKey: true })

      // Should emit extendselect, not select
      expect(extendEvent).toBeDefined()
      expect(extendEvent.domain).toBe('100..150')
      expect(selectEvent).toBe(null)
    })

    it('emits select on regular click (no shift)', () => {
      const ann = createAnnotations()
      const testAnnotation = new Annotation({ id: '1', caption: 'Gene A', type: 'gene', span: '100..150' })
      ann.setAnnotations([testAnnotation])

      let selectEvent = null
      let extendEvent = null
      eventBus.on('select', (data) => {
        selectEvent = data
      })
      eventBus.on('extendselect', (data) => {
        extendEvent = data
      })

      // Regular click on annotation (no shift)
      ann.handleClick(testAnnotation, { shiftKey: false })

      // Should emit select, not extendselect
      expect(selectEvent).toBeDefined()
      expect(selectEvent.domain).toBe('100..150')
      expect(extendEvent).toBe(null)
    })
  })

  describe('getAnnotationAtPosition', () => {
    it('finds annotation containing position', () => {
      const ann = createAnnotations()
      const testAnnotation = new Annotation({ id: '1', caption: 'Gene A', type: 'gene', span: '10..50' })
      ann.setAnnotations([testAnnotation])

      const found = ann.getAnnotationAtPosition(25)

      expect(found.id).toBe(testAnnotation.id)
      expect(found.caption).toBe(testAnnotation.caption)
    })

    it('returns null when no annotation at position', () => {
      const ann = createAnnotations()
      ann.setAnnotations([
        new Annotation({ id: '1', caption: 'Gene A', type: 'gene', span: '10..50' })
      ])

      const found = ann.getAnnotationAtPosition(60)

      expect(found).toBe(null)
    })
  })
})
