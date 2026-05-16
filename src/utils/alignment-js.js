/**
 * Linear-Space Smith-Waterman Local Pairwise Alignment (JavaScript fallback)
 *
 * Uses a hybrid approach:
 * - Full O(mn) matrix for small sequences (< THRESHOLD)
 * - Linear-space Hirschberg for large sequences to prevent OOM
 */

/**
 * IUPAC ambiguity code definitions.
 * Each code maps to the set of bases it can represent.
 */
const IUPAC_CODES = {
  'A': new Set(['A']),
  'T': new Set(['T']),
  'G': new Set(['G']),
  'C': new Set(['C']),
  'N': new Set(['A', 'T', 'G', 'C']),
  'R': new Set(['A', 'G']),         // puRine
  'Y': new Set(['C', 'T']),         // pYrimidine
  'S': new Set(['G', 'C']),         // Strong
  'W': new Set(['A', 'T']),         // Weak
  'K': new Set(['G', 'T']),         // Keto
  'M': new Set(['A', 'C']),         // aMino
  'B': new Set(['C', 'G', 'T']),    // not A
  'D': new Set(['A', 'G', 'T']),    // not C
  'H': new Set(['A', 'C', 'T']),    // not G
  'V': new Set(['A', 'C', 'G'])     // not T
}

// Threshold for switching to linear-space algorithm
// 1M cells = ~24MB for 3 matrices, safe for most devices
const MATRIX_SIZE_THRESHOLD = 1000000

/**
 * Score the match between two bases, handling IUPAC ambiguity codes.
 */
export function scoreMatch(base1, base2, matchScore = 2, ambiguousScore = 1, mismatchScore = -1) {
  const b1 = base1.toUpperCase()
  const b2 = base2.toUpperCase()

  const set1 = IUPAC_CODES[b1]
  const set2 = IUPAC_CODES[b2]

  if (!set1 || !set2) {
    return mismatchScore
  }

  // Check for intersection
  const hasIntersection = [...set1].some(base => set2.has(base))

  if (!hasIntersection) {
    return mismatchScore
  }

  // Exact match (both are single standard bases and same)
  if (set1.size === 1 && set2.size === 1 && b1 === b2) {
    return matchScore
  }

  // Ambiguous match (intersection exists but not exact)
  return ambiguousScore
}

/**
 * Perform Smith-Waterman local alignment.
 * Automatically chooses between full matrix and linear-space based on input size.
 */
