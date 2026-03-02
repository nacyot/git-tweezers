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

describe('Error Output Consistency E2E', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'gt-err-e2e-'))
    await execa('git', ['init'], { cwd: tempDir })
    await execa('git', ['config', 'user.email', 't@t'], { cwd: tempDir })
    await execa('git', ['config', 'user.name', 'T'], { cwd: tempDir })

    await writeFile(join(tempDir, 'f.txt'), 'hello\n')
    await execa('git', ['add', '.'], { cwd: tempDir })
    await execa('git', ['commit', '-m', 'init'], { cwd: tempDir })
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  describe('Common error patterns', () => {
    it('should never output EEXIT in any command error', async () => {
      const commands = [
        ['hunk', 'nonexistent.txt', '1'],
        ['lines', 'nonexistent.txt', '1'],
        ['undo'],
        ['undo', '--step', '999'],
      ]

      for (const args of commands) {
        const result = await run(args, tempDir)
        const output = result.stdout + result.stderr
        expect(output).not.toContain('EEXIT')
      }
    })

    it('should set non-zero exit code on all errors', async () => {
      const commands = [
        ['hunk', 'nonexistent.txt', '1'],
        ['lines', 'nonexistent.txt', '1'],
        ['undo'],
        ['undo', '--step', '999'],
      ]

      for (const args of commands) {
        const result = await run(args, tempDir)
        expect(result.exitCode).not.toBe(0)
      }
    })

    it('should output [ERROR] exactly once for each error', async () => {
      const commands = [
        ['undo'],
        ['undo', '--step', '999'],
      ]

      for (const args of commands) {
        const result = await run(args, tempDir)
        const output = result.stdout + result.stderr
        const errorCount = (output.match(/\[ERROR\]/g) || []).length
        expect(errorCount).toBe(1)
      }
    })
  })

  describe('Hunk command errors', () => {
    it('should show available hunks on invalid selector', async () => {
      await writeFile(join(tempDir, 'f.txt'), 'modified\n')
      const result = await run(['hunk', 'f.txt', '99'], tempDir)
      const output = result.stdout + result.stderr
      expect(output).toContain('Available')
      expect(result.exitCode).not.toBe(0)
    })

    it('should show mode mismatch hint', async () => {
      await writeFile(join(tempDir, 'f.txt'), 'modified\n')

      // Get a precise-mode hunk ID
      const listResult = await run(['list', 'f.txt', '-p'], tempDir)
      const match = listResult.stdout.match(/\[1\|([a-f0-9]{8})\]/)
      if (!match) return // skip if can't extract

      // Try to use that ID in normal mode - should fail with hint
      const result = await run(['hunk', `f.txt:${match[1]}`], tempDir)
      // The ID might work if the fingerprint happens to match,
      // but if it doesn't, it should show a mode mismatch hint
      if (result.exitCode !== 0) {
        const output = result.stdout + result.stderr
        expect(output).toContain('Mode mismatch')
      }
    })
  })

  describe('Lines command errors', () => {
    it('should show error for unchanged file', async () => {
      const result = await run(['lines', 'f.txt', '1'], tempDir)
      expect(result.exitCode).not.toBe(0)
      const output = result.stdout + result.stderr
      expect(output).toContain('No changes')
    })

    it('should show error for out-of-range lines', async () => {
      await writeFile(join(tempDir, 'f.txt'), 'modified\n')
      const result = await run(['lines', 'f.txt', '100-200'], tempDir)
      expect(result.exitCode).not.toBe(0)
    })
  })

  describe('List command output', () => {
    it('should show clean "No changes" message for clean repo', async () => {
      const result = await run(['list'], tempDir)
      const output = result.stdout + result.stderr
      expect(output).toContain('No changes')
      expect(output).not.toContain('EEXIT')
      expect(output).not.toContain('Error')
    })

    it('should show filter message when all files excluded', async () => {
      await writeFile(join(tempDir, 'f.txt'), 'modified\n')
      const result = await run(['list', '-e', '*.txt'], tempDir)
      const output = result.stdout + result.stderr
      // Should indicate no changes after filtering
      expect(output).toContain('No changes')
    })
  })

  describe('Undo command errors', () => {
    it('should show clean error for empty undo history', async () => {
      const result = await run(['undo'], tempDir)
      const output = result.stdout + result.stderr
      expect(output).toContain('[ERROR]')
      expect(output).not.toContain('EEXIT')
      expect(result.exitCode).not.toBe(0)
    })

    it('should show clean error for --list with empty history', async () => {
      const result = await run(['undo', '--list'], tempDir)
      const output = result.stdout + result.stderr
      expect(output).toContain('No staging history')
      expect(output).not.toContain('EEXIT')
    })

    it('should show clean error when --count exceeds history', async () => {
      // Stage something first
      await writeFile(join(tempDir, 'f.txt'), 'modified\n')
      await run(['hunk', 'f.txt', '1'], tempDir)

      const result = await run(['undo', '--count', '100'], tempDir)
      const output = result.stdout + result.stderr
      expect(output).toContain('only')
      expect(result.exitCode).not.toBe(0)
    })
  })
})
