import { Command, Flags, Args } from '@oclif/core'
import { StagingService } from '../services/staging-service.js'
import { logger, LogLevel } from '../utils/logger.js'

export default class Hunk extends Command {
  static description = 'Stage a specific hunk from a file'

  static examples = [
    '<%= config.bin %> <%= command.id %> src/index.ts 2',
    'PRECISE=1 <%= config.bin %> <%= command.id %> src/index.ts 1',
    '<%= config.bin %> <%= command.id %> src/index.ts 1,3,5 # stage multiple hunks',
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
      description: 'File to stage hunk from',
      required: true,
    }),
    indices: Args.string({
      description: 'Hunk index/indices to stage (1-based, comma-separated)',
      required: true,
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Hunk)
    
    // Check for PRECISE environment variable
    const precise = flags.precise || process.env.PRECISE === '1'
    
    if (process.env.DEBUG === '1') {
      logger.setLevel(LogLevel.DEBUG)
    }
    
    try {
      const staging = new StagingService()
      
      // Parse indices (support comma-separated list)
      const indices = args.indices.split(',').map(i => {
        const num = parseInt(i.trim(), 10)
        if (isNaN(num) || num < 1) {
          throw new Error(`Invalid hunk index: ${i}`)
        }
        return num
      })
      
      if (precise) {
        logger.info('Using precise mode (U0 context)')
      }
      
      // Stage hunks
      if (indices.length === 1) {
        await staging.stageHunk(args.file, indices[0], { precise })
        logger.success(`Staged hunk ${indices[0]} from ${args.file}`)
      } else {
        await staging.stageHunks(args.file, indices, { precise })
        logger.success(`Staged hunks ${indices.join(', ')} from ${args.file}`)
      }
      
    } catch (error) {
      logger.error(error instanceof Error ? error.message : String(error))
      this.exit(1)
    }
  }
}
