import { describe, it, expect } from 'vitest'
import { parseLineRanges, formatRanges } from '../../src/utils/range-parser.js'

describe('parseLineRanges', () => {
  describe('Valid inputs', () => {
    it('should parse a single line number', () => {
      const result = parseLineRanges('10')
      expect(result).toEqual([{ start: 10, end: 10 }])
    })

    it('should parse a line range', () => {
      const result = parseLineRanges('10-15')
      expect(result).toEqual([{ start: 10, end: 15 }])
    })

    it('should parse multiple ranges', () => {
      const result = parseLineRanges('10-15,20,25-30')
      expect(result).toEqual([
        { start: 10, end: 15 },
        { start: 20, end: 20 },
        { start: 25, end: 30 },
      ])
    })

    it('should sort ranges by start line', () => {
      const result = parseLineRanges('25-30,10-15,20')
      expect(result).toEqual([
        { start: 10, end: 15 },
        { start: 20, end: 20 },
        { start: 25, end: 30 },
      ])
    })

    it('should handle whitespace around parts', () => {
      const result = parseLineRanges(' 10 - 15 , 20 ')
      expect(result).toEqual([
        { start: 10, end: 15 },
        { start: 20, end: 20 },
      ])
    })

    it('should handle single range where start equals end', () => {
      const result = parseLineRanges('5-5')
      expect(result).toEqual([{ start: 5, end: 5 }])
    })

    it('should handle line 1', () => {
      const result = parseLineRanges('1')
      expect(result).toEqual([{ start: 1, end: 1 }])
    })

    it('should handle large line numbers', () => {
      const result = parseLineRanges('99999')
      expect(result).toEqual([{ start: 99999, end: 99999 }])
    })
  })

  describe('Invalid inputs', () => {
    it('should throw for non-numeric input', () => {
      expect(() => parseLineRanges('abc')).toThrow('Invalid line number')
    })

    it('should throw for zero line number', () => {
      expect(() => parseLineRanges('0')).toThrow('positive')
    })

    it('should throw for negative line number', () => {
      expect(() => parseLineRanges('-1')).toThrow()
    })

    it('should throw for reversed range', () => {
      expect(() => parseLineRanges('15-10')).toThrow('greater than end')
    })

    it('should throw for overlapping ranges', () => {
      expect(() => parseLineRanges('1-10,5-15')).toThrow('Overlapping')
    })

    it('should throw for adjacent overlapping ranges', () => {
      expect(() => parseLineRanges('1-10,10-15')).toThrow('Overlapping')
    })

    it('should throw for empty range part', () => {
      expect(() => parseLineRanges('-')).toThrow()
    })

    it('should throw for invalid range format', () => {
      expect(() => parseLineRanges('10-')).toThrow()
    })

    it('should throw for non-numeric range parts', () => {
      expect(() => parseLineRanges('a-b')).toThrow('Invalid line numbers')
    })
  })
})

describe('formatRanges', () => {
  it('should format single line as number', () => {
    expect(formatRanges([{ start: 10, end: 10 }])).toBe('10')
  })

  it('should format range with dash', () => {
    expect(formatRanges([{ start: 10, end: 15 }])).toBe('10-15')
  })

  it('should format multiple ranges with commas', () => {
    expect(formatRanges([
      { start: 10, end: 15 },
      { start: 20, end: 20 },
      { start: 25, end: 30 },
    ])).toBe('10-15, 20, 25-30')
  })

  it('should handle empty array', () => {
    expect(formatRanges([])).toBe('')
  })
})
