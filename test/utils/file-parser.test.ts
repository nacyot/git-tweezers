import { describe, it, expect } from 'vitest'
import { parseFileSelector } from '../../src/utils/file-parser.js'

describe('file-parser', () => {
  describe('parseFileSelector', () => {
    it('should parse file:selector syntax', () => {
      const result = parseFileSelector('src/file.ts:3')
      expect(result).toEqual({
        file: 'src/file.ts',
        selector: '3',
      })
    })

    it('should parse file:id syntax', () => {
      const result = parseFileSelector('src/file.ts:a3f5')
      expect(result).toEqual({
        file: 'src/file.ts',
        selector: 'a3f5',
      })
    })

    it('should handle file without selector', () => {
      const result = parseFileSelector('src/file.ts')
      expect(result).toEqual({
        file: 'src/file.ts',
        selector: undefined,
      })
    })

    it('should handle Windows paths', () => {
      const result = parseFileSelector('C:\\Users\\file.ts')
      expect(result).toEqual({
        file: 'C:\\Users\\file.ts',
        selector: undefined,
      })
    })

    it('should handle Windows paths with selector', () => {
      const result = parseFileSelector('C:\\Users\\file.ts:5')
      expect(result).toEqual({
        file: 'C:\\Users\\file.ts',
        selector: '5',
      })
    })

    it('should handle empty selector', () => {
      const result = parseFileSelector('file.ts:')
      expect(result).toEqual({
        file: 'file.ts:',
        selector: undefined,
      })
    })

    it('should use last colon for selector', () => {
      const result = parseFileSelector('path:with:colons.ts:123')
      expect(result).toEqual({
        file: 'path:with:colons.ts',
        selector: '123',
      })
    })

    it('should handle comma-separated selectors', () => {
      const result = parseFileSelector('file.ts:1,2,3')
      expect(result).toEqual({
        file: 'file.ts',
        selector: '1,2,3',
      })
    })
  })
})