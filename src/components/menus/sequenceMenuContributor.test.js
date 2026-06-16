import { describe, it, expect, mock } from 'bun:test'
import { sequenceMenuItems } from './sequenceMenuContributor.js'
import { Range } from '../../utils/dna.js'

function sel({ ranges = null } = {}) {
  return { isSelected: { value: !!ranges }, domain: { value: ranges ? { ranges } : null } }
}
const ids = (items) => items.map(i => i.id)

describe('sequenceMenuItems', () => {
  it('returns [] for non-sequence/background kinds', () => {
    expect(sequenceMenuItems({ kind: 'annotation', sequenceLength: 100 })).toEqual([])
  })

  it('offers Select all when sequence is non-empty', () => {
    const items = sequenceMenuItems({ kind: 'sequence', sequenceLength: 100, selection: sel() })
    expect(ids(items)).toContain('select-all')
  })

  it('omits Select all for an empty document but offers Insert', () => {
    const items = sequenceMenuItems({ kind: 'background', sequenceLength: 0, selection: sel() })
    expect(ids(items)).toEqual(['insert-sequence'])
  })

  it('offers Insert at the cursor when the selection is zero-length', () => {
    const onInsert = mock(()=>{})
    const items = sequenceMenuItems(
      { kind: 'sequence', sequenceLength: 100, selection: sel({ ranges: [new Range(42, 42)] }) },
      { onInsert }
    )
    expect(ids(items)).toEqual(['select-all', 'insert-sequence'])
    items.find(i => i.id === 'insert-sequence').action()
    expect(onInsert).toHaveBeenCalledWith(42)
  })

  it('does NOT offer Insert at cursor when the selection is a real range', () => {
    const items = sequenceMenuItems(
      { kind: 'sequence', sequenceLength: 100, selection: sel({ ranges: [new Range(10, 40)] }) }
    )
    expect(ids(items)).toEqual(['select-all'])
  })

  it('omits Insert in readonly mode', () => {
    const items = sequenceMenuItems({ kind: 'background', sequenceLength: 0, readonly: true, selection: sel() })
    expect(items).toEqual([])
  })

  it('routes Select all with the layer mode for alignment attribution', () => {
    const onSelectAll = mock(()=>{})
    const items = sequenceMenuItems(
      { kind: 'sequence', sequenceLength: 100, mode: 'query', layerMode: 'query', selection: sel() },
      { onSelectAll }
    )
    items.find(i => i.id === 'select-all').action()
    expect(onSelectAll).toHaveBeenCalledWith('query')
  })

  it('alignment: a layer stays silent when its mode is not the clicked row', () => {
    const items = sequenceMenuItems({
      kind: 'sequence', sequenceLength: 100, mode: 'target', layerMode: 'query', selection: sel()
    })
    expect(items).toEqual([])
  })

  it('alignment: contributes when its layer mode matches the clicked row', () => {
    const items = sequenceMenuItems({
      kind: 'sequence', sequenceLength: 100, mode: 'target', layerMode: 'target', selection: sel()
    })
    expect(ids(items)).toContain('select-all')
  })
})
