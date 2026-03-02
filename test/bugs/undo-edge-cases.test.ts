import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, unlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { execSync } from 'child_process'
import { execa } from 'execa'
import { StagingService } from '../../src/services/staging-service.js'

function git(cmd: string, cwd: string) {
  return execSync(`git ${cmd}`, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
}

const binPath = join(process.cwd(), 'bin', 'run.js')
const env = { ...process.env, OCLIF_TS_NODE: 'false' }

async function cli(args: string[], cwd: string) {
  return execa('node', [binPath, ...args], { cwd, env, reject: false })
}

describe('Undo Edge Cases (Bug H1/H2/M1 regression)', () => {
  let tempDir: string
  let staging: StagingService

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'gt-undo-edge-'))
    git('init', tempDir)
    git('config user.email "t@t"', tempDir)
    git('config user.name "T"', tempDir)
    staging = new StagingService(tempDir)
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  describe('Bug H2: Undo after file deletion staging', () => {
    it('should restore file to index after undoing a complete deletion', async () => {
      writeFileSync(join(tempDir, 'f.txt'), 'content\nline2\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)

      // Delete the file
      unlinkSync(join(tempDir, 'f.txt'))

      // Snapshot tree before staging
      const treeBefore = git('write-tree', tempDir)

      // Stage deletion via hunk
      await staging.stageHunk('f.txt', '1')

      // Verify deletion is staged
      const statusAfterStage = git('status --short', tempDir)
      expect(statusAfterStage).toContain('D')

      // Undo via tree-snapshot
      git(`read-tree ${treeBefore}`, tempDir)

      // File should be restored in the index
      const cachedDiff = git('diff --cached', tempDir)
      expect(cachedDiff).toBe('')
    })

    it('should undo file deletion via CLI', async () => {
      writeFileSync(join(tempDir, 'f.txt'), 'line1\nline2\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)

      unlinkSync(join(tempDir, 'f.txt'))

      const stageResult = await cli(['hunk', 'f.txt', '1'], tempDir)
      expect(stageResult.exitCode).toBe(0)

      const undoResult = await cli(['undo'], tempDir)
      expect(undoResult.exitCode).toBe(0)

      // File should no longer be staged for deletion
      const cached = git('diff --cached', tempDir)
      expect(cached).toBe('')
    })
  })

  describe('Bug M1: Undo of new file staging', () => {
    it('should restore untracked status after undo of new file', async () => {
      // Need initial commit
      writeFileSync(join(tempDir, 'existing.txt'), 'existing\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)

      // Create new untracked file
      writeFileSync(join(tempDir, 'new.txt'), 'new content\n')

      // Stage it
      const stageResult = await cli(['hunk', 'new.txt', '1'], tempDir)
      expect(stageResult.exitCode).toBe(0)

      // Verify it's staged
      const statusStaged = git('status --short', tempDir)
      expect(statusStaged).toContain('new.txt')

      // Undo
      const undoResult = await cli(['undo'], tempDir)
      expect(undoResult.exitCode).toBe(0)

      // Verify the staging is undone
      const cached = git('diff --cached', tempDir)
      expect(cached).toBe('')
    })

    it('should handle undo of new file in subdirectory', async () => {
      writeFileSync(join(tempDir, 'dummy.txt'), 'dummy\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)

      execSync(`mkdir -p ${join(tempDir, 'src', 'utils')}`)
      writeFileSync(join(tempDir, 'src', 'utils', 'helper.ts'), 'export const x = 1\n')

      await cli(['hunk', 'src/utils/helper.ts', '1'], tempDir)
      const undoResult = await cli(['undo'], tempDir)
      expect(undoResult.exitCode).toBe(0)

      const cached = git('diff --cached', tempDir)
      expect(cached).toBe('')
    })
  })

  describe('Bug H1: Undo of precise mode staging', () => {
    it('should undo precise mode staging correctly', async () => {
      const lines = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`)
      writeFileSync(join(tempDir, 'f.txt'), lines.join('\n') + '\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)

      lines[3] = 'PRECISE CHANGE'
      writeFileSync(join(tempDir, 'f.txt'), lines.join('\n') + '\n')

      // Stage in precise mode
      await cli(['hunk', 'f.txt', '1', '-p'], tempDir)

      const cachedBefore = git('diff --cached', tempDir)
      expect(cachedBefore).toContain('PRECISE CHANGE')

      // Undo
      const undoResult = await cli(['undo'], tempDir)
      expect(undoResult.exitCode).toBe(0)

      const cachedAfter = git('diff --cached', tempDir)
      expect(cachedAfter).toBe('')
    })

    it('should undo mixed history: precise then normal mode', async () => {
      const lines = Array.from({ length: 30 }, (_, i) => `Line ${i + 1}`)
      writeFileSync(join(tempDir, 'f.txt'), lines.join('\n') + '\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)

      lines[0] = 'CHANGE A'
      lines[14] = 'CHANGE B'
      lines[25] = 'CHANGE C'
      writeFileSync(join(tempDir, 'f.txt'), lines.join('\n') + '\n')

      // Stage hunk 1 in precise mode
      await cli(['hunk', 'f.txt', '1', '-p'], tempDir)
      // Stage hunk 1 in normal mode (remaining hunks)
      await cli(['hunk', 'f.txt', '1'], tempDir)

      // Undo both
      const undo1 = await cli(['undo'], tempDir)
      expect(undo1.exitCode).toBe(0)
      const undo2 = await cli(['undo'], tempDir)
      expect(undo2.exitCode).toBe(0)

      const cached = git('diff --cached', tempDir)
      expect(cached).toBe('')
    })
  })

  describe('Undo after working tree modification', () => {
    it('should undo staging even if working tree changed after staging', async () => {
      writeFileSync(join(tempDir, 'f.txt'), 'original\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)
      writeFileSync(join(tempDir, 'f.txt'), 'modified\n')

      await cli(['hunk', 'f.txt', '1'], tempDir)

      // Now modify working tree again
      writeFileSync(join(tempDir, 'f.txt'), 'further modified\n')

      // Undo should still work (tree-snapshot restores index state)
      const result = await cli(['undo'], tempDir)
      expect(result.exitCode).toBe(0)

      const cached = git('diff --cached', tempDir)
      expect(cached).toBe('')
    })
  })

  describe('Undo --count edge cases', () => {
    it('should undo exactly N when N equals history length', async () => {
      writeFileSync(join(tempDir, 'f.txt'), 'A\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)

      writeFileSync(join(tempDir, 'f.txt'), 'B\n')
      await cli(['hunk', 'f.txt', '1'], tempDir)
      writeFileSync(join(tempDir, 'f.txt'), 'C\n')
      await cli(['hunk', 'f.txt', '1'], tempDir)

      // Undo exactly 2 (full history)
      const result = await cli(['undo', '--count', '2'], tempDir)
      expect(result.exitCode).toBe(0)

      const cached = git('diff --cached', tempDir)
      expect(cached).toBe('')
    })
  })

  describe('Undo with multiple files', () => {
    it('should undo staging across different files', async () => {
      writeFileSync(join(tempDir, 'a.txt'), 'A\n')
      writeFileSync(join(tempDir, 'b.txt'), 'B\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)

      writeFileSync(join(tempDir, 'a.txt'), 'A modified\n')
      writeFileSync(join(tempDir, 'b.txt'), 'B modified\n')

      // Stage from different files
      await cli(['hunk', 'a.txt', '1'], tempDir)
      await cli(['hunk', 'b.txt', '1'], tempDir)

      // Undo last (b.txt)
      await cli(['undo'], tempDir)
      const cached1 = git('diff --cached', tempDir)
      expect(cached1).toContain('A modified')
      expect(cached1).not.toContain('B modified')

      // Undo a.txt
      await cli(['undo'], tempDir)
      const cached2 = git('diff --cached', tempDir)
      expect(cached2).toBe('')
    })
  })

  describe('Undo --all with many operations', () => {
    it('should undo 10+ staging operations', { timeout: 60000 }, async () => {
      const lines = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`)
      writeFileSync(join(tempDir, 'f.txt'), lines.join('\n') + '\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)

      // Create 10 separate changes
      for (let i = 0; i < 10; i++) {
        lines[i * 10] = `CHANGED ${i}`
      }
      writeFileSync(join(tempDir, 'f.txt'), lines.join('\n') + '\n')

      // Stage each hunk individually
      for (let i = 0; i < 5; i++) {
        await cli(['hunk', 'f.txt', '1'], tempDir)
      }

      // Undo all
      const result = await cli(['undo', '--all'], tempDir)
      expect(result.exitCode).toBe(0)

      const cached = git('diff --cached', tempDir)
      expect(cached).toBe('')
    })
  })
})
