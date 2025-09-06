import type { ExtendedLineChange } from './extended-diff.js'

export interface HunkInfo {
  id: string
  index: number // 1-based ordinal number
  header: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  changes: ExtendedLineChange[]
  summary?: string
  stats?: {
    additions: number
    deletions: number
  }
  layer?: 'staged' | 'unstaged' | 'both' // Track which layer the hunk is in
}

export interface FileInfo {
  oldPath: string
  newPath: string
  hunks: HunkInfo[]
}