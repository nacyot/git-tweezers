#!/usr/bin/env bash

set -e

echo "🧪 Setting up test environment..."

# Clean and create test directory
cd "$(dirname "$0")"
rm -rf tmp/test-repo
mkdir -p tmp/test-repo
cd tmp/test-repo

# Initialize git repo
git init
git config user.name "Test User"
git config user.email "test@example.com"

# Create initial commit
echo "# Test Repository" > README.md
echo "Initial content" > file1.txt
git add .
git commit -m "Initial commit"

# Create test changes for staging
cat > file1.txt << 'EOF'
Line 1: unchanged
Line 2: unchanged
Line 3: this line will be modified
Line 4: unchanged
Line 5: this line will be deleted
Line 6: unchanged
Line 7: unchanged
Line 8: this line will also be modified
Line 9: unchanged
Line 10: unchanged
EOF

git add file1.txt
git commit -m "Add more content to file1.txt"

# Now make changes that we'll stage selectively
cat > file1.txt << 'EOF'
Line 1: unchanged
Line 2: unchanged
Line 3: this line has been MODIFIED!
Line 4: unchanged
Line 5 was deleted and replaced with this new line
Line 6: unchanged
Line 6.5: this is a new inserted line
Line 7: unchanged
Line 8: this line has ALSO been MODIFIED!
Line 9: unchanged
Line 10: unchanged
Line 11: another new line at the end
EOF

# Create another file with changes
cat > file2.txt << 'EOF'
New file line 1
New file line 2
New file line 3
EOF

echo "✅ Test repository created"
echo ""
echo "📋 Current git status:"
git status --short

echo ""
echo "📊 Diff preview:"
git diff --stat

echo ""
echo "🧪 Testing git-twizer..."
echo ""

# Test 1: List hunks
echo "1️⃣ Test: List hunks in file1.txt"
echo "Command: git-twizer list file1.txt"
cd ../.. && npx tsx bin/run.js list tmp/test-repo/file1.txt
echo ""

# Test 2: List hunks with precise mode
echo "2️⃣ Test: List hunks in file1.txt (precise mode)"
echo "Command: git-twizer list file1.txt --precise"
cd tmp/test-repo && npx tsx ../../bin/run.js list file1.txt --precise
echo ""
cd ../..

# Test 3: Stage specific hunk
echo "3️⃣ Test: Stage hunk 1 of file1.txt"
echo "Command: git-twizer hunk file1.txt 1"
cd tmp/test-repo && npx tsx ../../bin/run.js hunk file1.txt 1
echo ""
echo "Git status after staging hunk 1:"
git status --short
echo ""
cd ../..

# Reset for next test
cd tmp/test-repo && git reset HEAD file1.txt && cd ../..

# Test 4: Stage specific lines
echo "4️⃣ Test: Stage lines 3-5 of file1.txt"
echo "Command: git-twizer lines file1.txt 3-5"
cd tmp/test-repo && npx tsx ../../bin/run.js lines file1.txt 3-5
echo ""
echo "Git status after staging lines 3-5:"
git status --short
echo "Staged changes:"
git diff --cached file1.txt
echo ""
cd ../..

# Reset for next test
cd tmp/test-repo && git reset HEAD file1.txt && cd ../..

# Test 5: Stage a new file
echo "5️⃣ Test: List and stage hunks for new file (file2.txt)"
echo "Command: git-twizer list file2.txt"
cd tmp/test-repo && npx tsx ../../bin/run.js list file2.txt
echo ""
echo "Command: git-twizer hunk file2.txt 1"
npx tsx ../../bin/run.js hunk file2.txt 1
echo ""
echo "Git status after staging new file:"
git status --short
echo ""
cd ../..

echo "✅ All tests completed!"