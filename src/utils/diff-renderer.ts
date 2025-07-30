import chalk from 'chalk'
import type { HunkInfo } from '../types/hunk-info.js'
import type { ExtendedLineChange } from '../types/extended-diff.js'

export interface RenderOptions {
  context?: number
  maxLines?: number
  color?: boolean
}

export class DiffRenderer {
  /**
   * Render a hunk with optional context lines
   */
  renderHunk(hunk: HunkInfo, options: RenderOptions = {}): string {
    const { context = 3, maxLines = 120, color = true } = options
    const lines: string[] = []
    
    let displayedLines = 0
    let inContext = false
    let contextCount = 0
    
    for (let i = 0; i < hunk.changes.length; i++) {
      const change = hunk.changes[i]
      
      // Check if we should show this line
      if (change.type === 'UnchangedLine') {
        // Show context lines around actual changes
        const hasChangeBefore = this.hasChangeWithin(hunk.changes, i, -context)
        const hasChangeAfter = this.hasChangeWithin(hunk.changes, i, context)
        
        if (hasChangeBefore || hasChangeAfter) {
          inContext = true
          contextCount = 0
        } else if (inContext) {
          contextCount++
          if (contextCount > context) {
            inContext = false
            continue
          }
        } else {
          continue
        }
      } else {
        inContext = true
        contextCount = 0
      }
      
      // Render the line
      const line = this.renderLine(change, color)
      lines.push(line)
      displayedLines++
      
      // Check if we've hit the max lines limit
      if (displayedLines >= maxLines && i < hunk.changes.length - 1) {
        lines.push(chalk.dim('... (truncated)'))
        break
      }
    }
    
    return lines.join('\n')
  }
  
  /**
   * Render a single line change
   */
  private renderLine(change: ExtendedLineChange, color: boolean): string {
    const prefix = this.getPrefix(change.type)
    const content = change.content
    
    if (!color) {
      return prefix + content
    }
    
    switch (change.type) {
      case 'AddedLine':
        return chalk.green(prefix + content)
      case 'DeletedLine':
        return chalk.red(prefix + content)
      case 'UnchangedLine':
        return chalk.dim(prefix + content)
      default:
        return prefix + content
    }
  }
  
  /**
   * Get the prefix character for a change type
   */
  private getPrefix(type: string): string {
    switch (type) {
      case 'AddedLine':
        return '+'
      case 'DeletedLine':
        return '-'
      case 'UnchangedLine':
        return ' '
      default:
        return ' '
    }
  }
  
  /**
   * Check if there's a change within the given distance
   */
  private hasChangeWithin(changes: ExtendedLineChange[], index: number, distance: number): boolean {
    const start = Math.max(0, index + (distance < 0 ? distance : 0))
    const end = Math.min(changes.length, index + (distance > 0 ? distance + 1 : 1))
    
    for (let i = start; i < end; i++) {
      if (i !== index && changes[i].type !== 'UnchangedLine') {
        return true
      }
    }
    
    return false
  }
  
  /**
   * Render a summary for a hunk (for inline display)
   */
  renderHunkSummary(hunk: HunkInfo): string {
    const stats = hunk.stats
    if (!stats) return ''
    
    const parts: string[] = []
    
    if (stats.additions > 0) {
      parts.push(chalk.green(`+${stats.additions}`))
    }
    if (stats.deletions > 0) {
      parts.push(chalk.red(`-${stats.deletions}`))
    }
    
    if (hunk.summary) {
      parts.push(chalk.dim(`| ${hunk.summary}`))
    }
    
    return parts.join(' ')
  }
}