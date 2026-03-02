import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { parseFileSelector } from '../../src/utils/file-parser.js'
import { execa } from 'execa'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const binPath = join(process.cwd(), 'bin', 'run.js')
const env = { ...process.env, OCLIF_TS_NODE: 'false' }

async function cli(args: string[], cwd: string) {
  return execa('node', [binPath, ...args], { cwd, env, reject: false })
}

describe('File Parser Edge Cases', () => {
  describe('parseFileSelector', () => {
    it('should parse file:selector format', () => {
      const result = parseFileSelector('src/file.ts:3')
      expect(result.file).toBe('src/file.ts')
      expect(result.selector).toBe('3')
    })

    it('should parse file with hex ID selector', () => {
      const result = parseFileSelector('file.ts:abc12345')
      expect(result.file).toBe('file.ts')
      expect(result.selector).toBe('abc12345')
    })

    it('should handle file without selector', () => {
      const result = parseFileSelector('src/file.ts')
      expect(result.file).toBe('src/file.ts')
      expect(result.selector).toBeUndefined()
    })

    it('should handle Windows path (C:\\path)', () => {
      const result = parseFileSelector('C:\\Users\\test\\file.ts')
      expect(result.file).toBe('C:\\Users\\test\\file.ts')
      expect(result.selector).toBeUndefined()
    })

    it('should handle file:all selector', () => {
      const result = parseFileSelector('file.ts:all')
      expect(result.file).toBe('file.ts')
      expect(result.selector).toBe('all')
    })

    it('should handle comma-separated selectors', () => {
      const result = parseFileSelector('file.ts:1,2,3')
      expect(result.file).toBe('file.ts')
      expect(result.selector).toBe('1,2,3')
    })

    it('should handle empty selector (file:)', () => {
      const result = parseFileSelector('file.ts:')
      // Empty selector should be treated as just the file
      expect(result.file).toBe('file.ts:')
      expect(result.selector).toBeUndefined()
    })

    it('should handle file with dots in name', () => {
      const result = parseFileSelector('my.config.json:1')
      expect(result.file).toBe('my.config.json')
      expect(result.selector).toBe('1')
    })

    it('should handle deeply nested path with selector', () => {
      const result = parseFileSelector('src/core/utils/helper.ts:abc12345')
      expect(result.file).toBe('src/core/utils/helper.ts')
      expect(result.selector).toBe('abc12345')
    })

    it('should use lastIndexOf for colon (path:port:selector edge case)', () => {
      // URL-like path with port — should split at last colon
      const result = parseFileSelector('http://host:8080:selector')
      expect(result.selector).toBe('selector')
    })

    it('should handle path with @', () => {
      const result = parseFileSelector('@types/node/index.d.ts:1')
      expect(result.file).toBe('@types/node/index.d.ts')
      expect(result.selector).toBe('1')
    })
  })
})

