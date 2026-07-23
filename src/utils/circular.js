/**
 * Circular view utilities for plasmid map rendering.
 *
 * Coordinate System:
 * - Position 0 is at the TOP of the circle (12 o'clock position)
 * - Positions increase CLOCKWISE around the circle
 * - Angles are in radians: -π/2 at top, 0 at right, π/2 at bottom, π at left
 */

/**
 * Convert a sequence position to an angle on the circle.
 * Position 0 maps to -π/2 (top), positions increase clockwise.
 *
 * @param {number} position - Sequence position (0-based)
 * @param {number} sequenceLength - Total sequence length
 * @returns {number} Angle in radians (-π/2 at top, increasing clockwise)
 */
export function positionToAngle(position, sequenceLength) {
  // Fraction of the circle (0 to 1)
  const fraction = position / sequenceLength
  // Convert to radians: 0 → -π/2 (top), 0.25 → 0 (right), 0.5 → π/2 (bottom), etc.
  return fraction * 2 * Math.PI - Math.PI / 2
}

/**
 * Convert an angle to a sequence position.
 * Inverse of positionToAngle.
 *
 * @param {number} angle - Angle in radians
 * @param {number} sequenceLength - Total sequence length
 * @returns {number} Sequence position (may need rounding for integer positions)
 */
export function angleToPosition(angle, sequenceLength) {
  // Shift so that -π/2 maps to 0
  const shifted = angle + Math.PI / 2
  // Normalize to [0, 2π)
  const normalized = normalizeAngle(shifted)
  // Convert to position
  return (normalized / (2 * Math.PI)) * sequenceLength
}

/**
 * Normalize an angle to the range [0, 2π).
 *
 * @param {number} angle - Angle in radians
 * @returns {number} Normalized angle in [0, 2π)
 */
export function normalizeAngle(angle) {
  const twoPi = 2 * Math.PI
  let normalized = angle % twoPi
  if (normalized < 0) {
    normalized += twoPi
  }
  return normalized
}

/**
 * Convert polar coordinates to Cartesian coordinates.
 *
 * @param {number} cx - Center x
 * @param {number} cy - Center y
 * @param {number} radius - Radius from center
 * @param {number} angle - Angle in radians (0 = right, π/2 = bottom)
 * @returns {{x: number, y: number}} Cartesian coordinates
 */
export function polarToCartesian(cx, cy, radius, angle) {
  return {
    x: cx + radius * Math.cos(angle),
    y: cy + radius * Math.sin(angle)
  }
}

/**
 * Generate an SVG arc path for an annotation or selection.
 *
 * The arc is drawn as a thick band with inner and outer radii.
 * Path order: outer arc (start to end) → end cap → inner arc (end to start) → close
 *
 * @param {number} startPos - Start position in sequence
 * @param {number} endPos - End position in sequence
 * @param {number} sequenceLength - Total sequence length
 * @param {number} cx - Center x of circle
 * @param {number} cy - Center y of circle
 * @param {number} radius - Center radius of the arc band
 * @param {number} thickness - Thickness of the arc band
 * @param {boolean|number} [wrapAroundOrOffset=false] - If boolean: whether arc goes the "long way". If number: angle offset in radians.
 * @param {number} [angleOffset=0] - Angle offset in radians (for origin rotation)
 * @returns {string} SVG path string
 */
