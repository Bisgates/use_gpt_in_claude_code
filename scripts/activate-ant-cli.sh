#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI_PATH="$REPO_DIR/cli-ant.js"

if [[ ! -f "$CLI_PATH" ]]; then
  echo "Expected launcher at $CLI_PATH" >&2
  exit 1
fi

TARGET_DIR="/opt/homebrew/bin"
ANT_LINK="$TARGET_DIR/claude-codex-ant"

mkdir -p "$TARGET_DIR"
chmod +x "$CLI_PATH"
ln -snf "$CLI_PATH" "$ANT_LINK"

echo "Ant launcher -> $CLI_PATH"
