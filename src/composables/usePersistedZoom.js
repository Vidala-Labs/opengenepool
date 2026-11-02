import { getStorageItem, setStorageItem } from '../utils/safeStorage.js'

/**
 * Composable for persisting zoom level to localStorage.
 *
 * Usage:
 *   const { getInitialZoom, saveZoom } = usePersistedZoom(props.initialZoom)
 *   editorState.setZoom(getInitialZoom())
 *   watch(zoomLevel, saveZoom)
 */

export const STORAGE_KEY = 'opengenepool-zoom'
const DEFAULT_ZOOM = 100
const MIN_ZOOM = 50

/**
 * @param {number} fallbackZoom - Zoom value to use if localStorage is empty/invalid
 * @param {Storage} storage - Storage implementation (defaults to localStorage)
 */
export function usePersistedZoom(fallbackZoom = DEFAULT_ZOOM, storage = null) {
  /**
   * Get initial zoom from localStorage, falling back to provided value.
   * @returns {number} The zoom level to use
   */
  function getInitialZoom() {
    try {
      const stored = getStorageItem(STORAGE_KEY, storage)
      if (stored !== null) {
        const parsed = parseInt(stored, 10)
        if (!isNaN(parsed) && parsed >= MIN_ZOOM) {
          return parsed
        }
      }
    } catch {
      // Storage may be unavailable (SSR, private browsing)
    }
    return fallbackZoom
  }

  /**
   * Save zoom level to localStorage.
   * @param {number} level - The zoom level to save
   */
  function saveZoom(level) {
    try {
      setStorageItem(STORAGE_KEY, String(level), storage)
    } catch {
      // Ignore storage errors (quota exceeded, private browsing, etc.)
    }
  }

  return { getInitialZoom, saveZoom }
}
