import { ref, computed, shallowRef } from 'vue'

/**
 * Core editor state management.
 * Replaces the jQuery Editor class and plugin broadcast system.
 *
 * State lifecycle:
 * 1. Created (no sequence)
 * 2. Sequence loaded (has data)
 * 3. Ready (can render)
 *
 * Note: Selection is NOT managed here. Selection is managed by useSelection
 * composable and owned by SequenceEditor, which provides it to children.
 */
export function useEditorState() {
  // Core data - shallowRef for large sequences to avoid deep reactivity
  const sequence = shallowRef('')
  const title = ref('')
  const annotations = shallowRef([])

  // Editor settings
  const zoomLevel = ref(100)  // bases per line
  const settings = ref({
    vmargin: 10,      // vertical margin
    lmargin: 60,      // left margin (for position numbers)
    rmargin: 20,      // right margin
    linepadding: 20,  // padding between lines
    linetopmargin: 4, // margin above each line (for selection handles)
    contentpadding: 2 // padding between overlapping elements
  })

  // Cursor state (position in sequence where edits occur)
  const cursor = ref(0)

  // Computed properties
  const sequenceLength = computed(() => sequence.value.length)

  const lineCount = computed(() => {
    if (sequenceLength.value === 0) return 0
    return Math.ceil(sequenceLength.value / zoomLevel.value)
  })

  const lines = computed(() => {
    const result = []
    const seq = sequence.value
    const zoom = zoomLevel.value

    for (let i = 0; i < lineCount.value; i++) {
      const start = i * zoom
      const end = Math.min(start + zoom, seq.length)
      result.push({
        index: i,
        start,
        end,
        text: seq.slice(start, end),
        position: start + 1  // 1-based GenBank position for display
      })
    }
    return result
  })

  // Actions
  function setSequence(seq, newTitle = '') {
    sequence.value = seq
    title.value = newTitle
    // Clamp cursor to new sequence length
    cursor.value = Math.min(cursor.value, seq.length)
  }

  function setZoom(level) {
    // Clamp to valid range
    const min = 50
    const max = Math.max(sequence.value.length, 50)
    zoomLevel.value = Math.max(min, Math.min(level, max))
  }

  // Position helpers
  function positionToLine(pos) {
    return Math.floor(pos / zoomLevel.value)
  }

  function positionInLine(pos) {
    return pos % zoomLevel.value
  }

  function lineToPosition(line, linePos = 0) {
    return line * zoomLevel.value + linePos
  }

  // Cursor methods
  function setCursor(pos) {
    cursor.value = Math.max(0, Math.min(pos, sequence.value.length))
  }

  // Editing methods
  function insertAt(position, text) {
    const seq = sequence.value
    sequence.value = seq.slice(0, position) + text + seq.slice(position)
    // Move cursor to end of inserted text
    cursor.value = position + text.length
    return text
  }

  function deleteRange(start, end) {
    if (start === end) return ''
    const seq = sequence.value
    const deleted = seq.slice(start, end)
    sequence.value = seq.slice(0, start) + seq.slice(end)
    // Adjust cursor if it was after the deleted range
    if (cursor.value > end) {
      cursor.value -= (end - start)
    } else if (cursor.value > start) {
      cursor.value = start
    }
    return deleted
  }

  function replaceRange(start, end, text) {
    const seq = sequence.value
    const deleted = seq.slice(start, end)
    sequence.value = seq.slice(0, start) + text + seq.slice(end)
    // Move cursor to end of replacement
    cursor.value = start + text.length
    return deleted
  }

  function backspace() {
    if (cursor.value > 0) {
      deleteRange(cursor.value - 1, cursor.value)
    }
  }

  function deleteForward() {
    if (cursor.value < sequence.value.length) {
      deleteRange(cursor.value, cursor.value + 1)
    }
  }

  return {
    // State
    sequence,
    title,
    annotations,
    zoomLevel,
    settings,
    cursor,

    // Computed
    sequenceLength,
    lineCount,
    lines,

    // Actions
    setSequence,
    setZoom,

    // Cursor
    setCursor,

    // Editing
    insertAt,
    deleteRange,
    replaceRange,
    backspace,
    delete: deleteForward,

    // Helpers
    positionToLine,
    positionInLine,
    lineToPosition
  }
}
