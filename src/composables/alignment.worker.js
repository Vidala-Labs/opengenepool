/**
 * Alignment Web Worker.
 *
 * Runs the heavy Smith-Waterman `align()` off the main thread. Message protocol:
 *   in:  { id, query, target, options }
 *   out: { id, result }   on success
 *        { id, error }    on failure
 *
 * WASM is loaded once (memoized). If it fails to load in the worker context,
 * `align()` transparently uses its JS fallback, so results are still correct.
 */
import { align, loadWasm } from '../utils/alignment.js'

let wasmReady = null

self.onmessage = async (e) => {
  const { id, query, target, options } = e.data || {}
  try {
    if (!wasmReady) wasmReady = loadWasm()
    await wasmReady
    const result = align(query, target, options || {})
    self.postMessage({ id, result })
  } catch (err) {
    self.postMessage({ id, error: err?.message || String(err) })
  }
}