describe('Exclude Glob Patterns (Bug L2 regression)', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'gt-glob-'))
    await execa('git', ['init'], { cwd: tempDir })
    await execa('git', ['config', 'user.email', 't@t'], { cwd: tempDir })
    await execa('git', ['config', 'user.name', 'T'], { cwd: tempDir })

    // Create initial directory structure
    await mkdir(join(tempDir, 'src', 'utils'), { recursive: true })
    await mkdir(join(tempDir, 'types', 'sub'), { recursive: true })
    await mkdir(join(tempDir, 'test'), { recursive: true })

    await writeFile(join(tempDir, 'src', 'index.ts'), 'export const x = 1\n')
    await writeFile(join(tempDir, 'src', 'utils', 'helper.ts'), 'export const h = 1\n')
    await writeFile(join(tempDir, 'types', 'foo.d.ts'), 'declare const foo: string\n')
    await writeFile(join(tempDir, 'types', 'sub', 'bar.d.ts'), 'declare const bar: string\n')
    await writeFile(join(tempDir, 'test', 'test.spec.ts'), 'test("x", () => {})\n')
    await writeFile(join(tempDir, 'README.md'), '# Test\n')

    await execa('git', ['add', '.'], { cwd: tempDir })
    await execa('git', ['commit', '-m', 'init'], { cwd: tempDir })

    // Modify all files
    await writeFile(join(tempDir, 'src', 'index.ts'), 'export const x = 2\n')
    await writeFile(join(tempDir, 'src', 'utils', 'helper.ts'), 'export const h = 2\n')
    await writeFile(join(tempDir, 'types', 'foo.d.ts'), 'declare const foo: number\n')
    await writeFile(join(tempDir, 'types', 'sub', 'bar.d.ts'), 'declare const bar: number\n')
    await writeFile(join(tempDir, 'test', 'test.spec.ts'), 'test("x", () => { expect(1) })\n')
    await writeFile(join(tempDir, 'README.md'), '# Updated\n')
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  describe('Basename matching (patterns without /)', () => {
    it('should exclude by extension: --exclude "*.md"', async () => {
      const result = await cli(['list', '-e', '*.md'], tempDir)
      expect(result.stdout).not.toContain('README.md')
      expect(result.stdout).toContain('index.ts')
    })

    it('should exclude by extension: --exclude "*.d.ts"', async () => {
      const result = await cli(['list', '-e', '*.d.ts'], tempDir)
      expect(result.stdout).not.toContain('foo.d.ts')
      expect(result.stdout).not.toContain('bar.d.ts')
      expect(result.stdout).toContain('index.ts')
    })

    it('should exclude by partial name: --exclude "*.spec.ts"', async () => {
      const result = await cli(['list', '-e', '*.spec.ts'], tempDir)
      expect(result.stdout).not.toContain('test.spec.ts')
      expect(result.stdout).toContain('index.ts')
    })
  })

  describe('Path matching (patterns with /)', () => {
    it('should exclude directory: --exclude "types/**"', async () => {
      const result = await cli(['list', '-e', 'types/**'], tempDir)
      expect(result.stdout).not.toContain('foo.d.ts')
      expect(result.stdout).not.toContain('bar.d.ts')
      expect(result.stdout).toContain('index.ts')
    })

    it('should exclude nested directory: --exclude "types/sub/**"', async () => {
      const result = await cli(['list', '-e', 'types/sub/**'], tempDir)
      // types/foo.d.ts should still be listed
      expect(result.stdout).toContain('foo.d.ts')
      // types/sub/bar.d.ts should be excluded
      expect(result.stdout).not.toContain('bar.d.ts')
    })

    it('should exclude with mid-path globstar: --exclude "src/**/helper.ts"', async () => {
      const result = await cli(['list', '-e', 'src/**/helper.ts'], tempDir)
      expect(result.stdout).not.toContain('helper.ts')
      expect(result.stdout).toContain('index.ts')
    })
  })

  describe('Multiple exclude patterns', () => {
    it('should apply multiple --exclude flags', async () => {
      const result = await cli(['list', '-e', '*.md', '-e', '*.d.ts'], tempDir)
      expect(result.stdout).not.toContain('README.md')
      expect(result.stdout).not.toContain('foo.d.ts')
      expect(result.stdout).not.toContain('bar.d.ts')
      expect(result.stdout).toContain('index.ts')
    })

    it('should combine directory and extension excludes', async () => {
      const result = await cli(['list', '-e', 'test/**', '-e', '*.md'], tempDir)
      expect(result.stdout).not.toContain('test.spec.ts')
      expect(result.stdout).not.toContain('README.md')
      expect(result.stdout).toContain('index.ts')
    })
  })

  describe('? wildcard', () => {
    it('should match single character with ?', async () => {
      // Create files differing by single char
      await writeFile(join(tempDir, 'a1.txt'), 'test1\n')
      await writeFile(join(tempDir, 'a2.txt'), 'test2\n')

      const result = await cli(['list', '-e', 'a?.txt'], tempDir)
      expect(result.stdout).not.toContain('a1.txt')
      expect(result.stdout).not.toContain('a2.txt')
    })
  })

  describe('No changes after exclude', () => {
    it('should show message when all files are excluded', async () => {
      // Exclude everything
      const result = await cli(['list', '-e', '*.ts', '-e', '*.md'], tempDir)
      const output = result.stdout + result.stderr
      expect(output).toContain('No changes')
    })
  })
})
