#!/usr/bin/env bash
# Custom updater: merge latest upstream release tag into the think-fix branch,
# verify, build, and install locally. Replaces opencode's built-in autoupdate,
# which overwrites this custom build with the official release.
#
# Usage:
#   ./sync-and-install.sh           sync + build + install if a newer tag exists
#   ./sync-and-install.sh --check   report only, change nothing
#   ./sync-and-install.sh --force   rebuild + reinstall even if already current
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRANCH="fix/render-think-tags-as-reasoning"
# Install over the official location so this build wins regardless of PATH order.
TARGET="${OPENCODE_INSTALL_DIR:-$HOME/.opencode/bin}/opencode"
UPSTREAM="upstream"
UPSTREAM_URL="https://github.com/anomalyco/opencode.git"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"

MODE="sync"
case "${1:-}" in
  --check) MODE="check" ;;
  --force) MODE="force" ;;
  "") ;;
  *) echo "error: unknown flag '$1' (expected --check or --force)" >&2; exit 2 ;;
esac

cd "$REPO"

# A fresh clone only has `origin`; add the release source on first run.
git remote get-url "$UPSTREAM" >/dev/null 2>&1 ||
  { echo "==> adding remote '$UPSTREAM' -> $UPSTREAM_URL"; git remote add "$UPSTREAM" "$UPSTREAM_URL"; }

echo "==> fetching $UPSTREAM tags"
git fetch --quiet "$UPSTREAM" --tags

# Highest semver release tag. Sorted numerically so v1.18.9 < v1.18.20.
# Read the full list and slice the first line; piping to `head` would SIGPIPE git under pipefail.
TAGS="$(git tag --list 'v[0-9]*.[0-9]*.[0-9]*' --sort=-v:refname)"
LATEST_TAG="${TAGS%%$'\n'*}"
[[ -n "$LATEST_TAG" ]] || { echo "error: no release tag found" >&2; exit 1; }
LATEST_VERSION="${LATEST_TAG#v}"

# Installed version looks like "1.18.19-think.202608211521"; strip the suffix.
INSTALLED_OUT="$("$TARGET" --version 2>/dev/null || true)"
INSTALLED_RAW="${INSTALLED_OUT##*$'\n'}"
INSTALLED_BASE="${INSTALLED_RAW%%-think.*}"

echo "    latest upstream : $LATEST_VERSION"
echo "    installed       : ${INSTALLED_RAW:-none}"

if [[ "$MODE" == "check" ]]; then
  [[ "$INSTALLED_BASE" == "$LATEST_VERSION" ]] && { echo "up to date"; exit 0; }
  echo "update available: $LATEST_VERSION"
  exit 0
fi

if [[ "$INSTALLED_BASE" == "$LATEST_VERSION" && "$MODE" != "force" ]]; then
  echo "up to date, nothing to do (use --force to rebuild)"
  exit 0
fi

[[ -z "$(git status --porcelain)" ]] ||
  { echo "error: working tree dirty, commit or stash first" >&2; exit 1; }

git checkout --quiet "$BRANCH"

# Merge, not rebase: preserves the branch history and avoids replaying the
# think-fix commits against every upstream release.
if git merge-base --is-ancestor "$LATEST_TAG" HEAD; then
  echo "==> $LATEST_TAG already merged"
else
  # In a partial clone, blobs are lazily fetched from the `origin` promisor, which
  # does not have the new upstream release yet. Pull them from upstream first.
  if [[ -n "$(git config --get-regexp 'remote\..*\.partialclonefilter' || true)" ]]; then
    echo "==> partial clone: fetching $LATEST_TAG blobs from $UPSTREAM"
    git fetch --quiet --no-filter "$UPSTREAM" tag "$LATEST_TAG"
  fi

  echo "==> merging $LATEST_TAG into $BRANCH"
  if ! git merge "$LATEST_TAG" --no-edit; then
    # A blob-fetch failure aborts before MERGE_HEAD exists, so the abort may be a no-op.
    git merge --abort 2>/dev/null || true
    echo "error: merge conflict with $LATEST_TAG, aborted. Resolve manually:" >&2
    echo "       git merge $LATEST_TAG   # then rerun $0 --force" >&2
    exit 1
  fi
