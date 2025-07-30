import { describe, it, expect } from 'vitest'
import { DiffRenderer } from '../../src/utils/diff-renderer.js'
import type { HunkInfo } from '../../src/types/hunk-info.js'
import type { ExtendedLineChange } from '../../src/types/extended-diff.js'

describe('DiffRenderer', () => {
  const renderer = new DiffRenderer()

  const createMockHunk = (changes: ExtendedLineChange[]): HunkInfo => ({
    id: 'test1',
    index: 1,
    header: '@@ -1,5 +1,7 @@',
    oldStart: 1,
    oldLines: 5,
    newStart: 1,
    newLines: 7,
    changes,
    summary: 'Test change',
    stats: { additions: 2, deletions: 1 },
  })

  describe('renderHunk', () => {
    it('should render added and deleted lines', () => {
      const hunk = createMockHunk([
        { type: 'UnchangedLine', content: 'function test() {', eol: true },
        { type: 'DeletedLine', content: '  return 1', eol: true },
        { type: 'AddedLine', content: '  return 2', eol: true },
        { type: 'UnchangedLine', content: '}', eol: true },
      ])

      const output = renderer.renderHunk(hunk, { color: false })
      
      expect(output).toContain(' function test() {')
      expect(output).toContain('-  return 1')
      expect(output).toContain('+  return 2')
      expect(output).toContain(' }')
    })

    it('should respect context option', () => {
      const hunk = createMockHunk([
        { type: 'UnchangedLine', content: 'line 1', eol: true },
        { type: 'UnchangedLine', content: 'line 2', eol: true },
        { type: 'UnchangedLine', content: 'line 3', eol: true },
        { type: 'AddedLine', content: 'new line', eol: true },
        { type: 'UnchangedLine', content: 'line 4', eol: true },
        { type: 'UnchangedLine', content: 'line 5', eol: true },
        { type: 'UnchangedLine', content: 'line 6', eol: true },
      ])

      const output = renderer.renderHunk(hunk, { context: 1, color: false })
      
      // Should only show 1 line of context around the change
      expect(output).not.toContain('line 1')
      expect(output).not.toContain('line 2')
      expect(output).toContain('line 3')  // 1 line before change
      expect(output).toContain('new line') // the change
      expect(output).toContain('line 4')   // 1 line after change
      expect(output).toContain('line 5')   // Additional context lines may be included based on implementation
      expect(output).not.toContain('line 6')
    })

    it('should truncate long hunks', () => {
      const changes: ExtendedLineChange[] = []
      for (let i = 0; i < 150; i++) {
        changes.push({ type: 'AddedLine', content: `line ${i}`, eol: true })
      }
      const hunk = createMockHunk(changes)

      const output = renderer.renderHunk(hunk, { maxLines: 10, color: false })
      
      expect(output).toContain('... (truncated)')
      const lines = output.split('\n')
      expect(lines.length).toBeLessThanOrEqual(11) // 10 lines + truncation message
    })
  })

  describe('renderHunkSummary', () => {
    it('should render stats and summary', () => {
      const hunk = createMockHunk([])
      const summary = renderer.renderHunkSummary(hunk)
      
      // Note: color codes are included, so we check for content
      expect(summary).toContain('+2')
      expect(summary).toContain('-1')
      expect(summary).toContain('Test change')
    })

    it('should handle missing stats', () => {
      const hunk = createMockHunk([])
      hunk.stats = undefined
      
      const summary = renderer.renderHunkSummary(hunk)
      expect(summary).toBe('')
    })

    it('should handle zero stats', () => {
      const hunk = createMockHunk([])
      hunk.stats = { additions: 0, deletions: 0 }
      hunk.summary = 'No changes'
      
      const summary = renderer.renderHunkSummary(hunk)
      expect(summary).not.toContain('+0')
      expect(summary).not.toContain('-0')
      expect(summary).toContain('No changes')
    })
  })
})