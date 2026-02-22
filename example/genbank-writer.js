/**
 * Minimal GenBank writer for the standalone example.
 * Converts sequence data back to GenBank format.
 *
 * NOTE: This is a simplified writer. Some metadata may be lost
 * in the round-trip conversion.
 */

/**
 * Convert a single fenced range to GenBank location format
 * Fenced: 0-based, half-open (132..154)
 * GenBank: 1-based, inclusive (133..154)
 * Also handles indefinite locations with < and > markers
 * @param {string} rangeStr - Single fenced range string
 * @returns {string} GenBank location string for this range
 */
function convertSingleRange(rangeStr) {
  // Handle minus strand (parentheses) or unoriented (brackets)
  const isComplement = rangeStr.startsWith('(') && rangeStr.endsWith(')')
  const isUnoriented = rangeStr.startsWith('[') && rangeStr.endsWith(']')
  let inner = (isComplement || isUnoriented) ? rangeStr.slice(1, -1) : rangeStr

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
    return `${startStr}..${endStr}`
  }

  // Return as-is if can't parse
  return rangeStr
}

/**
 * Convert a fenced span to GenBank location format
 * Handles single ranges, multi-range joins, and complement
 * @param {string|object} span - Fenced span string or Span object
 * @returns {string} GenBank location string
 */
function convertSpanToLocation(span) {
  // Convert Span object to string if needed
  const spanStr = (typeof span === 'object' && span !== null && typeof span.toString === 'function')
    ? span.toString()
    : String(span)

  // Check if this is a multi-range span (contains " + ")
  if (spanStr.includes(' + ')) {
    const parts = spanStr.split(/\s*\+\s*/)

    // Check if all parts have the same orientation
    const isAllComplement = parts.every(p => p.startsWith('(') && p.endsWith(')'))

    // Convert each range
    const locations = parts.map(convertSingleRange)
    const joinedLocation = `join(${locations.join(',')})`

    return isAllComplement ? `complement(${joinedLocation})` : joinedLocation
  }

  // Single range
  const isComplement = spanStr.startsWith('(') && spanStr.endsWith(')')
  const location = convertSingleRange(spanStr)

  return isComplement ? `complement(${location})` : location
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
