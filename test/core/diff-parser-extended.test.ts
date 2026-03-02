import { describe, it, expect } from 'vitest'
import { DiffParser } from '../../src/core/diff-parser.js'

describe('DiffParser', () => {
  const parser = new DiffParser()

  describe('preprocessDiff', () => {
    it('should extract mode change metadata', () => {
      const raw = [
        'diff --git a/script.sh b/script.sh',
        'old mode 100644',
        'new mode 100755',
        'index abc..def 100755',
        '--- a/script.sh',
        '+++ b/script.sh',
        '@@ -1,1 +1,1 @@',
        '-old',
        '+new',
      ].join('\n')

      const { cleaned, metadata } = parser.preprocessDiff(raw)
      expect(metadata.get('script.sh')?.mode?.old).toBe('100644')
      expect(metadata.get('script.sh')?.mode?.new).toBe('100755')
      // Mode lines should be stripped from cleaned output
      expect(cleaned).not.toContain('old mode')
      expect(cleaned).not.toContain('new mode')
    })

    it('should extract rename metadata', () => {
      const raw = [
        'diff --git a/old.txt b/new.txt',
        'rename from old.txt',
        'rename to new.txt',
        'index abc..def 100644',
      ].join('\n')

      const { metadata } = parser.preprocessDiff(raw)
      expect(metadata.get('new.txt')?.rename?.from).toBe('old.txt')
      expect(metadata.get('new.txt')?.rename?.to).toBe('new.txt')
    })

    it('should extract copy metadata', () => {
      const raw = [
        'diff --git a/src.txt b/dst.txt',
        'copy from src.txt',
        'copy to dst.txt',
      ].join('\n')

      const { metadata } = parser.preprocessDiff(raw)
      expect(metadata.get('dst.txt')?.copy?.from).toBe('src.txt')
      expect(metadata.get('dst.txt')?.copy?.to).toBe('dst.txt')
    })

    it('should handle multiple files', () => {
      const raw = [
        'diff --git a/a.txt b/a.txt',
        'old mode 100644',
        'new mode 100755',
        'diff --git a/b.txt b/b.txt',
        'old mode 100755',
        'new mode 100644',
      ].join('\n')

      const { metadata } = parser.preprocessDiff(raw)
      expect(metadata.get('a.txt')?.mode?.old).toBe('100644')
      expect(metadata.get('b.txt')?.mode?.old).toBe('100755')
    })

    it('should preserve non-metadata lines', () => {
      const raw = [
        'diff --git a/f.txt b/f.txt',
        'index abc..def 100644',
        '--- a/f.txt',
        '+++ b/f.txt',
        '@@ -1,1 +1,1 @@',
        '-old',
        '+new',
      ].join('\n')

      const { cleaned } = parser.preprocessDiff(raw)
      expect(cleaned).toContain('--- a/f.txt')
      expect(cleaned).toContain('+++ b/f.txt')
      expect(cleaned).toContain('-old')
      expect(cleaned).toContain('+new')
    })

    it('should handle diff with no metadata', () => {
      const raw = [
        'diff --git a/f.txt b/f.txt',
        'index abc..def 100644',
        '--- a/f.txt',
        '+++ b/f.txt',
        '@@ -1,1 +1,1 @@',
        '-old',
        '+new',
      ].join('\n')

      const { cleaned, metadata } = parser.preprocessDiff(raw)
      expect(metadata.get('f.txt')).toBeDefined()
      expect(Object.keys(metadata.get('f.txt')!)).toHaveLength(0)
      expect(cleaned).toBe(raw)
    })
  })

  describe('parseFilesWithInfo', () => {
    it('should parse a simple diff with hunk info', () => {
      const diff = [
        'diff --git a/f.txt b/f.txt',
        'index abc1234..def5678 100644',
        '--- a/f.txt',
        '+++ b/f.txt',
        '@@ -1,3 +1,3 @@',
        ' context',
        '-old line',
        '+new line',
        ' context2',
      ].join('\n')

      const files = parser.parseFilesWithInfo(diff)
      expect(files).toHaveLength(1)
      expect(files[0].oldPath).toBe('f.txt')
      expect(files[0].newPath).toBe('f.txt')
      expect(files[0].hunks).toHaveLength(1)

      const hunk = files[0].hunks[0]
      expect(hunk.index).toBe(1)
      expect(hunk.oldStart).toBe(1)
      expect(hunk.newStart).toBe(1)
      expect(hunk.id).toMatch(/^[a-f0-9]{8}$/)
      expect(hunk.stats).toBeDefined()
      expect(hunk.stats!.additions).toBe(1)
      expect(hunk.stats!.deletions).toBe(1)
    })

    it('should parse multiple hunks in one file', () => {
      const diff = [
        'diff --git a/f.txt b/f.txt',
        'index abc1234..def5678 100644',
        '--- a/f.txt',
        '+++ b/f.txt',
        '@@ -1,3 +1,3 @@',
        ' ctx',
        '-old1',
        '+new1',
        ' ctx2',
        '@@ -10,3 +10,4 @@',
        ' ctx3',
        '+added',
        ' ctx4',
        ' ctx5',
      ].join('\n')

      const files = parser.parseFilesWithInfo(diff)
      expect(files[0].hunks).toHaveLength(2)
      expect(files[0].hunks[0].index).toBe(1)
      expect(files[0].hunks[1].index).toBe(2)
    })

    it('should parse multiple files', () => {
      const diff = [
        'diff --git a/a.txt b/a.txt',
        'index abc..def 100644',
        '--- a/a.txt',
        '+++ b/a.txt',
        '@@ -1,1 +1,1 @@',
        '-old a',
        '+new a',
        'diff --git a/b.txt b/b.txt',
        'index abc..def 100644',
        '--- a/b.txt',
        '+++ b/b.txt',
        '@@ -1,1 +1,1 @@',
        '-old b',
        '+new b',
      ].join('\n')

      const files = parser.parseFilesWithInfo(diff)
      expect(files).toHaveLength(2)
      expect(files[0].oldPath).toBe('a.txt')
      expect(files[1].oldPath).toBe('b.txt')
    })

    it('should generate unique IDs for different hunks', () => {
      const diff = [
        'diff --git a/f.txt b/f.txt',
        'index abc..def 100644',
        '--- a/f.txt',
        '+++ b/f.txt',
        '@@ -1,3 +1,3 @@',
        ' ctx',
        '-old1',
        '+new1',
        ' ctx2',
        '@@ -20,3 +20,3 @@',
        ' ctx3',
        '-old2',
        '+new2',
        ' ctx4',
      ].join('\n')

      const files = parser.parseFilesWithInfo(diff)
      const ids = files[0].hunks.map(h => h.id)
      expect(new Set(ids).size).toBe(ids.length)
    })

    it('should include EOL information in changes', () => {
      const diff = [
        'diff --git a/f.txt b/f.txt',
        'index abc..def 100644',
        '--- a/f.txt',
        '+++ b/f.txt',
        '@@ -1,1 +1,2 @@',
        '-last line',
        '\\ No newline at end of file',
        '+last line',
        '+added line',
      ].join('\n')

      const files = parser.parseFilesWithInfo(diff)
      const changes = files[0].hunks[0].changes
      // The deleted line should have eol=false
      const deleted = changes.find(c => c.type === 'DeletedLine')
      expect(deleted).toBeDefined()
      expect(deleted!.eol).toBe(false)
    })
  })

  describe('getHunkCount', () => {
    it('should count hunks across all files', () => {
      const diff = [
        'diff --git a/a.txt b/a.txt',
        'index abc..def 100644',
        '--- a/a.txt',
        '+++ b/a.txt',
        '@@ -1,1 +1,1 @@',
        '-old',
        '+new',
        '@@ -10,1 +10,1 @@',
        '-old2',
        '+new2',
        'diff --git a/b.txt b/b.txt',
        'index abc..def 100644',
        '--- a/b.txt',
        '+++ b/b.txt',
        '@@ -1,1 +1,1 @@',
        '-old b',
        '+new b',
      ].join('\n')

      expect(parser.getHunkCount(diff)).toBe(3)
    })
  })

  describe('getFileHunkCount', () => {
    it('should count hunks for a specific file', () => {
      const diff = [
        'diff --git a/a.txt b/a.txt',
        'index abc..def 100644',
        '--- a/a.txt',
        '+++ b/a.txt',
        '@@ -1,1 +1,1 @@',
        '-old',
        '+new',
        '@@ -10,1 +10,1 @@',
        '-old2',
        '+new2',
      ].join('\n')

      expect(parser.getFileHunkCount(diff, 'a.txt')).toBe(2)
    })

    it('should return 0 for unknown file', () => {
      const diff = [
        'diff --git a/a.txt b/a.txt',
        'index abc..def 100644',
        '--- a/a.txt',
        '+++ b/a.txt',
        '@@ -1,1 +1,1 @@',
        '-old',
        '+new',
      ].join('\n')

      expect(parser.getFileHunkCount(diff, 'unknown.txt')).toBe(0)
    })
  })

  describe('extractHunk', () => {
    const diff = [
      'diff --git a/f.txt b/f.txt',
      'index abc..def 100644',
      '--- a/f.txt',
      '+++ b/f.txt',
      '@@ -1,3 +1,3 @@',
      ' ctx',
      '-old',
      '+new',
      ' ctx2',
    ].join('\n')

    it('should extract hunk by 1-based index', () => {
      const hunk = parser.extractHunk(diff, 'f.txt', 1)
      expect(hunk).not.toBeNull()
      expect(hunk!.oldStart).toBe(1)
    })

    it('should return null for out-of-range index', () => {
      expect(parser.extractHunk(diff, 'f.txt', 0)).toBeNull()
      expect(parser.extractHunk(diff, 'f.txt', 99)).toBeNull()
    })

    it('should return null for unknown file', () => {
      expect(parser.extractHunk(diff, 'unknown.txt', 1)).toBeNull()
    })
  })
})
