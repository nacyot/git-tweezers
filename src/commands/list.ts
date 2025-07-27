import { Command, Flags, Args } from '@oclif/core'
import chalk from 'chalk'
import { StagingService } from '../services/staging-service.js'
import { logger, LogLevel } from '../utils/logger.js'

export default class List extends Command {
  static description = 'List all hunks in a file'

  static examples = [
    '<%= config.bin %> <%= command.id %> src/index.ts',
    'PRECISE=1 <%= config.bin %> <%= command.id %> src/index.ts',
  ]

  static flags = {
    precise: Flags.boolean({
      char: 'p',
      description: 'Use precise mode (U0 context) for finer control',
      default: false,
    }),
  }

  static args = {
    file: Args.string({
      description: 'File to list hunks from',
      required: true,
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(List)
    
    // Check for PRECISE environment variable
    const precise = flags.precise || process.env.PRECISE === '1'
    
    if (process.env.DEBUG === '1') {
      logger.setLevel(LogLevel.DEBUG)
    }
    
    try {
      const staging = new StagingService()
      const hunks = await staging.listHunks(args.file, { precise })
      
      if (hunks.length === 0) {
        this.log(chalk.yellow(`No changes in ${args.file}`))
        return
      }
      
      this.log(chalk.bold(`Hunks in ${args.file} (${precise ? 'U0' : 'U3'} mode):`))
      this.log('')
      
      hunks.forEach((hunk) => {
        this.log(chalk.green(`${hunk}`))
      })
      
      this.log('')
      this.log(`Use: ${chalk.cyan(`${this.config.bin} hunk ${args.file} <number>`)} to stage a specific hunk`)
      
      if (!precise) {
        this.log(`Tip: Use ${chalk.yellow('PRECISE=1')} for more granular hunks`)
      }
      
    } catch (error) {
      logger.error(error instanceof Error ? error.message : String(error))
      this.exit(1)
    }
  }
}
