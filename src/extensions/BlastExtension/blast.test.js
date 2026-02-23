import { describe, it, expect } from 'bun:test'
import { generateBlastnUrl, generateBlastpUrl } from './blast.js'

describe('BLAST URL Generation', () => {
  describe('generateBlastnUrl', () => {
    it('generates correct blastn URL for DNA sequence', () => {
      const url = generateBlastnUrl('ATGCATGC')
      expect(url).toContain('https://blast.ncbi.nlm.nih.gov/Blast.cgi')
      expect(url).toContain('PROGRAM=blastn')
      expect(url).toContain('PAGE_TYPE=BlastSearch')
      expect(url).toContain('QUERY=ATGCATGC')
    })

    it('URL-encodes sequences with special characters', () => {
      const url = generateBlastnUrl('ATG CAT GC')
      expect(url).toContain('QUERY=ATG+CAT+GC')
    })
  })

  describe('generateBlastpUrl', () => {
    it('generates correct blastp URL for protein sequence', () => {
      const url = generateBlastpUrl('MKTAYIAKQRQISFVK')
      expect(url).toContain('https://blast.ncbi.nlm.nih.gov/Blast.cgi')
      expect(url).toContain('PROGRAM=blastp')
      expect(url).toContain('PAGE_TYPE=BlastSearch')
      expect(url).toContain('QUERY=MKTAYIAKQRQISFVK')
    })

    it('handles stop codons in protein sequence', () => {
      const url = generateBlastpUrl('MKT*AYI')
      expect(url).toContain('QUERY=MKT')
      expect(url).toContain('AYI')
    })
  })
})
