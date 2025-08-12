import { execa, execaSync, type Options as ExecaOptions } from 'execa'
import { join } from 'path'

export interface GitOptions extends ExecaOptions {
  cwd?: string
}

export class GitWrapper {
  private repoRoot: string

  constructor(cwd: string = process.cwd()) {
    this.repoRoot = this.getGitRootStatic(cwd)
    this.cwd = this.repoRoot
  }

  private readonly cwd: string

  async execute(args: string[], options?: GitOptions): Promise<string> {
    const result = await execa('git', args, {
      cwd: this.cwd || options?.cwd,
      ...options,
    })
    return typeof result.stdout === 'string' ? result.stdout : ''
  }

  async executeWithInput(args: string[], input: string, options?: GitOptions): Promise<string> {
    const result = await execa('git', args, {
      input,
      cwd: this.cwd || options?.cwd,
      ...options,
    })
    return typeof result.stdout === 'string' ? result.stdout : ''
  }

  async diff(file: string, context = 3): Promise<string> {
    return this.execute(['diff', `-U${context}`, '--', file])
  }

  async diffAll(context = 3): Promise<string> {
    return this.execute(['diff', `-U${context}`])
  }

  async getChangedFiles(): Promise<string[]> {
    const output = await this.execute(['diff', '--name-only'])
    return output.split('\n').filter(line => line.trim())
  }

  async diffCached(file?: string, context = 3): Promise<string> {
    const args = ['diff', '--cached', `-U${context}`]
    if (file) args.push('--', file)
    return this.execute(args)
  }

  async apply(patch: string, cached = true): Promise<void> {
    const args = ['apply']
    if (cached) args.push('--cached')
    args.push('-')
    
    await this.executeWithInput(args, patch)
  }

  async applyWithOptions(patch: string, options: string[]): Promise<void> {
    const args = ['apply', ...options, '-']
    await this.executeWithInput(args, patch)
  }

  async reverseApplyCached(patch: string, options: string[] = []): Promise<void> {
    const args = ['apply', '-R', '--cached', ...options, '-']
    await this.executeWithInput(args, patch)
  }

  async status(short = false): Promise<string> {
    const args = ['status']
    if (short) args.push('--short')
    return this.execute(args)
  }

  async add(files: string | string[]): Promise<void> {
    const fileList = Array.isArray(files) ? files : [files]
    await this.execute(['add', ...fileList])
  }

  async reset(files?: string | string[]): Promise<void> {
    const args = ['reset']
    if (files) {
      const fileList = Array.isArray(files) ? files : [files]
      args.push(...fileList)
    }
    await this.execute(args)
  }

  async isUntracked(file: string): Promise<boolean> {
    try {
      const output = await this.execute(['status', '--porcelain', '--', file])
      // If output starts with '??', the file is untracked
      return output.trim().startsWith('??')
    } catch {
      return false // If status fails, assume file doesn't exist or is tracked
    }
  }

  async addIntentToAdd(file: string): Promise<void> {
    await this.execute(['add', '-N', '--', file])
  }

  async isBinary(file: string): Promise<boolean> {
    try {
      // Check if file is tracked
      const isUntracked = await this.isUntracked(file)
      
      if (isUntracked) {
        // For untracked files, check the working tree version
        // git diff --no-index --numstat /dev/null <file>
        const output = await this.execute(['diff', '--no-index', '--numstat', '/dev/null', file])
        // Binary files show as "- - filename"
        return output.trim().startsWith('-\t-')
      } else {
        // For tracked files, check if git considers it binary
        // git diff --numstat shows binary files as "- - filename"
        const output = await this.execute(['diff', '--numstat', '--', file])
        if (output.trim() === '') {
          // No changes, check the cached version
          const cachedOutput = await this.execute(['diff', '--cached', '--numstat', '--', file])
          return cachedOutput.trim().startsWith('-\t-')
        }
        return output.trim().startsWith('-\t-')
      }
    } catch {
      // If commands fail, assume it's not binary
      return false
    }
  }

  getGitRoot(): string {
    return this.repoRoot
  }

  get gitRoot(): string {
    return this.repoRoot
  }

  static getGitRootStatic(cwd: string): string {
    try {
      const result = execaSync('git', ['rev-parse', '--show-toplevel'], {
        cwd: cwd,
      })
      return result.stdout.trim()
    } catch {
      // Fall back to current directory if git command fails
      return cwd
    }
  }

  private getGitRootStatic(cwd: string): string {
    return GitWrapper.getGitRootStatic(cwd)
  }

  getGitDir(): string {
    try {
      const result = execaSync('git', ['rev-parse', '--git-dir'], {
        cwd: this.cwd,
      })
      const gitDir = result.stdout.trim()
      
      // Debug logging
      if (process.env.DEBUG) {
        console.error(`[GitWrapper.getGitDir] cwd: ${this.cwd}`)
        console.error(`[GitWrapper.getGitDir] gitDir from git: ${gitDir}`)
      }
      
      // If relative path, make it absolute
      if (!gitDir.startsWith('/') && !gitDir.startsWith('\\') && !gitDir.match(/^[A-Z]:/)) {
        const absolutePath = join(this.cwd || process.cwd(), gitDir)
        if (process.env.DEBUG) {
          console.error(`[GitWrapper.getGitDir] made absolute: ${absolutePath}`)
        }
        return absolutePath
      }
      return gitDir
    } catch (error) {
      // Fall back to .git in current directory if git command fails
      if (process.env.DEBUG) {
        console.error(`[GitWrapper.getGitDir] git command failed:`, error)
      }
      return join(this.cwd || process.cwd(), '.git')
    }
  }
}