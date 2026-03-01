import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { createHash } from 'crypto'
import { GitWrapper } from '../core/git-wrapper.js'
import type { HunkInfo } from '../types/hunk-info.js'
import { generateContentFingerprint } from '../core/hunk-id.js'
import type { ParsedHunk } from '../core/diff-parser.js'

interface FingerprintEntry {
  id: string
  fingerprint: string
  lastSeen: number
}

// Legacy patch-based history entry (v1)
interface LegacyHistoryEntry {
  id: string
  timestamp: number
  patch: string
  files: string[]
  selectors: Array<string | number>
  description?: string
  type?: 'patch'
}

// New tree-snapshot history entry (v2)
interface TreeHistoryEntry {
  id: string
  timestamp: number
  type: 'tree'
  tree: string // SHA of index tree snapshot
  description: string
  affectedFiles: string[]
}

export type HistoryEntry = LegacyHistoryEntry | TreeHistoryEntry

export function isTreeEntry(entry: HistoryEntry): entry is TreeHistoryEntry {
  return entry.type === 'tree'
}

export function isLegacyEntry(entry: HistoryEntry): entry is LegacyHistoryEntry {
  return entry.type !== 'tree'
}

const MAX_HISTORY_ENTRIES = 500

interface CacheData {
  version: number
  // Map from fingerprint to ID
  fingerprints: Record<string, string>
  // Track ID usage for collision detection
  usedIds: Record<string, FingerprintEntry>
  history?: HistoryEntry[]
}

export class HunkCacheService {
  private cachePath: string
  private git: GitWrapper
  private cacheData: CacheData
  
  constructor(cwd?: string) {
    this.git = new GitWrapper(cwd)
    const gitDir = this.git.getGitDir()
    this.cachePath = join(gitDir, 'tweezers-cache.json')
    
    // Debug logging for worktree issues
    if (process.env.DEBUG) {
      console.error(`[HunkCacheService] cwd: ${cwd}`)
      console.error(`[HunkCacheService] gitDir: ${gitDir}`)
      console.error(`[HunkCacheService] cachePath: ${this.cachePath}`)
    }
    
    this.cacheData = this.loadCache()
  }
  
  private loadCache(): CacheData {
    if (!existsSync(this.cachePath)) {
      return { version: 2, fingerprints: {}, usedIds: {}, history: [] }
    }
    
    try {
      const content = readFileSync(this.cachePath, 'utf8')
      const data = JSON.parse(content)
      
      // Migrate from version 1 to version 2
      if (data.version === 1) {
        return { version: 2, fingerprints: {}, usedIds: {}, history: data.history || [] }
      }
      
      // Ensure history array exists
      if (!data.history) {
        data.history = []
      }
      
      // Ensure required fields exist
      if (!data.fingerprints) data.fingerprints = {}
      if (!data.usedIds) data.usedIds = {}
      
      return data
    } catch {
      return { version: 2, fingerprints: {}, usedIds: {}, history: [] }
    }
  }
  
