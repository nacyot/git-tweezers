import { createHash } from 'crypto'
import type { ParsedHunk } from './diff-parser.js'
import type { ExtendedLineChange } from '../types/extended-diff.js'

/**
 * Normalize a line for consistent hashing
 * - Replace tabs with spaces
 * - Trim trailing whitespace
 * - Remove carriage returns
 */
function normalizeLine(line: string): string {
  return line
    .replace(/\r/g, '')        // Remove CR
    .replace(/\t/g, ' ')       // Replace tabs with spaces
    .replace(/\s+$/, '')       // Trim trailing whitespace
}

/**
 * Extract context lines before and after changes
 */
function extractContext(changes: ExtendedLineChange[]): {
  before: string[]
  after: string[]
  actualChanges: ExtendedLineChange[]
} {
  const before: string[] = []
  const after: string[] = []
  const actualChanges: ExtendedLineChange[] = []
  
  let foundFirstChange = false
  let lastChangeIndex = -1
  
  // Find actual changes (not UnchangedLine)
  changes.forEach((change, index) => {
    if (change.type !== 'UnchangedLine') {
      if (!foundFirstChange) {
        // Collect up to 3 context lines before first change
        for (let i = Math.max(0, index - 3); i < index; i++) {
          if (changes[i].type === 'UnchangedLine') {
            before.push(changes[i].content)
          }
        }
        foundFirstChange = true
      }
      actualChanges.push(change)
      lastChangeIndex = index
    }
  })
  
  // Collect up to 3 context lines after last change
  if (lastChangeIndex >= 0) {
    for (let i = lastChangeIndex + 1; i < Math.min(changes.length, lastChangeIndex + 4); i++) {
      if (changes[i].type === 'UnchangedLine') {
        after.push(changes[i].content)
      }
    }
  }
  
  return { before, after, actualChanges }
}

/**
 * Generate a stable content-based fingerprint for a hunk
 * Based on O3's suggestion: normalize content to be independent of +/- prefixes
 * This ensures the same content has the same ID whether staged or unstaged
 */
export function generateContentFingerprint(
  hunk: ParsedHunk,
  filePath: string
): string {
  const hash = createHash('sha256')
  
  // Include file path for uniqueness across files
  hash.update(filePath + '\n')
  
  // Extract context and changes
  const { before, after, actualChanges } = extractContext(hunk.changes)
  
  // Hash normalized context before (without prefixes)
  before.forEach(line => {
    hash.update(normalizeLine(line) + '\n')
  })
  
  // Hash actual changes WITHOUT their types (no +/- prefix)
  // This makes the fingerprint identical whether the change is staged or unstaged
  actualChanges.forEach(change => {
    // Just use the content, not the type
    hash.update(normalizeLine(change.content) + '\n')
  })
  
  // Hash normalized context after (without prefixes)
  after.forEach(line => {
    hash.update(normalizeLine(line) + '\n')
  })
  
  return hash.digest('hex')
}

/**
 * Generate a stable ID for a hunk based on its content
 * Uses content-based fingerprint to ensure stability across staging operations
 */
export function generateHunkId(
  hunk: ParsedHunk,
  filePath: string,
  existingIds?: Set<string>
): string {
  const fingerprint = generateContentFingerprint(hunk, filePath)
  
  // Start with 4 characters, increase if collision
  let length = 4
  let id = fingerprint.substring(0, length)
  
  // Handle collisions by increasing length
  while (existingIds && existingIds.has(id) && length < fingerprint.length) {
    length++
    id = fingerprint.substring(0, length)
  }
  
  return id
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