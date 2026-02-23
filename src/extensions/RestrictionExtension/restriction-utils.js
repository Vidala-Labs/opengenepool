import { reverseComplement } from '../../utils/dna.js'

/**
 * Convert IUPAC ambiguity codes to regex pattern.
 * Used for enzymes with degenerate recognition sequences (e.g., HincII: GTYRAC)
 */
const IUPAC_TO_REGEX = {
  A: 'A', T: 'T', G: 'G', C: 'C',
  R: '[AG]',   // puRine
  Y: '[CT]',   // pYrimidine
  S: '[GC]',   // Strong
  W: '[AT]',   // Weak
  K: '[GT]',   // Keto
  M: '[AC]',   // aMino
  B: '[CGT]',  // not A
  D: '[AGT]',  // not C
  H: '[ACT]',  // not G
  V: '[ACG]',  // not T
  N: '[ATGC]'  // any
}

/**
 * Convert a recognition sequence (possibly with IUPAC codes) to a regex pattern.
 * @param {string} seq - Recognition sequence
 * @returns {string} Regex pattern
 */
function sequenceToRegex(seq) {
  return seq.split('').map(c => IUPAC_TO_REGEX[c.toUpperCase()] || c).join('')
}

/**
 * Check if a recognition sequence contains IUPAC ambiguity codes.
 * @param {string} seq - Recognition sequence
 * @returns {boolean}
 */
function hasAmbiguousBases(seq) {
  return /[RYSWKMBDHVN]/i.test(seq)
}

/**
 * Find all cut sites for an enzyme in a sequence.
 *
 * @param {string} sequence - The DNA sequence to search
 * @param {Object} enzyme - Enzyme object with recognitionSequence, cutPosition, cutPositionComplement
 * @returns {Array<Object>} Array of cut site objects:
 *   - position: The cut position (0-based, fenced coordinate)
 *   - strand: '+' or '-' indicating which strand the recognition site is on
 *   - overhangStart: Start of overhang region
 *   - overhangEnd: End of overhang region
 *   - enzyme: Name of the enzyme
 *   - matchStart: Start of the recognition sequence match
 *   - matchEnd: End of the recognition sequence match
 */
export function findCutSites(sequence, enzyme) {
  const sites = []
  const { name, recognitionSequence, cutPosition, cutPositionComplement } = enzyme
  const seqUpper = sequence.toUpperCase()
  const recogUpper = recognitionSequence.toUpperCase()
  const recogLength = recognitionSequence.length

  // Calculate reverse complement of recognition sequence
  const rcSequence = reverseComplement(recogUpper)

  // Check if recognition sequence is a palindrome
  const isPalindrome = recogUpper === rcSequence

  // Use regex if sequence has ambiguous bases, otherwise use indexOf
  const useRegex = hasAmbiguousBases(recogUpper)

  // Search forward strand
  if (useRegex) {
    const pattern = new RegExp(sequenceToRegex(recogUpper), 'gi')
    let match
    while ((match = pattern.exec(seqUpper)) !== null) {
      const pos = match.index
      const cutAt = pos + cutPosition
      const overhangStart = pos + Math.min(cutPosition, cutPositionComplement)
      const overhangEnd = pos + Math.max(cutPosition, cutPositionComplement)

      sites.push({
        position: cutAt,
        strand: '+',
        overhangStart,
        overhangEnd,
        enzyme: name,
        matchStart: pos,
        matchEnd: pos + recogLength
      })

      // Prevent infinite loop on zero-length matches
      if (match.index === pattern.lastIndex) pattern.lastIndex++
    }
  } else {
    let pos = 0
    while ((pos = seqUpper.indexOf(recogUpper, pos)) !== -1) {
      const cutAt = pos + cutPosition
      const overhangStart = pos + Math.min(cutPosition, cutPositionComplement)
      const overhangEnd = pos + Math.max(cutPosition, cutPositionComplement)

      sites.push({
        position: cutAt,
        strand: '+',
        overhangStart,
        overhangEnd,
        enzyme: name,
        matchStart: pos,
        matchEnd: pos + recogLength
      })
      pos++
    }
  }

  // Search reverse complement (only if different from forward sequence)
  if (!isPalindrome) {
    if (useRegex) {
      const rcPattern = new RegExp(sequenceToRegex(rcSequence), 'gi')
      let match
      while ((match = rcPattern.exec(seqUpper)) !== null) {
        const pos = match.index
        // For reverse strand, cut position is measured from the opposite end
        const cutAt = pos + (recogLength - cutPositionComplement)
        const overhangStart = pos + (recogLength - Math.max(cutPosition, cutPositionComplement))
        const overhangEnd = pos + (recogLength - Math.min(cutPosition, cutPositionComplement))

        sites.push({
          position: cutAt,
          strand: '-',
          overhangStart,
          overhangEnd,
          enzyme: name,
          matchStart: pos,
          matchEnd: pos + recogLength
        })

        if (match.index === rcPattern.lastIndex) rcPattern.lastIndex++
      }
    } else {
      let pos = 0
      while ((pos = seqUpper.indexOf(rcSequence, pos)) !== -1) {
        const cutAt = pos + (recogLength - cutPositionComplement)
        const overhangStart = pos + (recogLength - Math.max(cutPosition, cutPositionComplement))
        const overhangEnd = pos + (recogLength - Math.min(cutPosition, cutPositionComplement))

        sites.push({
          position: cutAt,
          strand: '-',
          overhangStart,
          overhangEnd,
          enzyme: name,
          matchStart: pos,
          matchEnd: pos + recogLength
        })
        pos++
      }
    }
  }

  return sites.sort((a, b) => a.position - b.position)
}

/**
 * Find cut sites for multiple enzymes.
 *
 * @param {string} sequence - The DNA sequence to search
 * @param {Array<Object>} enzymes - Array of enzyme objects
 * @returns {Array<Object>} All cut sites from all enzymes, sorted by position
 */
export function findAllCutSites(sequence, enzymes) {
  const allSites = []

  for (const enzyme of enzymes) {
    const sites = findCutSites(sequence, enzyme)
    allSites.push(...sites)
  }

  return allSites.sort((a, b) => a.position - b.position)
}

/**
 * Count cut sites for each enzyme in the list.
 *
 * @param {string} sequence - The DNA sequence to search
 * @param {Array<Object>} enzymes - Array of enzyme objects
 * @returns {Map<string, number>} Map of enzyme name to cut count
 */
export function countCutSites(sequence, enzymes) {
  const counts = new Map()

  for (const enzyme of enzymes) {
    const sites = findCutSites(sequence, enzyme)
    counts.set(enzyme.name, sites.length)
  }

  return counts
}

/**
 * Get overhang type for an enzyme.
 *
 * @param {Object} enzyme - Enzyme object
 * @returns {'5prime' | '3prime' | 'blunt'} Overhang type
 */
export function getOverhangType(enzyme) {
  const diff = enzyme.cutPositionComplement - enzyme.cutPosition
  if (diff > 0) return '5prime'
  if (diff < 0) return '3prime'
  return 'blunt'
}

/**
 * Get overhang length for an enzyme.
 *
 * @param {Object} enzyme - Enzyme object
 * @returns {number} Overhang length (0 for blunt)
 */
export function getOverhangLength(enzyme) {
  return Math.abs(enzyme.cutPositionComplement - enzyme.cutPosition)
}
