import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { execSync } from 'child_process'
import { StagingService } from '../src/services/staging-service.js'
import { GitWrapper } from '../src/core/git-wrapper.js'
import { HunkCacheService } from '../src/services/hunk-cache-service.js'

/**
 * Undo Invariant Tests
 *
 * Verifies that: stage → undo → write-tree === original tree SHA.
 * This ensures the tree-snapshot undo restores the index exactly.
 */
describe('Undo Invariant Tests', () => {
  let tempDir: string
  let git: GitWrapper
  let staging: StagingService

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'tweezers-invariant-'))
    execSync('git init', { cwd: tempDir, stdio: 'ignore' })
    execSync('git config user.email "test@test.com"', { cwd: tempDir, stdio: 'ignore' })
    execSync('git config user.name "Test"', { cwd: tempDir, stdio: 'ignore' })

    // Create initial file and commit
    writeFileSync(join(tempDir, 'test.txt'), 'line1\nline2\nline3\n')
    execSync('git add . && git commit -m "init"', { cwd: tempDir, stdio: 'ignore' })

    git = new GitWrapper(tempDir)
    staging = new StagingService(tempDir)
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('stage hunk → undo → tree SHA matches original', async () => {
    // Modify file
    writeFileSync(join(tempDir, 'test.txt'), 'line1\nmodified\nline3\n')

    // Capture original tree SHA
    const originalTree = execSync('git write-tree --missing-ok', { cwd: tempDir, encoding: 'utf8' }).trim()

    // Stage a hunk
    await staging.stageHunk('test.txt', 1)

    // Verify staging changed the tree
    const stagedTree = execSync('git write-tree --missing-ok', { cwd: tempDir, encoding: 'utf8' }).trim()
    expect(stagedTree).not.toBe(originalTree)

    // Undo
    const cache = new HunkCacheService(tempDir)
    const entry = cache.getHistoryEntry(0)
    expect(entry).toBeDefined()
    expect(entry!.type).toBe('tree')

    if (entry!.type === 'tree') {
      await git.readTree((entry as any).tree)
    }

    // Verify tree SHA matches original
    const restoredTree = execSync('git write-tree --missing-ok', { cwd: tempDir, encoding: 'utf8' }).trim()
    expect(restoredTree).toBe(originalTree)
  })

  it('stage lines → undo → tree SHA matches original', async () => {
    // Modify file
    writeFileSync(join(tempDir, 'test.txt'), 'line1\nmodified\nline3\n')

    // Capture original tree SHA
    const originalTree = execSync('git write-tree --missing-ok', { cwd: tempDir, encoding: 'utf8' }).trim()

    // Stage lines
    await staging.stageLines('test.txt', 2, 2)

    // Verify staging changed the tree
    const stagedTree = execSync('git write-tree --missing-ok', { cwd: tempDir, encoding: 'utf8' }).trim()
    expect(stagedTree).not.toBe(originalTree)

    // Undo
    const cache = new HunkCacheService(tempDir)
    const entry = cache.getHistoryEntry(0)
    expect(entry).toBeDefined()

    if (entry!.type === 'tree') {
      await git.readTree((entry as any).tree)
    }

    // Verify tree SHA matches original
    const restoredTree = execSync('git write-tree --missing-ok', { cwd: tempDir, encoding: 'utf8' }).trim()
    expect(restoredTree).toBe(originalTree)
  })

  it('stage multiple hunks → undo → tree SHA matches original', async () => {
    // Create file with multiple changes
    writeFileSync(join(tempDir, 'test.txt'), 'modified1\nline2\nmodified3\n')

    // Capture original tree SHA
    const originalTree = execSync('git write-tree --missing-ok', { cwd: tempDir, encoding: 'utf8' }).trim()

    // Stage all hunks using precise mode (produces more hunks)
    const hunks = await staging.listHunksWithInfo('test.txt', { precise: true })
    const selectors = hunks.filter(h => h.layer !== 'staged').map(h => h.id)

    if (selectors.length > 0) {
      await staging.stageHunks('test.txt', selectors, { precise: true })
    }

    // Undo
    const cache = new HunkCacheService(tempDir)
    const entry = cache.getHistoryEntry(0)
    expect(entry).toBeDefined()

    if (entry!.type === 'tree') {
      await git.readTree((entry as any).tree)
    }

    // Verify tree SHA matches original
    const restoredTree = execSync('git write-tree --missing-ok', { cwd: tempDir, encoding: 'utf8' }).trim()
    expect(restoredTree).toBe(originalTree)
  })

  it('multiple stage → multiple undo → tree SHA matches original', async () => {
    // Multiple files with changes
    writeFileSync(join(tempDir, 'test.txt'), 'modified\nline2\nline3\n')
    writeFileSync(join(tempDir, 'other.txt'), 'new file content\n')
    execSync('git add -N other.txt', { cwd: tempDir, stdio: 'ignore' })

    // Capture original tree SHA
    const originalTree = execSync('git write-tree --missing-ok', { cwd: tempDir, encoding: 'utf8' }).trim()

    // Stage first file
    await staging.stageHunk('test.txt', 1)

    // Stage second file
    await staging.stageHunk('other.txt', 1)

    // Verify both staged
    const stagedTree = execSync('git write-tree --missing-ok', { cwd: tempDir, encoding: 'utf8' }).trim()
    expect(stagedTree).not.toBe(originalTree)

    // Undo both (most recent first)
    const cache = new HunkCacheService(tempDir)

    const entry2 = cache.getHistoryEntry(0)
    expect(entry2).toBeDefined()
    if (entry2!.type === 'tree') {
      await git.readTree((entry2 as any).tree)
      cache.removeHistoryEntry(0)
    }

    // After first undo, tree should match state before second staging
    // But we want to undo all the way back

    const entry1 = cache.getHistoryEntry(0)
    expect(entry1).toBeDefined()
    if (entry1!.type === 'tree') {
      await git.readTree((entry1 as any).tree)
      cache.removeHistoryEntry(0)
    }

    // Verify tree SHA matches original
    const restoredTree = execSync('git write-tree --missing-ok', { cwd: tempDir, encoding: 'utf8' }).trim()
    expect(restoredTree).toBe(originalTree)
  })

  it('stage untracked file → undo → tree SHA matches original', async () => {
    // Create a new untracked file
    writeFileSync(join(tempDir, 'newfile.txt'), 'brand new\n')

    // Capture original tree SHA
    const originalTree = execSync('git write-tree --missing-ok', { cwd: tempDir, encoding: 'utf8' }).trim()

    // Stage the untracked file (stageHunk handles ITA internally)
    await staging.stageHunk('newfile.txt', 1)

    // Verify staging changed the tree
    const stagedTree = execSync('git write-tree --missing-ok', { cwd: tempDir, encoding: 'utf8' }).trim()
    expect(stagedTree).not.toBe(originalTree)

    // Undo
    const cache = new HunkCacheService(tempDir)
    const entry = cache.getHistoryEntry(0)
    expect(entry).toBeDefined()

    if (entry!.type === 'tree') {
      await git.readTree((entry as any).tree)
    }

    // Verify tree SHA matches original
    const restoredTree = execSync('git write-tree --missing-ok', { cwd: tempDir, encoding: 'utf8' }).trim()
    expect(restoredTree).toBe(originalTree)
  })
})
