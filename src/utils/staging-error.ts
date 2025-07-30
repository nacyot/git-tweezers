import type { HunkInfo } from '../types/hunk-info.js'
import chalk from 'chalk'

export class StagingError extends Error {
  constructor(
    message: string,
    public readonly remainingHunks?: HunkInfo[]
  ) {
    super(message)
    this.name = 'StagingError'
  }

  /**
   * Format error message with remaining hunks information
   */
  getFormattedMessage(): string {
    let formatted = chalk.red(`[ERROR] ${this.message}`)
    
    if (this.remainingHunks && this.remainingHunks.length > 0) {
      formatted += '\n\n' + chalk.yellow('Remaining hunks:')
      
      this.remainingHunks.forEach(hunk => {
        const stats = hunk.stats ? ` (+${hunk.stats.additions} -${hunk.stats.deletions})` : ''
        const summary = hunk.summary ? ` | ${hunk.summary}` : ''
        
        formatted += '\n' + chalk.green(`  [${hunk.index}|${hunk.id}] ${hunk.header}${stats}${summary}`)
      })
      
      formatted += '\n\n' + chalk.cyan('Use one of the above IDs or indices to stage a hunk.')
    }
    
    return formatted
  }
}