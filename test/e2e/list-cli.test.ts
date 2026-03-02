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

describe('List CLI E2E', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'gt-list-e2e-'))
    await execa('git', ['init'], { cwd: tempDir })
    await execa('git', ['config', 'user.email', 't@t'], { cwd: tempDir })
    await execa('git', ['config', 'user.name', 'T'], { cwd: tempDir })
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  async function setupChangedFile() {
    const lines = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`)
    await writeFile(join(tempDir, 'f.txt'), lines.join('\n') + '\n')
    await execa('git', ['add', '.'], { cwd: tempDir })
    await execa('git', ['commit', '-m', 'init'], { cwd: tempDir })

    lines[0] = 'MODIFIED 1'
    lines[14] = 'MODIFIED 2'
    await writeFile(join(tempDir, 'f.txt'), lines.join('\n') + '\n')
  }

  describe('Basic listing', () => {
    it('should list hunks for a specific file', async () => {
      await setupChangedFile()
      const result = await run(['list', 'f.txt'], tempDir)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('f.txt:')
      expect(result.stdout).toContain('[1|')
      expect(result.stdout).toContain('[2|')
    })

    it('should list all changed files when no file specified', async () => {
      await setupChangedFile()
      // Add another changed file
      await writeFile(join(tempDir, 'g.txt'), 'hello\n')
      await execa('git', ['add', 'g.txt'], { cwd: tempDir })
      await execa('git', ['commit', '-m', 'add g'], { cwd: tempDir })
      await writeFile(join(tempDir, 'g.txt'), 'hello modified\n')

      const result = await run(['list'], tempDir)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('f.txt:')
      expect(result.stdout).toContain('g.txt:')
    })

    it('should show "no changes" for clean repo', async () => {
      await writeFile(join(tempDir, 'f.txt'), 'hello\n')
      await execa('git', ['add', '.'], { cwd: tempDir })
      await execa('git', ['commit', '-m', 'init'], { cwd: tempDir })

      const result = await run(['list'], tempDir)
      const output = result.stdout + result.stderr
      expect(output).toContain('No changes')
    })
  })

  describe('Display modes', () => {
    it('should support --oneline mode', async () => {
      await setupChangedFile()
      const result = await run(['list', 'f.txt', '-o'], tempDir)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('[1|')
      // In oneline mode, there should be less output (no preview lines)
      const lineCount = result.stdout.split('\n').length
      // Oneline should have fewer lines than full preview
      const fullResult = await run(['list', 'f.txt'], tempDir)
      const fullLineCount = fullResult.stdout.split('\n').length
      expect(lineCount).toBeLessThan(fullLineCount)
    })

    it('should support --inline mode', async () => {
      await setupChangedFile()
      const result = await run(['list', 'f.txt', '-i'], tempDir)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('[1|')
    })
  })

  describe('Mode flags', () => {
    it('should support --precise mode', async () => {
      await setupChangedFile()
      const normal = await run(['list', 'f.txt'], tempDir)
      const precise = await run(['list', 'f.txt', '-p'], tempDir)

      expect(normal.exitCode).toBe(0)
      expect(precise.exitCode).toBe(0)

      const output = precise.stdout + precise.stderr
      expect(output).toContain('precise')
    })

    it('should show mode banner', async () => {
      await setupChangedFile()
      const result = await run(['list', 'f.txt'], tempDir)
      // Should display mode information
      const output = result.stdout + result.stderr
      expect(output).toMatch(/[Mm]ode/)
    })
  })

  describe('Hunk IDs', () => {
    it('should display 8-char hex hunk IDs', async () => {
      await setupChangedFile()
      const result = await run(['list', 'f.txt'], tempDir)
      // Match pattern [index|8-char-hex]
      const idMatches = result.stdout.match(/\[\d+\|[a-f0-9]{8}\]/g)
      expect(idMatches).not.toBeNull()
      expect(idMatches!.length).toBeGreaterThanOrEqual(2)
    })

    it('should show different IDs in precise vs normal mode', async () => {
      await setupChangedFile()
      const normal = await run(['list', 'f.txt'], tempDir)
      const precise = await run(['list', 'f.txt', '-p'], tempDir)

      const normalIds = normal.stdout.match(/\[\d+\|([a-f0-9]{8})\]/g) || []
      const preciseIds = precise.stdout.match(/\[\d+\|([a-f0-9]{8})\]/g) || []

      // IDs should differ between modes (different context = different fingerprint)
      // At least the ID values should be different
      expect(normalIds.join(',')).not.toBe(preciseIds.join(','))
    })
  })

  describe('Staged marker', () => {
    it('should show [STAGED] marker after staging a hunk', async () => {
      await setupChangedFile()
      await run(['hunk', 'f.txt', '1'], tempDir)

      const result = await run(['list', 'f.txt'], tempDir)
      expect(result.exitCode).toBe(0)
      const output = result.stdout + result.stderr
      expect(output).toContain('STAGED')
    })
  })

  describe('Filters', () => {
    it('should support --exclude pattern', async () => {
      await setupChangedFile()
      await writeFile(join(tempDir, 'test.spec.ts'), 'test\n')
      await execa('git', ['add', 'test.spec.ts'], { cwd: tempDir })
      await execa('git', ['commit', '-m', 'add test'], { cwd: tempDir })
      await writeFile(join(tempDir, 'test.spec.ts'), 'test modified\n')

      const result = await run(['list', '-e', '*.spec.ts'], tempDir)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('f.txt')
      expect(result.stdout).not.toContain('test.spec.ts')
    })

    it('should support --tracked-only', async () => {
      await setupChangedFile()
      // Add untracked file
      await writeFile(join(tempDir, 'untracked.txt'), 'untracked\n')

      const _withUntracked = await run(['list', '--no-respect-gitignore'], tempDir)
      const trackedOnly = await run(['list', '--tracked-only'], tempDir)

      // tracked-only should not include untracked file
      expect(trackedOnly.stdout).not.toContain('untracked.txt')
    })

    it('should support --staged-only', async () => {
      await setupChangedFile()
      // Stage one hunk
      await run(['hunk', 'f.txt', '1'], tempDir)

      const result = await run(['list', '--staged-only'], tempDir)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('f.txt')
    })
  })

  describe('Context flag', () => {
    it('should accept --context flag', async () => {
      await setupChangedFile()
      const result = await run(['list', 'f.txt', '-c', '0'], tempDir)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('[1|')
    })
  })

  describe('Multiple files argument', () => {
    it('should list hunks for specific files only', async () => {
      // Setup two changed files
      await writeFile(join(tempDir, 'a.txt'), 'A\n')
      await writeFile(join(tempDir, 'b.txt'), 'B\n')
      await writeFile(join(tempDir, 'c.txt'), 'C\n')
      await execa('git', ['add', '.'], { cwd: tempDir })
      await execa('git', ['commit', '-m', 'init'], { cwd: tempDir })

      await writeFile(join(tempDir, 'a.txt'), 'A modified\n')
      await writeFile(join(tempDir, 'b.txt'), 'B modified\n')
      await writeFile(join(tempDir, 'c.txt'), 'C modified\n')

      const result = await run(['list', 'a.txt', 'b.txt'], tempDir)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('a.txt')
      expect(result.stdout).toContain('b.txt')
      expect(result.stdout).not.toContain('c.txt')
    })
  })
})
