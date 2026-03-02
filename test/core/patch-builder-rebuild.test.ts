import { describe, it, expect } from 'vitest'
import { PatchBuilder } from '../../src/core/patch-builder.js'
import type { ExtendedLineChange } from '../../src/types/extended-diff.js'
import type { HunkData } from '../../src/core/patch-builder.js'

function makeChange(type: 'AddedLine' | 'DeletedLine' | 'UnchangedLine', content: string, eol = true): ExtendedLineChange {
  return { type, content, eol }
}

describe('PatchBuilder.rebuildHunk', () => {
  const builder = new PatchBuilder()

  it('should rebuild hunk with only selected added lines', () => {
    const hunk: HunkData = {
      header: '@@ -1,3 +1,5 @@',
      changes: [
        makeChange('UnchangedLine', 'ctx1'),
        makeChange('AddedLine', 'new1'),
        makeChange('AddedLine', 'new2'),
        makeChange('UnchangedLine', 'ctx2'),
        makeChange('AddedLine', 'new3'),
      ],
    }
    // Select only new1
    const result = builder.rebuildHunk(hunk, [hunk.changes[1]])
    expect(result.changes.filter(c => c.type === 'AddedLine')).toHaveLength(1)
    expect(result.changes.filter(c => c.type === 'AddedLine')[0].content).toBe('new1')
    // new2 and new3 should be skipped (not converted to context)
    expect(result.changes.filter(c => c.content === 'new2')).toHaveLength(0)
    expect(result.changes.filter(c => c.content === 'new3')).toHaveLength(0)
  })

  it('should convert unselected deletes to context lines', () => {
    const hunk: HunkData = {
      header: '@@ -1,3 +1,1 @@',
      changes: [
        makeChange('DeletedLine', 'old1'),
        makeChange('DeletedLine', 'old2'),
        makeChange('UnchangedLine', 'ctx'),
      ],
    }
    // Select only old1
    const result = builder.rebuildHunk(hunk, [hunk.changes[0]])
    expect(result.changes[0].type).toBe('DeletedLine')
    expect(result.changes[0].content).toBe('old1')
    // old2 should be converted to context
    expect(result.changes[1].type).toBe('UnchangedLine')
    expect(result.changes[1].content).toBe('old2')
  })

  it('should rebuild header with correct counts', () => {
    const hunk: HunkData = {
      header: '@@ -5,4 +5,4 @@',
      changes: [
        makeChange('UnchangedLine', 'ctx'),
        makeChange('DeletedLine', 'old'),
        makeChange('AddedLine', 'new'),
        makeChange('UnchangedLine', 'ctx2'),
      ],
    }
    // Select the delete+add pair
    const result = builder.rebuildHunk(hunk, [hunk.changes[1], hunk.changes[2]])
    // 2 context + 1 delete = 3 old, 2 context + 1 add = 3 new
    expect(result.header).toBe('@@ -5,3 +5,3 @@')
  })

  it('should handle all changes selected (full rebuild)', () => {
    const hunk: HunkData = {
      header: '@@ -1,2 +1,2 @@',
      changes: [
        makeChange('DeletedLine', 'old'),
        makeChange('AddedLine', 'new'),
      ],
    }
    const result = builder.rebuildHunk(hunk, hunk.changes)
    expect(result.changes).toHaveLength(2)
    expect(result.header).toBe('@@ -1,1 +1,1 @@')
  })

  it('should handle no changes selected', () => {
    const hunk: HunkData = {
      header: '@@ -1,3 +1,4 @@',
      changes: [
        makeChange('UnchangedLine', 'ctx'),
        makeChange('AddedLine', 'new'),
        makeChange('DeletedLine', 'old'),
        makeChange('UnchangedLine', 'ctx2'),
      ],
    }
    const result = builder.rebuildHunk(hunk, [])
    // AddedLine skipped, DeletedLine converted to context
    const adds = result.changes.filter(c => c.type === 'AddedLine')
    const dels = result.changes.filter(c => c.type === 'DeletedLine')
    expect(adds).toHaveLength(0)
    expect(dels).toHaveLength(0)
    // All should be context
    expect(result.changes.every(c => c.type === 'UnchangedLine')).toBe(true)
  })

  it('should handle replacement pattern correctly', () => {
    const hunk: HunkData = {
      header: '@@ -1,2 +1,2 @@',
      changes: [
        makeChange('DeletedLine', 'old A'),
        makeChange('DeletedLine', 'old B'),
        makeChange('AddedLine', 'new A'),
        makeChange('AddedLine', 'new B'),
      ],
    }
    // Select just one add and one delete
    const result = builder.rebuildHunk(hunk, [hunk.changes[0], hunk.changes[2]])
    const dels = result.changes.filter(c => c.type === 'DeletedLine')
    const adds = result.changes.filter(c => c.type === 'AddedLine')
    expect(dels).toHaveLength(1)
    expect(adds).toHaveLength(1)
    // Unselected delete (old B) should become context
    expect(result.changes.find(c => c.content === 'old B')?.type).toBe('UnchangedLine')
  })

  it('should throw for invalid hunk header', () => {
    const hunk: HunkData = {
      header: 'invalid header',
      changes: [makeChange('AddedLine', 'new')],
    }
    expect(() => builder.rebuildHunk(hunk, [hunk.changes[0]])).toThrow('Invalid hunk header')
  })
})

