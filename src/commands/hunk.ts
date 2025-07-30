import { Command, Flags, Args } from '@oclif/core'
import { StagingService } from '../services/staging-service.js'
import { logger, LogLevel } from '../utils/logger.js'
import { StagingError } from '../utils/staging-error.js'
import { parseFileSelector } from '../utils/file-parser.js'

export default class Hunk extends Command {
  static description = 'Stage specific hunks from a file by their numbers'

  static examples = [
    '<%= config.bin %> <%= command.id %> src/index.ts 2',
    '<%= config.bin %> <%= command.id %> src/index.ts:2  # Alternative syntax',
    '<%= config.bin %> <%= command.id %> -p src/index.ts 1  # Use precise mode',
    '<%= config.bin %> <%= command.id %> src/index.ts 1,3,5  # Stage multiple hunks',
    '<%= config.bin %> <%= command.id %> src/file1.ts:1 src/file2.ts:3  # Multiple files',
  ]

  static flags = {
    precise: Flags.boolean({
      char: 'p',
      description: 'Use precise mode (U0 context) for finer control',
      default: false,
    }),
    'dry-run': Flags.boolean({
      char: 'd',
      description: 'Show what would be staged without applying changes',
      default: false,
    }),
  }

  static args = {
    selectors: Args.string({
      description: 'File and hunk selectors (e.g., file.ts:1 or file.ts 1)',
      required: true,
    }),
  }

  static strict = false // Allow multiple arguments

  async run(): Promise<void> {
    const { argv, flags } = await this.parse(Hunk)
    
    const precise = flags.precise
    const dryRun = flags['dry-run']
    
    if (process.env.DEBUG === '1') {
      logger.setLevel(LogLevel.DEBUG)
    }
    
    try {
      const staging = new StagingService(process.cwd())
      
      // Parse arguments to extract file and hunk selectors
      const fileHunks = new Map<string, string[]>()
      
      // Handle both syntaxes:
      // 1. file.ts:1,2,3 or file.ts:abc
      // 2. file.ts 1,2,3 or file.ts 1 2 3
      let i = 0
      while (i < argv.length) {
        const arg = argv[i] as string
        const parsed = parseFileSelector(arg)
        
        if (parsed.selector) {
          // file:selector syntax
          const selectors = parsed.selector.split(',').map(s => s.trim())
          const existing = fileHunks.get(parsed.file) || []
          fileHunks.set(parsed.file, [...existing, ...selectors])
          i++
        } else {
          // This is a file without selector, collect selectors from following args
          const selectors: string[] = []
          let j = i + 1
          
          // Collect all following arguments that look like selectors (not file paths)
          while (j < argv.length) {
            const potentialSelector = argv[j] as string
            // If it looks like a file path (has extension or path separator), stop collecting
            if (potentialSelector.includes('.') || potentialSelector.includes('/') || potentialSelector.includes('\\')) {
              break
            }
            // If it has a colon, it's a file:selector syntax, stop collecting
            if (potentialSelector.includes(':')) {
              break
            }
            // Otherwise, it's a selector
            selectors.push(...potentialSelector.split(',').map(s => s.trim()))
            j++
          }
          
          if (selectors.length === 0) {
            throw new Error(`Invalid syntax: expected hunk selector after ${arg}`)
          }
          
          const existing = fileHunks.get(parsed.file) || []
          fileHunks.set(parsed.file, [...existing, ...selectors])
          i = j // Skip all processed selectors
        }
      }
      
      if (fileHunks.size === 0) {
        throw new Error('No files or hunks specified')
      }
      
      if (precise) {
        logger.info('Using precise mode (U0 context)')
      }
      
      // Stage hunks for each file
      for (const [file, selectors] of fileHunks) {
        if (selectors.length === 1) {
          await staging.stageHunk(file, selectors[0], { precise, dryRun })
          if (!dryRun) {
            logger.success(`Staged hunk ${selectors[0]} from ${file}`)
          }
        } else {
          await staging.stageHunks(file, selectors, { precise, dryRun })
          if (!dryRun) {
            logger.success(`Staged hunks ${selectors.join(', ')} from ${file}`)
          }
        }
      }
      
    } catch (error) {
      if (error instanceof StagingError) {
        // Display formatted error with remaining hunks info
        this.log(error.getFormattedMessage())
      } else {
        logger.error(error instanceof Error ? error.message : String(error))
      }
      this.exit(1)
    }
  }
}