import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execa } from 'execa'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StagingService } from '../src/services/staging-service.js'

describe('Integration Tests', () => {
  let tempDir: string
  let stagingService: StagingService

  beforeEach(async () => {
    // Create temporary directory for test repo
    tempDir = await mkdtemp(join(tmpdir(), 'git-tweezers-test-'))
    
    // Create staging service instance for the temp directory
    stagingService = new StagingService(tempDir)
    
    // Initialize git repo
    await execa('git', ['init'], { cwd: tempDir })
    await execa('git', ['config', 'user.name', 'Test User'], { cwd: tempDir })
    await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: tempDir })
  })

  afterEach(async () => {
    // Clean up temporary directory
    await rm(tempDir, { recursive: true, force: true })
  })

  describe('Basic workflow', () => {
    it('should stage individual hunks', async () => {
      // Create a file with multiple changes far apart to ensure separate hunks
      const filePath = join(tempDir, 'test.txt')
      const initialContent = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`).join('\n') + '\n'
      await writeFile(filePath, initialContent)
      await execa('git', ['add', '.'], { cwd: tempDir })
      await execa('git', ['commit', '-m', 'Initial commit'], { cwd: tempDir })
      
      // Modify lines far apart to create separate hunks
      const lines = initialContent.split('\n').slice(0, -1) // Remove empty last element
      lines[0] = 'Line 1 modified'
      lines[15] = 'Line 16 modified'
      await writeFile(filePath, lines.join('\n') + '\n')
      
      // List hunks
      const hunks = await stagingService.listHunks('test.txt')
      expect(hunks.length).toBe(2)
      
      // Stage first hunk
      await stagingService.stageHunk('test.txt', 1)
      
      // Check staged changes
      const stagedDiff = await execa('git', ['diff', '--cached'], { cwd: tempDir })
      expect(stagedDiff.stdout).toContain('Line 1 modified')
      expect(stagedDiff.stdout).not.toContain('Line 16 modified')
    })

    it('should stage specific lines', async () => {
      const filePath = join(tempDir, 'test.txt')
      await writeFile(filePath, 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5\n')
      await execa('git', ['add', '.'], { cwd: tempDir })
      await execa('git', ['commit', '-m', 'Initial commit'], { cwd: tempDir })
      
      // Add multiple lines
      await writeFile(filePath, 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6 added\nLine 7 added\nLine 8 added\n')
      
      // Stage only lines 6-7
      await stagingService.stageLines('test.txt', 6, 7)
      
      const stagedDiff = await execa('git', ['diff', '--cached'], { cwd: tempDir })
      expect(stagedDiff.stdout).toContain('Line 6 added')
      expect(stagedDiff.stdout).toContain('Line 7 added')
      expect(stagedDiff.stdout).not.toContain('Line 8 added')
    })

    it('should handle multi-range line staging', async () => {
      const filePath = join(tempDir, 'test.txt')
      await writeFile(filePath, 'Line 1\nLine 2\nLine 3\n')
      await execa('git', ['add', '.'], { cwd: tempDir })
      await execa('git', ['commit', '-m', 'Initial commit'], { cwd: tempDir })
      
      // Modify multiple lines
      await writeFile(filePath, 'Line 1 modified\nLine 2 modified\nLine 3 modified\n')
      
      // Stage lines 1 and 3 (non-contiguous)
      // Need to stage them separately
      await stagingService.stageLines('test.txt', 1, 1)
      await stagingService.stageLines('test.txt', 3, 3)
      
      const stagedDiff = await execa('git', ['diff', '--cached'], { cwd: tempDir })
      expect(stagedDiff.stdout).toContain('Line 1 modified')
      expect(stagedDiff.stdout).toContain('Line 3 modified')
      
      const unstagedDiff = await execa('git', ['diff'], { cwd: tempDir })
      expect(unstagedDiff.stdout).toContain('Line 2 modified')
    })
  })

  describe('EOF newline handling', () => {
    it('should handle files without newline at EOF', async () => {
      const filePath = join(tempDir, 'no-newline.txt')
      await writeFile(filePath, 'Line 1\nLine 2\nLine 3', 'utf-8')
      await execa('git', ['add', '.'], { cwd: tempDir })
      await execa('git', ['commit', '-m', 'Initial commit'], { cwd: tempDir })
      
      // Add lines after no-newline
      await writeFile(filePath, 'Line 1\nLine 2\nLine 3\nLine 4 added\nLine 5 added', 'utf-8')
      
      // Stage the new lines
      await stagingService.stageLines('no-newline.txt', 4, 5)
      
      // Check staged diff
      const stagedDiff = await execa('git', ['diff', '--cached'], { cwd: tempDir })
      expect(stagedDiff.stdout).toContain('Line 4 added')
      expect(stagedDiff.stdout).toContain('Line 5 added')
      expect(stagedDiff.stdout).toContain('\\ No newline at end of file')
    })

    it('should preserve EOF newline when staging partial changes', async () => {
      const filePath = join(tempDir, 'with-newline.txt')
      await writeFile(filePath, 'Line 1\nLine 2\nLine 3\n')
      await execa('git', ['add', '.'], { cwd: tempDir })
      await execa('git', ['commit', '-m', 'Initial commit'], { cwd: tempDir })
      
      // Modify and add lines
      await writeFile(filePath, 'Line 1 modified\nLine 2\nLine 3\nLine 4 added\n')
      
      // Stage only the modification
      await stagingService.stageLines('with-newline.txt', 1, 1)
      
      const stagedDiff = await execa('git', ['diff', '--cached'], { cwd: tempDir })
      expect(stagedDiff.stdout).toContain('Line 1 modified')
      expect(stagedDiff.stdout).not.toContain('Line 4 added')
    })
  })

  describe('Untracked files', () => {
    it('should handle untracked files', async () => {
      const filePath = join(tempDir, 'new-file.txt')
      await writeFile(filePath, 'New line 1\nNew line 2\nNew line 3\n')
      
      // List hunks for untracked file
      const hunks = await stagingService.listHunks('new-file.txt')
      expect(hunks.length).toBeGreaterThan(0)
      
      // Stage specific lines from untracked file
      await stagingService.stageLines('new-file.txt', 1, 2)
      
      // Check that file is now tracked with partial content
      const status = await execa('git', ['status', '--porcelain'], { cwd: tempDir })
      // When a file is added with partial content, git shows it as 'AM'
      expect(status.stdout).toContain('AM new-file.txt')
      
      const stagedDiff = await execa('git', ['diff', '--cached'], { cwd: tempDir })
      expect(stagedDiff.stdout).toContain('New line 1')
      expect(stagedDiff.stdout).toContain('New line 2')
      expect(stagedDiff.stdout).not.toContain('New line 3')
    })
  })

  describe('Binary files', () => {
    it('should reject binary files', async () => {
      const filePath = join(tempDir, 'binary.dat')
      // Create a binary file
      await writeFile(filePath, Buffer.from([0x00, 0x01, 0x02, 0xFF, 0xFE, 0xFD]))
      await execa('git', ['add', '.'], { cwd: tempDir })
      await execa('git', ['commit', '-m', 'Add binary'], { cwd: tempDir })
      
      // Modify binary file
      await writeFile(filePath, Buffer.from([0x00, 0x01, 0x02, 0xFF, 0xFE, 0xFD, 0xAA, 0xBB]))
      
      // Try to list hunks
      await expect(
        stagingService.listHunks('binary.dat')
      ).rejects.toThrow('Cannot list hunks for binary file')
    })
  })

  describe('Edge cases', () => {
    it('should handle empty files', async () => {
      const filePath = join(tempDir, 'empty.txt')
      await writeFile(filePath, '')
      await execa('git', ['add', '.'], { cwd: tempDir })
      await execa('git', ['commit', '-m', 'Add empty file'], { cwd: tempDir })
      
      // Add content to empty file
      await writeFile(filePath, 'Line 1\n')
      
      await stagingService.stageLines('empty.txt', 1, 1)
      
      const stagedDiff = await execa('git', ['diff', '--cached'], { cwd: tempDir })
      expect(stagedDiff.stdout).toContain('Line 1')
    })

    it('should handle file deletion and recreation', async () => {
      const filePath = join(tempDir, 'recreated.txt')
      await writeFile(filePath, 'Original content\n')
      await execa('git', ['add', '.'], { cwd: tempDir })
      await execa('git', ['commit', '-m', 'Add file'], { cwd: tempDir })
      
      // Delete and recreate with new content
      await rm(filePath)
      await writeFile(filePath, 'New content line 1\nNew content line 2\n')
      
      // Stage only first line of new content
      await stagingService.stageLines('recreated.txt', 1, 1)
      
      const stagedDiff = await execa('git', ['diff', '--cached'], { cwd: tempDir })
      expect(stagedDiff.stdout).toContain('New content line 1')
      expect(stagedDiff.stdout).not.toContain('New content line 2')
    })
  })
})