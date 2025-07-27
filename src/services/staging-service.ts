import { GitWrapper } from '../core/git-wrapper.js'
import { DiffParser } from '../core/diff-parser.js'
import { PatchBuilder } from '../core/patch-builder.js'
import type { ExtendedLineChange } from '../types/extended-diff.js'

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
    // Check if file is binary
    const isBinary = await this.git.isBinary(filePath)
    if (isBinary) {
      throw new Error(`Cannot list hunks for binary file: ${filePath}`)
    }
    
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
    // Check if file is binary
    const isBinary = await this.git.isBinary(filePath)
    if (isBinary) {
      throw new Error(`Cannot stage hunks for binary file: ${filePath}`)
    }
    
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
    
    if (process.env.DEBUG === '1') {
      console.log('Generated patch:')
      console.log(patch)
    }
    
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
    // Check if file is binary
    const isBinary = await this.git.isBinary(filePath)
    if (isBinary) {
      throw new Error(`Cannot stage lines for binary file: ${filePath}`)
    }
    
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
    
    for (const hunk of file.hunks) {
      const selectedChanges: ExtendedLineChange[] = []
      let tempLine = hunk.newStart
      let hasSelectedLines = false
      
      // Track which line numbers in the NEW file we want to stage
      const targetNewLines = new Set<number>()
      for (let line = startLine; line <= endLine; line++) {
        targetNewLines.add(line)
      }
      
      // First, figure out which changes affect our target lines
      const changesByNewLine = new Map<number, ExtendedLineChange>()
      for (const change of hunk.changes) {
        if (change.type === 'AddedLine' || change.type === 'UnchangedLine') {
          changesByNewLine.set(tempLine, change)
          if (targetNewLines.has(tempLine) && change.type === 'AddedLine') {
            hasSelectedLines = true
          }
          tempLine++
        }
      }
      
      if (hasSelectedLines) {
        // Now determine which changes we need to include
        // For line-level staging of additions, we need to be smart about dependencies
        const requiredChanges = new Set<ExtendedLineChange>()
        
        // Add all changes for lines we want to stage
        for (const lineNum of targetNewLines) {
          const change = changesByNewLine.get(lineNum)
          if (change && change.type === 'AddedLine') {
            requiredChanges.add(change)
          }
        }
        
        // For a proper patch, we might need to include related changes
        // This is a simplified approach - just include the selected additions
        selectedChanges.push(...Array.from(requiredChanges))
        
        if (process.env.DEBUG === '1') {
          console.log(`Selected ${selectedChanges.length} changes for staging`)
          selectedChanges.forEach(c => console.log(`  ${c.type}: "${c.content}"`))
        }
        
        // Use buildLinePatch which properly handles the rebuilding
        const patch = this.builder.buildLinePatch(file, selectedChanges, hunk)
        
        if (process.env.DEBUG === '1') {
          console.log('Generated patch:')
          console.log(patch)
        }
        
        // Apply this hunk's patch
        await this.git.applyWithOptions(patch, ['--cached', '--recount'])
        return // Only process first matching hunk for now
      }
    }
    
    // If we get here, no changes were found
    throw new Error(`No changes found in lines ${startLine}-${endLine}`)
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
    
    if (process.env.DEBUG === '1') {
      console.log('Generated patch:')
      console.log(patch)
    }
    
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