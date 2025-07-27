import type { ExtendedLineChange } from '../types/extended-diff.js'

export interface HunkData {
  header: string
  changes: ExtendedLineChange[]
}

export interface FileData {
  oldPath: string
  newPath: string
  hunks: HunkData[]
}

export class PatchBuilder {
  buildPatch(files: FileData[]): string {
    const patches: string[] = []
    
    for (const file of files) {
      // Add file header
      patches.push(`diff --git a/${file.oldPath} b/${file.newPath}`)
      patches.push(`index 0000000..0000000 100644`)
      patches.push(`--- a/${file.oldPath}`)
      patches.push(`+++ b/${file.newPath}`)
      
      // Add hunks
      for (const hunk of file.hunks) {
        patches.push(hunk.header)
        
        // Process all changes in the hunk
        for (let i = 0; i < hunk.changes.length; i++) {
          const change = hunk.changes[i]
          patches.push(this.formatLineChange(change))
          
          // Check if we need to add a no-newline marker after this change
          if (!change.eol) {
            // Only add the marker if this is not a context line that's followed by more changes
            const nextChange = hunk.changes[i + 1]
            const shouldAddMarker = 
              i === hunk.changes.length - 1 || // Last change in hunk
              (nextChange && nextChange.type !== 'UnchangedLine') // Next change is not context
            
            if (shouldAddMarker) {
              patches.push('\\ No newline at end of file')
            }
          }
        }
      }
    }
    
    // Join with newlines and add final newline
    return patches.join('\n') + '\n'
  }

  buildHunkPatch(file: FileData, hunkIndex: number): string | null {
    if (hunkIndex < 0 || hunkIndex >= file.hunks.length) {
      return null
    }
    
    const hunk = file.hunks[hunkIndex]
    const fileWithSingleHunk: FileData = {
      ...file,
      hunks: [hunk],
    }
    
    return this.buildPatch([fileWithSingleHunk])
  }

  buildLinePatch(
    file: FileData,
    selectedExtendedLineChanges: ExtendedLineChange[],
    originalHunk: HunkData
  ): string {
    // Rebuild the hunk with only selected changes
    const rebuiltHunk = this.rebuildHunk(originalHunk, selectedExtendedLineChanges)
    
    const fileWithRebuiltHunk: FileData = {
      ...file,
      hunks: [rebuiltHunk],
    }
    
    return this.buildPatch([fileWithRebuiltHunk])
  }

  rebuildHunk(originalHunk: HunkData, selectedExtendedLineChanges: ExtendedLineChange[]): HunkData {
    const newExtendedLineChanges: ExtendedLineChange[] = []
    let oldCount = 0
    let newCount = 0
    
    // Parse original header to get base line numbers
    const headerMatch = originalHunk.header.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
    if (!headerMatch) {
      throw new Error('Invalid hunk header')
    }
    
    const oldStart = parseInt(headerMatch[1], 10)
    const newStart = parseInt(headerMatch[3], 10)
    
    if (process.env.DEBUG === '1') {
      console.log(`rebuildHunk: Original hunk has ${originalHunk.changes.length} changes`)
      console.log(`rebuildHunk: Selected ${selectedExtendedLineChanges.length} changes`)
    }
    
    // Process each change
    for (const change of originalHunk.changes) {
      if (selectedExtendedLineChanges.includes(change)) {
        if (process.env.DEBUG === '1') {
          console.log(`  Including selected: ${change.type} "${change.content}" (eol: ${change.eol})`)
        }
        // Keep this change
        newExtendedLineChanges.push(change)
        
        if (change.type === 'DeletedLine') {
          oldCount++
        } else if (change.type === 'AddedLine') {
          newCount++
        } else {
          oldCount++
          newCount++
        }
      } else {
        // Convert add/delete to context
        if (change.type === 'AddedLine') {
          // Skip adds that we don't want to stage
          if (process.env.DEBUG === '1') {
            console.log(`  Skipping unselected add: "${change.content}"`)
          }
          continue
        } else if (change.type === 'DeletedLine') {
          // Convert delete to context
          if (process.env.DEBUG === '1') {
            console.log(`  Converting delete to context: "${change.content}"`)
          }
          newExtendedLineChanges.push({
            ...change,
            type: 'UnchangedLine',
          } as ExtendedLineChange)
          oldCount++
          newCount++
        } else {
          // Keep context lines
          if (process.env.DEBUG === '1') {
            console.log(`  Keeping context: "${change.content}"`)
          }
          newExtendedLineChanges.push(change)
          oldCount++
          newCount++
        }
      }
    }
    
    // Build new header
    const newHeader = `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`
    
    return {
      header: newHeader,
      changes: newExtendedLineChanges,
    }
  }

  private formatLineChange(change: ExtendedLineChange): string {
    const prefix = change.type === 'AddedLine' ? '+' : change.type === 'DeletedLine' ? '-' : ' '
    // Do NOT add newline here - it will be handled by buildPatch
    return prefix + change.content
  }

  /**
   * Calculate hunk header from changes
   */
  calculateHunkHeader(
    changes: ExtendedLineChange[],
    oldStart: number,
    newStart: number
  ): string {
    let oldCount = 0
    let newCount = 0
    
    for (const change of changes) {
      if (change.type === 'DeletedLine') {
        oldCount++
      } else if (change.type === 'AddedLine') {
        newCount++
      } else {
        oldCount++
        newCount++
      }
    }
    
    return `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`
  }
}