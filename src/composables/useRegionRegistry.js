import { shallowRef, computed } from 'vue'

/**
 * Region registry composable for managing clickable regions and context menus.
 *
 * Each layer registers its regions with bounds and metadata.
 * The editor uses hit-testing to find which region was clicked
 * and asks the owning layer for context menu items.
 *
 * Region structure:
 * {
 *   id: string,           // Unique region identifier
 *   bounds: {             // Bounding box (linear) or arc (circular)
 *     // Linear: { x, y, width, height }
 *     // Circular: { theta, r, dTheta, dR }
 *   },
 *   zIndex: number,       // Higher = on top (checked first in hit-test)
 *   metadata: object      // Layer-specific data (annotation, range, etc.)
 * }
 *
 * Layer structure:
 * {
 *   id: string,
 *   regions: ComputedRef<Region[]>,   // Reactive array of regions
 *   getContextMenuItems: (regionId, metadata) => MenuItem[]
 * }
 */
export function useRegionRegistry() {
  // Map of layer ID -> layer object
  // Use shallowRef to prevent Vue from auto-unwrapping computed refs stored in layers
  const layers = shallowRef(new Map())

  /**
   * All regions flattened and sorted by zIndex (highest first).
   * This is used for hit-testing - we check highest zIndex regions first.
   */
  const allRegions = computed(() => {
    const result = []

    for (const [layerId, layer] of layers.value.entries()) {
      const regions = layer.regions?.value || []
      for (const region of regions) {
        result.push({
          ...region,
          layerId
        })
      }
    }

    // Sort by zIndex descending (highest first for hit-testing)
    result.sort((a, b) => (b.zIndex || 0) - (a.zIndex || 0))

    return result
  })

  /**
   * Register a layer with its regions and context menu handler.
   *
   * @param {Object} layer - Layer configuration
   * @param {string} layer.id - Unique layer identifier
   * @param {ComputedRef<Region[]>} layer.regions - Reactive array of regions
   * @param {Function} layer.getContextMenuItems - Function to get menu items for a region
   */
  function registerLayer(layer) {
    if (!layer.id) {
      throw new Error('Layer must have an id')
    }

    const newLayers = new Map(layers.value)
    newLayers.set(layer.id, {
      id: layer.id,
      regions: layer.regions,
      getContextMenuItems: layer.getContextMenuItems || (() => [])
    })
    layers.value = newLayers
  }

  /**
   * Unregister a layer.
   *
   * @param {string} layerId - Layer ID to remove
   */
  function unregisterLayer(layerId) {
    const newLayers = new Map(layers.value)
    newLayers.delete(layerId)
    layers.value = newLayers
  }

  /**
   * Hit-test for linear view (x/y pixel coordinates).
   * Returns the first (highest zIndex) region that contains the point.
   *
   * @param {number} x - X coordinate
   * @param {number} y - Y coordinate
   * @returns {Object|null} - Region with layerId, or null if no hit
   */
  function hitTestLinear(x, y) {
    for (const region of allRegions.value) {
      const bounds = region.bounds
      if (!bounds || bounds.theta !== undefined) {
        // Skip circular regions
        continue
      }

      const { x: rx, y: ry, width, height } = bounds
      if (x >= rx && x <= rx + width && y >= ry && y <= ry + height) {
        return region
      }
    }
    return null
  }

  /**
   * Hit-test for circular view (theta/r polar coordinates).
   * Returns the first (highest zIndex) region that contains the point.
   *
   * @param {number} theta - Angle in radians
   * @param {number} r - Radius from center
   * @returns {Object|null} - Region with layerId, or null if no hit
   */
  function hitTestCircular(theta, r) {
    // Normalize theta to [0, 2π)
    const twoPi = 2 * Math.PI
    theta = ((theta % twoPi) + twoPi) % twoPi

    for (const region of allRegions.value) {
      const bounds = region.bounds
      if (!bounds || bounds.x !== undefined) {
        // Skip linear regions
        continue
      }

      const { theta: startTheta, r: innerR, dTheta, dR } = bounds

      // Check radial bounds
      if (r < innerR || r > innerR + dR) {
        continue
      }

      // Check angular bounds
      // Normalize startTheta
      let normalizedStart = ((startTheta % twoPi) + twoPi) % twoPi
      let endTheta = normalizedStart + dTheta

      // Handle wrap-around
      if (endTheta > twoPi) {
        // Arc wraps around
        if (theta >= normalizedStart || theta <= endTheta - twoPi) {
          return region
        }
      } else {
        if (theta >= normalizedStart && theta <= endTheta) {
          return region
        }
      }
    }
    return null
  }

  /**
   * Get context menu items for a region.
   *
   * @param {string} regionId - Region ID
   * @returns {Array} - Menu items
   */
  function getContextMenuItems(regionId) {
    // Find the region and its layer
    for (const [layerId, layer] of layers.value.entries()) {
      const regions = layer.regions?.value || []
      const region = regions.find(r => r.id === regionId)

      if (region) {
        return layer.getContextMenuItems(regionId, region.metadata)
      }
    }
    return []
  }

  /**
   * Get context menu items for a point (hit-tests and returns items).
   * Useful for right-click handling.
   *
   * @param {number} x - X coordinate (linear) or theta (circular)
   * @param {number} y - Y coordinate (linear) or r (circular)
   * @param {string} mode - 'linear' or 'circular'
   * @returns {Object} - { region, items } or { region: null, items: [] }
   */
  function getContextMenuItemsAtPoint(x, y, mode = 'linear') {
    const region = mode === 'circular'
      ? hitTestCircular(x, y)
      : hitTestLinear(x, y)

    if (!region) {
      return { region: null, items: [] }
    }

    const items = getContextMenuItems(region.id)
    return { region, items }
  }

  /**
   * Get all regions for a specific layer.
   *
   * @param {string} layerId - Layer ID
   * @returns {Array} - Array of regions
   */
  function getLayerRegions(layerId) {
    const layer = layers.value.get(layerId)
    return layer?.regions?.value || []
  }

  /**
   * Check if a layer is registered.
   *
   * @param {string} layerId - Layer ID
   * @returns {boolean}
   */
  function hasLayer(layerId) {
    return layers.value.has(layerId)
  }

  return {
    // State
    layers,
    allRegions,

    // Layer management
    registerLayer,
    unregisterLayer,
    hasLayer,
    getLayerRegions,

    // Hit-testing
    hitTestLinear,
    hitTestCircular,

    // Context menu
    getContextMenuItems,
    getContextMenuItemsAtPoint
  }
}
