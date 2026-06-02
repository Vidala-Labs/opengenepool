/**
 * Smith-Waterman Local Pairwise Alignment
 *
 * This module provides alignment using:
 * - WASM (Zig) banded alignment by default when available
 * - JavaScript banded alignment for circular origin-offset handling
 * - Linear-space fallback for unsafe bands
 *
 * The linear-space implementation uses Hirschberg-style divide-and-conquer
 * to reduce space complexity from O(m×n) to O(n), preventing OOM crashes
 * on mobile devices.
 */

import { Range, Span } from './dna.js'
import { Annotation } from './annotation.js'

// Re-export scoreMatch from the JS implementation
export { scoreMatch } from './alignment-js.js'

// Import the JS fallback implementation
import { align as alignJS, scoreMatch } from './alignment-js.js'

// WASM module state
let wasmModule = null
let wasmLoading = null
let wasmFailed = false
const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()
const WASM_RESULT_HEADER_SIZE = 40
const WASM_STATUS_OK = 0
const WASM_STATUS_BAND_UNSAFE = 2

/**
 * Load the WASM module for alignment.
 * Call this during component initialization for best performance.
 * Returns a promise that resolves when WASM is ready (or fails gracefully).
 */
export async function loadWasm() {
  if (wasmModule) return true
  if (wasmFailed) return false
  if (wasmLoading) return wasmLoading

  wasmLoading = (async () => {
    try {
      // Dynamic import of the WASM module
      const wasmUrl = new URL('./alignment.wasm', import.meta.url)
      const response = await fetch(wasmUrl)
      if (!response.ok) {
        throw new Error(`Failed to fetch WASM: ${response.status}`)
      }
      const wasmBytes = await response.arrayBuffer()
      const { instance } = await WebAssembly.instantiate(wasmBytes, {
        env: {
          // Any imports the WASM module needs
        }
      })
      wasmModule = instance.exports
      return true
    } catch (e) {
      console.warn('WASM alignment module failed to load, using JS fallback:', e.message)
      wasmFailed = true
      return false
    }
  })()

  return wasmLoading
}

/**
 * Check if WASM is available and loaded.
 */
export function isWasmReady() {
  return wasmModule !== null
}

/**
 * @typedef {Object} AlignmentResult
 * @property {number} score - Alignment score
 * @property {number} queryStart - Start position in query (0-based, inclusive)
 * @property {number} queryEnd - End position in query (0-based, exclusive)
 * @property {number} targetStart - Start position in target (0-based, inclusive)
 * @property {number} targetEnd - End position in target (0-based, exclusive)
 * @property {string} queryAligned - Query sequence with gaps ('-')
 * @property {string} targetAligned - Target sequence with gaps ('-')
 * @property {number} identity - Percent identity (0-100)
 */

/**
 * Perform Smith-Waterman local alignment.
 * Uses the WASM banded fast path by default when available. Explicit
 * `mode: 'linear'` uses WASM linear alignment when available. Circular target
 * origin offset handling uses WASM when the circular export is available.
 *
 * @param {string} query - Query sequence
 * @param {string} target - Target sequence
 * @param {Object} [options] - Scoring options
 * @param {number} [options.match=2] - Match score
 * @param {number} [options.mismatch=-1] - Mismatch penalty
 * @param {number} [options.gapOpen=-3] - Gap opening penalty
 * @param {number} [options.gapExtend=-1] - Gap extension penalty
 * @returns {AlignmentResult}
 */
export function align(query, target, options = {}) {
  if (wasmModule) {
    if (options.circular || options.circularTarget) {
      const result = alignWasmCircular(query, target, options)
      if (result) {
        return result
      }

      return alignJS(query, target, options)
    }

    if (options.mode === 'linear') {
      return alignWasmLinear(query, target, options) || alignJS(query, target, options)
    }

    const result = alignWasmBanded(query, target, options)
    if (result) {
      return result
    }

    return alignWasmLinear(query, target, options) || alignJS(query, target, options)
  }

  // Fall back to JavaScript implementation
  return alignJS(query, target, options)
}

/**
 * Perform linear alignment using WASM module.
 */
function alignWasmLinear(query, target, options) {
  const {
    match = 2,
    mismatch = -1,
    gapOpen = -3,
    gapExtend = -1
  } = options

  return callWasmAlignmentInto(query, target, (ptrs) =>
    wasmModule.alignSequencesInto(
      ptrs.queryPtr, ptrs.queryLen,
      ptrs.targetPtr, ptrs.targetLen,
      ptrs.queryOutPtr, ptrs.targetOutPtr,
      ptrs.outCapacity,
      ptrs.resultPtr,
      match, mismatch, gapOpen, gapExtend
    )
  )
}

