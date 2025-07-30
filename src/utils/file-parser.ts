/**
 * Parse file:hunk selector syntax
 * Examples:
 *   "src/file.ts:3" -> { file: "src/file.ts", selector: "3" }
 *   "src/file.ts:a3f5" -> { file: "src/file.ts", selector: "a3f5" }
 *   "src/file.ts" -> { file: "src/file.ts", selector: undefined }
 */
export function parseFileSelector(input: string): { file: string; selector?: string } {
  const colonIndex = input.lastIndexOf(':')
  
  // No colon found, it's just a file path
  if (colonIndex === -1) {
    return { file: input, selector: undefined }
  }
  
  // Check if the colon might be part of a Windows path (e.g., C:\path)
  if (colonIndex === 1 && /^[a-zA-Z]$/.test(input[0])) {
    return { file: input, selector: undefined }
  }
  
  const file = input.substring(0, colonIndex)
  const selector = input.substring(colonIndex + 1)
  
  // If selector is empty, treat as just file
  if (!selector) {
    return { file: input, selector: undefined }
  }
  
  return { file, selector }
}