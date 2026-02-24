/**
 * IndexedDB Backend Adapter
 *
 * Provides local persistence for standalone/offline editing using IndexedDB.
 * All edit operations are stored locally with the same insert/delete interface
 * as the LiveView backend, enabling offline-first editing.
 */

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
  const { onSyncStatusChange } = options

  // Initialize database connection
  const dbPromise = openDatabase().then((database) => {
    db = database
    return db
  })

  /**
   * Applies an operation and persists to IndexedDB.
   * Calls the ack callback on success, error callback on failure.
   */
  async function applyOperation(operationType, data) {
    try {
      await dbPromise

      // Get current sequence state
      let sequence = await getSequence(db, sequenceId)

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
          sequence.content =
            sequence.content.slice(0, data.position) +
            data.text +
            sequence.content.slice(data.position)
          break

        case 'delete':
          sequence.content =
            sequence.content.slice(0, data.start) +
            sequence.content.slice(data.end)
          break

        case 'annotationCreated':
          sequence.annotations = [...sequence.annotations, data.annotation]
          break

        case 'annotationUpdate':
          sequence.annotations = sequence.annotations.map((ann) =>
            ann.id === data.annotation.id ? data.annotation : ann
          )
          break

        case 'annotationDeleted':
          sequence.annotations = sequence.annotations.filter(
            (ann) => ann.id !== data.annotationId
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
      await saveSequence(db, sequence)

      if (onSyncStatusChange) {
        onSyncStatusChange('saved')
      }
    } catch (error) {
      console.error('IndexedDB operation failed:', error)

      if (onSyncStatusChange) {
        onSyncStatusChange('error')
      }
    }
  }

  return {
    // Sequence operations
    insert(data) {
      applyOperation('insert', data)
    },

    delete(data) {
      applyOperation('delete', data)
    },

    // Annotation operations
    annotationCreated(data) {
      applyOperation('annotationCreated', data)
    },

    annotationUpdate(data) {
      applyOperation('annotationUpdate', data)
    },

    annotationDeleted(data) {
      applyOperation('annotationDeleted', data)
    },

    // Metadata operations
    titleUpdate(data) {
      applyOperation('titleUpdate', data)
    },

    metadataUpdate(data) {
      applyOperation('metadataUpdate', data)
    },

    // Additional methods for standalone mode
    async load() {
      await dbPromise
      return getSequence(db, sequenceId)
    },

    async save(sequence) {
      await dbPromise
      return saveSequence(db, { ...sequence, id: sequenceId })
    }
  }
}
