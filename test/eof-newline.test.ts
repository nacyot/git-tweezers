import { describe, it, expect } from 'vitest'
import { DiffParser } from '../src/core/diff-parser.js'
import { PatchBuilder } from '../src/core/patch-builder.js'
import { LineMapper } from '../src/core/line-mapper.js'

describe('EOF Newline Handling', () => {
  describe('DiffParser', () => {
    it('should detect lines without newline at EOF', () => {
      const diffText = `diff --git a/test.txt b/test.txt
index 0000000..1234567 100644
--- a/test.txt
+++ b/test.txt
@@ -1,3 +1,3 @@
 Line 1
 Line 2
-Line 3
\\ No newline at end of file
+Line 3 modified
\\ No newline at end of file`
      
      const parser = new DiffParser()
      const files = parser.parseFiles(diffText)
      
      expect(files).to.have.lengthOf(1)
      expect(files[0].hunks).to.have.lengthOf(1)
      
      const hunk = files[0].hunks[0]
      const changes = hunk.changes
      
      // Find the changes for Line 3
      const deletedLine3 = changes.find(c => c.type === 'DeletedLine' && c.content === 'Line 3')
      const addedLine3 = changes.find(c => c.type === 'AddedLine' && c.content === 'Line 3 modified')
      
      expect(deletedLine3).toBeDefined()
      expect(deletedLine3?.eol).toBe(false)
      expect(addedLine3).toBeDefined()
      expect(addedLine3?.eol).toBe(false)
    })
    
    it('should handle files that gain newline at EOF', () => {
      const diffText = `diff --git a/test.txt b/test.txt
index 0000000..1234567 100644
--- a/test.txt
+++ b/test.txt
@@ -1,3 +1,3 @@
 Line 1
 Line 2
-Line 3
\\ No newline at end of file
+Line 3`
      
      const parser = new DiffParser()
      const files = parser.parseFiles(diffText)
      const hunk = files[0].hunks[0]
      
      const deletedLine3 = hunk.changes.find(c => c.type === 'DeletedLine' && c.content === 'Line 3')
      const addedLine3 = hunk.changes.find(c => c.type === 'AddedLine' && c.content === 'Line 3')
      
      expect(deletedLine3?.eol).toBe(false)
      expect(addedLine3?.eol).toBe(true)
    })
    
    it('should handle files that lose newline at EOF', () => {
      const diffText = `diff --git a/test.txt b/test.txt
index 0000000..1234567 100644
--- a/test.txt
+++ b/test.txt
@@ -1,3 +1,3 @@
 Line 1
 Line 2
-Line 3
+Line 3
\\ No newline at end of file`
      
      const parser = new DiffParser()
      const files = parser.parseFiles(diffText)
      const hunk = files[0].hunks[0]
      
      const deletedLine3 = hunk.changes.find(c => c.type === 'DeletedLine' && c.content === 'Line 3')
      const addedLine3 = hunk.changes.find(c => c.type === 'AddedLine' && c.content === 'Line 3')
      
      expect(deletedLine3?.eol).toBe(true)
      expect(addedLine3?.eol).toBe(false)
    })
  })
  
  describe('PatchBuilder', () => {
    it('should preserve no-newline markers in patches', () => {
      const hunk = {
        index: 1,
        header: '@@ -1,3 +1,3 @@',
        oldStart: 1,
        oldLines: 3,
        newStart: 1,
        newLines: 3,
        changes: [
          { type: 'UnchangedLine', content: 'Line 1', eol: true },
          { type: 'UnchangedLine', content: 'Line 2', eol: true },
          { type: 'DeletedLine', content: 'Line 3', eol: false },
          { type: 'AddedLine', content: 'Line 3 modified', eol: false }
        ]
      }
      
      const fileData = {
        oldPath: 'test.txt',
        newPath: 'test.txt',
        hunks: [hunk]
      }
      
      const builder = new PatchBuilder()
      const patch = builder.buildPatch([fileData])
      
      expect(patch).toContain('Line 3 modified')
      expect(patch).toContain('\\ No newline at end of file')
      expect(patch).toMatch(/-Line 3\s*\n\\ No newline at end of file/)
      expect(patch).toMatch(/\+Line 3 modified\s*\n\\ No newline at end of file/)
    })
    
    it('should handle EOF fix patterns correctly', () => {
      const hunk = {
        index: 1,
        header: '@@ -1,3 +1,4 @@',
        oldStart: 1,
        oldLines: 3,
        newStart: 1,
        newLines: 4,
        changes: [
          { type: 'UnchangedLine', content: 'Line 1', eol: true },
          { type: 'UnchangedLine', content: 'Line 2', eol: true },
          { type: 'DeletedLine', content: 'Line 3', eol: false },
          { type: 'AddedLine', content: 'Line 3', eol: true },
          { type: 'AddedLine', content: 'Line 4', eol: false }
        ]
      }
      
      const selectedChanges = [
        hunk.changes[2], // DeletedLine 'Line 3' without EOL
        hunk.changes[3], // AddedLine 'Line 3' with EOL
        hunk.changes[4]  // AddedLine 'Line 4' without EOL
      ]
      
      const fileData = {
        oldPath: 'test.txt',
        newPath: 'test.txt',
        hunks: [hunk]
      }
      
      const builder = new PatchBuilder()
      const patch = builder.buildLinePatch(fileData, selectedChanges, hunk)
      
      // Should include the delete without newline
      expect(patch).toMatch(/-Line 3\s*\n\\ No newline at end of file/)
      // Should include the add with newline
      expect(patch).toContain('+Line 3\n')
      // Should include the final add without newline
      expect(patch).toMatch(/\+Line 4\s*\n\\ No newline at end of file/)
    })
  })
  
  describe('LineMapper', () => {
    it('should detect EOF fix requirements', () => {
      const hunk = {
        index: 1,
        header: '@@ -1,3 +1,4 @@',
        oldStart: 1,
        oldLines: 3,
        newStart: 1,
        newLines: 4,
        changes: [
          { type: 'UnchangedLine', content: 'Line 1', eol: true },
          { type: 'UnchangedLine', content: 'Line 2', eol: true },
          { type: 'DeletedLine', content: 'Line 3', eol: false },
          { type: 'AddedLine', content: 'Line 3', eol: true },
          { type: 'AddedLine', content: 'Line 4', eol: true }
        ]
      }
      
      // When selecting line 4, it should include the EOF fix for line 3
      const required = LineMapper.getRequiredChanges(hunk, new Set([4]))
      
      expect(required).toHaveLength(3)
      expect(required[0].type).toBe('DeletedLine')
      expect(required[0].content).toBe('Line 3')
      expect(required[1].type).toBe('AddedLine')
      expect(required[1].content).toBe('Line 3')
      expect(required[2].type).toBe('AddedLine')
      expect(required[2].content).toBe('Line 4')
    })
    
    it('should map line numbers correctly with EOF changes', () => {
      const hunk = {
        index: 1,
        header: '@@ -1,3 +1,3 @@',
        oldStart: 1,
        oldLines: 3,
        newStart: 1,
        newLines: 3,
        changes: [
          { type: 'UnchangedLine', content: 'Line 1', eol: true },
          { type: 'UnchangedLine', content: 'Line 2', eol: true },
          { type: 'DeletedLine', content: 'Line 3', eol: false },
          { type: 'AddedLine', content: 'Line 3 modified', eol: false }
        ]
      }
      
      const lineMap = LineMapper.mapNewLinesToChanges(hunk)
      
      expect(lineMap.get(1)?.content).toBe('Line 1')
      expect(lineMap.get(2)?.content).toBe('Line 2')
      expect(lineMap.get(3)?.content).toBe('Line 3 modified')
      expect(lineMap.get(3)?.eol).toBe(false)
    })
  })
})