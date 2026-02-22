/**
 * Minimal GenBank parser for the standalone example.
 *
 * NOTE: This is a simplified parser that handles common cases.
 * For production use, a more sophisticated GenBank parser is recommended
 * that handles edge cases, multi-line qualifiers, complex locations
 * (joins, complements), and the full GenBank specification.
 *
 * Range conversion:
 * - GenBank uses 1-based, inclusive ranges (e.g., 133..154)
 * - SequenceEditor uses 0-based, half-open "fenced" ranges (e.g., 132..154)
 * - Conversion: start - 1, end stays same (inclusive→exclusive cancels the -1)
 */

/**
 * Convert a single GenBank range to fenced format
 * @param {string} rangeStr - Single GenBank range like "133..154" or "<133..>154"
 * @param {boolean} isComplement - Whether this is part of a complement
 * @returns {string} Fenced range string
 */
function convertSingleLocation(rangeStr, isComplement = false) {
  // Check for indefinite markers
  const startIndefinite = rangeStr.startsWith('<')
  const endIndefinite = rangeStr.includes('..>') || (rangeStr.includes('>') && !rangeStr.includes('..'))

  // Remove indefinite markers for numeric parsing
  const cleanLoc = rangeStr.replace(/[<>]/g, '')

  // Handle simple range: 133..154
  const rangeMatch = cleanLoc.match(/^(\d+)\.\.(\d+)$/)
  if (rangeMatch) {
    const start = parseInt(rangeMatch[1], 10) - 1  // Convert to 0-based
    const end = parseInt(rangeMatch[2], 10)        // Stays same (inclusive→exclusive)
    const startStr = startIndefinite ? `<${start}` : `${start}`
    const endStr = endIndefinite ? `>${end}` : `${end}`
    const range = `${startStr}..${endStr}`
    return isComplement ? `(${range})` : range
  }

  // Handle single position: 500
  const singleMatch = cleanLoc.match(/^(\d+)$/)
  if (singleMatch) {
    const pos = parseInt(singleMatch[1], 10) - 1
    const startStr = startIndefinite ? `<${pos}` : `${pos}`
    const endStr = endIndefinite ? `>${pos + 1}` : `${pos + 1}`
    const range = `${startStr}..${endStr}`
    return isComplement ? `(${range})` : range
  }

  return rangeStr
}

/**
 * Convert a GenBank location to fenced range format
 * Handles simple ranges like "133..154" and "complement(317..333)"
 * Also handles join() locations and indefinite markers
 * @param {string} location - GenBank location string
 * @returns {string} Fenced range string (0-based, half-open)
 */
function convertLocation(location) {
  // Handle complement wrapper
  const isComplement = location.startsWith('complement(') && location.endsWith(')')
  let loc = location
  if (isComplement) {
    loc = location.slice(11, -1)  // Remove "complement(" and ")"
  }

  // Handle join() locations
  const isJoin = loc.startsWith('join(') && loc.endsWith(')')
  if (isJoin) {
    const inner = loc.slice(5, -1)  // Remove "join(" and ")"
    const parts = inner.split(',').map(p => p.trim())
    const convertedParts = parts.map(p => convertSingleLocation(p, isComplement))
    return convertedParts.join(' + ')
  }

  // Simple range or single position
  return convertSingleLocation(loc, isComplement)
}

/**
 * Parse a GenBank file string into a sequence object
 * @param {string} text - Raw GenBank file content
 * @returns {object} Parsed sequence object
 */
export function parseGenBank(text) {
  // Normalize line endings (handle Windows \r\n)
  const normalizedText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = normalizedText.split('\n')

  const result = {
    name: '',
    sequence: '',
    annotations: [],
    metadata: {
      molecule_type: 'DNA',
      circular: false,
      definition: ''
    }
  }

  let section = 'header'
  let currentFeature = null
  let sequenceLines = []
  let definitionLines = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // LOCUS line
    if (line.startsWith('LOCUS')) {
      const parts = line.split(/\s+/)
      result.name = parts[1] || 'Untitled'
      result.metadata.circular = line.toLowerCase().includes('circular')
      if (line.includes('DNA')) result.metadata.molecule_type = 'DNA'
      else if (line.includes('RNA')) result.metadata.molecule_type = 'RNA'
      continue
    }

    // DEFINITION (can span multiple lines)
    if (line.startsWith('DEFINITION')) {
      definitionLines.push(line.substring(12).trim())
      continue
    }
    if (definitionLines.length > 0 && line.startsWith('            ')) {
      if (!line.startsWith('ACCESSION') && !line.startsWith('VERSION')) {
        definitionLines.push(line.trim())
        continue
      }
    }
    if (definitionLines.length > 0 && !line.startsWith(' ')) {
      result.metadata.definition = definitionLines.join(' ')
      definitionLines = []
    }

    // FEATURES section
    if (line.startsWith('FEATURES')) {
      section = 'features'
      continue
    }

    // ORIGIN section (sequence data)
    if (line.startsWith('ORIGIN')) {
      section = 'origin'
      continue
    }

    // End of record
    if (line.startsWith('//')) {
      break
    }

    // Parse features
    if (section === 'features') {
      // New feature (starts at column 5, not with /)
      const featureMatch = line.match(/^     (\w+)\s+(.+)$/)
      if (featureMatch) {
        if (currentFeature) {
          result.annotations.push(currentFeature)
        }
        const rawLocation = featureMatch[2].trim()
        currentFeature = {
          id: `ann-${result.annotations.length}`,
          type: featureMatch[1],
          span: convertLocation(rawLocation),
          caption: '',
          attributes: {}
        }
        continue
      }

      // Qualifier line (starts with /)
      if (currentFeature && line.includes('/')) {
        const qualMatch = line.match(/^\s+\/(\w+)=?"?([^"]*)"?$/)
        if (qualMatch) {
          const [, key, value] = qualMatch
          if (key === 'label' || key === 'gene' || key === 'product') {
            currentFeature.caption = value
          }
          currentFeature.attributes[key] = value
        }
      }
    }

    // Parse sequence
    if (section === 'origin') {
      // Sequence lines have format: "   123 atcgatcg atcgatcg..."
      const seqMatch = line.match(/^\s*\d+\s+(.+)$/)
      if (seqMatch) {
        sequenceLines.push(seqMatch[1].replace(/\s+/g, ''))
      }
    }
  }

  // Don't forget the last feature
  if (currentFeature) {
    result.annotations.push(currentFeature)
  }

  // Finalize definition if still pending
  if (definitionLines.length > 0) {
    result.metadata.definition = definitionLines.join(' ')
  }

  // Combine sequence and uppercase
  result.sequence = sequenceLines.join('').toUpperCase()

  // Filter out 'source' annotations (usually not useful to display)
  result.annotations = result.annotations.filter(a => a.type !== 'source')

  return result
}
