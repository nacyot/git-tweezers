import { Command, Args, Flags } from '@oclif/core'
import chalk from 'chalk'
import { StagingService } from '../services/staging-service.js'
import { logger, LogLevel } from '../utils/logger.js'
import { parseLineRanges, formatRanges } from '../utils/range-parser.js'
import { GitWrapper } from '../core/git-wrapper.js'

export default class Lines extends Command {
  static description = 'Stage specific lines or line ranges from a file'

  static examples = [
    '<%= config.bin %> <%= command.id %> src/index.ts 10-15',
    '<%= config.bin %> <%= command.id %> src/index.ts 25',
    '<%= config.bin %> <%= command.id %> src/index.ts 10-15,20,25-30  # Multiple ranges',
  ]

  static flags = {
    'dry-run': Flags.boolean({
      char: 'd',
      description: 'Show what would be staged without applying changes',
      default: false,
    }),
  }

  static args = {
    file: Args.string({
      description: 'File to stage lines from',
      required: true,
    }),
    range: Args.string({
      description: 'Line range to stage (e.g., 10-15, 10, or 10-15,20,25-30)',
      required: true,
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Lines)
    const dryRun = flags['dry-run']
    
    if (process.env.DEBUG === '1') {
      logger.setLevel(LogLevel.DEBUG)
    }
    
    try {
      const git = new GitWrapper()
      const staging = new StagingService(git.gitRoot)
      
      // Parse line ranges
      const ranges = parseLineRanges(args.range)
      
      if (!dryRun) {
        logger.info(`Staging lines ${formatRanges(ranges)} from ${args.file}`)
      }
      
      // Stage each range
      for (const range of ranges) {
        await staging.stageLines(args.file, range.start, range.end, { dryRun })
      }
      
      if (!dryRun) {
        logger.success(`Staged lines ${formatRanges(ranges)} from ${args.file}`)
        
        // Show summary
        const totalLines = ranges.reduce((sum, range) => sum + (range.end - range.start + 1), 0)
        this.log('')
        this.log(chalk.green('─'.repeat(60)))
        this.log(chalk.green.bold(`✓ Successfully staged ${totalLines} line${totalLines > 1 ? 's' : ''} from ${args.file}`))
        this.log(chalk.green(`  • Lines: ${formatRanges(ranges)}`))
        this.log(chalk.green('─'.repeat(60)))
      }
      
    } catch (error) {
      logger.error(error instanceof Error ? error.message : String(error))
      this.exit(1)
    }
  }
}