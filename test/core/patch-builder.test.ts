import { describe, it, expect } from 'vitest'
import { PatchBuilder } from '../../src/core/patch-builder.js'
import type { FileData } from '../../src/core/patch-builder.js'

describe('PatchBuilder', () => {
  const builder = new PatchBuilder()

  const sampleFile: FileData = {
    oldPath: 'src/index.ts',
    newPath: 'src/index.ts',
    hunks: [
      {
        header: '@@ -1,3 +1,4 @@',
        changes: [
          { type: 'UnchangedLine', content: 'import { foo } from \'./foo\'', lineBefore: 1, lineAfter: 1 },
          { type: 'AddedLine', content: 'import { bar } from \'./bar\'', lineAfter: 2 },
          { type: 'UnchangedLine', content: '', lineBefore: 2, lineAfter: 3 },
          { type: 'UnchangedLine', content: 'export function main() {', lineBefore: 3, lineAfter: 4 },
        ],
      },
    ],
  }

  describe('buildPatch', () => {
    it('should build a valid patch', () => {
      const patch = builder.buildPatch([sampleFile])
      
      expect(patch).toContain('diff --git a/src/index.ts b/src/index.ts')
      expect(patch).toContain('--- a/src/index.ts')
      expect(patch).toContain('+++ b/src/index.ts')
      expect(patch).toContain('@@ -1,3 +1,4 @@')
      expect(patch).toContain('+import { bar } from \'./bar\'')
    })

    it('should handle multiple files', () => {
      const file2: FileData = {
        oldPath: 'src/foo.ts',
        newPath: 'src/foo.ts',
        hunks: [
          {
            header: '@@ -10,2 +10,2 @@',
            changes: [
              { type: 'DeletedLine', content: '  old line', lineBefore: 10 },
              { type: 'AddedLine', content: '  new line', lineAfter: 10 },
            ],
          },
        ],
      }
      
      const patch = builder.buildPatch([sampleFile, file2])
      
      expect(patch).toContain('diff --git a/src/index.ts b/src/index.ts')
      expect(patch).toContain('diff --git a/src/foo.ts b/src/foo.ts')
    })
  })

  describe('buildHunkPatch', () => {
    it('should build patch for specific hunk', () => {
      const multiHunkFile: FileData = {
        ...sampleFile,
        hunks: [
          sampleFile.hunks[0],
          {
            header: '@@ -10,3 +11,3 @@',
            changes: [
              { type: 'UnchangedLine', content: '  return true', lineBefore: 11, lineAfter: 11 },
              { type: 'DeletedLine', content: '  console.log(\'old\')', lineBefore: 12 },
              { type: 'AddedLine', content: '  console.log(\'new\')', lineAfter: 12 },
            ],
          },
        ],
      }
      
      const patch = builder.buildHunkPatch(multiHunkFile, 1)
      expect(patch).not.toBeNull()
      expect(patch).toContain('@@ -10,3 +11,3 @@')
      expect(patch).not.toContain('@@ -1,3 +1,4 @@')
    })

    it('should return null for invalid hunk index', () => {
      expect(builder.buildHunkPatch(sampleFile, -1)).toBeNull()
      expect(builder.buildHunkPatch(sampleFile, 2)).toBeNull()
    })
  })

  describe('calculateHunkHeader', () => {
    it('should calculate correct header for additions only', () => {
      const changes = [
        { type: 'AddedLine' as const, content: 'line1', lineAfter: 1 },
        { type: 'AddedLine' as const, content: 'line2', lineAfter: 2 },
      ]
      
      const header = builder.calculateHunkHeader(changes, 10, 10)
      expect(header).toBe('@@ -10,0 +10,2 @@')
    })

    it('should calculate correct header for deletions only', () => {
      const changes = [
        { type: 'DeletedLine' as const, content: 'line1', lineBefore: 1 },
        { type: 'DeletedLine' as const, content: 'line2', lineBefore: 2 },
      ]
      
      const header = builder.calculateHunkHeader(changes, 10, 10)
      expect(header).toBe('@@ -10,2 +10,0 @@')
    })

    it('should calculate correct header for mixed changes', () => {
      const changes = [
        { type: 'UnchangedLine' as const, content: 'context', lineBefore: 1, lineAfter: 1 },
        { type: 'DeletedLine' as const, content: 'old', lineBefore: 2 },
        { type: 'AddedLine' as const, content: 'new', lineAfter: 2 },
        { type: 'UnchangedLine' as const, content: 'context', lineBefore: 3, lineAfter: 3 },
      ]
      
      const header = builder.calculateHunkHeader(changes, 5, 5)
      expect(header).toBe('@@ -5,3 +5,3 @@')
    })
  })
})
