import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { execSync } from 'child_process'
import { StagingService } from '../../src/services/staging-service.js'

function git(cmd: string, cwd: string) {
  return execSync(`git ${cmd}`, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
}

describe('Lines Staging - Diverse Diff Patterns (Bug 1/2 edge cases)', () => {
  let tempDir: string
  let staging: StagingService

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'gt-lines-pat-'))
    git('init', tempDir)
    git('config user.email "t@t"', tempDir)
    git('config user.name "T"', tempDir)
    staging = new StagingService(tempDir)
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  describe('Replacement at file boundaries', () => {
    it('should handle replacement at the very first line (no leading context)', async () => {
      writeFileSync(join(tempDir, 'f.txt'), 'first line\nsecond line\nthird line\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)
      writeFileSync(join(tempDir, 'f.txt'), 'REPLACED first\nsecond line\nthird line\n')

      await staging.stageLines('f.txt', 1, 1)
      const cached = git('diff --cached', tempDir)
      expect(cached).toContain('-first line')
      expect(cached).toContain('+REPLACED first')

      // Verify index content
      const show = git('show :f.txt', tempDir)
      expect(show).toContain('REPLACED first')
      expect(show.split('\n').filter(l => l.includes('first')).length).toBe(1)
    })

    it('should handle replacement at the very last line', async () => {
      writeFileSync(join(tempDir, 'f.txt'), 'first\nsecond\nlast line\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)
      writeFileSync(join(tempDir, 'f.txt'), 'first\nsecond\nREPLACED last\n')

      await staging.stageLines('f.txt', 3, 3)
      const cached = git('diff --cached', tempDir)
      expect(cached).toContain('-last line')
      expect(cached).toContain('+REPLACED last')
    })

    it('should handle replacement at EOF with no trailing newline', async () => {
      writeFileSync(join(tempDir, 'f.txt'), 'first\nlast')
      git('add .', tempDir)
      git('commit -m init', tempDir)
      writeFileSync(join(tempDir, 'f.txt'), 'first\nREPLACED')

      await staging.stageLines('f.txt', 2, 2)
      const cached = git('diff --cached', tempDir)
      expect(cached).toContain('REPLACED')
    })
  })

  describe('N:M replacement patterns (Bug 1 variations)', () => {
    it('should handle 3:1 replacement (3 deletes, 1 add)', async () => {
      writeFileSync(join(tempDir, 'f.txt'), 'A\nB\nC\nkeep\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)
      writeFileSync(join(tempDir, 'f.txt'), 'MERGED\nkeep\n')

      await staging.stageLines('f.txt', 1, 1)
      const cached = git('diff --cached', tempDir)
      expect(cached).toContain('-A')
      expect(cached).toContain('-B')
      expect(cached).toContain('-C')
      expect(cached).toContain('+MERGED')
    })

    it('should handle 1:3 replacement (1 delete, 3 adds)', async () => {
      writeFileSync(join(tempDir, 'f.txt'), 'SINGLE\nkeep\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)
      writeFileSync(join(tempDir, 'f.txt'), 'EXPANDED A\nEXPANDED B\nEXPANDED C\nkeep\n')

      await staging.stageLines('f.txt', 1, 3)
      const cached = git('diff --cached', tempDir)
      expect(cached).toContain('-SINGLE')
      expect(cached).toContain('+EXPANDED A')
      expect(cached).toContain('+EXPANDED B')
      expect(cached).toContain('+EXPANDED C')
    })

    it('should handle selecting subset of replacement adds', async () => {
      writeFileSync(join(tempDir, 'f.txt'), 'OLD\nkeep\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)
      writeFileSync(join(tempDir, 'f.txt'), 'NEW A\nNEW B\nNEW C\nkeep\n')

      // Select only the first replacement line
      await staging.stageLines('f.txt', 1, 1)
      const cached = git('diff --cached', tempDir)
      // Should include the delete (-OLD) and at least the selected add (+NEW A)
      expect(cached).toContain('-OLD')
      expect(cached).toContain('+NEW A')
    })
  })

  describe('Deletion-only edge cases (Bug 2 variations)', () => {
    it('should select partial deletion from a deletion block', async () => {
      writeFileSync(join(tempDir, 'f.txt'), 'A\nB\nC\nD\nE\nF\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)
      writeFileSync(join(tempDir, 'f.txt'), 'A\nF\n')

      // Delete only lines 2-3 (B, C) using old-file numbering
      await staging.stageLines('f.txt', 2, 3)
      const cached = git('diff --cached', tempDir)
      expect(cached).toContain('-B')
      expect(cached).toContain('-C')
    })

    it('should handle single line deletion at beginning', async () => {
      writeFileSync(join(tempDir, 'f.txt'), 'DELETE_ME\nkeep1\nkeep2\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)
      writeFileSync(join(tempDir, 'f.txt'), 'keep1\nkeep2\n')

      await staging.stageLines('f.txt', 1, 1)
      const cached = git('diff --cached', tempDir)
      expect(cached).toContain('-DELETE_ME')
    })

    it('should handle single line deletion at end', async () => {
      writeFileSync(join(tempDir, 'f.txt'), 'keep1\nkeep2\nDELETE_ME\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)
      writeFileSync(join(tempDir, 'f.txt'), 'keep1\nkeep2\n')

      await staging.stageLines('f.txt', 3, 3)
      const cached = git('diff --cached', tempDir)
      expect(cached).toContain('-DELETE_ME')
    })

    it('should handle deleting entire file content', async () => {
      writeFileSync(join(tempDir, 'f.txt'), 'A\nB\nC\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)
      writeFileSync(join(tempDir, 'f.txt'), '')

      await staging.stageLines('f.txt', 1, 3)
      const cached = git('diff --cached', tempDir)
      expect(cached).toContain('-A')
      expect(cached).toContain('-B')
      expect(cached).toContain('-C')
    })
  })

  describe('Addition-only edge cases', () => {
    it('should add lines at the beginning of file', async () => {
      writeFileSync(join(tempDir, 'f.txt'), 'existing\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)
      writeFileSync(join(tempDir, 'f.txt'), 'NEW FIRST\nexisting\n')

      await staging.stageLines('f.txt', 1, 1)
      const cached = git('diff --cached', tempDir)
      expect(cached).toContain('+NEW FIRST')
    })

    it('should add lines in the middle of file', async () => {
      writeFileSync(join(tempDir, 'f.txt'), 'A\nC\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)
      writeFileSync(join(tempDir, 'f.txt'), 'A\nINSERTED\nC\n')

      await staging.stageLines('f.txt', 2, 2)
      const cached = git('diff --cached', tempDir)
      expect(cached).toContain('+INSERTED')
    })

    it('should add multiple consecutive lines', async () => {
      writeFileSync(join(tempDir, 'f.txt'), 'start\nend\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)
      writeFileSync(join(tempDir, 'f.txt'), 'start\nline1\nline2\nline3\nline4\nline5\nend\n')

      await staging.stageLines('f.txt', 2, 6)
      const cached = git('diff --cached', tempDir)
      for (let i = 1; i <= 5; i++) {
        expect(cached).toContain(`+line${i}`)
      }
    })
  })

  describe('Mixed patterns in same file', () => {
    it('should stage addition from a file with both adds and deletes', async () => {
      const lines = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`)
      writeFileSync(join(tempDir, 'f.txt'), lines.join('\n') + '\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)

      // Delete lines 3-4, add after line 15
      const modified = [...lines]
      modified.splice(2, 2) // remove Line 3 and Line 4
      modified.splice(13, 0, 'NEW ADDITION')
      writeFileSync(join(tempDir, 'f.txt'), modified.join('\n') + '\n')

      // Stage just the addition area
      const hunks = await staging.listHunksWithInfo('f.txt')
      expect(hunks.filter(h => h.layer === 'unstaged').length).toBeGreaterThanOrEqual(1)
    })

    it('should handle file with interleaved add/delete/modify', async () => {
      writeFileSync(join(tempDir, 'f.txt'), 'A\nB\nC\nD\nE\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)
      // A -> A_MOD (replace), B removed, C kept, D kept, E -> E_MOD, + NEW
      writeFileSync(join(tempDir, 'f.txt'), 'A_MOD\nC\nD\nE_MOD\nNEW\n')

      const hunks = await staging.listHunksWithInfo('f.txt')
      const unstaged = hunks.filter(h => h.layer === 'unstaged')
      expect(unstaged.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('Replacement + EOF newline interaction', () => {
    it('should handle replacement at last line that also adds newline', async () => {
      writeFileSync(join(tempDir, 'f.txt'), 'first\nlast')
      git('add .', tempDir)
      git('commit -m init', tempDir)
      writeFileSync(join(tempDir, 'f.txt'), 'first\nreplaced last\n')

      await staging.stageLines('f.txt', 2, 2)
      const cached = git('diff --cached', tempDir)
      expect(cached).toContain('replaced last')
    })

    it('should handle replacement at last line that removes newline', async () => {
      writeFileSync(join(tempDir, 'f.txt'), 'first\nlast\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)
      writeFileSync(join(tempDir, 'f.txt'), 'first\nreplaced no newline')

      await staging.stageLines('f.txt', 2, 2)
      const cached = git('diff --cached', tempDir)
      expect(cached).toContain('replaced no newline')
    })
  })

  describe('Large-scale line changes', () => {
    it('should handle staging from a file with 100+ changed lines', async () => {
      const lines = Array.from({ length: 200 }, (_, i) => `Line ${i + 1}`)
      writeFileSync(join(tempDir, 'f.txt'), lines.join('\n') + '\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)

      // Modify every other line
      for (let i = 0; i < 200; i += 2) {
        lines[i] = `MODIFIED ${i + 1}`
      }
      writeFileSync(join(tempDir, 'f.txt'), lines.join('\n') + '\n')

      // Stage just first hunk via lines
      await staging.stageLines('f.txt', 1, 1)
      const cached = git('diff --cached', tempDir)
      expect(cached).toContain('MODIFIED 1')
    })
  })

  describe('Unicode and special content', () => {
    it('should handle lines with unicode content', async () => {
      writeFileSync(join(tempDir, 'f.txt'), '한글 텍스트\n영어 text\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)
      writeFileSync(join(tempDir, 'f.txt'), '수정된 한글\n영어 text\n')

      await staging.stageLines('f.txt', 1, 1)
      const cached = git('diff --cached', tempDir)
      expect(cached).toContain('수정된 한글')
    })

    it('should handle lines with special characters', async () => {
      writeFileSync(join(tempDir, 'f.txt'), 'const x = "hello"\nconst y = 42\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)
      writeFileSync(join(tempDir, 'f.txt'), 'const x = `hello ${world}`\nconst y = 42\n')

      await staging.stageLines('f.txt', 1, 1)
      const cached = git('diff --cached', tempDir)
      expect(cached).toContain('`hello ${world}`')
    })

    it('should handle lines with tabs and mixed whitespace', async () => {
      writeFileSync(join(tempDir, 'f.txt'), '\tindented\n  spaced\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)
      writeFileSync(join(tempDir, 'f.txt'), '\t\tdouble indented\n  spaced\n')

      await staging.stageLines('f.txt', 1, 1)
      const cached = git('diff --cached', tempDir)
      expect(cached).toContain('double indented')
    })
  })

  describe('Error cases', () => {
    it('should error for line far beyond file length', async () => {
      writeFileSync(join(tempDir, 'f.txt'), 'A\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)
      writeFileSync(join(tempDir, 'f.txt'), 'B\n')

      await expect(staging.stageLines('f.txt', 9999, 10000)).rejects.toThrow()
    })

    it('should error for reversed range', async () => {
      writeFileSync(join(tempDir, 'f.txt'), 'A\nB\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)
      writeFileSync(join(tempDir, 'f.txt'), 'C\nD\n')

      await expect(staging.stageLines('f.txt', 5, 1)).rejects.toThrow()
    })
  })
})
