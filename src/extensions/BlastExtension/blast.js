const BLAST_BASE_URL = 'https://blast.ncbi.nlm.nih.gov/Blast.cgi'

export function generateBlastnUrl(sequence) {
  const params = new URLSearchParams({
    PROGRAM: 'blastn',
    PAGE_TYPE: 'BlastSearch',
    QUERY: sequence
  })
  return `${BLAST_BASE_URL}?${params.toString()}`
}

export function generateBlastpUrl(sequence) {
  const params = new URLSearchParams({
    PROGRAM: 'blastp',
    PAGE_TYPE: 'BlastSearch',
    QUERY: sequence
  })
  return `${BLAST_BASE_URL}?${params.toString()}`
}

export function openBlast(url) {
  window.open(url, '_blank', 'noopener,noreferrer')
}
