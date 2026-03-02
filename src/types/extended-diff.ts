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