import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createEventBus } from './useEventBus.js'

describe('createEventBus', () => {
  let bus

  beforeEach(() => {
    bus = createEventBus()
  })

  describe('on/emit', () => {
    it('calls handler when event is emitted', () => {
      const handler = vi.fn(() => {})
      bus.on('test', handler)
      bus.emit('test', { data: 'value' })

      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledWith({ data: 'value' })
    })

    it('supports multiple handlers for same event', () => {
      const handler1 = vi.fn(() => {})
      const handler2 = vi.fn(() => {})

      bus.on('test', handler1)
      bus.on('test', handler2)
      bus.emit('test', {})

      expect(handler1).toHaveBeenCalledTimes(1)
      expect(handler2).toHaveBeenCalledTimes(1)
    })

    it('does not call handlers for different events', () => {
      const handler = vi.fn(() => {})
      bus.on('other', handler)
      bus.emit('test', {})

      expect(handler).not.toHaveBeenCalled()
    })
  })

  describe('off', () => {
    it('removes specific handler', () => {
      const handler = vi.fn(() => {})
      bus.on('test', handler)
      bus.off('test', handler)
      bus.emit('test', {})

      expect(handler).not.toHaveBeenCalled()
    })

    it('does not affect other handlers', () => {
      const handler1 = vi.fn(() => {})
      const handler2 = vi.fn(() => {})

      bus.on('test', handler1)
      bus.on('test', handler2)
      bus.off('test', handler1)
      bus.emit('test', {})

      expect(handler1).not.toHaveBeenCalled()
      expect(handler2).toHaveBeenCalledTimes(1)
    })
  })

  describe('plugin registration', () => {
    it('registers plugin with token handlers', () => {
      const handlers = {
        _initialize: vi.fn(() => {}),
        _ready: vi.fn(() => {})
      }

      bus.registerPlugin('test', handlers)
      bus.emit('initialize', {})
      bus.emit('ready', {})

      expect(handlers._initialize).toHaveBeenCalledTimes(1)
      expect(handlers._ready).toHaveBeenCalledTimes(1)
    })

    it('unregisters plugin handlers', () => {
      const handlers = {
        _initialize: vi.fn(() => {})
      }

      bus.registerPlugin('test', handlers)
      bus.unregisterPlugin('test')
      bus.emit('initialize', {})

      expect(handlers._initialize).not.toHaveBeenCalled()
    })

    it('adds source to token data when broadcasting', () => {
      const handlers = {
        _test: vi.fn(() => {})
      }

      bus.registerPlugin('myPlugin', handlers)

      // Simulate another plugin broadcasting
      bus.broadcast('myPlugin', 'test', { data: 'value' })

      expect(handlers._test).toHaveBeenCalledWith({
        source: 'myPlugin',
        data: 'value'
      })
    })
  })

  describe('token types', () => {
    it('handles standard token types', () => {
      const tokens = [
        'initialize', 'newdata', 'ready', 'redraw', 'invalidate',
        'render', 'rendered', 'zoomed', 'resize', 'contextmenu'
      ]

      const handler = vi.fn(() => {})

      for (const token of tokens) {
        bus.on(token, handler)
      }

      for (const token of tokens) {
        bus.emit(token, { type: token })
      }

      expect(handler).toHaveBeenCalledTimes(tokens.length)
    })
  })
})
