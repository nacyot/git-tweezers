import { Command, Flags } from '@oclif/core'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import readline from 'node:readline'
import chalk from 'chalk'
import {
  copyFile,
  ensureDir,
  fileExists,
  getClaudeCommandsDir,
  isGitRepository,
} from '../utils/fs.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

async function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  return new Promise((resolve) => {
    rl.question(`${question} (y/n) `, (answer) => {
      rl.close()
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes')
    })
  })
}

export default class Install extends Command {
  static description = 'Install smart-commit template for Claude Code custom commands'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --global',
    '<%= config.bin %> <%= command.id %> --force',
  ]

  static flags = {
    global: Flags.boolean({
      char: 'g',
      description: 'Install in global ~/.claude/commands directory',
      default: false,
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Overwrite existing file without prompting',
      default: false,
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(Install)

    // Check if we're in a git repository (only for local install)
    if (!flags.global && !(await isGitRepository())) {
      this.error('Not inside a git repository. Use --global flag to install globally.')
    }

    // For global install, check if ~/.claude exists
    if (flags.global) {
      const homeDir = process.env.HOME || process.env.USERPROFILE || ''
      const claudeDir = path.join(homeDir, '.claude')
      if (!(await fileExists(claudeDir))) {
        this.error('Claude settings folder not found. Please ensure Claude Code is installed and configured.')
      }
    }

    // Resolve source file
    const sourceFile = path.join(__dirname, '..', '..', 'smart-commit.md')
    if (!(await fileExists(sourceFile))) {
      this.error(`Template file not found: ${sourceFile}`)
    }

    // Determine destination
    const destDir = getClaudeCommandsDir(flags.global)
    const destFile = path.join(destDir, 'smart-commit.md')

    // Create directory if needed
    if (!(await fileExists(destDir))) {
      if (!flags.global && !flags.force) {
        const create = await confirm(
          `Directory ${chalk.cyan(destDir)} doesn't exist. Create it?`
        )
        if (!create) {
          this.log('Installation cancelled.')
          return
        }
      }
      await ensureDir(destDir)
      if (!flags.global) {
        this.log(`Created directory: ${chalk.green(destDir)}`)
      }
    }

    // Check for existing file
    if (await fileExists(destFile)) {
      if (!flags.force) {
        const overwrite = await confirm(
          `File ${chalk.yellow('smart-commit.md')} already exists. Overwrite?`
        )
        if (!overwrite) {
          this.log('Installation cancelled. Use --force to overwrite.')
          return
        }
      }
    }

    // Copy file
    try {
      await copyFile(sourceFile, destFile)
      this.log()
      this.log(chalk.green('✓ Smart-commit template successfully installed!'))
      this.log()
      this.log(`${chalk.bold('Installation path:')}`)
      this.log(`  ${chalk.cyan(destFile)}`)
      this.log()
      this.log(`${chalk.bold('Usage:')}`)
      this.log(`  Use ${chalk.cyan('/smart-commit')} in Claude Code to create logical commits`)
      this.log()
      this.log(`${chalk.bold('Customization:')}`)
      this.log(`  You can edit the template file directly to customize it for your workflow`)
      this.log(`  ${chalk.dim(destFile)}`)
    } catch (error) {
      this.error(`Failed to copy file: ${error}`)
    }
  }
}