export function getArcPath(startPos, endPos, sequenceLength, cx, cy, radius, thickness, wrapAroundOrOffset = false, angleOffset = 0) {
  // Handle backward compatibility: if wrapAroundOrOffset is a number, it's the angle offset
  let wrapAround = false
  let offset = angleOffset
  if (typeof wrapAroundOrOffset === 'number') {
    offset = wrapAroundOrOffset
  } else {
    wrapAround = wrapAroundOrOffset
  }

  // Handle zero-length arc
  if (startPos === endPos && !wrapAround) {
    return ''
  }

  // Ensure inner radius stays positive (at least 1px)
  const halfThickness = thickness / 2
  const innerRadius = Math.max(1, radius - halfThickness)
  const outerRadius = radius + halfThickness

  const startAngle = positionToAngle(startPos, sequenceLength) + offset
  const endAngle = positionToAngle(endPos, sequenceLength) + offset

  // For very small arcs (< 1 degree), use simple polygon instead of arcs
  // SVG arcs behave unpredictably when start and end points are nearly identical
  const bpSpan = endPos - startPos
  const fraction = bpSpan / sequenceLength
  // 1 degree = 1/360 ≈ 0.00278
  if (!wrapAround && fraction > 0 && fraction < 1 / 360) {
    const outerStart = polarToCartesian(cx, cy, outerRadius, startAngle)
    const outerEnd = polarToCartesian(cx, cy, outerRadius, endAngle)
    const innerStart = polarToCartesian(cx, cy, innerRadius, startAngle)
    const innerEnd = polarToCartesian(cx, cy, innerRadius, endAngle)
    return [
      `M ${outerStart.x},${outerStart.y}`,
      `L ${outerEnd.x},${outerEnd.y}`,
      `L ${innerEnd.x},${innerEnd.y}`,
      `L ${innerStart.x},${innerStart.y}`,
      'Z'
    ].join(' ')
  }

  // Calculate arc span
  let arcSpan = endAngle - startAngle
  if (wrapAround) {
    // For wrap-around, go the long way
    if (arcSpan > 0) {
      arcSpan = arcSpan - 2 * Math.PI
    }
  } else {
    // Normal case: ensure positive span
    if (arcSpan < 0) {
      arcSpan += 2 * Math.PI
    }
  }

  // Calculate points
  const outerStart = polarToCartesian(cx, cy, outerRadius, startAngle)
  const outerEnd = polarToCartesian(cx, cy, outerRadius, endAngle)
  const innerStart = polarToCartesian(cx, cy, innerRadius, startAngle)
  const innerEnd = polarToCartesian(cx, cy, innerRadius, endAngle)

  // Large arc flag: 1 if span > 180 degrees
  const largeArcFlag = Math.abs(arcSpan) > Math.PI ? 1 : 0
  // Sweep flag: 1 for clockwise (when arcSpan is positive)
  const sweepFlag = arcSpan >= 0 ? 1 : 0
  const reverseSweepFlag = arcSpan >= 0 ? 0 : 1

  // Build path: outer arc → end cap → inner arc (reversed) → close
  return [
    `M ${outerStart.x},${outerStart.y}`,
    `A ${outerRadius},${outerRadius} 0 ${largeArcFlag},${sweepFlag} ${outerEnd.x},${outerEnd.y}`,
    `L ${innerEnd.x},${innerEnd.y}`,
    `A ${innerRadius},${innerRadius} 0 ${largeArcFlag},${reverseSweepFlag} ${innerStart.x},${innerStart.y}`,
    'Z'
  ].join(' ')
}

/**
 * Generate an SVG arc path for an arrow annotation.
 * Like getArcPath but with an arrowhead at one end.
 *
 * @param {number} startPos - Start position in sequence
 * @param {number} endPos - End position in sequence
 * @param {number} sequenceLength - Total sequence length
 * @param {number} cx - Center x of circle
 * @param {number} cy - Center y of circle
 * @param {number} radius - Center radius of the arc band
 * @param {number} thickness - Thickness of the arc band
 * @param {number} orientation - 1 for plus (arrow at end), -1 for minus (arrow at start), 0 for none
 * @param {number} [arrowLength=8] - Length of arrowhead in pixels
 * @param {number} [angleOffset=0] - Angle offset in radians (for origin rotation)
 * @returns {string} SVG path string
 */
