import { Command, Args } from '@oclif/core'
import { StagingService } from '../services/staging-service.js'
import { logger, LogLevel } from '../utils/logger.js'
import { parseLineRanges, formatRanges } from '../utils/range-parser.js'

export default class Lines extends Command {
  static description = 'Stage specific lines from a file'

  static examples = [
    '<%= config.bin %> <%= command.id %> src/index.ts 10-15',
    '<%= config.bin %> <%= command.id %> src/index.ts 25',
    '<%= config.bin %> <%= command.id %> src/index.ts 10-15,20,25-30',
  ]

  static flags = {}

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
    const { args } = await this.parse(Lines)
    
    if (process.env.DEBUG === '1') {
      logger.setLevel(LogLevel.DEBUG)
    }
    
    try {
      const staging = new StagingService()
      
      // Parse line ranges
      const ranges = parseLineRanges(args.range)
      
      logger.info(`Staging lines ${formatRanges(ranges)} from ${args.file}`)
      
      // Stage each range
      for (const range of ranges) {
        await staging.stageLines(args.file, range.start, range.end)
      }
      
      logger.success(`Staged lines ${formatRanges(ranges)} from ${args.file}`)
      
    } catch (error) {
      logger.error(error instanceof Error ? error.message : String(error))
      this.exit(1)
    }
  }
}