  private saveCache(): void {
    const dir = dirname(this.cachePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    
    // Clean up old entries (older than 7 days)
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    Object.keys(this.cacheData.usedIds).forEach(id => {
      const entry = this.cacheData.usedIds[id]
      if (entry.lastSeen < weekAgo) {
        // Remove from both maps
        delete this.cacheData.usedIds[id]
        delete this.cacheData.fingerprints[entry.fingerprint]
      }
    })
    
    writeFileSync(this.cachePath, JSON.stringify(this.cacheData, null, 2))
  }
  
  /**
   * Get or create stable ID mapping for hunks
   */
  mapHunks(filePath: string, hunks: HunkInfo[]): HunkInfo[] {
    const now = Date.now()
    const existingIds = new Set(Object.keys(this.cacheData.usedIds))

    // Phase 1: compute base fingerprints for all hunks
    const baseFingerprints = hunks.map(hunk => {
      const parsedHunk: ParsedHunk = {
        index: hunk.index,
        header: hunk.header,
        oldStart: hunk.oldStart,
        oldLines: hunk.oldLines,
        newStart: hunk.newStart,
        newLines: hunk.newLines,
        changes: hunk.changes,
      }
      return generateContentFingerprint(parsedHunk, filePath)
    })

    // Phase 2: count occurrences and assign occurrence indices
    const fingerprintOccurrences = new Map<string, number>()
    const occurrenceIndices = baseFingerprints.map(fp => {
      const count = fingerprintOccurrences.get(fp) || 0
      fingerprintOccurrences.set(fp, count + 1)
      return count // 0-based
    })

    // Phase 3: generate IDs with derived fingerprints for duplicates
    const updatedHunks = hunks.map((hunk, i) => {
      const baseFp = baseFingerprints[i]
      const occIdx = occurrenceIndices[i]
      const totalOcc = fingerprintOccurrences.get(baseFp)!

      // Derive a unique fingerprint for duplicate content hunks (occurrence > 0)
      let fingerprint = baseFp
      if (totalOcc > 1 && occIdx > 0) {
        const hash = createHash('sha256')
        hash.update(baseFp)
        hash.update(`\x00occurrence:${occIdx}`)
        fingerprint = hash.digest('hex')
      }

      // Check if we already have an ID for this fingerprint
      if (this.cacheData.fingerprints[fingerprint]) {
        const cachedId = this.cacheData.fingerprints[fingerprint]
        // Update last seen time
        if (this.cacheData.usedIds[cachedId]) {
          this.cacheData.usedIds[cachedId].lastSeen = now
        }
        return { ...hunk, id: cachedId }
      }

      // Generate new ID
      let length = 8
      let id = fingerprint.substring(0, length)

      // Handle collisions by increasing length
      while (existingIds.has(id) && length < fingerprint.length) {
        length++
        id = fingerprint.substring(0, length)
      }

      // Store the mapping
      this.cacheData.fingerprints[fingerprint] = id
      this.cacheData.usedIds[id] = {
        id,
        fingerprint,
        lastSeen: now,
      }
      existingIds.add(id)

      return { ...hunk, id }
    })

    this.saveCache()
    return updatedHunks
  }
  
  /**
   * Find hunk by ID or index
   */
  findHunk(hunks: HunkInfo[], selector: string | number): HunkInfo | undefined {
    if (typeof selector === 'number') {
      // Find by index (1-based)
      return hunks.find(h => h.index === selector)
    }
    
    // selector is a string
    const selectorStr = String(selector).trim()
    
    // First try to find by ID
    const byId = hunks.find(h => h.id === selectorStr)
    if (byId) {
      return byId
    }
    
    // If not found by ID, try to parse as number for index lookup
    const num = parseInt(selectorStr, 10)
    if (!isNaN(num) && String(num) === selectorStr) {
      // It's a pure number, find by index
      return hunks.find(h => h.index === num)
    }
    
    // Not found
    return undefined
  }
  
  /**
   * Clear the cache
   */
  clearCache(): void {
    this.cacheData = { version: 2, fingerprints: {}, usedIds: {}, history: [] }
    this.saveCache()
  }
  
  /**
   * Add a tree-snapshot history entry (new approach).
   * Stores the tree SHA of the index state before the staging operation.
   */
  addTreeHistory(entry: { tree: string; description: string; affectedFiles: string[] }): void {
    const historyEntry: TreeHistoryEntry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      timestamp: Date.now(),
      type: 'tree',
      tree: entry.tree,
      description: entry.description,
      affectedFiles: entry.affectedFiles,
    }
    this.pushHistory(historyEntry)
  }

  /**
   * Add a legacy patch-based history entry (kept for backward compatibility).
   */
  addHistory(entry: Omit<LegacyHistoryEntry, 'id' | 'timestamp' | 'type'>): void {
    const historyEntry: LegacyHistoryEntry = {
      id: new Date().toISOString(),
      timestamp: Date.now(),
      type: 'patch',
      ...entry,
    }
    this.pushHistory(historyEntry)
  }

  private pushHistory(entry: HistoryEntry): void {
    if (!this.cacheData.history) {
      this.cacheData.history = []
    }

    // Add to beginning of array (newest first)
    this.cacheData.history.unshift(entry)

    // Keep history bounded to prevent unbounded growth
    if (this.cacheData.history.length > MAX_HISTORY_ENTRIES) {
      this.cacheData.history = this.cacheData.history.slice(0, MAX_HISTORY_ENTRIES)
    }

    this.saveCache()
  }
  
  /**
   * Get history entries
   */
  getHistory(): HistoryEntry[] {
    return this.cacheData.history || []
  }
  
  /**
   * Get specific history entry by index (0 = most recent)
   */
  getHistoryEntry(index: number): HistoryEntry | undefined {
    const history = this.getHistory()
    return history[index]
  }
  
  /**
   * Remove a history entry
   */
  removeHistoryEntry(index: number): void {
    const history = this.getHistory()
    if (index >= 0 && index < history.length) {
      history.splice(index, 1)
      this.saveCache()
    }
  }
}