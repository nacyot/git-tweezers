import parse, {
  type AnyFileChange,
  type GitDiff,
  type Chunk
} from 'parse-git-diff'
import type { ExtendedLineChange } from '../types/extended-diff.js'
import type { FileInfo, FileMetadata } from '../types/hunk-info.js'
import { DiffAnalyzer } from './diff-analyzer.js'
import { generateHunkId, getHunkSummary, getHunkStats } from './hunk-id.js'

export interface ParsedHunk {
  index: number
  header: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  changes: ExtendedLineChange[]
}

export interface ParsedFile {
  oldPath: string
  newPath: string
  hunks: ParsedHunk[]
}

export class DiffParser {
  /**
   * Preprocess raw diff to extract metadata that parse-git-diff doesn't handle.
   * Strips mode/rename/copy lines, stores them as metadata keyed by file path.
   */
  preprocessDiff(raw: string): { cleaned: string; metadata: Map<string, FileMetadata> } {
    const metadata = new Map<string, FileMetadata>()
    const lines = raw.split('\n')
    const cleaned: string[] = []
    let currentFile: string | null = null

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]

      // Track current file from diff headers
      const diffMatch = line.match(/^diff --git a\/(.+?) b\/(.+)$/)
      if (diffMatch) {
        currentFile = diffMatch[2]
        if (!metadata.has(currentFile)) {
          metadata.set(currentFile, {})
        }
        cleaned.push(line)
        continue
      }

      if (currentFile) {
        const meta = metadata.get(currentFile)!

        // old mode / new mode
        const oldModeMatch = line.match(/^old mode (\d+)$/)
        if (oldModeMatch) {
          if (!meta.mode) meta.mode = { old: '', new: '' }
          meta.mode.old = oldModeMatch[1]
          continue // strip from cleaned output
        }
        const newModeMatch = line.match(/^new mode (\d+)$/)
        if (newModeMatch) {
          if (!meta.mode) meta.mode = { old: '', new: '' }
          meta.mode.new = newModeMatch[1]
          continue
        }

        // rename from / rename to
        const renameFromMatch = line.match(/^rename from (.+)$/)
        if (renameFromMatch) {
          if (!meta.rename) meta.rename = { from: '', to: '' }
          meta.rename.from = renameFromMatch[1]
          continue
        }
        const renameToMatch = line.match(/^rename to (.+)$/)
        if (renameToMatch) {
          if (!meta.rename) meta.rename = { from: '', to: '' }
          meta.rename.to = renameToMatch[1]
          continue
        }

        // copy from / copy to
        const copyFromMatch = line.match(/^copy from (.+)$/)
        if (copyFromMatch) {
          if (!meta.copy) meta.copy = { from: '', to: '' }
          meta.copy.from = copyFromMatch[1]
          continue
        }
        const copyToMatch = line.match(/^copy to (.+)$/)
        if (copyToMatch) {
          if (!meta.copy) meta.copy = { from: '', to: '' }
          meta.copy.to = copyToMatch[1]
          continue
        }
      }

