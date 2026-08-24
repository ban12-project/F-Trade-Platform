#!/usr/bin/env sh
set -eu

hook="scripts/git/pre-push-main-guard"

printf '%s\n' 'refs/heads/feature abc refs/heads/feature def' | sh "$hook"
if printf '%s\n' 'refs/heads/main abc refs/heads/main def' | sh "$hook"; then
  echo 'Expected direct main push to be blocked' >&2
  exit 1
fi
if printf '%s\n' '(delete) abc refs/heads/main def' | sh "$hook"; then
  echo 'Expected main deletion to be blocked' >&2
  exit 1
fi

echo 'PASS local main push guard'
