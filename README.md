# git-twizer

Advanced non-interactive git staging tool with hunk and line-level control.

## Features

- 🚀 **Non-interactive**: Direct commands for automation and scripting
- 🎯 **Hunk-level staging**: Stage specific hunks from your changes
- 📏 **Line-level staging**: Stage individual lines or line ranges
- 🔍 **Precise mode**: Use U0 context for finer control over change boundaries
- 🌈 **Colorful output**: Clear visual feedback with colored output
- 📄 **Untracked file support**: Stage parts of new files
- 🔧 **Cross-platform**: Works on Windows, macOS, and Linux

## Installation

```bash
npm install -g git-twizer
```

Or use directly with npx:

```bash
npx git-twizer list src/index.ts
```

## Usage

### Basic Workflow

```bash
# 1. Check what changed in a file
git-twizer list src/index.ts
# or with npx (no installation needed)
npx git-twizer list src/index.ts

# Output example:
# Hunk 1 @ lines 10-20:
#   function calculate() {
# -   return a + b;
# +   return a + b + c;
#   }
# 
# Hunk 2 @ lines 45-50:
# + function validate(input) {
# +   return input > 0;
# + }

# 2. Stage only the bug fix (hunk 1)
git-twizer hunk src/index.ts 1

# 3. Commit the fix
git commit -m "fix: include c in calculation"

# 4. Stage the new feature (hunk 2)
git-twizer hunk src/index.ts 2
git commit -m "feat: add validation function"
```

### Using with npx (no installation required)

```bash
# List hunks
npx git-twizer list src/components/Button.tsx

# Stage a specific hunk
npx git-twizer hunk src/components/Button.tsx 2

# Stage specific lines
npx git-twizer lines src/components/Button.tsx 10-20

# Use precise mode
npx git-twizer list -p src/components/Button.tsx
```

### List hunks in a file

```bash
# List hunks with normal context (U3)
git-twizer list src/index.ts

# List hunks with precise context (U0) for more granular control
git-twizer list -p src/index.ts
# or
PRECISE=1 git-twizer list src/index.ts
```

### Stage specific hunks

```bash
# Stage a single hunk (1-based index)
git-twizer hunk src/index.ts 2

# Stage multiple hunks
git-twizer hunk src/index.ts 1
git-twizer hunk src/index.ts 3

# Use precise mode for finer control
git-twizer hunk -p src/index.ts 2
```

### Stage specific lines

```bash
# Stage a range of lines
git-twizer lines src/index.ts 10-15

# Stage a single line
git-twizer lines src/index.ts 42

# Stage multiple ranges (run multiple times)
git-twizer lines src/index.ts 10-15
git-twizer lines src/index.ts 25-30
```

### Real-world Example

```bash
# You've made multiple changes to a component
$ git diff --stat
 src/components/Button.tsx | 24 +++++++++++++-----------
 
# See what changed
$ git-twizer list src/components/Button.tsx
Hunk 1 @ lines 5-10:
  import React from 'react';
+ import { useState } from 'react';

Hunk 2 @ lines 15-25:
  export function Button({ onClick, children }) {
+   const [clicked, setClicked] = useState(false);
    return (
-     <button onClick={onClick}>
+     <button onClick={() => { setClicked(true); onClick(); }}>
        {children}
      </button>

Hunk 3 @ lines 30-35:
- // TODO: Add prop types
+ Button.propTypes = {
+   onClick: PropTypes.func.isRequired,
+   children: PropTypes.node
+ };

# Stage only the import and state changes (hunks 1 & 2)
$ git-twizer hunk src/components/Button.tsx 1
$ git-twizer hunk src/components/Button.tsx 2
$ git commit -m "feat: add click tracking to Button"

# Stage the prop types separately
$ git-twizer hunk src/components/Button.tsx 3
$ git commit -m "chore: add prop types to Button"
```

## Precise Mode

By default, git-twizer uses 3 lines of context (U3) when generating diffs. This provides stable patch application but may group nearby changes into single hunks.

Precise mode (U0) uses zero context lines, splitting changes into the smallest possible hunks. This gives you finer control but may fail on complex changes.

Enable precise mode with:
- `-p` or `--precise` flag
- `PRECISE=1` environment variable

## Development

```bash
# Clone the repository
git clone https://github.com/nacyot/git-twizer.git
cd git-twizer

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

git-twizer uses:
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
- For new files, git-twizer automatically handles them with `git add -N`

### Debug mode
Enable debug logging to see what's happening:
```bash
DEBUG=1 git-twizer list src/index.ts
```