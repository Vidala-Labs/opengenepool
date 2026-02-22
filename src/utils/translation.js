/**
 * Translation utilities for DNA sequences.
 * Provides codon table and translation functions for CDS annotations.
 */

/**
 * Standard genetic code - all 64 codons mapped to amino acids.
 * Uses single-letter amino acid codes with '*' for stop codons.
 */
export const CODON_TABLE = {
  // Phenylalanine (F)
  'TTT': 'F', 'TTC': 'F',
  // Leucine (L)
  'TTA': 'L', 'TTG': 'L', 'CTT': 'L', 'CTC': 'L', 'CTA': 'L', 'CTG': 'L',
  // Isoleucine (I)
  'ATT': 'I', 'ATC': 'I', 'ATA': 'I',
  // Methionine (M) - also start codon
  'ATG': 'M',
  // Valine (V)
  'GTT': 'V', 'GTC': 'V', 'GTA': 'V', 'GTG': 'V',
  // Serine (S)
  'TCT': 'S', 'TCC': 'S', 'TCA': 'S', 'TCG': 'S', 'AGT': 'S', 'AGC': 'S',
  // Proline (P)
  'CCT': 'P', 'CCC': 'P', 'CCA': 'P', 'CCG': 'P',
  // Threonine (T)
  'ACT': 'T', 'ACC': 'T', 'ACA': 'T', 'ACG': 'T',
  // Alanine (A)
  'GCT': 'A', 'GCC': 'A', 'GCA': 'A', 'GCG': 'A',
  // Tyrosine (Y)
  'TAT': 'Y', 'TAC': 'Y',
  // Stop codons (*)
  'TAA': '*', 'TAG': '*', 'TGA': '*',
  // Histidine (H)
  'CAT': 'H', 'CAC': 'H',
  // Glutamine (Q)
  'CAA': 'Q', 'CAG': 'Q',
  // Asparagine (N)
  'AAT': 'N', 'AAC': 'N',
  // Lysine (K)
  'AAA': 'K', 'AAG': 'K',
  // Aspartic acid (D)
  'GAT': 'D', 'GAC': 'D',
  // Glutamic acid (E)
  'GAA': 'E', 'GAG': 'E',
  // Cysteine (C)
  'TGT': 'C', 'TGC': 'C',
  // Tryptophan (W)
  'TGG': 'W',
  // Arginine (R)
  'CGT': 'R', 'CGC': 'R', 'CGA': 'R', 'CGG': 'R', 'AGA': 'R', 'AGG': 'R',
  // Glycine (G)
  'GGT': 'G', 'GGC': 'G', 'GGA': 'G', 'GGG': 'G'
}

/**
 * Start codons (initiator codons).
 * ATG is the standard eukaryotic start codon.
 */
export const START_CODONS = new Set(['ATG'])

// Three-letter amino acid codes
export const AA_THREE_LETTER = {
  A: 'Ala', R: 'Arg', N: 'Asn', D: 'Asp', C: 'Cys',
  E: 'Glu', Q: 'Gln', G: 'Gly', H: 'His', I: 'Ile',
  L: 'Leu', K: 'Lys', M: 'Met', F: 'Phe', P: 'Pro',
  S: 'Ser', T: 'Thr', W: 'Trp', Y: 'Tyr', V: 'Val',
  '*': 'Stop'
}

/**
 * Stop codons (termination codons).
 */
export const STOP_CODONS = new Set(['TAA', 'TAG', 'TGA'])

/**
 * Translate a DNA sequence to amino acids.
 *
 * @param {string} sequence - DNA sequence (can be uppercase or lowercase)
 * @param {number} [frame=0] - Reading frame (0, 1, or 2)
 * @returns {Array<{codon: string, aminoAcid: string, position: number, isStart: boolean, isStop: boolean}>}
 */
export function translate(sequence, frame = 0) {
  const result = []
  const upperSeq = sequence.toUpperCase()

  // Start from the frame offset and read in groups of 3
  for (let i = frame; i + 3 <= upperSeq.length; i += 3) {
    const codon = upperSeq.slice(i, i + 3)
    const aminoAcid = CODON_TABLE[codon] || '?'

    result.push({
      codon,
      aminoAcid,
      position: i,
      isStart: START_CODONS.has(codon),
      isStop: STOP_CODONS.has(codon)
    })
  }

  return result
}

