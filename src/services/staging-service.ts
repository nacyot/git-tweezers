import { GitWrapper } from '../core/git-wrapper.js'
import { DiffParser, type ParsedHunk } from '../core/diff-parser.js'
import { PatchBuilder } from '../core/patch-builder.js'
import { LineMapper } from '../core/line-mapper.js'
import type { ExtendedLineChange } from '../types/extended-diff.js'
import type { HunkInfo } from '../types/hunk-info.js'
import { HunkCacheService } from './hunk-cache-service.js'
import { StagingError } from '../utils/staging-error.js'
import { logger } from '../utils/logger.js'

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
   * Ensure a file is trackable: reject binary files, auto-add untracked files.
   */
  private async ensureTrackable(filePath: string, operation: string): Promise<void> {
    const isBinary = await this.git.isBinary(filePath)
    if (isBinary) {
      throw new Error(`Cannot ${operation} binary file: ${filePath}`)
    }
    const isUntracked = await this.git.isUntracked(filePath)
    if (isUntracked) {
      await this.git.addIntentToAdd(filePath)
    }
  }

  /**
   * Log the patch and return true if this is a dry-run (caller should return early).
   */
  private dryRunGuard(patch: string, options?: StageOptions): boolean {
    if (options?.dryRun) {
      console.log('Generated patch:')
      console.log(patch)
      console.log('\n[DRY RUN] The above patch would be applied to the staging area.')
      return true
    }
    logger.debug(`Generated patch:\n${patch}`)
    return false
  }

  /**
   * Snapshot index, apply patch, and record history in one step.
   */
  private async commitStaging(
    patch: string,
    applyOptions: string[],
    description: string,
    affectedFiles: string[],
  ): Promise<void> {
    const treeSha = await this.snapshotIndex()
    await this.git.applyWithOptions(patch, applyOptions)
    await this.recordHistory(treeSha, description, affectedFiles)
  }

  /**
   * Throw a StagingError with available hunks info when a selector is not found.
   */
  private throwHunkNotFound(
    message: string, hunks: HunkInfo[], filePath: string, options?: StageOptions
  ): never {
    const mode = options?.precise ? 'precise' : 'normal'
    const modeFlag = options?.precise ? ' -p' : ''
    throw new StagingError(message, hunks, {
      mode: mode as 'normal' | 'precise',
      filePath,
      suggestCommand: `npx git-tweezers list${modeFlag} ${filePath}`,
    })
  }

  /**
   * Get diff for a file, parse it, and find the file entry.
   */
  private async getDiffForFile(filePath: string, context: number) {
    const diff = await this.git.diff(filePath, context)
    if (!diff) {
      throw new Error(`No changes found for file: ${filePath}`)
    }
    const files = this.parser.parseFilesWithInfo(diff)
    const file = files.find(f => f.newPath === filePath || f.oldPath === filePath)
    if (!file) {
      throw new Error(`File not found in diff: ${filePath}`)
    }
    return { file, diff }
  }

  /**
   * List all hunks with full information
   */
  async listHunksWithInfo(filePath: string, options?: StageOptions): Promise<HunkInfo[]> {
    await this.ensureTrackable(filePath, 'list hunks for')

    const context = options?.precise ? 0 : 3
    
    // Get both staged and unstaged diffs
    const { staged, unstaged } = await this.git.getDualLayerDiff(filePath, context)
    
    const allHunks: HunkInfo[] = []
    let index = 1
    
    // Parse staged hunks
    if (staged) {
      const stagedFiles = this.parser.parseFilesWithInfo(staged)
      const stagedFile = stagedFiles.find(f => f.newPath === filePath || f.oldPath === filePath)
      if (stagedFile) {
        const mappedStagedHunks = this.cache.mapHunks(filePath, stagedFile.hunks)
        mappedStagedHunks.forEach(hunk => {
          hunk.index = index++
          hunk.layer = 'staged'
          allHunks.push(hunk)
        })
      }
    }
    
    // Parse unstaged hunks
    if (unstaged) {
      const unstagedFiles = this.parser.parseFilesWithInfo(unstaged)
      const unstagedFile = unstagedFiles.find(f => f.newPath === filePath || f.oldPath === filePath)
      if (unstagedFile) {
        const mappedUnstagedHunks = this.cache.mapHunks(filePath, unstagedFile.hunks)
        mappedUnstagedHunks.forEach(hunk => {
          hunk.index = index++
          hunk.layer = 'unstaged'
          allHunks.push(hunk)
        })
      }
    }
    
    return allHunks
  }

  /**
   * Stage a specific hunk by index (1-based) or ID
   */
  async stageHunk(filePath: string, hunkSelector: number | string, options?: StageOptions): Promise<void> {
    await this.ensureTrackable(filePath, 'stage hunks for')

    const context = options?.precise ? 0 : 3
    const { file } = await this.getDiffForFile(filePath, context)

    // Map hunks with cache
    const hunks = this.cache.mapHunks(filePath, file.hunks)
    
    logger.debug(`Looking for hunk selector: "${hunkSelector}"`)
    logger.debug(`Available hunks: ${JSON.stringify(hunks.map(h => ({ index: h.index, id: h.id })))}`)
    
    // Find the hunk by selector
    const hunk = this.cache.findHunk(hunks, hunkSelector)
    
    if (!hunk) {
      this.throwHunkNotFound(
        `Hunk '${hunkSelector}' not found. File has ${hunks.length} hunk${hunks.length === 1 ? '' : 's'}.`,
        hunks, filePath, options,
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
    if (this.dryRunGuard(patch, options)) return

    const applyOptions = options?.precise ? ['--cached', '--unidiff-zero'] : ['--cached']
    await this.commitStaging(patch, applyOptions, `Stage hunk ${hunkSelector} from ${filePath}`, [filePath])
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
    await this.ensureTrackable(filePath, 'stage lines for')

    // For line-level staging, use U1 for better reliability
    const { file } = await this.getDiffForFile(filePath, 1)
    
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
        logger.debug(`Hunk ${hunk.header}: Selected ${requiredChanges.length} changes`)
        requiredChanges.forEach(c => logger.debug(`  ${c.type}: "${c.content}" (eol: ${c.eol})`))

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
    if (this.dryRunGuard(patch, _options)) return

    await this.commitStaging(patch, ['--cached', '--recount'], `Stage lines ${startLine}-${endLine} from ${filePath}`, [filePath])
  }

  /**
   * Stage multiple hunks at once
   */
  async stageHunks(filePath: string, hunkSelectors: Array<number | string>, options?: StageOptions): Promise<void> {
    await this.ensureTrackable(filePath, 'stage hunks for')

    const context = options?.precise ? 0 : 3
    const { file } = await this.getDiffForFile(filePath, context)

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
      this.throwHunkNotFound(
        `Hunks not found: ${notFoundSelectors.join(', ')}. File has ${hunks.length} hunk${hunks.length === 1 ? '' : 's'}.`,
        hunks, filePath, options,
      )
    }

    // Fast path: if all hunks are selected, use git add (more reliable than patch)
    if (selectedHunks.length === hunks.length && !options?.dryRun) {
      // Snapshot before mutation
      const treeSha = await this.snapshotIndex()

      await this.git.add(filePath)

      // Record in history
      await this.recordHistory(treeSha, `Stage all hunks from ${filePath}`, [filePath])
      return
    }

    // Build combined patch with selected hunks
    const fileData = {
      oldPath: file.oldPath,
      newPath: file.newPath,
      hunks: selectedHunks.map(hunk => ({
        header: hunk.header,
        changes: hunk.changes,
      })),
    }

    const patch = this.builder.buildPatch([fileData])
    if (this.dryRunGuard(patch, options)) return

    // Snapshot before mutation
    const treeSha = await this.snapshotIndex()

    // Try combined patch with --recount first (fast path).
    // --recount tells git to recalculate hunk line counts from actual content,
    // which fixes many cases where headers become stale in multi-hunk patches.
    try {
      const applyOptions = options?.precise
        ? ['--cached', '--unidiff-zero', '--recount']
        : ['--cached', '--recount']
      await this.git.applyWithOptions(patch, applyOptions)
    } catch {
      // Combined patch failed (e.g., overlapping context or offset drift with many hunks).
      // Fall back to sequential per-hunk application with re-diffing between each.
      logger.debug('Combined patch failed, falling back to sequential hunk application')
      await this.stageHunksSequentially(filePath, selectedHunks, file, options)
    }

    // Record in history
    await this.recordHistory(treeSha, `Stage hunks ${hunkSelectors.join(', ')} from ${filePath}`, [filePath])
  }

  /**
   * Fall back to staging hunks one at a time, re-diffing between each application.
   * This mirrors how individual stageHunk() works and handles offset drift caused
   * by earlier hunk applications shifting line numbers for later hunks.
   * Content-based hunk IDs are used for stable lookup across re-diffs.
   */
  private async stageHunksSequentially(
    filePath: string,
    hunks: HunkInfo[],
    fileData: { oldPath: string; newPath: string },
    options?: StageOptions,
  ): Promise<void> {
    const context = options?.precise ? 0 : 3

    // Collect content-based IDs for stable lookup across re-diffs.
    // Content-based IDs survive re-diffing because they are derived from
    // the actual change content, not line numbers.
    const hunkIds = hunks.map(h => h.id)

    for (const id of hunkIds) {
      // Re-diff each time to get fresh line numbers after previous application
      const freshDiff = await this.git.diff(filePath, context)

      if (!freshDiff) {
        logger.debug(`No more changes for ${filePath}, stopping sequential application`)
        break
      }

      const freshFiles = this.parser.parseFilesWithInfo(freshDiff)
      const freshFile = freshFiles.find(f => f.newPath === filePath || f.oldPath === filePath)

      if (!freshFile) {
        logger.debug(`File ${filePath} no longer in diff, stopping sequential application`)
        break
      }

      // Map hunks with cache to get content-based IDs
      const freshHunks = this.cache.mapHunks(filePath, freshFile.hunks)

      // Find hunk by content-based ID (stable across re-diffs)
      const hunk = this.cache.findHunk(freshHunks, id)

      if (!hunk) {
        // Hunk may have been absorbed into an adjacent hunk after a previous
        // application caused git to merge nearby hunks. Skip gracefully.
        logger.debug(`Hunk ${id} no longer found after previous applications, skipping`)
        continue
      }

      const singleFileData = {
        oldPath: freshFile.oldPath || fileData.oldPath,
        newPath: freshFile.newPath || fileData.newPath,
        hunks: [{ header: hunk.header, changes: hunk.changes }],
      }

      const singlePatch = this.builder.buildPatch([singleFileData])

      logger.debug(`Generated patch for hunk ${id}:\n${singlePatch}`)

      const applyOptions = options?.precise
        ? ['--cached', '--unidiff-zero']
        : ['--cached']

      try {
        await this.git.applyWithOptions(singlePatch, applyOptions)
      } catch (error) {
        // Per-hunk error handling: log and continue with remaining hunks
        logger.debug(`Failed to apply hunk ${id}: ${error instanceof Error ? error.message : error}`)
      }
    }
  }

  /**
   * Snapshot the current index state for undo support.
   * Returns a tree SHA or null if conflicts prevent snapshotting.
   */
  private async snapshotIndex(): Promise<string | null> {
    try {
      if (await this.git.hasConflicts()) return null
      return await this.git.writeTree()
    } catch {
      return null
    }
  }

  /**
   * Record a tree-snapshot history entry for undo.
   * Saves the tree SHA as a ref to prevent GC, then records in cache.
   */
  private async recordHistory(treeSha: string | null, description: string, affectedFiles: string[]): Promise<void> {
    if (!treeSha) return
    try {
      await this.git.saveSnapshotRef(treeSha, treeSha)
      this.cache.addTreeHistory({ tree: treeSha, description, affectedFiles })
    } catch {
      // Best-effort: don't fail the staging operation if history recording fails
    }
  }

}