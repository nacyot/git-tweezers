import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { GitWrapper } from '../core/git-wrapper.js'
import type { HunkInfo } from '../types/hunk-info.js'

interface CacheEntry {
  id: string
  filePath: string
  header: string
  summary?: string
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
  entries: Record<string, CacheEntry>
  history?: HistoryEntry[]
}

export class HunkCacheService {
  private cachePath: string
  private git: GitWrapper
  private cacheData: CacheData
  
  constructor(cwd?: string) {
    this.git = new GitWrapper(cwd)
    const gitRoot = this.git.getGitRoot()
    this.cachePath = join(gitRoot, '.git', 'tweezers-cache.json')
    this.cacheData = this.loadCache()
  }
  
  private loadCache(): CacheData {
    if (!existsSync(this.cachePath)) {
      return { version: 1, entries: {}, history: [] }
    }
    
    try {
      const content = readFileSync(this.cachePath, 'utf8')
      const data = JSON.parse(content)
      // Ensure history array exists
      if (!data.history) {
        data.history = []
      }
      return data
    } catch {
      return { version: 1, entries: {}, history: [] }
    }
  }
  
  private saveCache(): void {
    const dir = dirname(this.cachePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    
    // Clean up old entries (older than 7 days)
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    Object.keys(this.cacheData.entries).forEach(key => {
      if (this.cacheData.entries[key].lastSeen < weekAgo) {
        delete this.cacheData.entries[key]
      }
    })
    
    writeFileSync(this.cachePath, JSON.stringify(this.cacheData, null, 2))
  }
  
  /**
   * Get or create ID mapping for hunks
   */
  mapHunks(filePath: string, hunks: HunkInfo[]): HunkInfo[] {
    const now = Date.now()
    const updatedHunks = hunks.map(hunk => {
      const cacheKey = `${filePath}:${hunk.header}`
      
      // Check if we have a cached ID for this hunk
      const cached = this.cacheData.entries[cacheKey]
      if (cached) {
        // Update last seen time
        cached.lastSeen = now
        // Use cached ID if available
        return { ...hunk, id: cached.id }
      }
      
      // Store new ID in cache
      this.cacheData.entries[cacheKey] = {
        id: hunk.id,
        filePath,
        header: hunk.header,
        summary: hunk.summary,
        lastSeen: now,
      }
      
      return hunk
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
    
    // Try to parse as number first
    const num = parseInt(selectorStr, 10)
    if (!isNaN(num) && String(num) === selectorStr) {
      // It's a pure number, find by index
      return hunks.find(h => h.index === num)
    }
    
    // Find by ID
    return hunks.find(h => h.id === selectorStr)
  }
  
  /**
   * Clear the cache
   */
  clearCache(): void {
    this.cacheData = { version: 1, entries: {}, history: [] }
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