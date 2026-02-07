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
    echo "鈿狅笍  Warning: Unknown architecture $ARCH, using as-is"
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
    echo "鈿狅笍  Warning: Unknown OS $OS, using as-is"
    ;;
esac

PLATFORM="${OS}-${ARCH}"

# Set CARGO_TARGET_DIR if not defined
if [ -z "$CARGO_TARGET_DIR" ]; then
  CARGO_TARGET_DIR="target"
fi

echo "馃攳 Detected platform: $PLATFORM"
echo "馃敡 Using target directory: $CARGO_TARGET_DIR"

# Set API base URL for remote features
export VK_SHARED_API_BASE="https://api.agent-chatgroup.com"
export VITE_VK_SHARED_API_BASE="https://api.agent-chatgroup.com"

echo "馃Ч Cleaning previous builds..."
rm -rf npx-cli/dist
mkdir -p npx-cli/dist/$PLATFORM

echo "馃敤 Building frontend..."
(cd frontend && npm run build)

echo "馃敤 Building Rust binaries..."
cargo build --release --manifest-path Cargo.toml
cargo build --release --bin mcp_task_server --manifest-path Cargo.toml

echo "馃摝 Creating distribution package..."

# Copy the main binary
cp ${CARGO_TARGET_DIR}/release/server agent-chatgroup
zip -q agent-chatgroup.zip agent-chatgroup
rm -f agent-chatgroup 
mv agent-chatgroup.zip npx-cli/dist/$PLATFORM/agent-chatgroup.zip

# Copy the MCP binary
cp ${CARGO_TARGET_DIR}/release/mcp_task_server agent-chatgroup-mcp
zip -q agent-chatgroup-mcp.zip agent-chatgroup-mcp
rm -f agent-chatgroup-mcp
mv agent-chatgroup-mcp.zip npx-cli/dist/$PLATFORM/agent-chatgroup-mcp.zip

# Copy the Review CLI binary
cp ${CARGO_TARGET_DIR}/release/review agent-chatgroup-review
zip -q agent-chatgroup-review.zip agent-chatgroup-review
rm -f agent-chatgroup-review
mv agent-chatgroup-review.zip npx-cli/dist/$PLATFORM/agent-chatgroup-review.zip

echo "鉁?Build complete!"
echo "馃搧 Files created:"
echo "   - npx-cli/dist/$PLATFORM/agent-chatgroup.zip"
echo "   - npx-cli/dist/$PLATFORM/agent-chatgroup-mcp.zip"
echo "   - npx-cli/dist/$PLATFORM/agent-chatgroup-review.zip"
echo ""
echo "馃殌 To test locally, run:"
echo "   cd npx-cli && node bin/cli.js"


