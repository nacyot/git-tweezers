/**
 * Analyzes raw diff text to extract EOL information
 */
export class DiffAnalyzer {
  /**
   * Check if a specific line in the diff has the "No newline at end of file" marker
   */
  static hasNoNewlineMarker(diffLines: string[], lineIndex: number): boolean {
    if (lineIndex >= diffLines.length - 1) return false
    
    const nextLine = diffLines[lineIndex + 1]
    return nextLine === '\\ No newline at end of file'
  }
  
  /**
   * Analyze diff text and create a map of line positions to EOL status
   */
  static analyzeEOL(diffText: string): Map<number, boolean> {
    const lines = diffText.split('\n')
    const eolMap = new Map<number, boolean>()
    
    let changeLineIndex = 0
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      
      // Skip diff headers first (before checking for change lines)
      if (line.startsWith('+++') || line.startsWith('---')) {
        continue
      }
      
      // Skip the no-newline marker
      if (line === '\\ No newline at end of file') {
        continue
      }
      
      // Skip non-change lines (headers, hunk markers, etc.)
      if (!line.startsWith('+') && !line.startsWith('-') && !line.startsWith(' ')) {
        continue
      }
      
      // This is a change line
      const hasEOL = !this.hasNoNewlineMarker(lines, i)
      eolMap.set(changeLineIndex, hasEOL)
      
      // Removed debug logging that was interfering with output
      
      changeLineIndex++
      
      // Skip the no-newline marker if present
      if (!hasEOL && i + 1 < lines.length && lines[i + 1] === '\\ No newline at end of file') {
        i++
      }
    }
    
    return eolMap
  }
}