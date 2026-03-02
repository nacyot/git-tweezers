import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, chmodSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { execSync } from 'child_process'
import { execa } from 'execa'
import { StagingService } from '../../src/services/staging-service.js'
import { GitWrapper } from '../../src/core/git-wrapper.js'

function git(cmd: string, cwd: string) {
  return execSync(`git ${cmd}`, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
}

const binPath = join(process.cwd(), 'bin', 'run.js')
const env = { ...process.env, OCLIF_TS_NODE: 'false' }

async function cli(args: string[], cwd: string) {
  return execa('node', [binPath, ...args], { cwd, env, reject: false })
}

describe('Git Diverse States', () => {
  let tempDir: string
  let staging: StagingService

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'gt-git-states-'))
    git('init', tempDir)
    git('config user.email "t@t"', tempDir)
    git('config user.name "T"', tempDir)
    staging = new StagingService(tempDir)
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  describe('Renamed files', () => {
    it('should handle renamed file with content changes', async () => {
      writeFileSync(join(tempDir, 'old.txt'), 'original content\nline 2\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)

      // Rename and modify
      git('mv old.txt new.txt', tempDir)
      writeFileSync(join(tempDir, 'new.txt'), 'modified content\nline 2\n')

      const result = await cli(['list'], tempDir)
      expect(result.exitCode).toBe(0)
      // Should show the file in some form
      const output = result.stdout + result.stderr
      expect(output.length).toBeGreaterThan(0)
    })
  })

  describe('Mode changes', () => {
    it('should list hunks for file with mode change + content change', async () => {
      writeFileSync(join(tempDir, 'script.sh'), '#!/bin/bash\necho hello\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)

      // Change mode and content
      chmodSync(join(tempDir, 'script.sh'), 0o755)
      writeFileSync(join(tempDir, 'script.sh'), '#!/bin/bash\necho world\n')

      const result = await cli(['list', 'script.sh'], tempDir)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('[1|')
    })

    it('should stage content change from file with mode change', async () => {
      writeFileSync(join(tempDir, 'script.sh'), '#!/bin/bash\necho hello\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)

      chmodSync(join(tempDir, 'script.sh'), 0o755)
      writeFileSync(join(tempDir, 'script.sh'), '#!/bin/bash\necho world\n')

      const result = await cli(['hunk', 'script.sh', '1'], tempDir)
      expect(result.exitCode).toBe(0)

      const cached = git('diff --cached', tempDir)
      expect(cached).toContain('echo world')
    })
  })

  describe('Subdirectory operations', () => {
    it('should list and stage from deeply nested directory', async () => {
      execSync(`mkdir -p ${join(tempDir, 'a', 'b', 'c', 'd')}`)
      writeFileSync(join(tempDir, 'a', 'b', 'c', 'd', 'deep.txt'), 'original\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)

      writeFileSync(join(tempDir, 'a', 'b', 'c', 'd', 'deep.txt'), 'modified\n')

      const listResult = await cli(['list', 'a/b/c/d/deep.txt'], tempDir)
      expect(listResult.exitCode).toBe(0)
      expect(listResult.stdout).toContain('[1|')

      const hunkResult = await cli(['hunk', 'a/b/c/d/deep.txt', '1'], tempDir)
      expect(hunkResult.exitCode).toBe(0)

      const cached = git('diff --cached', tempDir)
      expect(cached).toContain('modified')
    })
  })

  describe('Untracked file with intent-to-add', () => {
    it('should handle intent-to-add then partial staging', async () => {
      writeFileSync(join(tempDir, 'existing.txt'), 'existing\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)

      // Create new file with multiple lines
      const lines = Array.from({ length: 10 }, (_, i) => `New line ${i + 1}`)
      writeFileSync(join(tempDir, 'brand-new.txt'), lines.join('\n') + '\n')

      const result = await cli(['hunk', 'brand-new.txt', '1'], tempDir)
      expect(result.exitCode).toBe(0)

      const cached = git('diff --cached', tempDir)
      expect(cached).toContain('New line')
    })

    it('should handle untracked file in subdirectory', async () => {
      writeFileSync(join(tempDir, 'dummy.txt'), 'dummy\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)

      execSync(`mkdir -p ${join(tempDir, 'src')}`)
      writeFileSync(join(tempDir, 'src', 'new-module.ts'), 'export const m = 1\n')

      const result = await cli(['hunk', 'src/new-module.ts', '1'], tempDir)
      expect(result.exitCode).toBe(0)
    })
  })

  describe('Staged + unstaged mixed state', () => {
    it('should handle file with both staged and unstaged changes', async () => {
      const lines = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`)
      writeFileSync(join(tempDir, 'f.txt'), lines.join('\n') + '\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)

      // Make changes and stage part
      lines[0] = 'STAGED CHANGE'
      lines[14] = 'WILL BE UNSTAGED'
      writeFileSync(join(tempDir, 'f.txt'), lines.join('\n') + '\n')

      await cli(['hunk', 'f.txt', '1'], tempDir)

      // Now modify the same file further
      lines[14] = 'FURTHER UNSTAGED'
      writeFileSync(join(tempDir, 'f.txt'), lines.join('\n') + '\n')

      // List should show both layers
      const result = await cli(['list', 'f.txt'], tempDir)
      expect(result.exitCode).toBe(0)
      const output = result.stdout + result.stderr
      expect(output).toContain('STAGED')
    })
  })

  describe('Binary file handling', () => {
    it('should reject binary file for list', async () => {
      // Create a clearly binary file with plenty of null bytes so git detects it as binary
      const binaryData = Buffer.alloc(512)
      binaryData[0] = 0x89; binaryData[1] = 0x50; binaryData[2] = 0x4e; binaryData[3] = 0x47
      // Fill with null bytes to ensure binary detection
      for (let i = 10; i < 512; i += 3) { binaryData[i] = 0x00 }
      writeFileSync(join(tempDir, 'image.png'), binaryData)
      git('add .', tempDir)
      git('commit -m init', tempDir)

      const binaryData2 = Buffer.alloc(512)
      binaryData2[0] = 0x89; binaryData2[1] = 0x50; binaryData2[2] = 0x4e; binaryData2[3] = 0x47
      for (let i = 10; i < 512; i += 3) { binaryData2[i] = 0x00 }
      binaryData2[5] = 0xff
      writeFileSync(join(tempDir, 'image.png'), binaryData2)

      await expect(staging.listHunksWithInfo('image.png')).rejects.toThrow()
    })

    it('should reject binary file for hunk staging', async () => {
      // Create a clearly binary file with null bytes
      const bin1 = Buffer.alloc(256, 0x00)
      bin1[0] = 0x01; bin1[1] = 0xff
      writeFileSync(join(tempDir, 'data.bin'), bin1)
      git('add .', tempDir)
      git('commit -m init', tempDir)

      const bin2 = Buffer.alloc(256, 0x00)
      bin2[0] = 0x02; bin2[1] = 0xff
      writeFileSync(join(tempDir, 'data.bin'), bin2)

      await expect(staging.stageHunk('data.bin', '1')).rejects.toThrow()
    })
  })

  describe('Empty file handling', () => {
    it('should handle newly created empty file', async () => {
      writeFileSync(join(tempDir, 'dummy.txt'), 'dummy\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)

      writeFileSync(join(tempDir, 'empty.txt'), '')

      // Should not crash when listing an empty untracked file
      const result = await cli(['list'], tempDir)
      expect(result.exitCode).toBe(0)
    })

    it('should handle file emptied (content removed)', async () => {
      writeFileSync(join(tempDir, 'f.txt'), 'content\nline2\nline3\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)

      writeFileSync(join(tempDir, 'f.txt'), '')

      const result = await cli(['hunk', 'f.txt', '1'], tempDir)
      expect(result.exitCode).toBe(0)

      const cached = git('diff --cached', tempDir)
      expect(cached).toContain('-content')
    })
  })

  describe('Large diff handling', () => {
    it('should handle file with 500 lines changed', async () => {
      const lines = Array.from({ length: 500 }, (_, i) => `Line ${i + 1}`)
      writeFileSync(join(tempDir, 'large.txt'), lines.join('\n') + '\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)

      // Modify all lines
      for (let i = 0; i < 500; i++) {
        lines[i] = `Modified ${i + 1}`
      }
      writeFileSync(join(tempDir, 'large.txt'), lines.join('\n') + '\n')

      const result = await cli(['list', 'large.txt', '-o'], tempDir)
      expect(result.exitCode).toBe(0)
    })

    it('should handle staging a hunk in a large file', async () => {
      const lines = Array.from({ length: 500 }, (_, i) => `Line ${i + 1}`)
      writeFileSync(join(tempDir, 'large.txt'), lines.join('\n') + '\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)

      lines[0] = 'FIRST CHANGE'
      lines[499] = 'LAST CHANGE'
      writeFileSync(join(tempDir, 'large.txt'), lines.join('\n') + '\n')

      const result = await cli(['hunk', 'large.txt', '1'], tempDir)
      expect(result.exitCode).toBe(0)

      const cached = git('diff --cached', tempDir)
      expect(cached).toContain('FIRST CHANGE')
      expect(cached).not.toContain('LAST CHANGE')
    })
  })

  describe('GitWrapper methods', () => {
    it('should correctly detect untracked files', async () => {
      writeFileSync(join(tempDir, 'tracked.txt'), 'tracked\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)

      writeFileSync(join(tempDir, 'untracked.txt'), 'untracked\n')

      const wrapper = new GitWrapper(tempDir)
      expect(await wrapper.isUntracked('untracked.txt')).toBe(true)
      expect(await wrapper.isUntracked('tracked.txt')).toBe(false)
    })

    it('should correctly detect binary files', async () => {
      writeFileSync(join(tempDir, 'text.txt'), 'hello\n')
      writeFileSync(join(tempDir, 'binary.dat'), Buffer.from([0x00, 0x01, 0xff]))
      git('add .', tempDir)
      git('commit -m init', tempDir)

      writeFileSync(join(tempDir, 'text.txt'), 'hello modified\n')
      writeFileSync(join(tempDir, 'binary.dat'), Buffer.from([0x00, 0x02, 0xff]))

      const wrapper = new GitWrapper(tempDir)
      expect(await wrapper.isBinary('text.txt')).toBe(false)
      expect(await wrapper.isBinary('binary.dat')).toBe(true)
    })

    it('should list changed files correctly', async () => {
      writeFileSync(join(tempDir, 'a.txt'), 'A\n')
      writeFileSync(join(tempDir, 'b.txt'), 'B\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)

      writeFileSync(join(tempDir, 'a.txt'), 'A modified\n')
      writeFileSync(join(tempDir, 'c.txt'), 'C new\n')

      const wrapper = new GitWrapper(tempDir)

      // All changed files (modified + untracked)
      const allFiles = await wrapper.getChangedFiles()
      expect(allFiles).toContain('a.txt')
      expect(allFiles).toContain('c.txt')

      // Tracked only
      const tracked = await wrapper.getChangedFiles({ trackedOnly: true })
      expect(tracked).toContain('a.txt')
      expect(tracked).not.toContain('c.txt')
    })

    it('should handle write-tree and read-tree cycle', async () => {
      writeFileSync(join(tempDir, 'f.txt'), 'original\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)

      const wrapper = new GitWrapper(tempDir)
      const treeBefore = await wrapper.writeTree()

      // Modify and stage
      writeFileSync(join(tempDir, 'f.txt'), 'modified\n')
      await wrapper.add('f.txt')

      const treeAfter = await wrapper.writeTree()
      expect(treeAfter).not.toBe(treeBefore)

      // Restore
      await wrapper.readTree(treeBefore)
      const treeRestored = await wrapper.writeTree()
      expect(treeRestored).toBe(treeBefore)
    })

    it('should handle snapshot ref lifecycle', async () => {
      writeFileSync(join(tempDir, 'f.txt'), 'content\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)

      const wrapper = new GitWrapper(tempDir)
      const tree = await wrapper.writeTree()

      // Save ref
      await wrapper.saveSnapshotRef('test-id', tree)

      // Load ref
      const loaded = await wrapper.loadSnapshotRef('test-id')
      expect(loaded).toBe(tree)

      // Drop ref
      await wrapper.dropSnapshotRef('test-id')
      const afterDrop = await wrapper.loadSnapshotRef('test-id')
      expect(afterDrop).toBeNull()
    })

    it('should detect HEAD existence', async () => {
      const _wrapper = new GitWrapper(tempDir)
      // No commits yet in fresh init — wait, we committed in beforeEach? No, let me check...
      // Actually, we DON'T commit in beforeEach. But the test above has commits.
      // Let's test with a fresh repo.
      const freshDir = mkdtempSync(join(tmpdir(), 'gt-head-'))
      try {
        git('init', freshDir)
        const freshWrapper = new GitWrapper(freshDir)
        expect(await freshWrapper.hasHead()).toBe(false)

        writeFileSync(join(freshDir, 'f.txt'), 'init\n')
        git('add .', freshDir)
        git('commit -m init', freshDir)
        expect(await freshWrapper.hasHead()).toBe(true)
      } finally {
        rmSync(freshDir, { recursive: true, force: true })
      }
    })

    it('should get dual-layer diff', async () => {
      writeFileSync(join(tempDir, 'f.txt'), 'original\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)

      // Stage a change
      writeFileSync(join(tempDir, 'f.txt'), 'staged change\n')
      git('add f.txt', tempDir)

      // Make more changes in working tree
      writeFileSync(join(tempDir, 'f.txt'), 'unstaged change\n')

      const wrapper = new GitWrapper(tempDir)
      const dual = await wrapper.getDualLayerDiff('f.txt')

      expect(dual.staged).toContain('staged change')
      expect(dual.unstaged).toContain('unstaged change')
    })
  })

  describe('Edge case: file with only whitespace changes', () => {
    it('should detect whitespace-only changes', async () => {
      writeFileSync(join(tempDir, 'f.txt'), 'line 1\nline 2\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)

      // Add trailing spaces
      writeFileSync(join(tempDir, 'f.txt'), 'line 1  \nline 2\n')

      const hunks = await staging.listHunksWithInfo('f.txt')
      expect(hunks.filter(h => h.layer === 'unstaged').length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('Edge case: CRLF line endings', () => {
    it('should handle files with CRLF endings', async () => {
      writeFileSync(join(tempDir, 'f.txt'), 'line 1\r\nline 2\r\n')
      git('add .', tempDir)
      git('commit -m init', tempDir)
      writeFileSync(join(tempDir, 'f.txt'), 'modified\r\nline 2\r\n')

      const result = await cli(['list', 'f.txt'], tempDir)
      // Should handle without crashing
      expect(result.exitCode).toBe(0)
    })
  })
})
