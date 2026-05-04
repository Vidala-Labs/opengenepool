import { describe, it, expect } from 'bun:test'
import { computed, ref } from 'vue'
import { useRegionRegistry } from './useRegionRegistry.js'

describe('useRegionRegistry', () => {
  describe('layer registration', () => {
    it('registers a layer', () => {
      const registry = useRegionRegistry()

      registry.registerLayer({
        id: 'test-layer',
        regions: computed(() => []),
        getContextMenuItems: () => []
      })

      expect(registry.hasLayer('test-layer')).toBe(true)
    })

    it('throws if layer has no id', () => {
      const registry = useRegionRegistry()

      expect(() => {
        registry.registerLayer({
          regions: computed(() => [])
        })
      }).toThrow('Layer must have an id')
    })

    it('unregisters a layer', () => {
      const registry = useRegionRegistry()

      registry.registerLayer({
        id: 'test-layer',
        regions: computed(() => [])
      })

      expect(registry.hasLayer('test-layer')).toBe(true)

      registry.unregisterLayer('test-layer')

      expect(registry.hasLayer('test-layer')).toBe(false)
    })

    it('replaces layer when registering same id', () => {
      const registry = useRegionRegistry()

      const regions1 = computed(() => [{ id: 'r1', bounds: { x: 0, y: 0, width: 10, height: 10 } }])
      const regions2 = computed(() => [{ id: 'r2', bounds: { x: 0, y: 0, width: 10, height: 10 } }])

      registry.registerLayer({ id: 'test-layer', regions: regions1 })
      registry.registerLayer({ id: 'test-layer', regions: regions2 })

      const layerRegions = registry.getLayerRegions('test-layer')
      expect(layerRegions[0].id).toBe('r2')
    })
  })

  describe('allRegions', () => {
    it('flattens regions from all layers', () => {
      const registry = useRegionRegistry()

      registry.registerLayer({
        id: 'layer1',
        regions: computed(() => [
          { id: 'r1', bounds: { x: 0, y: 0, width: 10, height: 10 } }
        ])
      })

      registry.registerLayer({
        id: 'layer2',
        regions: computed(() => [
          { id: 'r2', bounds: { x: 20, y: 20, width: 10, height: 10 } }
        ])
      })

      expect(registry.allRegions.value.length).toBe(2)
    })

    it('sorts regions by zIndex descending', () => {
      const registry = useRegionRegistry()

      registry.registerLayer({
        id: 'layer1',
        regions: computed(() => [
          { id: 'low', bounds: { x: 0, y: 0, width: 10, height: 10 }, zIndex: 1 },
          { id: 'high', bounds: { x: 0, y: 0, width: 10, height: 10 }, zIndex: 10 },
          { id: 'mid', bounds: { x: 0, y: 0, width: 10, height: 10 }, zIndex: 5 }
        ])
      })

      const ids = registry.allRegions.value.map(r => r.id)
      expect(ids).toEqual(['high', 'mid', 'low'])
    })

    it('includes layerId on each region', () => {
      const registry = useRegionRegistry()

      registry.registerLayer({
        id: 'my-layer',
        regions: computed(() => [
          { id: 'r1', bounds: { x: 0, y: 0, width: 10, height: 10 } }
        ])
      })

      expect(registry.allRegions.value[0].layerId).toBe('my-layer')
    })
  })

  describe('hitTestLinear', () => {
    it('returns region containing point', () => {
      const registry = useRegionRegistry()

      registry.registerLayer({
        id: 'test',
        regions: computed(() => [
          { id: 'box', bounds: { x: 10, y: 10, width: 20, height: 20 }, metadata: { name: 'test' } }
        ])
      })

      const hit = registry.hitTestLinear(15, 15)
      expect(hit).not.toBeNull()
      expect(hit.id).toBe('box')
    })

    it('returns null when no region contains point', () => {
      const registry = useRegionRegistry()

      registry.registerLayer({
        id: 'test',
        regions: computed(() => [
          { id: 'box', bounds: { x: 10, y: 10, width: 20, height: 20 } }
        ])
      })

      const hit = registry.hitTestLinear(100, 100)
      expect(hit).toBeNull()
    })

    it('returns highest zIndex region when overlapping', () => {
      const registry = useRegionRegistry()

      registry.registerLayer({
        id: 'test',
        regions: computed(() => [
          { id: 'bottom', bounds: { x: 0, y: 0, width: 50, height: 50 }, zIndex: 0 },
          { id: 'top', bounds: { x: 10, y: 10, width: 20, height: 20 }, zIndex: 10 }
        ])
      })

      const hit = registry.hitTestLinear(15, 15)
      expect(hit.id).toBe('top')
    })

    it('checks boundary conditions correctly', () => {
      const registry = useRegionRegistry()

      registry.registerLayer({
        id: 'test',
        regions: computed(() => [
          { id: 'box', bounds: { x: 10, y: 10, width: 20, height: 20 } }
        ])
      })

      // On left edge
      expect(registry.hitTestLinear(10, 15)).not.toBeNull()
      // On right edge
      expect(registry.hitTestLinear(30, 15)).not.toBeNull()
      // Just outside
      expect(registry.hitTestLinear(9, 15)).toBeNull()
      expect(registry.hitTestLinear(31, 15)).toBeNull()
    })

    it('skips circular regions', () => {
      const registry = useRegionRegistry()

      registry.registerLayer({
        id: 'test',
        regions: computed(() => [
          { id: 'arc', bounds: { theta: 0, r: 100, dTheta: Math.PI, dR: 20 } }
        ])
      })

      // Should not find circular region with linear hit-test
      const hit = registry.hitTestLinear(100, 110)
      expect(hit).toBeNull()
    })
  })

  describe('hitTestCircular', () => {
    it('returns region containing point', () => {
      const registry = useRegionRegistry()

      registry.registerLayer({
        id: 'test',
        regions: computed(() => [
          { id: 'arc', bounds: { theta: 0, r: 100, dTheta: Math.PI / 2, dR: 20 }, metadata: { name: 'test' } }
        ])
      })

      // Point at theta=0.5, r=110 (within arc)
      const hit = registry.hitTestCircular(0.5, 110)
      expect(hit).not.toBeNull()
      expect(hit.id).toBe('arc')
    })

    it('returns null when outside radial bounds', () => {
      const registry = useRegionRegistry()

      registry.registerLayer({
        id: 'test',
        regions: computed(() => [
          { id: 'arc', bounds: { theta: 0, r: 100, dTheta: Math.PI, dR: 20 } }
        ])
      })

      // Too far out
      expect(registry.hitTestCircular(0.5, 130)).toBeNull()
      // Too close
      expect(registry.hitTestCircular(0.5, 90)).toBeNull()
    })

    it('returns null when outside angular bounds', () => {
      const registry = useRegionRegistry()

      registry.registerLayer({
        id: 'test',
        regions: computed(() => [
          { id: 'arc', bounds: { theta: 0, r: 100, dTheta: Math.PI / 2, dR: 20 } }
        ])
      })

      // Angle outside range (π is past the π/2 extent)
      expect(registry.hitTestCircular(Math.PI, 110)).toBeNull()
    })

    it('handles wrap-around arcs', () => {
      const registry = useRegionRegistry()

      // Arc from 3π/2 to π/2 (wraps through 0)
      registry.registerLayer({
        id: 'test',
        regions: computed(() => [
          { id: 'wrap-arc', bounds: { theta: 1.5 * Math.PI, r: 100, dTheta: Math.PI, dR: 20 } }
        ])
      })

      // Point at theta=0 (within wrapped arc)
      expect(registry.hitTestCircular(0, 110)).not.toBeNull()
      // Point at theta=π (outside)
      expect(registry.hitTestCircular(Math.PI, 110)).toBeNull()
    })

    it('normalizes negative theta', () => {
      const registry = useRegionRegistry()

      registry.registerLayer({
        id: 'test',
        regions: computed(() => [
          { id: 'arc', bounds: { theta: 0, r: 100, dTheta: Math.PI / 2, dR: 20 } }
        ])
      })

      // Negative theta equivalent to positive
      const hit = registry.hitTestCircular(-2 * Math.PI + 0.5, 110)
      expect(hit).not.toBeNull()
    })

    it('skips linear regions', () => {
      const registry = useRegionRegistry()

      registry.registerLayer({
        id: 'test',
        regions: computed(() => [
          { id: 'box', bounds: { x: 0, y: 100, width: 50, height: 20 } }
        ])
      })

      // Should not find linear region with circular hit-test
      const hit = registry.hitTestCircular(0, 110)
      expect(hit).toBeNull()
    })
  })

  describe('getContextMenuItems', () => {
    it('returns items from layer handler', () => {
      const registry = useRegionRegistry()

      registry.registerLayer({
        id: 'test',
        regions: computed(() => [
          { id: 'r1', bounds: { x: 0, y: 0, width: 10, height: 10 }, metadata: { name: 'Test' } }
        ]),
        getContextMenuItems: (regionId, metadata) => [
          { label: `Edit ${metadata.name}`, action: () => {} }
        ]
      })

      const items = registry.getContextMenuItems('r1')
      expect(items.length).toBe(1)
      expect(items[0].label).toBe('Edit Test')
    })

    it('returns empty array for unknown region', () => {
      const registry = useRegionRegistry()

      const items = registry.getContextMenuItems('unknown')
      expect(items).toEqual([])
    })

    it('passes metadata to handler', () => {
      const registry = useRegionRegistry()
      let receivedMetadata = null

      registry.registerLayer({
        id: 'test',
        regions: computed(() => [
          { id: 'r1', bounds: { x: 0, y: 0, width: 10, height: 10 }, metadata: { custom: 'data' } }
        ]),
        getContextMenuItems: (regionId, metadata) => {
          receivedMetadata = metadata
          return []
        }
      })

      registry.getContextMenuItems('r1')
      expect(receivedMetadata).toEqual({ custom: 'data' })
    })
  })

  describe('getContextMenuItemsAtPoint', () => {
    it('hit-tests and returns items in linear mode', () => {
      const registry = useRegionRegistry()

      registry.registerLayer({
        id: 'test',
        regions: computed(() => [
          { id: 'box', bounds: { x: 10, y: 10, width: 20, height: 20 }, metadata: { id: 'box' } }
        ]),
        getContextMenuItems: () => [{ label: 'Action', action: () => {} }]
      })

      const result = registry.getContextMenuItemsAtPoint(15, 15, 'linear')
      expect(result.region).not.toBeNull()
      expect(result.region.id).toBe('box')
      expect(result.items.length).toBe(1)
    })

    it('hit-tests and returns items in circular mode', () => {
      const registry = useRegionRegistry()

      registry.registerLayer({
        id: 'test',
        regions: computed(() => [
          { id: 'arc', bounds: { theta: 0, r: 100, dTheta: Math.PI, dR: 20 }, metadata: { id: 'arc' } }
        ]),
        getContextMenuItems: () => [{ label: 'Arc Action', action: () => {} }]
      })

      const result = registry.getContextMenuItemsAtPoint(0.5, 110, 'circular')
      expect(result.region).not.toBeNull()
      expect(result.region.id).toBe('arc')
      expect(result.items.length).toBe(1)
    })

    it('returns null region and empty items on miss', () => {
      const registry = useRegionRegistry()

      registry.registerLayer({
        id: 'test',
        regions: computed(() => [
          { id: 'box', bounds: { x: 10, y: 10, width: 20, height: 20 } }
        ])
      })

      const result = registry.getContextMenuItemsAtPoint(100, 100, 'linear')
      expect(result.region).toBeNull()
      expect(result.items).toEqual([])
    })

    it('defaults to linear mode', () => {
      const registry = useRegionRegistry()

      registry.registerLayer({
        id: 'test',
        regions: computed(() => [
          { id: 'box', bounds: { x: 10, y: 10, width: 20, height: 20 } }
        ])
      })

      // No mode specified - should use linear
      const result = registry.getContextMenuItemsAtPoint(15, 15)
      expect(result.region).not.toBeNull()
    })
  })

  describe('getLayerRegions', () => {
    it('returns regions for a layer', () => {
      const registry = useRegionRegistry()

      registry.registerLayer({
        id: 'test',
        regions: computed(() => [
          { id: 'r1', bounds: { x: 0, y: 0, width: 10, height: 10 } },
          { id: 'r2', bounds: { x: 20, y: 0, width: 10, height: 10 } }
        ])
      })

      const regions = registry.getLayerRegions('test')
      expect(regions.length).toBe(2)
    })

    it('returns empty array for unknown layer', () => {
      const registry = useRegionRegistry()

      const regions = registry.getLayerRegions('unknown')
      expect(regions).toEqual([])
    })
  })

  describe('reactivity', () => {
    it('allRegions updates when layer regions change', () => {
      const registry = useRegionRegistry()
      const regionsRef = ref([
        { id: 'r1', bounds: { x: 0, y: 0, width: 10, height: 10 } }
      ])

      registry.registerLayer({
        id: 'test',
        regions: computed(() => regionsRef.value)
      })

      expect(registry.allRegions.value.length).toBe(1)

      // Add a region
      regionsRef.value = [
        ...regionsRef.value,
        { id: 'r2', bounds: { x: 20, y: 0, width: 10, height: 10 } }
      ]

      expect(registry.allRegions.value.length).toBe(2)
    })
  })
})