export function getArrowArcPath(startPos, endPos, sequenceLength, cx, cy, radius, thickness, orientation, arrowLength = 8, angleOffset = 0) {
  // Handle zero-length arc
  if (startPos === endPos) {
    return ''
  }

  // Ensure inner radius stays positive (at least 1px)
  const halfThickness = thickness / 2
  const innerRadius = Math.max(1, radius - halfThickness)
  const outerRadius = radius + halfThickness

  const startAngle = positionToAngle(startPos, sequenceLength) + angleOffset
  const endAngle = positionToAngle(endPos, sequenceLength) + angleOffset

  // Calculate arc span (ensure positive for clockwise)
  let arcSpan = endAngle - startAngle
  if (arcSpan < 0) {
    arcSpan += 2 * Math.PI
  }

  // Arrow takes up some angular space
  const arrowAngle = arrowLength / radius

  // Minimum angle threshold: 1 degree + arrow angle
  // If arc is too small, fall back to simple polygon (no arrow)
  const oneDegree = Math.PI / 180
  const minAngleForArrow = oneDegree + arrowAngle

  if (arcSpan < minAngleForArrow) {
    // Too small for arrow - draw simple polygon
    const outerStart = polarToCartesian(cx, cy, outerRadius, startAngle)
    const outerEnd = polarToCartesian(cx, cy, outerRadius, endAngle)
    const innerStart = polarToCartesian(cx, cy, innerRadius, startAngle)
    const innerEnd = polarToCartesian(cx, cy, innerRadius, endAngle)
    return [
      `M ${outerStart.x},${outerStart.y}`,
      `L ${outerEnd.x},${outerEnd.y}`,
      `L ${innerEnd.x},${innerEnd.y}`,
      `L ${innerStart.x},${innerStart.y}`,
      'Z'
    ].join(' ')
  }

  // Large arc flag: 1 if span > 180 degrees
  const largeArcFlag = arcSpan > Math.PI ? 1 : 0

  // No arrow - simple arc
  if (orientation === 0) {
    return getArcPath(startPos, endPos, sequenceLength, cx, cy, radius, thickness, false, angleOffset)
  }

  // Calculate base points
  const outerStart = polarToCartesian(cx, cy, outerRadius, startAngle)
  const innerStart = polarToCartesian(cx, cy, innerRadius, startAngle)
  const outerEnd = polarToCartesian(cx, cy, outerRadius, endAngle)
  const innerEnd = polarToCartesian(cx, cy, innerRadius, endAngle)

  // Arrow at end (plus strand)
  if (orientation === 1) {
    // Arrow body ends before the arrow tip
    const bodyEndAngle = endAngle - arrowAngle
    const bodyArcSpan = bodyEndAngle - startAngle
    const bodyLargeArcFlag = (bodyArcSpan > Math.PI || (bodyArcSpan < 0 && bodyArcSpan + 2 * Math.PI > Math.PI)) ? 1 : 0

    const outerBodyEnd = polarToCartesian(cx, cy, outerRadius, bodyEndAngle)
    const innerBodyEnd = polarToCartesian(cx, cy, innerRadius, bodyEndAngle)
    const arrowTip = polarToCartesian(cx, cy, radius, endAngle)
    // Wider arrow base (ears extend by thickness/4 on each side)
    const arrowOuterBase = polarToCartesian(cx, cy, outerRadius + thickness / 4, bodyEndAngle)
    const arrowInnerBase = polarToCartesian(cx, cy, innerRadius - thickness / 4, bodyEndAngle)

    return [
      `M ${outerStart.x},${outerStart.y}`,
      `A ${outerRadius},${outerRadius} 0 ${bodyLargeArcFlag},1 ${outerBodyEnd.x},${outerBodyEnd.y}`,
      `L ${arrowOuterBase.x},${arrowOuterBase.y}`,
      `L ${arrowTip.x},${arrowTip.y}`,
      `L ${arrowInnerBase.x},${arrowInnerBase.y}`,
      `L ${innerBodyEnd.x},${innerBodyEnd.y}`,
      `A ${innerRadius},${innerRadius} 0 ${bodyLargeArcFlag},0 ${innerStart.x},${innerStart.y}`,
      'Z'
    ].join(' ')
  }

  // Arrow at start (minus strand)
  if (orientation === -1) {
    // Arrow body starts after the arrow tip
    const bodyStartAngle = startAngle + arrowAngle
    const bodyArcSpan = endAngle - bodyStartAngle
    const bodyLargeArcFlag = (bodyArcSpan > Math.PI || (bodyArcSpan < 0 && bodyArcSpan + 2 * Math.PI > Math.PI)) ? 1 : 0

    const outerBodyStart = polarToCartesian(cx, cy, outerRadius, bodyStartAngle)
    const innerBodyStart = polarToCartesian(cx, cy, innerRadius, bodyStartAngle)
    const arrowTip = polarToCartesian(cx, cy, radius, startAngle)
    // Wider arrow base (ears extend by thickness/4 on each side)
    const arrowOuterBase = polarToCartesian(cx, cy, outerRadius + thickness / 4, bodyStartAngle)
    const arrowInnerBase = polarToCartesian(cx, cy, innerRadius - thickness / 4, bodyStartAngle)

    return [
      `M ${arrowTip.x},${arrowTip.y}`,
      `L ${arrowOuterBase.x},${arrowOuterBase.y}`,
      `L ${outerBodyStart.x},${outerBodyStart.y}`,
      `A ${outerRadius},${outerRadius} 0 ${bodyLargeArcFlag},1 ${outerEnd.x},${outerEnd.y}`,
      `L ${innerEnd.x},${innerEnd.y}`,
      `A ${innerRadius},${innerRadius} 0 ${bodyLargeArcFlag},0 ${innerBodyStart.x},${innerBodyStart.y}`,
      `L ${arrowInnerBase.x},${arrowInnerBase.y}`,
      'Z'
    ].join(' ')
  }

  return ''
}

