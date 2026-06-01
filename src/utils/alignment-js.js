/**
 * Linear-space Smith-Waterman local pairwise alignment (JavaScript fallback).
 *
 * The hot path uses normalized uppercase sequence text plus compact IUPAC bit
 * masks. The algorithm produces compact operations internally and expands them
 * into the legacy aligned-string result shape at the API boundary.
 */

const MASK_A = 1
const MASK_C = 2
const MASK_G = 4
const MASK_T = 8

const BASE_MASKS = new Uint8Array(128)
const SINGLE_BASE_MASKS = new Uint8Array(16)

for (const mask of [MASK_A, MASK_C, MASK_G, MASK_T]) {
  SINGLE_BASE_MASKS[mask] = 1
}

function setMask(char, mask) {
  BASE_MASKS[char.charCodeAt(0)] = mask
  BASE_MASKS[char.toLowerCase().charCodeAt(0)] = mask
}

setMask('A', MASK_A)
setMask('C', MASK_C)
setMask('G', MASK_G)
setMask('T', MASK_T)
setMask('N', MASK_A | MASK_C | MASK_G | MASK_T)
setMask('R', MASK_A | MASK_G)
setMask('Y', MASK_C | MASK_T)
setMask('S', MASK_G | MASK_C)
setMask('W', MASK_A | MASK_T)
setMask('K', MASK_G | MASK_T)
setMask('M', MASK_A | MASK_C)
setMask('B', MASK_C | MASK_G | MASK_T)
setMask('D', MASK_A | MASK_G | MASK_T)
setMask('H', MASK_A | MASK_C | MASK_T)
setMask('V', MASK_A | MASK_C | MASK_G)

/**
 * Score the match between two bases, handling IUPAC ambiguity codes.
 */
export function scoreMatch(base1, base2, matchScore = 2, ambiguousScore = 1, mismatchScore = -1) {
  const mask1 = maskForBase(base1)
  const mask2 = maskForBase(base2)
  return scoreMasks(mask1, mask2, matchScore, ambiguousScore, mismatchScore)
}

/**
 * Perform Smith-Waterman local alignment.
 */
export function align(query, target, options = {}) {
  const normalizedQuery = normalizeSequence(query)
  const normalizedTarget = normalizeSequence(target)

  const m = normalizedQuery.masks.length
  const n = normalizedTarget.masks.length

  if (m === 0 || n === 0) {
    return emptyAlignmentResult()
  }

  const { maxScore, maxI, maxJ } = findMaxScoreLinearSpace(
    normalizedQuery.masks,
    normalizedTarget.masks,
    options
  )

  if (maxScore === 0) {
    return emptyAlignmentResult()
  }

  const { startI, startJ } = findStartPointLinearSpace(
    normalizedQuery.masks,
    normalizedTarget.masks,
    maxI,
    maxJ,
    options
  )

  const operations = hirschbergAlignOps(
    normalizedQuery,
    normalizedTarget,
    startI,
    maxI,
    startJ,
    maxJ,
    options
  )

  const { queryAligned, targetAligned } = expandOperations(
    operations,
    normalizedQuery.text,
    normalizedTarget.text,
    startI,
    startJ
  )

  return {
    score: maxScore,
    queryStart: startI,
    queryEnd: maxI,
    targetStart: startJ,
    targetEnd: maxJ,
    queryAligned,
    targetAligned,
    identity: calculateIdentity(operations)
  }
}

function emptyAlignmentResult() {
  return {
    score: 0,
    queryStart: 0,
    queryEnd: 0,
    targetStart: 0,
    targetEnd: 0,
    queryAligned: '',
    targetAligned: '',
    identity: 0
  }
}

function normalizeSequence(sequence) {
  const text = String(sequence ?? '').toUpperCase()
  const masks = new Uint8Array(text.length)

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    masks[i] = code < BASE_MASKS.length ? BASE_MASKS[code] : 0
  }

  return { text, masks }
}

