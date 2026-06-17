import { ref, shallowRef, watch, onScopeDispose } from 'vue'
import { align } from '../utils/alignment.js'

/**
 * Whether a real Web Worker should be used for alignment.
 *
 * Keyed on the MODULE url's protocol, not `typeof Worker`: the test runtime
 * (Bun) provides a constructable `Worker`, but its module url is `file:` — and
 * SSR is `file:` too. Only a browser-served context (`http(s):`/`blob:`) gets a
 * real worker; everything else uses the async main-thread fallback.
 *
 * @param {string} [moduleUrl=import.meta.url]
 * @returns {boolean}
 */
export function canUseWorker(moduleUrl = import.meta.url) {
  try {
    if (typeof Worker !== 'function') return false
    const protocol = new URL(moduleUrl).protocol
    return /^(https?|blob):$/.test(protocol)
  } catch {
    return false
  }
}

/**
 * Run DNA alignment off the synchronous reactive path.
 *
 * Uses a Web Worker in the browser; falls back to running `align()`
 * asynchronously on the main thread when no Worker is available (SSR / tests /
 * a host bundler that can't build the worker). Debounces input changes and drops
 * stale results so rapid edits / document switches never show an outdated
 * alignment.
 *
 * NOTE: the result is asynchronous — consumers must tolerate `result.value`
 * being `null` until the first run settles (and during pending re-runs the
 * previous result remains until the new one lands).
 *
 * @param {() => string} queryGetter  - reactive getter for the query sequence
 * @param {() => string} targetGetter - reactive getter for the target sequence
 * @param {() => object|null} [optionsGetter] - reactive getter for scoring options
 * @param {{debounceMs?: number}} [opts]
 * @returns {{ result: import('vue').ShallowRef, pending: import('vue').Ref<boolean>, whenSettled: () => Promise<void> }}
 */
export function useAlignmentRunner(queryGetter, targetGetter, optionsGetter = null, { debounceMs = 150 } = {}) {
  const result = shallowRef(null)
  const pending = ref(false)

  let nextId = 0
  let currentId = 0
  let timer = null
  let disposed = false

  // Lazy worker + fallback latch.
  let worker = null
  let workerBroken = false
  const useWorker = canUseWorker()

  // Promise machinery for whenSettled().
  let settleResolvers = []
  function notifySettled() {
    const rs = settleResolvers
    settleResolvers = []
    rs.forEach(r => r())
  }
  function whenSettled() {
    if (!pending.value) return Promise.resolve()
    return new Promise(resolve => settleResolvers.push(resolve))
  }

  function applyResult(id, value) {
    if (disposed || id !== currentId) return  // stale / torn-down → ignore
    result.value = value
    pending.value = false
    notifySettled()
  }

  function ensureWorker() {
    if (worker || workerBroken) return worker
    try {
      worker = new Worker(new URL('./alignment.worker.js', import.meta.url), { type: 'module' })
      worker.onmessage = (e) => {
        const { id, result: r, error } = e.data || {}
        if (error !== undefined) { runFallback(id, lastDispatch) ; return }
        applyResult(id, r)
      }
      worker.onerror = () => {
        // Worker hard-errored: latch off and re-run the in-flight request on main thread.
        workerBroken = true
        try { worker?.terminate() } catch {}
        worker = null
        if (lastDispatch && lastDispatch.id === currentId) runFallback(lastDispatch.id, lastDispatch)
      }
    } catch {
      workerBroken = true
      worker = null
    }
    return worker
  }

  let lastDispatch = null

  async function runFallback(id, { query, target, options }) {
    // Defer to a microtask so cancellation semantics match the worker path.
    await Promise.resolve()
    try {
      const value = align(query, target, options || {})
      applyResult(id, value)
    } catch {
      applyResult(id, null)
    }
  }

  function dispatch() {
    if (disposed) return
    const query = queryGetter() || ''
    const target = targetGetter() || ''
    const options = optionsGetter ? optionsGetter() : null

    // Empty-input guard: clear and don't run.
    if (!query || !target) {
      currentId = ++nextId
      result.value = null
      pending.value = false
      notifySettled()
      return
    }

    const id = ++nextId
    currentId = id
    pending.value = true
    lastDispatch = { id, query, target, options }

    if (useWorker && !workerBroken) {
      const w = ensureWorker()
      if (w) { w.postMessage({ id, query, target, options }); return }
    }
    runFallback(id, lastDispatch)
  }

  let firstRun = true

  function schedule() {
    if (disposed) return
    // Mark pending as soon as a change is observed (covers the debounce wait), so
    // whenSettled()/the indicator account for not-yet-dispatched runs. The empty-seq
    // case is reconciled in dispatch() (sets pending=false).
    if ((queryGetter() || '') && (targetGetter() || '')) pending.value = true
    if (timer) { clearTimeout(timer); timer = null }
    // The initial alignment runs immediately (no debounce wait on mount); subsequent
    // input changes are debounced.
    if (debounceMs > 0 && !firstRun) {
      timer = setTimeout(() => { timer = null; dispatch() }, debounceMs)
    } else {
      dispatch()
    }
    firstRun = false
  }

  // flush: 'sync' so an input change marks pending immediately (within the same
  // tick), which keeps whenSettled() correct when callers change inputs and await
  // in the same synchronous block, and debounces correctly across rapid changes.
  watch(
    [queryGetter, targetGetter, ...(optionsGetter ? [optionsGetter] : [])],
    schedule,
    { immediate: true, flush: 'sync' }
  )

  onScopeDispose(() => {
    disposed = true
    if (timer) clearTimeout(timer)
    try { worker?.terminate() } catch {}
    worker = null
    notifySettled()
  })

  return { result, pending, whenSettled }
}
