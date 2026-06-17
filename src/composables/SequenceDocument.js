import { shallowRef, ref, computed } from 'vue'
import { Annotation } from '../utils/annotation.js'
import { Span, Range } from '../utils/dna.js'
import { generateId, generateIdSync } from '../utils/uuid.js'

/**
 * SequenceDocument encapsulates a DNA sequence with its annotations and metadata.
 * It provides reactive state and edit methods, serving as the single source of truth
 * for sequence data in the editor.
 *
 * Usage:
 *   const doc = new SequenceDocument({
 *     sequence: 'ATCGATCG',
 *     annotations: [...],
 *     circular: false
 *   })
 *
 *   // Read reactive state
 *   doc.sequence  // 'ATCGATCG'
 *
 *   // Edit operations
 *   doc.insert(4, 'GGG')  // 'ATCGGGGGATCG'
 *   doc.delete([{ start: 0, end: 3 }])  // 'GGGGGATCG'
 */
export class SequenceDocument {
  /**
   * Create a new SequenceDocument.
   * @param {Object} options
   * @param {string} options.sequence - Initial DNA sequence
   * @param {string} options.name - Display name for the sequence (e.g. GenBank LOCUS name)
   * @param {Array} options.annotations - Initial annotations (plain objects or Annotation instances)
   * @param {boolean} options.circular - Whether the sequence is circular (plasmid)
   * @param {Object} options.backend - Backend adapter for persistence (insert, delete, annotationCreated, etc.)
   * @param {boolean} options.readonly - When true, all mutating methods are no-ops (source-level readonly enforcement)
   */
  constructor({ sequence = '', name = '', annotations = [], circular = false, gaps = [], backend = null, readonly = false } = {}) {
    // Internal reactive refs
    this._sequence = shallowRef(sequence)
    this._name = ref(name)
    this._annotations = ref(this._normalizeAnnotations(annotations))
    this._circular = ref(circular)
    this._gaps = shallowRef(gaps)
    this._backend = backend
    // Source-level readonly: when set, every mutating method returns early before
    // touching state or notifying the backend. This is the single chokepoint that
    // makes `readonly` real regardless of the backend or UI gating.
    this._readonly = !!readonly
  }

  /**
   * Whether this document rejects all mutations.
   * @returns {boolean}
   */
  get readonly() {
    return this._readonly
  }

  /**
   * Normalize annotations, preserving Span objects.
   * @private
   */
  _normalizeAnnotations(annotations) {
    return annotations.map(ann => {
      if (ann instanceof Annotation) {
        // Annotation class already has proper structure with Span object
        return {
          id: ann.id,
          caption: ann.caption,
          type: ann.type,
          span: ann.span,  // Keep Span object
          attributes: ann.attributes || {}
        }
      }
      const span = this._requireSpan(ann.span)
      return {
        // Sync guarded fallback for bulk/load paths (constructor, setAnnotations).
        // New annotations created via addAnnotation get their id from the async
        // (overridable) generator before reaching here.
        id: ann.id || generateIdSync(),
        caption: ann.caption || '',
        type: ann.type || 'misc_feature',
        span,
        attributes: ann.attributes || {}
      }
    })
  }

  /**
   * Normalize a span-like value to a Span object.
   * This is only used at input boundaries so internal state stays object-backed.
   * @private
   * @param {string|Span|{ranges?: Array}|undefined|null} span
   * @returns {Span}
   */
  _requireSpan(span) {
    if (span instanceof Span) return span
    if (span?.ranges) return new Span(span.ranges)
    if (span == null) return new Span()
    // Accept the fenced-string form that toJSON() emits, so toJSON/fromJSON
    // round-trips and any caller can pass the serialized span back in.
    if (typeof span === 'string') return Span.parse(span)
    throw new TypeError('SequenceDocument requires annotation spans to be Span objects')
  }

  // ============================================
  // Reactive Getters
  // ============================================

  /**
   * The DNA sequence string.
   * @returns {string}
   */
  get sequence() {
    return this._sequence.value
  }

  /**
   * The display name for the sequence (e.g. GenBank LOCUS name).
   * @returns {string}
   */
  get name() {
    return this._name.value
  }

  /**
   * The reactive sequence ref for Vue computed dependencies.
   * Use this when you need Vue to track sequence changes in a computed.
   * For most cases, use the `sequence` getter instead.
   * @returns {ShallowRef<string>}
   */
  get sequenceRef() {
    return this._sequence
  }

