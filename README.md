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

# Use precise mode for finer control
git-twizer hunk -p src/index.ts 2
```

### Stage specific lines

```bash
# Stage a range of lines
git-twizer lines src/index.ts 10-15

# Stage a single line
git-twizer lines src/index.ts 42
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

## API Usage

git-twizer can also be used as a library:

```typescript
import { StagingService } from 'git-twizer'

const staging = new StagingService()

// List hunks
const hunks = await staging.listHunks('src/index.ts', { precise: true })

// Stage a hunk
await staging.stageHunk('src/index.ts', 2)

// Stage specific lines
await staging.stageLines('src/index.ts', 10, 15)
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