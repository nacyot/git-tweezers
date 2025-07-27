import parse, { 
  type AnyFileChange, 
  type AnyLineChange, 
  type GitDiff,
  type Chunk
} from 'parse-git-diff'

export interface ParsedHunk {
  index: number
  header: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  changes: AnyLineChange[]
}

export interface ParsedFile {
  oldPath: string
  newPath: string
  hunks: ParsedHunk[]
}

export class DiffParser {
  parse(diffText: string): GitDiff {
    return parse(diffText)
  }

  parseFiles(diffText: string): ParsedFile[] {
    const gitDiff = this.parse(diffText)
    
    return gitDiff.files.map(file => {
      const oldPath = this.getOldPath(file)
      const newPath = this.getNewPath(file)
      
      return {
        oldPath,
        newPath,
        hunks: file.chunks
          .filter((chunk): chunk is Chunk => chunk.type === 'Chunk')
          .map((chunk, index) => {
            // Build header from chunk data
            const header = `@@ -${chunk.fromFileRange.start},${chunk.fromFileRange.lines} +${chunk.toFileRange.start},${chunk.toFileRange.lines} @@`
            
            return {
              index: index + 1, // 1-based index for user-facing
              header,
              oldStart: chunk.fromFileRange.start,
              oldLines: chunk.fromFileRange.lines,
              newStart: chunk.toFileRange.start,
              newLines: chunk.toFileRange.lines,
              changes: chunk.changes,
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

  extractLines(diffText: string, filePath: string, startLine: number, endLine: number): AnyLineChange[] {
    const files = this.parseFiles(diffText)
    const file = files.find(f => f.newPath === filePath || f.oldPath === filePath)
    
    if (!file) return []
    
    const changes: AnyLineChange[] = []
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
