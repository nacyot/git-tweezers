import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { execSync } from 'child_process'
import { HunkCacheService, isTreeEntry } from '../src/services/hunk-cache-service.js'
import { GitWrapper } from '../src/core/git-wrapper.js'

function git(cmd: string, cwd: string) {
  return execSync(`git ${cmd}`, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
}

describe('Cache Resilience', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'gt-cache-resil-'))
    git('init', tempDir)
    git('config user.email "t@t"', tempDir)
    git('config user.name "T"', tempDir)
    writeFileSync(join(tempDir, 'dummy.txt'), 'init\n')
    git('add .', tempDir)
    git('commit -m init', tempDir)
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  describe('Corrupt cache file', () => {
    it('should recover from corrupt JSON cache', () => {
      const gitDir = new GitWrapper(tempDir).getGitDir()
      const cacheFile = join(gitDir, 'tweezers-cache.json')

      // Write corrupt JSON
      writeFileSync(cacheFile, '{corrupt json!!!}')

      // Should not throw, should create fresh cache
      const cache = new HunkCacheService(tempDir)
      const history = cache.getHistory()
      expect(history).toEqual([])
    })

    it('should recover from empty cache file', () => {
      const gitDir = new GitWrapper(tempDir).getGitDir()
      const cacheFile = join(gitDir, 'tweezers-cache.json')

      writeFileSync(cacheFile, '')

      const cache = new HunkCacheService(tempDir)
      const history = cache.getHistory()
      expect(history).toEqual([])
    })

    it('should recover from truncated cache file', () => {
      const gitDir = new GitWrapper(tempDir).getGitDir()
      const cacheFile = join(gitDir, 'tweezers-cache.json')

      writeFileSync(cacheFile, '{"version":3,"history":[{"id":"test","timestamp":12345')

      const cache = new HunkCacheService(tempDir)
      const history = cache.getHistory()
      expect(history).toEqual([])
    })
  })

  describe('Cache operations', () => {
    it('should persist history across instances', () => {
      const cache1 = new HunkCacheService(tempDir)
      cache1.addTreeHistory({
        tree: 'abc123',
        description: 'Test operation',
        affectedFiles: ['test.txt'],
      })

      // Create new instance (simulates process restart)
      const cache2 = new HunkCacheService(tempDir)
      const history = cache2.getHistory()
      expect(history).toHaveLength(1)
      expect(history[0].description).toBe('Test operation')
    })

    it('should maintain FIFO order for history entries', () => {
      const cache = new HunkCacheService(tempDir)

      cache.addTreeHistory({
        tree: 'aaa111',
        description: 'First',
        affectedFiles: ['a.txt'],
      })
      cache.addTreeHistory({
        tree: 'bbb222',
        description: 'Second',
        affectedFiles: ['b.txt'],
      })
      cache.addTreeHistory({
        tree: 'ccc333',
        description: 'Third',
        affectedFiles: ['c.txt'],
      })

      const history = cache.getHistory()
      // Most recent should be first
      expect(history[0].description).toBe('Third')
      expect(history[1].description).toBe('Second')
      expect(history[2].description).toBe('First')
    })

    it('should get specific history entry by index', () => {
      const cache = new HunkCacheService(tempDir)
      cache.addTreeHistory({
        tree: 'aaa111',
        description: 'First',
        affectedFiles: ['a.txt'],
      })
      cache.addTreeHistory({
        tree: 'bbb222',
        description: 'Second',
        affectedFiles: ['b.txt'],
      })

      const entry = cache.getHistoryEntry(0)
      expect(entry).toBeDefined()
      expect(entry!.description).toBe('Second')

      const entry1 = cache.getHistoryEntry(1)
      expect(entry1).toBeDefined()
      expect(entry1!.description).toBe('First')
    })

    it('should return undefined for out-of-range history index', () => {
      const cache = new HunkCacheService(tempDir)
      expect(cache.getHistoryEntry(0)).toBeUndefined()
      expect(cache.getHistoryEntry(99)).toBeUndefined()
    })

    it('should remove history entry by index', () => {
      const cache = new HunkCacheService(tempDir)
      cache.addTreeHistory({
        tree: 'aaa111',
        description: 'First',
        affectedFiles: ['a.txt'],
      })
      cache.addTreeHistory({
        tree: 'bbb222',
        description: 'Second',
        affectedFiles: ['b.txt'],
      })

      cache.removeHistoryEntry(0) // Remove most recent
      const history = cache.getHistory()
      expect(history).toHaveLength(1)
      expect(history[0].description).toBe('First')
    })

    it('should handle removeHistoryEntry with out-of-range index', () => {
      const cache = new HunkCacheService(tempDir)
      // Should not throw
      cache.removeHistoryEntry(99)
      expect(cache.getHistory()).toHaveLength(0)
    })
  })

  describe('Cache clear', () => {
    it('should clear all cache data', () => {
      const cache = new HunkCacheService(tempDir)
      cache.addTreeHistory({
        tree: 'abc123',
        description: 'Test',
        affectedFiles: ['test.txt'],
      })

      cache.clearCache()
      expect(cache.getHistory()).toHaveLength(0)
    })

    it('should be usable after clear', () => {
      const cache = new HunkCacheService(tempDir)
      cache.addTreeHistory({
        tree: 'abc123',
        description: 'Before clear',
        affectedFiles: ['test.txt'],
      })
      cache.clearCache()

      // Should work fine after clear
      cache.addTreeHistory({
        tree: 'def456',
        description: 'After clear',
        affectedFiles: ['test2.txt'],
      })
      expect(cache.getHistory()).toHaveLength(1)
      expect(cache.getHistory()[0].description).toBe('After clear')
    })
  })

  describe('Tree vs Legacy entry types', () => {
    it('should correctly identify tree entries', () => {
      const cache = new HunkCacheService(tempDir)
      cache.addTreeHistory({
        tree: 'abc123',
        description: 'Tree entry',
        affectedFiles: ['test.txt'],
      })

      const entry = cache.getHistoryEntry(0)!
      expect(isTreeEntry(entry)).toBe(true)
    })

    it('should correctly identify legacy entries', () => {
      const cache = new HunkCacheService(tempDir)
      cache.addHistory({
        patch: 'test patch',
        files: ['test.txt'],
        selectors: ['1'],
        description: 'Legacy entry',
      })

      const entry = cache.getHistoryEntry(0)!
      expect(isTreeEntry(entry)).toBe(false)
    })
  })

  describe('Fingerprint mapping', () => {
    it('should assign stable fingerprints to hunks', () => {
      const cache = new HunkCacheService(tempDir)
      const hunks = [
        { index: 1, header: '@@ -1,3 +1,3 @@', oldStart: 1, oldLines: 3, newStart: 1, newLines: 3, id: '', changes: [{ type: 'AddedLine' as const, content: 'new', eol: true }] },
      ]

      const mapped1 = cache.mapHunks('f.txt', hunks as any)
      const mapped2 = cache.mapHunks('f.txt', hunks as any)

      // Same content should produce same ID
      expect(mapped1[0].id).toBe(mapped2[0].id)
      expect(mapped1[0].id).toMatch(/^[a-f0-9]{8}$/)
    })
  })
})