/**
 * Perform banded alignment using WASM module.
 */
function alignWasmBanded(query, target, options) {
  if (typeof wasmModule.alignSequencesBandedInto !== 'function') {
    return null
  }

  const {
    match = 2,
    mismatch = -1,
    gapOpen = -3,
    gapExtend = -1,
    bandWidth = 128
  } = options

  if (bandWidth <= 0) {
    return null
  }

  const callResult = callWasmAlignmentInto(query, target, (ptrs) =>
    wasmModule.alignSequencesBandedInto(
      ptrs.queryPtr, ptrs.queryLen,
      ptrs.targetPtr, ptrs.targetLen,
      ptrs.queryOutPtr, ptrs.targetOutPtr,
      ptrs.outCapacity,
      ptrs.resultPtr,
      match, mismatch, gapOpen, gapExtend,
      bandWidth
    )
  )

  if (callResult?.status === WASM_STATUS_BAND_UNSAFE) {
    return null
  }

  return callResult
}

/**
 * Perform circular target alignment using WASM module.
 */
function alignWasmCircular(query, target, options) {
  if (typeof wasmModule.alignSequencesBandedCircularInto !== 'function') {
    return null
  }

  const {
    match = 2,
    mismatch = -1,
    gapOpen = -3,
    gapExtend = -1,
    bandWidth = 128,
    originKmerSize = 15,
    originMinVotes = 3
  } = options

  return callWasmAlignmentInto(query, target, (ptrs) =>
    wasmModule.alignSequencesBandedCircularInto(
      ptrs.queryPtr, ptrs.queryLen,
      ptrs.targetPtr, ptrs.targetLen,
      ptrs.queryOutPtr, ptrs.targetOutPtr,
      ptrs.outCapacity,
      ptrs.resultPtr,
      match, mismatch, gapOpen, gapExtend,
      bandWidth,
      originKmerSize,
      originMinVotes
    )
  )
}

/**
 * Run a WASM alignment export that writes into caller-owned output buffers.
 */
function callWasmAlignmentInto(query, target, invoke) {
  wasmModule.reset()

  const queryBytes = textEncoder.encode(query)
  const targetBytes = textEncoder.encode(target)
  const outCapacity = queryBytes.length + targetBytes.length

  const queryPtr = wasmModule.alloc(queryBytes.length)
  const targetPtr = wasmModule.alloc(targetBytes.length)
  const queryOutPtr = wasmModule.alloc(outCapacity)
  const targetOutPtr = wasmModule.alloc(outCapacity)
  const resultPtr = wasmModule.alloc(WASM_RESULT_HEADER_SIZE)

  const memory = new Uint8Array(wasmModule.memory.buffer)
  memory.set(queryBytes, queryPtr)
  memory.set(targetBytes, targetPtr)

  const status = invoke({
    queryPtr,
    queryLen: queryBytes.length,
    targetPtr,
    targetLen: targetBytes.length,
    queryOutPtr,
    targetOutPtr,
    outCapacity,
    resultPtr
  })

  if (status !== WASM_STATUS_OK) {
    wasmModule.free(queryPtr)
    wasmModule.free(targetPtr)
    wasmModule.free(queryOutPtr)
    wasmModule.free(targetOutPtr)
    wasmModule.free(resultPtr)

    return { status }
  }

  const result = readAlignmentResultHeader(resultPtr, queryOutPtr, targetOutPtr)

  wasmModule.free(queryPtr)
  wasmModule.free(targetPtr)
  wasmModule.free(queryOutPtr)
  wasmModule.free(targetOutPtr)
  wasmModule.free(resultPtr)

  return result
}

/**
 * Read scalar alignment metadata and caller-owned output buffers.
 */
