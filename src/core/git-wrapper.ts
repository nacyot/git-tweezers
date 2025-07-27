import { execa, type Options as ExecaOptions } from 'execa'

export interface GitOptions extends ExecaOptions {
  cwd?: string
}

export class GitWrapper {
  constructor(private readonly cwd?: string) {}

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
}