import { generateBlastnUrl, generateBlastpUrl, openBlast } from './blast.js'

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
      return [{
        label: 'BLAST (DNA)',
        action: () => openBlast(generateBlastnUrl(context.data.sequence))
      }]
    }
    return []
  }
}
