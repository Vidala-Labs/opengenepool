import { describe, it, expect, mock } from 'bun:test'
import { useContextMenu, normalizeMenuItems } from './useContextMenu.js'

const SEP = { separator: true }
const item = (id) => ({ id, label: id, action: () => {} })

describe('normalizeMenuItems', () => {
  it('returns an empty array unchanged', () => {
    expect(normalizeMenuItems([])).toEqual([])
  })

  it('drops a leading separator', () => {
    expect(normalizeMenuItems([SEP, item('a')]).map(i => i.id ?? 'SEP')).toEqual(['a'])
  })

  it('drops a trailing separator', () => {
    expect(normalizeMenuItems([item('a'), SEP]).map(i => i.id ?? 'SEP')).toEqual(['a'])
  })

  it('collapses consecutive separators to one', () => {
    const out = normalizeMenuItems([item('a'), SEP, SEP, item('b')])
    expect(out.map(i => i.id ?? 'SEP')).toEqual(['a', 'SEP', 'b'])
  })

  it('handles adversarial leading/trailing/doubled separators together', () => {
    const out = normalizeMenuItems([SEP, item('a'), SEP, SEP, item('b'), SEP])
    expect(out.map(i => i.id ?? 'SEP')).toEqual(['a', 'SEP', 'b'])
  })

  it('keeps a single separator between two real items', () => {
    const out = normalizeMenuItems([item('a'), SEP, item('b')])
    expect(out.map(i => i.id ?? 'SEP')).toEqual(['a', 'SEP', 'b'])
  })

  it('returns empty for a separator-only list', () => {
    expect(normalizeMenuItems([SEP, SEP])).toEqual([])
  })
})

describe('useContextMenu', () => {
  it('builds an empty menu with no contributors', () => {
    const menu = useContextMenu()
    expect(menu.buildMenu({})).toEqual([])
  })

  it('calls contributors in registration order', () => {
    const menu = useContextMenu()
    const order = []
    menu.register({ id: 'first', getItems: () => { order.push('first'); return [item('a')] } })
    menu.register({ id: 'second', getItems: () => { order.push('second'); return [item('b')] } })
    menu.buildMenu({})
    expect(order).toEqual(['first', 'second'])
  })

  it('aggregates items with exactly one separator between non-empty contributors', () => {
    const menu = useContextMenu()
    menu.register({ id: 'one', getItems: () => [item('a'), item('b')] })
    menu.register({ id: 'two', getItems: () => [item('c')] })
    const out = menu.buildMenu({})
    expect(out.map(i => i.id ?? 'SEP')).toEqual(['a', 'b', 'SEP', 'c'])
  })

  it('skips contributors that return empty/falsy (no stray separators)', () => {
    const menu = useContextMenu()
    menu.register({ id: 'one', getItems: () => [item('a')] })
    menu.register({ id: 'empty', getItems: () => [] })
    menu.register({ id: 'null', getItems: () => null })
    menu.register({ id: 'two', getItems: () => [item('b')] })
    const out = menu.buildMenu({})
    expect(out.map(i => i.id ?? 'SEP')).toEqual(['a', 'SEP', 'b'])
  })

  it('collapses separators even when a contributor emits its own boundary separators', () => {
    const menu = useContextMenu()
    menu.register({ id: 'one', getItems: () => [item('a'), SEP] })       // trailing sep
    menu.register({ id: 'two', getItems: () => [SEP, item('b')] })       // leading sep
    const out = menu.buildMenu({})
    expect(out.map(i => i.id ?? 'SEP')).toEqual(['a', 'SEP', 'b'])
  })

  it('passes the context object verbatim to each contributor', () => {
    const menu = useContextMenu()
    const seen = []
    const ctx = { kind: 'annotation', mode: 'linear', annotation: { id: 'x' } }
    menu.register({ id: 'one', getItems: (c) => { seen.push(c); return [] } })
    menu.buildMenu(ctx)
    expect(seen[0]).toBe(ctx)
  })

  it('unregister removes a contributor', () => {
    const menu = useContextMenu()
    const c = { id: 'one', getItems: () => [item('a')] }
    menu.register(c)
    menu.unregister(c)
    expect(menu.buildMenu({})).toEqual([])
  })

  it('register is idempotent by contributor id (no double items)', () => {
    const menu = useContextMenu()
    const c = { id: 'one', getItems: () => [item('a')] }
    menu.register(c)
    menu.register(c)
    const out = menu.buildMenu({})
    expect(out.map(i => i.id)).toEqual(['a'])
  })
})
