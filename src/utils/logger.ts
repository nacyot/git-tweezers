import chalk from 'chalk'

export enum LogLevel {
  DEBUG,
  INFO,
  SUCCESS,
  WARN,
  ERROR,
}

export class Logger {
  constructor(private level: LogLevel = LogLevel.INFO) {}

  setLevel(level: LogLevel): void {
    this.level = level
  }

  debug(message: string): void {
    if (this.level <= LogLevel.DEBUG) {
      console.error(chalk.gray(`[DEBUG] ${message}`))
    }
  }

  info(message: string): void {
    if (this.level <= LogLevel.INFO) {
      console.error(chalk.blue(`[INFO] ${message}`))
    }
  }

  success(message: string): void {
    if (this.level <= LogLevel.SUCCESS) {
      console.error(chalk.green(`[SUCCESS] ${message}`))
    }
  }

  warn(message: string): void {
    if (this.level <= LogLevel.WARN) {
      console.error(chalk.yellow(`[WARN] ${message}`))
    }
  }

  error(message: string): void {
    if (this.level <= LogLevel.ERROR) {
      console.error(chalk.red(`[ERROR] ${message}`))
    }
  }

  log(message: string): void {
    console.log(message)
  }
}

export const logger = new Logger()
