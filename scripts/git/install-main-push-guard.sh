#!/usr/bin/env sh
set -eu

root=$(git rev-parse --show-toplevel)
hook_path=$(git rev-parse --git-path hooks/pre-push)
source_hook="$root/scripts/git/pre-push-main-guard"

if [ -e "$hook_path" ] && ! grep -q '^# f-trade-main-push-guard$' "$hook_path"; then
  echo "Refusing to overwrite existing pre-push hook: $hook_path" >&2
  exit 1
fi

mkdir -p "$(dirname "$hook_path")"
install -m 755 "$source_hook" "$hook_path"
echo "Installed local main push guard: $hook_path"
