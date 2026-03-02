import { describe, it, expect } from 'vitest'
import { StagingError } from '../../src/utils/staging-error.js'
import type { HunkInfo } from '../../src/types/hunk-info.js'

function makeHunk(overrides: Partial<HunkInfo> = {}): HunkInfo {
  return {
    id: 'abc12345',
    index: 1,
    header: '@@ -1,3 +1,3 @@',
    oldStart: 1,
    oldLines: 3,
    newStart: 1,
    newLines: 3,
    changes: [],
    ...overrides,
  }
}

describe('StagingError', () => {
  it('should be instanceof Error', () => {
    const err = new StagingError('test')
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('StagingError')
  })

  it('should store message', () => {
    const err = new StagingError('Hunk not found')
    expect(err.message).toBe('Hunk not found')
  })

  it('should store remainingHunks', () => {
    const hunks = [makeHunk({ id: 'aaa11111', index: 1 })]
    const err = new StagingError('Not found', hunks)
    expect(err.remainingHunks).toHaveLength(1)
    expect(err.remainingHunks![0].id).toBe('aaa11111')
  })

  it('should store context', () => {
    const err = new StagingError('Not found', [], {
      mode: 'precise',
      filePath: 'test.ts',
      suggestCommand: 'gt list -p test.ts',
    })
    expect(err.context?.mode).toBe('precise')
    expect(err.context?.filePath).toBe('test.ts')
    expect(err.context?.suggestCommand).toBe('gt list -p test.ts')
  })

  describe('getFormattedMessage', () => {
    it('should include ERROR prefix', () => {
      const err = new StagingError('Something failed')
      const msg = err.getFormattedMessage()
      expect(msg).toContain('[ERROR]')
      expect(msg).toContain('Something failed')
    })

    it('should show available hunks when provided', () => {
      const hunks = [
        makeHunk({ id: 'aaa11111', index: 1, header: '@@ -1,3 +1,3 @@' }),
        makeHunk({ id: 'bbb22222', index: 2, header: '@@ -10,3 +10,3 @@' }),
      ]
      const err = new StagingError('Hunk not found', hunks)
      const msg = err.getFormattedMessage()
      expect(msg).toContain('Available hunks')
      expect(msg).toContain('aaa11111')
      expect(msg).toContain('bbb22222')
    })

    it('should show mode mismatch hint for "not found" errors with hunks', () => {
      const hunks = [makeHunk()]
      const err = new StagingError('Hunk selector "xyz" not found', hunks, {
        mode: 'normal',
        filePath: 'test.ts',
      })
      const msg = err.getFormattedMessage()
      expect(msg).toContain('Mode mismatch')
    })

    it('should show suggest command when provided', () => {
      const hunks = [makeHunk()]
      const err = new StagingError('Hunk selector "xyz" not found', hunks, {
        mode: 'precise',
        suggestCommand: 'gt list -p test.ts',
      })
      const msg = err.getFormattedMessage()
      expect(msg).toContain('gt list -p test.ts')
    })

    it('should show hunk stats when available', () => {
      const hunks = [
        makeHunk({ id: 'aaa11111', index: 1, stats: { additions: 3, deletions: 1 } }),
      ]
      const err = new StagingError('Not found', hunks)
      const msg = err.getFormattedMessage()
      expect(msg).toContain('+3')
      expect(msg).toContain('-1')
    })

    it('should show hunk summary when available', () => {
      const hunks = [
        makeHunk({ id: 'aaa11111', index: 1, summary: 'Modified function foo' }),
      ]
      const err = new StagingError('Not found', hunks)
      const msg = err.getFormattedMessage()
      expect(msg).toContain('Modified function foo')
    })

    it('should show current mode', () => {
      const hunks = [makeHunk()]
      const err = new StagingError('Not found', hunks, { mode: 'precise' })
      const msg = err.getFormattedMessage()
      expect(msg).toContain('precise')
    })

    it('should not show mode hints for non-"not found" errors', () => {
      const hunks = [makeHunk()]
      const err = new StagingError('Some other error', hunks, { mode: 'normal' })
      const msg = err.getFormattedMessage()
      expect(msg).not.toContain('Mode mismatch')
    })

    it('should handle empty remainingHunks', () => {
      const err = new StagingError('No hunks', [])
      const msg = err.getFormattedMessage()
      expect(msg).toContain('[ERROR]')
      expect(msg).not.toContain('Available hunks')
    })

    it('should handle undefined remainingHunks', () => {
      const err = new StagingError('No hunks')
      const msg = err.getFormattedMessage()
      expect(msg).toContain('[ERROR]')
      expect(msg).not.toContain('Available hunks')
    })
  })
})
