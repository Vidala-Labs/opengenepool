import { describe, it, expect } from 'vitest'
import { useEditorState } from './useEditorState.js'

describe('useEditorState', () => {
  describe('initial state', () => {
    it('starts with empty sequence', () => {
      const editor = useEditorState()
      expect(editor.sequence.value).toBe('')
      expect(editor.sequenceLength.value).toBe(0)
    })

    it('has default zoom level of 100', () => {
      const editor = useEditorState()
      expect(editor.zoomLevel.value).toBe(100)
    })

    it('has zero lines when empty', () => {
      const editor = useEditorState()
      expect(editor.lineCount.value).toBe(0)
      expect(editor.lines.value).toEqual([])
    })
  })

  describe('setSequence', () => {
    it('sets the sequence', () => {
      const editor = useEditorState()
      editor.setSequence('ATCGATCG')
      expect(editor.sequence.value).toBe('ATCGATCG')
      expect(editor.sequenceLength.value).toBe(8)
    })

    it('sets the title', () => {
      const editor = useEditorState()
      editor.setSequence('ATCG', 'My Sequence')
      expect(editor.title.value).toBe('My Sequence')
    })

  })

  describe('lineCount', () => {
    it('calculates lines based on zoom level', () => {
      const editor = useEditorState()
      editor.setSequence('A'.repeat(250))
      expect(editor.zoomLevel.value).toBe(100)
      expect(editor.lineCount.value).toBe(3)  // 250 / 100 = 2.5 -> 3 lines
    })

    it('updates when zoom changes', () => {
      const editor = useEditorState()
      editor.setSequence('A'.repeat(250))
      expect(editor.lineCount.value).toBe(3)

      editor.setZoom(50)
      expect(editor.lineCount.value).toBe(5)  // 250 / 50 = 5 lines
    })
  })

  describe('lines', () => {
    it('splits sequence into line objects', () => {
      const editor = useEditorState()
      // Use a longer sequence so we can set zoom to 50 (minimum)
      // 150 bases at zoom 50 = 3 lines
      const seq = 'A'.repeat(150)
      editor.setSequence(seq)
      editor.setZoom(50)

      const lines = editor.lines.value
      expect(lines.length).toBe(3)

      expect(lines[0]).toEqual({
        index: 0,
        start: 0,
        end: 50,
        text: seq.slice(0, 50),
        position: 1  // GenBank 1-indexed
      })

      expect(lines[1]).toEqual({
        index: 1,
        start: 50,
        end: 100,
        text: seq.slice(50, 100),
        position: 51  // GenBank 1-indexed
      })

      expect(lines[2]).toEqual({
        index: 2,
        start: 100,
        end: 150,
        text: seq.slice(100, 150),
        position: 101  // GenBank 1-indexed
      })
    })
  })

  describe('setZoom', () => {
    it('sets zoom level', () => {
      const editor = useEditorState()
      editor.setSequence('A'.repeat(1000))  // need sequence for zoom to work
      editor.setZoom(200)
      expect(editor.zoomLevel.value).toBe(200)
    })

    it('clamps to minimum of 50', () => {
      const editor = useEditorState()
      editor.setZoom(10)
      expect(editor.zoomLevel.value).toBe(50)
    })

    it('clamps to sequence length for small sequences', () => {
      const editor = useEditorState()
      editor.setSequence('ATCG')  // 4 bases
      editor.setZoom(1000)
      // Max is 50 (minimum) since sequence is shorter
      expect(editor.zoomLevel.value).toBe(50)
    })

    it('allows zoom up to sequence length for large sequences', () => {
      const editor = useEditorState()
      editor.setSequence('A'.repeat(10000))
      editor.setZoom(5000)
      expect(editor.zoomLevel.value).toBe(5000)
    })
  })

  describe('position helpers', () => {
    it('positionToLine converts position to line index', () => {
      const editor = useEditorState()
      editor.setSequence('A'.repeat(500))
      editor.setZoom(100)

      expect(editor.positionToLine(0)).toBe(0)
      expect(editor.positionToLine(50)).toBe(0)
      expect(editor.positionToLine(100)).toBe(1)
      expect(editor.positionToLine(250)).toBe(2)
    })

    it('positionInLine gets position within line', () => {
      const editor = useEditorState()
      editor.setSequence('A'.repeat(500))
      editor.setZoom(100)

      expect(editor.positionInLine(0)).toBe(0)
      expect(editor.positionInLine(50)).toBe(50)
      expect(editor.positionInLine(150)).toBe(50)
    })

    it('lineToPosition converts line and position to absolute position', () => {
      const editor = useEditorState()
      editor.setSequence('A'.repeat(500))
      editor.setZoom(100)

      expect(editor.lineToPosition(0, 0)).toBe(0)
      expect(editor.lineToPosition(0, 50)).toBe(50)
      expect(editor.lineToPosition(1, 0)).toBe(100)
      expect(editor.lineToPosition(2, 25)).toBe(225)
    })
  })

  describe('cursor', () => {
    it('starts at position 0', () => {
      const editor = useEditorState()
      expect(editor.cursor.value).toBe(0)
    })

    it('setCursor sets cursor position', () => {
      const editor = useEditorState()
      editor.setSequence('ATCGATCG')
      editor.setCursor(5)
      expect(editor.cursor.value).toBe(5)
    })

    it('clamps cursor to sequence bounds', () => {
      const editor = useEditorState()
      editor.setSequence('ATCG')
      editor.setCursor(10)
      expect(editor.cursor.value).toBe(4) // end of sequence

      editor.setCursor(-5)
      expect(editor.cursor.value).toBe(0)
    })

    it('adjusts cursor when sequence changes', () => {
      const editor = useEditorState()
      editor.setSequence('ATCGATCG')
      editor.setCursor(6)
      expect(editor.cursor.value).toBe(6)

      editor.setSequence('AT') // shorter
      expect(editor.cursor.value).toBe(2) // clamped to new length
    })
  })

  describe('insertAt', () => {
    it('inserts text at position', () => {
      const editor = useEditorState()
      editor.setSequence('ATCG')
      editor.insertAt(2, 'GGG')
      expect(editor.sequence.value).toBe('ATGGGCG')
    })

    it('inserts at beginning', () => {
      const editor = useEditorState()
      editor.setSequence('ATCG')
      editor.insertAt(0, 'TTT')
      expect(editor.sequence.value).toBe('TTTATCG')
    })

    it('inserts at end', () => {
      const editor = useEditorState()
      editor.setSequence('ATCG')
      editor.insertAt(4, 'AAA')
      expect(editor.sequence.value).toBe('ATCGAAA')
    })

    it('moves cursor after inserted text', () => {
      const editor = useEditorState()
      editor.setSequence('ATCG')
      editor.setCursor(2)
      editor.insertAt(2, 'GGG')
      expect(editor.cursor.value).toBe(5) // 2 + 3
    })

    it('returns the inserted text', () => {
      const editor = useEditorState()
      editor.setSequence('ATCG')
      const result = editor.insertAt(2, 'GGG')
      expect(result).toBe('GGG')
    })
  })

  describe('deleteRange', () => {
    it('deletes bases between start and end', () => {
      const editor = useEditorState()
      editor.setSequence('ATCGATCG')
      editor.deleteRange(2, 5)
      expect(editor.sequence.value).toBe('ATTCG')
    })

    it('deletes from beginning', () => {
      const editor = useEditorState()
      editor.setSequence('ATCGATCG')
      editor.deleteRange(0, 3)
      expect(editor.sequence.value).toBe('GATCG')
    })

    it('deletes to end', () => {
      const editor = useEditorState()
      editor.setSequence('ATCGATCG')
      editor.deleteRange(5, 8)
      expect(editor.sequence.value).toBe('ATCGA')
    })

    it('moves cursor to start of deleted range', () => {
      const editor = useEditorState()
      editor.setSequence('ATCGATCG')
      editor.setCursor(6)
      editor.deleteRange(2, 5)
      expect(editor.cursor.value).toBe(3) // cursor was after deletion, adjusted
    })

    it('returns the deleted text', () => {
      const editor = useEditorState()
      editor.setSequence('ATCGATCG')
      const result = editor.deleteRange(2, 5)
      expect(result).toBe('CGA')
    })

    it('handles empty deletion', () => {
      const editor = useEditorState()
      editor.setSequence('ATCG')
      editor.deleteRange(2, 2)
      expect(editor.sequence.value).toBe('ATCG')
    })
  })

  describe('replaceRange', () => {
    it('replaces range with new text', () => {
      const editor = useEditorState()
      editor.setSequence('ATCGATCG')
      editor.replaceRange(2, 5, 'XXX')
      expect(editor.sequence.value).toBe('ATXXXTCG')
    })

    it('can replace with shorter text', () => {
      const editor = useEditorState()
      editor.setSequence('ATCGATCG')
      editor.replaceRange(2, 6, 'X')
      expect(editor.sequence.value).toBe('ATXCG')
    })

    it('can replace with longer text', () => {
      const editor = useEditorState()
      editor.setSequence('ATCGATCG')
      editor.replaceRange(2, 3, 'XXXXX')
      expect(editor.sequence.value).toBe('ATXXXXXGATCG')
    })

    it('moves cursor to end of replacement', () => {
      const editor = useEditorState()
      editor.setSequence('ATCGATCG')
      editor.setCursor(2)
      editor.replaceRange(2, 5, 'XXX')
      expect(editor.cursor.value).toBe(5) // 2 + 3
    })

    it('returns the replaced text', () => {
      const editor = useEditorState()
      editor.setSequence('ATCGATCG')
      const result = editor.replaceRange(2, 5, 'XXX')
      expect(result).toBe('CGA')
    })
  })

  describe('backspace', () => {
    it('deletes character before cursor', () => {
      const editor = useEditorState()
      editor.setSequence('ATCG')
      editor.setCursor(2)
      editor.backspace()
      expect(editor.sequence.value).toBe('ACG')
      expect(editor.cursor.value).toBe(1)
    })

    it('does nothing at position 0', () => {
      const editor = useEditorState()
      editor.setSequence('ATCG')
      editor.setCursor(0)
      editor.backspace()
      expect(editor.sequence.value).toBe('ATCG')
      expect(editor.cursor.value).toBe(0)
    })
  })

  describe('delete (forward)', () => {
    it('deletes character after cursor', () => {
      const editor = useEditorState()
      editor.setSequence('ATCG')
      editor.setCursor(1)
      editor.delete()
      expect(editor.sequence.value).toBe('ACG')
      expect(editor.cursor.value).toBe(1)
    })

    it('does nothing at end of sequence', () => {
      const editor = useEditorState()
      editor.setSequence('ATCG')
      editor.setCursor(4)
      editor.delete()
      expect(editor.sequence.value).toBe('ATCG')
    })
  })
})
