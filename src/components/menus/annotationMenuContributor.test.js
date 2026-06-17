import { describe, it, expect, mock } from 'bun:test'
import { annotationMenuItems } from './annotationMenuContributor.js'
import { Span, Range, Orientation } from '../../utils/dna.js'

function makeSelection({ ranges = null } = {}) {
  return {
    isSelected: { value: !!ranges },
    domain: { value: ranges ? { ranges } : null }
  }
}

function ann(overrides = {}) {
  return {
    id: 'ann1',
    caption: 'Gene',
    type: 'gene',
    span: new Span([new Range(10, 50, Orientation.PLUS)]),
    attributes: {},
    ...overrides
  }
}

const ids = (items) => items.map(i => i.id).filter(Boolean)
// Build a context whose target chain contains an annotation target.
const ctx = (over = {}) => {
  const { annotation = ann(), rangeIndex, ...rest } = over
  return {
    mode: 'linear',
    targets: [{ layer: 'annotation', annotation, rangeIndex }],
    selection: makeSelection(),
    ...rest
  }
}

describe('annotationMenuItems', () => {
  it('offers only Create Annotation when no annotation target in the chain', () => {
    expect(ids(annotationMenuItems({ targets: [{ layer: 'selection' }] }))).toEqual(['create-annotation'])
    expect(ids(annotationMenuItems({ targets: [] }))).toEqual(['create-annotation'])
    expect(ids(annotationMenuItems({}))).toEqual(['create-annotation'])
  })

  it('returns [] in readonly mode', () => {
    expect(annotationMenuItems(ctx({ readonly: true }))).toEqual([])
  })

  it('routes Create Annotation through deps', () => {
    const onCreateAnnotation = mock(() => {})
    const items = annotationMenuItems({ targets: [] }, { onCreateAnnotation })
    items.find(i => i.id === 'create-annotation').action()
    expect(onCreateAnnotation).toHaveBeenCalled()
  })

  it('offers create, edit, delete, and hide for a visible annotation', () => {
    const items = annotationMenuItems(ctx())
    expect(ids(items)).toEqual(['create-annotation', 'edit-annotation', 'delete-annotation', 'hide-annotation'])
  })

  it('offers unhide (not hide) for a hidden annotation', () => {
    const items = annotationMenuItems(ctx({ annotation: ann({ attributes: { 'ogp:hidden': true } }) }))
    expect(ids(items)).toContain('unhide-annotation')
    expect(ids(items)).not.toContain('hide-annotation')
  })

  it('routes edit/delete/hide through deps', () => {
    const onEdit = mock(() => {}), onDelete = mock(() => {}), onToggleHidden = mock(() => {})
    const a = ann()
    const c = ctx({ annotation: a })
    const items = annotationMenuItems(c, { onEdit, onDelete, onToggleHidden })
    const byId = Object.fromEntries(items.map(i => [i.id, i]))
    byId['edit-annotation'].action(); expect(onEdit).toHaveBeenCalledWith(a)
    byId['delete-annotation'].action(); expect(onDelete).toHaveBeenCalledWith(a)
    byId['hide-annotation'].action(); expect(onToggleHidden).toHaveBeenCalledWith(a, true)
  })

  it('unhide routes onToggleHidden with false', () => {
    const onToggleHidden = mock(() => {})
    const a = ann({ attributes: { 'ogp:hidden': true } })
    const items = annotationMenuItems(ctx({ annotation: a }), { onToggleHidden })
    items.find(i => i.id === 'unhide-annotation').action()
    expect(onToggleHidden).toHaveBeenCalledWith(a, false)
  })

  it('offers subtract-from-selection when annotation overlaps selection, routed via deps', () => {
    const onSubtract = mock(() => {})
    const selection = makeSelection({ ranges: [new Range(20, 40, Orientation.PLUS)] })
    const items = annotationMenuItems(ctx({ selection }), { onSubtract })
    const sub = items.find(i => i.id === 'subtract-from-selection')
    expect(sub).toBeTruthy()
    sub.action()
    expect(onSubtract).toHaveBeenCalled()
  })

  it('omits subtract when no overlap', () => {
    const selection = makeSelection({ ranges: [new Range(60, 80, Orientation.PLUS)] })
    expect(ids(annotationMenuItems(ctx({ selection })))).not.toContain('subtract-from-selection')
  })

  it('offers merge for adjacent same-orientation segments and routes via deps', () => {
    const onMergeRight = mock(() => {})
    const multi = ann({ span: new Span([new Range(10, 20, Orientation.PLUS), new Range(20, 30, Orientation.PLUS)]) })
    const items = annotationMenuItems(ctx({ annotation: multi, rangeIndex: 0 }), { onMergeRight })
    const m = items.find(i => i.id === 'merge-with-right-segment')
    expect(m).toBeTruthy()
    m.action()
    expect(onMergeRight).toHaveBeenCalledWith(multi, 0)
  })

  it('does not offer merge across different orientations', () => {
    const multi = ann({ span: new Span([new Range(10, 20, Orientation.PLUS), new Range(20, 30, Orientation.MINUS)]) })
    expect(ids(annotationMenuItems(ctx({ annotation: multi, rangeIndex: 0 })))).not.toContain('merge-with-right-segment')
  })

  it('offers split when a cursor is strictly inside a range and routes via deps', () => {
    const onSplit = mock(() => {})
    const selection = makeSelection({ ranges: [new Range(25, 25, Orientation.PLUS)] })
    const multi = ann({ span: new Span([new Range(10, 20, Orientation.PLUS), new Range(20, 30, Orientation.PLUS)]) })
    const items = annotationMenuItems(ctx({ annotation: multi, rangeIndex: 1, selection }), { onSplit })
    const split = items.find(i => i.id === 'split-annotation')
    expect(split).toBeTruthy()
    split.action()
    expect(onSplit).toHaveBeenCalledWith(multi, 1, 25)
  })

  it('does not offer split when cursor is at a boundary', () => {
    const selection = makeSelection({ ranges: [new Range(20, 20, Orientation.PLUS)] })
    const multi = ann({ span: new Span([new Range(10, 20, Orientation.PLUS), new Range(20, 30, Orientation.PLUS)]) })
    expect(ids(annotationMenuItems(ctx({ annotation: multi, rangeIndex: 1, selection })))).not.toContain('split-annotation')
  })

  it('offers clip-primer-binding (forward primer) with correct bind length', () => {
    const onClipPrimer = mock(() => {})
    // primer 10..30 plus; selection exactly matches it; clicked annotation has one end inside
    const primer = ann({ id: 'p', caption: 'M13', type: 'primer', span: new Span([new Range(10, 30, Orientation.PLUS)]) })
    const clicked = ann({ id: 'g', type: 'gene', span: new Span([new Range(20, 60, Orientation.PLUS)]) }) // start=20 inside (10,30)
    const selection = makeSelection({ ranges: [new Range(10, 30, Orientation.PLUS)] })
    const items = annotationMenuItems(
      ctx({ annotation: clicked, rangeIndex: 0, selection, annotations: [primer, clicked] }),
      { onClipPrimer }
    )
    const clip = items.find(i => i.id === 'clip-primer-binding')
    expect(clip).toBeTruthy()
    expect(clip.label).toBe('Clip primer binding of M13')
    clip.action()
    // forward: end(30) - clipPosition(20) = 10
    expect(onClipPrimer).toHaveBeenCalledWith(primer, 10)
  })

  it('offers clip-this-primer when clicking the primer itself with one terminus inside', () => {
    const onClipPrimer = mock(() => {})
    const primer = ann({ id: 'p', caption: 'M13', type: 'primer', span: new Span([new Range(10, 30, Orientation.PLUS)]) })
    const selection = makeSelection({ ranges: [new Range(20, 40, Orientation.PLUS)] }) // start 20 inside (10,30), end 40 outside
    const items = annotationMenuItems(
      ctx({ annotation: primer, rangeIndex: 0, selection, annotations: [primer] }),
      { onClipPrimer }
    )
    const clip = items.find(i => i.id === 'clip-this-primer')
    expect(clip).toBeTruthy()
    clip.action()
    // forward: end(30) - clipPosition(20) = 10
    expect(onClipPrimer).toHaveBeenCalledWith(primer, 10)
  })
})
