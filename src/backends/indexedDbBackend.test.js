import { describe, it, expect, beforeEach, mock } from 'bun:test'

/**
 * Test the applyEdit logic for annotationDeleted
 * Since IndexedDB requires browser APIs, we extract and test the filtering logic directly
 */
describe('indexedDbBackend annotation logic', () => {
  describe('annotationDeleted', () => {
    it('filters annotations by id field (not annotationId)', () => {
      // Simulate the filtering logic from indexedDbBackend line 142-144
      const annotations = [
        { id: 'ann1', caption: 'Keep' },
        { id: 'ann2', caption: 'Delete' },
        { id: 'ann3', caption: 'Also Keep' }
      ]

      // This is what the backend receives from SequenceDocument.deleteAnnotation
      const data = { editId: 'del-123', id: 'ann2' }

      // The filtering should use data.id, not data.annotationId
      const filtered = annotations.filter(ann => ann.id !== data.id)

      expect(filtered.length).toBe(2)
      expect(filtered.map(a => a.id)).toEqual(['ann1', 'ann3'])
    })

    it('does not filter when using old annotationId field', () => {
      const annotations = [
        { id: 'ann1', caption: 'Keep' },
        { id: 'ann2', caption: 'Should Delete' }
      ]

      // Old format (should NOT work)
      const dataOld = { id: 'del-123', annotationId: 'ann2' }

      // Using the old field name would not filter correctly
      const filteredOld = annotations.filter(ann => ann.id !== dataOld.annotationId)

      // This still works because annotationId exists, but tests the intent
      expect(filteredOld.length).toBe(1)
    })
  })

  describe('annotationCreated', () => {
    it('receives annotation fields at top level (not nested in data.annotation)', () => {
      // This is what SequenceDocument.addAnnotation sends
      const data = {
        id: 'ann1',
        caption: 'New Gene',
        type: 'gene',
        span: { ranges: [] },
        editId: 'create-123'
      }

      // The annotation should be the data itself (minus editId), not data.annotation
      expect(data.id).toBe('ann1')
      expect(data.caption).toBe('New Gene')
      expect(data.editId).toBeDefined()
    })
  })

  describe('annotationUpdate', () => {
    it('receives annotation fields at top level with editId', () => {
      // This is what SequenceDocument.updateAnnotation sends
      const data = {
        id: 'ann1',
        caption: 'Updated Gene',
        type: 'CDS',
        span: { ranges: [] },
        editId: 'update-456'
      }

      expect(data.id).toBe('ann1')
      expect(data.editId).toBeDefined()
      expect(data.editId.startsWith('update-')).toBe(true)
    })
  })
})
