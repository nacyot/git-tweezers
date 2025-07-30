import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { HunkCacheService } from '../../src/services/hunk-cache-service.js'
import type { HunkInfo } from '../../src/types/hunk-info.js'
import { rmSync, existsSync } from 'fs'
import { join } from 'path'

describe('HunkCacheService', () => {
  let service: HunkCacheService
  let originalCachePath: string

  beforeEach(() => {
    // Use the current directory (which is a git repo during tests)
    service = new HunkCacheService()
    // Store the cache path for cleanup
    originalCachePath = join(process.cwd(), '.git', 'tweezers-cache.json')
    // Clear any existing cache
    if (existsSync(originalCachePath)) {
      rmSync(originalCachePath)
    }
  })

  afterEach(() => {
    // Clean up the cache file
    if (existsSync(originalCachePath)) {
      rmSync(originalCachePath)
    }
  })

  const createMockHunk = (id: string, index: number): HunkInfo => ({
    id,
    index,
    header: `@@ -${index},5 +${index},7 @@`,
    oldStart: index,
    oldLines: 5,
    newStart: index,
    newLines: 7,
    changes: [],
    summary: `Change at line ${index}`,
    stats: { additions: 2, deletions: 0 },
  })

  describe('mapHunks', () => {
    it('should preserve IDs for cached hunks', () => {
      const hunks = [
        createMockHunk('abc1', 1),
        createMockHunk('def2', 2),
      ]

      // First call - cache the IDs
      const mapped1 = service.mapHunks('test.js', hunks)
      expect(mapped1[0].id).toBe('abc1')
      expect(mapped1[1].id).toBe('def2')

      // Second call with different IDs but same headers
      const newHunks = [
        createMockHunk('new1', 1),
        createMockHunk('new2', 2),
      ]
      const mapped2 = service.mapHunks('test.js', newHunks)
      
      // Should use cached IDs
      expect(mapped2[0].id).toBe('abc1')
      expect(mapped2[1].id).toBe('def2')
    })

    it('should create new cache entries for new hunks', () => {
      const hunks = [createMockHunk('new1', 1)]
      const mapped = service.mapHunks('new-file.js', hunks)
      
      expect(mapped[0].id).toBe('new1')
      
      // Verify it was cached
      const cached = service.mapHunks('new-file.js', [createMockHunk('different', 1)])
      expect(cached[0].id).toBe('new1')
    })
  })

  describe('findHunk', () => {
    const hunks = [
      createMockHunk('abc1', 1),
      createMockHunk('def2', 2),
      createMockHunk('2a10', 3),
    ]

    it('should find by numeric index', () => {
      const found = service.findHunk(hunks, 2)
      expect(found?.id).toBe('def2')
    })

    it('should find by string index', () => {
      const found = service.findHunk(hunks, '2')
      expect(found?.id).toBe('def2')
    })

    it('should find by ID', () => {
      const found = service.findHunk(hunks, 'abc1')
      expect(found?.id).toBe('abc1')
    })

    it('should handle IDs that start with numbers', () => {
      const found = service.findHunk(hunks, '2a10')
      expect(found?.id).toBe('2a10')
    })

    it('should return undefined for not found', () => {
      const found = service.findHunk(hunks, 'notfound')
      expect(found).toBeUndefined()
    })

    it('should distinguish between index and ID', () => {
      // '2' should find index 2, not ID '2a10'
      const found = service.findHunk(hunks, '2')
      expect(found?.id).toBe('def2')
      expect(found?.index).toBe(2)
    })
  })

  describe('clearCache', () => {
    it('should clear all cached entries', () => {
      const hunks = [createMockHunk('test1', 1)]
      
      // Cache some data
      service.mapHunks('test.js', hunks)
      
      // Clear cache
      service.clearCache()
      
      // New hunk with different ID should keep its ID
      const newHunks = [createMockHunk('new1', 1)]
      const mapped = service.mapHunks('test.js', newHunks)
      expect(mapped[0].id).toBe('new1')
    })
  })

  describe('history management', () => {
    it('should add history entries', () => {
      const historyEntry = {
        patch: 'diff --git a/test.js b/test.js',
        files: ['test.js'],
        selectors: ['1'],
        description: 'Test staging',
      }
      
      service.addHistory(historyEntry)
      
      const history = service.getHistory()
      expect(history).toHaveLength(1)
      expect(history[0].patch).toBe(historyEntry.patch)
      expect(history[0].description).toBe(historyEntry.description)
      expect(history[0].id).toBeDefined()
      expect(history[0].timestamp).toBeDefined()
    })

    it('should get specific history entry', () => {
      const entry1 = {
        patch: 'patch1',
        files: ['file1.js'],
        selectors: ['1'],
      }
      const entry2 = {
        patch: 'patch2',
        files: ['file2.js'],
        selectors: ['2'],
      }
      
      service.addHistory(entry1)
      service.addHistory(entry2)
      
      const retrieved = service.getHistoryEntry(0)
      expect(retrieved?.patch).toBe('patch2') // Most recent
      
      const retrieved2 = service.getHistoryEntry(1)
      expect(retrieved2?.patch).toBe('patch1')
    })

    it('should remove history entry', () => {
      const entry = {
        patch: 'patch',
        files: ['file.js'],
        selectors: ['1'],
      }
      
      service.addHistory(entry)
      expect(service.getHistory()).toHaveLength(1)
      
      service.removeHistoryEntry(0)
      expect(service.getHistory()).toHaveLength(0)
    })

    it('should maintain max 20 history entries', () => {
      // Add 25 entries
      for (let i = 0; i < 25; i++) {
        service.addHistory({
          patch: `patch${i}`,
          files: [`file${i}.js`],
          selectors: [String(i)],
        })
      }
      
      const history = service.getHistory()
      expect(history).toHaveLength(20)
      // Should keep the most recent 20
      expect(history[0].patch).toBe('patch24')
      expect(history[19].patch).toBe('patch5')
    })
  })
})