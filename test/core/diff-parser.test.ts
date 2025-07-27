import { describe, it, expect } from 'vitest'
import { DiffParser } from '../../src/core/diff-parser.js'

describe('DiffParser', () => {
  const parser = new DiffParser()

  const sampleDiff = `diff --git a/src/index.ts b/src/index.ts
index 1234567..abcdefg 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,6 +1,7 @@
 import { foo } from './foo'
+import { bar } from './bar'
 
 export function main() {
-  console.log('Hello')
+  console.log('Hello World')
   return foo()
 }`

  const multiHunkDiff = `diff --git a/src/index.ts b/src/index.ts
index 1234567..abcdefg 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,4 @@
 import { foo } from './foo'
+import { bar } from './bar'
 
 export function main() {
@@ -10,5 +11,5 @@ export function test() {
   return true
 }
 
-console.log('end')
+console.log('end of file')`

  describe('parse', () => {
    it('should parse a simple diff', () => {
      const result = parser.parse(sampleDiff)
      expect(result.files).toHaveLength(1)
      expect(result.files[0].path).toBe('src/index.ts')
      expect(result.files[0].chunks).toHaveLength(1)
    })

    it('should parse changes correctly', () => {
      const result = parser.parse(sampleDiff)
      const changes = result.files[0].chunks[0].changes
      
      // Should have context, addition, context, deletion, addition, context lines
      expect(changes.length).toBeGreaterThan(0)
      
      const additions = changes.filter(c => c.type === 'AddedLine')
      const deletions = changes.filter(c => c.type === 'DeletedLine')
      
      expect(additions).toHaveLength(2) // Two lines added
      expect(deletions).toHaveLength(1) // One line deleted
    })
  })

  describe('parseFiles', () => {
    it('should parse files with hunk metadata', () => {
      const files = parser.parseFiles(sampleDiff)
      expect(files).toHaveLength(1)
      
      const file = files[0]
      expect(file.oldPath).toBe('src/index.ts') // This is from our parseFiles method
      expect(file.hunks).toHaveLength(1)
      
      const hunk = file.hunks[0]
      expect(hunk.index).toBe(1)
      expect(hunk.header).toContain('@@')
      expect(hunk.oldStart).toBe(1)
      expect(hunk.oldLines).toBe(6)
      expect(hunk.newStart).toBe(1)
      expect(hunk.newLines).toBe(7)
    })

    it('should handle multiple hunks', () => {
      const files = parser.parseFiles(multiHunkDiff)
      expect(files).toHaveLength(1)
      expect(files[0].hunks).toHaveLength(2)
      
      const [hunk1, hunk2] = files[0].hunks
      expect(hunk1.index).toBe(1)
      expect(hunk2.index).toBe(2)
    })
  })

  describe('getHunkCount', () => {
    it('should count hunks correctly', () => {
      expect(parser.getHunkCount(sampleDiff)).toBe(1)
      expect(parser.getHunkCount(multiHunkDiff)).toBe(2)
    })

    it('should return 0 for empty diff', () => {
      expect(parser.getHunkCount('')).toBe(0)
    })
  })

  describe('getFileHunkCount', () => {
    it('should count hunks for specific file', () => {
      expect(parser.getFileHunkCount(sampleDiff, 'src/index.ts')).toBe(1)
      expect(parser.getFileHunkCount(multiHunkDiff, 'src/index.ts')).toBe(2)
    })

    it('should return 0 for non-existent file', () => {
      expect(parser.getFileHunkCount(sampleDiff, 'not-found.ts')).toBe(0)
    })
  })

  describe('extractHunk', () => {
    it('should extract specific hunk', () => {
      const hunk = parser.extractHunk(multiHunkDiff, 'src/index.ts', 1)
      expect(hunk).not.toBeNull()
      expect(hunk?.index).toBe(1)
      expect(hunk?.newStart).toBe(1)
    })

    it('should return null for invalid hunk index', () => {
      expect(parser.extractHunk(sampleDiff, 'src/index.ts', 0)).toBeNull()
      expect(parser.extractHunk(sampleDiff, 'src/index.ts', 2)).toBeNull()
    })
  })
})