/**
 * Group bases into codons and translate to amino acids.
 * Bases are already complemented by the sequence iterator for minus strand.
 *
 * @param {Iterator} baseIterator - Iterator from iterateSequence
 * @param {Object} [result] - Optional object to accumulate amino acid string
 * @yields {{bases: Array, aminoAcid: string, codon: string}}
 */
export function* iterateCodons(baseIterator, result = null) {
  const bases = []

  for (const base of baseIterator) {
    bases.push(base)

    if (bases.length === 3) {
      // Build codon string from the 3 bases
      // For minus strand, bases are already complemented by the sequence iterator
      const codon = bases.map(b => b.letter).join('')

      // Translate single codon
      const aminoAcids = translate(codon, 0)
      const aminoAcid = aminoAcids.length > 0 ? aminoAcids[0].aminoAcid : '?'

      // Accumulate for copy/paste if result object provided
      if (result) {
        result.aminoAcids += aminoAcid
      }

      yield {
        bases: [...bases],
        aminoAcid,
        codon
      }

      bases.length = 0  // Clear for next codon
    }
  }
  // Incomplete codon at end is discarded
}

/**
 * Check if two bases are visually adjacent (no discontinuity).
 * A discontinuity occurs when:
 * - Position gap (segment boundary in the annotation)
 * - Line wrap (bases on different display lines)
 *
 * @param {Object} base - Current base with position and direction
 * @param {Object} nextBase - Next base in coding order
 * @param {number} zoom - Bases per line
 * @returns {boolean} True if visually adjacent, false if there's a discontinuity
 */
function basesAreVisuallyAdjacent(base, nextBase, zoom) {
  // Check position adjacency based on strand direction
  const baseIsMinus = !base.direction
  const expectedNext = baseIsMinus ? base.position - 1 : base.position + 1
  if (nextBase.position !== expectedNext) {
    return false
  }

  // Check line adjacency
  const currentLine = Math.floor(base.position / zoom)
  const nextLine = Math.floor(nextBase.position / zoom)
  if (currentLine !== nextLine) {
    return false
  }

  return true
}

/**
 * Chunk codons into renderable fragments at visual discontinuities.
 * Discontinuities occur at segment boundaries (position gaps) or line wraps.
 *
 * @param {Iterable} codonIterator - Iterator/array from iterateCodons
 * @param {number} zoom - Bases per line
 * @yields {Object} Fragment with rendering info
 */
