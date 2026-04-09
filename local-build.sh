#!/bin/bash

set -e  # Exit on any error

# Detect OS and architecture
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

# Map architecture names
case "$ARCH" in
  x86_64)
    ARCH="x64"
    ;;
  arm64|aarch64)
    ARCH="arm64"
    ;;
  *)
    echo "⚠️  Warning: Unknown architecture $ARCH, using as-is"
    ;;
esac

# Map OS names
case "$OS" in
  linux)
    OS="linux"
    ;;
  darwin)
    OS="macos"
    ;;
  *)
    echo "⚠️  Warning: Unknown OS $OS, using as-is"
    ;;
esac

PLATFORM="${OS}-${ARCH}"

# Set CARGO_TARGET_DIR if not defined
if [ -z "$CARGO_TARGET_DIR" ]; then
  CARGO_TARGET_DIR="target"
fi

echo "📍 Detected platform: $PLATFORM"
echo "📂 Using target directory: $CARGO_TARGET_DIR"

NPX_PACKAGE_DIR="npx/openteams-npx"

echo "🧹 Cleaning previous builds..."
rm -rf "$NPX_PACKAGE_DIR/dist"
mkdir -p "$NPX_PACKAGE_DIR/dist/$PLATFORM"

echo "🏗️ Building frontend..."
(cd frontend && npm run build)

echo "🏗️ Building Rust binaries..."
cargo build --release --manifest-path Cargo.toml
cargo build --release --bin mcp_task_server --manifest-path Cargo.toml

echo "📦 Creating distribution package..."

# Copy the main binary
cp ${CARGO_TARGET_DIR}/release/server openteams
zip -q openteams.zip openteams
rm -f openteams 
mv openteams.zip "$NPX_PACKAGE_DIR/dist/$PLATFORM/openteams.zip"

# Copy the MCP binary
cp ${CARGO_TARGET_DIR}/release/mcp_task_server openteams-mcp
zip -q openteams-mcp.zip openteams-mcp
rm -f openteams-mcp
mv openteams-mcp.zip "$NPX_PACKAGE_DIR/dist/$PLATFORM/openteams-mcp.zip"

# Copy the Review CLI binary
cp ${CARGO_TARGET_DIR}/release/review openteams-review
zip -q openteams-review.zip openteams-review
rm -f openteams-review
mv openteams-review.zip "$NPX_PACKAGE_DIR/dist/$PLATFORM/openteams-review.zip"

echo "✅ Build complete!"
echo "📋 Files created:"
echo "   - $NPX_PACKAGE_DIR/dist/$PLATFORM/openteams.zip"
echo "   - $NPX_PACKAGE_DIR/dist/$PLATFORM/openteams-mcp.zip"
echo "   - $NPX_PACKAGE_DIR/dist/$PLATFORM/openteams-review.zip"
echo ""
echo "🚀 To test locally, run:"
echo "   cd $NPX_PACKAGE_DIR && node bin/cli.js"