/**
 * Calculate the angular span between two positions (always positive, clockwise).
 *
 * @param {number} startPos - Start position
 * @param {number} endPos - End position
 * @param {number} sequenceLength - Total sequence length
 * @returns {number} Angular span in radians (0 to 2π)
 */
export function getAngularSpan(startPos, endPos, sequenceLength) {
  const startAngle = positionToAngle(startPos, sequenceLength)
  const endAngle = positionToAngle(endPos, sequenceLength)
  let span = endAngle - startAngle
  if (span < 0) {
    span += 2 * Math.PI
  }
  return span
}

/**
 * Integrate one frame of a circular drag into a cumulative signed offset.
 *
 * Pointer positions on a circle wrap to `[0, sequenceLength)`, so the raw
 * position alone cannot tell a forward drag past the origin from a backward
 * one. Instead we accumulate the *shortest step* between the previous and
 * current position each frame: a step is normalized to
 * `(-sequenceLength/2, sequenceLength/2]`, so crossing the origin is just a
 * small step of the correct sign and never a near-full-circle jump. The
 * running sum is the signed arc swept from the anchor (positive = clockwise/
 * plus strand, negative = counter-clockwise/minus strand), and its magnitude
 * is the true selection length — no origin-crossing heuristic required.
 *
 * @param {number} prevOffset - Cumulative offset so far
 * @param {number} prevPos - Previous pointer position (0..sequenceLength)
 * @param {number} pos - Current pointer position (0..sequenceLength)
 * @param {number} sequenceLength - Total sequence length
 * @returns {number} New cumulative signed offset
 */
export function circularDragOffset(prevOffset, prevPos, pos, sequenceLength) {
  let step = pos - prevPos
  const half = sequenceLength / 2
  if (step > half) {
    step -= sequenceLength
  } else if (step < -half) {
    step += sequenceLength
  }
  return prevOffset + step
}

/**
 * Convert an anchor and a cumulative signed drag offset into ordered segment
 * descriptors, splitting into two segments when the selection crosses the
 * origin (a round-the-horn selection).
 *
 * Segment order follows biological reading order for cut/paste:
 * - Forward (offset >= 0): high segment (X..seqLen) first, then low (0..Y).
 * - Backward (offset < 0): low segment (0..Y) first, then high (X..seqLen).
 *
 * The magnitude of the offset is clamped to the sequence length (a selection
 * cannot exceed the whole plasmid). Each descriptor is a plain object
 * `{start, end, orientation}`; callers turn these into `Range` instances.
 *
 * @param {number} anchor - Drag anchor position (mousedown)
 * @param {number} offset - Cumulative signed offset from circularDragOffset
 * @param {number} sequenceLength - Total sequence length
 * @returns {Array<{start: number, end: number, orientation: number}>}
 */
