#!/usr/bin/env bash
# Slice 8: PRE-validate the release-from-changelog title heuristic against
# three synthetic CHANGELOG fixtures before any live release uses it.
#
# Heuristic (must match SKILL.md step 5 exactly):
#   - First `### ` subheading whose name is NOT in the reserved Keep-a-
#     Changelog set wins.
#   - Reserved: Added, Changed, Removed, Deprecated, Fixed, Security,
#     Notes, Migration.
#   - If only reserved names exist (or none), title is empty → caller
#     falls back to bare VERSION.

set -euo pipefail

VERSION="v9.9.9"
PASS=0
FAIL=0

derive_title() {
  awk '
    /^### / {
      name = substr($0, 5)
      if (name !~ /^(Added|Changed|Removed|Deprecated|Fixed|Security|Notes|Migration)$/) {
        print name
        exit
      }
    }'
}

check() {
  local name="$1"
  local expected="$2"
  local input="$3"
  local got
  got=$(printf "%s" "$input" | derive_title)
  if [ "$got" = "$expected" ]; then
    echo "PASS $name (got: '$got')"
    PASS=$((PASS+1))
  else
    echo "FAIL $name (got: '$got', expected: '$expected')"
    FAIL=$((FAIL+1))
  fi
}

# 1. Added-only → no non-reserved heading → empty (caller falls back to bare $VERSION).
check "added-only" "" "$(cat <<'EOF'
## [9.9.9] - 2026-01-01

### Added

- a thing

EOF
)"

# 2. Notes-only → reserved → empty (caller falls back to bare $VERSION).
check "notes-only" "" "$(cat <<'EOF'
## [9.9.9] - 2026-01-01

### Notes

- a note

EOF
)"

# 3. Notes-then-arbitrary → MyCustomTitle wins (first non-reserved heading).
check "notes-then-arbitrary" "MyCustomTitle" "$(cat <<'EOF'
## [9.9.9] - 2026-01-01

### Notes

- a note

### Migration

- a migration step

### MyCustomTitle

- the actual title content

EOF
)"

echo
echo "summary: $PASS passed, $FAIL failed"
exit $((FAIL > 0))
