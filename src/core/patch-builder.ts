import type { AnyLineChange } from 'parse-git-diff'

export interface HunkData {
  header: string
  changes: AnyLineChange[]
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
        
        for (const change of hunk.changes) {
          patches.push(this.formatAnyLineChange(change))
        }
      }
    }
    
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
    selectedAnyLineChanges: AnyLineChange[],
    originalHunk: HunkData
  ): string {
    // Rebuild the hunk with only selected changes
    const rebuiltHunk = this.rebuildHunk(originalHunk, selectedAnyLineChanges)
    
    const fileWithRebuiltHunk: FileData = {
      ...file,
      hunks: [rebuiltHunk],
    }
    
    return this.buildPatch([fileWithRebuiltHunk])
  }

  private rebuildHunk(originalHunk: HunkData, selectedAnyLineChanges: AnyLineChange[]): HunkData {
    const newAnyLineChanges: AnyLineChange[] = []
    let oldCount = 0
    let newCount = 0
    
    // Parse original header to get base line numbers
    const headerMatch = originalHunk.header.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
    if (!headerMatch) {
      throw new Error('Invalid hunk header')
    }
    
    const oldStart = parseInt(headerMatch[1], 10)
    const newStart = parseInt(headerMatch[3], 10)
    
    // Process each change
    for (const change of originalHunk.changes) {
      if (selectedAnyLineChanges.includes(change)) {
        // Keep this change
        newAnyLineChanges.push(change)
        
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
          continue
        } else if (change.type === 'DeletedLine') {
          // Convert delete to context
          newAnyLineChanges.push({
            ...change,
            type: 'UnchangedLine',
          } as AnyLineChange)
          oldCount++
          newCount++
        } else {
          // Keep context lines
          newAnyLineChanges.push(change)
          oldCount++
          newCount++
        }
      }
    }
    
    // Build new header
    const newHeader = `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`
    
    return {
      header: newHeader,
      changes: newAnyLineChanges,
    }
  }

  private formatAnyLineChange(change: AnyLineChange): string {
    const prefix = change.type === 'AddedLine' ? '+' : change.type === 'DeletedLine' ? '-' : ' '
    return prefix + change.content
  }

  /**
   * Calculate hunk header from changes
   */
  calculateHunkHeader(
    changes: AnyLineChange[],
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