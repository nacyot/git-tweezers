import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execa } from 'execa'
import { join } from 'path'
import { rm, mkdir, writeFile, readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { tmpdir } from 'os'
import { GitWrapper } from '../src/core/git-wrapper.js'
import { HunkCacheService } from '../src/services/hunk-cache-service.js'

describe('Worktree Support', () => {
  let mainRepoDir: string
  let worktreeDir: string

  beforeEach(async () => {
    // Create main repository
    mainRepoDir = join(tmpdir(), `git-tweezers-main-${Date.now()}`)
    worktreeDir = join(tmpdir(), `git-tweezers-worktree-${Date.now()}`)
    
    await mkdir(mainRepoDir, { recursive: true })
    
    // Initialize main repo
    await execa('git', ['init'], { cwd: mainRepoDir })
    await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: mainRepoDir })
    await execa('git', ['config', 'user.name', 'Test User'], { cwd: mainRepoDir })
    
    // Create initial commit
    const testFile = join(mainRepoDir, 'test.js')
    await writeFile(testFile, 'console.log("hello")\n')
    await execa('git', ['add', '.'], { cwd: mainRepoDir })
    await execa('git', ['commit', '-m', 'Initial commit'], { cwd: mainRepoDir })
    
    // Create worktree
    await execa('git', ['worktree', 'add', worktreeDir, '-b', 'test-branch'], { cwd: mainRepoDir })
  })

  afterEach(async () => {
    // Clean up worktree first
    if (existsSync(worktreeDir)) {
      await execa('git', ['worktree', 'remove', worktreeDir, '--force'], { cwd: mainRepoDir }).catch(() => {})
      await rm(worktreeDir, { recursive: true, force: true }).catch(() => {})
    }
    
    if (existsSync(mainRepoDir)) {
      await rm(mainRepoDir, { recursive: true, force: true })
    }
  })

  describe('GitWrapper', () => {
    it('should correctly identify git directory in worktree', () => {
      const git = new GitWrapper(worktreeDir)
      const gitDir = git.getGitDir()
      
      // Should return the actual git directory, not .git file
      expect(gitDir).toContain('.git/worktrees')
      expect(gitDir).not.toBe(join(worktreeDir, '.git'))
    })

    it('should correctly identify git directory in regular repo', () => {
      const git = new GitWrapper(mainRepoDir)
      const gitDir = git.getGitDir()
      
      // Should return .git directory
      expect(gitDir).toBe(join(mainRepoDir, '.git'))
    })
  })

  describe('HunkCacheService', () => {
    it('should create cache file in correct location for worktree', async () => {
      const cache = new HunkCacheService(worktreeDir)
      
      // Add some data to trigger cache save
      cache.addHistory({
        patch: 'test patch',
        files: ['test.js'],
        selectors: ['1'],
        description: 'Test entry',
      })
      
      // Check that cache file was created in the git directory
      const gitDir = new GitWrapper(worktreeDir).getGitDir()
      const cacheFile = join(gitDir, 'tweezers-cache.json')
      
      expect(existsSync(cacheFile)).toBe(true)
      
      // Verify cache content
      const content = JSON.parse(await readFile(cacheFile, 'utf-8'))
      expect(content.history).toHaveLength(1)
      expect(content.history[0].description).toBe('Test entry')
    })
  })

  describe('CLI Commands in Worktree', () => {
    it('should list changes in worktree', async () => {
      // Make a change in worktree
      const testFile = join(worktreeDir, 'test.js')
      await writeFile(testFile, 'console.log("hello")\nconsole.log("world")\n')
      
      // Verify the file exists and has changes
      const diffResult = await execa('git', ['diff', 'test.js'], { cwd: worktreeDir })
      expect(diffResult.stdout).toBeTruthy()
      
      // Run list command directly
      const binPath = join(process.cwd(), 'bin', 'run.js')
      const result = await execa('node', [binPath, 'list', 'test.js'], { cwd: worktreeDir })
      
      expect(result.stdout).toContain('test.js:')
      expect(result.stdout).toContain('[1|')
    })

    it('should stage hunks in worktree', async () => {
      // Make a change in worktree
      const testFile = join(worktreeDir, 'test.js')
      await writeFile(testFile, 'console.log("hello")\nconsole.log("world")')
      
      // Stage the hunk directly
      const binPath = join(process.cwd(), 'bin', 'run.js')
      const result = await execa('node', [binPath, 'hunk', 'test.js:1'], { cwd: worktreeDir })
      
      expect(result.exitCode).toBe(0)
      expect(result.stderr).toContain('Staged hunk')
      
      // Verify it was staged
      const status = await execa('git', ['diff', '--cached'], { cwd: worktreeDir })
      expect(status.stdout).toContain('console.log("world")')
    })

    it('should support undo in worktree', async () => {
      // Make a change and stage it
      const testFile = join(worktreeDir, 'test.js')
      await writeFile(testFile, 'console.log("hello")\nconsole.log("world")')
      const binPath = join(process.cwd(), 'bin', 'run.js')
      await execa('node', [binPath, 'hunk', 'test.js:1'], { cwd: worktreeDir })
      
      // Undo the staging directly
      const undoResult = await execa('node', [binPath, 'undo'], { cwd: worktreeDir })
      expect(undoResult.exitCode).toBe(0)
      
      // Verify it was undone
      const status = await execa('git', ['diff', '--cached'], { cwd: worktreeDir })
      expect(status.stdout).toBe('')
    })
  })
})