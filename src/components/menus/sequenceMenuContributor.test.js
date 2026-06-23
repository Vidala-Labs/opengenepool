import { describe, it, expect, vi } from 'vitest'
import { sequenceMenuItems } from './sequenceMenuContributor.js'
import { Range } from '../../utils/dna.js'

function sel({ ranges = null } = {}) {
  return { isSelected: { value: !!ranges }, domain: { value: ranges ? { ranges } : null } }
}
const ids = (items) => items.map(i => i.id)

// A sequence-surface click (the contributor requires a sequence/background target).
const seqCtx = (over = {}) => ({ targets: [{ layer: 'sequence' }], selection: sel(), ...over })

describe('sequenceMenuItems', () => {
  it('offers Select all when a sequence surface is clicked and the sequence is non-empty', () => {
    expect(ids(sequenceMenuItems(seqCtx({ sequenceLength: 100 })))).toContain('select-all')
  })

  it('does NOT contribute when no sequence/background surface is in the chain', () => {
    // e.g. clicking only an annotation (no sequence target) → sequence contributor is silent
    expect(sequenceMenuItems({ targets: [{ layer: 'annotation' }], sequenceLength: 100, selection: sel() })).toEqual([])
  })

  it('contributes on a background target too (empty/cursor surface)', () => {
    expect(ids(sequenceMenuItems({ targets: [{ layer: 'background' }], sequenceLength: 0, selection: sel() }))).toEqual(['insert-sequence'])
  })

  it('omits Select all for an empty document but offers Insert', () => {
    expect(ids(sequenceMenuItems(seqCtx({ sequenceLength: 0 })))).toEqual(['insert-sequence'])
  })

  it('offers Insert at the cursor when the selection is zero-length', () => {
    const onInsert = vi.fn(()=>{})
    const items = sequenceMenuItems(seqCtx({ sequenceLength: 100, selection: sel({ ranges: [new Range(42, 42)] }) }), { onInsert })
    expect(ids(items)).toEqual(['select-all', 'insert-sequence'])
    items.find(i => i.id === 'insert-sequence').action()
    expect(onInsert).toHaveBeenCalledWith(42)
  })

  it('does NOT offer Insert at cursor when the selection is a real range', () => {
    expect(ids(sequenceMenuItems(seqCtx({ sequenceLength: 100, selection: sel({ ranges: [new Range(10, 40)] }) })))).toEqual(['select-all'])
  })

  it('omits Insert in readonly mode', () => {
    expect(sequenceMenuItems(seqCtx({ sequenceLength: 0, readonly: true }))).toEqual([])
  })

  it('routes Select all with the layer mode for alignment attribution', () => {
    const onSelectAll = vi.fn(()=>{})
    const items = sequenceMenuItems(seqCtx({ sequenceLength: 100, mode: 'query', layerMode: 'query' }), { onSelectAll })
    items.find(i => i.id === 'select-all').action()
    expect(onSelectAll).toHaveBeenCalledWith('query')
  })

  it('alignment: a layer stays silent when its mode is not the clicked row', () => {
    expect(sequenceMenuItems(seqCtx({ sequenceLength: 100, mode: 'target', layerMode: 'query' }))).toEqual([])
  })

  it('alignment: contributes when its layer mode matches the clicked row', () => {
    expect(ids(sequenceMenuItems(seqCtx({ sequenceLength: 100, mode: 'target', layerMode: 'target' })))).toContain('select-all')
  })
})