  /**
   * Array of annotation objects.
   * @returns {Array}
   */
  get annotations() {
    return this._annotations.value
  }

  /**
   * Whether the sequence is circular (plasmid).
   * @returns {boolean}
   */
  get circular() {
    return this._circular.value
  }

  /**
   * Gap information for alignment display.
   * @returns {Array<{position: number, length: number}>}
   */
  get gaps() {
    return this._gaps.value
  }

  /**
   * Length of the sequence.
   * @returns {number}
   */
  get length() {
    return this._sequence.value.length
  }

  // ============================================
  // Sequence Edit Methods
  // ============================================

  /**
   * Insert text at a position.
   * @param {number} position - 0-based position to insert at
   * @param {string} text - DNA sequence to insert
   * @param {Object} options - Optional settings
   * @param {Array<string>} options.extendStartIds - Annotation IDs to extend at their start boundary
   * @param {Array<string>} options.extendEndIds - Annotation IDs to extend at their end boundary
   * @returns {string} The inserted text
   */
  insert(position, text, { extendStartIds = [], extendEndIds = [] } = {}) {
    if (this._readonly) return ''
    const seq = this._sequence.value
    position = Math.max(0, Math.min(position, seq.length))

    // 1. Mutate sequence
    this._sequence.value = seq.slice(0, position) + text + seq.slice(position)

    // 2. Adjust annotations
    this._adjustAnnotationsForInsert(position, text.length, extendStartIds, extendEndIds)

    // 3. Notify backend
    this._backend?.insert?.({ editId: generateIdSync(), position, text })

    return text
  }

  /**
   * Delete ranges from the sequence.
   * Ranges are processed from highest to lowest position to avoid shifting issues.
   * @param {Array<{start: number, end: number}>} ranges - Fenced coordinate ranges to delete
   * @returns {string} The concatenated deleted text
   */
  delete(ranges) {
    if (this._readonly) return ''
    if (!ranges || ranges.length === 0) return ''

    // Sort by start position descending (delete from end first)
    const sortedRanges = [...ranges].sort((a, b) => b.start - a.start)
    let deleted = ''
    let seq = this._sequence.value

    for (const range of sortedRanges) {
      const start = Math.max(0, range.start)
      const end = Math.min(seq.length, range.end)
      if (start < end) {
        deleted = seq.slice(start, end) + deleted  // Prepend to maintain order
        seq = seq.slice(0, start) + seq.slice(end)

        // Adjust annotations for this deletion (treat as replace with 0-length)
        this._adjustAnnotationsForReplace(start, end, 0)

        // Notify backend
        this._backend?.delete?.({ editId: generateIdSync(), start, end })
      }
    }

    this._sequence.value = seq
    return deleted
  }

  /**
   * Replace a range with new text.
   * @param {number} start - Start of range to replace
   * @param {number} end - End of range to replace
   * @param {string} text - Replacement text
   * @param {Object} options - Optional settings
   * @param {boolean} options.adjustAnnotations - Whether to adjust annotations (default: true)
   * @returns {string} The deleted text
   */
  replace(start, end, text, { adjustAnnotations = true } = {}) {
    if (this._readonly) return ''
    const seq = this._sequence.value
    start = Math.max(0, start)
    end = Math.min(seq.length, end)
    const deleted = seq.slice(start, end)

    // 1. Mutate sequence
    this._sequence.value = seq.slice(0, start) + text + seq.slice(end)

    // 2. Adjust annotations (unless disabled, e.g., for annotation-preserving operations)
    if (adjustAnnotations) {
      this._adjustAnnotationsForReplace(start, end, text.length)
    }

    // 3. Notify backend (delete + insert)
    if (this._backend) {
      this._backend.delete?.({ editId: generateIdSync(), start, end })
      this._backend.insert?.({ editId: generateIdSync(), position: start, text })
    }

    return deleted
  }

  /**
   * Set the circular property.
   * @param {boolean} circular
   */
  setCircular(circular) {
    if (this._readonly) return
    this._circular.value = !!circular
  }

  /**
   * Set the gaps array.
   * @param {Array<{position: number, length: number}>} gaps
   */
  setGaps(gaps) {
    if (this._readonly) return
    this._gaps.value = gaps
  }

