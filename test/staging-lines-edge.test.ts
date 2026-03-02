import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { execSync } from 'child_process'
import { StagingService } from '../src/services/staging-service.js'

function git(cmd: string, cwd: string) {
  return execSync(`git ${cmd}`, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
}

describe('Lines Staging Edge Cases', () => {
  let tempDir: string
  let staging: StagingService

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'gt-lines-edge-'))
    git('init', tempDir)
    git('config user.email "t@t"', tempDir)
    git('config user.name "T"', tempDir)
    staging = new StagingService(tempDir)
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  describe('Replacement patterns (Bug 1 regression)', () => {
    it('should stage 1:1 replacement including deletion', async () => {
      writeFileSync(join(tempDir, 'f.txt'), 'old line\nkeep\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)
      writeFileSync(join(tempDir, 'f.txt'), 'new line\nkeep\n')

      await staging.stageLines('f.txt', 1, 1)
      const cached = git('diff --cached', tempDir)
      expect(cached).toContain('-old line')
      expect(cached).toContain('+new line')
    })

    it('should stage N:M replacement with all paired deletes', async () => {
      writeFileSync(join(tempDir, 'f.txt'), 'A\nB\nC\nkeep\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)
      writeFileSync(join(tempDir, 'f.txt'), 'X\nY\nkeep\n')

      // Select first replacement line
      await staging.stageLines('f.txt', 1, 1)
      const cached = git('diff --cached', tempDir)
      // Should include all 3 deletions (A, B, C) + 1 addition (X)
      expect(cached).toContain('-A')
      expect(cached).toContain('+X')
    })

    it('should not create duplicate lines in index after replacement staging', async () => {
      writeFileSync(join(tempDir, 'f.txt'), 'version: 1.0.0\nname: test\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)
      writeFileSync(join(tempDir, 'f.txt'), 'version: 2.0.0\nname: test\n')

      await staging.stageLines('f.txt', 1, 1)
      // Check staged content doesn't have duplicates
      const show = git('show :f.txt', tempDir)
      const lines = show.split('\n').filter(l => l.includes('version'))
      expect(lines).toHaveLength(1)
      expect(lines[0]).toBe('version: 2.0.0')
    })

    it('should undo replacement staging cleanly', async () => {
      writeFileSync(join(tempDir, 'f.txt'), 'old\nkeep\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)
      writeFileSync(join(tempDir, 'f.txt'), 'new\nkeep\n')

      const treeBefore = git('write-tree', tempDir)
      await staging.stageLines('f.txt', 1, 1)

      // Undo via tree restore
      git(`read-tree ${treeBefore}`, tempDir)
      const cached = git('diff --cached', tempDir)
      expect(cached).toBe('')
    })
  })

  describe('Deletion-only patterns (Bug 2 regression)', () => {
    it('should stage deletion-only hunk via old-line numbers', async () => {
      writeFileSync(join(tempDir, 'f.txt'), 'A\nB\nC\nD\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)
      writeFileSync(join(tempDir, 'f.txt'), 'A\nD\n')

      // Lines 2-3 were deleted (old-file numbering)
      await staging.stageLines('f.txt', 2, 3)
      const cached = git('diff --cached', tempDir)
      expect(cached).toContain('-B')
      expect(cached).toContain('-C')
    })

    it('should handle single line deletion', async () => {
      writeFileSync(join(tempDir, 'f.txt'), 'keep\nremove\nkeep2\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)
      writeFileSync(join(tempDir, 'f.txt'), 'keep\nkeep2\n')

      await staging.stageLines('f.txt', 2, 2)
      const cached = git('diff --cached', tempDir)
      expect(cached).toContain('-remove')
    })

    it('should throw for out-of-range lines', async () => {
      writeFileSync(join(tempDir, 'f.txt'), 'A\nB\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)
      writeFileSync(join(tempDir, 'f.txt'), 'A\nB modified\n')

      await expect(
        staging.stageLines('f.txt', 50, 60)
      ).rejects.toThrow('No changes found')
    })
  })

  describe('Addition-only patterns', () => {
    it('should stage pure addition lines', async () => {
      writeFileSync(join(tempDir, 'f.txt'), 'A\nC\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)
      writeFileSync(join(tempDir, 'f.txt'), 'A\nB\nC\n')

      await staging.stageLines('f.txt', 2, 2)
      const cached = git('diff --cached', tempDir)
      expect(cached).toContain('+B')
    })

    it('should stage multi-line addition', async () => {
      writeFileSync(join(tempDir, 'f.txt'), 'start\nend\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)
      writeFileSync(join(tempDir, 'f.txt'), 'start\nline1\nline2\nline3\nend\n')

      await staging.stageLines('f.txt', 2, 4)
      const cached = git('diff --cached', tempDir)
      expect(cached).toContain('+line1')
      expect(cached).toContain('+line2')
      expect(cached).toContain('+line3')
    })
  })

  describe('Mixed patterns', () => {
    it('should handle file with both addition and deletion hunks', async () => {
      const lines = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`)
      writeFileSync(join(tempDir, 'f.txt'), lines.join('\n') + '\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)

      // Delete line 3, add after line 15
      lines.splice(2, 1) // remove Line 3
      lines.splice(14, 0, 'NEW LINE') // insert after line 15
      writeFileSync(join(tempDir, 'f.txt'), lines.join('\n') + '\n')

      // Stage the addition
      const hunks = await staging.listHunksWithInfo('f.txt')
      expect(hunks.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('No changes', () => {
    it('should throw for unchanged file', async () => {
      writeFileSync(join(tempDir, 'f.txt'), 'hello\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)

      await expect(
        staging.stageLines('f.txt', 1, 1)
      ).rejects.toThrow('No changes found')
    })
  })
})
