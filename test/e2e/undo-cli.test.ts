import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execa } from 'execa'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const binPath = join(process.cwd(), 'bin', 'run.js')
const env = { ...process.env, OCLIF_TS_NODE: 'false' }

async function run(args: string[], cwd: string) {
  return execa('node', [binPath, ...args], { cwd, env, reject: false })
}

describe('Undo CLI E2E', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'gt-undo-e2e-'))
    await execa('git', ['init'], { cwd: tempDir })
    await execa('git', ['config', 'user.email', 't@t'], { cwd: tempDir })
    await execa('git', ['config', 'user.name', 'T'], { cwd: tempDir })

    // Create file with 3 hunks
    const lines = Array.from({ length: 30 }, (_, i) => `Line ${i + 1}`)
    await writeFile(join(tempDir, 'f.txt'), lines.join('\n') + '\n')
    await execa('git', ['add', '.'], { cwd: tempDir })
    await execa('git', ['commit', '-m', 'init'], { cwd: tempDir })

    lines[0] = 'MODIFIED 1'
    lines[14] = 'MODIFIED 2'
    lines[25] = 'MODIFIED 3'
    await writeFile(join(tempDir, 'f.txt'), lines.join('\n') + '\n')
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  describe('Basic undo', () => {
    it('should undo the most recent staging', async () => {
      await run(['hunk', 'f.txt', '1'], tempDir)
      const cached1 = await execa('git', ['diff', '--cached'], { cwd: tempDir })
      expect(cached1.stdout).toContain('MODIFIED 1')

      const result = await run(['undo'], tempDir)
      expect(result.exitCode).toBe(0)
      const output = result.stdout + result.stderr
      expect(output).toContain('Successfully undid')

      const cached2 = await execa('git', ['diff', '--cached'], { cwd: tempDir })
      expect(cached2.stdout).toBe('')
    })
  })

  describe('--count flag', () => {
    it('should undo N most recent operations', async () => {
      // Stage 3 hunks individually
      await run(['hunk', 'f.txt', '1'], tempDir)
      await run(['hunk', 'f.txt', '1'], tempDir) // Becomes new index 1 after first staging
      await run(['hunk', 'f.txt', '1'], tempDir)

      const result = await run(['undo', '--count', '2'], tempDir)
      expect(result.exitCode).toBe(0)
      const output = result.stdout + result.stderr
      expect(output).toContain('undid 2')

      // Only first hunk should remain staged
      const cached = await execa('git', ['diff', '--cached'], { cwd: tempDir })
      expect(cached.stdout).toContain('MODIFIED 1')
    })

    it('should error when count exceeds history', async () => {
      await run(['hunk', 'f.txt', '1'], tempDir)
      const result = await run(['undo', '--count', '5'], tempDir)
      expect(result.exitCode).not.toBe(0)
      const output = result.stdout + result.stderr
      expect(output).toContain('only')
    })
  })

  describe('--all flag', () => {
    it('should undo all staging operations', async () => {
      await run(['hunk', 'f.txt', '1'], tempDir)
      await run(['hunk', 'f.txt', '1'], tempDir)

      const result = await run(['undo', '--all'], tempDir)
      expect(result.exitCode).toBe(0)

      const cached = await execa('git', ['diff', '--cached'], { cwd: tempDir })
      expect(cached.stdout).toBe('')
    })
  })

  describe('--list flag', () => {
    it('should show staging history', async () => {
      await run(['hunk', 'f.txt', '1'], tempDir)
      const result = await run(['undo', '--list'], tempDir)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('[0]')
      expect(result.stdout).toContain('f.txt')
    })

    it('should show message for empty history', async () => {
      const result = await run(['undo', '--list'], tempDir)
      const output = result.stdout + result.stderr
      expect(output).toContain('No staging history')
    })
  })

  describe('--step flag', () => {
    it('should undo specific step', async () => {
      await run(['hunk', 'f.txt', '1'], tempDir)
      await run(['hunk', 'f.txt', '1'], tempDir)

      // Undo step 1 (second most recent)
      const result = await run(['undo', '--step', '1'], tempDir)
      expect(result.exitCode).toBe(0)
    })

    it('should error for invalid step', async () => {
      const result = await run(['undo', '--step', '99'], tempDir)
      expect(result.exitCode).not.toBe(0)
    })
  })

  describe('Error output consistency (Bug 4 regression)', () => {
    it('should output [ERROR] exactly once for empty history', async () => {
      const result = await run(['undo'], tempDir)
      const allOutput = result.stdout + result.stderr
      const errorCount = (allOutput.match(/\[ERROR\]/g) || []).length
      expect(errorCount).toBe(1)
    })

    it('should not output EEXIT', async () => {
      const result = await run(['undo'], tempDir)
      const allOutput = result.stdout + result.stderr
      expect(allOutput).not.toContain('EEXIT')
    })

    it('should set non-zero exit code on error', async () => {
      const result = await run(['undo'], tempDir)
      expect(result.exitCode).not.toBe(0)
    })
  })
})
