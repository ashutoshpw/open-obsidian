#!/usr/bin/env bash
# Point git at the repository's tracked hooks (.githooks/). Run once per clone.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
git config core.hooksPath .githooks
echo "Git hooks installed: core.hooksPath=.githooks"
