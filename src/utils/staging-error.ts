import type { HunkInfo } from '../types/hunk-info.js'
import chalk from 'chalk'

export class StagingError extends Error {
  constructor(
    message: string,
    public readonly remainingHunks?: HunkInfo[],
    public readonly context?: {
      mode?: 'normal' | 'precise'
      filePath?: string
      suggestCommand?: string
    }
  ) {
    super(message)
    this.name = 'StagingError'
  }

  /**
   * Format error message with remaining hunks information
   */
  getFormattedMessage(): string {
    let formatted = chalk.red(`[ERROR] ${this.message}`)
    
    // Add context-aware hints
    if (this.context) {
      // Check if this might be a mode mismatch issue
      if (this.message.includes('not found') && this.remainingHunks && this.remainingHunks.length > 0) {
        formatted += '\n\n' + chalk.yellow('⚠️  Possible causes:')
        formatted += '\n' + chalk.yellow('  1. Mode mismatch: list and hunk commands must use the same mode (both normal or both -p)')
        formatted += '\n' + chalk.yellow('  2. File was modified: IDs change when file content changes')
        
        if (this.context.suggestCommand) {
          formatted += '\n\n' + chalk.cyan('Try running:')
          formatted += '\n' + chalk.cyan(`  ${this.context.suggestCommand}`)
        }
      }
    }
    
    if (this.remainingHunks && this.remainingHunks.length > 0) {
      formatted += '\n\n' + chalk.yellow('Available hunks:')
      
      this.remainingHunks.forEach(hunk => {
        const stats = hunk.stats ? ` (+${hunk.stats.additions} -${hunk.stats.deletions})` : ''
        const summary = hunk.summary ? ` | ${hunk.summary}` : ''
        
        formatted += '\n' + chalk.green(`  [${hunk.index}|${hunk.id}] ${hunk.header}${stats}${summary}`)
      })
      
      formatted += '\n\n' + chalk.cyan('Use one of the above IDs or indices to stage a hunk.')
      
      if (this.context?.mode) {
        formatted += '\n' + chalk.dim(`Current mode: ${this.context.mode === 'precise' ? 'precise (-p)' : 'normal'}`)
      }
    }
    
    return formatted
  }
}