/**
 * IndexedDB Backend Adapter
 *
 * Provides local persistence for standalone/offline editing using IndexedDB.
 * All edit operations are stored locally with the same insert/delete interface
 * as the LiveView backend, enabling offline-first editing.
 */

import { Span, Range } from '../utils/dna.js'

/**
 * Normalize a span from storage back to a Span object.
 * Handles: Span instances, fenced strings from toJSON(), objects with ranges array.
 */
function normalizeSpan(span) {
  if (span instanceof Span) return span
  if (typeof span === 'string') return Span.parse(span)
  if (span?.ranges) {
    return new Span(span.ranges.map(range => range instanceof Range
      ? range
      : new Range(
          range.start,
          range.end,
          range.orientation ?? 1,
          range.startIndefinite ?? false,
          range.endIndefinite ?? false
        )))
  }
  return new Span()
}

function adjustAnnotationsForInsert(annotations, position, length) {
  return annotations.map(annotation => {
    const span = normalizeSpan(annotation.span)
    let changed = false
    const ranges = span.ranges.map(range => {
      let start = range.start
      let end = range.end
      if (range.start >= position) {
        start += length
        end += length
      } else if (range.end > position) {
        end += length
      }
      if (start !== range.start || end !== range.end) {
        changed = true
        return new Range(start, end, range.orientation, range.startIndefinite, range.endIndefinite)
      }
      return range
    })
    return changed ? { ...annotation, span: new Span(ranges).toJSON() } : annotation
  })
}

function adjustAnnotationsForDelete(annotations, start, end) {
  const deletionLength = end - start
  return annotations.map(annotation => {
    const span = normalizeSpan(annotation.span)
    let changed = false
    const ranges = span.ranges.map(range => {
      let nextStart = range.start
      let nextEnd = range.end

      if (range.end <= start) {
        // Range is before the deleted region.
      } else if (range.start >= end) {
        nextStart -= deletionLength
        nextEnd -= deletionLength
      } else if (range.start <= start && range.end >= end) {
        nextEnd -= deletionLength
      } else if (range.start >= start && range.end <= end) {
        nextStart = start
        nextEnd = start
      } else if (range.start < start && range.end > start && range.end < end) {
        nextEnd = start
      } else if (range.start > start && range.start < end && range.end > end) {
        nextStart = start
        nextEnd -= deletionLength
      }

      if (nextStart !== range.start || nextEnd !== range.end) {
        changed = true
        return new Range(nextStart, nextEnd, range.orientation, range.startIndefinite, range.endIndefinite)
      }
      return range
    })
    return changed ? { ...annotation, span: new Span(ranges).toJSON() } : annotation
  })
}

/**
 * Normalize annotations loaded from IndexedDB.
 * Converts string spans back to Span objects.
 */
function normalizeAnnotations(annotations) {
  return annotations.map(ann => ({
    ...ann,
    span: normalizeSpan(ann.span)
  }))
}

const DB_NAME = 'opengenepool'
const DB_VERSION = 1
const SEQUENCES_STORE = 'sequences'

/**
 * Opens the IndexedDB database, creating object stores if needed.
 *
 * @returns {Promise<IDBDatabase>}
 */
function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)

    request.onupgradeneeded = (event) => {
      const db = event.target.result

      // Create sequences store if it doesn't exist
      if (!db.objectStoreNames.contains(SEQUENCES_STORE)) {
        const store = db.createObjectStore(SEQUENCES_STORE, { keyPath: 'id' })
        store.createIndex('updatedAt', 'updatedAt', { unique: false })
      }
    }
  })
}

/**
 * Gets a sequence from IndexedDB.
 *
 * @param {IDBDatabase} db
 * @param {string} sequenceId
 * @returns {Promise<Object|null>}
 */
function getSequence(db, sequenceId) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([SEQUENCES_STORE], 'readonly')
    const store = transaction.objectStore(SEQUENCES_STORE)
    const request = store.get(sequenceId)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result || null)
  })
}

/**
 * Saves a sequence to IndexedDB.
 *
 * @param {IDBDatabase} db
 * @param {Object} sequence
 * @returns {Promise<void>}
 */
function saveSequence(db, sequence) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([SEQUENCES_STORE], 'readwrite')
    const store = transaction.objectStore(SEQUENCES_STORE)
    const request = store.put({
      ...sequence,
      updatedAt: Date.now()
    })

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve()
  })
}

/**
 * Creates a backend adapter that persists to IndexedDB for offline/standalone use.
 *
 * @param {string} sequenceId - Unique identifier for the sequence
 * @param {Object} options - Optional configuration
 * @param {Function} options.onSyncStatusChange - Called when sync status changes
 * @returns {Object} Backend adapter interface
 */
