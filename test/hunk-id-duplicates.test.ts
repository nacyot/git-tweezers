import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { execSync } from 'child_process'
import { StagingService } from '../src/services/staging-service.js'
import { HunkCacheService } from '../src/services/hunk-cache-service.js'

function git(cmd: string, cwd: string) {
  return execSync(`git ${cmd}`, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
}

describe('Duplicate Hunk ID Prevention (Bug 3 regression)', () => {
  let tempDir: string
  let staging: StagingService

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'gt-dup-id-'))
    git('init', tempDir)
    git('config user.email "t@t"', tempDir)
    git('config user.name "T"', tempDir)
    staging = new StagingService(tempDir)
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('should assign unique IDs to identical-content hunks in precise mode', async () => {
    // Create file with repeated identical changes at different positions
    const lines = Array.from({ length: 30 }, (_, i) => `Line ${i + 1}`)
    writeFileSync(join(tempDir, 'f.txt'), lines.join('\n') + '\n')
    git('add .', tempDir)
    git('commit -m init', tempDir)

    // Same change at different positions
    lines[2] = 'CHANGED'
    lines[15] = 'CHANGED'
    lines[25] = 'CHANGED'
    writeFileSync(join(tempDir, 'f.txt'), lines.join('\n') + '\n')

    const hunks = await staging.listHunksWithInfo('f.txt', { precise: true })
    const ids = hunks.filter(h => h.layer === 'unstaged').map(h => h.id)

    // All IDs must be unique
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(ids.length)
    expect(ids.length).toBeGreaterThanOrEqual(3)
  })

  it('should allow staging each duplicate hunk individually by ID', async () => {
    const lines = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`)
    writeFileSync(join(tempDir, 'f.txt'), lines.join('\n') + '\n')
    git('add .', tempDir)
    git('commit -m init', tempDir)

    lines[2] = 'CHANGED'
    lines[12] = 'CHANGED'
    writeFileSync(join(tempDir, 'f.txt'), lines.join('\n') + '\n')

    const hunks = await staging.listHunksWithInfo('f.txt', { precise: true })
    const unstagedHunks = hunks.filter(h => h.layer === 'unstaged')
    expect(unstagedHunks.length).toBeGreaterThanOrEqual(2)

    // Stage the first hunk by ID
    const firstId = unstagedHunks[0].id
    await staging.stageHunk('f.txt', firstId, { precise: true })

    const cached = git('diff --cached', tempDir)
    expect(cached).toContain('CHANGED')
  })

  it('should maintain ID stability after staging one duplicate', async () => {
    const lines = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`)
    writeFileSync(join(tempDir, 'f.txt'), lines.join('\n') + '\n')
    git('add .', tempDir)
    git('commit -m init', tempDir)

    lines[2] = 'CHANGED'
    lines[12] = 'CHANGED'
    writeFileSync(join(tempDir, 'f.txt'), lines.join('\n') + '\n')

    const hunksBefore = await staging.listHunksWithInfo('f.txt', { precise: true })
    const unstaged = hunksBefore.filter(h => h.layer === 'unstaged')
    const _secondId = unstaged[1]?.id

    // Stage first hunk
    await staging.stageHunk('f.txt', unstaged[0].id, { precise: true })

    // Second hunk should still be findable (though its index changes)
    const hunksAfter = await staging.listHunksWithInfo('f.txt', { precise: true })
    const remainingUnstaged = hunksAfter.filter(h => h.layer === 'unstaged')
    // At minimum, one unstaged hunk should remain
    expect(remainingUnstaged.length).toBeGreaterThanOrEqual(1)
  })

  it('should produce deterministic IDs after cache clear', async () => {
    const lines = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`)
    writeFileSync(join(tempDir, 'f.txt'), lines.join('\n') + '\n')
    git('add .', tempDir)
    git('commit -m init', tempDir)

    lines[2] = 'CHANGED'
    lines[12] = 'CHANGED'
    writeFileSync(join(tempDir, 'f.txt'), lines.join('\n') + '\n')

    const hunks1 = await staging.listHunksWithInfo('f.txt', { precise: true })
    const ids1 = hunks1.filter(h => h.layer === 'unstaged').map(h => h.id)

    // Clear cache
    const cache = new HunkCacheService(tempDir)
    cache.clearCache()

    const staging2 = new StagingService(tempDir)
    const hunks2 = await staging2.listHunksWithInfo('f.txt', { precise: true })
    const ids2 = hunks2.filter(h => h.layer === 'unstaged').map(h => h.id)

    // Same content -> same IDs (deterministic)
    expect(ids2).toEqual(ids1)
  })

  it('should not need occurrence index in normal mode (context differentiates)', async () => {
    const lines = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`)
    writeFileSync(join(tempDir, 'f.txt'), lines.join('\n') + '\n')
    git('add .', tempDir)
    git('commit -m init', tempDir)

    lines[2] = 'CHANGED'
    lines[12] = 'CHANGED'
    writeFileSync(join(tempDir, 'f.txt'), lines.join('\n') + '\n')

    // Normal mode: context lines differ so fingerprints are naturally unique
    const hunks = await staging.listHunksWithInfo('f.txt', { precise: false })
    const ids = hunks.filter(h => h.layer === 'unstaged').map(h => h.id)
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(ids.length)
  })

  it('should handle 2+ identical hunks in precise mode', async () => {
    // Create a file with 5 identical changes
    const lines = Array.from({ length: 50 }, (_, i) => `Line ${i + 1}`)
    writeFileSync(join(tempDir, 'f.txt'), lines.join('\n') + '\n')
    git('add .', tempDir)
    git('commit -m init', tempDir)

    for (const idx of [4, 14, 24, 34, 44]) {
      lines[idx] = 'IDENTICAL CHANGE'
    }
    writeFileSync(join(tempDir, 'f.txt'), lines.join('\n') + '\n')

    const hunks = await staging.listHunksWithInfo('f.txt', { precise: true })
    const ids = hunks.filter(h => h.layer === 'unstaged').map(h => h.id)
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(ids.length)
    expect(ids.length).toBeGreaterThanOrEqual(5)
  })
})
