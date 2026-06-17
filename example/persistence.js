/**
 * Demo persistence helpers.
 *
 * The demo edits a live SequenceDocument (insert/delete/replace mutate it in
 * place). To persist those edits to IndexedDB and to export the *current* bases,
 * we must read from the LIVE document, not from the stale `currentSequenceData`
 * record that was loaded at selection time.
 *
 * `snapshotDoc` builds a plain, persistable/exportable record from the live
 * document, carrying over the unrelated record fields (id, name, metadata, …)
 * from `currentSequenceData`.
 */

/**
 * Build a plain record reflecting the LIVE document's current state.
 *
 * @param {Object} currentSequenceData - the loaded record (id, name, metadata, …)
 * @param {Object} liveDoc - the live SequenceDocument (has .sequence, .annotations, .circular)
 * @returns {Object|null} a deep-cloned plain record with up-to-date sequence/annotations,
 *   or null if either input is missing.
 */
export function snapshotDoc(currentSequenceData, liveDoc) {
  if (!currentSequenceData || !liveDoc) return null

  const record = {
    ...currentSequenceData,
    sequence: liveDoc.sequence,
    annotations: liveDoc.annotations,
    metadata: { ...(currentSequenceData.metadata || {}), circular: liveDoc.circular }
  }

  // Deep clone to strip Vue proxies / Span class instances before persistence.
  return JSON.parse(JSON.stringify(record))
}
