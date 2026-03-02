import { describe, it, expect } from 'vitest'
import { DiffParser } from '../../src/core/diff-parser.js'

const parser = new DiffParser()

describe('DiffParser - Diverse Real-World Patterns', () => {

  describe('No newline at end of file', () => {
    it('should mark deletion as eol=false when followed by no-newline marker', () => {
      const diff = [
        'diff --git a/f.txt b/f.txt',
        'index abc..def 100644',
        '--- a/f.txt',
        '+++ b/f.txt',
        '@@ -1,1 +1,2 @@',
        '-last',
        '\\ No newline at end of file',
        '+last',
        '+new line',
      ].join('\n')

      const files = parser.parseFilesWithInfo(diff)
      const changes = files[0].hunks[0].changes
      const deleted = changes.find(c => c.type === 'DeletedLine')
      expect(deleted!.eol).toBe(false)
      const added = changes.filter(c => c.type === 'AddedLine')
      expect(added.length).toBe(2)
    })

    it('should handle both sides having no newline', () => {
      const diff = [
        'diff --git a/f.txt b/f.txt',
        'index abc..def 100644',
        '--- a/f.txt',
        '+++ b/f.txt',
        '@@ -1,1 +1,1 @@',
        '-old content',
        '\\ No newline at end of file',
        '+new content',
        '\\ No newline at end of file',
      ].join('\n')

      const files = parser.parseFilesWithInfo(diff)
      const changes = files[0].hunks[0].changes
      expect(changes[0].eol).toBe(false)
      expect(changes[1].eol).toBe(false)
    })

    it('should handle adding newline at end of file', () => {
      const diff = [
        'diff --git a/f.txt b/f.txt',
        'index abc..def 100644',
        '--- a/f.txt',
        '+++ b/f.txt',
        '@@ -1,1 +1,1 @@',
        '-no newline',
        '\\ No newline at end of file',
        '+no newline',
      ].join('\n')

      const files = parser.parseFilesWithInfo(diff)
      const changes = files[0].hunks[0].changes
      expect(changes[0].eol).toBe(false) // old: no newline
      expect(changes[1].eol).toBe(true)  // new: has newline
    })
  })

  describe('Multiple hunks in one file', () => {
    it('should parse 5 hunks correctly with sequential indices', () => {
      const hunks = []
      for (let i = 0; i < 5; i++) {
        const start = i * 20 + 1
        hunks.push(
          `@@ -${start},3 +${start},3 @@`,
          ` context`,
          `-old line ${i}`,
          `+new line ${i}`,
          ` context2`,
        )
      }
      const diff = [
        'diff --git a/f.txt b/f.txt',
        'index abc..def 100644',
        '--- a/f.txt',
        '+++ b/f.txt',
        ...hunks,
      ].join('\n')

      const files = parser.parseFilesWithInfo(diff)
      expect(files[0].hunks.length).toBe(5)
      for (let i = 0; i < 5; i++) {
        expect(files[0].hunks[i].index).toBe(i + 1)
        expect(files[0].hunks[i].id).toMatch(/^[a-f0-9]{8}$/)
      }

      // All IDs should be unique
      const ids = files[0].hunks.map(h => h.id)
      expect(new Set(ids).size).toBe(5)
    })
  })

  describe('Addition-only diff (new file)', () => {
    it('should parse an added file diff', () => {
      const diff = [
        'diff --git a/new.txt b/new.txt',
        'new file mode 100644',
        'index 0000000..abc1234',
        '--- /dev/null',
        '+++ b/new.txt',
        '@@ -0,0 +1,3 @@',
        '+line 1',
        '+line 2',
        '+line 3',
      ].join('\n')

      const files = parser.parseFilesWithInfo(diff)
      expect(files.length).toBe(1)
      expect(files[0].hunks.length).toBe(1)
      expect(files[0].hunks[0].oldStart).toBe(0)
      expect(files[0].hunks[0].newStart).toBe(1)
      const adds = files[0].hunks[0].changes.filter(c => c.type === 'AddedLine')
      expect(adds.length).toBe(3)
    })
  })

  describe('Deletion-only diff (deleted file)', () => {
    it('should parse a deleted file diff', () => {
      const diff = [
        'diff --git a/removed.txt b/removed.txt',
        'deleted file mode 100644',
        'index abc1234..0000000',
        '--- a/removed.txt',
        '+++ /dev/null',
        '@@ -1,3 +0,0 @@',
        '-line 1',
        '-line 2',
        '-line 3',
      ].join('\n')

      const files = parser.parseFilesWithInfo(diff)
      expect(files.length).toBe(1)
      const deletes = files[0].hunks[0].changes.filter(c => c.type === 'DeletedLine')
      expect(deletes.length).toBe(3)
    })
  })

  describe('Rename diff', () => {
    it('should parse renamed file with content changes', () => {
      const diff = [
        'diff --git a/old.txt b/new.txt',
        'similarity index 80%',
        'rename from old.txt',
        'rename to new.txt',
        'index abc..def 100644',
        '--- a/old.txt',
        '+++ b/new.txt',
        '@@ -1,3 +1,3 @@',
        ' context',
        '-old line',
        '+new line',
        ' context2',
      ].join('\n')

      const { metadata } = parser.preprocessDiff(diff)
      expect(metadata.get('new.txt')?.rename?.from).toBe('old.txt')
      expect(metadata.get('new.txt')?.rename?.to).toBe('new.txt')
    })
  })

  describe('Mode change diff', () => {
    it('should parse mode change with content changes', () => {
      const diff = [
        'diff --git a/script.sh b/script.sh',
        'old mode 100644',
        'new mode 100755',
        'index abc..def',
        '--- a/script.sh',
        '+++ b/script.sh',
        '@@ -1,1 +1,1 @@',
        '-echo old',
        '+echo new',
      ].join('\n')

      const { cleaned, metadata } = parser.preprocessDiff(diff)
      expect(metadata.get('script.sh')?.mode?.old).toBe('100644')
      expect(metadata.get('script.sh')?.mode?.new).toBe('100755')

      // Mode lines should be stripped
      expect(cleaned).not.toContain('old mode')
      expect(cleaned).not.toContain('new mode')
      // Content should remain
      expect(cleaned).toContain('-echo old')
      expect(cleaned).toContain('+echo new')
    })

    it('should parse mode-only change (no content diff)', () => {
      const diff = [
        'diff --git a/script.sh b/script.sh',
        'old mode 100644',
        'new mode 100755',
      ].join('\n')

      const { metadata } = parser.preprocessDiff(diff)
      expect(metadata.get('script.sh')?.mode?.old).toBe('100644')
      expect(metadata.get('script.sh')?.mode?.new).toBe('100755')
    })
  })

  describe('Copy diff', () => {
    it('should parse copy metadata', () => {
      const diff = [
        'diff --git a/original.txt b/copied.txt',
        'copy from original.txt',
        'copy to copied.txt',
        'index abc..def 100644',
        '--- a/original.txt',
        '+++ b/copied.txt',
        '@@ -1,1 +1,2 @@',
        ' same',
        '+added',
      ].join('\n')

      const { metadata } = parser.preprocessDiff(diff)
      expect(metadata.get('copied.txt')?.copy?.from).toBe('original.txt')
      expect(metadata.get('copied.txt')?.copy?.to).toBe('copied.txt')
    })
  })

  describe('Large context', () => {
    it('should handle diff with U10 context', () => {
      const ctx = Array.from({ length: 10 }, (_, i) => ` ctx${i + 1}`)
      const diff = [
        'diff --git a/f.txt b/f.txt',
        'index abc..def 100644',
        '--- a/f.txt',
        '+++ b/f.txt',
        '@@ -1,21 +1,21 @@',
        ...ctx,
        '-old',
        '+new',
        ...ctx,
      ].join('\n')

      const files = parser.parseFilesWithInfo(diff)
      expect(files[0].hunks[0].changes.length).toBe(22)
    })
  })

  describe('Zero context (U0)', () => {
    it('should handle diff with zero context', () => {
      const diff = [
        'diff --git a/f.txt b/f.txt',
        'index abc..def 100644',
        '--- a/f.txt',
        '+++ b/f.txt',
        '@@ -5,1 +5,1 @@',
        '-old',
        '+new',
      ].join('\n')

      const files = parser.parseFilesWithInfo(diff)
      expect(files[0].hunks[0].changes.length).toBe(2)
      expect(files[0].hunks[0].oldStart).toBe(5)
    })
  })

  describe('Multiple files in single diff', () => {
    it('should parse 4 files correctly', () => {
      const fileDiffs = ['a.txt', 'b.js', 'c.py', 'd.go'].map(f => [
        `diff --git a/${f} b/${f}`,
        'index abc..def 100644',
        `--- a/${f}`,
        `+++ b/${f}`,
        '@@ -1,1 +1,1 @@',
        `-old ${f}`,
        `+new ${f}`,
      ].join('\n'))

      const diff = fileDiffs.join('\n')
      const files = parser.parseFilesWithInfo(diff)
      expect(files.length).toBe(4)
      expect(files[0].newPath).toBe('a.txt')
      expect(files[3].newPath).toBe('d.go')
    })
  })

  describe('Empty hunk', () => {
    it('should handle hunk with no changes (all context)', () => {
      const diff = [
        'diff --git a/f.txt b/f.txt',
        'index abc..def 100644',
        '--- a/f.txt',
        '+++ b/f.txt',
        '@@ -1,3 +1,3 @@',
        ' line1',
        ' line2',
        ' line3',
      ].join('\n')

      const files = parser.parseFilesWithInfo(diff)
      if (files.length > 0 && files[0].hunks.length > 0) {
        const changes = files[0].hunks[0].changes
        const mods = changes.filter(c => c.type !== 'UnchangedLine')
        expect(mods.length).toBe(0)
      }
    })
  })

  describe('Hunk stats and summary', () => {
    it('should calculate correct stats for mixed changes', () => {
      const diff = [
        'diff --git a/f.txt b/f.txt',
        'index abc..def 100644',
        '--- a/f.txt',
        '+++ b/f.txt',
        '@@ -1,5 +1,6 @@',
        ' ctx',
        '-deleted1',
        '-deleted2',
        '+added1',
        '+added2',
        '+added3',
        ' ctx2',
      ].join('\n')

      const files = parser.parseFilesWithInfo(diff)
      const stats = files[0].hunks[0].stats!
      expect(stats.additions).toBe(3)
      expect(stats.deletions).toBe(2)
    })

    it('should generate summary for the hunk', () => {
      const diff = [
        'diff --git a/f.txt b/f.txt',
        'index abc..def 100644',
        '--- a/f.txt',
        '+++ b/f.txt',
        '@@ -1,3 +1,3 @@',
        ' ctx',
        '-old line content here',
        '+new line content here',
        ' ctx2',
      ].join('\n')

      const files = parser.parseFilesWithInfo(diff)
      const summary = files[0].hunks[0].summary
      expect(summary).toBeDefined()
      expect(typeof summary).toBe('string')
    })
  })

  describe('Special characters in file paths', () => {
    it('should handle paths with spaces', () => {
      const diff = [
        'diff --git a/my file.txt b/my file.txt',
        'index abc..def 100644',
        '--- a/my file.txt',
        '+++ b/my file.txt',
        '@@ -1,1 +1,1 @@',
        '-old',
        '+new',
      ].join('\n')

      const files = parser.parseFilesWithInfo(diff)
      expect(files[0].newPath).toBe('my file.txt')
    })

    it('should handle deeply nested paths', () => {
      const diff = [
        'diff --git a/src/core/utils/helpers/format.ts b/src/core/utils/helpers/format.ts',
        'index abc..def 100644',
        '--- a/src/core/utils/helpers/format.ts',
        '+++ b/src/core/utils/helpers/format.ts',
        '@@ -1,1 +1,1 @@',
        '-old',
        '+new',
      ].join('\n')

      const files = parser.parseFilesWithInfo(diff)
      expect(files[0].newPath).toBe('src/core/utils/helpers/format.ts')
    })
  })

  describe('getHunkCount edge cases', () => {
    it('should return 0 for empty diff', () => {
      expect(parser.getHunkCount('')).toBe(0)
    })

    it('should count across multiple files', () => {
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
        '-old',
        '+new',
      ].join('\n')

      expect(parser.getHunkCount(diff)).toBe(3)
    })
  })

  describe('extractHunk edge cases', () => {
    it('should extract specific hunk by 1-based index', () => {
      const diff = [
        'diff --git a/f.txt b/f.txt',
        'index abc..def 100644',
        '--- a/f.txt',
        '+++ b/f.txt',
        '@@ -1,3 +1,3 @@',
        ' ctx',
        '-first old',
        '+first new',
        ' ctx2',
        '@@ -20,3 +20,3 @@',
        ' ctx3',
        '-second old',
        '+second new',
        ' ctx4',
      ].join('\n')

      const hunk1 = parser.extractHunk(diff, 'f.txt', 1)
      expect(hunk1).not.toBeNull()
      expect(hunk1!.oldStart).toBe(1)

      const hunk2 = parser.extractHunk(diff, 'f.txt', 2)
      expect(hunk2).not.toBeNull()
      expect(hunk2!.oldStart).toBe(20)
    })
  })

  describe('Unicode content in diff', () => {
    it('should parse diff with CJK characters', () => {
      const diff = [
        'diff --git a/f.txt b/f.txt',
        'index abc..def 100644',
        '--- a/f.txt',
        '+++ b/f.txt',
        '@@ -1,1 +1,1 @@',
        '-한글 텍스트',
        '+수정된 한글',
      ].join('\n')

      const files = parser.parseFilesWithInfo(diff)
      expect(files[0].hunks[0].changes[0].content).toBe('한글 텍스트')
      expect(files[0].hunks[0].changes[1].content).toBe('수정된 한글')
    })

    it('should parse diff with emoji', () => {
      const diff = [
        'diff --git a/f.txt b/f.txt',
        'index abc..def 100644',
        '--- a/f.txt',
        '+++ b/f.txt',
        '@@ -1,1 +1,1 @@',
        '-hello 🌍',
        '+hello 🌎',
      ].join('\n')

      const files = parser.parseFilesWithInfo(diff)
      expect(files[0].hunks[0].changes[0].content).toContain('🌍')
      expect(files[0].hunks[0].changes[1].content).toContain('🌎')
    })
  })
})
