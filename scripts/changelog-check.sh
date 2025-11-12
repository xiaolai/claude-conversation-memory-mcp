#!/bin/bash
# Changelog checker - Verifies CHANGELOG.md is up to date for releases

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get the current version from package.json
CURRENT_VERSION=$(node -p "require('./package.json').version")

# Check if CHANGELOG.md exists
if [ ! -f "CHANGELOG.md" ]; then
  echo -e "${RED}❌ CHANGELOG.md not found${NC}"
  exit 1
fi

# Check if current version is documented in CHANGELOG
if ! grep -q "\[$CURRENT_VERSION\]" CHANGELOG.md; then
  echo -e "${YELLOW}⚠️  Warning: Version $CURRENT_VERSION not found in CHANGELOG.md${NC}"
  echo ""
  echo "Please add an entry for version $CURRENT_VERSION to CHANGELOG.md"
  echo ""
  echo "Template:"
  echo "----------------------------------------"
  echo "## [$CURRENT_VERSION] - $(date +%Y-%m-%d)"
  echo ""
  echo "### Added"
  echo "- New feature description"
  echo ""
  echo "### Changed"
  echo "- Changed functionality description"
  echo ""
  echo "### Fixed"
  echo "- Bug fix description"
  echo "----------------------------------------"
  echo ""
  exit 1
fi

# Check if [Unreleased] section has content
UNRELEASED_CONTENT=$(sed -n '/## \[Unreleased\]/,/## \[[0-9]/p' CHANGELOG.md | grep -v "^## " | grep -v "^$" | wc -l)

if [ "$UNRELEASED_CONTENT" -gt 0 ]; then
  echo -e "${YELLOW}⚠️  [Unreleased] section has content${NC}"
  echo ""
  echo "Remember to move unreleased changes to the versioned section before releasing"
  echo ""
fi

# Success
echo -e "${GREEN}✅ CHANGELOG.md looks good for version $CURRENT_VERSION${NC}"

# Show recent entries
echo ""
echo "Recent entries:"
echo "----------------------------------------"
sed -n '/## \['$CURRENT_VERSION'\]/,/^## /p' CHANGELOG.md | head -20
echo "----------------------------------------"
