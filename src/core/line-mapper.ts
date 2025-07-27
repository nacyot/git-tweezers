import type { ExtendedLineChange } from '../types/extended-diff.js'
import type { ParsedHunk } from './diff-parser.js'

export interface LineMapping {
  lineNumber: number
  change?: ExtendedLineChange
  isContextLine: boolean
}

/**
 * Maps line numbers in the NEW file to their corresponding changes in the diff
 * Uses the algorithm suggested by o3: track both old and new line counters
 */
export class LineMapper {
  /**
   * Create a map from new file line numbers to changes
   */
  static mapNewLinesToChanges(hunk: ParsedHunk): Map<number, ExtendedLineChange> {
    let _oldLine = hunk.oldStart // 1-based - needed to track position in old file
    let newLine = hunk.newStart // 1-based
    const map = new Map<number, ExtendedLineChange>()
    
    for (let i = 0; i < hunk.changes.length; i++) {
      const change = hunk.changes[i]
      switch (change.type) {
        case 'UnchangedLine':
          // Context line - present in both old and new
          map.set(newLine, change)
          _oldLine++
          newLine++
          break
          
        case 'DeletedLine':
          // Only in old file, doesn't have a new line number
          _oldLine++
          break
          
        case 'AddedLine':
          // Only in new file
          map.set(newLine, change)
          newLine++
          break
      }
    }
    
    return map
  }
  
  /**
   * Check if a change needs its EOF newline pair
   * This happens when adding a line after a line that has no newline
   */
  static needsEOFPair(
    change: ExtendedLineChange, 
    index: number, 
    allChanges: ExtendedLineChange[]
  ): boolean {
    // If this is an added line and the previous change has no EOL
    if (change.type === 'AddedLine' && index > 0) {
      const prevChange = allChanges[index - 1]
      // Check if previous is a delete without EOL or an unchanged line without EOL
      if (!prevChange.eol) {
        return true
      }
    }
    return false
  }
  
  /**
   * Find the corresponding change that adds newline to a no-EOL line
   */
  static findEOLFixChange(
    noEOLChange: ExtendedLineChange,
    hunk: ParsedHunk
  ): ExtendedLineChange | null {
    const index = hunk.changes.indexOf(noEOLChange)
    
    // Look for the next added line with same content but with EOL
    for (let i = index + 1; i < hunk.changes.length; i++) {
      const change = hunk.changes[i]
      if (change.type === 'AddedLine' && 
          change.content === noEOLChange.content &&
          change.eol) {
        return change
      }
    }
    
    return null
  }
  
  /**
   * Get all changes needed for staging specific lines
   * This includes handling EOF newline dependencies
   */
  static getRequiredChanges(
    hunk: ParsedHunk,
    targetLines: Set<number>
  ): ExtendedLineChange[] {
    const lineMap = this.mapNewLinesToChanges(hunk)
    const required = new Set<ExtendedLineChange>()
    
    if (process.env.DEBUG === '1') {
      console.log('Line mapping for hunk:')
      lineMap.forEach((change, lineNum) => {
        console.log(`  Line ${lineNum}: ${change.type} "${change.content}" (eol: ${change.eol})`)
      })
    }
    
    // First pass: collect directly requested changes
    for (const lineNum of targetLines) {
      const change = lineMap.get(lineNum)
      if (change && change.type === 'AddedLine') {
        required.add(change)
        
        // Special handling for EOF newline dependencies
        // Check if there's a delete-add pair for the previous line
        const index = hunk.changes.indexOf(change)
        
        // Look for pattern: DeletedLine (no eol) followed by AddedLine (with eol)
        if (index >= 2) {
          const possibleDelete = hunk.changes[index - 2]
          const possibleAdd = hunk.changes[index - 1]
          
          if (possibleDelete.type === 'DeletedLine' && 
              !possibleDelete.eol &&
              possibleAdd.type === 'AddedLine' &&
              possibleAdd.content === possibleDelete.content) {
            // This is an EOF fix pattern - need both changes
            if (process.env.DEBUG === '1') {
              console.log(`Line ${lineNum} requires EOF fix: including "${possibleDelete.content}" delete/add pair`)
            }
            required.add(possibleDelete)
            required.add(possibleAdd)
          }
        }
      }
    }
    
    // Convert to array and sort by original order
    const sortedChanges: ExtendedLineChange[] = []
    for (const change of hunk.changes) {
      if (required.has(change)) {
        sortedChanges.push(change)
      }
    }
    
    return sortedChanges
  }
}