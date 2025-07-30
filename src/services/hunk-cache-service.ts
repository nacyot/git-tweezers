import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { GitWrapper } from '../core/git-wrapper.js'
import type { HunkInfo } from '../types/hunk-info.js'
import { generateContentFingerprint } from '../core/hunk-id.js'
import type { ParsedHunk } from '../core/diff-parser.js'

interface FingerprintEntry {
  id: string
  fingerprint: string
  lastSeen: number
}

interface HistoryEntry {
  id: string
  timestamp: number
  patch: string
  files: string[]
  selectors: Array<string | number>
  description?: string
}

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
    
    const updatedHunks = hunks.map(hunk => {
      // Generate content-based fingerprint
      const parsedHunk: ParsedHunk = {
        index: hunk.index,
        header: hunk.header,
        oldStart: hunk.oldStart,
        oldLines: hunk.oldLines,
        newStart: hunk.newStart,
        newLines: hunk.newLines,
        changes: hunk.changes,
      }
      
      const fingerprint = generateContentFingerprint(parsedHunk, filePath)
      
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
      let length = 4
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
   * Add a staging history entry
   */
  addHistory(entry: Omit<HistoryEntry, 'id' | 'timestamp'>): void {
    const historyEntry: HistoryEntry = {
      id: new Date().toISOString(),
      timestamp: Date.now(),
      ...entry,
    }
    
    if (!this.cacheData.history) {
      this.cacheData.history = []
    }
    
    // Add to beginning of array (newest first)
    this.cacheData.history.unshift(historyEntry)
    
    // Keep only last 20 entries
    if (this.cacheData.history.length > 20) {
      this.cacheData.history = this.cacheData.history.slice(0, 20)
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