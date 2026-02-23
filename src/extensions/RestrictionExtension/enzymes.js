/**
 * Restriction enzyme database.
 *
 * Each enzyme has:
 * - name: Common enzyme name
 * - recognitionSequence: 5' to 3' recognition sequence on top strand
 * - cutPosition: Where top strand is cut (0-based, after the base at this position)
 * - cutPositionComplement: Where bottom strand is cut (0-based from 5' end of recognition sequence)
 *
 * Overhang calculation:
 * - cutPositionComplement - cutPosition > 0: 5' overhang (sticky end)
 * - cutPositionComplement - cutPosition < 0: 3' overhang
 * - cutPositionComplement - cutPosition = 0: Blunt end
 *
 * For Type IIS enzymes (BsaI, BsmBI), the cut positions are relative to the
 * recognition sequence start, extending past the recognition site.
 */

export const ENZYMES = [
  // Common 6-cutter enzymes with 5' overhangs
  { name: 'EcoRI', recognitionSequence: 'GAATTC', cutPosition: 1, cutPositionComplement: 5 },
  { name: 'BamHI', recognitionSequence: 'GGATCC', cutPosition: 1, cutPositionComplement: 5 },
  { name: 'HindIII', recognitionSequence: 'AAGCTT', cutPosition: 1, cutPositionComplement: 5 },
  { name: 'BglII', recognitionSequence: 'AGATCT', cutPosition: 1, cutPositionComplement: 5 },
  { name: 'SalI', recognitionSequence: 'GTCGAC', cutPosition: 1, cutPositionComplement: 5 },
  { name: 'XbaI', recognitionSequence: 'TCTAGA', cutPosition: 1, cutPositionComplement: 5 },
  { name: 'XhoI', recognitionSequence: 'CTCGAG', cutPosition: 1, cutPositionComplement: 5 },
  { name: 'NcoI', recognitionSequence: 'CCATGG', cutPosition: 1, cutPositionComplement: 5 },
  { name: 'NdeI', recognitionSequence: 'CATATG', cutPosition: 2, cutPositionComplement: 4 },

  // 8-cutter with 5' overhang
  { name: 'NotI', recognitionSequence: 'GCGGCCGC', cutPosition: 2, cutPositionComplement: 6 },

  // 3' overhang enzymes
  { name: 'KpnI', recognitionSequence: 'GGTACC', cutPosition: 5, cutPositionComplement: 1 },
  { name: 'SacI', recognitionSequence: 'GAGCTC', cutPosition: 5, cutPositionComplement: 1 },
  { name: 'SphI', recognitionSequence: 'GCATGC', cutPosition: 5, cutPositionComplement: 1 },
  { name: 'PstI', recognitionSequence: 'CTGCAG', cutPosition: 5, cutPositionComplement: 1 },

  // Blunt cutters
  { name: 'PvuII', recognitionSequence: 'CAGCTG', cutPosition: 3, cutPositionComplement: 3 },
  { name: 'SmaI', recognitionSequence: 'CCCGGG', cutPosition: 3, cutPositionComplement: 3 },
  { name: 'EcoRV', recognitionSequence: 'GATATC', cutPosition: 3, cutPositionComplement: 3 },
  { name: 'ScaI', recognitionSequence: 'AGTACT', cutPosition: 3, cutPositionComplement: 3 },

  // 4-cutter (methylation sensitive)
  { name: 'DpnI', recognitionSequence: 'GATC', cutPosition: 2, cutPositionComplement: 2 },

  // Degenerate recognition (N = any base)
  { name: 'BglI', recognitionSequence: 'GCCNNNNNGGC', cutPosition: 7, cutPositionComplement: 4 },

  // 8-cutter with 3' overhang
  { name: 'PacI', recognitionSequence: 'TTAATTAA', cutPosition: 5, cutPositionComplement: 3 },

  // Type IIS enzymes (cut outside recognition site)
  // BsaI: GGTCTC(N)1/5 - cuts 1 bp downstream on top, 5 bp on bottom (4 base 5' overhang)
  { name: 'BsaI', recognitionSequence: 'GGTCTCN', cutPosition: 7, cutPositionComplement: 11 },
  // BsmBI: CGTCTC(N)1/5 - cuts 1 bp downstream on top, 5 bp on bottom (4 base 5' overhang)
  { name: 'BsmBI', recognitionSequence: 'CGTCTCN', cutPosition: 7, cutPositionComplement: 11 },

  // Homing endonucleases (meganucleases)
  // I-SceI: 18 bp recognition, generates 4-base 3' overhangs
  { name: 'I-SceI', recognitionSequence: 'TAGGGATAACAGGGTAAT', cutPosition: 9, cutPositionComplement: 5 },
  // I-CeuI: 26 bp recognition, generates 4-base 3' overhangs
  { name: 'I-CeuI', recognitionSequence: 'TAACTATAACGGTCCTAAGGTAGCGAA', cutPosition: 14, cutPositionComplement: 10 }
]

// Sort enzymes alphabetically by name for display
export const ENZYMES_SORTED = [...ENZYMES].sort((a, b) => a.name.localeCompare(b.name))
