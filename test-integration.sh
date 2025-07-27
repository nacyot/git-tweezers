#\!/bin/bash
set -e

echo "=== git-twizer Integration Test ==="
echo

# Clean up any previous test
cd tmp/test-repo
git reset --hard HEAD 2>/dev/null || true
git clean -fd 2>/dev/null || true

echo "1. Testing hunk staging..."
git checkout file-with-newline.txt
cat >> file-with-newline.txt << INNEREOF
Line 4 added
Line 5 added
INNEREOF
echo "Added 2 lines to file-with-newline.txt"
../../bin/run.js list file-with-newline.txt
../../bin/run.js hunk file-with-newline.txt 1
echo "✓ Hunk staging successful"
git diff --cached --stat
git reset
echo

echo "2. Testing line staging..."
../../bin/run.js lines file-with-newline.txt 4
echo "✓ Line 4 staging successful"
git diff --cached --stat
git reset
echo

echo "3. Testing multi-line staging..."
../../bin/run.js lines file-with-newline.txt 4-5
echo "✓ Lines 4-5 staging successful"
git diff --cached --stat
git reset
echo

echo "4. Testing binary file detection..."
echo "Attempting to list hunks for binary file..."
../../bin/run.js list binary-file.dat 2>&1 | grep -q "Cannot list hunks for binary file" && echo "✓ Binary file properly detected"
echo

echo "5. Testing untracked file support..."
echo "New file content" > new-untracked.txt
../../bin/run.js list new-untracked.txt
echo "✓ Untracked file support working"
git reset
rm new-untracked.txt
echo

echo "=== All integration tests passed\! ==="