function maskForBase(base) {
  if (!base || base.length === 0) return 0
  const code = base.charCodeAt(0)
  return code < BASE_MASKS.length ? BASE_MASKS[code] : 0
}

function scoreMasks(mask1, mask2, matchScore, ambiguousScore, mismatchScore) {
  if ((mask1 & mask2) === 0) {
    return mismatchScore
  }

  if (mask1 === mask2 && SINGLE_BASE_MASKS[mask1]) {
    return matchScore
  }

  return ambiguousScore
}

function opTypeForAlignedBases(queryText, targetText, queryIndex, targetIndex) {
  return queryText[queryIndex] === targetText[targetIndex] ? 'match' : 'mismatch'
}

function appendOp(operations, type, length) {
  if (length <= 0) return

  const last = operations[operations.length - 1]
  if (last?.type === type) {
    last.length += length
  } else {
    operations.push({ type, length })
  }
}

function appendOps(operations, additions) {
  for (const op of additions) {
    appendOp(operations, op.type, op.length)
  }
  return operations
}

function findMaxScoreLinearSpace(queryMasks, targetMasks, options) {
  const { match = 2, mismatch = -1, gapOpen = -3, gapExtend = -1 } = options
  const m = queryMasks.length
  const n = targetMasks.length

  let prevH = new Float64Array(n + 1)
  let currH = new Float64Array(n + 1)
  let prevF = new Float64Array(n + 1)
  let currF = new Float64Array(n + 1)

  let maxScore = 0
  let maxI = 0
  let maxJ = 0

  for (let i = 1; i <= m; i++) {
    currH.fill(0)
    currF.fill(-Infinity)
    let E = -Infinity
    const queryMask = queryMasks[i - 1]

    for (let j = 1; j <= n; j++) {
      const matchScoreVal = scoreMasks(queryMask, targetMasks[j - 1], match, 1, mismatch)

      E = Math.max(
        currH[j - 1] + gapOpen + gapExtend,
        E + gapExtend
      )

      currF[j] = Math.max(
        prevH[j] + gapOpen + gapExtend,
        prevF[j] + gapExtend
      )

      currH[j] = Math.max(
        0,
        prevH[j - 1] + matchScoreVal,
        E,
        currF[j]
      )

      if (currH[j] > maxScore) {
        maxScore = currH[j]
        maxI = i
        maxJ = j
      }
    }

    ;[prevH, currH] = [currH, prevH]
    ;[prevF, currF] = [currF, prevF]
  }

  return { maxScore, maxI, maxJ }
}

function findStartPointLinearSpace(queryMasks, targetMasks, maxI, maxJ, options) {
  const { match = 2, mismatch = -1, gapOpen = -3, gapExtend = -1 } = options

  let prevH = new Float64Array(maxJ + 1)
  let currH = new Float64Array(maxJ + 1)
  let prevF = new Float64Array(maxJ + 1)
  let currF = new Float64Array(maxJ + 1)

  let maxScore = 0
  let endRevI = 0
  let endRevJ = 0

  for (let i = 1; i <= maxI; i++) {
    currH.fill(0)
    currF.fill(-Infinity)
    let E = -Infinity
    const queryMask = queryMasks[maxI - i]

    for (let j = 1; j <= maxJ; j++) {
      const matchScoreVal = scoreMasks(queryMask, targetMasks[maxJ - j], match, 1, mismatch)

      E = Math.max(
        currH[j - 1] + gapOpen + gapExtend,
        E + gapExtend
      )

      currF[j] = Math.max(
        prevH[j] + gapOpen + gapExtend,
        prevF[j] + gapExtend
      )

      currH[j] = Math.max(
        0,
        prevH[j - 1] + matchScoreVal,
        E,
        currF[j]
      )

      if (currH[j] > maxScore) {
        maxScore = currH[j]
        endRevI = i
        endRevJ = j
      }
    }

    ;[prevH, currH] = [currH, prevH]
    ;[prevF, currF] = [currF, prevF]
  }

  return {
    startI: maxI - endRevI,
    startJ: maxJ - endRevJ
  }
}