function readAlignmentResultHeader(ptr, queryOutPtr, targetOutPtr) {
  const memory = new Uint8Array(wasmModule.memory.buffer)
  const view = new DataView(wasmModule.memory.buffer)

  // Result structure layout:
  // i32 score              (offset 0)
  // i32 queryStart         (offset 4)
  // i32 queryEnd           (offset 8)
  // i32 targetStart        (offset 12)
  // i32 targetEnd          (offset 16)
  // i32 queryAlignedLen    (offset 20)
  // i32 targetAlignedLen   (offset 24)
  // u32 targetOriginOffset (offset 28)
  // f64 identity           (offset 32)

  let offset = ptr
  const score = view.getInt32(offset, true); offset += 4
  const queryStart = view.getInt32(offset, true); offset += 4
  const queryEnd = view.getInt32(offset, true); offset += 4
  const targetStart = view.getInt32(offset, true); offset += 4
  const targetEnd = view.getInt32(offset, true); offset += 4
  const queryAlignedLen = view.getInt32(offset, true); offset += 4
  const targetAlignedLen = view.getInt32(offset, true); offset += 4
  const targetOriginOffset = view.getInt32(offset, true); offset += 4
  const identity = view.getFloat64(offset, true)

  const queryAligned = textDecoder.decode(memory.subarray(queryOutPtr, queryOutPtr + queryAlignedLen))
  const targetAligned = textDecoder.decode(memory.subarray(targetOutPtr, targetOutPtr + targetAlignedLen))

  const result = {
    score,
    queryStart,
    queryEnd,
    targetStart,
    targetEnd,
    queryAligned,
    targetAligned,
    identity
  }

  if (targetOriginOffset !== 0) {
    result.targetOriginOffset = targetOriginOffset
  }

  return result
}

/**
 * Build a coordinate map from aligned sequence back to alignment positions.
 *
 * This creates an array where index is the original sequence position
 * and value is the position in the aligned string.
 *
 * @param {string} alignedSequence - Sequence with gaps ('-')
 * @param {number} originalStart - Start position in original sequence
 * @returns {number[]} Map from original position to aligned position
 */
export function buildCoordinateMap(alignedSequence, originalStart) {
  const map = []
  let alignedPos = 0

  for (let i = 0; i < alignedSequence.length; i++) {
    if (alignedSequence[i] !== '-') {
      map.push(i)
    }
  }

  // Adjust indices to be relative to the aligned string positions
  // The returned map[i] gives the aligned position for original position (originalStart + i)
  return map
}

/**
 * Map an original sequence coordinate to an aligned sequence position.
 *
 * @param {number} originalPos - Position in original sequence (0-based)
 * @param {number[]} coordinateMap - Map built by buildCoordinateMap
 * @param {number} [originalStart=0] - Start position used when building the map
 * @returns {number|null} Position in aligned sequence, or null if out of range
 */
export function mapCoordinate(originalPos, coordinateMap, originalStart = 0) {
  const index = originalPos - originalStart

  if (index < 0 || index >= coordinateMap.length) {
    return null
  }

  return coordinateMap[index]
}

/**
 * Normalize a virtual coordinate into a physical circular sequence coordinate.
 *
 * @param {number} position - Virtual position
 * @param {number} sequenceLength - Physical sequence length
 * @returns {number} Physical position in [0, sequenceLength)
 */
export function normalizeCircularPosition(position, sequenceLength) {
  if (!sequenceLength) return position
  return ((position % sequenceLength) + sequenceLength) % sequenceLength
}

function mapVirtualPosition(position, options = {}) {
  if (!options.circular) return position
  return normalizeCircularPosition(position, options.sequenceLength)
}

/**
 * Build a coordinate map from aligned string index to original sequence position.
 *
 * Gap columns are represented as null. Circular mappings expose physical
 * modulo coordinates while preserving the aligned string order.
 *
 * @param {string} alignedSequence - Sequence with gaps ('-')
 * @param {number} originalStart - Start position in original/virtual sequence
 * @param {Object} [options]
 * @param {boolean} [options.circular=false] - Whether to wrap positions
 * @param {number} [options.sequenceLength] - Physical circular sequence length
 * @returns {Array<number|null>} Map from aligned position to original position
 */
export function buildAlignedToOriginalMap(alignedSequence, originalStart, options = {}) {
  const map = []
  let origPos = originalStart

  for (let alignedPos = 0; alignedPos < alignedSequence.length; alignedPos++) {
    if (alignedSequence[alignedPos] !== '-') {
      map.push(mapVirtualPosition(origPos, options))
      origPos++
    } else {
      map.push(null)
    }
  }

  return map
}

/**
 * Build a reverse coordinate map from original position to aligned position.
 * This creates an object where keys are original positions and values are aligned positions.
 *
 * @param {string} alignedSequence - Sequence with gaps ('-')
 * @param {number} originalStart - Start position in original sequence
 * @param {Object} [options]
 * @param {boolean} [options.circular=false] - Whether to wrap positions
 * @param {number} [options.sequenceLength] - Physical circular sequence length
 * @returns {Object} Map from original position to aligned position
 */
export function buildReverseCoordinateMap(alignedSequence, originalStart, options = {}) {
  const map = {}
  let origPos = originalStart

  for (let alignedPos = 0; alignedPos < alignedSequence.length; alignedPos++) {
    if (alignedSequence[alignedPos] !== '-') {
      const mappedPos = mapVirtualPosition(origPos, options)
      if (map[mappedPos] === undefined) {
        map[mappedPos] = alignedPos
      }
      origPos++
    }
  }

  return map
}

