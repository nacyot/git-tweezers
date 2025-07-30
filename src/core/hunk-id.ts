import { createHash } from 'crypto'
import type { ParsedHunk } from './diff-parser.js'

/**
 * Generate a stable ID for a hunk based on its content
 * Uses header + change content + file path to create a deterministic hash
 */
export function generateHunkId(
  hunk: ParsedHunk,
  filePath: string
): string {
  const hash = createHash('sha256')
  
  // Include file path for uniqueness across files
  hash.update(filePath)
  
  // Include header
  hash.update(hunk.header)
  
  // Include all change content
  hunk.changes.forEach(change => {
    hash.update(change.type)
    hash.update(change.content)
  })
  
  // Take first 4 characters of hex digest
  return hash.digest('hex').substring(0, 4)
}

/**
 * Extract a summary from hunk changes for better identification
 */
export function getHunkSummary(hunk: ParsedHunk): string {
  // Find the first meaningful change
  const meaningfulChange = hunk.changes.find(change => {
    if (change.type === 'UnchangedLine') return false
    // Skip empty lines or lines with only whitespace
    const trimmed = change.content.trim()
    return trimmed.length > 0
  })
  
  if (!meaningfulChange) {
    return ''
  }
  
  const content = meaningfulChange.content.trim()
  const maxLength = 50
  
  // Truncate if too long
  if (content.length > maxLength) {
    return content.substring(0, maxLength) + '...'
  }
  
  return content
}

/**
 * Get change statistics for a hunk
 */
export function getHunkStats(hunk: ParsedHunk): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  
  hunk.changes.forEach(change => {
    if (change.type === 'AddedLine') additions++
    else if (change.type === 'DeletedLine') deletions++
  })
  
  return { additions, deletions }
}