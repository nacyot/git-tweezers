import { GitWrapper } from '../core/git-wrapper.js'
import { DiffParser, type ParsedHunk } from '../core/diff-parser.js'
import { PatchBuilder } from '../core/patch-builder.js'
import { LineMapper } from '../core/line-mapper.js'
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
    
    // Collect target line numbers
    const targetLines = new Set<number>()
    for (let line = startLine; line <= endLine; line++) {
      targetLines.add(line)
    }
    
    // Collect all required changes from all hunks
    const allSelectedChanges: ExtendedLineChange[] = []
    
    for (const hunk of file.hunks) {
      const requiredChanges = LineMapper.getRequiredChanges(hunk, targetLines)
      
      if (requiredChanges.length > 0) {
        if (process.env.DEBUG === '1') {
          console.log(`Hunk ${hunk.header}: Selected ${requiredChanges.length} changes`)
          requiredChanges.forEach(c => console.log(`  ${c.type}: "${c.content}" (eol: ${c.eol})`))
        }
        
        allSelectedChanges.push(...requiredChanges)
      }
    }
    
    if (allSelectedChanges.length === 0) {
      throw new Error(`No changes found in lines ${startLine}-${endLine}`)
    }
    
    // Build a single patch with all selected changes
    // Group changes back by hunk for proper patch generation
    const hunkGroups = new Map<ParsedHunk, ExtendedLineChange[]>()
    
    for (const hunk of file.hunks) {
      const hunkChanges = allSelectedChanges.filter(change => 
        hunk.changes.includes(change)
      )
      if (hunkChanges.length > 0) {
        hunkGroups.set(hunk, hunkChanges)
      }
    }
    
    // Build hunks for the patch
    const rebuiltHunks: Array<{ header: string; changes: ExtendedLineChange[] }> = []
    
    for (const [hunk, changes] of hunkGroups) {
      const rebuiltHunk = this.builder.rebuildHunk(hunk, changes)
      rebuiltHunks.push(rebuiltHunk)
    }
    
    // Create final patch
    const fileData = {
      oldPath: file.oldPath,
      newPath: file.newPath,
      hunks: rebuiltHunks,
    }
    
    const patch = this.builder.buildPatch([fileData])
    
    if (process.env.DEBUG === '1') {
      console.log('Generated patch:')
      console.log(patch)
    }
    
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