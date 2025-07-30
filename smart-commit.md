# Smart Commit

Create commits based on current work progress.

- Analyze current work and split into logical commit units. Avoid overly granular commits.
- Create commit messages based on staged files and current work progress.
- Check the format of the last 10 commit messages and follow their style, including language.
- If commit messages lack consistency, use Conventional Commits style with a concise one-line summary.
- Add detailed description after a blank line. Use lists actively.
- Do not arbitrarily revert or delete changed files. All changes have reasonable justifications.

$ARGUMENTS

## Precision Staging Strategy with git-tweezers

git-tweezers is a non-interactive tool that enables precise staging at hunk and line levels, with stable IDs, dry-run mode, and undo support.

### 1. Review Changes
```bash
# List all changed files
npx git-tweezers list

# List changed hunks in a file
npx git-tweezers list <filename>

# Output format: [index|ID] header stats | summary
# Example: [1|a3f5] @@ -10,5 +10,7 @@ +2 -1 | return a + b;

# For finer hunk separation (precise mode)
npx git-tweezers list -p <filename>

# Preview full diff content
npx git-tweezers list --preview <filename>
```

### 2. Hunk-level Staging
```bash
# Stage by index or stable ID
npx git-tweezers hunk <filename> <hunk-number|ID>

# Using colon syntax
npx git-tweezers hunk <filename>:<hunk-number|ID>

# Stage multiple hunks from same file
npx git-tweezers hunk <filename> 1,3,5
npx git-tweezers hunk <filename>:1,3,5

# Stage hunks from multiple files
npx git-tweezers hunk file1.ts:1 file2.ts:3
npx git-tweezers hunk file1.ts:a3f5 file2.ts:b8d2

# Preview without staging (dry-run)
npx git-tweezers hunk <filename>:1 --dry-run
npx git-tweezers hunk <filename>:1 -d  # Short form

# Examples:
npx git-tweezers hunk src/index.ts 2      # By index
npx git-tweezers hunk src/index.ts a3f5   # By ID
npx git-tweezers hunk src/index.ts:1,3    # Multiple hunks
```

### 3. Line-level Staging
```bash
# Stage specific line range
npx git-tweezers lines <filename> <start-line>-<end-line>

# Stage single line
npx git-tweezers lines <filename> <line-number>

# Preview without staging (dry-run)
npx git-tweezers lines <filename> 10-20 --dry-run

# Examples
npx git-tweezers lines src/utils.ts 10-25
npx git-tweezers lines src/utils.ts 42
npx git-tweezers lines src/utils.ts 10-20 -d  # Dry-run
```

### 4. Workflow Example
```bash
# 1. Check overall changes
git status

# 2. List hunks in specific file
npx git-tweezers list src/services/api.ts

# Example output:
# [1|e3f2] @@ -10,5 +10,8 @@ +6 -3 | fix response handling
# [2|a7b9] @@ -45,15 +48,30 @@ +18 -3 | add authentication
# [3|c1d5] @@ -80,5 +95,10 @@ +7 -2 | refactor error handling

# 3. Preview the bug fix before staging
npx git-tweezers hunk src/services/api.ts:1 --dry-run

# 4. Stage only bug fix (using stable ID)
npx git-tweezers hunk src/services/api.ts e3f2

# 5. Commit
git commit -m "fix: resolve API response handling error"

# 6. Stage new feature and refactoring together
npx git-tweezers hunk src/services/api.ts:a7b9,c1d5

# 7. Commit
git commit -m "feat: add user authentication with improved error handling"
```

### 5. Undo Staging Operations
```bash
# Undo the most recent staging
npx git-tweezers undo

# View staging history
npx git-tweezers undo --list

# Undo a specific operation (0 = most recent)
npx git-tweezers undo --step 2
```

### 6. Tips for Complex Changes
- **Multiple files**: Stage related changes from different files in one command
  ```bash
  npx git-tweezers hunk src/api.ts:1 src/types.ts:2 src/index.ts:3
  ```
- **Stable IDs**: Use 4-character IDs (e.g., `a3f5`) that remain consistent across commands
- **Large hunks**: Use `-p` (precise mode) or `lines` command to select only needed lines
- **Preview changes**: Always use `--dry-run` to verify before staging
- **Error recovery**: When staging fails, the error shows all remaining hunks with their IDs
- **Debug info**: Enable detailed logging with DEBUG=1 environment variable
  ```bash
  DEBUG=1 npx git-tweezers list src/index.ts
  ```