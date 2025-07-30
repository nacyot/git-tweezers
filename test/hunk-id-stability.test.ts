import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execa } from 'execa'
import { StagingService } from '../src/services/staging-service.js'
import { HunkCacheService } from '../src/services/hunk-cache-service.js'
import { StagingError } from '../src/utils/staging-error.js'

describe('Hunk ID Stability Tests', () => {
  let tempDir: string
  let stagingService: StagingService
  let cacheService: HunkCacheService

  beforeEach(async () => {
    // Create temporary directory for test repo
    tempDir = await mkdtemp(join(tmpdir(), 'git-tweezers-id-test-'))
    stagingService = new StagingService(tempDir)
    cacheService = new HunkCacheService(tempDir)
    
    // Initialize git repo
    await execa('git', ['init'], { cwd: tempDir })
    await execa('git', ['config', 'user.name', 'Test User'], { cwd: tempDir })
    await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: tempDir })
    
    // Create initial file
    const filePath = join(tempDir, 'config.js')
    const initialContent = `module.exports = {
  port: process.env.PORT || 3000,
  env: process.env.NODE_ENV || 'development',
  debug: false
}`
    await writeFile(filePath, initialContent)
    await execa('git', ['add', '.'], { cwd: tempDir })
    await execa('git', ['commit', '-m', 'Initial commit'], { cwd: tempDir })
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  describe('ID Stability During Sequential Staging', () => {
    it('should successfully stage multiple hunks by ID sequentially', async () => {
      // Create file with 2 distinct changes far apart
      const filePath = join(tempDir, 'multi.js')
      const lines = Array.from({ length: 20 }, (_, i) => `line${i + 1}`)
      const content = lines.join('\n')
      await writeFile(filePath, content)
      await execa('git', ['add', '.'], { cwd: tempDir })
      await execa('git', ['commit', '-m', 'Add multi'], { cwd: tempDir })
      
      // Modify two separate sections (far apart to ensure separate hunks)
      lines[2] = 'line3-modified'
      lines[15] = 'line16-modified'
      const modified = lines.join('\n')
      await writeFile(filePath, modified)
      
      // Get initial IDs
      const hunks = await stagingService.listHunksWithInfo('multi.js')
      expect(hunks.length).toBe(2)
      const id1 = hunks[0].id
      const id2 = hunks[1].id
      
      // Stage first hunk by ID
      await stagingService.stageHunk('multi.js', id1)
      
      // Stage second hunk by original ID - this should now work!
      await stagingService.stageHunk('multi.js', id2)
      
      // Verify both hunks were staged
      const remainingHunks = await stagingService.listHunksWithInfo('multi.js')
      expect(remainingHunks.length).toBe(0)
    })
    
    it('should maintain stable IDs after staging first hunk', async () => {
      // Modify file to create multiple hunks
      const filePath = join(tempDir, 'config.js')
      const modifiedContent = `module.exports = {
  port: process.env.PORT || 3000,
  host: process.env.HOST || 'localhost',
  env: process.env.NODE_ENV || 'development',
  debug: process.env.DEBUG === 'true',
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    name: process.env.DB_NAME || 'myapp',
    user: process.env.DB_USER || 'appuser',
    password: process.env.DB_PASSWORD
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    format: 'json',
    maxFiles: 10,
    maxSize: '10m'
  },
  security: {
    sessionSecret: process.env.SESSION_SECRET,
    jwtSecret: process.env.JWT_SECRET,
    cookieMaxAge: 86400000
  }
}`
      await writeFile(filePath, modifiedContent)
      
      // Get hunks with precise mode
      const hunksBeforeStaging = await stagingService.listHunksWithInfo('config.js', { precise: true })
      expect(hunksBeforeStaging.length).toBeGreaterThan(1)
      
      // Save IDs before staging
      const firstHunkId = hunksBeforeStaging[0].id
      const secondHunkId = hunksBeforeStaging[1].id
      
      // Stage first hunk
      await stagingService.stageHunk('config.js', firstHunkId, { precise: true })
      
      // Get hunks after staging
      const hunksAfterStaging = await stagingService.listHunksWithInfo('config.js', { precise: true })
      
      // Check if second hunk ID changed
      const remainingHunk = hunksAfterStaging[0]
      
      // IDs should now be stable thanks to content-based fingerprinting
      console.log(`ID comparison: ${secondHunkId} vs ${remainingHunk.id}`)
      expect(remainingHunk.id).toBe(secondHunkId)
    })

    it.skip('should maintain consistent IDs when using hash-based staging', async () => {
      // Create file with multiple distinct changes
      const filePath = join(tempDir, 'server.js')
      const content = `const express = require('express')
const app = express()
const PORT = 3000

app.get('/', (req, res) => {
  res.send('Hello World!')
})

app.listen(PORT, () => {
  console.log(\`Server running on port \${PORT}\`)
})`
      await writeFile(filePath, content)
      await execa('git', ['add', '.'], { cwd: tempDir })
      await execa('git', ['commit', '-m', 'Add server'], { cwd: tempDir })
      
      // Modify to create multiple hunks
      const modified = `const express = require('express')
const app = express()
const PORT = 3000
const logger = require('./logger')  // Add logging

app.get('/', (req, res) => {
  logger.info('Root endpoint accessed')
  res.send('Hello World!')
})

app.get('/api/users', (req, res) => {
  // New endpoint for users
  res.json({ users: [] })
})

app.use((err, req, res, next) => {
  logger.error('Error occurred:', err)
  res.status(500).send('Internal Server Error')
})

app.listen(PORT, () => {
  console.log(\`Server running on port \${PORT}\`)
  logger.info(\`Server started on port \${PORT}\`)
})`
      await writeFile(filePath, modified)
      
      // Get all hunk IDs
      const hunks = await stagingService.listHunksWithInfo('server.js')
      const allIds = hunks.map(h => h.id)
      
      // Try to stage using multiple IDs at once
      // This should work but might fail if IDs are not stable
      for (const id of allIds) {
        const hunksBefore = await stagingService.listHunksWithInfo('server.js')
        const hunkExists = hunksBefore.some(h => h.id === id)
        
        if (hunkExists) {
          await stagingService.stageHunk('server.js', id)
        }
      }
      
      // All hunks should be staged
      const remainingHunks = await stagingService.listHunksWithInfo('server.js')
      expect(remainingHunks.length).toBe(0)
    })
  })

  describe('Mode Consistency Issues', () => {
    it('should detect mode mismatch between list and hunk commands', async () => {
      // Create file with changes that split differently in precise mode
      const filePath = join(tempDir, 'utils.js')
      const content = `function formatDate(date) {
  return date.toISOString().split('T')[0]
}

function parseJSON(str) {
  try {
    return JSON.parse(str)
  } catch (e) {
    return null
  }
}

module.exports = { formatDate, parseJSON }`
      await writeFile(filePath, content)
      await execa('git', ['add', '.'], { cwd: tempDir })
      await execa('git', ['commit', '-m', 'Add utils'], { cwd: tempDir })
      
      // Modify to create changes
      const modified = `// Date utilities
function formatDate(date) {
  return date.toISOString().split('T')[0]
}

function formatDateTime(date) {
  return date.toISOString()
}

// JSON utilities
function parseJSON(str) {
  try {
    return JSON.parse(str)
  } catch (e) {
    console.error('JSON parse error:', e.message)
    return null
  }
}

function stringifyJSON(obj, pretty = false) {
  return pretty ? JSON.stringify(obj, null, 2) : JSON.stringify(obj)
}

module.exports = { 
  formatDate, 
  formatDateTime,
  parseJSON,
  stringifyJSON
}`
      await writeFile(filePath, modified)
      
      // Get hunks in normal mode vs precise mode
      const normalHunks = await stagingService.listHunksWithInfo('utils.js', { precise: false })
      const preciseHunks = await stagingService.listHunksWithInfo('utils.js', { precise: true })
      
      // Should have different number of hunks
      expect(normalHunks.length).not.toBe(preciseHunks.length)
      
      // IDs should be different between modes
      const normalIds = normalHunks.map(h => h.id)
      const preciseIds = preciseHunks.map(h => h.id)
      
      // IDs should be different between modes (this is also a problem!)
      const hasUniqueIds = preciseIds.some(id => !normalIds.includes(id))
      expect(hasUniqueIds).toBe(true)
      
      // Try to use precise mode ID without -p flag (should fail)
      const preciseOnlyId = preciseIds.find(id => !normalIds.includes(id))
      expect(preciseOnlyId).toBeDefined()
      
      // This should throw an error
      let errorThrown = false
      try {
        await stagingService.stageHunk('utils.js', preciseOnlyId!, { precise: false })
      } catch (error) {
        errorThrown = true
        expect(error).toBeInstanceOf(StagingError)
      }
      expect(errorThrown).toBe(true)
    })
  })

  describe('Index vs ID Stability', () => {
    it('should demonstrate why indices are unreliable for sequential staging', async () => {
      // Create file with 3 distinct hunks
      const filePath = join(tempDir, 'api.js')
      const content = Array.from({ length: 30 }, (_, i) => `// Line ${i + 1}`).join('\n')
      await writeFile(filePath, content)
      await execa('git', ['add', '.'], { cwd: tempDir })
      await execa('git', ['commit', '-m', 'Add api'], { cwd: tempDir })
      
      // Modify 3 separate sections
      const lines = content.split('\n')
      lines[5] = '// Line 6 - Modified A'
      lines[15] = '// Line 16 - Modified B'
      lines[25] = '// Line 26 - Modified C'
      await writeFile(filePath, lines.join('\n'))
      
      // Get initial hunks
      const initialHunks = await stagingService.listHunksWithInfo('api.js')
      expect(initialHunks.length).toBe(3)
      
      // Stage by index 1
      await stagingService.stageHunk('api.js', 1)
      
      // Get hunks after first staging
      const afterFirst = await stagingService.listHunksWithInfo('api.js')
      expect(afterFirst.length).toBe(2)
      
      // After staging index 1, what was index 2 becomes index 1
      // The header remains the same, but the index shifted
      expect(afterFirst[0].index).toBe(1)
      expect(afterFirst[1].index).toBe(2)
      
      // But the content is from what was originally index 2
      expect(afterFirst[0].header).toBe(initialHunks[1].header)
      expect(afterFirst[1].header).toBe(initialHunks[2].header)
      
      // Demonstrate the problem: trying to stage "index 2" now stages wrong hunk
      const targetHunk = initialHunks[1] // We want to stage this (was originally index 2)
      
      // If we use index 2 now, we get the wrong hunk
      await stagingService.stageHunk('api.js', 2)
      
      const afterSecond = await stagingService.listHunksWithInfo('api.js')
      expect(afterSecond.length).toBe(1)
      
      // Debug: log what we have
      console.log('Target hunk header:', targetHunk.header)
      console.log('Remaining hunk header:', afterSecond[0].header)
      console.log('Initial hunk 3 header:', initialHunks[2].header)
      
      // We staged index 2, which was originally index 3
      expect(afterSecond[0].header).toBe(initialHunks[1].header)
    })
  })

  describe('Cache-based ID Persistence', () => {
    it('should maintain IDs across multiple list operations', async () => {
      const filePath = join(tempDir, 'test.js')
      const content = 'console.log("hello")'
      await writeFile(filePath, content)
      await execa('git', ['add', '.'], { cwd: tempDir })
      await execa('git', ['commit', '-m', 'Add test'], { cwd: tempDir })
      
      // Modify file
      await writeFile(filePath, 'console.log("hello")\nconsole.log("world")')
      
      // Get hunks multiple times
      const hunks1 = await stagingService.listHunksWithInfo('test.js')
      const hunks2 = await stagingService.listHunksWithInfo('test.js')
      const hunks3 = await stagingService.listHunksWithInfo('test.js')
      
      // IDs should be consistent across calls
      expect(hunks1[0].id).toBe(hunks2[0].id)
      expect(hunks2[0].id).toBe(hunks3[0].id)
      
      // Clear cache and check if IDs change
      cacheService.clearCache()
      const hunks4 = await stagingService.listHunksWithInfo('test.js')
      
      // After cache clear, ID might be different
      // This test documents current behavior
      console.log('ID before cache clear:', hunks1[0].id)
      console.log('ID after cache clear:', hunks4[0].id)
    })
  })
})