export function* iterateCodonFragments(codonIterator, zoom) {
  // Convert to array to know when we're at the last codon
  const codons = Array.isArray(codonIterator) ? codonIterator : [...codonIterator]

  for (let codonIdx = 0; codonIdx < codons.length; codonIdx++) {
    const codon = codons[codonIdx]
    const prevCodon = codonIdx > 0 ? codons[codonIdx - 1] : null
    const nextCodon = codonIdx < codons.length - 1 ? codons[codonIdx + 1] : null
    const isFirstCodon = codonIdx === 0
    const isLastCodon = codonIdx === codons.length - 1

    // Check for discontinuity BEFORE this codon (between prev codon's last base and this codon's first)
    const hasDiscontinuityBeforeCodon = prevCodon &&
      !basesAreVisuallyAdjacent(prevCodon.bases[prevCodon.bases.length - 1], codon.bases[0], zoom)

    // Check for discontinuity AFTER this codon (between this codon's last base and next codon's first)
    const hasDiscontinuityAfterCodon = nextCodon &&
      !basesAreVisuallyAdjacent(codon.bases[codon.bases.length - 1], nextCodon.bases[0], zoom)

    // Compute codon bounds (genomic positions, half-open interval)
    const codonPositions = codon.bases.map(b => b.position)
    const codonStart = Math.min(...codonPositions)
    const codonEnd = Math.max(...codonPositions) + 1

    // Track which bases have discontinuities after them (within this codon)
    const baseBoundaries = []
    for (let i = 0; i < codon.bases.length; i++) {
      const base = codon.bases[i]
      const nextBase = i < codon.bases.length - 1 ? codon.bases[i + 1] : null

      const hasRightBoundary = nextBase !== null && !basesAreVisuallyAdjacent(base, nextBase, zoom)
      baseBoundaries.push(hasRightBoundary)
    }

    // Split codon into fragments at boundaries
    let compStart = 0
    for (let i = 0; i < codon.bases.length; i++) {
      const isLastBase = i === codon.bases.length - 1
      const hasRightBoundary = baseBoundaries[i]

      if (hasRightBoundary || isLastBase) {
        const compBases = codon.bases.slice(compStart, i + 1)
        const width = compBases.length

        // Determine positions for this fragment
        const positions = compBases.map(b => b.position)
        const minPos = Math.min(...positions)

        // Start position (leftmost for display)
        const start = minPos

        // Line index based on leftmost position
        const lineIndex = Math.floor(minPos / zoom)
        const posInLine = minPos - lineIndex * zoom

        // Letter positioning: which base in this fragment is the middle of the codon (base index 1)?
        const codonMiddleIndex = 1
        const middleInComp = codonMiddleIndex - compStart
        const containsMiddle = middleInComp >= 0 && middleInComp < width
        const letter = containsMiddle ? middleInComp : null

        // Determine orientation from this fragment's bases, not the codon's first base.
        // This matters for split codons across segments with different orientations.
        const fragmentIsMinus = !compBases[0].direction

        // Edge styles in coding order (start = N-terminus side, end = C-terminus side)
        // Uses "fenced" indexing for line boundaries:
        //   - Sequence positions are 0-indexed base positions
        //   - Line boundaries are "fences" between bases
        //   - For zoom=100: fence 0 is before pos 0, fence 100 is after pos 99
        //
        // startFence/endFence are in CODING order:
        //   - Plus strand: startFence < endFence (start is left, end is right)
        //   - Minus strand: startFence > endFence (start is right, end is left)
        const codingStartPos = compBases[0].position
        const codingEndPos = compBases[compBases.length - 1].position

        // Fences in coding order (use fragment orientation, not codon orientation)
        const startFence = fragmentIsMinus ? codingStartPos + 1 : codingStartPos
        const endFence = fragmentIsMinus ? codingEndPos : codingEndPos + 1

        // Check line boundaries at each fence
        const atStartLineBoundary = startFence % zoom === 0
        const atEndLineBoundary = endFence % zoom === 0

        // Flat if at codon boundary (first/last codon, split within codon, or segment boundary)
        const hasBoundaryBefore = compStart > 0
        const isStartTerminus = isFirstCodon && compStart === 0
        const isEndTerminus = isLastCodon && isLastBase

        // startEdge is flat if:
        // - N-terminus of entire CDS (isStartTerminus)
        // - Split codon continuation (hasBoundaryBefore)
        // - At a line boundary
        // - First fragment of codon that's at a discontinuity (compStart === 0 && hasDiscontinuityBeforeCodon)
        const atDiscontinuityStart = compStart === 0 && hasDiscontinuityBeforeCodon
        const startEdge = isStartTerminus || hasBoundaryBefore || atStartLineBoundary || atDiscontinuityStart ? 'flat' : 'chevron'

        // endEdge is flat if:
        // - C-terminus of entire CDS (isEndTerminus)
        // - Split codon boundary (hasRightBoundary)
        // - At a line boundary
        // - Last fragment of codon that's at a discontinuity (isLastBase && hasDiscontinuityAfterCodon)
        const atDiscontinuityEnd = isLastBase && hasDiscontinuityAfterCodon
        const endEdge = isEndTerminus || hasRightBoundary || atEndLineBoundary || atDiscontinuityEnd ? 'flat' : 'chevron'

        yield {
          aminoAcid: codon.aminoAcid,
          codon: codon.codon,
          width,
          start,
          startEdge,  // Edge at N-terminus / coding start
          endEdge,    // Edge at C-terminus / coding end
          letter,
          lineIndex,
          posInLine,
          orientation: fragmentIsMinus ? -1 : 1,
          codonStart,  // Genomic start of full codon (for selection)
          codonEnd     // Genomic end of full codon (half-open)
        }

        compStart = i + 1
      }
    }
  }
}
