import { describe, it, expect } from 'vitest'
import { LineMapper } from '../../src/core/line-mapper.js'
import type { ParsedHunk } from '../../src/core/diff-parser.js'
import type { ExtendedLineChange } from '../../src/types/extended-diff.js'

function makeChange(type: 'AddedLine' | 'DeletedLine' | 'UnchangedLine', content: string, eol = true): ExtendedLineChange {
  return { type, content, eol }
}

function makeHunk(overrides: Partial<ParsedHunk> & { changes: ExtendedLineChange[] }): ParsedHunk {
  return {
    index: 1,
    header: '@@ -1,3 +1,3 @@',
    oldStart: 1,
    oldLines: 3,
    newStart: 1,
    newLines: 3,
    ...overrides,
  }
}

describe('LineMapper', () => {
  describe('mapNewLinesToChanges', () => {
    it('should map added lines to new line numbers', () => {
      const hunk = makeHunk({
        oldStart: 1, newStart: 1,
        changes: [
          makeChange('UnchangedLine', 'ctx'),
          makeChange('AddedLine', 'new'),
          makeChange('UnchangedLine', 'ctx2'),
        ],
      })
      const map = LineMapper.mapNewLinesToChanges(hunk)
      expect(map.get(1)?.type).toBe('UnchangedLine')
      expect(map.get(2)?.type).toBe('AddedLine')
      expect(map.get(3)?.type).toBe('UnchangedLine')
    })

    it('should skip deleted lines in new-line mapping', () => {
      const hunk = makeHunk({
        oldStart: 1, newStart: 1,
        changes: [
          makeChange('DeletedLine', 'old'),
          makeChange('AddedLine', 'new'),
        ],
      })
      const map = LineMapper.mapNewLinesToChanges(hunk)
      // Deleted line has no new-file number
      expect(map.size).toBe(1)
      expect(map.get(1)?.type).toBe('AddedLine')
      expect(map.get(1)?.content).toBe('new')
    })

    it('should handle replacement pattern (delete+add)', () => {
      const hunk = makeHunk({
        oldStart: 1, newStart: 1,
        changes: [
          makeChange('DeletedLine', 'old A'),
          makeChange('DeletedLine', 'old B'),
          makeChange('AddedLine', 'new A'),
          makeChange('AddedLine', 'new B'),
        ],
      })
      const map = LineMapper.mapNewLinesToChanges(hunk)
      expect(map.size).toBe(2)
      expect(map.get(1)?.content).toBe('new A')
      expect(map.get(2)?.content).toBe('new B')
    })
  })

  describe('mapOldLinesToChanges', () => {
    it('should map deleted lines to old line numbers', () => {
      const hunk = makeHunk({
        oldStart: 5, newStart: 5,
        changes: [
          makeChange('UnchangedLine', 'ctx'),
          makeChange('DeletedLine', 'removed'),
          makeChange('UnchangedLine', 'ctx2'),
        ],
      })
      const map = LineMapper.mapOldLinesToChanges(hunk)
      expect(map.get(5)?.type).toBe('UnchangedLine')
      expect(map.get(6)?.type).toBe('DeletedLine')
      expect(map.get(6)?.content).toBe('removed')
      expect(map.get(7)?.type).toBe('UnchangedLine')
    })

    it('should skip added lines in old-line mapping', () => {
      const hunk = makeHunk({
        oldStart: 1, newStart: 1,
        changes: [
          makeChange('DeletedLine', 'old'),
          makeChange('AddedLine', 'new'),
        ],
      })
      const map = LineMapper.mapOldLinesToChanges(hunk)
      expect(map.size).toBe(1)
      expect(map.get(1)?.type).toBe('DeletedLine')
    })

    it('should handle deletion-only hunk', () => {
      const hunk = makeHunk({
        oldStart: 10, newStart: 10,
        changes: [
          makeChange('DeletedLine', 'line A'),
          makeChange('DeletedLine', 'line B'),
          makeChange('DeletedLine', 'line C'),
        ],
      })
      const map = LineMapper.mapOldLinesToChanges(hunk)
      expect(map.size).toBe(3)
      expect(map.get(10)?.content).toBe('line A')
      expect(map.get(11)?.content).toBe('line B')
      expect(map.get(12)?.content).toBe('line C')
    })
  })

  describe('getRequiredChanges', () => {
    it('should return AddedLine for pure addition', () => {
      const hunk = makeHunk({
        changes: [
          makeChange('UnchangedLine', 'ctx'),
          makeChange('AddedLine', 'new line'),
          makeChange('UnchangedLine', 'ctx2'),
        ],
      })
      const result = LineMapper.getRequiredChanges(hunk, new Set([2]))
      expect(result).toHaveLength(1)
      expect(result[0].type).toBe('AddedLine')
      expect(result[0].content).toBe('new line')
    })

    it('should include paired DeletedLines for replacement (Bug 1 regression)', () => {
      const hunk = makeHunk({
        changes: [
          makeChange('DeletedLine', 'old A'),
          makeChange('DeletedLine', 'old B'),
          makeChange('AddedLine', 'new A'),
          makeChange('AddedLine', 'new B'),
          makeChange('UnchangedLine', 'ctx'),
        ],
      })
      // Select line 1 (new A) -> should include both deletes
      const result = LineMapper.getRequiredChanges(hunk, new Set([1]))
      const types = result.map(c => c.type)
      expect(types.filter(t => t === 'DeletedLine')).toHaveLength(2)
      expect(types.filter(t => t === 'AddedLine')).toHaveLength(1)
      expect(result[0].content).toBe('old A')
      expect(result[1].content).toBe('old B')
      expect(result[2].content).toBe('new A')
    })

    it('should include all deletes when selecting multiple adds in replacement', () => {
      const hunk = makeHunk({
        changes: [
          makeChange('DeletedLine', 'old'),
          makeChange('AddedLine', 'new A'),
          makeChange('AddedLine', 'new B'),
        ],
      })
      const result = LineMapper.getRequiredChanges(hunk, new Set([1, 2]))
      expect(result).toHaveLength(3)
      expect(result[0].type).toBe('DeletedLine')
      expect(result[1].type).toBe('AddedLine')
      expect(result[2].type).toBe('AddedLine')
    })

    it('should fallback to old-line numbers for deletion-only hunk (Bug 2 regression)', () => {
      const hunk = makeHunk({
        oldStart: 5, newStart: 5,
        changes: [
          makeChange('DeletedLine', 'removed A'),
          makeChange('DeletedLine', 'removed B'),
          makeChange('DeletedLine', 'removed C'),
        ],
      })
      // Use old-line numbers since no AddedLines exist
      const result = LineMapper.getRequiredChanges(hunk, new Set([5, 6]))
      expect(result).toHaveLength(2)
      expect(result[0].content).toBe('removed A')
      expect(result[1].content).toBe('removed B')
    })

    it('should return empty for out-of-range lines', () => {
      const hunk = makeHunk({
        changes: [
          makeChange('AddedLine', 'new'),
        ],
      })
      const result = LineMapper.getRequiredChanges(hunk, new Set([999]))
      expect(result).toHaveLength(0)
    })

    it('should return empty for context-only line selection', () => {
      const hunk = makeHunk({
        changes: [
          makeChange('UnchangedLine', 'ctx1'),
          makeChange('AddedLine', 'new'),
          makeChange('UnchangedLine', 'ctx2'),
        ],
      })
      // Select line 1 (UnchangedLine) — should not be included
      const result = LineMapper.getRequiredChanges(hunk, new Set([1]))
      expect(result).toHaveLength(0)
    })

    it('should handle EOF newline fix pattern', () => {
      // Pattern: -Line3(no eol), +Line3(eol), +Line4
      const hunk = makeHunk({
        oldStart: 1, newStart: 1, oldLines: 1, newLines: 2,
        header: '@@ -1,1 +1,2 @@',
        changes: [
          makeChange('DeletedLine', 'Line 3', false),
          makeChange('AddedLine', 'Line 3', true),
          makeChange('AddedLine', 'Line 4 added', true),
        ],
      })
      // Select line 2 (Line 4 added)
      const result = LineMapper.getRequiredChanges(hunk, new Set([2]))
      // Should include: -Line3(no eol), +Line3(eol), +Line4
      expect(result).toHaveLength(3)
      expect(result[0].type).toBe('DeletedLine')
      expect(result[0].eol).toBe(false)
      expect(result[1].content).toBe('Line 3')
      expect(result[2].content).toBe('Line 4 added')
    })

    it('should not use old-line fallback when AddedLines exist', () => {
      const hunk = makeHunk({
        oldStart: 1, newStart: 1,
        changes: [
          makeChange('DeletedLine', 'old'),
          makeChange('AddedLine', 'new'),
        ],
      })
      // Select line 1 (AddedLine in new-file mapping)
      const result = LineMapper.getRequiredChanges(hunk, new Set([1]))
      // Should find the AddedLine via new-file mapping, not fallback
      expect(result.some(c => c.type === 'AddedLine')).toBe(true)
    })
  })

  describe('needsEOFPair', () => {
    it('should return true when AddedLine follows no-EOL change', () => {
      const changes: ExtendedLineChange[] = [
        makeChange('DeletedLine', 'last', false),
        makeChange('AddedLine', 'new', true),
      ]
      expect(LineMapper.needsEOFPair(changes[1], 1, changes)).toBe(true)
    })

    it('should return false when AddedLine follows EOL change', () => {
      const changes: ExtendedLineChange[] = [
        makeChange('UnchangedLine', 'line', true),
        makeChange('AddedLine', 'new', true),
      ]
      expect(LineMapper.needsEOFPair(changes[1], 1, changes)).toBe(false)
    })

    it('should return false for non-AddedLine', () => {
      const changes: ExtendedLineChange[] = [
        makeChange('DeletedLine', 'a', false),
        makeChange('DeletedLine', 'b', true),
      ]
      expect(LineMapper.needsEOFPair(changes[1], 1, changes)).toBe(false)
    })

    it('should return false for first change', () => {
      const changes: ExtendedLineChange[] = [
        makeChange('AddedLine', 'new', true),
      ]
      expect(LineMapper.needsEOFPair(changes[0], 0, changes)).toBe(false)
    })
  })

  describe('findEOLFixChange', () => {
    it('should find matching AddedLine with EOL', () => {
      const hunk = makeHunk({
        changes: [
          makeChange('DeletedLine', 'content', false),
          makeChange('AddedLine', 'content', true),
        ],
      })
      const result = LineMapper.findEOLFixChange(hunk.changes[0], hunk)
      expect(result).not.toBeNull()
      expect(result?.type).toBe('AddedLine')
      expect(result?.eol).toBe(true)
    })

    it('should return null when no matching fix exists', () => {
      const hunk = makeHunk({
        changes: [
          makeChange('DeletedLine', 'content', false),
          makeChange('AddedLine', 'different', true),
        ],
      })
      const result = LineMapper.findEOLFixChange(hunk.changes[0], hunk)
      expect(result).toBeNull()
    })
  })
})
