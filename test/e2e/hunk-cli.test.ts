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

describe('Hunk CLI E2E', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'gt-hunk-e2e-'))
    await execa('git', ['init'], { cwd: tempDir })
    await execa('git', ['config', 'user.email', 't@t'], { cwd: tempDir })
    await execa('git', ['config', 'user.name', 'T'], { cwd: tempDir })
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  async function setupThreeHunks() {
    const lines = Array.from({ length: 30 }, (_, i) => `Line ${i + 1}`)
    await writeFile(join(tempDir, 'f.txt'), lines.join('\n') + '\n')
    await execa('git', ['add', '.'], { cwd: tempDir })
    await execa('git', ['commit', '-m', 'init'], { cwd: tempDir })

    lines[0] = 'MODIFIED 1'
    lines[14] = 'MODIFIED 2'
    lines[25] = 'MODIFIED 3'
    await writeFile(join(tempDir, 'f.txt'), lines.join('\n') + '\n')
  }

  describe('Selector syntax', () => {
    it('should accept space syntax: hunk file 1', async () => {
      await setupThreeHunks()
      const result = await run(['hunk', 'f.txt', '1'], tempDir)
      expect(result.exitCode).toBe(0)
      const output = result.stdout + result.stderr
      expect(output).toContain('Staged hunk')

      const cached = await execa('git', ['diff', '--cached'], { cwd: tempDir })
      expect(cached.stdout).toContain('MODIFIED 1')
    })

    it('should accept colon syntax: hunk file:1', async () => {
      await setupThreeHunks()
      const result = await run(['hunk', 'f.txt:1'], tempDir)
      expect(result.exitCode).toBe(0)

      const cached = await execa('git', ['diff', '--cached'], { cwd: tempDir })
      expect(cached.stdout).toContain('MODIFIED 1')
    })

    it('should accept comma-separated selectors: hunk file:1,2', async () => {
      await setupThreeHunks()
      const result = await run(['hunk', 'f.txt:1,2'], tempDir)
      expect(result.exitCode).toBe(0)

      const cached = await execa('git', ['diff', '--cached'], { cwd: tempDir })
      expect(cached.stdout).toContain('MODIFIED 1')
      expect(cached.stdout).toContain('MODIFIED 2')
    })

    it('should accept multiple space-separated selectors', async () => {
      await setupThreeHunks()
      const result = await run(['hunk', 'f.txt', '1', '3'], tempDir)
      expect(result.exitCode).toBe(0)

      const cached = await execa('git', ['diff', '--cached'], { cwd: tempDir })
      expect(cached.stdout).toContain('MODIFIED 1')
      expect(cached.stdout).toContain('MODIFIED 3')
    })

    it('should accept content-based hunk ID', async () => {
      await setupThreeHunks()
      // Get hunk IDs first via list
      const listResult = await run(['list', 'f.txt'], tempDir)
      // Extract 8-char hex ID from output like [1|abc12345]
      const match = listResult.stdout.match(/\[1\|([a-f0-9]{8})\]/)
      expect(match).not.toBeNull()
      const hunkId = match![1]

      const result = await run(['hunk', `f.txt:${hunkId}`], tempDir)
      expect(result.exitCode).toBe(0)

      const cached = await execa('git', ['diff', '--cached'], { cwd: tempDir })
      expect(cached.stdout).toContain('MODIFIED 1')
    })
  })

  describe('Flags', () => {
    it('should support --precise flag', async () => {
      await setupThreeHunks()
      const result = await run(['hunk', 'f.txt', '1', '-p'], tempDir)
      expect(result.exitCode).toBe(0)

      const cached = await execa('git', ['diff', '--cached'], { cwd: tempDir })
      expect(cached.stdout).toContain('MODIFIED')
    })

    it('should support --dry-run flag (no actual staging)', async () => {
      await setupThreeHunks()
      const result = await run(['hunk', 'f.txt', '1', '-d'], tempDir)
      expect(result.exitCode).toBe(0)
      const output = result.stdout + result.stderr
      expect(output).toContain('---')

      // Nothing should be staged
      const cached = await execa('git', ['diff', '--cached'], { cwd: tempDir })
      expect(cached.stdout).toBe('')
    })
  })

  describe('Multi-file staging', () => {
    it('should stage hunks from two different files', async () => {
      const lines1 = ['A', 'B', 'C']
      const lines2 = ['X', 'Y', 'Z']
      await writeFile(join(tempDir, 'a.txt'), lines1.join('\n') + '\n')
      await writeFile(join(tempDir, 'b.txt'), lines2.join('\n') + '\n')
      await execa('git', ['add', '.'], { cwd: tempDir })
      await execa('git', ['commit', '-m', 'init'], { cwd: tempDir })

      lines1[0] = 'A modified'
      lines2[0] = 'X modified'
      await writeFile(join(tempDir, 'a.txt'), lines1.join('\n') + '\n')
      await writeFile(join(tempDir, 'b.txt'), lines2.join('\n') + '\n')

      const result = await run(['hunk', 'a.txt:1', 'b.txt:1'], tempDir)
      expect(result.exitCode).toBe(0)

      const cached = await execa('git', ['diff', '--cached'], { cwd: tempDir })
      expect(cached.stdout).toContain('A modified')
      expect(cached.stdout).toContain('X modified')
    })
  })

  describe('Error handling', () => {
    it('should error with no arguments', async () => {
      const result = await run(['hunk'], tempDir)
      expect(result.exitCode).not.toBe(0)
    })

    it('should error for non-existent file', async () => {
      const result = await run(['hunk', 'nonexistent.txt', '1'], tempDir)
      expect(result.exitCode).not.toBe(0)
    })

    it('should error for invalid hunk selector', async () => {
      await setupThreeHunks()
      const result = await run(['hunk', 'f.txt', '99'], tempDir)
      expect(result.exitCode).not.toBe(0)
      const output = result.stdout + result.stderr
      expect(output).toContain('Available')
    })

    it('should error for file without selector', async () => {
      await setupThreeHunks()
      // Just a file with no selectors - use colon syntax with empty selector
      const result = await run(['hunk', 'f.txt:'], tempDir)
      expect(result.exitCode).not.toBe(0)
    })
  })

  describe('Stage and verify', () => {
    it('should stage single hunk and leave others unstaged', async () => {
      await setupThreeHunks()
      await run(['hunk', 'f.txt', '1'], tempDir)

      const cached = await execa('git', ['diff', '--cached'], { cwd: tempDir })
      expect(cached.stdout).toContain('MODIFIED 1')
      expect(cached.stdout).not.toContain('MODIFIED 2')
      expect(cached.stdout).not.toContain('MODIFIED 3')

      // Unstaged diff should still have 2 and 3
      const diff = await execa('git', ['diff'], { cwd: tempDir })
      expect(diff.stdout).toContain('MODIFIED 2')
      expect(diff.stdout).toContain('MODIFIED 3')
    })

    it('should stage all hunks when all selectors given', async () => {
      await setupThreeHunks()
      await run(['hunk', 'f.txt', '1', '2', '3'], tempDir)

      const cached = await execa('git', ['diff', '--cached'], { cwd: tempDir })
      expect(cached.stdout).toContain('MODIFIED 1')
      expect(cached.stdout).toContain('MODIFIED 2')
      expect(cached.stdout).toContain('MODIFIED 3')

      // Nothing should remain unstaged
      const diff = await execa('git', ['diff'], { cwd: tempDir })
      expect(diff.stdout).toBe('')
    })
  })

  describe('Untracked file', () => {
    it('should handle untracked file with intent-to-add', async () => {
      // Create initial commit (empty repo needs at least one commit)
      await writeFile(join(tempDir, 'dummy.txt'), 'dummy\n')
      await execa('git', ['add', '.'], { cwd: tempDir })
      await execa('git', ['commit', '-m', 'init'], { cwd: tempDir })

      // Add untracked file
      await writeFile(join(tempDir, 'new.txt'), 'line 1\nline 2\n')

      const result = await run(['hunk', 'new.txt', '1'], tempDir)
      expect(result.exitCode).toBe(0)

      const cached = await execa('git', ['diff', '--cached'], { cwd: tempDir })
      expect(cached.stdout).toContain('line 1')
    })
  })
})