fi

echo "==> installing deps"
bun install

echo "==> verifying"
(cd packages/core && bun test test/util/think.test.ts)
bun turbo typecheck --filter=@opencode-ai/core --filter=@opencode-ai/tui --filter=@opencode-ai/session-ui --filter=opencode

VERSION="${LATEST_VERSION}-think.$(date +%Y%m%d%H%M)"

echo "==> building $VERSION"
(cd packages/opencode && OPENCODE_VERSION="$VERSION" bun run build --single --skip-install)

# build.ts --single emits dist/opencode-<os>-<arch>/, named after the host platform.
case "$(uname -s)" in
  Darwin) BUILD_OS="darwin" ;;
  Linux) BUILD_OS="linux" ;;
  *) echo "error: unsupported OS $(uname -s)" >&2; exit 1 ;;
esac
case "$(uname -m)" in
  arm64 | aarch64) BUILD_ARCH="arm64" ;;
  x86_64) BUILD_ARCH="x64" ;;
  *) echo "error: unsupported arch $(uname -m)" >&2; exit 1 ;;
esac

BUILT="packages/opencode/dist/opencode-${BUILD_OS}-${BUILD_ARCH}/bin/opencode"
[[ -f "$BUILT" ]] || { echo "error: build artifact missing at $BUILT" >&2; exit 1; }

# Built-in autoupdate detects this install path as "curl" and would silently
# replace the custom build with the official release, so it must stay off.
echo "==> checking autoupdate config"
CONFIG_FILE=""
for name in opencode.json opencode.jsonc; do
  [[ -f "$CONFIG_DIR/$name" ]] && { CONFIG_FILE="$CONFIG_DIR/$name"; break; }
done

if [[ -z "$CONFIG_FILE" ]]; then
  mkdir -p "$CONFIG_DIR"
  cat > "$CONFIG_DIR/opencode.json" <<'JSON'
{
  "$schema": "https://opencode.ai/config.json",
  "autoupdate": false
}
JSON
  echo "    created $CONFIG_DIR/opencode.json with autoupdate disabled"
else
  # jsonc-parser edits the single key in place, preserving comments and formatting.
  (cd packages/core && CONFIG_FILE="$CONFIG_FILE" bun -e '
    const { applyEdits, modify, parse } = await import("jsonc-parser")
    const file = process.env.CONFIG_FILE
    const text = await Bun.file(file).text()
    const errors = []
    const config = parse(text, errors, { allowTrailingComma: true })
    if (errors.length || typeof config !== "object" || config === null) {
      console.error(`error: cannot parse ${file}, set "autoupdate": false manually`)
      process.exit(1)
    }
    if (config.autoupdate === false) {
      console.log("    autoupdate already disabled")
      process.exit(0)
    }
    await Bun.write(`${file}.bak`, text)
    const edits = modify(text, ["autoupdate"], false, {
      formattingOptions: { insertSpaces: true, tabSize: 2 },
    })
    await Bun.write(file, applyEdits(text, edits))
    console.log(`    autoupdate disabled (backup at ${file}.bak)`)
  ')
fi

echo "==> installing to $TARGET"
mkdir -p "$(dirname "$TARGET")"
install -m755 "$BUILT" "$TARGET"
"$TARGET" --version

# Earlier versions of this script installed here; a leftover copy can shadow the
# real target depending on PATH order.
STALE="$HOME/.local/bin/opencode"
[[ "$STALE" != "$TARGET" && -e "$STALE" ]] &&
  echo "note: stale binary at $STALE may shadow $TARGET, remove it with: rm $STALE"

echo
echo "done. push with: git push origin $BRANCH"
