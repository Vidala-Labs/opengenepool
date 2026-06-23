import { describe, it, expect, vi } from 'vitest'
import { selectionMenuItems } from './selectionMenuContributor.js'
import { Range, Orientation } from '../../utils/dna.js'

function sel({ ranges = null } = {}) {
  return { isSelected: { value: !!ranges }, domain: { value: ranges ? { ranges } : null } }
}
const ids = (items) => items.map(i => i.id)

// A context where the click did NOT land on a selection element (e.g. background
// or annotation) — only system state is present.
const stateCtx = (selection, over = {}) => ({ targets: [], selection, ...over })
// A context where a selection range/handle IS in the target chain.
const rangeCtx = (selection, target, over = {}) => ({ targets: [{ layer: 'selection', ...target }], selection, ...over })

describe('selectionMenuItems — selection-state items (selection exists, any click)', () => {
  it('returns [] when no selection and nothing selection-related clicked', () => {
    expect(selectionMenuItems(stateCtx(sel()))).toEqual([])
  })

  it('offers copy + select-none for a cursor (zero-length) selection', () => {
    expect(ids(selectionMenuItems(stateCtx(sel({ ranges: [new Range(5, 5)] }))))).toEqual([
      'copy-selection', 'select-none'
    ])
  })

  it('offers replace + delete for a single non-zero range', () => {
    expect(ids(selectionMenuItems(stateCtx(sel({ ranges: [new Range(5, 15)] }))))).toEqual([
      'copy-selection', 'select-none', 'replace-sequence', 'delete-sequence'
    ])
  })

  it('omits replace for a multi-range selection but keeps delete', () => {
    const out = ids(selectionMenuItems(stateCtx(sel({ ranges: [new Range(5, 15), new Range(20, 30)] }))))
    expect(out).toContain('delete-sequence')
    expect(out).not.toContain('replace-sequence')
  })

  it('omits edit items in readonly (keeps copy + select-none)', () => {
    expect(ids(selectionMenuItems(stateCtx(sel({ ranges: [new Range(5, 15)] }), { readonly: true })))).toEqual([
      'copy-selection', 'select-none'
    ])
  })

  it('selection-state items appear even when an annotation was clicked (compose)', () => {
    const ctx = {
      targets: [{ layer: 'annotation', annotation: {} }],
      selection: sel({ ranges: [new Range(5, 15)] })
    }
    expect(ids(selectionMenuItems(ctx))).toContain('copy-selection')
  })

  it('routes copy/select-none/replace/delete/create via deps', () => {
    const deps = { onCopy: vi.fn(()=>{}), onSelectNone: vi.fn(()=>{}), onReplace: vi.fn(()=>{}), onDelete: vi.fn(()=>{}), onCreateAnnotation: vi.fn(()=>{}) }
    const range = new Range(5, 15)
    const items = selectionMenuItems(stateCtx(sel({ ranges: [range] })), deps)
    const byId = Object.fromEntries(items.map(i => [i.id, i]))
    byId['copy-selection'].action(); expect(deps.onCopy).toHaveBeenCalled()
    byId['select-none'].action(); expect(deps.onSelectNone).toHaveBeenCalled()
    byId['replace-sequence'].action(); expect(deps.onReplace).toHaveBeenCalledWith(range)
    byId['delete-sequence'].action(); expect(deps.onDelete).toHaveBeenCalled()
  })
})

describe('selectionMenuItems — clicked on a selection range', () => {
  it('offers strand flip + undirected for a directional range (copy comes from state)', () => {
    const selection = sel({ ranges: [new Range(5, 15, Orientation.PLUS)] })
    const out = ids(selectionMenuItems(rangeCtx(selection, { rangeIndex: 0 })))
    expect(out).toEqual(['copy-selection', 'select-none', 'replace-sequence', 'delete-sequence', 'flip-strand', 'make-undirected'])
  })

  it('offers set-plus/set-minus for an undirected range', () => {
    const selection = sel({ ranges: [new Range(5, 15, Orientation.NONE)] })
    const out = ids(selectionMenuItems(rangeCtx(selection, { rangeIndex: 0 })))
    expect(out).toContain('set-plus-strand')
    expect(out).toContain('set-minus-strand')
  })

  it('adds multi-range move/delete for multi-range selections', () => {
    const ranges = [new Range(5, 15, Orientation.PLUS), new Range(20, 30, Orientation.PLUS), new Range(40, 50, Orientation.PLUS)]
    const out = ids(selectionMenuItems(rangeCtx(sel({ ranges }), { rangeIndex: 1 })))
    expect(out).toContain('delete-range')
    expect(out).toContain('move-range-up')
    expect(out).toContain('move-range-down')
  })

  it('first range has no move-up; last has no move-down', () => {
    const ranges = [new Range(5, 15, Orientation.PLUS), new Range(20, 30, Orientation.PLUS)]
    expect(ids(selectionMenuItems(rangeCtx(sel({ ranges }), { rangeIndex: 0 })))).not.toContain('move-range-up')
    expect(ids(selectionMenuItems(rangeCtx(sel({ ranges }), { rangeIndex: 1 })))).not.toContain('move-range-down')
  })

  it('routes strand + range ops via deps', () => {
    const deps = { onFlip: vi.fn(()=>{}), onSetOrientation: vi.fn(()=>{}), onDeleteRange: vi.fn(()=>{}), onMoveRange: vi.fn(()=>{}) }
    const ranges = [new Range(5, 15, Orientation.PLUS), new Range(20, 30, Orientation.PLUS)]
    const items = selectionMenuItems(rangeCtx(sel({ ranges }), { rangeIndex: 0 }), deps)
    const byId = Object.fromEntries(items.map(i => [i.id, i]))
    byId['flip-strand'].action(); expect(deps.onFlip).toHaveBeenCalledWith(0)
    byId['make-undirected'].action(); expect(deps.onSetOrientation).toHaveBeenCalledWith(0, 0)
    byId['delete-range'].action(); expect(deps.onDeleteRange).toHaveBeenCalledWith(0)
    byId['move-range-down'].action(); expect(deps.onMoveRange).toHaveBeenCalledWith(0, 1)
  })

  it('offers extend-to-position for a handle and routes it (when supported)', () => {
    const onExtendHandle = vi.fn(()=>{})
    const range = new Range(5, 15, Orientation.PLUS)
    const items = selectionMenuItems(rangeCtx(sel({ ranges: [range] }), { rangeIndex: 0, handleType: 'start' }), { onExtendHandle })
    // handle menu: only the extend item (selection-state copy etc. still present from state)
    expect(ids(items)).toContain('extend-to-position')
    items.find(i => i.id === 'extend-to-position').action()
    expect(onExtendHandle).toHaveBeenCalledWith(0, range, 'start')
  })

  // BUG 3: circular/alignment editors wire onExtendHandle to a no-op, so the item
  // must NOT be shown there — only when the editor actually supports extend.
  it('does NOT offer extend-to-position when the editor provides no onExtendHandle', () => {
    const range = new Range(5, 15, Orientation.PLUS)
    const items = selectionMenuItems(rangeCtx(sel({ ranges: [range] }), { rangeIndex: 0, handleType: 'start' }), {})
    expect(ids(items)).not.toContain('extend-to-position')
  })
})