export function align(query, target, options = {}) {
  const m = query.length
  const n = target.length

  // Handle empty sequences
  if (m === 0 || n === 0) {
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

  // Choose algorithm based on matrix size
  const matrixSize = (m + 1) * (n + 1)
  if (matrixSize <= MATRIX_SIZE_THRESHOLD) {
    return alignFullMatrix(query, target, options)
  } else {
    return alignLinearSpace(query, target, options)
  }
}

/**
 * Full matrix Smith-Waterman alignment (for smaller sequences).
 * This is the original algorithm with O(mn) space.
 */
function alignFullMatrix(query, target, options) {
  const {
    match = 2,
    mismatch = -1,
    gapOpen = -3,
    gapExtend = -1
  } = options

  const m = query.length
  const n = target.length

  // Initialize scoring matrices using typed arrays for better memory efficiency
  const H = Array(m + 1).fill(null).map(() => new Float64Array(n + 1))
  const E = Array(m + 1).fill(null).map(() => new Float64Array(n + 1).fill(-Infinity))
  const F = Array(m + 1).fill(null).map(() => new Float64Array(n + 1).fill(-Infinity))

  let maxScore = 0
  let maxI = 0
  let maxJ = 0

  // Fill matrices
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const matchScoreVal = scoreMatch(query[i - 1], target[j - 1], match, 1, mismatch)

      E[i][j] = Math.max(
        H[i][j - 1] + gapOpen + gapExtend,
        E[i][j - 1] + gapExtend
      )

      F[i][j] = Math.max(
        H[i - 1][j] + gapOpen + gapExtend,
        F[i - 1][j] + gapExtend
      )

      H[i][j] = Math.max(
        0,
        H[i - 1][j - 1] + matchScoreVal,
        E[i][j],
        F[i][j]
      )

      if (H[i][j] > maxScore) {
        maxScore = H[i][j]
        maxI = i
        maxJ = j
      }
    }
  }

  if (maxScore === 0) {
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

  // Traceback
  let queryAligned = ''
  let targetAligned = ''
  let i = maxI
  let j = maxJ

  while (i > 0 && j > 0 && H[i][j] > 0) {
    const current = H[i][j]
    const matchScoreVal = scoreMatch(query[i - 1], target[j - 1], match, 1, mismatch)
    const diagonal = H[i - 1][j - 1] + matchScoreVal

    if (current === diagonal) {
      queryAligned = query[i - 1] + queryAligned
      targetAligned = target[j - 1] + targetAligned
      i--
      j--
    } else if (current === E[i][j]) {
      queryAligned = '-' + queryAligned
      targetAligned = target[j - 1] + targetAligned
      j--
      while (j > 0 && E[i][j] === E[i][j - 1] + gapExtend) {
        queryAligned = '-' + queryAligned
        targetAligned = target[j - 1] + targetAligned
        j--
      }
    } else {
      queryAligned = query[i - 1] + queryAligned
      targetAligned = '-' + targetAligned
      i--
      while (i > 0 && F[i][j] === F[i - 1][j] + gapExtend) {
        queryAligned = query[i - 1] + queryAligned
        targetAligned = '-' + targetAligned
        i--
      }
    }
  }

  // Calculate identity
  let matches = 0
  let nonGapPositions = 0
  for (let k = 0; k < queryAligned.length; k++) {
    if (queryAligned[k] !== '-' && targetAligned[k] !== '-') {
      nonGapPositions++
      if (queryAligned[k].toUpperCase() === targetAligned[k].toUpperCase()) {
        matches++
      }
    }
  }

  const identity = nonGapPositions > 0 ? Math.round((matches / nonGapPositions) * 1000) / 10 : 0

  return {
    score: maxScore,
    queryStart: i,
    queryEnd: maxI,
    targetStart: j,
    targetEnd: maxJ,
    queryAligned,
    targetAligned,
    identity
  }
}

/**
 * Linear-space Smith-Waterman alignment for large sequences.
 * Uses Hirschberg's divide-and-conquer approach.
 */
