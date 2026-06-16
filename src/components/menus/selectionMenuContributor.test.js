import { describe, it, expect, mock } from 'bun:test'
import { selectionMenuItems } from './selectionMenuContributor.js'
import { Range, Orientation } from '../../utils/dna.js'

function sel({ ranges = null } = {}) {
  return { isSelected: { value: !!ranges }, domain: { value: ranges ? { ranges } : null } }
}
const ids = (items) => items.map(i => i.id)

describe('selectionMenuItems — sequence/background context (selection exists)', () => {
  it('returns [] when no selection', () => {
    expect(selectionMenuItems({ kind: 'background', selection: sel() })).toEqual([])
  })

  it('offers copy + select-none for a cursor (zero-length) selection', () => {
    const ctx = { kind: 'sequence', selection: sel({ ranges: [new Range(5, 5)] }) }
    expect(ids(selectionMenuItems(ctx))).toEqual(['copy-selection', 'select-none', 'create-annotation'])
  })

  it('offers replace + delete for a single non-zero range', () => {
    const ctx = { kind: 'background', selection: sel({ ranges: [new Range(5, 15)] }) }
    expect(ids(selectionMenuItems(ctx))).toEqual([
      'copy-selection', 'select-none', 'replace-sequence', 'delete-sequence', 'create-annotation'
    ])
  })

  it('omits replace for a multi-range selection but keeps delete', () => {
    const ctx = { kind: 'background', selection: sel({ ranges: [new Range(5, 15), new Range(20, 30)] }) }
    const out = ids(selectionMenuItems(ctx))
    expect(out).toContain('delete-sequence')
    expect(out).not.toContain('replace-sequence')
  })

  it('omits edit items in readonly (keeps copy + select-none)', () => {
    const ctx = { kind: 'background', readonly: true, selection: sel({ ranges: [new Range(5, 15)] }) }
    expect(ids(selectionMenuItems(ctx))).toEqual(['copy-selection', 'select-none'])
  })

  it('routes copy/select-none/replace/delete/create via deps', () => {
    const deps = { onCopy: mock(()=>{}), onSelectNone: mock(()=>{}), onReplace: mock(()=>{}), onDelete: mock(()=>{}), onCreateAnnotation: mock(()=>{}) }
    const range = new Range(5, 15)
    const items = selectionMenuItems({ kind: 'background', selection: sel({ ranges: [range] }) }, deps)
    const byId = Object.fromEntries(items.map(i => [i.id, i]))
    byId['copy-selection'].action(); expect(deps.onCopy).toHaveBeenCalled()
    byId['select-none'].action(); expect(deps.onSelectNone).toHaveBeenCalled()
    byId['replace-sequence'].action(); expect(deps.onReplace).toHaveBeenCalledWith(range)
    byId['delete-sequence'].action(); expect(deps.onDelete).toHaveBeenCalled()
    byId['create-annotation'].action(); expect(deps.onCreateAnnotation).toHaveBeenCalled()
  })
})

describe('selectionMenuItems — clicked on a selection range', () => {
  it('offers copy + strand flip + undirected for a directional range', () => {
    const ctx = { kind: 'selection', rangeIndex: 0, selection: sel({ ranges: [new Range(5, 15, Orientation.PLUS)] }) }
    expect(ids(selectionMenuItems(ctx))).toEqual(['copy-selection', 'flip-strand', 'make-undirected'])
  })

  it('offers set-plus/set-minus for an undirected range', () => {
    const ctx = { kind: 'selection', rangeIndex: 0, selection: sel({ ranges: [new Range(5, 15, Orientation.NONE)] }) }
    expect(ids(selectionMenuItems(ctx))).toEqual(['copy-selection', 'set-plus-strand', 'set-minus-strand'])
  })

  it('adds multi-range move/delete for multi-range selections', () => {
    const ranges = [new Range(5, 15, Orientation.PLUS), new Range(20, 30, Orientation.PLUS), new Range(40, 50, Orientation.PLUS)]
    const ctx = { kind: 'selection', rangeIndex: 1, selection: sel({ ranges }) }
    const out = ids(selectionMenuItems(ctx))
    expect(out).toContain('delete-range')
    expect(out).toContain('move-range-up')
    expect(out).toContain('move-range-down')
  })

  it('first range has no move-up; last has no move-down', () => {
    const ranges = [new Range(5, 15, Orientation.PLUS), new Range(20, 30, Orientation.PLUS)]
    expect(ids(selectionMenuItems({ kind: 'selection', rangeIndex: 0, selection: sel({ ranges }) }))).not.toContain('move-range-up')
    expect(ids(selectionMenuItems({ kind: 'selection', rangeIndex: 1, selection: sel({ ranges }) }))).not.toContain('move-range-down')
  })

  it('routes strand + range ops via deps', () => {
    const deps = { onFlip: mock(()=>{}), onSetOrientation: mock(()=>{}), onDeleteRange: mock(()=>{}), onMoveRange: mock(()=>{}) }
    const ranges = [new Range(5, 15, Orientation.PLUS), new Range(20, 30, Orientation.PLUS)]
    const items = selectionMenuItems({ kind: 'selection', rangeIndex: 0, selection: sel({ ranges }) }, deps)
    const byId = Object.fromEntries(items.map(i => [i.id, i]))
    byId['flip-strand'].action(); expect(deps.onFlip).toHaveBeenCalledWith(0)
    byId['make-undirected'].action(); expect(deps.onSetOrientation).toHaveBeenCalledWith(0, 0)
    byId['delete-range'].action(); expect(deps.onDeleteRange).toHaveBeenCalledWith(0)
    byId['move-range-down'].action(); expect(deps.onMoveRange).toHaveBeenCalledWith(0, 1)
  })

  it('offers extend-to-position for a handle and routes it', () => {
    const onExtendHandle = mock(()=>{})
    const range = new Range(5, 15, Orientation.PLUS)
    const ctx = { kind: 'selection', rangeIndex: 0, handleType: 'start', selection: sel({ ranges: [range] }) }
    const items = selectionMenuItems(ctx, { onExtendHandle })
    expect(ids(items)).toEqual(['extend-to-position'])
    items[0].action()
    expect(onExtendHandle).toHaveBeenCalledWith(0, range, 'start')
  })
})
