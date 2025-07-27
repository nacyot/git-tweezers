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

git-tweezers is a tool that enables precise staging at hunk and line levels.

### 1. Review Changes
```bash
# List changed hunks in a file
npx git-tweezers list <filename>

# For finer hunk separation (precise mode)
npx git-tweezers list -p <filename>
```

### 2. Hunk-level Staging
```bash
# Stage specific hunk (numbers start from 1)
npx git-tweezers hunk <filename> <hunk-number>

# Example: Stage 2nd hunk of src/index.ts
npx git-tweezers hunk src/index.ts 2
```

### 3. Line-level Staging
```bash
# Stage specific line range
npx git-tweezers lines <filename> <start-line>-<end-line>

# Stage single line
npx git-tweezers lines <filename> <line-number>

# Examples
npx git-tweezers lines src/utils.ts 10-25
npx git-tweezers lines src/utils.ts 42
```

### 4. Workflow Example
```bash
# 1. Check overall changes
git status

# 2. List hunks in specific file
npx git-tweezers list src/services/api.ts

# Example output:
# Hunk 1 @ lines 10-20: Bug fix related
# Hunk 2 @ lines 45-60: New feature addition
# Hunk 3 @ lines 80-85: Refactoring

# 3. Stage only bug fix first
npx git-tweezers hunk src/services/api.ts 1

# 4. Commit
git commit -m "fix: resolve API response handling error"

# 5. Stage new feature
npx git-tweezers hunk src/services/api.ts 2

# 6. Include specific lines if needed
npx git-tweezers lines src/services/api.ts 82-83

# 7. Commit
git commit -m "feat: add user authentication API"
```

### 5. Tips for Complex Changes
- **Multiple files**: Use `npx git-tweezers list` for each file, then group related changes
- **Large hunks**: Use `-p` (precise mode) or `lines` command to select only needed lines
- **Debug info**: Enable detailed logging with DEBUG=1 environment variable
  ```bash
  DEBUG=1 npx git-tweezers list src/index.ts
  ```