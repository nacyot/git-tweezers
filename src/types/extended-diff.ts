import type { AnyLineChange } from 'parse-git-diff'

/**
 * Extended line change type with EOL information
 */
export type ExtendedLineChange = AnyLineChange & {
  /**
   * Whether this line has a newline character at the end
   * false means "\ No newline at end of file" should be added
   */
  eol: boolean
}

/**
 * Helper to determine if a line has EOL based on raw diff content
 */
export function hasEOL(line: string, isLastLine: boolean, nextLine?: string): boolean {
  // If it's not the last line, it has EOL
  if (!isLastLine) return true
  
  // If the next line is "\ No newline at end of file", this line doesn't have EOL
  if (nextLine?.startsWith('\\ No newline at end of file')) return false
  
  // Otherwise, it has EOL
  return true
}