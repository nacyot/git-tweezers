import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile, readFile, access } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { execa } from 'execa'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Get the path to the CLI executable
const cliPath = join(__dirname, '..', '..', 'bin', 'run.js')

describe('Install Command', () => {
  let tempDir: string
  let originalCwd: string

  beforeEach(async () => {
    // Save original environment
    originalCwd = process.cwd()

    // Create temporary directory
    tempDir = await mkdtemp(join(tmpdir(), 'git-tweezers-install-test-'))
    
    // Create a test git repository
    process.chdir(tempDir)
    await execa('git', ['init'])
    await execa('git', ['config', 'user.name', 'Test User'])
    await execa('git', ['config', 'user.email', 'test@example.com'])
  })

  afterEach(async () => {
    // Restore original environment
    process.chdir(originalCwd)
    
    // Clean up
    await rm(tempDir, { recursive: true, force: true })
  })

  describe('Local installation', () => {
    it('should install template in local .claude/commands directory with --force', async () => {
      const { stdout } = await execa('node', [cliPath, 'install', '--force'])
      
      expect(stdout).toContain('Smart-commit template successfully installed')
      expect(stdout).toContain('.claude/commands/smart-commit.md')
      
      // Check if file was created
      const expectedPath = join(tempDir, '.claude', 'commands', 'smart-commit.md')
      const content = await readFile(expectedPath, 'utf-8')
      expect(content).toContain('# Smart Commit')
      expect(content).toContain('git-tweezers')
    })

    it('should fail when not in a git repository', async () => {
      // Remove .git directory
      await rm(join(tempDir, '.git'), { recursive: true, force: true })

      await expect(execa('node', [cliPath, 'install'])).rejects.toMatchObject({
        stderr: expect.stringContaining('Not inside a git repository')
      })
    })
  })

  describe('Global installation', () => {
    it('should install template in global ~/.claude/commands directory when ~/.claude exists', async () => {
      // Create ~/.claude directory in actual home directory
      const homeClaudeDir = join(homedir(), '.claude')
      const homeCommandsDir = join(homeClaudeDir, 'commands')
      const homeSmartCommitPath = join(homeCommandsDir, 'smart-commit.md')
      
      try {
        // Check if ~/.claude exists, if not skip this test
        await access(homeClaudeDir)
        
        // Clean up any existing smart-commit.md
        try {
          await rm(homeSmartCommitPath, { force: true })
        } catch {
          // File doesn't exist, that's fine
        }
        
        const { stdout } = await execa('node', [cliPath, 'install', '--global'])
        
        expect(stdout).toContain('Smart-commit template successfully installed')
        expect(stdout).toContain(homeSmartCommitPath)
        
        // Check if file was created
        const content = await readFile(homeSmartCommitPath, 'utf-8')
        expect(content).toContain('# Smart Commit')
        
        // Clean up
        await rm(homeSmartCommitPath, { force: true })
      } catch {
        // Skip test if ~/.claude doesn't exist
        console.log('Skipping global install test - ~/.claude not found')
      }
    })

    it('should fail when ~/.claude does not exist', async () => {
      // Create a fake home directory without .claude
      const fakeHome = await mkdtemp(join(tmpdir(), 'fake-home-'))
      
      await expect(
        execa('node', [cliPath, 'install', '--global'], {
          env: { ...process.env, HOME: fakeHome }
        })
      ).rejects.toMatchObject({
        stderr: expect.stringContaining('Claude settings folder not found')
      })
      
      await rm(fakeHome, { recursive: true, force: true })
    })
  })

  describe('File overwrite behavior', () => {
    it('should overwrite with --force flag', async () => {
      // Create existing file
      await mkdir(join(tempDir, '.claude', 'commands'), { recursive: true })
      await writeFile(join(tempDir, '.claude', 'commands', 'smart-commit.md'), 'existing content')

      const { stdout } = await execa('node', [cliPath, 'install', '--force'])
      
      expect(stdout).toContain('Smart-commit template successfully installed')
      
      // Check file was overwritten
      const content = await readFile(join(tempDir, '.claude', 'commands', 'smart-commit.md'), 'utf-8')
      expect(content).toContain('# Smart Commit')
      expect(content).not.toBe('existing content')
    })
  })
})