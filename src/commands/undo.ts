import { Command, Flags } from '@oclif/core'
import { GitWrapper } from '../core/git-wrapper.js'
import { HunkCacheService, isTreeEntry, isLegacyEntry, getEntryDescription } from '../services/hunk-cache-service.js'
import { logger, LogLevel } from '../utils/logger.js'

export default class Undo extends Command {
  static description = 'Undo staging operations'

  static examples = [
    '<%= config.bin %> <%= command.id %>  # Undo the most recent staging',
    '<%= config.bin %> <%= command.id %> --step 2  # Undo the 2nd most recent staging',
    '<%= config.bin %> <%= command.id %> --count 3  # Undo the last 3 staging operations',
    '<%= config.bin %> <%= command.id %> --all  # Undo all staging operations',
    '<%= config.bin %> <%= command.id %> --list  # List available undo history',
  ]

  static flags = {
    step: Flags.integer({
      char: 's',
      description: 'Which staging operation to undo (0 = most recent)',
      default: 0,
    }),
    count: Flags.integer({
      char: 'n',
      description: 'Number of staging operations to undo (from most recent)',
    }),
    all: Flags.boolean({
      char: 'a',
      description: 'Undo all staging operations in history',
      default: false,
    }),
    list: Flags.boolean({
      char: 'l',
      description: 'List available undo history',
      default: false,
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(Undo)

    if (process.env.DEBUG === '1') {
      logger.setLevel(LogLevel.DEBUG)
    }

    try {
    const git = new GitWrapper()
    const cache = new HunkCacheService(git.gitRoot)

    // Handle list flag
    if (flags.list) {
      const history = cache.getHistory()

      if (history.length === 0) {
        logger.info('No staging history available.')
        return
      }

      logger.info('Available undo history:')
      history.forEach((entry, index) => {
        const date = new Date(entry.timestamp)
        const timeStr = date.toLocaleString()
        const typeTag = isTreeEntry(entry) ? '' : ' [legacy]'
        const desc = getEntryDescription(entry)
        this.log(`[${index}] ${timeStr} - ${desc}${typeTag}`)
      })

      return
    }

    // Determine how many operations to undo
    let undoCount = 1
    if (flags.all) {
      undoCount = cache.getHistory().length
      if (undoCount === 0) {
        logger.error('No staging history available to undo.')
        process.exitCode = 1
        return
      }
    } else if (flags.count !== undefined) {
      undoCount = flags.count
      if (undoCount < 1) {
        logger.error('Count must be at least 1.')
        process.exitCode = 1
        return
      }
      const available = cache.getHistory().length
      if (undoCount > available) {
        logger.error(`Requested ${undoCount} undos but only ${available} operation${available === 1 ? '' : 's'} in history.`)
        process.exitCode = 1
        return
      }
    }

    // For single undo with --step (original behavior)
    if (!flags.all && flags.count === undefined) {
      const entry = cache.getHistoryEntry(flags.step)

      if (!entry) {
        if (flags.step === 0) {
          logger.error('No staging history available to undo.')
        } else {
          logger.error(`No staging history at step ${flags.step}.`)
        }
        process.exitCode = 1
        return
      }

      const ok = await this.undoEntry(git, entry)
      if (ok) {
        cache.removeHistoryEntry(flags.step)
        logger.success(`Successfully undid: ${getEntryDescription(entry)}`)
      } else {
        process.exitCode = 1
      }

      return
    }

    // Multi-undo: always undo from index 0 (most recent) since entries shift
    let successCount = 0
    let failCount = 0

    for (let i = 0; i < undoCount; i++) {
      const entry = cache.getHistoryEntry(0) // Always get the most recent
      if (!entry) break

      const ok = await this.undoEntry(git, entry)
      if (ok) {
        cache.removeHistoryEntry(0)
        successCount++
        logger.success(`[${i + 1}/${undoCount}] Undid: ${getEntryDescription(entry)}`)
      } else {
        failCount++
        logger.error(`[${i + 1}/${undoCount}] Failed to undo: ${getEntryDescription(entry)}`)
        // Stop on first failure since subsequent operations may depend on this state
        break
      }
    }

    if (failCount > 0) {
      logger.error(`Completed ${successCount}/${undoCount} undo operations. Stopped due to failure.`)
      process.exitCode = 1
    } else {
      logger.success(`Successfully undid ${successCount} staging operation${successCount === 1 ? '' : 's'}.`)
    }
    } catch (error) {
      logger.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    }
  }

  /**
   * Undo a single history entry. Returns true on success.
   */
  private async undoEntry(
    git: GitWrapper,
    entry: ReturnType<HunkCacheService['getHistoryEntry']> & {},
  ): Promise<boolean> {
    if (isTreeEntry(entry)) {
      return this.undoTreeEntry(git, entry)
    }
    if (isLegacyEntry(entry)) {
      return this.undoLegacyEntry(git, entry)
    }
    logger.error('Unknown history entry type')
    return false
  }

  /**
   * Undo via tree-snapshot restore (new, robust approach).
   */
  private async undoTreeEntry(
    git: GitWrapper,
    entry: { tree: string; id: string; description: string },
  ): Promise<boolean> {
    try {
      // Verify the tree object still exists
      const ref = await git.loadSnapshotRef(entry.tree)
      const treeSha = ref || entry.tree

      // Restore the index to the snapshot state
      await git.readTree(treeSha)

      // Clean up the ref
      await git.dropSnapshotRef(entry.tree)

      return true
    } catch (error) {
      logger.error('Failed to restore index snapshot.')
      if (error instanceof Error) {
        logger.debug(`Error details: ${error.message}`)
      }
      logger.error('The snapshot may have been garbage collected. Use "git reset" to manually undo.')
      return false
    }
  }

  /**
   * Undo via legacy reverse-apply (for old history entries).
   */
  private async undoLegacyEntry(
    git: GitWrapper,
    entry: { patch: string },
  ): Promise<boolean> {
    try {
      // Detect if patch needs --unidiff-zero (U0 format)
      const needsUnidiffZero = this.patchNeedsUnidiffZero(entry.patch)
      const options = needsUnidiffZero ? ['--unidiff-zero'] : []

      await git.reverseApplyCached(entry.patch, options)
      return true
    } catch (error) {
      logger.warn('This undo entry was created by an older version and may not replay cleanly.')
      logger.error('Failed to undo staging. Use "git reset" to manually undo the changes.')
      if (error instanceof Error) {
        logger.debug(`Error details: ${error.message}`)
      }
      return false
    }
  }

  /**
   * Check if a patch contains U0 (zero-context) hunk headers that need --unidiff-zero.
   * U0 patches can have line counts of 0 (e.g., @@ -5,0 +6,2 @@) which are invalid
   * in standard unified diff format.
   */
  private patchNeedsUnidiffZero(patch: string): boolean {
    // Match hunk headers where old or new line count is 0
    return /^@@ -\d+,0 \+\d+,\d+ @@/m.test(patch) ||
           /^@@ -\d+,\d+ \+\d+,0 @@/m.test(patch)
  }
}
