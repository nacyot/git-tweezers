import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdir, rm, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { execa } from 'execa'
import { StagingService } from '../src/services/staging-service.js'
import { GitWrapper } from '../src/core/git-wrapper.js'
import { tmpdir } from 'os'

describe('Untracked Directory Support', () => {
  let tempDir: string
  let stagingService: StagingService
  let git: GitWrapper
  const binPath = join(process.cwd(), 'bin', 'run.js')

  beforeEach(async () => {
    // Create a temporary directory for testing
    tempDir = join(tmpdir(), `git-tweezers-untracked-test-${Date.now()}`)
    await mkdir(tempDir, { recursive: true })
    
    // Initialize git repository
    await execa('git', ['init'], { cwd: tempDir })
    await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: tempDir })
    await execa('git', ['config', 'user.name', 'Test User'], { cwd: tempDir })
    
    // Create services
    stagingService = new StagingService(tempDir)
    git = new GitWrapper(tempDir)
  })

  afterEach(async () => {
    // Clean up
    if (existsSync(tempDir)) {
      await rm(tempDir, { recursive: true })
    }
  })

  describe('Listing untracked files', () => {
    it('should list all untracked files in directories', async () => {
      // Create untracked directory structure
      await mkdir(join(tempDir, 'src', 'components'), { recursive: true })
      await mkdir(join(tempDir, 'src', 'utils'), { recursive: true })
      
      await writeFile(join(tempDir, 'src', 'index.js'), 'console.log("main")')
      await writeFile(join(tempDir, 'src', 'components', 'Button.js'), 'export const Button = () => {}')
      await writeFile(join(tempDir, 'src', 'utils', 'helper.js'), 'export const helper = () => {}')
      
      // Get all changed files (including untracked)
      const files = await git.getChangedFiles()
      
      expect(files).toHaveLength(3)
      expect(files).toContain('src/index.js')
      expect(files).toContain('src/components/Button.js')
      expect(files).toContain('src/utils/helper.js')
    })

    it('should list untracked files via CLI list command', async () => {
      // Create untracked files
      await mkdir(join(tempDir, 'features'), { recursive: true })
      await writeFile(join(tempDir, 'features', 'feature1.ts'), 'export const feature1 = true')
      await writeFile(join(tempDir, 'features', 'feature2.ts'), 'export const feature2 = true')
      
      // Run list command
      const result = await execa('node', [binPath, 'list'], { cwd: tempDir })
      
      expect(result.stdout).toContain('features/feature1.ts')
      expect(result.stdout).toContain('features/feature2.ts')
      expect(result.stdout).toContain('@@ -0,0 +1,1 @@') // New file diff header
    })
  })

  describe('Staging from untracked directories', () => {
    it('should stage hunks from untracked files in subdirectories', async () => {
      // Create untracked file in subdirectory
      await mkdir(join(tempDir, 'deep', 'nested', 'path'), { recursive: true })
      await writeFile(
        join(tempDir, 'deep', 'nested', 'path', 'file.txt'),
        'Line 1\nLine 2\nLine 3\nLine 4\nLine 5\n'
      )
      
      // List hunks for the untracked file
      const hunks = await stagingService.listHunks('deep/nested/path/file.txt')
      expect(hunks.length).toBeGreaterThan(0)
      
      // Stage the hunk
      await stagingService.stageHunk('deep/nested/path/file.txt', 1)
      
      // Verify file is staged
      const status = await execa('git', ['status', '--porcelain'], { cwd: tempDir })
      expect(status.stdout).toContain('A  deep/nested/path/file.txt')
    })

    it('should support partial staging of untracked files in directories', async () => {
      // Create untracked file with multiple lines
      await mkdir(join(tempDir, 'module'), { recursive: true })
      await writeFile(
        join(tempDir, 'module', 'config.js'),
        'const config = {\n  option1: true,\n  option2: false,\n  option3: null,\n  option4: 42\n}'
      )
      
      // Stage only lines 1-3
      await stagingService.stageLines('module/config.js', 1, 3)
      
      // Check status
      const status = await execa('git', ['status', '--porcelain'], { cwd: tempDir })
      expect(status.stdout).toContain('AM module/config.js') // Added + Modified
      
      // Check staged content
      const stagedDiff = await execa('git', ['diff', '--cached'], { cwd: tempDir })
      expect(stagedDiff.stdout).toContain('option1: true')
      expect(stagedDiff.stdout).toContain('option2: false')
      expect(stagedDiff.stdout).not.toContain('option3: null')
      expect(stagedDiff.stdout).not.toContain('option4: 42')
      
      // Check unstaged content
      const unstagedDiff = await execa('git', ['diff'], { cwd: tempDir })
      expect(unstagedDiff.stdout).toContain('option3: null')
      expect(unstagedDiff.stdout).toContain('option4: 42')
    })

    it('should handle multiple untracked files in same directory', async () => {
      // Create multiple untracked files
      await mkdir(join(tempDir, 'lib'), { recursive: true })
      await writeFile(join(tempDir, 'lib', 'a.js'), 'export const a = "a"')
      await writeFile(join(tempDir, 'lib', 'b.js'), 'export const b = "b"')
      await writeFile(join(tempDir, 'lib', 'c.js'), 'export const c = "c"')
      
      // Stage only one file
      await stagingService.stageHunk('lib/b.js', 1)
      
      // Check status
      const status = await execa('git', ['status', '--porcelain'], { cwd: tempDir })
      const statusLines = status.stdout.split('\n').filter(line => line.trim())
      
      // b.js should be staged
      expect(statusLines).toContain('A  lib/b.js')
      // a.js and c.js should remain untracked
      expect(statusLines).toContain('?? lib/a.js')
      expect(statusLines).toContain('?? lib/c.js')
    })
  })

  describe('Mixed tracked and untracked files', () => {
    it('should handle directories with both tracked and untracked files', async () => {
      // Create and commit a tracked file
      await mkdir(join(tempDir, 'mixed'), { recursive: true })
      await writeFile(join(tempDir, 'mixed', 'tracked.js'), 'original content')
      await execa('git', ['add', '.'], { cwd: tempDir })
      await execa('git', ['commit', '-m', 'Initial commit'], { cwd: tempDir })
      
      // Modify tracked file
      await writeFile(join(tempDir, 'mixed', 'tracked.js'), 'modified content')
      
      // Add untracked files to same directory
      await writeFile(join(tempDir, 'mixed', 'untracked1.js'), 'new file 1')
      await writeFile(join(tempDir, 'mixed', 'untracked2.js'), 'new file 2')
      
      // Get all changed files
      const files = await git.getChangedFiles()
      
      expect(files).toContain('mixed/tracked.js')
      expect(files).toContain('mixed/untracked1.js')
      expect(files).toContain('mixed/untracked2.js')
      
      // List should show all files
      const result = await execa('node', [binPath, 'list'], { cwd: tempDir })
      
      expect(result.stdout).toContain('mixed/tracked.js')
      expect(result.stdout).toContain('mixed/untracked1.js')
      expect(result.stdout).toContain('mixed/untracked2.js')
    })
  })

  describe('Edge cases', () => {
    it('should handle empty untracked directories gracefully', async () => {
      // Create empty directory
      await mkdir(join(tempDir, 'empty-dir'), { recursive: true })
      
      // Git doesn't track empty directories, so this should not appear
      const files = await git.getChangedFiles()
      expect(files).not.toContain('empty-dir')
    })

    it('should handle deeply nested untracked files', async () => {
      // Create very deep directory structure
      const deepPath = join('very', 'deep', 'nested', 'folder', 'structure')
      await mkdir(join(tempDir, deepPath), { recursive: true })
      await writeFile(join(tempDir, deepPath, 'deep-file.md'), '# Deep file')
      
      // Should be able to list and stage
      const files = await git.getChangedFiles()
      expect(files).toContain(join(deepPath, 'deep-file.md'))
      
      const hunks = await stagingService.listHunks(join(deepPath, 'deep-file.md'))
      expect(hunks.length).toBe(1)
    })
  })
})