import { generateBlastnUrl, generateBlastpUrl, openBlast } from './blast.js'
import { translate } from '../../utils/translation.js'

/**
 * Translate a DNA sequence to a protein sequence string.
 * Removes stop codons (*) from the result.
 * @param {string} dnaSequence - The DNA sequence
 * @returns {string} The amino acid sequence (single-letter codes, no stop codons)
 */
function translateToProtein(dnaSequence) {
  const codons = translate(dnaSequence, 0)
  return codons.map(c => c.aminoAcid).filter(aa => aa !== '*').join('')
}

export const BlastExtension = {
  id: 'blast',
  name: 'NCBI BLAST',
  contextMenuItems: (context) => {
    if (context.type === 'translation') {
      return [{
        label: 'BLAST (Protein)',
        action: () => openBlast(generateBlastpUrl(context.data.translation))
      }]
    }
    if (context.type === 'selection' && context.data.sequence) {
      return [{
        label: 'BLAST (DNA)',
        action: () => openBlast(generateBlastnUrl(context.data.sequence))
      }]
    }
    if (context.type === 'annotation' && context.data.sequence) {
      const items = [{
        label: 'BLAST (DNA)',
        action: () => openBlast(generateBlastnUrl(context.data.sequence))
      }]

      // For CDS annotations, also offer protein BLAST
      const annotation = context.data.annotation
      if (annotation && annotation.type === 'CDS') {
        const proteinSeq = translateToProtein(context.data.sequence)
        if (proteinSeq) {
          items.push({
            label: 'BLAST (Protein)',
            action: () => openBlast(generateBlastpUrl(proteinSeq))
          })
        }
      }

      return items
    }
    return []
  }
}
