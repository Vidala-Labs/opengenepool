import { shallowRef, ref, computed } from 'vue'
import { Annotation } from '../utils/annotation.js'
import { Span, Range } from '../utils/dna.js'

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
   * @param {Array} options.annotations - Initial annotations (plain objects or Annotation instances)
   * @param {boolean} options.circular - Whether the sequence is circular (plasmid)
   * @param {Object} options.backend - Backend adapter for persistence (insert, delete, annotationCreated, etc.)
   */
  constructor({ sequence = '', annotations = [], circular = false, backend = null } = {}) {
    // Internal reactive refs
    this._sequence = shallowRef(sequence)
    this._annotations = ref(this._normalizeAnnotations(annotations))
    this._circular = ref(circular)
    this._backend = backend
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
      // For plain objects, parse string spans into Span objects
      const span = typeof ann.span === 'string' ? Span.parse(ann.span) : (ann.span || Span.parse('0..0'))
      return {
        id: ann.id || crypto.randomUUID(),
        caption: ann.caption || '',
        type: ann.type || 'misc_feature',
        span,
        attributes: ann.attributes || {}
      }
    })
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
    const seq = this._sequence.value
    position = Math.max(0, Math.min(position, seq.length))

    // 1. Mutate sequence
    this._sequence.value = seq.slice(0, position) + text + seq.slice(position)

    // 2. Adjust annotations
    this._adjustAnnotationsForInsert(position, text.length, extendStartIds, extendEndIds)

    // 3. Notify backend
    this._backend?.insert?.({ id: crypto.randomUUID(), position, text })

    return text
  }

  /**
   * Delete ranges from the sequence.
   * Ranges are processed from highest to lowest position to avoid shifting issues.
   * @param {Array<{start: number, end: number}>} ranges - Fenced coordinate ranges to delete
   * @returns {string} The concatenated deleted text
   */
  delete(ranges) {
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
        this._backend?.delete?.({ id: crypto.randomUUID(), start, end })
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
      this._backend.delete?.({ id: crypto.randomUUID(), start, end })
      this._backend.insert?.({ id: crypto.randomUUID(), position: start, text })
    }

    return deleted
  }

  /**
   * Set the circular property.
   * @param {boolean} circular
   */
  setCircular(circular) {
    this._circular.value = !!circular
  }

  // ============================================
  // Annotation Methods
  // ============================================

  /**
   * Replace all annotations with a new array.
   * @param {Array} annotations - New annotations array
   */
  setAnnotations(annotations) {
    this._annotations.value = this._normalizeAnnotations(annotations)
  }

  /**
   * Add an annotation.
   * @param {Object|Annotation} annotation - Annotation to add
   * @returns {string} The ID of the added annotation
   */
  addAnnotation(annotation) {
    const normalized = this._normalizeAnnotations([annotation])[0]
    this._annotations.value = [...this._annotations.value, normalized]

    // Notify backend
    this._backend?.annotationCreated?.(normalized)

    return normalized.id
  }

  /**
   * Update an existing annotation.
   * @param {Object} annotation - Annotation with id and fields to update
   * @returns {boolean} True if annotation was found and updated
   */
  updateAnnotation(annotation) {
    const index = this._annotations.value.findIndex(a => a.id === annotation.id)
    if (index === -1) return false

    const updated = { ...this._annotations.value[index], ...annotation }
    // Normalize span if it was updated
    if (annotation.span && typeof annotation.span !== 'string') {
      updated.span = annotation.span.toString?.() || updated.span
    }

    const newAnnotations = [...this._annotations.value]
    newAnnotations[index] = updated
    this._annotations.value = newAnnotations

    // Notify backend (include annotationId for backend protocol)
    this._backend?.annotationUpdate?.({ ...updated, annotationId: updated.id })

    return true
  }

  /**
   * Delete an annotation by ID.
   * @param {string} id - Annotation ID to delete
   * @returns {boolean} True if annotation was found and deleted
   */
  deleteAnnotation(id) {
    const index = this._annotations.value.findIndex(a => a.id === id)
    if (index === -1) return false

    this._annotations.value = this._annotations.value.filter(a => a.id !== id)

    // Notify backend
    this._backend?.annotationDeleted?.({ annotationId: id })

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
      const span = ann.span instanceof Span ? ann.span : Span.parse(ann.span)
      let modified = false
      const shouldExtendStart = extendStartIds.includes(ann.id)
      const shouldExtendEnd = extendEndIds.includes(ann.id)

      for (let i = 0; i < span.ranges.length; i++) {
        const range = span.ranges[i]
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
          span.ranges[i] = new Range(newStart, newEnd, range.orientation)
          modified = true
        }
      }

      if (modified) {
        return { ...ann, span: span.toString() }
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
      const span = ann.span instanceof Span ? ann.span : Span.parse(ann.span)
      let modified = false

      for (let i = 0; i < span.ranges.length; i++) {
        const range = span.ranges[i]
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
          span.ranges[i] = new Range(newStart, newEnd, range.orientation)
          modified = true
        }
      }

      if (modified) {
        return { ...ann, span: span.toString() }
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
      annotations: this._annotations.value,
      circular: this._circular.value
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
      annotations: data.annotations || [],
      circular: data.circular || false
    })
  }
}