  /**
   * Clear all gaps (sets to empty array).
   */
  clearGaps() {
    if (this._readonly) return
    this._gaps.value = []
  }

  // ============================================
  // Annotation Methods
  // ============================================

  /**
   * Replace all annotations with a new array.
   * @param {Array} annotations - New annotations array
   */
  setAnnotations(annotations) {
    if (this._readonly) return
    this._annotations.value = this._normalizeAnnotations(annotations)
  }

  /**
   * Add an annotation.
   *
   * Async: a NEW annotation (no id supplied) gets its id from the overridable id
   * generator, which may do an async round-trip (e.g. server-synchronized UUIDv7).
   * @param {Object|Annotation} annotation - Annotation to add
   * @returns {Promise<string>} The ID of the added annotation
   */
  async addAnnotation(annotation) {
    if (this._readonly) return null
    // Mint a new id up front (awaited) when the caller didn't supply one, so the
    // constructor/normalize path never needs to be async.
    const withId = annotation.id ? annotation : { ...annotation, id: await generateId() }

    const normalized = this._normalizeAnnotations([withId])[0]
    this._annotations.value = [...this._annotations.value, normalized]

    // Notify backend (include edit id for acknowledgment round-trip)
    const editId = `create-${generateIdSync()}`
    this._backend?.annotationCreated?.({ ...normalized, editId })

    return normalized.id
  }

  /**
   * Update an existing annotation.
   * @param {Object} annotation - Annotation with id and fields to update
   * @returns {boolean} True if annotation was found and updated
   */
  updateAnnotation(annotation) {
    if (this._readonly) return false
    const index = this._annotations.value.findIndex(a => a.id === annotation.id)
    if (index === -1) return false

    const updated = { ...this._annotations.value[index], ...annotation }
    // Normalize span if it was updated so in-memory state always uses Span objects.
    if (annotation.span !== undefined) {
      updated.span = this._requireSpan(annotation.span)
    }

    const newAnnotations = [...this._annotations.value]
    newAnnotations[index] = updated
    this._annotations.value = newAnnotations

    // Notify backend (include edit id for acknowledgment round-trip)
    const editId = `update-${generateIdSync()}`
    this._backend?.annotationUpdate?.({ ...updated, editId })

    return true
  }

  /**
   * Delete an annotation by ID.
   * @param {string} id - Annotation ID to delete
   * @returns {boolean} True if annotation was found and deleted
   */
  deleteAnnotation(id) {
    if (this._readonly) return false
    const index = this._annotations.value.findIndex(a => a.id === id)
    if (index === -1) return false

    this._annotations.value = this._annotations.value.filter(a => a.id !== id)

    // Notify backend (include edit id for acknowledgment round-trip)
    const editId = `del-${generateIdSync()}`
    this._backend?.annotationDeleted?.({ editId, id })

    return true
  }

  /**
   * Get an annotation by ID.
   * @param {string} id - Annotation ID
   * @returns {Object|undefined} The annotation or undefined
   */
  getAnnotation(id) {
    return this._annotations.value.find(a => a.id === id)
  }

  // ============================================
  // Private Annotation Adjustment Methods
  // ============================================

