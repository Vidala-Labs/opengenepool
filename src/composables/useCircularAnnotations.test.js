import { describe, it, expect } from 'bun:test'
import { ref } from 'vue'
import { useCircularAnnotations } from './useCircularAnnotations.js'
import { useCircularGraphics } from './useCircularGraphics.js'
import { Annotation } from '../utils/annotation.js'

// Helper to create mock editor state
function createMockEditorState(options = {}) {
  return {
    sequenceLength: ref(options.sequenceLength || 5000),
    title: ref(options.title || 'Test')
  }
}

// Helper to create mock event bus
function createMockEventBus() {
  const listeners = new Map()
  return {
    on: (event, callback) => {
      if (!listeners.has(event)) listeners.set(event, [])
      listeners.get(event).push(callback)
    },
    emit: (event, data) => {
      const callbacks = listeners.get(event) || []
      callbacks.forEach(cb => cb(data))
    },
    emitted: listeners
  }
}

describe('useCircularAnnotations', () => {
  describe('setAnnotations', () => {
    it('sets the annotation list', () => {
      const editorState = createMockEditorState()
      const circularGraphics = useCircularGraphics(editorState)
      const { annotations, setAnnotations } = useCircularAnnotations(editorState, circularGraphics, null)

      const ann = new Annotation({ id: 'test', span: '100..500', type: 'gene' })
      setAnnotations([ann])

      expect(annotations.value).toHaveLength(1)
      expect(annotations.value[0].id).toBe('test')
    })
  })

  describe('getElements', () => {
    it('generates elements for annotations', () => {
      const editorState = createMockEditorState()
      const circularGraphics = useCircularGraphics(editorState)
      const { setAnnotations, getElements } = useCircularAnnotations(editorState, circularGraphics, null)

      const ann = new Annotation({ id: 'test', span: '100..500', type: 'gene', caption: 'GFP' })
      setAnnotations([ann])

      const elements = getElements.value
      expect(elements).toHaveLength(1)
      expect(elements[0].annotation.id).toBe('test')
      expect(elements[0].caption).toBe('GFP')
      expect(elements[0].path).toBeTruthy()
    })

    it('returns empty array when no annotations', () => {
      const editorState = createMockEditorState()
      const circularGraphics = useCircularGraphics(editorState)
      const { getElements } = useCircularAnnotations(editorState, circularGraphics, null)

      expect(getElements.value).toHaveLength(0)
    })
  })

  describe('rowAssignments', () => {
    it('assigns non-overlapping annotations to same row', () => {
      const editorState = createMockEditorState()
      const circularGraphics = useCircularGraphics(editorState)
      const { annotations, setAnnotations, rowAssignments } = useCircularAnnotations(editorState, circularGraphics, null)

      const ann1 = new Annotation({ id: 'ann1', span: '100..500', type: 'gene' })
      const ann2 = new Annotation({ id: 'ann2', span: '1000..1500', type: 'gene' })
      setAnnotations([ann1, ann2])

      const { assignments, rowCount } = rowAssignments.value
      expect(rowCount).toBe(1)
      // Use annotations.value to get the actual refs used as Map keys
      expect(assignments.get(annotations.value[0])).toBe(0)
      expect(assignments.get(annotations.value[1])).toBe(0)
    })

    it('assigns overlapping annotations to different rows', () => {
      const editorState = createMockEditorState()
      const circularGraphics = useCircularGraphics(editorState)
      const { setAnnotations, rowAssignments } = useCircularAnnotations(editorState, circularGraphics, null)

      const ann1 = new Annotation({ id: 'ann1', span: '100..500', type: 'gene' })
      const ann2 = new Annotation({ id: 'ann2', span: '200..600', type: 'gene' })
      setAnnotations([ann1, ann2])

      const { rowCount } = rowAssignments.value
      expect(rowCount).toBe(2)
    })

    it('allows annotations to fit between gaps of multi-part annotations', () => {
      const editorState = createMockEditorState()
      const circularGraphics = useCircularGraphics(editorState)
      const { annotations, setAnnotations, rowAssignments } = useCircularAnnotations(editorState, circularGraphics, null)

      // Multi-part annotation with gap: 1..10 + 40..50
      const multiPartAnnotation = new Annotation({
        id: 'multi',
        type: 'gene',
        span: '1..10 + 40..50'
      })

      // Single annotation in gap: 20..30
      const gapAnnotation = new Annotation({
        id: 'gap',
        type: 'gene',
        span: '20..30'
      })

      setAnnotations([multiPartAnnotation, gapAnnotation])

      const { assignments, rowCount } = rowAssignments.value
      expect(rowCount).toBe(1)
      // Use annotations.value to get the actual refs used as Map keys
      const multiRow = assignments.get(annotations.value.find(a => a.id === 'multi'))
      const gapRow = assignments.get(annotations.value.find(a => a.id === 'gap'))
      expect(multiRow).toBe(0)
      expect(gapRow).toBe(0)
    })
  })

  describe('getTypeColor', () => {
    it('returns color for known type', () => {
      const editorState = createMockEditorState()
      const circularGraphics = useCircularGraphics(editorState)
      const { getTypeColor } = useCircularAnnotations(editorState, circularGraphics, null)

      expect(getTypeColor('gene')).toBe('#4CAF50')
      expect(getTypeColor('CDS')).toBe('#2196F3')
    })

    it('returns default color for unknown type', () => {
      const editorState = createMockEditorState()
      const circularGraphics = useCircularGraphics(editorState)
      const { getTypeColor } = useCircularAnnotations(editorState, circularGraphics, null)

      expect(getTypeColor('unknown_type')).toBe('#607D8B')
    })

    it('uses custom colors when provided', () => {
      const editorState = createMockEditorState()
      const circularGraphics = useCircularGraphics(editorState)
      const customColors = ref({ gene: '#FF0000', _default: '#000000' })
      const { getTypeColor } = useCircularAnnotations(editorState, circularGraphics, null, {
        annotationColors: customColors
      })

      expect(getTypeColor('gene')).toBe('#FF0000')
      expect(getTypeColor('unknown')).toBe('#000000')
    })
  })

  describe('captionFits', () => {
    it('returns false when no caption', () => {
      const editorState = createMockEditorState()
      const circularGraphics = useCircularGraphics(editorState)
      const { captionFits } = useCircularAnnotations(editorState, circularGraphics, null)

      expect(captionFits({ caption: '', radius: 100, range: { start: 0, end: 100 } })).toBe(false)
    })
  })

  describe('tooltip methods', () => {
    it('shows and hides tooltip', () => {
      const editorState = createMockEditorState()
      const circularGraphics = useCircularGraphics(editorState)
      const { hoveredAnnotation, tooltipPosition, showTooltip, hideTooltip } = useCircularAnnotations(editorState, circularGraphics, null)

      const ann = new Annotation({ id: 'test', span: '100..500' })
      showTooltip(ann, { x: 100, y: 200 })

      expect(hoveredAnnotation.value.id).toBe('test')
      expect(tooltipPosition.value).toEqual({ x: 100, y: 200 })

      hideTooltip()
      expect(hoveredAnnotation.value).toBeNull()
    })
  })

  describe('event handlers', () => {
    it('handleClick emits annotation-click event', () => {
      const editorState = createMockEditorState()
      const circularGraphics = useCircularGraphics(editorState)
      const eventBus = createMockEventBus()
      const { handleClick, setAnnotations } = useCircularAnnotations(editorState, circularGraphics, eventBus)

      const ann = new Annotation({ id: 'test', span: '100..500' })
      setAnnotations([ann])

      let clickedAnnotation = null
      eventBus.on('annotation-click', ({ annotation }) => {
        clickedAnnotation = annotation
      })

      handleClick(ann, { shiftKey: false })
      expect(clickedAnnotation).toBe(ann)
    })

    it('handleContextMenu emits annotation-contextmenu event', () => {
      const editorState = createMockEditorState()
      const circularGraphics = useCircularGraphics(editorState)
      const eventBus = createMockEventBus()
      const { handleContextMenu, setAnnotations } = useCircularAnnotations(editorState, circularGraphics, eventBus)

      const ann = new Annotation({ id: 'test', span: '100..500' })
      setAnnotations([ann])

      let contextAnnotation = null
      eventBus.on('annotation-contextmenu', ({ annotation }) => {
        contextAnnotation = annotation
      })

      handleContextMenu(ann, {})
      expect(contextAnnotation).toBe(ann)
    })
  })

  describe('query methods', () => {
    it('getAnnotationAtPosition finds annotation at position', () => {
      const editorState = createMockEditorState()
      const circularGraphics = useCircularGraphics(editorState)
      const { setAnnotations, getAnnotationAtPosition } = useCircularAnnotations(editorState, circularGraphics, null)

      const ann = new Annotation({ id: 'test', span: '100..500', type: 'gene' })
      setAnnotations([ann])

      expect(getAnnotationAtPosition(200)?.id).toBe('test')
      expect(getAnnotationAtPosition(50)).toBeNull()
      expect(getAnnotationAtPosition(600)).toBeNull()
    })

    it('getAnnotationsInRange finds annotations overlapping range', () => {
      const editorState = createMockEditorState()
      const circularGraphics = useCircularGraphics(editorState)
      const { setAnnotations, getAnnotationsInRange } = useCircularAnnotations(editorState, circularGraphics, null)

      const ann1 = new Annotation({ id: 'ann1', span: '100..500', type: 'gene' })
      const ann2 = new Annotation({ id: 'ann2', span: '400..800', type: 'gene' })
      const ann3 = new Annotation({ id: 'ann3', span: '1000..1500', type: 'gene' })
      setAnnotations([ann1, ann2, ann3])

      const overlapping = getAnnotationsInRange(450, 600)
      expect(overlapping).toHaveLength(2)
      expect(overlapping.map(a => a.id)).toContain('ann1')
      expect(overlapping.map(a => a.id)).toContain('ann2')
    })
  })
})
