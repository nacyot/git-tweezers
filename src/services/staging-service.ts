import { GitWrapper } from '../core/git-wrapper.js'
import { DiffParser } from '../core/diff-parser.js'
import { PatchBuilder } from '../core/patch-builder.js'
import type { AnyLineChange } from 'parse-git-diff'

export interface StageOptions {
  precise?: boolean // Use U0 context for finer control
  cwd?: string
}

export class StagingService {
  private git: GitWrapper
  private parser: DiffParser
  private builder: PatchBuilder

  constructor(cwd?: string) {
    this.git = new GitWrapper(cwd)
    this.parser = new DiffParser()
    this.builder = new PatchBuilder()
  }

  /**
   * List all hunks in a file
   */
  async listHunks(filePath: string, options?: StageOptions): Promise<string[]> {
    // Check if file is untracked and handle it
    const isUntracked = await this.git.isUntracked(filePath)
    if (isUntracked) {
      await this.git.addIntentToAdd(filePath)
    }
    
    const context = options?.precise ? 0 : 3
    const diff = await this.git.diff(filePath, context)
    
    if (!diff) {
      return []
    }
    
    const files = this.parser.parseFiles(diff)
    const file = files.find(f => f.newPath === filePath || f.oldPath === filePath)
    
    if (!file) {
      return []
    }
    
    return file.hunks.map((hunk, index) => 
      `Hunk ${index + 1}: ${hunk.header}`
    )
  }

  /**
   * Stage a specific hunk by index (1-based)
   */
  async stageHunk(filePath: string, hunkIndex: number, options?: StageOptions): Promise<void> {
    // Check if file is untracked and handle it
    const isUntracked = await this.git.isUntracked(filePath)
    if (isUntracked) {
      await this.git.addIntentToAdd(filePath)
    }
    
    const context = options?.precise ? 0 : 3
    const diff = await this.git.diff(filePath, context)
    
    if (!diff) {
      throw new Error(`No changes found for file: ${filePath}`)
    }
    
    const files = this.parser.parseFiles(diff)
    const file = files.find(f => f.newPath === filePath || f.oldPath === filePath)
    
    if (!file) {
      throw new Error(`File not found in diff: ${filePath}`)
    }
    
    if (hunkIndex < 1 || hunkIndex > file.hunks.length) {
      throw new Error(`Hunk index ${hunkIndex} out of range. File has ${file.hunks.length} hunks.`)
    }
    
    const hunk = file.hunks[hunkIndex - 1]
    const fileData = {
      oldPath: file.oldPath,
      newPath: file.newPath,
      hunks: [{
        header: hunk.header,
        changes: hunk.changes,
      }],
    }
    
    const patch = this.builder.buildPatch([fileData])
    
    // Apply the patch
    const applyOptions = options?.precise ? ['--cached', '--unidiff-zero'] : ['--cached']
    await this.git.applyWithOptions(patch, applyOptions)
  }

  /**
   * Stage specific lines in a file
   */
  async stageLines(
    filePath: string,
    startLine: number,
    endLine: number,
    _options?: StageOptions
  ): Promise<void> {
    // Check if file is untracked and handle it
    const isUntracked = await this.git.isUntracked(filePath)
    if (isUntracked) {
      await this.git.addIntentToAdd(filePath)
    }
    
    // For line-level staging, use U1 for better reliability
    const diff = await this.git.diff(filePath, 1)
    
    if (!diff) {
      throw new Error(`No changes found for file: ${filePath}`)
    }
    
    const files = this.parser.parseFiles(diff)
    const file = files.find(f => f.newPath === filePath || f.oldPath === filePath)
    
    if (!file) {
      throw new Error(`File not found in diff: ${filePath}`)
    }
    
    // Collect all changes within the line range
    // const selectedAnyLineChanges: AnyLineChange[] = []
    const selectedHunks: Array<{ header: string; changes: AnyLineChange[] }> = []
    
    let currentLine = 0
    
    for (const hunk of file.hunks) {
      currentLine = hunk.newStart
      const hunkAnyLineChanges: AnyLineChange[] = []
      
      for (const change of hunk.changes) {
        if (change.type === 'AddedLine' || change.type === 'UnchangedLine') {
          if (currentLine >= startLine && currentLine <= endLine && change.type === 'AddedLine') {
            hunkAnyLineChanges.push(change)
          }
          currentLine++
        } else if (change.type === 'DeletedLine') {
          // For deletes, we need to check if they're in range based on old line numbers
          // For simplicity, include all deletes in hunks that have selected adds
          if (hunkAnyLineChanges.length > 0 || (currentLine >= startLine && currentLine <= endLine)) {
            hunkAnyLineChanges.push(change)
          }
        }
      }
      
      if (hunkAnyLineChanges.length > 0) {
        selectedHunks.push({
          header: hunk.header,
          changes: hunkAnyLineChanges,
        })
      }
    }
    
    if (selectedHunks.length === 0) {
      throw new Error(`No changes found in lines ${startLine}-${endLine}`)
    }
    
    // Build patch with selected hunks
    const fileData = {
      oldPath: file.oldPath,
      newPath: file.newPath,
      hunks: selectedHunks,
    }
    
    const patch = this.builder.buildPatch([fileData])
    
    // Apply with recount option for better reliability
    await this.git.applyWithOptions(patch, ['--cached', '--recount'])
  }

  /**
   * Stage multiple hunks at once
   */
  async stageHunks(filePath: string, hunkIndices: number[], options?: StageOptions): Promise<void> {
    const context = options?.precise ? 0 : 3
    const diff = await this.git.diff(filePath, context)
    
    if (!diff) {
      throw new Error(`No changes found for file: ${filePath}`)
    }
    
    const files = this.parser.parseFiles(diff)
    const file = files.find(f => f.newPath === filePath || f.oldPath === filePath)
    
    if (!file) {
      throw new Error(`File not found in diff: ${filePath}`)
    }
    
    // Validate all indices
    for (const index of hunkIndices) {
      if (index < 1 || index > file.hunks.length) {
        throw new Error(`Hunk index ${index} out of range. File has ${file.hunks.length} hunks.`)
      }
    }
    
    // Collect selected hunks
    const selectedHunks = hunkIndices.map(index => {
      const hunk = file.hunks[index - 1]
      return {
        header: hunk.header,
        changes: hunk.changes,
      }
    })
    
    const fileData = {
      oldPath: file.oldPath,
      newPath: file.newPath,
      hunks: selectedHunks,
    }
    
    const patch = this.builder.buildPatch([fileData])
    
    // Apply the patch
    const applyOptions = options?.precise ? ['--cached', '--unidiff-zero'] : ['--cached']
    await this.git.applyWithOptions(patch, applyOptions)
  }

  /**
   * Get the count of hunks for a file
   */
  async getHunkCount(filePath: string, options?: StageOptions): Promise<number> {
    // Check if file is untracked and handle it
    const isUntracked = await this.git.isUntracked(filePath)
    if (isUntracked) {
      await this.git.addIntentToAdd(filePath)
    }
    
    const context = options?.precise ? 0 : 3
    const diff = await this.git.diff(filePath, context)
    
    if (!diff) {
      return 0
    }
    
    return this.parser.getFileHunkCount(diff, filePath)
  }
}