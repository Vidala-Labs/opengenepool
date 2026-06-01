/**
 * Smith-Waterman Local Pairwise Alignment
 *
 * This module provides a memory-efficient implementation using:
 * - WASM (Zig) for large sequences when available
 * - JavaScript fallback with linear-space algorithm
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
 * Uses WASM if available, otherwise falls back to JavaScript.
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
  // Use WASM if available
  if (wasmModule) {
    return alignWasm(query, target, options)
  }

  // Fall back to JavaScript implementation
  return alignJS(query, target, options)
}

/**
 * Perform alignment using WASM module.
 */
function alignWasm(query, target, options) {
  const {
    match = 2,
    mismatch = -1,
    gapOpen = -3,
    gapExtend = -1
  } = options

  // Reset heap before starting new alignment
  wasmModule.reset()

  // Encode strings to memory
  const queryBytes = textEncoder.encode(query)
  const targetBytes = textEncoder.encode(target)

  const queryLen = queryBytes.length
  const targetLen = targetBytes.length

  // Allocate memory in WASM
  const queryPtr = wasmModule.alloc(queryLen)
  const targetPtr = wasmModule.alloc(targetLen)

  // Copy strings to WASM memory
  const memory = new Uint8Array(wasmModule.memory.buffer)
  memory.set(queryBytes, queryPtr)
  memory.set(targetBytes, targetPtr)

  // Call WASM alignment function
  const resultPtr = wasmModule.alignSequences(
    queryPtr, queryLen,
    targetPtr, targetLen,
    match, mismatch, gapOpen, gapExtend
  )

  // Read result from WASM memory
  const result = readAlignmentResult(resultPtr)

  // Free allocated memory
  wasmModule.free(queryPtr)
  wasmModule.free(targetPtr)
  wasmModule.freeResult(resultPtr)

  return result
}

/**
 * Read alignment result from WASM memory.
 */
function readAlignmentResult(ptr) {
  const memory = new Uint8Array(wasmModule.memory.buffer)
  const view = new DataView(wasmModule.memory.buffer)

  // Result structure layout:
  // i32 score              (offset 0)
  // i32 queryStart         (offset 4)
  // i32 queryEnd           (offset 8)
  // i32 targetStart        (offset 12)
  // i32 targetEnd          (offset 16)
  // u32 queryAlignedPtr    (offset 20)
  // i32 queryAlignedLen    (offset 24)
  // u32 targetAlignedPtr   (offset 28)
  // i32 targetAlignedLen   (offset 32)
  // u32 _padding           (offset 36) - for f64 alignment
  // f64 identity           (offset 40)

  let offset = ptr
  const score = view.getInt32(offset, true); offset += 4
  const queryStart = view.getInt32(offset, true); offset += 4
  const queryEnd = view.getInt32(offset, true); offset += 4
  const targetStart = view.getInt32(offset, true); offset += 4
  const targetEnd = view.getInt32(offset, true); offset += 4
  const queryAlignedPtr = view.getUint32(offset, true); offset += 4
  const queryAlignedLen = view.getInt32(offset, true); offset += 4
  const targetAlignedPtr = view.getUint32(offset, true); offset += 4
  const targetAlignedLen = view.getInt32(offset, true); offset += 4
  offset += 4  // skip padding
  const identity = view.getFloat64(offset, true)

  const queryAligned = textDecoder.decode(memory.subarray(queryAlignedPtr, queryAlignedPtr + queryAlignedLen))
  const targetAligned = textDecoder.decode(memory.subarray(targetAlignedPtr, targetAlignedPtr + targetAlignedLen))

  return {
    score,
    queryStart,
    queryEnd,
    targetStart,
    targetEnd,
    queryAligned,
    targetAligned,
    identity
  }
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
 * Build a reverse coordinate map from original position to aligned position.
 * This creates an object where keys are original positions and values are aligned positions.
 *
 * @param {string} alignedSequence - Sequence with gaps ('-')
 * @param {number} originalStart - Start position in original sequence
 * @returns {Object} Map from original position to aligned position
 */
export function buildReverseCoordinateMap(alignedSequence, originalStart) {
  const map = {}
  let origPos = originalStart

  for (let alignedPos = 0; alignedPos < alignedSequence.length; alignedPos++) {
    if (alignedSequence[alignedPos] !== '-') {
      map[origPos] = alignedPos
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
 * @returns {Array<{position: number, length: number}>} Array of gap objects
 */
export function extractGaps(alignedSequence, originalStart) {
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
      gaps.push({ position: originalPos, length: gapLength })
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
 * @returns {Object|null} Annotation with mapped coordinates, or null if outside alignment
 */
export function mapAnnotationThroughAlignment(annotation, reverseMap, originalStart, originalEnd) {
  if (!annotation.span || !annotation.span.ranges) return null

  const mappedRanges = []

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
