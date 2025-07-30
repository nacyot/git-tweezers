import { GitWrapper } from '../core/git-wrapper.js'
import { DiffParser, type ParsedHunk } from '../core/diff-parser.js'
import { PatchBuilder } from '../core/patch-builder.js'
import { LineMapper } from '../core/line-mapper.js'
import type { ExtendedLineChange } from '../types/extended-diff.js'
import type { HunkInfo } from '../types/hunk-info.js'
import { HunkCacheService } from './hunk-cache-service.js'
import { StagingError } from '../utils/staging-error.js'

export interface StageOptions {
  precise?: boolean // Use U0 context for finer control
  cwd?: string
  dryRun?: boolean // Show what would be staged without applying
}

export class StagingService {
  private git: GitWrapper
  private parser: DiffParser
  private builder: PatchBuilder
  private cache: HunkCacheService

  constructor(cwd?: string) {
    this.git = new GitWrapper(cwd)
    this.parser = new DiffParser()
    this.builder = new PatchBuilder()
    this.cache = new HunkCacheService(cwd)
  }

  /**
   * List all hunks in a file
   */
  async listHunks(filePath: string, options?: StageOptions): Promise<string[]> {
    const hunks = await this.listHunksWithInfo(filePath, options)
    return hunks.map((hunk) => 
      `Hunk ${hunk.index}: ${hunk.header}`
    )
  }

  /**
   * List all hunks with full information
   */
  async listHunksWithInfo(filePath: string, options?: StageOptions): Promise<HunkInfo[]> {
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
    
    const files = this.parser.parseFilesWithInfo(diff)
    const file = files.find(f => f.newPath === filePath || f.oldPath === filePath)
    
    if (!file) {
      return []
    }
    
    // Map hunks with cache to maintain stable IDs
    return this.cache.mapHunks(filePath, file.hunks)
  }

  /**
   * Stage a specific hunk by index (1-based) or ID
   */
  async stageHunk(filePath: string, hunkSelector: number | string, options?: StageOptions): Promise<void> {
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
    
    const files = this.parser.parseFilesWithInfo(diff)
    const file = files.find(f => f.newPath === filePath || f.oldPath === filePath)
    
    if (!file) {
      throw new Error(`File not found in diff: ${filePath}`)
    }
    
    // Map hunks with cache
    const hunks = this.cache.mapHunks(filePath, file.hunks)
    
    if (process.env.DEBUG === '1') {
      console.log(`Looking for hunk selector: "${hunkSelector}"`)
      console.log(`Available hunks:`, hunks.map(h => ({ index: h.index, id: h.id })))
    }
    
    // Find the hunk by selector
    const hunk = this.cache.findHunk(hunks, hunkSelector)
    
    if (!hunk) {
      throw new StagingError(
        `Hunk '${hunkSelector}' not found. File has ${hunks.length} hunks.`,
        hunks
      )
    }
    
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
    if (process.env.DEBUG === '1' || options?.dryRun) {
      console.log('Generated patch:')
      console.log(patch)
    }
    
    // In dry-run mode, skip applying the patch
    if (options?.dryRun) {
      console.log('\n[DRY RUN] The above patch would be applied to the staging area.')
      return
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
    if (process.env.DEBUG === '1' || _options?.dryRun) {
      console.log('Generated patch:')
      console.log(patch)
    }
    
    // In dry-run mode, skip applying the patch
    if (_options?.dryRun) {
      console.log('\n[DRY RUN] The above patch would be applied to the staging area.')
      return
    }
    // Apply with recount option for better reliability
    await this.git.applyWithOptions(patch, ['--cached', '--recount'])
  }

  /**
   * Stage multiple hunks at once
   */
  async stageHunks(filePath: string, hunkSelectors: Array<number | string>, options?: StageOptions): Promise<void> {
    const context = options?.precise ? 0 : 3
    const diff = await this.git.diff(filePath, context)
    
    if (!diff) {
      throw new Error(`No changes found for file: ${filePath}`)
    }
    
    const files = this.parser.parseFilesWithInfo(diff)
    const file = files.find(f => f.newPath === filePath || f.oldPath === filePath)
    
    if (!file) {
      throw new Error(`File not found in diff: ${filePath}`)
    }
    
    // Map hunks with cache
    const hunks = this.cache.mapHunks(filePath, file.hunks)
    
    // Find all selected hunks
    const selectedHunks: HunkInfo[] = []
    const notFoundSelectors: Array<number | string> = []
    
    for (const selector of hunkSelectors) {
      const hunk = this.cache.findHunk(hunks, selector)
      if (hunk) {
        selectedHunks.push(hunk)
      } else {
        notFoundSelectors.push(selector)
      }
    }
    
    if (notFoundSelectors.length > 0) {
      throw new StagingError(
        `Hunks not found: ${notFoundSelectors.join(', ')}. File has ${hunks.length} hunks.`,
        hunks
      )
    }
    
    // Build patch with selected hunks
    const fileData = {
      oldPath: file.oldPath,
      newPath: file.newPath,
      hunks: selectedHunks.map(hunk => ({
        header: hunk.header,
        changes: hunk.changes,
      })),
    }
    
    const patch = this.builder.buildPatch([fileData])
    
    if (process.env.DEBUG === '1') {
    if (process.env.DEBUG === '1' || options?.dryRun) {
      console.log('Generated patch:')
      console.log(patch)
    }
    
    // In dry-run mode, skip applying the patch
    if (options?.dryRun) {
      console.log('\n[DRY RUN] The above patch would be applied to the staging area.')
      return
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