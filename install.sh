#!/bin/sh
# dsh-models installer — git-channel install through the dsh CLI.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/taxueseek/dsh-models/main/install.sh | sh
#   sh install.sh [--profile <name>]   (default profile: web; Windows: Git Bash)
#
# Why the git channel: the npm name "dsh-models" is currently held by an
# unrelated placeholder package (0.0.1, "name reserved"), so installs
# MUST go through git+https — the npm channel would silently install the
# wrong package.
set -eu

PROFILE="web"
while [ $# -gt 0 ]; do
  case "$1" in
    --profile)
      [ $# -ge 2 ] || { echo "[dsh-models] error: --profile needs a value" >&2; exit 1; }
      PROFILE="$2"; shift 2 ;;
    --profile=*)
      PROFILE="${1#*=}"; shift ;;
    -h|--help)
      echo "usage: install.sh [--profile <name>]  (default: web)"; exit 0 ;;
    *)
      echo "[dsh-models] error: unknown argument '$1' (usage: install.sh [--profile <name>])" >&2; exit 1 ;;
  esac
done

say() { printf '[dsh-models] %s\n' "$*"; }

if ! command -v dsh >/dev/null 2>&1; then
  say "error: dsh CLI not found on PATH."
  say "install DeepSeek Harness first:  npm install -g @deepseek-ai/dsh"
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  say "error: pnpm not found on PATH (dsh plugin manages profile packages through pnpm)."
  say "install pnpm first:  npm install -g pnpm"
  exit 1
fi

say "installing dsh-models into profile \"$PROFILE\" via the git channel..."
exec dsh plugin --profile "$PROFILE" add git+https://github.com/taxueseek/dsh-models.git