export function offsetToSegments(anchor, offset, sequenceLength) {
  const orientation = offset >= 0 ? 1 : -1
  const magnitude = Math.min(Math.abs(offset), sequenceLength)

  if (orientation === 1) {
    const end = anchor + magnitude
    if (end <= sequenceLength) {
      return [{ start: anchor, end, orientation }]
    }
    // Wrapped forward across the origin: high segment first, then low.
    return [
      { start: anchor, end: sequenceLength, orientation },
      { start: 0, end: end - sequenceLength, orientation }
    ]
  }

  const start = anchor - magnitude
  if (start >= 0) {
    return [{ start, end: anchor, orientation }]
  }
  // Wrapped backward across the origin: low segment first, then high.
  return [
    { start: 0, end: anchor, orientation },
    { start: sequenceLength + start, end: sequenceLength, orientation }
  ]
}

/**
 * Convert mouse coordinates to sequence position on the circle.
 *
 * @param {number} mouseX - Mouse x coordinate
 * @param {number} mouseY - Mouse y coordinate
 * @param {number} cx - Circle center x
 * @param {number} cy - Circle center y
 * @param {number} sequenceLength - Total sequence length
 * @returns {number} Sequence position (rounded to integer)
 */
export function mouseToPosition(mouseX, mouseY, cx, cy, sequenceLength) {
  const dx = mouseX - cx
  const dy = mouseY - cy
  const angle = Math.atan2(dy, dx)
  const position = angleToPosition(angle, sequenceLength)
  return Math.round(position) % sequenceLength
}

/**
 * Calculate the row radius for stacked annotations.
 * Row 0 is closest to the backbone, higher rows are further out.
 *
 * @param {number} rowIndex - Row index (0-based)
 * @param {number} baseRadius - Radius of the backbone circle
 * @param {number} annotationHeight - Height of each annotation row
 * @param {number} padding - Padding between rows
 * @returns {number} Radius for this row's center
 */
export function getRowRadius(rowIndex, baseRadius, annotationHeight, padding = 2) {
  return baseRadius + annotationHeight / 2 + padding + rowIndex * (annotationHeight + padding)
}

/**
 * Generate an SVG arc path for text placement (single line, not a band).
 * Returns a path that text can follow using <textPath>.
 *
 * @param {number} startPos - Start position in sequence
 * @param {number} endPos - End position in sequence
 * @param {number} sequenceLength - Total sequence length
 * @param {number} cx - Center x of circle
 * @param {number} cy - Center y of circle
 * @param {number} radius - Radius for the text path
 * @param {boolean} [reverse=false] - If true, draw arc in reverse direction (for bottom-half text)
 * @param {number} [angleOffset=0] - Angle offset in radians (for origin rotation)
 * @returns {string} SVG path string
 */
export function getTextArcPath(startPos, endPos, sequenceLength, cx, cy, radius, reverse = false, angleOffset = 0) {
  if (startPos === endPos) {
    return ''
  }

  const startAngle = positionToAngle(startPos, sequenceLength) + angleOffset
  const endAngle = positionToAngle(endPos, sequenceLength) + angleOffset

  // Calculate arc span
  let arcSpan = endAngle - startAngle
  if (arcSpan < 0) {
    arcSpan += 2 * Math.PI
  }

  const largeArcFlag = arcSpan > Math.PI ? 1 : 0

  if (reverse) {
    // Draw from end to start (for text on bottom half to be readable)
    const start = polarToCartesian(cx, cy, radius, endAngle)
    const end = polarToCartesian(cx, cy, radius, startAngle)
    return `M ${start.x},${start.y} A ${radius},${radius} 0 ${largeArcFlag},0 ${end.x},${end.y}`
  } else {
    // Draw from start to end (normal clockwise)
    const start = polarToCartesian(cx, cy, radius, startAngle)
    const end = polarToCartesian(cx, cy, radius, endAngle)
    return `M ${start.x},${start.y} A ${radius},${radius} 0 ${largeArcFlag},1 ${end.x},${end.y}`
  }
}