function alignLinearSpace(query, target, options) {
  const {
    match = 2,
    mismatch = -1,
    gapOpen = -3,
    gapExtend = -1
  } = options

  // Step 1: Find max score and endpoint using linear space
  const { maxScore, maxI, maxJ } = findMaxScoreLinearSpace(query, target, options)

  if (maxScore === 0) {
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

  // Step 2: Find start point using backward linear space scan
  const { startI, startJ } = findStartPointLinearSpace(query, target, maxI, maxJ, options)

  // Step 3: Align the local region using Hirschberg
  const localQuery = query.slice(startI, maxI)
  const localTarget = target.slice(startJ, maxJ)

  const { queryAligned, targetAligned } = hirschbergAlign(localQuery, localTarget, options)

  // Calculate identity
  let matches = 0
  let nonGapPositions = 0
  for (let k = 0; k < queryAligned.length; k++) {
    if (queryAligned[k] !== '-' && targetAligned[k] !== '-') {
      nonGapPositions++
      if (queryAligned[k].toUpperCase() === targetAligned[k].toUpperCase()) {
        matches++
      }
    }
  }

  const identity = nonGapPositions > 0 ? Math.round((matches / nonGapPositions) * 1000) / 10 : 0

  return {
    score: maxScore,
    queryStart: startI,
    queryEnd: maxI,
    targetStart: startJ,
    targetEnd: maxJ,
    queryAligned,
    targetAligned,
    identity
  }
}

/**
 * Find the maximum score and its endpoint using linear space.
 */
function findMaxScoreLinearSpace(query, target, options) {
  const { match = 2, mismatch = -1, gapOpen = -3, gapExtend = -1 } = options
  const m = query.length
  const n = target.length

  let prevH = new Float64Array(n + 1)
  let currH = new Float64Array(n + 1)
  let prevE = new Float64Array(n + 1).fill(-Infinity)
  let currE = new Float64Array(n + 1)

  let maxScore = 0
  let maxI = 0
  let maxJ = 0

  for (let i = 1; i <= m; i++) {
    currH.fill(0)
    currE.fill(-Infinity)
    let F = -Infinity

    for (let j = 1; j <= n; j++) {
      const matchScoreVal = scoreMatch(query[i - 1], target[j - 1], match, 1, mismatch)

      currE[j] = Math.max(
        currH[j - 1] + gapOpen + gapExtend,
        currE[j - 1] + gapExtend
      )

      F = Math.max(
        prevH[j] + gapOpen + gapExtend,
        F + gapExtend
      )

      currH[j] = Math.max(
        0,
        prevH[j - 1] + matchScoreVal,
        currE[j],
        F
      )

      if (currH[j] > maxScore) {
        maxScore = currH[j]
        maxI = i
        maxJ = j
      }
    }

    ;[prevH, currH] = [currH, prevH]
    ;[prevE, currE] = [currE, prevE]
  }

  return { maxScore, maxI, maxJ }
}

/**
 * Find the start point of local alignment by backward scanning.
 */
function findStartPointLinearSpace(query, target, maxI, maxJ, options) {
  const { match = 2, mismatch = -1, gapOpen = -3, gapExtend = -1 } = options

  // Reverse the sequences and find max score endpoint (which is the start in forward direction)
  const revQuery = query.slice(0, maxI).split('').reverse().join('')
  const revTarget = target.slice(0, maxJ).split('').reverse().join('')

  const m = revQuery.length
  const n = revTarget.length

  let prevH = new Float64Array(n + 1)
  let currH = new Float64Array(n + 1)
  let prevE = new Float64Array(n + 1).fill(-Infinity)
  let currE = new Float64Array(n + 1)

  let maxScore = 0
  let endRevI = 0
  let endRevJ = 0

  for (let i = 1; i <= m; i++) {
    currH.fill(0)
    currE.fill(-Infinity)
    let F = -Infinity

    for (let j = 1; j <= n; j++) {
      const matchScoreVal = scoreMatch(revQuery[i - 1], revTarget[j - 1], match, 1, mismatch)

      currE[j] = Math.max(
        currH[j - 1] + gapOpen + gapExtend,
        currE[j - 1] + gapExtend
      )

      F = Math.max(
        prevH[j] + gapOpen + gapExtend,
        F + gapExtend
      )

      currH[j] = Math.max(
        0,
        prevH[j - 1] + matchScoreVal,
        currE[j],
        F
      )

      if (currH[j] > maxScore) {
        maxScore = currH[j]
        endRevI = i
        endRevJ = j
      }
    }

    ;[prevH, currH] = [currH, prevH]
    ;[prevE, currE] = [currE, prevE]
  }

  // Convert back to forward coordinates
  const startI = maxI - endRevI
  const startJ = maxJ - endRevJ

  return { startI, startJ }
}

/**
 * Hirschberg's algorithm for global alignment in linear space.
 */
function hirschbergAlign(query, target, options) {
  const m = query.length
  const n = target.length

  // Base cases
  if (m === 0) {
    return {
      queryAligned: '-'.repeat(n),
      targetAligned: target
    }
  }

  if (n === 0) {
    return {
      queryAligned: query,
      targetAligned: '-'.repeat(m)
    }
  }

  if (m === 1) {
    return alignSingleQueryBase(query, target, options)
  }

  if (n === 1) {
    return alignSingleTargetBase(query, target, options)
  }

  // Divide: split query in half
  const mid = Math.floor(m / 2)
  const queryLeft = query.slice(0, mid)
  const queryRight = query.slice(mid)

  // Compute forward scores from left half
  const forwardScores = computeLastRowScores(queryLeft, target, options)

  // Compute backward scores from right half
  const backwardScores = computeFirstRowScoresBackward(queryRight, target, options)

  // Find optimal split point in target
  let bestJ = 0
  let bestScore = forwardScores[0] + backwardScores[0]

  for (let j = 0; j <= n; j++) {
    const score = forwardScores[j] + backwardScores[j]
    if (score > bestScore) {
      bestScore = score
      bestJ = j
    }
  }

  // Recursively align both halves
  const leftResult = hirschbergAlign(queryLeft, target.slice(0, bestJ), options)
  const rightResult = hirschbergAlign(queryRight, target.slice(bestJ), options)

  return {
    queryAligned: leftResult.queryAligned + rightResult.queryAligned,
    targetAligned: leftResult.targetAligned + rightResult.targetAligned
  }
}

/**
 * Compute the last row of the NW score matrix (forward direction).
 */
function computeLastRowScores(query, target, options) {
  const { match = 2, mismatch = -1, gapOpen = -3, gapExtend = -1 } = options
  const m = query.length
  const n = target.length

  let prevH = new Float64Array(n + 1)
  let currH = new Float64Array(n + 1)

  // Initialize for global alignment (gaps in query)
  for (let j = 1; j <= n; j++) {
    prevH[j] = gapOpen + j * gapExtend
  }

  for (let i = 1; i <= m; i++) {
    currH[0] = gapOpen + i * gapExtend

    for (let j = 1; j <= n; j++) {
      const matchScoreVal = scoreMatch(query[i - 1], target[j - 1], match, 1, mismatch)

      const diag = prevH[j - 1] + matchScoreVal
      const up = prevH[j] + gapOpen + gapExtend
      const left = currH[j - 1] + gapOpen + gapExtend

      currH[j] = Math.max(diag, up, left)
    }

    ;[prevH, currH] = [currH, prevH]
  }

  return prevH
}

/**
 * Compute the first row of scores going backward.
 * This is equivalent to computing scores for reversed sequences.
 */
function computeFirstRowScoresBackward(query, target, options) {
  const { match = 2, mismatch = -1, gapOpen = -3, gapExtend = -1 } = options
  const m = query.length
  const n = target.length

  let prevH = new Float64Array(n + 1)
  let currH = new Float64Array(n + 1)

  // Initialize for global alignment (gaps at end)
  for (let j = 0; j < n; j++) {
    prevH[j] = gapOpen + (n - j) * gapExtend
  }
  prevH[n] = 0

  for (let i = m - 1; i >= 0; i--) {
    currH[n] = gapOpen + (m - i) * gapExtend

    for (let j = n - 1; j >= 0; j--) {
      const matchScoreVal = scoreMatch(query[i], target[j], match, 1, mismatch)

      const diag = prevH[j + 1] + matchScoreVal
      const down = prevH[j] + gapOpen + gapExtend
      const right = currH[j + 1] + gapOpen + gapExtend

      currH[j] = Math.max(diag, down, right)
    }

    ;[prevH, currH] = [currH, prevH]
  }

  return prevH
}

/**
 * Align single query base against target (base case).
 */
function alignSingleQueryBase(query, target, options) {
  const { match = 2, mismatch = -1, gapOpen = -3, gapExtend = -1 } = options
  const base = query[0]
  const n = target.length

  // Find best position to place the single base
  // Score each position considering gap penalties
  let bestScore = -Infinity
  let bestJ = 0

  for (let j = 0; j < n; j++) {
    const matchScoreVal = scoreMatch(base, target[j], match, 1, mismatch)
    // Cost of gaps before + match + cost of gaps after
    const gapsBefore = j > 0 ? gapOpen + j * gapExtend : 0
    const gapsAfter = j < n - 1 ? gapOpen + (n - j - 1) * gapExtend : 0
    const score = gapsBefore + matchScoreVal + gapsAfter

    if (score > bestScore) {
      bestScore = score
      bestJ = j
    }
  }

  // Build alignment
  const queryAligned = '-'.repeat(bestJ) + base + '-'.repeat(n - bestJ - 1)
  return {
    queryAligned,
    targetAligned: target
  }
}

/**
 * Align query against single target base (base case).
 */
function alignSingleTargetBase(query, target, options) {
  const { match = 2, mismatch = -1, gapOpen = -3, gapExtend = -1 } = options
  const base = target[0]
  const m = query.length

  let bestScore = -Infinity
  let bestI = 0

  for (let i = 0; i < m; i++) {
    const matchScoreVal = scoreMatch(query[i], base, match, 1, mismatch)
    const gapsBefore = i > 0 ? gapOpen + i * gapExtend : 0
    const gapsAfter = i < m - 1 ? gapOpen + (m - i - 1) * gapExtend : 0
    const score = gapsBefore + matchScoreVal + gapsAfter

    if (score > bestScore) {
      bestScore = score
      bestI = i
    }
  }

  const targetAligned = '-'.repeat(bestI) + base + '-'.repeat(m - bestI - 1)
  return {
    queryAligned: query,
    targetAligned
  }
}
