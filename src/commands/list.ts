import { Command, Flags, Args } from '@oclif/core'
import chalk from 'chalk'
import { StagingService } from '../services/staging-service.js'
import { logger, LogLevel } from '../utils/logger.js'
import { DiffRenderer } from '../utils/diff-renderer.js'
import { GitWrapper } from '../core/git-wrapper.js'

export default class List extends Command {
  static description = 'List all hunks in a file with their line numbers'

  static examples = [
    '<%= config.bin %> <%= command.id %>  # List all changed files',
    '<%= config.bin %> <%= command.id %> src/index.ts  # List hunks in specific file',
    '<%= config.bin %> <%= command.id %> src/*.ts  # List hunks in multiple files',
    '<%= config.bin %> <%= command.id %> -p src/index.ts  # Use precise mode for smaller hunks',
    '<%= config.bin %> <%= command.id %> --preview  # Show diff preview for each hunk',
  ]

  static flags = {
    precise: Flags.boolean({
      char: 'p',
      description: 'Use precise mode (U0 context) for finer control',
      default: false,
    }),
    preview: Flags.boolean({
      description: 'Show full diff preview for each hunk (legacy flag, now default behavior)',
      default: false,
      hidden: true,
    }),
    inline: Flags.boolean({
      char: 'i',
      description: 'Show inline summary with stats and first changed line',
      default: false,
    }),
    oneline: Flags.boolean({
      char: 'o',
      description: 'Show only hunk headers without preview (like git log --oneline)',
      default: false,
    }),
    context: Flags.integer({
      char: 'c',
      description: 'Number of context lines to show in preview',
      default: 3,
    }),
  }

  static args = {
    files: Args.string({
      description: 'Files to list hunks from (omit to show all)',
      required: false,
    }),
  }

  static strict = false // Allow multiple files

  async run(): Promise<void> {
    const { argv, flags } = await this.parse(List)
    
    const precise = flags.precise
    
    if (process.env.DEBUG === '1') {
      logger.setLevel(LogLevel.DEBUG)
    }
    
    try {
      const staging = new StagingService()
      const renderer = new DiffRenderer()
      const git = new GitWrapper()
      
      // Get files to process
      let files: string[]
      if (argv.length === 0) {
        // No files specified, get all changed files
        files = await git.getChangedFiles()
        if (files.length === 0) {
          this.log(chalk.yellow('No changes found in repository'))
          return
        }
      } else {
        // Use specified files
        files = argv as string[]
      }
      
      // New behavior: show preview by default unless --oneline is used
      // Legacy --preview flag is also respected if explicitly used
      const showPreview = flags.preview || (!flags.oneline && !flags.inline)
      const showInline = flags.inline || (flags.oneline && !flags.preview)
      let hasChanges = false
      
      for (const file of files) {
        try {
          const hunks = await staging.listHunksWithInfo(file, { precise })
          
          if (hunks.length === 0) {
            continue
          }
          
          hasChanges = true
          
          // Show file header
          this.log(chalk.bold.blue(`\n${file}:`))
          
          hunks.forEach((hunk) => {
            // Format: [index|id] header (stats) | summary
            let line = chalk.green(`  [${hunk.index}|${hunk.id}] ${hunk.header}`)
            
            if (showInline) {
              const summary = renderer.renderHunkSummary(hunk)
              if (summary) {
                line += ' ' + summary
              }
            }
            
            this.log(line)
            
            if (showPreview) {
              const preview = renderer.renderHunk(hunk, { context: flags.context })
              if (preview) {
                const indentedPreview = preview.split('\n').map(l => '    ' + l).join('\n')
                this.log(indentedPreview)
                this.log('') // Empty line between hunks
              }
            }
          })
        } catch (error) {
          // Skip files that can't be processed (e.g., binary files)
          if (process.env.DEBUG === '1') {
            logger.debug(`Skipping ${file}: ${error}`)
          }
        }
      }
      
      if (!hasChanges) {
        this.log(chalk.yellow('No changes found in specified files'))
        return
      }
      
      this.log('')
      this.log(chalk.dim('─'.repeat(60)))
      this.log(`Use: ${chalk.cyan(`${this.config.bin} hunk <file>:<number|id>`)} to stage a specific hunk`)
      this.log(`     ${chalk.cyan(`${this.config.bin} hunk <file> <number|id>`)} (original syntax)`)
      
      if (!precise) {
        this.log(`\nTip: Use ${chalk.yellow('-p')} or ${chalk.yellow('--precise')} for more granular hunks`)
      }
      
    } catch (error) {
      logger.error(error instanceof Error ? error.message : String(error))
      this.exit(1)
    }
  }
}