describe('PatchBuilder.buildPatch', () => {
  const builder = new PatchBuilder()

  it('should build a valid patch string', () => {
    const patch = builder.buildPatch([{
      oldPath: 'f.txt',
      newPath: 'f.txt',
      hunks: [{
        header: '@@ -1,1 +1,1 @@',
        changes: [
          makeChange('DeletedLine', 'old'),
          makeChange('AddedLine', 'new'),
        ],
      }],
    }])
    expect(patch).toContain('diff --git a/f.txt b/f.txt')
    expect(patch).toContain('--- a/f.txt')
    expect(patch).toContain('+++ b/f.txt')
    expect(patch).toContain('@@ -1,1 +1,1 @@')
    expect(patch).toContain('-old')
    expect(patch).toContain('+new')
  })

  it('should add no-newline marker for eol=false', () => {
    const patch = builder.buildPatch([{
      oldPath: 'f.txt',
      newPath: 'f.txt',
      hunks: [{
        header: '@@ -1,1 +1,1 @@',
        changes: [
          makeChange('DeletedLine', 'last', false),
          makeChange('AddedLine', 'new', true),
        ],
      }],
    }])
    expect(patch).toContain('\\ No newline at end of file')
  })

  it('should handle mode metadata', () => {
    const patch = builder.buildPatch([{
      oldPath: 'f.txt',
      newPath: 'f.txt',
      metadata: { mode: { old: '100644', new: '100755' } },
      hunks: [{
        header: '@@ -1,1 +1,1 @@',
        changes: [makeChange('DeletedLine', 'old'), makeChange('AddedLine', 'new')],
      }],
    }])
    expect(patch).toContain('old mode 100644')
    expect(patch).toContain('new mode 100755')
  })

  it('should handle rename metadata', () => {
    const patch = builder.buildPatch([{
      oldPath: 'old.txt',
      newPath: 'new.txt',
      metadata: { rename: { from: 'old.txt', to: 'new.txt' } },
      hunks: [],
    }])
    expect(patch).toContain('rename from old.txt')
    expect(patch).toContain('rename to new.txt')
  })
})

describe('PatchBuilder.buildHunkPatch', () => {
  const builder = new PatchBuilder()

  it('should build patch for a specific hunk', () => {
    const file = {
      oldPath: 'f.txt',
      newPath: 'f.txt',
      hunks: [
        { header: '@@ -1,1 +1,1 @@', changes: [makeChange('AddedLine', 'first')] },
        { header: '@@ -10,1 +10,1 @@', changes: [makeChange('AddedLine', 'second')] },
      ],
    }
    const patch = builder.buildHunkPatch(file, 0)
    expect(patch).toContain('+first')
    expect(patch).not.toContain('+second')
  })

  it('should return null for out-of-range index', () => {
    const file = {
      oldPath: 'f.txt',
      newPath: 'f.txt',
      hunks: [{ header: '@@ -1,1 +1,1 @@', changes: [makeChange('AddedLine', 'new')] }],
    }
    expect(builder.buildHunkPatch(file, -1)).toBeNull()
    expect(builder.buildHunkPatch(file, 5)).toBeNull()
  })
})

describe('PatchBuilder.calculateHunkHeader', () => {
  const builder = new PatchBuilder()

  it('should calculate correct header for mixed changes', () => {
    const changes = [
      makeChange('UnchangedLine', 'ctx'),
      makeChange('DeletedLine', 'old'),
      makeChange('AddedLine', 'new1'),
      makeChange('AddedLine', 'new2'),
      makeChange('UnchangedLine', 'ctx2'),
    ]
    const header = builder.calculateHunkHeader(changes, 5, 5)
    // old: 2 ctx + 1 delete = 3, new: 2 ctx + 2 add = 4
    expect(header).toBe('@@ -5,3 +5,4 @@')
  })

  it('should handle deletion-only', () => {
    const changes = [
      makeChange('DeletedLine', 'a'),
      makeChange('DeletedLine', 'b'),
    ]
    const header = builder.calculateHunkHeader(changes, 1, 1)
    expect(header).toBe('@@ -1,2 +1,0 @@')
  })

  it('should handle addition-only', () => {
    const changes = [
      makeChange('AddedLine', 'a'),
      makeChange('AddedLine', 'b'),
    ]
    const header = builder.calculateHunkHeader(changes, 1, 1)
    expect(header).toBe('@@ -1,0 +1,2 @@')
  })
})
