#!/usr/bin/env bash

set -e

echo "🧪 Setting up comprehensive test environment..."

# Clean and create test directory
cd "$(dirname "$0")"
rm -rf tmp/test-repo
mkdir -p tmp/test-repo
cd tmp/test-repo

# Initialize git repo
git init
git config user.name "Test User"
git config user.email "test@example.com"

echo "📝 Creating test files with various EOF conditions..."

# 1. File with proper newline at end
cat > file-with-newline.txt << 'EOF'
Line 1
Line 2
Line 3
EOF

# 2. File without newline at end
printf "Line 1\nLine 2\nLine 3" > file-without-newline.txt

# 3. Empty file
touch empty-file.txt

# 4. Single line with newline
echo "Single line" > single-line-with-newline.txt

# 5. Single line without newline
printf "Single line" > single-line-without-newline.txt

# 6. Binary file
echo -e '\x00\x01\x02\x03\x04\x05' > binary-file.dat

# 7. Mixed content file for complex testing
cat > mixed-file.txt << 'EOF'
First line
Second line
Third line
Fourth line
Fifth line
Sixth line
Seventh line
Eighth line
Ninth line
Tenth line
EOF

# Initial commit
git add .
git commit -m "Initial commit with various file types"

echo "📝 Creating changes for staging tests..."

# Modify files to create test scenarios

# 1. Add content to file with newline
cat >> file-with-newline.txt << 'EOF'
Line 4 added
Line 5 added
EOF

# 2. Add content to file without newline (keeping no newline)
printf "\nLine 4 added\nLine 5 added" >> file-without-newline.txt

# 3. Add content to empty file
echo "No longer empty" > empty-file.txt

# 4. Modify single line files
echo "Modified single line" > single-line-with-newline.txt
printf "Modified single line" > single-line-without-newline.txt

# 5. Modify binary file
echo -e '\x06\x07\x08\x09' >> binary-file.dat

# 6. Complex modifications to mixed file
cat > mixed-file.txt << 'EOF'
First line
Second line MODIFIED
Third line
Fourth line DELETED
Fifth line
New line inserted here
Sixth line
Seventh line MODIFIED
Eighth line
Ninth line
Tenth line
Another new line at end
EOF

# 7. Create new untracked file
cat > new-file.txt << 'EOF'
This is a new file
It has multiple lines
Some will be staged
Others will not
EOF

# 8. Create new file without newline
printf "New file without newline at end" > new-file-no-newline.txt

echo "✅ Test environment ready!"
echo ""
echo "📊 Current status:"
git status --short

echo ""
echo "📋 Test scenarios available:"
echo "1. file-with-newline.txt - File ending with newline"
echo "2. file-without-newline.txt - File ending without newline"
echo "3. empty-file.txt - Empty file modified"
echo "4. single-line-*.txt - Single line files"
echo "5. binary-file.dat - Binary file"
echo "6. mixed-file.txt - Complex modifications"
echo "7. new-file*.txt - Untracked files"