function hirschbergAlignOps(query, target, queryStart, queryEnd, targetStart, targetEnd, options) {
  const m = queryEnd - queryStart
  const n = targetEnd - targetStart

  if (m === 0) {
    return n === 0 ? [] : [{ type: 'target', length: n }]
  }

  if (n === 0) {
    return [{ type: 'query', length: m }]
  }

  if (m === 1) {
    return alignSingleQueryBase(query, target, queryStart, targetStart, targetEnd, options)
  }

  if (n === 1) {
    return alignSingleTargetBase(query, target, targetStart, queryStart, queryEnd, options)
  }

  const queryMid = queryStart + Math.floor(m / 2)
  const forwardScores = computeLastRowScores(query.masks, target.masks, queryStart, queryMid, targetStart, targetEnd, options)
  const backwardScores = computeFirstRowScoresBackward(query.masks, target.masks, queryMid, queryEnd, targetStart, targetEnd, options)

  let bestTargetSplitOffset = 0
  let bestScore = forwardScores[0] + backwardScores[0]

  for (let j = 1; j <= n; j++) {
    const score = forwardScores[j] + backwardScores[j]
    if (score >= bestScore) {
      bestScore = score
      bestTargetSplitOffset = j
    }
  }

  const targetSplit = targetStart + bestTargetSplitOffset
  const left = hirschbergAlignOps(query, target, queryStart, queryMid, targetStart, targetSplit, options)
  const right = hirschbergAlignOps(query, target, queryMid, queryEnd, targetSplit, targetEnd, options)

  return appendOps(left, right)
}

function computeLastRowScores(queryMasks, targetMasks, queryStart, queryEnd, targetStart, targetEnd, options) {
  const { match = 2, mismatch = -1, gapOpen = -3, gapExtend = -1 } = options
  const m = queryEnd - queryStart
  const n = targetEnd - targetStart

  let prevH = new Float64Array(n + 1)
  let currH = new Float64Array(n + 1)

  for (let j = 1; j <= n; j++) {
    prevH[j] = gapOpen + j * gapExtend
  }

  for (let i = 1; i <= m; i++) {
    currH[0] = gapOpen + i * gapExtend
    const queryMask = queryMasks[queryStart + i - 1]

    for (let j = 1; j <= n; j++) {
      const matchScoreVal = scoreMasks(queryMask, targetMasks[targetStart + j - 1], match, 1, mismatch)
      const diag = prevH[j - 1] + matchScoreVal
      const up = prevH[j] + gapOpen + gapExtend
      const left = currH[j - 1] + gapOpen + gapExtend

      currH[j] = Math.max(diag, up, left)
    }

    ;[prevH, currH] = [currH, prevH]
  }

  return prevH
}

function computeFirstRowScoresBackward(queryMasks, targetMasks, queryStart, queryEnd, targetStart, targetEnd, options) {
  const { match = 2, mismatch = -1, gapOpen = -3, gapExtend = -1 } = options
  const m = queryEnd - queryStart
  const n = targetEnd - targetStart

  let prevH = new Float64Array(n + 1)
  let currH = new Float64Array(n + 1)

  for (let j = 0; j < n; j++) {
    prevH[j] = gapOpen + (n - j) * gapExtend
  }
  prevH[n] = 0

  for (let i = m - 1; i >= 0; i--) {
    currH[n] = gapOpen + (m - i) * gapExtend
    const queryMask = queryMasks[queryStart + i]

    for (let j = n - 1; j >= 0; j--) {
      const matchScoreVal = scoreMasks(queryMask, targetMasks[targetStart + j], match, 1, mismatch)
      const diag = prevH[j + 1] + matchScoreVal
      const down = prevH[j] + gapOpen + gapExtend
      const right = currH[j + 1] + gapOpen + gapExtend

      currH[j] = Math.max(diag, down, right)
    }

    ;[prevH, currH] = [currH, prevH]
  }

  return prevH
}