export function createIndexedDbBackend(sequenceId, options = {}) {
  let db = null
  const { onSyncStatusChange, store } = options

  // Storage seam: defaults to the real IndexedDB-backed functions, but a custom
  // async store ({ get(id), save(seq) }) can be injected (e.g. for tests). When a
  // custom store is provided we skip opening IndexedDB entirely.
  const readSequence = store
    ? () => store.get(sequenceId)
    : async () => { await dbPromise; return getSequence(db, sequenceId) }
  const writeSequence = store
    ? (seq) => store.save(seq)
    : async (seq) => { await dbPromise; return saveSequence(db, seq) }

  // Initialize database connection (only when using the real IndexedDB store).
  const dbPromise = store
    ? Promise.resolve(null)
    : openDatabase().then((database) => { db = database; return db })

  // Serialize operations so concurrent calls don't read the same stale snapshot
  // and overwrite each other (get -> mutate -> put must run atomically per op).
  let queue = Promise.resolve()

  /**
   * Applies an operation and persists it. Operations are queued so they run
   * strictly in order; each one observes the previous one's write. Returns a
   * promise that resolves when THIS operation has persisted and rejects if it
   * failed — so callers can await persistence and observe errors.
   *
   * The internal `queue` is kept non-rejecting (we chain off a swallowed copy)
   * so one failed operation never poisons the ordering of later operations.
   */
  function applyOperation(operationType, data) {
    const result = queue.then(() => runOperation(operationType, data))
    // Advance the ordering chain on a branch that never rejects, so a failure in
    // this op doesn't break the queue for subsequent ops.
    queue = result.catch(() => {})
    return result
  }

  async function runOperation(operationType, data) {
    try {
      // Get current sequence state
      let sequence = await readSequence()

      if (!sequence) {
        // Initialize new sequence if it doesn't exist
        sequence = {
          id: sequenceId,
          content: '',
          title: '',
          annotations: [],
          metadata: {}
        }
      }

      // Apply the operation based on type
      switch (operationType) {
        case 'insert':
          sequence.annotations = adjustAnnotationsForInsert(
            sequence.annotations,
            data.position,
            data.text.length
          )
          sequence.content =
            sequence.content.slice(0, data.position) +
            data.text +
            sequence.content.slice(data.position)
          break

        case 'delete':
          sequence.annotations = adjustAnnotationsForDelete(
            sequence.annotations,
            data.start,
            data.end
          )
          sequence.content =
            sequence.content.slice(0, data.start) +
            sequence.content.slice(data.end)
          break

        case 'annotationCreated': {
          // Extract annotation fields (everything except editId)
          const { editId: _editId1, ...annotation1 } = data
          sequence.annotations = [...sequence.annotations, annotation1]
          break
        }

        case 'annotationUpdate': {
          // Extract annotation fields (everything except editId)
          const { editId: _editId2, ...annotation2 } = data
          sequence.annotations = sequence.annotations.map((ann) =>
            ann.id === annotation2.id ? annotation2 : ann
          )
          break
        }

        case 'annotationDeleted':
          sequence.annotations = sequence.annotations.filter(
            (ann) => ann.id !== data.id
          )
          break

        case 'titleUpdate':
          sequence.title = data.title
          break

        case 'metadataUpdate':
          sequence.metadata = data.metadata
          break
      }

      // Save updated sequence
      await writeSequence(sequence)

      if (onSyncStatusChange) {
        onSyncStatusChange('saved')
      }
    } catch (error) {
      console.error('IndexedDB operation failed:', error)

      if (onSyncStatusChange) {
        onSyncStatusChange('error')
      }
      // Re-throw so the per-operation promise rejects and callers can observe
      // the failure (the ordering queue is insulated from this in applyOperation).
      throw error
    }
  }

  return {
    // Sequence operations. Each returns a promise that resolves once the edit is
    // persisted and rejects if persistence failed.
    insert(data) {
      return applyOperation('insert', data)
    },

    delete(data) {
      return applyOperation('delete', data)
    },

    // Annotation operations
    annotationCreated(data) {
      return applyOperation('annotationCreated', data)
    },

    annotationUpdate(data) {
      return applyOperation('annotationUpdate', data)
    },

    annotationDeleted(data) {
      return applyOperation('annotationDeleted', data)
    },

    // Metadata operations
    titleUpdate(data) {
      return applyOperation('titleUpdate', data)
    },

    metadataUpdate(data) {
      return applyOperation('metadataUpdate', data)
    },

    // Additional methods for standalone mode
    async load() {
      const sequence = await readSequence()
      if (sequence?.annotations) {
        sequence.annotations = normalizeAnnotations(sequence.annotations)
      }
      return sequence
    },

    // Queued so an explicit save can't interleave with in-flight edit operations.
    // Returns a promise reflecting this save; the ordering chain stays non-rejecting.
    save(sequence) {
      const result = queue.then(() => writeSequence({ ...sequence, id: sequenceId }))
      queue = result.catch(() => {})
      return result
    }
  }
}
