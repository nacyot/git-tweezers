import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execa } from 'execa'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const binPath = join(process.cwd(), 'bin', 'run.js')
const env = { ...process.env, OCLIF_TS_NODE: 'false' }

async function run(args: string[], cwd: string) {
  return execa('node', [binPath, ...args], { cwd, env, reject: false })
}

describe('Real-World Diff Patterns E2E', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'gt-real-e2e-'))
    await execa('git', ['init'], { cwd: tempDir })
    await execa('git', ['config', 'user.email', 't@t'], { cwd: tempDir })
    await execa('git', ['config', 'user.name', 'T'], { cwd: tempDir })
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  describe('Package.json version bump', () => {
    it('should stage only version line change', async () => {
      const pkg = JSON.stringify({
        name: 'test-pkg',
        version: '1.0.0',
        description: 'A test package',
        main: 'index.js',
      }, null, 2) + '\n'
      await writeFile(join(tempDir, 'package.json'), pkg)
      await execa('git', ['add', '.'], { cwd: tempDir })
      await execa('git', ['commit', '-m', 'init'], { cwd: tempDir })

      const updatedPkg = pkg.replace('"1.0.0"', '"2.0.0"')
      await writeFile(join(tempDir, 'package.json'), updatedPkg)

      const result = await run(['hunk', 'package.json', '1'], tempDir)
      expect(result.exitCode).toBe(0)

      const cached = await execa('git', ['diff', '--cached'], { cwd: tempDir })
      expect(cached.stdout).toContain('2.0.0')
    })
  })

  describe('Multi-function file changes', () => {
    it('should independently stage changes in different functions', async () => {
      const code = [
        'function add(a, b) {',
        '  return a + b',
        '}',
        '',
        'function subtract(a, b) {',
        '  return a - b',
        '}',
        '',
        'function multiply(a, b) {',
        '  return a * b',
        '}',
        '',
        'module.exports = { add, subtract, multiply }',
        '',
      ].join('\n')
      await writeFile(join(tempDir, 'math.js'), code)
      await execa('git', ['add', '.'], { cwd: tempDir })
      await execa('git', ['commit', '-m', 'init'], { cwd: tempDir })

      // Modify two functions but not the third
      const modified = code
        .replace('return a + b', 'return a + b + 0 // validated')
        .replace('return a * b', 'return a * b * 1 // validated')
      await writeFile(join(tempDir, 'math.js'), modified)

      const listResult = await run(['list', 'math.js'], tempDir)
      expect(listResult.exitCode).toBe(0)

      // Stage only the first hunk
      await run(['hunk', 'math.js', '1'], tempDir)

      const cached = await execa('git', ['diff', '--cached'], { cwd: tempDir })
      expect(cached.stdout).toContain('validated')

      // The other change should remain unstaged
      const diff = await execa('git', ['diff'], { cwd: tempDir })
      expect(diff.stdout).toContain('validated')
    })
  })

  describe('Config file changes (YAML-like)', () => {
    it('should stage specific config section changes', async () => {
      const config = [
        'database:',
        '  host: localhost',
        '  port: 5432',
        '  name: mydb',
        '',
        'cache:',
        '  host: localhost',
        '  port: 6379',
        '  ttl: 3600',
        '',
        'server:',
        '  port: 3000',
        '  debug: false',
        '',
      ].join('\n')
      await writeFile(join(tempDir, 'config.yml'), config)
      await execa('git', ['add', '.'], { cwd: tempDir })
      await execa('git', ['commit', '-m', 'init'], { cwd: tempDir })

      // Change database and server sections
      const modified = config
        .replace('port: 5432', 'port: 5433')
        .replace('debug: false', 'debug: true')
      await writeFile(join(tempDir, 'config.yml'), modified)

      // List to see hunks
      const listResult = await run(['list', 'config.yml'], tempDir)
      expect(listResult.exitCode).toBe(0)

      // Stage just the first change
      await run(['hunk', 'config.yml', '1'], tempDir)
      const cached = await execa('git', ['diff', '--cached'], { cwd: tempDir })
      expect(cached.stdout).toContain('5433')
    })
  })

  describe('Large file with many hunks', () => {
    it('should handle file with 10+ hunks', async () => {
      // Create a file with many sections
      const sections = Array.from({ length: 15 }, (_, i) =>
        Array.from({ length: 5 }, (_, j) => `Section ${i + 1} Line ${j + 1}`)
      ).flat()
      await writeFile(join(tempDir, 'large.txt'), sections.join('\n') + '\n')
      await execa('git', ['add', '.'], { cwd: tempDir })
      await execa('git', ['commit', '-m', 'init'], { cwd: tempDir })

      // Modify every other section
      for (let i = 0; i < 15; i += 2) {
        sections[i * 5] = `MODIFIED Section ${i + 1} Line 1`
      }
      await writeFile(join(tempDir, 'large.txt'), sections.join('\n') + '\n')

      const listResult = await run(['list', 'large.txt'], tempDir)
      expect(listResult.exitCode).toBe(0)
      // Should have multiple hunks
      const hunkMatches = listResult.stdout.match(/\[\d+\|[a-f0-9]{8}\]/g)
      expect(hunkMatches).not.toBeNull()
      expect(hunkMatches!.length).toBeGreaterThanOrEqual(3)
    })
  })

  describe('Subdirectory files', () => {
    it('should handle files in nested directories', async () => {
      await mkdir(join(tempDir, 'src', 'utils'), { recursive: true })
      await writeFile(join(tempDir, 'src', 'utils', 'helper.ts'), 'export const x = 1\n')
      await execa('git', ['add', '.'], { cwd: tempDir })
      await execa('git', ['commit', '-m', 'init'], { cwd: tempDir })

      await writeFile(join(tempDir, 'src', 'utils', 'helper.ts'), 'export const x = 2\n')

      const result = await run(['hunk', 'src/utils/helper.ts', '1'], tempDir)
      expect(result.exitCode).toBe(0)

      const cached = await execa('git', ['diff', '--cached'], { cwd: tempDir })
      expect(cached.stdout).toContain('x = 2')
    })
  })

  describe('EOF newline changes', () => {
    it('should handle adding newline at EOF', async () => {
      // File without trailing newline
      await writeFile(join(tempDir, 'f.txt'), 'no newline at end')
      await execa('git', ['add', '.'], { cwd: tempDir })
      await execa('git', ['commit', '-m', 'init'], { cwd: tempDir })

      // Add trailing newline
      await writeFile(join(tempDir, 'f.txt'), 'no newline at end\n')

      const result = await run(['hunk', 'f.txt', '1'], tempDir)
      expect(result.exitCode).toBe(0)
    })

    it('should handle removing newline at EOF', async () => {
      await writeFile(join(tempDir, 'f.txt'), 'has newline\n')
      await execa('git', ['add', '.'], { cwd: tempDir })
      await execa('git', ['commit', '-m', 'init'], { cwd: tempDir })

      await writeFile(join(tempDir, 'f.txt'), 'has newline')

      const result = await run(['hunk', 'f.txt', '1'], tempDir)
      expect(result.exitCode).toBe(0)
    })
  })

  describe('Empty lines and whitespace', () => {
    it('should handle files with blank line changes', async () => {
      const original = 'line1\n\n\nline2\n'
      await writeFile(join(tempDir, 'f.txt'), original)
      await execa('git', ['add', '.'], { cwd: tempDir })
      await execa('git', ['commit', '-m', 'init'], { cwd: tempDir })

      // Remove blank lines
      await writeFile(join(tempDir, 'f.txt'), 'line1\nline2\n')

      const result = await run(['hunk', 'f.txt', '1'], tempDir)
      expect(result.exitCode).toBe(0)
    })
  })

  describe('Stage → undo → re-stage cycle', () => {
    it('should handle full cycle: stage, undo, re-stage', async () => {
      await writeFile(join(tempDir, 'f.txt'), 'original\n')
      await execa('git', ['add', '.'], { cwd: tempDir })
      await execa('git', ['commit', '-m', 'init'], { cwd: tempDir })
      await writeFile(join(tempDir, 'f.txt'), 'modified\n')

      // Stage
      const stage1 = await run(['hunk', 'f.txt', '1'], tempDir)
      expect(stage1.exitCode).toBe(0)

      // Undo
      const undo = await run(['undo'], tempDir)
      expect(undo.exitCode).toBe(0)

      // Verify undone
      const cached1 = await execa('git', ['diff', '--cached'], { cwd: tempDir })
      expect(cached1.stdout).toBe('')

      // Re-stage
      const stage2 = await run(['hunk', 'f.txt', '1'], tempDir)
      expect(stage2.exitCode).toBe(0)

      const cached2 = await execa('git', ['diff', '--cached'], { cwd: tempDir })
      expect(cached2.stdout).toContain('modified')
    })
  })

  describe('Multiple file operations', () => {
    it('should handle staging hunks from multiple files independently', async () => {
      await writeFile(join(tempDir, 'a.txt'), 'aaa\n')
      await writeFile(join(tempDir, 'b.txt'), 'bbb\n')
      await writeFile(join(tempDir, 'c.txt'), 'ccc\n')
      await execa('git', ['add', '.'], { cwd: tempDir })
      await execa('git', ['commit', '-m', 'init'], { cwd: tempDir })

      await writeFile(join(tempDir, 'a.txt'), 'aaa modified\n')
      await writeFile(join(tempDir, 'b.txt'), 'bbb modified\n')
      await writeFile(join(tempDir, 'c.txt'), 'ccc modified\n')

      // Stage only a.txt and c.txt
      await run(['hunk', 'a.txt', '1'], tempDir)
      await run(['hunk', 'c.txt', '1'], tempDir)

      const cached = await execa('git', ['diff', '--cached'], { cwd: tempDir })
      expect(cached.stdout).toContain('aaa modified')
      expect(cached.stdout).not.toContain('bbb modified')
      expect(cached.stdout).toContain('ccc modified')

      // b.txt should still be in working diff
      const diff = await execa('git', ['diff'], { cwd: tempDir })
      expect(diff.stdout).toContain('bbb modified')
    })
  })
})
