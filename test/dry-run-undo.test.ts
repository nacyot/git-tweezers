import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execa } from 'execa'
import { join } from 'path'
import { rm, mkdir, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { tmpdir } from 'os'

describe('Dry-run and Undo Integration Tests', () => {
  let testDir: string
  let binPath: string

  beforeEach(async () => {
    testDir = join(tmpdir(), `git-tweezers-test-${Date.now()}`)
    await mkdir(testDir, { recursive: true })
    binPath = join(process.cwd(), 'bin', 'run.js')
    
    // Initialize git repo and create test file
    await execa('git', ['init'], { cwd: testDir })
    await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: testDir })
    await execa('git', ['config', 'user.name', 'Test User'], { cwd: testDir })
    
    const testFile = join(testDir, 'test.js')
    await writeFile(testFile, `function add(a, b) {
  return a + b
}

function multiply(x, y) {
  return x * y
}

console.log('test')`)
    
    await execa('git', ['add', '.'], { cwd: testDir })
    await execa('git', ['commit', '-m', 'Initial commit'], { cwd: testDir })
    
    // Make changes for testing
    await writeFile(testFile, `function add(a, b, c) {
  return a + b + c
}

function multiply(x, y) {
  return x * y * 2
}

function divide(a, b) {
  return a / b
}`)
  })

  afterEach(async () => {
    if (existsSync(testDir)) {
      await rm(testDir, { recursive: true, force: true })
    }
  })

  describe('Dry-run mode', () => {
    it('should show patch without applying in dry-run mode', async () => {
      const result = await execa(binPath, ['hunk', 'test.js:1', '--dry-run'], {
        cwd: testDir,
      })
      
      expect(result.stdout).toContain('[DRY RUN]')
      expect(result.stdout).toContain('patch would be applied')
      expect(result.stdout).toContain('diff --git')
      
      // Verify nothing was staged
      const status = await execa('git', ['diff', '--cached'], { cwd: testDir })
      expect(status.stdout).toBe('')
    })

    it('should work with lines command', async () => {
      const result = await execa(binPath, ['lines', 'test.js', '1-3', '--dry-run'], {
        cwd: testDir,
      })
      
      expect(result.stdout).toContain('[DRY RUN]')
      expect(result.stdout).toContain('patch would be applied')
    })
  })

  describe('Undo functionality', () => {
    it('should undo last staging operation', async () => {
      // Stage a hunk
      await execa(binPath, ['hunk', 'test.js:1'], { cwd: testDir })
      
      // Verify it was staged
      let diffCached = await execa('git', ['diff', '--cached'], { cwd: testDir })
      expect(diffCached.stdout).toContain('function add')
      
      // Undo the staging
      const undoResult = await execa(binPath, ['undo'], { cwd: testDir })
      expect(undoResult.stderr).toContain('Successfully undid')
      
      // Verify it was unstaged
      diffCached = await execa('git', ['diff', '--cached'], { cwd: testDir })
      expect(diffCached.stdout).toBe('')
    })

    it('should list staging history', async () => {
      // Stage a hunk
      await execa(binPath, ['hunk', 'test.js:1'], { cwd: testDir })
      
      // List history
      const listResult = await execa(binPath, ['undo', '--list'], { cwd: testDir })
      expect(listResult.stdout).toContain('[0]')
      expect(listResult.stdout).toContain('Stage hunk 1 from test.js')
    })

    it('should handle empty history gracefully', async () => {
      const result = await execa(binPath, ['undo', '--list'], { cwd: testDir })
      expect(result.stderr).toContain('No staging history available')
    })
  })
})