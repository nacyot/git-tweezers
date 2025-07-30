import { describe, it, expect } from 'vitest'
import { generateHunkId, getHunkSummary, getHunkStats } from '../../src/core/hunk-id.js'
import type { ParsedHunk } from '../../src/core/diff-parser.js'
import type { ExtendedLineChange } from '../../src/types/extended-diff.js'

describe('hunk-id', () => {
  const createMockHunk = (changes: Array<{ type: string; content: string }>): ParsedHunk => ({
    index: 1,
    header: '@@ -1,5 +1,7 @@',
    oldStart: 1,
    oldLines: 5,
    newStart: 1,
    newLines: 7,
    changes: changes.map(c => ({ ...c, eol: true } as ExtendedLineChange)),
  })

  describe('generateHunkId', () => {
    it('should generate consistent ID for same hunk', () => {
      const hunk = createMockHunk([
        { type: 'UnchangedLine', content: 'const a = 1' },
        { type: 'DeletedLine', content: 'const b = 2' },
        { type: 'AddedLine', content: 'const b = 3' },
      ])
      
      const id1 = generateHunkId(hunk, 'test.js')
      const id2 = generateHunkId(hunk, 'test.js')
      
      expect(id1).toBe(id2)
      expect(id1).toHaveLength(4)
    })

    it('should generate different IDs for different files', () => {
      const hunk = createMockHunk([
        { type: 'AddedLine', content: 'console.log("test")' },
      ])
      
      const id1 = generateHunkId(hunk, 'file1.js')
      const id2 = generateHunkId(hunk, 'file2.js')
      
      expect(id1).not.toBe(id2)
    })

    it('should generate different IDs for different content', () => {
      const hunk1 = createMockHunk([
        { type: 'AddedLine', content: 'const a = 1' },
      ])
      const hunk2 = createMockHunk([
        { type: 'AddedLine', content: 'const a = 2' },
      ])
      
      const id1 = generateHunkId(hunk1, 'test.js')
      const id2 = generateHunkId(hunk2, 'test.js')
      
      expect(id1).not.toBe(id2)
    })
  })

  describe('getHunkSummary', () => {
    it('should extract first meaningful change', () => {
      const hunk = createMockHunk([
        { type: 'UnchangedLine', content: '' },
        { type: 'AddedLine', content: '  ' },
        { type: 'AddedLine', content: 'const newFunction = () => {}' },
      ])
      
      const summary = getHunkSummary(hunk)
      expect(summary).toBe('const newFunction = () => {}')
    })

    it('should truncate long content', () => {
      const longContent = 'a'.repeat(60)
      const hunk = createMockHunk([
        { type: 'DeletedLine', content: longContent },
      ])
      
      const summary = getHunkSummary(hunk)
      expect(summary).toBe('a'.repeat(50) + '...')
    })

    it('should return empty string when no meaningful changes', () => {
      const hunk = createMockHunk([
        { type: 'UnchangedLine', content: 'unchanged' },
        { type: 'AddedLine', content: '  ' },
      ])
      
      const summary = getHunkSummary(hunk)
      expect(summary).toBe('')
    })
  })

  describe('getHunkStats', () => {
    it('should count additions and deletions', () => {
      const hunk = createMockHunk([
        { type: 'UnchangedLine', content: 'unchanged' },
        { type: 'AddedLine', content: 'added 1' },
        { type: 'AddedLine', content: 'added 2' },
        { type: 'DeletedLine', content: 'deleted' },
      ])
      
      const stats = getHunkStats(hunk)
      expect(stats).toEqual({ additions: 2, deletions: 1 })
    })

    it('should return zeros for unchanged hunk', () => {
      const hunk = createMockHunk([
        { type: 'UnchangedLine', content: 'unchanged 1' },
        { type: 'UnchangedLine', content: 'unchanged 2' },
      ])
      
      const stats = getHunkStats(hunk)
      expect(stats).toEqual({ additions: 0, deletions: 0 })
    })
  })
})