      cleaned.push(line)
    }

    return { cleaned: cleaned.join('\n'), metadata }
  }

  parse(diffText: string): GitDiff {
    return parse(diffText)
  }

  parseFiles(diffText: string): ParsedFile[] {
    const files = this.parseFilesWithInfo(diffText)
    // Convert back to ParsedFile for backward compatibility
    return files.map(file => ({
      oldPath: file.oldPath,
      newPath: file.newPath,
      hunks: file.hunks.map(hunk => ({
        index: hunk.index,
        header: hunk.header,
        oldStart: hunk.oldStart,
        oldLines: hunk.oldLines,
        newStart: hunk.newStart,
        newLines: hunk.newLines,
        changes: hunk.changes,
      }))
    }))
  }

  parseFilesWithInfo(diffText: string): FileInfo[] {
    // Preprocess to extract mode/rename/copy metadata
    const { cleaned, metadata } = this.preprocessDiff(diffText)
    const gitDiff = this.parse(cleaned)
    const eolMap = DiffAnalyzer.analyzeEOL(cleaned)

    let globalChangeIndex = 0

    return gitDiff.files.map(file => {
      const oldPath = this.getOldPath(file)
      const newPath = this.getNewPath(file)
      const fileMeta = metadata.get(newPath) || metadata.get(oldPath)

      return {
        oldPath,
        newPath,
        ...(fileMeta && Object.keys(fileMeta).length > 0 ? { metadata: fileMeta } : {}),
        hunks: file.chunks
          .filter((chunk): chunk is Chunk => chunk.type === 'Chunk')
          .map((chunk, index) => {
            // Build header from chunk data
            const header = `@@ -${chunk.fromFileRange.start},${chunk.fromFileRange.lines} +${chunk.toFileRange.start},${chunk.toFileRange.lines} @@`
            
            // Enhance changes with EOL information
            const enhancedChanges: ExtendedLineChange[] = chunk.changes
              .filter(change => change.content !== 'No newline at end of file')
              .map(change => {
                const eol = eolMap.get(globalChangeIndex) ?? true // Default to true if not found
                globalChangeIndex++
                
                return {
                  ...change,
                  eol
                } as ExtendedLineChange
              })
            
            const hunkData = {
              index: index + 1, // 1-based index for user-facing
              header,
              oldStart: chunk.fromFileRange.start,
              oldLines: chunk.fromFileRange.lines,
              newStart: chunk.toFileRange.start,
              newLines: chunk.toFileRange.lines,
              changes: enhancedChanges,
            }
            
            const id = generateHunkId(hunkData, newPath)
            const summary = getHunkSummary(hunkData)
            const stats = getHunkStats(hunkData)
            
            return {
              ...hunkData,
              id,
              summary,
              stats,
            }
          }),
      }
    })
  }

  private getOldPath(file: AnyFileChange): string {
    switch (file.type) {
      case 'ChangedFile':
      case 'AddedFile':
      case 'DeletedFile':
        return file.path
      case 'RenamedFile':
        return file.pathBefore
    }
  }

  private getNewPath(file: AnyFileChange): string {
    switch (file.type) {
      case 'ChangedFile':
      case 'AddedFile':
      case 'DeletedFile':
        return file.path
      case 'RenamedFile':
        return file.pathAfter
    }
  }

  getHunkCount(diffText: string): number {
    const gitDiff = this.parse(diffText)
    return gitDiff.files.reduce((count, file) => {
      const chunks = file.chunks.filter(chunk => chunk.type === 'Chunk')
      return count + chunks.length
    }, 0)
  }

  getFileHunkCount(diffText: string, filePath: string): number {
    const gitDiff = this.parse(diffText)
    const file = gitDiff.files.find(f => 
      this.getNewPath(f) === filePath || this.getOldPath(f) === filePath
    )
    
    if (!file) return 0
    
    return file.chunks.filter(chunk => chunk.type === 'Chunk').length
  }

  extractHunk(diffText: string, filePath: string, hunkIndex: number): ParsedHunk | null {
    const files = this.parseFiles(diffText)
    const file = files.find(f => f.newPath === filePath || f.oldPath === filePath)
    
    if (!file || hunkIndex < 1 || hunkIndex > file.hunks.length) {
      return null
    }
    
    return file.hunks[hunkIndex - 1]
  }

  extractLines(diffText: string, filePath: string, startLine: number, endLine: number): ExtendedLineChange[] {
    const files = this.parseFiles(diffText)
    const file = files.find(f => f.newPath === filePath || f.oldPath === filePath)
    
    if (!file) return []
    
    const changes: ExtendedLineChange[] = []
    let currentLine = 0
    
    for (const hunk of file.hunks) {
      currentLine = hunk.newStart
      
      for (const change of hunk.changes) {
        if (change.type === 'AddedLine' || change.type === 'UnchangedLine') {
          if (currentLine >= startLine && currentLine <= endLine) {
            changes.push(change)
          }
          currentLine++
        }
      }
    }
    
    return changes
  }
}