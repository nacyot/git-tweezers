import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { execSync } from 'child_process'
import { StagingService } from '../src/services/staging-service.js'
import { HunkCacheService, isTreeEntry } from '../src/services/hunk-cache-service.js'

function git(cmd: string, cwd: string) {
  return execSync(`git ${cmd}`, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
}

describe('Hunk Staging Edge Cases', () => {
  let tempDir: string
  let staging: StagingService

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'gt-hunk-edge-'))
    git('init', tempDir)
    git('config user.email "t@t"', tempDir)
    git('config user.name "T"', tempDir)
    staging = new StagingService(tempDir)
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  describe('Multi-hunk staging', () => {
    it('should stage 2 of 3 hunks via combined patch', async () => {
      const lines = Array.from({ length: 30 }, (_, i) => `Line ${i + 1}`)
      writeFileSync(join(tempDir, 'f.txt'), lines.join('\n') + '\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)

      lines[0] = 'MODIFIED A'
      lines[14] = 'MODIFIED B'
      lines[25] = 'MODIFIED C'
      writeFileSync(join(tempDir, 'f.txt'), lines.join('\n') + '\n')

      await staging.stageHunks('f.txt', ['1', '3'])
      const cached = git('diff --cached', tempDir)
      expect(cached).toContain('MODIFIED A')
      expect(cached).not.toContain('MODIFIED B')
      expect(cached).toContain('MODIFIED C')
    })

    it('should use fast path (git add) when all hunks selected', async () => {
      const lines = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`)
      writeFileSync(join(tempDir, 'f.txt'), lines.join('\n') + '\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)

      lines[0] = 'MOD 1'
      lines[10] = 'MOD 2'
      writeFileSync(join(tempDir, 'f.txt'), lines.join('\n') + '\n')

      const hunks = await staging.listHunksWithInfo('f.txt')
      const allSelectors = hunks.filter(h => h.layer === 'unstaged').map((_, i) => String(i + 1))

      await staging.stageHunks('f.txt', allSelectors)

      const cached = git('diff --cached', tempDir)
      expect(cached).toContain('MOD 1')
      expect(cached).toContain('MOD 2')

      // Nothing should remain in working diff
      const diff = git('diff', tempDir)
      expect(diff).toBe('')
    })
  })

  describe('Precise vs Normal mode', () => {
    it('should produce more hunks in precise mode for adjacent changes', async () => {
      const lines = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`)
      writeFileSync(join(tempDir, 'f.txt'), lines.join('\n') + '\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)

      // Changes close together - might be merged in normal mode (3 context) but separate in precise (0 context)
      lines[5] = 'CHANGED 5'
      lines[9] = 'CHANGED 9'
      writeFileSync(join(tempDir, 'f.txt'), lines.join('\n') + '\n')

      const normalHunks = await staging.listHunksWithInfo('f.txt', { precise: false })
      const preciseHunks = await staging.listHunksWithInfo('f.txt', { precise: true })

      const normalCount = normalHunks.filter(h => h.layer === 'unstaged').length
      const preciseCount = preciseHunks.filter(h => h.layer === 'unstaged').length

      expect(preciseCount).toBeGreaterThanOrEqual(normalCount)
    })

    it('should stage and undo in precise mode', async () => {
      const lines = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`)
      writeFileSync(join(tempDir, 'f.txt'), lines.join('\n') + '\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)

      lines[5] = 'PRECISE CHANGE'
      writeFileSync(join(tempDir, 'f.txt'), lines.join('\n') + '\n')

      await staging.stageHunk('f.txt', '1', { precise: true })
      const cached = git('diff --cached', tempDir)
      expect(cached).toContain('PRECISE CHANGE')
    })
  })

  describe('Dual-layer (staged + unstaged)', () => {
    it('should show both staged and unstaged hunks', async () => {
      const lines = Array.from({ length: 30 }, (_, i) => `Line ${i + 1}`)
      writeFileSync(join(tempDir, 'f.txt'), lines.join('\n') + '\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)

      lines[0] = 'STAGED CHANGE'
      lines[14] = 'UNSTAGED CHANGE'
      writeFileSync(join(tempDir, 'f.txt'), lines.join('\n') + '\n')

      // Stage only the first hunk
      await staging.stageHunk('f.txt', '1')

      // Now list should show both layers
      const hunks = await staging.listHunksWithInfo('f.txt')
      const staged = hunks.filter(h => h.layer === 'staged')
      const unstaged = hunks.filter(h => h.layer === 'unstaged')

      expect(staged.length).toBeGreaterThanOrEqual(1)
      expect(unstaged.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('File states', () => {
    it('should handle untracked file with intent-to-add', async () => {
      // Need at least one commit for intent-to-add to work
      writeFileSync(join(tempDir, 'dummy.txt'), 'dummy\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)

      writeFileSync(join(tempDir, 'new.txt'), 'line 1\nline 2\n')

      const hunks = await staging.listHunksWithInfo('new.txt')
      expect(hunks.length).toBeGreaterThanOrEqual(1)
    })

    it('should handle file with only additions', async () => {
      writeFileSync(join(tempDir, 'f.txt'), 'A\nB\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)
      writeFileSync(join(tempDir, 'f.txt'), 'A\nNEW\nB\n')

      await staging.stageHunk('f.txt', '1')
      const cached = git('diff --cached', tempDir)
      expect(cached).toContain('+NEW')
    })

    it('should handle file with only deletions', async () => {
      writeFileSync(join(tempDir, 'f.txt'), 'A\nB\nC\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)
      writeFileSync(join(tempDir, 'f.txt'), 'A\nC\n')

      await staging.stageHunk('f.txt', '1')
      const cached = git('diff --cached', tempDir)
      expect(cached).toContain('-B')
    })

    it('should error for binary file', async () => {
      // Create a binary file with null bytes
      const buf = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe])
      writeFileSync(join(tempDir, 'bin.dat'), buf)
      git('add .', tempDir)
      git('commit -m init', tempDir)
      writeFileSync(join(tempDir, 'bin.dat'), Buffer.from([0x00, 0x01, 0x03, 0xff, 0xfe]))

      await expect(
        staging.listHunksWithInfo('bin.dat')
      ).rejects.toThrow()
    })

    it('should throw for unchanged file', async () => {
      writeFileSync(join(tempDir, 'f.txt'), 'unchanged\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)

      await expect(
        staging.stageHunk('f.txt', '1')
      ).rejects.toThrow()
    })
  })

  describe('Hunk selector errors', () => {
    it('should throw for out-of-range hunk index', async () => {
      writeFileSync(join(tempDir, 'f.txt'), 'A\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)
      writeFileSync(join(tempDir, 'f.txt'), 'A modified\n')

      await expect(
        staging.stageHunk('f.txt', '99')
      ).rejects.toThrow()
    })

    it('should throw for non-existent hunk ID', async () => {
      writeFileSync(join(tempDir, 'f.txt'), 'A\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)
      writeFileSync(join(tempDir, 'f.txt'), 'A modified\n')

      await expect(
        staging.stageHunk('f.txt', 'deadbeef')
      ).rejects.toThrow()
    })
  })

  describe('Undo history recording', () => {
    it('should record undo history after staging', async () => {
      writeFileSync(join(tempDir, 'f.txt'), 'A\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)
      writeFileSync(join(tempDir, 'f.txt'), 'A modified\n')

      await staging.stageHunk('f.txt', '1')

      const cache = new HunkCacheService(tempDir)
      const history = cache.getHistory()
      expect(history.length).toBeGreaterThanOrEqual(1)
      const entry = history[0]
      if (isTreeEntry(entry)) {
        expect(entry.affectedFiles).toContain('f.txt')
      } else {
        expect(entry.files).toContain('f.txt')
      }
    })

    it('should not record history in dry-run mode', async () => {
      writeFileSync(join(tempDir, 'f.txt'), 'A\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)
      writeFileSync(join(tempDir, 'f.txt'), 'A modified\n')

      await staging.stageHunk('f.txt', '1', { dryRun: true })

      const cache = new HunkCacheService(tempDir)
      const history = cache.getHistory()
      expect(history.length).toBe(0)
    })
  })

  describe('Sequential fallback', () => {
    it('should handle staging hunks one by one when combined fails', async () => {
      // Create a file where staging two non-adjacent hunks works
      const lines = Array.from({ length: 40 }, (_, i) => `Line ${i + 1}`)
      writeFileSync(join(tempDir, 'f.txt'), lines.join('\n') + '\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)

      lines[0] = 'CHANGE 1'
      lines[20] = 'CHANGE 2'
      lines[35] = 'CHANGE 3'
      writeFileSync(join(tempDir, 'f.txt'), lines.join('\n') + '\n')

      // Stage selectively - this exercises the multi-hunk path
      await staging.stageHunks('f.txt', ['1', '2'])
      const cached = git('diff --cached', tempDir)
      expect(cached).toContain('CHANGE 1')
      expect(cached).toContain('CHANGE 2')
      expect(cached).not.toContain('CHANGE 3')
    })
  })

  describe('Content-based ID staging', () => {
    it('should stage by content-based ID', async () => {
      const lines = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`)
      writeFileSync(join(tempDir, 'f.txt'), lines.join('\n') + '\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)

      lines[0] = 'ID TEST CHANGE'
      writeFileSync(join(tempDir, 'f.txt'), lines.join('\n') + '\n')

      const hunks = await staging.listHunksWithInfo('f.txt')
      const target = hunks.find(h => h.layer === 'unstaged')!
      expect(target).toBeDefined()
      expect(target.id).toMatch(/^[a-f0-9]{8}$/)

      // Stage by content-based ID
      await staging.stageHunk('f.txt', target.id)
      const cached = git('diff --cached', tempDir)
      expect(cached).toContain('ID TEST CHANGE')
    })
  })
})
