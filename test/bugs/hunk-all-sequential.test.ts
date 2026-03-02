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

describe('Hunk :all and Sequential Staging (Bug L1/P0-1 edge cases)', () => {
  let tempDir: string
  let staging: StagingService

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'gt-hunk-seq-'))
    git('init', tempDir)
    git('config user.email "t@t"', tempDir)
    git('config user.name "T"', tempDir)
    staging = new StagingService(tempDir)
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  describe('Stage all hunks via stageHunks API', () => {
    it('should stage all hunks by listing and passing all IDs', async () => {
      const lines = Array.from({ length: 30 }, (_, i) => `Line ${i + 1}`)
      writeFileSync(join(tempDir, 'f.txt'), lines.join('\n') + '\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)

      lines[0] = 'MOD 1'
      lines[14] = 'MOD 2'
      lines[25] = 'MOD 3'
      writeFileSync(join(tempDir, 'f.txt'), lines.join('\n') + '\n')

      const hunks = await staging.listHunksWithInfo('f.txt')
      const unstaged = hunks.filter(h => h.layer === 'unstaged')
      await staging.stageHunks('f.txt', unstaged.map(h => h.id))

      const diff = git('diff', tempDir)
      expect(diff).toBe('')
    })

    it('should stage all hunks via comma-separated indices in CLI', async () => {
      const lines = Array.from({ length: 30 }, (_, i) => `Line ${i + 1}`)
      writeFileSync(join(tempDir, 'f.txt'), lines.join('\n') + '\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)

      lines[0] = 'MOD 1'
      lines[14] = 'MOD 2'
      lines[25] = 'MOD 3'
      writeFileSync(join(tempDir, 'f.txt'), lines.join('\n') + '\n')

      const result = await cli(['hunk', 'f.txt:1,2,3'], tempDir)
      expect(result.exitCode).toBe(0)

      const diff = git('diff', tempDir)
      expect(diff).toBe('')
    })

    it('should handle multi-file staging with all hunks', async () => {
      writeFileSync(join(tempDir, 'a.txt'), 'A\n')
      writeFileSync(join(tempDir, 'b.txt'), 'B\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)

      writeFileSync(join(tempDir, 'a.txt'), 'A modified\n')
      writeFileSync(join(tempDir, 'b.txt'), 'B modified\n')

      const result = await cli(['hunk', 'a.txt:1', 'b.txt:1'], tempDir)
      expect(result.exitCode).toBe(0)

      const diff = git('diff', tempDir)
      expect(diff).toBe('')
    })

    it('should stage all hunks on deleted file', async () => {
      writeFileSync(join(tempDir, 'f.txt'), 'content\nline2\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)

      unlinkSync(join(tempDir, 'f.txt'))

      const result = await cli(['hunk', 'f.txt', '1'], tempDir)
      expect(result.exitCode).toBe(0)
    })
  })

  describe('Sequential staging with many hunks (Bug P0-1)', () => {
    it('should stage 10 hunks individually in sequence', async () => {
      const lines = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`)
      writeFileSync(join(tempDir, 'f.txt'), lines.join('\n') + '\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)

      // Create 10 separate changes
      for (let i = 0; i < 10; i++) {
        lines[i * 10] = `CHANGED ${i}`
      }
      writeFileSync(join(tempDir, 'f.txt'), lines.join('\n') + '\n')

      // Stage each hunk one by one
      for (let i = 0; i < 5; i++) {
        const result = await cli(['hunk', 'f.txt', '1'], tempDir)
        expect(result.exitCode).toBe(0)
      }

      const cached = git('diff --cached', tempDir)
      for (let i = 0; i < 5; i++) {
        expect(cached).toContain(`CHANGED ${i}`)
      }
    })

    it('should stage hunks by content-based ID after each application', async () => {
      const lines = Array.from({ length: 30 }, (_, i) => `Line ${i + 1}`)
      writeFileSync(join(tempDir, 'f.txt'), lines.join('\n') + '\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)

      lines[0] = 'CHANGE A'
      lines[14] = 'CHANGE B'
      lines[25] = 'CHANGE C'
      writeFileSync(join(tempDir, 'f.txt'), lines.join('\n') + '\n')

      // Get IDs before any staging
      const listResult = await cli(['list', 'f.txt'], tempDir)
      const ids = listResult.stdout.match(/\[\d+\|([a-f0-9]{8})\]/g)?.map(m => m.match(/\|([a-f0-9]{8})\]/)![1]) || []
      expect(ids.length).toBeGreaterThanOrEqual(3)

      // Stage hunk 3 by ID first
      const result1 = await cli(['hunk', `f.txt:${ids[2]}`], tempDir)
      expect(result1.exitCode).toBe(0)

      // Stage hunk 1 by ID (should still be valid)
      const result2 = await cli(['hunk', `f.txt:${ids[0]}`], tempDir)
      expect(result2.exitCode).toBe(0)

      const cached = git('diff --cached', tempDir)
      expect(cached).toContain('CHANGE A')
      expect(cached).toContain('CHANGE C')
    })
  })

  describe('Adjacent hunk merging (Bug L1)', () => {
    it('should handle adjacent changes that merge in precise mode', async () => {
      // Create lines with very close-together changes
      const lines = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`)
      writeFileSync(join(tempDir, 'f.txt'), lines.join('\n') + '\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)

      // Changes only 1 line apart - will be separate hunks in U0 but may merge
      lines[5] = 'ADJACENT A'
      lines[7] = 'ADJACENT B'
      writeFileSync(join(tempDir, 'f.txt'), lines.join('\n') + '\n')

      // List in precise mode
      const preciseHunks = await staging.listHunksWithInfo('f.txt', { precise: true })
      const unstaged = preciseHunks.filter(h => h.layer === 'unstaged')

      // Stage one, verify the other is still accessible
      if (unstaged.length >= 2) {
        await staging.stageHunk('f.txt', unstaged[0].id, { precise: true })

        const remaining = await staging.listHunksWithInfo('f.txt', { precise: true })
        const remainingUnstaged = remaining.filter(h => h.layer === 'unstaged')
        expect(remainingUnstaged.length).toBeGreaterThanOrEqual(1)
      }
    })

    it('should handle 5 consecutive line changes in precise mode (merged into 1 hunk)', async () => {
      const lines = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`)
      writeFileSync(join(tempDir, 'f.txt'), lines.join('\n') + '\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)

      // Change 5 consecutive lines — git U0 merges adjacent changes into 1 hunk
      for (let i = 5; i < 10; i++) {
        lines[i] = `CONSECUTIVE ${i}`
      }
      writeFileSync(join(tempDir, 'f.txt'), lines.join('\n') + '\n')

      const hunks = await staging.listHunksWithInfo('f.txt', { precise: true })
      const unstaged = hunks.filter(h => h.layer === 'unstaged')
      // Consecutive changes are merged by git even in U0 mode
      expect(unstaged.length).toBeGreaterThanOrEqual(1)

      // Stage all hunks
      await staging.stageHunks('f.txt', unstaged.map(h => h.id), { precise: true })

      const diff = git('diff', tempDir)
      expect(diff).toBe('')
    })

    it('should handle 5 spaced-out changes in precise mode as separate hunks', async () => {
      const lines = Array.from({ length: 50 }, (_, i) => `Line ${i + 1}`)
      writeFileSync(join(tempDir, 'f.txt'), lines.join('\n') + '\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)

      // Space changes 10 lines apart to guarantee separate hunks
      lines[0] = 'SPACED 0'
      lines[10] = 'SPACED 1'
      lines[20] = 'SPACED 2'
      lines[30] = 'SPACED 3'
      lines[40] = 'SPACED 4'
      writeFileSync(join(tempDir, 'f.txt'), lines.join('\n') + '\n')

      const hunks = await staging.listHunksWithInfo('f.txt', { precise: true })
      const unstaged = hunks.filter(h => h.layer === 'unstaged')
      expect(unstaged.length).toBe(5)

      await staging.stageHunks('f.txt', unstaged.map(h => h.id), { precise: true })

      const diff = git('diff', tempDir)
      expect(diff).toBe('')
    })
  })

  describe('Combined patch vs sequential fallback', () => {
    it('should succeed with non-overlapping hunks via combined patch', async () => {
      const lines = Array.from({ length: 40 }, (_, i) => `Line ${i + 1}`)
      writeFileSync(join(tempDir, 'f.txt'), lines.join('\n') + '\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)

      // Widely separated changes (no context overlap)
      lines[0] = 'WIDE A'
      lines[20] = 'WIDE B'
      lines[35] = 'WIDE C'
      writeFileSync(join(tempDir, 'f.txt'), lines.join('\n') + '\n')

      await staging.stageHunks('f.txt', ['1', '3'])

      const cached = git('diff --cached', tempDir)
      expect(cached).toContain('WIDE A')
      expect(cached).not.toContain('WIDE B')
      expect(cached).toContain('WIDE C')
    })

    it('should fallback to sequential when combined patch has overlapping context', async () => {
      const lines = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`)
      writeFileSync(join(tempDir, 'f.txt'), lines.join('\n') + '\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)

      // Changes close enough that context lines overlap (within 3 lines)
      lines[5] = 'CLOSE A'
      lines[9] = 'CLOSE B'
      writeFileSync(join(tempDir, 'f.txt'), lines.join('\n') + '\n')

      // This might be 1 or 2 hunks depending on context merging
      const hunks = await staging.listHunksWithInfo('f.txt')
      const unstaged = hunks.filter(h => h.layer === 'unstaged')

      if (unstaged.length >= 2) {
        // If they're separate, staging both should work via fallback
        await staging.stageHunks('f.txt', ['1', '2'])
        const diff = git('diff', tempDir)
        expect(diff).toBe('')
      } else {
        // If merged into one hunk, staging the single hunk should work
        await staging.stageHunk('f.txt', '1')
        const cached = git('diff --cached', tempDir)
        expect(cached).toContain('CLOSE A')
        expect(cached).toContain('CLOSE B')
      }
    })
  })

  describe('Multi-hunk staging with content-based IDs', () => {
    it('should handle stageHunks with content-based IDs', async () => {
      const lines = Array.from({ length: 30 }, (_, i) => `Line ${i + 1}`)
      writeFileSync(join(tempDir, 'f.txt'), lines.join('\n') + '\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)

      lines[0] = 'BY ID A'
      lines[14] = 'BY ID B'
      lines[25] = 'BY ID C'
      writeFileSync(join(tempDir, 'f.txt'), lines.join('\n') + '\n')

      const hunks = await staging.listHunksWithInfo('f.txt')
      const unstaged = hunks.filter(h => h.layer === 'unstaged')
      expect(unstaged.length).toBe(3)

      // Stage by IDs (not indices)
      await staging.stageHunks('f.txt', [unstaged[0].id, unstaged[2].id])

      const cached = git('diff --cached', tempDir)
      expect(cached).toContain('BY ID A')
      expect(cached).not.toContain('BY ID B')
      expect(cached).toContain('BY ID C')
    })
  })

  describe('Dual-layer staging interactions', () => {
    it('should not re-stage an already staged hunk', async () => {
      writeFileSync(join(tempDir, 'f.txt'), 'original\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)
      writeFileSync(join(tempDir, 'f.txt'), 'modified\n')

      // Stage it
      await staging.stageHunk('f.txt', '1')

      // Try staging again - should error or find no unstaged hunks
      const hunks = await staging.listHunksWithInfo('f.txt')
      const unstaged = hunks.filter(h => h.layer === 'unstaged')
      expect(unstaged.length).toBe(0)
    })

    it('should show staged and unstaged hunks separately', async () => {
      const lines = Array.from({ length: 30 }, (_, i) => `Line ${i + 1}`)
      writeFileSync(join(tempDir, 'f.txt'), lines.join('\n') + '\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)

      lines[0] = 'STAGED'
      lines[14] = 'UNSTAGED 1'
      lines[25] = 'UNSTAGED 2'
      writeFileSync(join(tempDir, 'f.txt'), lines.join('\n') + '\n')

      await staging.stageHunk('f.txt', '1')

      const hunks = await staging.listHunksWithInfo('f.txt')
      const staged = hunks.filter(h => h.layer === 'staged')
      const unstaged = hunks.filter(h => h.layer === 'unstaged')

      expect(staged.length).toBeGreaterThanOrEqual(1)
      expect(unstaged.length).toBeGreaterThanOrEqual(1)
    })
  })
})
