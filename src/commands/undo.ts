import { Command, Flags } from '@oclif/core'
import { GitWrapper } from '../core/git-wrapper.js'
import { HunkCacheService } from '../services/hunk-cache-service.js'
import { logger, LogLevel } from '../utils/logger.js'

export default class Undo extends Command {
  static description = 'Undo the last staging operation'

  static examples = [
    '<%= config.bin %> <%= command.id %>  # Undo the most recent staging',
    '<%= config.bin %> <%= command.id %> --step 2  # Undo the 2nd most recent staging',
    '<%= config.bin %> <%= command.id %> --list  # List available undo history',
  ]

  static flags = {
    step: Flags.integer({
      char: 's',
      description: 'Which staging operation to undo (0 = most recent)',
      default: 0,
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
          console.log(`[${index}] ${timeStr} - ${entry.description || 'No description'}`)
        })
        
        return
      }
      
      // Get the history entry to undo
      const entry = cache.getHistoryEntry(flags.step)
      
      if (!entry) {
        if (flags.step === 0) {
          logger.error('No staging history available to undo.')
        } else {
          logger.error(`No staging history at step ${flags.step}.`)
        }
        this.exit(1)
      }
      
      // Apply the reverse patch
      try {
        await git.reverseApplyCached(entry.patch)
        
        // Remove the history entry on successful undo
        cache.removeHistoryEntry(flags.step)
        
        logger.success(`Successfully undid: ${entry.description || 'staging operation'}`)
      } catch (error) {
        logger.error('Failed to undo staging. The working tree may have changed since the staging operation.')
        logger.error('You may need to use "git reset" to manually undo the changes.')
        
        if (process.env.DEBUG === '1' && error instanceof Error) {
          console.error('\nError details:', error.message)
        }
        
        this.exit(1)
      }
      
    } catch (error) {
      logger.error(error instanceof Error ? error.message : String(error))
      this.exit(1)
    }
  }
}