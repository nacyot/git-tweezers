export interface LineRange {
  start: number
  end: number
}

/**
 * Parse a line range string into an array of ranges
 * Examples: "10", "10-15", "10-15,20,25-30"
 */
export function parseLineRanges(rangeStr: string): LineRange[] {
  const ranges: LineRange[] = []
  const parts = rangeStr.split(',').map(p => p.trim())
  
  for (const part of parts) {
    if (part.includes('-')) {
      // Range format: "10-15"
      const [startStr, endStr] = part.split('-').map(s => s.trim())
      
      if (!startStr || !endStr) {
        throw new Error(`Invalid range format: ${part}`)
      }
      
      const start = parseInt(startStr, 10)
      const end = parseInt(endStr, 10)
      
      if (isNaN(start) || isNaN(end)) {
        throw new Error(`Invalid line numbers in range: ${part}`)
      }
      
      if (start < 1 || end < 1) {
        throw new Error(`Line numbers must be positive: ${part}`)
      }
      
      if (start > end) {
        throw new Error(`Invalid range: start line (${start}) is greater than end line (${end})`)
      }
      
      ranges.push({ start, end })
    } else {
      // Single line format: "10"
      const line = parseInt(part, 10)
      
      if (isNaN(line)) {
        throw new Error(`Invalid line number: ${part}`)
      }
      
      if (line < 1) {
        throw new Error(`Line numbers must be positive: ${part}`)
      }
      
      ranges.push({ start: line, end: line })
    }
  }
  
  if (ranges.length === 0) {
    throw new Error('No valid ranges found')
  }
  
  // Sort ranges by start line
  ranges.sort((a, b) => a.start - b.start)
  
  // Check for overlapping ranges
  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i].start <= ranges[i - 1].end) {
      throw new Error(`Overlapping ranges: ${ranges[i - 1].start}-${ranges[i - 1].end} and ${ranges[i].start}-${ranges[i].end}`)
    }
  }
  
  return ranges
}

/**
 * Format ranges for display
 */
export function formatRanges(ranges: LineRange[]): string {
  return ranges.map(r => r.start === r.end ? `${r.start}` : `${r.start}-${r.end}`).join(', ')
}