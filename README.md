# git-tweezers

Advanced non-interactive git staging tool with hunk and line-level control.

## Features

- 🚀 **Non-interactive**: Direct commands for automation and scripting
- 🎯 **Hunk-level staging**: Stage specific hunks from your changes
- 📏 **Line-level staging**: Stage individual lines or line ranges
- 🔍 **Precise mode**: Use U0 context for finer control over change boundaries
- 🌈 **Colorful output**: Clear visual feedback with colored output
- 📄 **Untracked file support**: Stage parts of new files
- 🔧 **Cross-platform**: Works on Windows, macOS, and Linux
- 🆔 **Stable Hunk IDs**: Consistent hunk identification across multiple commands
- 👀 **Diff Preview**: View actual changes before staging
- 📁 **Multi-file Support**: Stage hunks from multiple files in one command
- 🔬 **Dry-run Mode**: Preview what would be staged without applying changes
- ↩️ **Undo Support**: Reverse your last staging operations

## Installation

```bash
npm install -g git-tweezers
```

This installs the `tweeze` command globally.

Or use directly with npx:

```bash
npx git-tweezers list src/index.ts
```

## Usage

### Install Claude Code Command

git-tweezers includes a smart-commit template for Claude Code custom commands:

```bash
# Install locally in current git repository
npx git-tweezers install

# Install globally for all projects
npx git-tweezers install --global

# Force overwrite existing template
npx git-tweezers install --force
```

Once installed, you can use `/smart-commit` in Claude Code to create logical commits with precise staging.

### What's New

- **Stable Hunk IDs**: Each hunk now has a unique 4-character ID (e.g., `a3f5`) that remains consistent across commands
- **Enhanced List Output**: See hunk stats and summary at a glance: `[1|a3f5] @@ -10,5 +10,7 @@ +2 -1 | return a + b;`
- **Preview Mode**: Use `--preview` to see full diff content before staging
- **Multi-file Support**: Stage hunks from multiple files in one command: `tweeze hunk file1.ts:1 file2.ts:3`
- **Better Error Messages**: When staging fails, see all remaining hunks with their IDs and summaries
- **Dry-run Mode**: Use `--dry-run` flag to preview patches without applying them
- **Undo Command**: Reverse recent staging operations with `tweeze undo`

### Basic Workflow

```bash
# 1. Check what changed in a file
tweeze list src/index.ts
# or with npx (no installation needed)
npx git-tweezers list src/index.ts

# Output example:
# [1|a3f5] @@ -10,5 +10,7 @@ +2 -1 | return a + b;
# [2|b8d2] @@ -45,3 +47,6 @@ +3 | function validate(input) {

# 2. Stage only the bug fix (hunk 1)
tweeze hunk src/index.ts 1

# 3. Commit the fix
git commit -m "fix: include c in calculation"

# 4. Stage the new feature (hunk 2)
tweeze hunk src/index.ts 2
git commit -m "feat: add validation function"
```

### Using with npx (no installation required)

```bash
# List hunks
npx git-tweezers list src/components/Button.tsx

# Stage a specific hunk
npx git-tweezers hunk src/components/Button.tsx 2

# Stage specific lines
npx git-tweezers lines src/components/Button.tsx 10-20

# Use precise mode
npx git-tweezers list -p src/components/Button.tsx
```

### List hunks in files

```bash
# List hunks in all changed files
tweeze list

# List hunks in a specific file
tweeze list src/index.ts

# List hunks with precise context (U0) for more granular control
tweeze list -p src/index.ts

# Show preview of actual changes
tweeze list --preview src/index.ts

# Show inline summary only (default)
tweeze list --inline src/index.ts
```

### Stage specific hunks

```bash
# Stage by index (1-based)
tweeze hunk src/index.ts 2

# Stage by ID
tweeze hunk src/index.ts a3f5

# Stage using colon syntax
tweeze hunk src/index.ts:2
tweeze hunk src/index.ts:a3f5

# Stage multiple hunks from same file
tweeze hunk src/index.ts 1,3,5
tweeze hunk src/index.ts:1,3,5

# Stage hunks from multiple files
tweeze hunk src/file1.ts:1 src/file2.ts:3
tweeze hunk src/file1.ts:a3f5 src/file2.ts:b8d2

# Use precise mode for finer control
tweeze hunk -p src/index.ts 2
```

