#!/usr/bin/env bash
# Read an operator-owned opt-in from the persistent managed Sandbox filesystem.
set -euo pipefail
directory=${1:?persistent configuration directory required}
marker="$directory/native-profile.enabled"
if ! test -e "$marker" && ! test -L "$marker"; then
  printf '0\n'
  exit 0
fi
test -f "$marker"
test ! -L "$marker"
test "$(stat -c '%a:%u' "$marker")" = "600:$(id -u)"
test "$(cat "$marker")" = 1
printf '1\n'
