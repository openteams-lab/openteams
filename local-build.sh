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

echo "🧹 Cleaning previous builds..."
rm -rf agents-chatgroup-npx/dist
mkdir -p agents-chatgroup-npx/dist/$PLATFORM

echo "🏗️ Building frontend..."
(cd frontend && npm run build)

echo "🏗️ Building Rust binaries..."
cargo build --release --manifest-path Cargo.toml
cargo build --release --bin mcp_task_server --manifest-path Cargo.toml

echo "📦 Creating distribution package..."

# Copy the main binary
cp ${CARGO_TARGET_DIR}/release/server agents-chatgroup
zip -q agents-chatgroup.zip agents-chatgroup
rm -f agents-chatgroup 
mv agents-chatgroup.zip agents-chatgroup-npx/dist/$PLATFORM/agents-chatgroup.zip

# Copy the MCP binary
cp ${CARGO_TARGET_DIR}/release/mcp_task_server agents-chatgroup-mcp
zip -q agents-chatgroup-mcp.zip agents-chatgroup-mcp
rm -f agents-chatgroup-mcp
mv agents-chatgroup-mcp.zip agents-chatgroup-npx/dist/$PLATFORM/agents-chatgroup-mcp.zip

# Copy the Review CLI binary
cp ${CARGO_TARGET_DIR}/release/review agents-chatgroup-review
zip -q agents-chatgroup-review.zip agents-chatgroup-review
rm -f agents-chatgroup-review
mv agents-chatgroup-review.zip agents-chatgroup-npx/dist/$PLATFORM/agents-chatgroup-review.zip

echo "✅ Build complete!"
echo "📋 Files created:"
echo "   - agents-chatgroup-npx/dist/$PLATFORM/agents-chatgroup.zip"
echo "   - agents-chatgroup-npx/dist/$PLATFORM/agents-chatgroup-mcp.zip"
echo "   - agents-chatgroup-npx/dist/$PLATFORM/agents-chatgroup-review.zip"
echo ""
echo "🚀 To test locally, run:"
echo "   cd agents-chatgroup-npx && node bin/cli.js"