  /**
   * Adjust annotations for a pure insertion at a position.
   *
   * Algorithm (disciplined inserts):
   * - By default, annotations touching the insertion point do NOT auto-extend
   * - Annotations starting at site: shift both start and end (insert goes before)
   * - Annotations ending at site: no change (insert goes after)
   * - extendStartIds: annotations to extend at their start (keep start, shift end)
   * - extendEndIds: annotations to extend at their end (shift end to include insert)
   *
   * @private
   * @param {number} insertionSite - The position where insertion occurred
   * @param {number} insertionLength - The length of the inserted sequence
   * @param {Array<string>} extendStartIds - IDs of annotations to extend at their start boundary
   * @param {Array<string>} extendEndIds - IDs of annotations to extend at their end boundary
   */
  _adjustAnnotationsForInsert(insertionSite, insertionLength, extendStartIds = [], extendEndIds = []) {
    if (this._annotations.value.length === 0) return

    const updatedAnnotations = this._annotations.value.map(ann => {
      const span = ann.span
      let modified = false
      const shouldExtendStart = extendStartIds.includes(ann.id)
      const shouldExtendEnd = extendEndIds.includes(ann.id)

      // Build a NEW ranges array (no in-place mutation of the original span/ranges,
      // which external holders may still reference). Unchanged ranges are reused.
      const newRanges = span.ranges.map(range => {
        let newStart = range.start
        let newEnd = range.end

        // Annotation starts at insertion site
        if (range.start === insertionSite) {
          if (shouldExtendStart) {
            // Keep start, shift end -> expands to include insert
            newEnd += insertionLength
          } else {
            // Shift both -> insert goes before annotation
            newStart += insertionLength
            newEnd += insertionLength
          }
        }
        // Annotation ends at insertion site
        else if (range.end === insertionSite) {
          if (shouldExtendEnd) {
            // Shift end -> expands to include insert
            newEnd += insertionLength
          }
          // else: no change (insert goes after annotation)
        }
        // Standard cases (not touching insertion site)
        else if (range.start > insertionSite) {
          newStart += insertionLength
          newEnd += insertionLength
        } else if (range.end > insertionSite) {
          newEnd += insertionLength
        }

        if (newStart !== range.start || newEnd !== range.end) {
          modified = true
          return new Range(newStart, newEnd, range.orientation, range.startIndefinite, range.endIndefinite)
        }
        return range
      })

      if (modified) {
        return { ...ann, span: new Span(newRanges) }
      }
      return ann
    })

    this._annotations.value = updatedAnnotations
  }

  /**
   * Adjust annotations for a replacement (delete + insert).
   *
   * @private
   * @param {number} selStart - Start of the replaced range
   * @param {number} selEnd - End of the replaced range
   * @param {number} insertionLength - Length of the replacement text
   */
  _adjustAnnotationsForReplace(selStart, selEnd, insertionLength) {
    if (this._annotations.value.length === 0) return

    const deletionLength = selEnd - selStart
    const netChange = insertionLength - deletionLength

    const updatedAnnotations = this._annotations.value.map(ann => {
      const span = ann.span
      let modified = false

      // Build a NEW ranges array (no in-place mutation; unchanged ranges reused).
      const newRanges = span.ranges.map(range => {
        let newStart = range.start
        let newEnd = range.end

        // Entirely before selection - no change
        if (range.end <= selStart) {
          // No change
        }
        // Entirely after selection - shift by net change
        else if (range.start >= selEnd) {
          newStart = range.start + netChange
          newEnd = range.end + netChange
        }
        // Contains selection (annotation spans across replaced region)
        else if (range.start <= selStart && range.end >= selEnd) {
          newEnd = range.end + netChange
        }
        // Contained by selection (annotation is within replaced region)
        else if (range.start >= selStart && range.end <= selEnd) {
          newStart = selStart
          newEnd = selStart
        }
        // Overlaps left (starts before, ends inside selection)
        else if (range.start < selStart && range.end > selStart && range.end < selEnd) {
          newEnd = selStart
        }
        // Overlaps right (starts inside selection, ends after)
        else if (range.start > selStart && range.start < selEnd && range.end > selEnd) {
          newStart = selStart + insertionLength
          newEnd = range.end + netChange
        }

        if (newStart !== range.start || newEnd !== range.end) {
          modified = true
          return new Range(newStart, newEnd, range.orientation, range.startIndefinite, range.endIndefinite)
        }
        return range
      })

      if (modified) {
        return { ...ann, span: new Span(newRanges) }
      }
      return ann
    })

    this._annotations.value = updatedAnnotations
  }

  // ============================================
  // Serialization
  // ============================================

  /**
   * Export to a plain object (for JSON serialization).
   * @returns {Object}
   */
  toJSON() {
    return {
      sequence: this._sequence.value,
      name: this._name.value,
      annotations: this._annotations.value.map(annotation => ({
        ...annotation,
        span: annotation.span?.toJSON?.() ?? annotation.span
      })),
      circular: this._circular.value,
      gaps: this._gaps.value,
      readonly: this._readonly
    }
  }

  /**
   * Create a SequenceDocument from a plain object.
   * @param {Object} data
   * @returns {SequenceDocument}
   */
  static fromJSON(data) {
    return new SequenceDocument({
      sequence: data.sequence || '',
      name: data.name || '',
      annotations: data.annotations || [],
      circular: data.circular || false,
      gaps: data.gaps || [],
      readonly: data.readonly || false
    })
  }
}
