import { computed, shallowRef } from 'vue'
import { Span, Range, reverseComplement } from '../utils/dna.js'

/**
 * A reverse-complement *view* of a backing SequenceDocument.
 *
 * Presents the same public API as SequenceDocument, but everything is reflected
 * onto the antisense strand: reads come out reverse-complemented (sequence and
 * annotations), and writes (insert/delete/replace, annotation CRUD) are
 * translated back into the underlying document's coordinate frame. This lets the
 * alignment editor treat a query that matched on the antisense strand exactly
 * like a forward query — the orientation lives entirely in this one object
 * instead of being threaded through every consumer.
 *
 * Coordinates are fenced 0-based half-open. For a length-N sequence a forward
 * range [s, e) reflects to [N-e, N-s) and the strand inverts (PLUS<->MINUS, NONE
 * unchanged). A wrapped position p corresponds to inner insertion site N-p and
 * to true base index N-1-p. N is read per-call because edits change the length.
 */
export class SequenceDocumentRC {
  constructor(inner) {
    this._inner = inner
    // Gaps are an alignment-display artifact the editor computes in wrapped
    // (display) coordinates; the wrapper owns them rather than round-tripping
    // through the inner doc.
    this._gaps = shallowRef([])
    // Ref-shaped, reactive to the inner sequence shallowRef.
    this._sequenceRef = computed(() => reverseComplement(this._inner.sequenceRef.value))
  }

  // --- RC coordinate primitives ------------------------------------------

  _rcRange(range, n) {
    return new Range(
      n - range.end,
      n - range.start,
      // Orientation is +1 / -1 / 0; negation flips the strand. `+ 0` normalizes
      // -0 (from negating NONE) back to 0.
      -range.orientation + 0,
      // The 5' indefinite marker of the forward range becomes the 3' marker of
      // the reflected range, and vice versa.
      range.endIndefinite,
      range.startIndefinite
    )
  }

  _rcSpan(span, n) {
    return new Span(span.ranges.map(r => this._rcRange(r, n)))
  }

  /**
   * Reflect an annotation's span (RC is its own inverse, so this maps both
   * wrapped->inner and inner->wrapped). A null/absent span is left untouched so
   * partial updates (e.g. caption-only) pass through cleanly.
   */
  _rcAnnotation(ann, n) {
    if (!ann || !ann.span || !ann.span.ranges) return ann
    return { ...ann, span: this._rcSpan(ann.span, n) }
  }

  // --- Reads (reverse-complemented) --------------------------------------

  get sequence() {
    return this._sequenceRef.value
  }

  get sequenceRef() {
    return this._sequenceRef
  }

  get name() {
    return this._inner.name
  }

  get circular() {
    return this._inner.circular
  }

  get length() {
    return this._inner.length
  }

  get readonly() {
    return this._inner.readonly
  }

  get gaps() {
    return this._gaps.value
  }

  get annotations() {
    const n = this._inner.length
    return this._inner.annotations.map(a => this._rcAnnotation(a, n))
  }

  getAnnotation(id) {
    const a = this._inner.getAnnotation(id)
    return a ? this._rcAnnotation(a, this._inner.length) : a
  }

  /** True underlying base index for a wrapped (display) position. */
  coordinateLabel(p) {
    return this._inner.length - 1 - p
  }

  // --- Writes (translated to the inner document) -------------------------

  insert(position, text, { extendStartIds = [], extendEndIds = [] } = {}) {
    const n = this._inner.length
    // Extending the START of a reflected annotation extends the END of the
    // underlying one, so the id sets swap.
    this._inner.insert(n - position, reverseComplement(text), {
      extendStartIds: extendEndIds,
      extendEndIds: extendStartIds
    })
    return text
  }

  delete(ranges) {
    const n = this._inner.length
    const innerRanges = ranges.map(r => ({ start: n - r.end, end: n - r.start }))
    const innerDeleted = this._inner.delete(innerRanges)
    return reverseComplement(innerDeleted)
  }

  replace(start, end, text, options = {}) {
    const n = this._inner.length
    const innerDeleted = this._inner.replace(n - end, n - start, reverseComplement(text), options)
    return reverseComplement(innerDeleted)
  }

  setCircular(circular) {
    this._inner.setCircular(circular)
  }

  setGaps(gaps) {
    this._gaps.value = gaps
  }

  clearGaps() {
    this._gaps.value = []
  }

  setAnnotations(annotations) {
    const n = this._inner.length
    this._inner.setAnnotations(annotations.map(a => this._rcAnnotation(a, n)))
  }

  addAnnotation(annotation) {
    return this._inner.addAnnotation(this._rcAnnotation(annotation, this._inner.length))
  }

  updateAnnotation(annotation) {
    return this._inner.updateAnnotation(this._rcAnnotation(annotation, this._inner.length))
  }

  deleteAnnotation(id) {
    return this._inner.deleteAnnotation(id)
  }

  toJSON() {
    return this._inner.toJSON()
  }
}