/**
 * Extract gap positions from an aligned sequence string.
 *
 * @param {string} alignedSequence - Sequence with gaps ('-')
 * @param {number} originalStart - Start position in original sequence
 * @param {Object} [options]
 * @param {boolean} [options.circular=false] - Whether to wrap positions
 * @param {number} [options.sequenceLength] - Physical circular sequence length
 * @returns {Array<{position: number, length: number}>} Array of gap objects
 */
export function extractGaps(alignedSequence, originalStart, options = {}) {
  const gaps = []
  let originalPos = originalStart
  let i = 0

  while (i < alignedSequence.length) {
    if (alignedSequence[i] === '-') {
      // Found a gap, count its length
      let gapLength = 0
      while (i < alignedSequence.length && alignedSequence[i] === '-') {
        gapLength++
        i++
      }
      gaps.push({ position: mapVirtualPosition(originalPos, options), length: gapLength })
    } else {
      // Non-gap character
      originalPos++
      i++
    }
  }

  return gaps
}

/**
 * Map an annotation through alignment, adjusting coordinates for gaps.
 *
 * @param {Object} annotation - Annotation with span property
 * @param {Object} reverseMap - Map from original to aligned positions
 * @param {number} originalStart - Start position in original sequence
 * @param {number} originalEnd - End position in original sequence (exclusive)
 * @param {Object} [options]
 * @param {boolean} [options.circular=false] - Whether original coordinates are circular physical positions
 * @param {number} [options.sequenceLength] - Physical circular sequence length
 * @returns {Object|null} Annotation with mapped coordinates, or null if outside alignment
 */
export function mapAnnotationThroughAlignment(annotation, reverseMap, originalStart, originalEnd, options = {}) {
  if (!annotation.span || !annotation.span.ranges) return null

  const mappedRanges = []

  if (options.circular && options.sequenceLength) {
    for (const range of annotation.span.ranges) {
      let runStart = null
      let previousAligned = null

      for (let originalPos = range.start; originalPos < range.end; originalPos++) {
        const physicalPos = normalizeCircularPosition(originalPos, options.sequenceLength)
        const alignedPos = reverseMap[physicalPos]

        if (alignedPos === undefined) {
          if (runStart !== null) {
            mappedRanges.push({
              start: runStart,
              end: previousAligned + 1,
              orientation: range.orientation
            })
            runStart = null
            previousAligned = null
          }
          continue
        }

        if (runStart === null) {
          runStart = alignedPos
          previousAligned = alignedPos
        } else if (alignedPos === previousAligned + 1) {
          previousAligned = alignedPos
        } else {
          mappedRanges.push({
            start: runStart,
            end: previousAligned + 1,
            orientation: range.orientation
          })
          runStart = alignedPos
          previousAligned = alignedPos
        }
      }

      if (runStart !== null) {
        mappedRanges.push({
          start: runStart,
          end: previousAligned + 1,
          orientation: range.orientation
        })
      }
    }

    if (mappedRanges.length === 0) return null

    const ranges = mappedRanges.map(r => new Range(r.start, r.end, r.orientation))

    return new Annotation({
      id: annotation.id,
      caption: annotation.caption,
      type: annotation.type,
      span: new Span(ranges),
      attributes: {
        ...annotation.attributes,
        _originalAnnotation: annotation
      }
    })
  }

  for (const range of annotation.span.ranges) {
    // Check if range overlaps with aligned region
    if (range.end <= originalStart || range.start >= originalEnd) {
      continue // Range is completely outside alignment
    }

    // Clamp range to aligned region
    const clampedStart = Math.max(range.start, originalStart)
    const clampedEnd = Math.min(range.end, originalEnd)

    // Map coordinates
    const mappedStart = reverseMap[clampedStart]
    const mappedEnd = reverseMap[clampedEnd - 1]

    if (mappedStart === undefined || mappedEnd === undefined) {
      continue // Coordinates couldn't be mapped
    }

    mappedRanges.push({
      start: mappedStart,
      end: mappedEnd + 1, // Convert back to exclusive end
      orientation: range.orientation
    })
  }

  if (mappedRanges.length === 0) return null

  // Create proper Range instances from mapped ranges
  const ranges = mappedRanges.map(r => new Range(r.start, r.end, r.orientation))

  // Create a new Annotation with the mapped span
  return new Annotation({
    id: annotation.id,
    caption: annotation.caption,
    type: annotation.type,
    span: new Span(ranges),
    attributes: {
      ...annotation.attributes,
      _originalAnnotation: annotation
    }
  })
}
