import { describe, it, expect } from 'vitest'
import { DiffAnalyzer } from '../../src/core/diff-analyzer.js'

describe('DiffAnalyzer', () => {
  describe('hasNoNewlineMarker', () => {
    it('should return true when next line is no-newline marker', () => {
      const lines = ['-last line', '\\ No newline at end of file']
      expect(DiffAnalyzer.hasNoNewlineMarker(lines, 0)).toBe(true)
    })

    it('should return false when next line is not a marker', () => {
      const lines = ['-line', '+another line']
      expect(DiffAnalyzer.hasNoNewlineMarker(lines, 0)).toBe(false)
    })

    it('should return false for last line (no next line)', () => {
      const lines = ['-last line']
      expect(DiffAnalyzer.hasNoNewlineMarker(lines, 0)).toBe(false)
    })

    it('should return false for empty array', () => {
      expect(DiffAnalyzer.hasNoNewlineMarker([], 0)).toBe(false)
    })

    it('should handle marker at end of multi-line diff', () => {
      const lines = [
        ' context',
        '-old line',
        '\\ No newline at end of file',
        '+new line',
      ]
      expect(DiffAnalyzer.hasNoNewlineMarker(lines, 1)).toBe(true)
      expect(DiffAnalyzer.hasNoNewlineMarker(lines, 0)).toBe(false)
    })
  })

  describe('analyzeEOL', () => {
    it('should mark all lines as eol=true when no marker present', () => {
      const diff = [
        'diff --git a/f.txt b/f.txt',
        '--- a/f.txt',
        '+++ b/f.txt',
        '@@ -1,3 +1,3 @@',
        ' context',
        '-old',
        '+new',
        ' context2',
      ].join('\n')

      const eolMap = DiffAnalyzer.analyzeEOL(diff)
      // All change lines should have eol=true
      for (const [_, hasEol] of eolMap) {
        expect(hasEol).toBe(true)
      }
    })

    it('should mark line before no-newline marker as eol=false', () => {
      const diff = [
        'diff --git a/f.txt b/f.txt',
        '--- a/f.txt',
        '+++ b/f.txt',
        '@@ -1,1 +1,1 @@',
        '-last line',
        '\\ No newline at end of file',
        '+new last line',
      ].join('\n')

      const eolMap = DiffAnalyzer.analyzeEOL(diff)
      // First change (deleted line) should be eol=false
      expect(eolMap.get(0)).toBe(false)
      // Second change (added line) should be eol=true
      expect(eolMap.get(1)).toBe(true)
    })

    it('should handle both sides having no newline', () => {
      const diff = [
        'diff --git a/f.txt b/f.txt',
        '--- a/f.txt',
        '+++ b/f.txt',
        '@@ -1,1 +1,1 @@',
        '-old',
        '\\ No newline at end of file',
        '+new',
        '\\ No newline at end of file',
      ].join('\n')

      const eolMap = DiffAnalyzer.analyzeEOL(diff)
      expect(eolMap.get(0)).toBe(false) // deleted: no newline
      expect(eolMap.get(1)).toBe(false) // added: no newline
    })

    it('should skip --- and +++ header lines', () => {
      const diff = [
        '--- a/f.txt',
        '+++ b/f.txt',
        '@@ -1,1 +1,1 @@',
        '-old',
        '+new',
      ].join('\n')

      const eolMap = DiffAnalyzer.analyzeEOL(diff)
      // Should only have 2 entries (the actual change lines)
      expect(eolMap.size).toBe(2)
    })

    it('should handle multiple hunks', () => {
      const diff = [
        'diff --git a/f.txt b/f.txt',
        '--- a/f.txt',
        '+++ b/f.txt',
        '@@ -1,3 +1,3 @@',
        ' ctx',
        '-old1',
        '+new1',
        ' ctx2',
        '@@ -10,3 +10,3 @@',
        ' ctx3',
        '-old2',
        '+new2',
        ' ctx4',
      ].join('\n')

      const eolMap = DiffAnalyzer.analyzeEOL(diff)
      // 8 change lines total (4 context + 2 del + 2 add)
      expect(eolMap.size).toBe(8)
      // All should be eol=true
      for (const [_, hasEol] of eolMap) {
        expect(hasEol).toBe(true)
      }
    })

    it('should handle no-newline in the middle of multiple hunks', () => {
      const diff = [
        'diff --git a/f.txt b/f.txt',
        '--- a/f.txt',
        '+++ b/f.txt',
        '@@ -1,3 +1,3 @@',
        ' ctx',
        '-old1',
        '+new1',
        ' ctx2',
        '@@ -10,1 +10,2 @@',
        '-last',
        '\\ No newline at end of file',
        '+last',
        '+added',
      ].join('\n')

      const eolMap = DiffAnalyzer.analyzeEOL(diff)
      // Find the deleted "last" line - it should have eol=false
      // It's change index 4 (ctx=0, old1=1, new1=2, ctx2=3, last=4)
      expect(eolMap.get(4)).toBe(false)
      expect(eolMap.get(5)).toBe(true) // +last
      expect(eolMap.get(6)).toBe(true) // +added
    })

    it('should handle empty diff', () => {
      const eolMap = DiffAnalyzer.analyzeEOL('')
      expect(eolMap.size).toBe(0)
    })

    it('should handle diff with only headers (no changes)', () => {
      const diff = [
        'diff --git a/f.txt b/f.txt',
        '--- a/f.txt',
        '+++ b/f.txt',
      ].join('\n')

      const eolMap = DiffAnalyzer.analyzeEOL(diff)
      expect(eolMap.size).toBe(0)
    })

    it('should handle addition-only diff', () => {
      const diff = [
        'diff --git a/f.txt b/f.txt',
        '--- a/f.txt',
        '+++ b/f.txt',
        '@@ -0,0 +1,3 @@',
        '+line 1',
        '+line 2',
        '+line 3',
      ].join('\n')

      const eolMap = DiffAnalyzer.analyzeEOL(diff)
      expect(eolMap.size).toBe(3)
      for (const [_, hasEol] of eolMap) {
        expect(hasEol).toBe(true)
      }
    })

    it('should handle deletion-only diff', () => {
      const diff = [
        'diff --git a/f.txt b/f.txt',
        '--- a/f.txt',
        '+++ b/f.txt',
        '@@ -1,3 +0,0 @@',
        '-line 1',
        '-line 2',
        '-line 3',
      ].join('\n')

      const eolMap = DiffAnalyzer.analyzeEOL(diff)
      expect(eolMap.size).toBe(3)
    })

    it('should handle consecutive no-newline markers', () => {
      // Edge: both delete and add on last line with no newlines
      const diff = [
        '--- a/f.txt',
        '+++ b/f.txt',
        '@@ -1,2 +1,2 @@',
        ' keep',
        '-old end',
        '\\ No newline at end of file',
        '+new end',
        '\\ No newline at end of file',
      ].join('\n')

      const eolMap = DiffAnalyzer.analyzeEOL(diff)
      // keep=0(true), old end=1(false), new end=2(false)
      expect(eolMap.get(0)).toBe(true)
      expect(eolMap.get(1)).toBe(false)
      expect(eolMap.get(2)).toBe(false)
    })
  })
})
