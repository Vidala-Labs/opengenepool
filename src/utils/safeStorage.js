/**
 * Guarded localStorage access.
 *
 * Reading/writing `localStorage` can throw (SSR / prerender where it doesn't
 * exist; privacy-restricted or full-quota browsers). These helpers never throw:
 * a failed read returns null, a failed write/remove is a no-op. Use these instead
 * of touching `localStorage` directly so component module-init and setup paths
 * stay safe in every environment.
 */

function storage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    // Accessing the global can itself throw in some sandboxed environments.
    return null
  }
}

/** @returns {string|null} the stored value, or null if missing/unavailable. */
export function getStorageItem(key) {
  try {
    return storage()?.getItem(key) ?? null
  } catch {
    return null
  }
}

/** Store a value; no-op (returns false) if storage is unavailable or throws. */
export function setStorageItem(key, value) {
  try {
    const s = storage()
    if (!s) return false
    s.setItem(key, value)
    return true
  } catch {
    return false
  }
}

/** Remove a key; no-op if storage is unavailable or throws. */
export function removeStorageItem(key) {
  try {
    storage()?.removeItem(key)
  } catch {
    // ignore
  }
}
