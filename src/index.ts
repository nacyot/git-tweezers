// Core exports
export { GitWrapper } from './core/git-wrapper.js'
export { DiffParser } from './core/diff-parser.js'
export { PatchBuilder } from './core/patch-builder.js'

// Service exports
export { StagingService } from './services/staging-service.js'

// Utils exports
export { Logger, LogLevel, logger } from './utils/logger.js'

// Type exports
export type { GitOptions } from './core/git-wrapper.js'
export type { ParsedHunk, ParsedFile } from './core/diff-parser.js'
export type { HunkData, FileData } from './core/patch-builder.js'
export type { StageOptions } from './services/staging-service.js'
