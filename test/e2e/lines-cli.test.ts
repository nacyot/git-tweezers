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

describe('Lines CLI E2E', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'gt-lines-e2e-'))
    await execa('git', ['init'], { cwd: tempDir })
    await execa('git', ['config', 'user.email', 't@t'], { cwd: tempDir })
    await execa('git', ['config', 'user.name', 'T'], { cwd: tempDir })
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  describe('Basic line staging', () => {
    it('should stage a single modified line', async () => {
      await writeFile(join(tempDir, 'f.txt'), 'line1\nline2\nline3\n')
      await execa('git', ['add', '.'], { cwd: tempDir })
      await execa('git', ['commit', '-m', 'init'], { cwd: tempDir })
      await writeFile(join(tempDir, 'f.txt'), 'CHANGED\nline2\nline3\n')

      const result = await run(['lines', 'f.txt', '1'], tempDir)
      expect(result.exitCode).toBe(0)

      const cached = await execa('git', ['diff', '--cached'], { cwd: tempDir })
      expect(cached.stdout).toContain('CHANGED')
    })

    it('should stage a line range', async () => {
      const lines = Array.from({ length: 10 }, (_, i) => `Line ${i + 1}`)
      await writeFile(join(tempDir, 'f.txt'), lines.join('\n') + '\n')
      await execa('git', ['add', '.'], { cwd: tempDir })
      await execa('git', ['commit', '-m', 'init'], { cwd: tempDir })

      lines[0] = 'CHANGED 1'
      lines[1] = 'CHANGED 2'
      lines[2] = 'CHANGED 3'
      await writeFile(join(tempDir, 'f.txt'), lines.join('\n') + '\n')

      const result = await run(['lines', 'f.txt', '1-3'], tempDir)
      expect(result.exitCode).toBe(0)

      const cached = await execa('git', ['diff', '--cached'], { cwd: tempDir })
      expect(cached.stdout).toContain('CHANGED 1')
      expect(cached.stdout).toContain('CHANGED 2')
      expect(cached.stdout).toContain('CHANGED 3')
    })

    it('should stage multiple comma-separated ranges', async () => {
      const lines = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`)
      await writeFile(join(tempDir, 'f.txt'), lines.join('\n') + '\n')
      await execa('git', ['add', '.'], { cwd: tempDir })
      await execa('git', ['commit', '-m', 'init'], { cwd: tempDir })

      lines[0] = 'CHANGED A'
      lines[9] = 'CHANGED B'
      lines[18] = 'CHANGED C'
      await writeFile(join(tempDir, 'f.txt'), lines.join('\n') + '\n')

      const result = await run(['lines', 'f.txt', '1,10,19'], tempDir)
      expect(result.exitCode).toBe(0)

      const cached = await execa('git', ['diff', '--cached'], { cwd: tempDir })
      expect(cached.stdout).toContain('CHANGED A')
      expect(cached.stdout).toContain('CHANGED B')
      expect(cached.stdout).toContain('CHANGED C')
    })
  })

  describe('Dry-run', () => {
    it('should show patch without staging', async () => {
      await writeFile(join(tempDir, 'f.txt'), 'old\nkeep\n')
      await execa('git', ['add', '.'], { cwd: tempDir })
      await execa('git', ['commit', '-m', 'init'], { cwd: tempDir })
      await writeFile(join(tempDir, 'f.txt'), 'new\nkeep\n')

      const result = await run(['lines', 'f.txt', '1', '-d'], tempDir)
      expect(result.exitCode).toBe(0)
      const output = result.stdout + result.stderr
      expect(output).toContain('---')

      const cached = await execa('git', ['diff', '--cached'], { cwd: tempDir })
      expect(cached.stdout).toBe('')
    })
  })

  describe('Addition lines', () => {
    it('should stage added lines', async () => {
      await writeFile(join(tempDir, 'f.txt'), 'A\nC\n')
      await execa('git', ['add', '.'], { cwd: tempDir })
      await execa('git', ['commit', '-m', 'init'], { cwd: tempDir })
      await writeFile(join(tempDir, 'f.txt'), 'A\nB\nC\n')

      const result = await run(['lines', 'f.txt', '2'], tempDir)
      expect(result.exitCode).toBe(0)

      const cached = await execa('git', ['diff', '--cached'], { cwd: tempDir })
      expect(cached.stdout).toContain('+B')
    })
  })

  describe('Deletion lines', () => {
    it('should stage deleted lines via old-line numbers', async () => {
      await writeFile(join(tempDir, 'f.txt'), 'A\nB\nC\nD\n')
      await execa('git', ['add', '.'], { cwd: tempDir })
      await execa('git', ['commit', '-m', 'init'], { cwd: tempDir })
      await writeFile(join(tempDir, 'f.txt'), 'A\nD\n')

      const result = await run(['lines', 'f.txt', '2-3'], tempDir)
      expect(result.exitCode).toBe(0)

      const cached = await execa('git', ['diff', '--cached'], { cwd: tempDir })
      expect(cached.stdout).toContain('-B')
      expect(cached.stdout).toContain('-C')
    })
  })

  describe('Replacement pattern (Bug 1 regression)', () => {
    it('should include both delete and add for replacement', async () => {
      await writeFile(join(tempDir, 'f.txt'), 'old line\nkeep\n')
      await execa('git', ['add', '.'], { cwd: tempDir })
      await execa('git', ['commit', '-m', 'init'], { cwd: tempDir })
      await writeFile(join(tempDir, 'f.txt'), 'new line\nkeep\n')

      const result = await run(['lines', 'f.txt', '1'], tempDir)
      expect(result.exitCode).toBe(0)

      const cached = await execa('git', ['diff', '--cached'], { cwd: tempDir })
      expect(cached.stdout).toContain('-old line')
      expect(cached.stdout).toContain('+new line')
    })
  })

  describe('Error handling', () => {
    it('should error for out-of-range lines', async () => {
      await writeFile(join(tempDir, 'f.txt'), 'A\nB\n')
      await execa('git', ['add', '.'], { cwd: tempDir })
      await execa('git', ['commit', '-m', 'init'], { cwd: tempDir })
      await writeFile(join(tempDir, 'f.txt'), 'A\nB modified\n')

      const result = await run(['lines', 'f.txt', '50-60'], tempDir)
      expect(result.exitCode).not.toBe(0)
    })

    it('should error for non-existent file', async () => {
      const result = await run(['lines', 'nonexistent.txt', '1'], tempDir)
      expect(result.exitCode).not.toBe(0)
    })

    it('should error for unchanged file', async () => {
      await writeFile(join(tempDir, 'f.txt'), 'hello\n')
      await execa('git', ['add', '.'], { cwd: tempDir })
      await execa('git', ['commit', '-m', 'init'], { cwd: tempDir })

      const result = await run(['lines', 'f.txt', '1'], tempDir)
      expect(result.exitCode).not.toBe(0)
    })

    it('should error for missing range argument', async () => {
      await writeFile(join(tempDir, 'f.txt'), 'hello\n')
      await execa('git', ['add', '.'], { cwd: tempDir })
      await execa('git', ['commit', '-m', 'init'], { cwd: tempDir })
      await writeFile(join(tempDir, 'f.txt'), 'modified\n')

      const result = await run(['lines', 'f.txt'], tempDir)
      expect(result.exitCode).not.toBe(0)
    })
  })
})
