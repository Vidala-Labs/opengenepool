/**
 * Minimal GenBank writer for the standalone example.
 * Converts sequence data back to GenBank format.
 *
 * NOTE: This is a simplified writer. Some metadata may be lost
 * in the round-trip conversion.
 */

/**
 * Convert a fenced range back to GenBank location format
 * Fenced: 0-based, half-open (132..154)
 * GenBank: 1-based, inclusive (133..154)
 * Also handles indefinite locations with < and > markers
 * @param {string} span - Fenced range string
 * @returns {string} GenBank location string
 */
function convertSpanToLocation(span) {
  // Handle minus strand (parentheses)
  const isComplement = span.startsWith('(') && span.endsWith(')')
  let inner = isComplement ? span.slice(1, -1) : span

  // Check for indefinite markers
  const startIndefinite = inner.startsWith('<')
  const endIndefinite = inner.includes('..>')

  // Remove indefinite markers for parsing
  const cleaned = inner.replace(/[<>]/g, '')

  // Handle simple range: 132..154
  const rangeMatch = cleaned.match(/^(\d+)\.\.(\d+)$/)
  if (rangeMatch) {
    const start = parseInt(rangeMatch[1], 10) + 1  // Convert to 1-based
    const end = parseInt(rangeMatch[2], 10)        // Stays same (half-open→inclusive)
    const startStr = startIndefinite ? `<${start}` : `${start}`
    const endStr = endIndefinite ? `>${end}` : `${end}`
    const location = `${startStr}..${endStr}`
    return isComplement ? `complement(${location})` : location
  }

  // Return as-is for complex spans
  return span
}

/**
 * Format sequence in GenBank ORIGIN format
 * 60 bases per line, grouped in 10s, with position numbers
 * @param {string} sequence - DNA sequence
 * @returns {string} Formatted sequence lines
 */
function formatSequence(sequence) {
  const lines = []
  const seq = sequence.toLowerCase()

  for (let i = 0; i < seq.length; i += 60) {
    const pos = (i + 1).toString().padStart(9, ' ')
    const chunk = seq.slice(i, i + 60)

    // Split into groups of 10
    const groups = []
    for (let j = 0; j < chunk.length; j += 10) {
      groups.push(chunk.slice(j, j + 10))
    }

    lines.push(`${pos} ${groups.join(' ')}`)
  }

  return lines.join('\n')
}

/**
 * Convert sequence object to GenBank format string
 * @param {object} data - Sequence object with name, sequence, annotations, metadata
 * @returns {string} GenBank formatted string
 */
export function toGenBank(data) {
  const lines = []

  // LOCUS line
  const name = (data.name || 'Untitled').substring(0, 16).padEnd(16, ' ')
  const length = `${data.sequence.length} bp`
  const molType = data.metadata?.molecule_type || 'DNA'
  const topology = data.metadata?.circular ? 'circular' : 'linear'
  const date = new Date().toLocaleDateString('en-US', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  }).toUpperCase().replace(',', '')

  lines.push(`LOCUS       ${name} ${length.padEnd(11)} ${molType.padEnd(6)} ${topology.padEnd(8)} SYN ${date}`)

  // DEFINITION
  if (data.metadata?.definition) {
    lines.push(`DEFINITION  ${data.metadata.definition}`)
  }

  // FEATURES
  if (data.annotations && data.annotations.length > 0) {
    lines.push('FEATURES             Location/Qualifiers')

    for (const ann of data.annotations) {
      const type = (ann.type || 'misc_feature').padEnd(16, ' ')
      const location = convertSpanToLocation(ann.span)
      lines.push(`     ${type}${location}`)

      // Add label qualifier
      if (ann.caption) {
        lines.push(`                     /label=${ann.caption}`)
      }

      // Add other attributes
      if (ann.attributes) {
        for (const [key, value] of Object.entries(ann.attributes)) {
          if (key !== 'label' && value) {
            lines.push(`                     /${key}=${value}`)
          }
        }
      }
    }
  }

  // ORIGIN
  lines.push('ORIGIN')
  lines.push(formatSequence(data.sequence))

  // End
  lines.push('//')

  return lines.join('\n')
}