function alignSingleQueryBase(query, target, queryIndex, targetStart, targetEnd, options) {
  const { match = 2, mismatch = -1, gapOpen = -3, gapExtend = -1 } = options
  const n = targetEnd - targetStart
  const queryMask = query.masks[queryIndex]

  let bestScore = -Infinity
  let bestTargetOffset = 0

  for (let j = 0; j < n; j++) {
    const matchScoreVal = scoreMasks(queryMask, target.masks[targetStart + j], match, 1, mismatch)
    const gapsBefore = j > 0 ? gapOpen + j * gapExtend : 0
    const gapsAfter = j < n - 1 ? gapOpen + (n - j - 1) * gapExtend : 0
    const score = gapsBefore + matchScoreVal + gapsAfter

    if (score > bestScore) {
      bestScore = score
      bestTargetOffset = j
    }
  }

  const operations = []
  appendOp(operations, 'target', bestTargetOffset)
  appendOp(
    operations,
    opTypeForAlignedBases(query.text, target.text, queryIndex, targetStart + bestTargetOffset),
    1
  )
  appendOp(operations, 'target', n - bestTargetOffset - 1)
  return operations
}

function alignSingleTargetBase(query, target, targetIndex, queryStart, queryEnd, options) {
  const { match = 2, mismatch = -1, gapOpen = -3, gapExtend = -1 } = options
  const m = queryEnd - queryStart
  const targetMask = target.masks[targetIndex]

  let bestScore = -Infinity
  let bestQueryOffset = 0

  for (let i = 0; i < m; i++) {
    const matchScoreVal = scoreMasks(query.masks[queryStart + i], targetMask, match, 1, mismatch)
    const gapsBefore = i > 0 ? gapOpen + i * gapExtend : 0
    const gapsAfter = i < m - 1 ? gapOpen + (m - i - 1) * gapExtend : 0
    const score = gapsBefore + matchScoreVal + gapsAfter

    if (score > bestScore) {
      bestScore = score
      bestQueryOffset = i
    }
  }

  const operations = []
  appendOp(operations, 'query', bestQueryOffset)
  appendOp(
    operations,
    opTypeForAlignedBases(query.text, target.text, queryStart + bestQueryOffset, targetIndex),
    1
  )
  appendOp(operations, 'query', m - bestQueryOffset - 1)
  return operations
}

function expandOperations(operations, queryText, targetText, queryStart, targetStart) {
  const queryChunks = []
  const targetChunks = []
  let queryPos = queryStart
  let targetPos = targetStart

  for (const op of operations) {
    if (op.type === 'match' || op.type === 'mismatch') {
      queryChunks.push(queryText.slice(queryPos, queryPos + op.length))
      targetChunks.push(targetText.slice(targetPos, targetPos + op.length))
      queryPos += op.length
      targetPos += op.length
    } else if (op.type === 'query') {
      queryChunks.push(queryText.slice(queryPos, queryPos + op.length))
      targetChunks.push('-'.repeat(op.length))
      queryPos += op.length
    } else if (op.type === 'target') {
      queryChunks.push('-'.repeat(op.length))
      targetChunks.push(targetText.slice(targetPos, targetPos + op.length))
      targetPos += op.length
    }
  }

  return {
    queryAligned: queryChunks.join(''),
    targetAligned: targetChunks.join('')
  }
}

function calculateIdentity(operations) {
  let matches = 0
  let nonGapPositions = 0

  for (const op of operations) {
    if (op.type === 'match') {
      matches += op.length
      nonGapPositions += op.length
    } else if (op.type === 'mismatch') {
      nonGapPositions += op.length
    }
  }

  return nonGapPositions > 0 ? Math.round((matches / nonGapPositions) * 1000) / 10 : 0
}
