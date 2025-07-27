import { Command, Args } from '@oclif/core'
import { StagingService } from '../services/staging-service.js'
import { logger, LogLevel } from '../utils/logger.js'

export default class Lines extends Command {
  static description = 'Stage specific lines from a file'

  static examples = [
    '<%= config.bin %> <%= command.id %> src/index.ts 10-15',
    '<%= config.bin %> <%= command.id %> src/index.ts 25',
  ]

  static flags = {}

  static args = {
    file: Args.string({
      description: 'File to stage lines from',
      required: true,
    }),
    range: Args.string({
      description: 'Line range to stage (e.g., 10-15 or 10)',
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
      
      // Parse line range
      let startLine: number
      let endLine: number
      
      if (args.range.includes('-')) {
        const parts = args.range.split('-').map(p => p.trim())
        if (parts.length !== 2) {
          throw new Error(`Invalid line range format: ${args.range}`)
        }
        
        startLine = parseInt(parts[0], 10)
        endLine = parseInt(parts[1], 10)
        
        if (isNaN(startLine) || isNaN(endLine)) {
          throw new Error(`Invalid line numbers in range: ${args.range}`)
        }
        
        if (startLine > endLine) {
          throw new Error(`Invalid range: start line (${startLine}) is greater than end line (${endLine})`)
        }
      } else {
        // Single line
        const line = parseInt(args.range, 10)
        if (isNaN(line)) {
          throw new Error(`Invalid line number: ${args.range}`)
        }
        startLine = line
        endLine = line
      }
      
      // Validate line numbers
      if (startLine < 1) {
        throw new Error(`Line numbers must be positive (got ${startLine})`)
      }
      
      logger.info(`Staging lines ${startLine}-${endLine} from ${args.file}`)
      
      await staging.stageLines(args.file, startLine, endLine)
      
      if (startLine === endLine) {
        logger.success(`Staged line ${startLine} from ${args.file}`)
      } else {
        logger.success(`Staged lines ${startLine}-${endLine} from ${args.file}`)
      }
      
    } catch (error) {
      logger.error(error instanceof Error ? error.message : String(error))
      this.exit(1)
    }
  }
}