### Stage specific lines

```bash
# Stage a range of lines
tweeze lines src/index.ts 10-15

# Stage a single line
tweeze lines src/index.ts 42

# Stage multiple ranges (run multiple times)
tweeze lines src/index.ts 10-15
tweeze lines src/index.ts 25-30
```

### Dry-run mode

Preview what would be staged without actually applying changes:

```bash
# Preview a hunk staging
tweeze hunk src/index.ts 1 --dry-run
tweeze hunk src/index.ts 1 -d  # Short form

# Preview line staging
tweeze lines src/index.ts 10-15 --dry-run

# Works with all staging commands
tweeze hunk src/file1.ts:1 src/file2.ts:3 --dry-run
```

### Undo staging operations

Reverse your recent staging operations:

```bash
# Undo the most recent staging
tweeze undo

# View staging history
tweeze undo --list
tweeze undo -l  # Short form

# Undo a specific operation (0 = most recent)
tweeze undo --step 2  # Undo the 3rd most recent staging
```

### Real-world Example

```bash
# You've made multiple changes to a component
$ git diff --stat
 src/components/Button.tsx | 24 +++++++++++++-----------
 
# See what changed
$ tweeze list src/components/Button.tsx
[1|a3f5] @@ -5,3 +5,4 @@ +1 | import { useState } from 'react';
[2|b8d2] @@ -15,10 +16,11 @@ +3 -2 | const [clicked, setClicked] = useState(false);
[3|c1e9] @@ -30,1 +32,5 @@ +4 -1 | // TODO: Add prop types

# Or see with preview
$ tweeze list --preview src/components/Button.tsx
[1|a3f5] @@ -5,3 +5,4 @@
   import React from 'react';
+  import { useState } from 'react';

[2|b8d2] @@ -15,10 +16,11 @@
   export function Button({ onClick, children }) {
+    const [clicked, setClicked] = useState(false);
     return (
-      <button onClick={onClick}>
+      <button onClick={() => { setClicked(true); onClick(); }}>
         {children}
       </button>

[3|c1e9] @@ -30,1 +32,5 @@
-  // TODO: Add prop types
+  Button.propTypes = {
+    onClick: PropTypes.func.isRequired,
+    children: PropTypes.node
+  };

# Stage only the import and state changes (hunks 1 & 2)
$ tweeze hunk src/components/Button.tsx 1
$ tweeze hunk src/components/Button.tsx 2
$ git commit -m "feat: add click tracking to Button"

# Stage the prop types separately
$ tweeze hunk src/components/Button.tsx 3
$ git commit -m "chore: add prop types to Button"
```

## Precise Mode

By default, git-tweezers uses 3 lines of context (U3) when generating diffs. This provides stable patch application but may group nearby changes into single hunks.

Precise mode (U0) uses zero context lines, splitting changes into the smallest possible hunks. This gives you finer control but may fail on complex changes.

Enable precise mode with the `-p` or `--precise` flag.

## Development

```bash
# Clone the repository
git clone https://github.com/nacyot/git-tweezers.git
cd git-tweezers

# Install dependencies
npm install

# Build the project
npm run build

# Run tests
npm test

# Run in development
./bin/run.js list src/index.ts

# Run integration tests
./test-integration.sh
```

## How it works

git-tweezers uses:
- `parse-git-diff` to parse git diff output into an AST
- Custom patch builder to reconstruct patches with selected changes
- `git apply --cached` to apply patches to the staging area
- `git add -N` (intent-to-add) for untracked file support

For line-level staging, it uses the "U0 trick": generating diffs with zero context lines, where each changed line becomes its own hunk.

## License

MIT

## Troubleshooting

### "No changes found" error
- Make sure you're in a git repository
- Check that the file has unstaged changes with `git status`
- For new files, git-tweezers automatically handles them with `git add -N`

### Debug mode
Enable debug logging to see what's happening:
```bash
DEBUG=1 tweeze list src/index.ts
```
