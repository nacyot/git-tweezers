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
# Shows current mode (normal/precise) and mode-specific IDs

# List changed hunks in a file  
npx git-tweezers list <filename>

# Output format: [index|ID] header stats | summary
# Example: [1|a3f5] @@ -10,5 +10,7 @@ +2 -1 | return a + b;
#          ↑   ↑
#       index  stable hash ID (use this for staging!)

# For finer hunk separation (precise mode)
npx git-tweezers list -p <filename>
# Note: When using -p with list, also use -p with hunk command!

# Preview full diff content
npx git-tweezers list --preview <filename>

# Filter options for large repositories
npx git-tweezers list --exclude 'vendor/**' --exclude 'node_modules/**'
npx git-tweezers list --respect-gitignore  # Exclude files in .gitignore
npx git-tweezers list --tracked-only        # Show only tracked files
npx git-tweezers list --staged-only         # Show only staged changes
```

### 2. Hunk-level Staging

**💡 Best Practices**
- **Use hash IDs over index numbers** - IDs are more explicit and prevent mistakes
- Always use consistent modes between `list` and `hunk` commands (both with or without `-p`)
- Hash IDs (e.g., `a3f5`) are stable and unique to each hunk's content

```bash
# ❌ AVOID: Index-based staging (less explicit)
npx git-tweezers hunk config.js:1,2  # Numbers can be confusing

# ✅ PREFER: Hash ID-based staging (explicit and clear)
npx git-tweezers hunk config.js:a3f5,b8d2  # IDs clearly identify specific hunks

# Mode consistency examples:
# Normal mode (default)
npx git-tweezers list config.js         # Shows [1|a3f5], [2|b8d2]
npx git-tweezers hunk config.js:a3f5    # Use same mode

# Precise mode (-p flag)
npx git-tweezers list -p config.js      # Shows [1|c5b3], [2|7184]
npx git-tweezers hunk -p config.js:c5b3 # Must also use -p flag!

# Stage multiple hunks from same file
npx git-tweezers hunk <filename>:a3f5,b8d2  # Use IDs, not indices

# Stage hunks from multiple files
npx git-tweezers hunk file1.ts:a3f5 file2.ts:b8d2

# Preview without staging (dry-run)
npx git-tweezers hunk <filename>:a3f5 --dry-run
npx git-tweezers hunk <filename>:a3f5 -d  # Short form
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
# Shows summary: "✓ Successfully staged 16 lines from src/utils.ts"

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

# 3. Preview the bug fix before staging (use ID, not index)
npx git-tweezers hunk src/services/api.ts:e3f2 --dry-run

# 4. Stage only bug fix (using stable ID)
npx git-tweezers hunk src/services/api.ts:e3f2

# 5. Commit
git commit -m "fix: resolve API response handling error"

# 6. Stage new feature and refactoring together (use IDs for reliability)
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
- **Use Hash IDs for clarity**: IDs are more explicit and prevent confusion
  ```bash
  # Hash IDs make your intent clear
  npx git-tweezers list config.js         # Shows [1|a3f5], [2|b8d2]
  npx git-tweezers hunk config.js:a3f5    # Clearly stages the "a3f5" hunk
  npx git-tweezers hunk config.js:b8d2    # Clearly stages the "b8d2" hunk
  
  # You can also stage multiple hunks at once
  npx git-tweezers hunk config.js:a3f5,b8d2  # Stage both hunks together
  # Shows staging summary: "✓ Successfully staged 2 hunks across 1 file"
  ```
- **Mode consistency**: Always match modes between `list` and `hunk` commands
  ```bash
  # If using precise mode for listing, also use it for staging
  npx git-tweezers list -p file.js        # Note the -p flag
  npx git-tweezers hunk -p file.js:abc3   # Must also use -p flag
  ```
- **Multiple files**: Stage related changes from different files in one command
  ```bash
  npx git-tweezers hunk src/api.ts:a3f5 src/types.ts:b8d2 src/index.ts:c1d5
  ```
- **Large hunks**: Use `-p` (precise mode) or `lines` command to select only needed lines
- **Preview changes**: Always use `--dry-run` to verify before staging
- **Error recovery**: Enhanced error messages provide:
  - Mode mismatch detection and guidance
  - File modification warnings with suggested commands
  - All available hunks with their current IDs
  ```bash
  # If you get "Hunk not found" error, the message will suggest:
  # - Check if modes match (list and hunk both need -p or neither)
  # - Re-run list to get fresh IDs if file was modified
  ```
- **Debug info**: Enable detailed logging with DEBUG=1 environment variable
  ```bash
  DEBUG=1 npx git-tweezers list src/index.ts
  ```