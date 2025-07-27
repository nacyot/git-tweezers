import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execa } from 'execa'
import {
  isGitRepository,
  getClaudeCommandsDir,
  fileExists,
  ensureDir,
  copyFile,
} from '../../src/utils/fs.js'

describe('File System Utilities', () => {
  let tempDir: string
  let originalHome: string | undefined
  let originalCwd: string

  beforeEach(async () => {
    originalHome = process.env.HOME
    originalCwd = process.cwd()
    tempDir = await mkdtemp(join(tmpdir(), 'git-tweezers-fs-test-'))
    process.env.HOME = tempDir
    process.chdir(tempDir)
  })

  afterEach(async () => {
    process.env.HOME = originalHome
    process.chdir(originalCwd)
    await rm(tempDir, { recursive: true, force: true })
  })

  describe('isGitRepository', () => {
    it('should return true for git repository', async () => {
      await execa('git', ['init'])
      const result = await isGitRepository()
      expect(result).toBe(true)
    })

    it('should return false for non-git directory', async () => {
      const result = await isGitRepository()
      expect(result).toBe(false)
    })

    it('should check specific directory', async () => {
      const gitDir = join(tempDir, 'git-repo')
      await mkdir(gitDir)
      await execa('git', ['init'], { cwd: gitDir })
      
      const result = await isGitRepository(gitDir)
      expect(result).toBe(true)
    })
  })

  describe('getClaudeCommandsDir', () => {
    it('should return local .claude/commands path', () => {
      const result = getClaudeCommandsDir(false)
      expect(result).toBe(join(process.cwd(), '.claude', 'commands'))
    })

    it('should return global ~/.claude/commands path', () => {
      const result = getClaudeCommandsDir(true)
      // On Windows, os.homedir() ignores HOME env var and returns actual home
      // So we just check that it contains the expected path structure
      expect(result).toMatch(/\.claude[/\\]commands$/)
      expect(result.endsWith(join('.claude', 'commands'))).toBe(true)
    })

    it('should use homedir() for global path', () => {
      // The homedir() function returns the OS home directory regardless of HOME env var
      const result = getClaudeCommandsDir(true)
      expect(result).toContain('.claude')
      expect(result).toContain('commands')
      expect(result).toMatch(/\.claude[/\\]commands$/)
    })
  })

  describe('fileExists', () => {
    it('should return true for existing file', async () => {
      const filePath = join(tempDir, 'test.txt')
      await writeFile(filePath, 'test content')
      const result = await fileExists(filePath)
      expect(result).toBe(true)
    })

    it('should return true for existing directory', async () => {
      const dirPath = join(tempDir, 'test-dir')
      await mkdir(dirPath)
      const result = await fileExists(dirPath)
      expect(result).toBe(true)
    })

    it('should return false for non-existing path', async () => {
      const result = await fileExists(join(tempDir, 'non-existent'))
      expect(result).toBe(false)
    })
  })

  describe('ensureDir', () => {
    it('should create directory if it does not exist', async () => {
      const dirPath = join(tempDir, 'new', 'nested', 'dir')
      await ensureDir(dirPath)
      const exists = await fileExists(dirPath)
      expect(exists).toBe(true)
    })

    it('should not throw if directory already exists', async () => {
      const dirPath = join(tempDir, 'existing-dir')
      await mkdir(dirPath)
      await expect(ensureDir(dirPath)).resolves.not.toThrow()
    })
  })

  describe('copyFile', () => {
    it('should copy file successfully', async () => {
      const srcPath = join(tempDir, 'source.txt')
      const destPath = join(tempDir, 'dest.txt')
      const content = 'test content'
      
      await writeFile(srcPath, content)
      await copyFile(srcPath, destPath)
      
      const copiedContent = await readFile(destPath, 'utf-8')
      expect(copiedContent).toBe(content)
    })

    it('should overwrite existing file', async () => {
      const srcPath = join(tempDir, 'source.txt')
      const destPath = join(tempDir, 'dest.txt')
      
      await writeFile(srcPath, 'new content')
      await writeFile(destPath, 'old content')
      
      await copyFile(srcPath, destPath)
      
      const copiedContent = await readFile(destPath, 'utf-8')
      expect(copiedContent).toBe('new content')
    })

    it('should throw error for non-existing source', async () => {
      const srcPath = join(tempDir, 'non-existent.txt')
      const destPath = join(tempDir, 'dest.txt')
      
      await expect(copyFile(srcPath, destPath)).rejects.toThrow()
    })
  })
})