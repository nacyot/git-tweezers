import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { execa } from 'execa'

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true })
}

export async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

export async function copyFile(src: string, dest: string): Promise<void> {
  await fs.copyFile(src, dest)
}

export async function isGitRepository(dir: string = process.cwd()): Promise<boolean> {
  try {
    await execa('git', ['rev-parse', '--git-dir'], { cwd: dir })
    return true
  } catch {
    return false
  }
}

export function getHomeDir(): string {
  return homedir()
}

export function getClaudeCommandsDir(global: boolean = false): string {
  if (global) {
    return path.join(getHomeDir(), '.claude', 'commands')
  }
  return path.join(process.cwd(), '.claude', 'commands')
}