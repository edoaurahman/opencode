#!/usr/bin/env bash
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRANCH="fix/render-think-tags-as-reasoning"
TARGET="${OPENCODE_INSTALL_DIR:-$HOME/.local/bin}/opencode"

cd "$REPO"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "error: working tree dirty, commit or stash first" >&2
  exit 1
fi

echo "==> fetching upstream"
git fetch upstream dev

echo "==> rebasing $BRANCH onto upstream/dev"
git checkout "$BRANCH"
if ! git rebase upstream/dev; then
  echo "error: rebase conflict. resolve, then: git rebase --continue && $0" >&2
  exit 1
fi

echo "==> installing deps"
bun install

echo "==> verifying"
(cd packages/core && bun test test/util/think.test.ts)
bun turbo typecheck --filter=@opencode-ai/core --filter=@opencode-ai/tui --filter=@opencode-ai/session-ui --filter=opencode

BASE_VERSION="$(git show upstream/dev:packages/opencode/package.json | grep '"version"' | head -1 | sed 's/.*"version": "\(.*\)".*/\1/')"
VERSION="${BASE_VERSION}-think.$(date +%Y%m%d%H%M)"

echo "==> building $VERSION"
cd packages/opencode
OPENCODE_VERSION="$VERSION" bun run build --single --skip-install

echo "==> installing to $TARGET"
install -m755 "dist/opencode-linux-x64/bin/opencode" "$TARGET"
"$TARGET" --version

echo
echo "done. push with: git push --force-with-lease origin $BRANCH"
