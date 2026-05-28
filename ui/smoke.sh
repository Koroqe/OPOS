#!/usr/bin/env bash
# OPOS Console smoke test — Slice 6.
#
# Boots the console on a free port against the framework's own repo,
# curls every route, asserts 200 + non-empty + no leftover "Stub:" markers,
# asserts 400 on validator-rejection URLs. Exits 0 on success.

set -euo pipefail

cd "$(dirname "$0")/.."

PORT=$(python3 -c "import socket; s=socket.socket(); s.bind(('127.0.0.1',0)); print(s.getsockname()[1]); s.close()")
echo "smoke: using port $PORT"

python3 ui/console.py --port "$PORT" --no-browser >/tmp/opos-smoke-server.log 2>&1 &
PID=$!
trap 'kill "$PID" 2>/dev/null || true; wait "$PID" 2>/dev/null || true' EXIT

# Wait for the server to be ready (up to 5s).
for i in 1 2 3 4 5; do
  if curl -sf -o /dev/null "http://127.0.0.1:$PORT/"; then
    break
  fi
  sleep 1
done

PASS=0
FAIL=0

check_200() {
  local path="$1"
  local body
  body=$(curl -sf "http://127.0.0.1:$PORT$path") || { echo "FAIL $path — non-2xx"; FAIL=$((FAIL+1)); return; }
  if [ -z "$body" ]; then
    echo "FAIL $path — empty body"; FAIL=$((FAIL+1)); return
  fi
  if echo "$body" | grep -qF "Stub:"; then
    echo "FAIL $path — leftover Stub: marker"; FAIL=$((FAIL+1)); return
  fi
  echo "PASS $path (200, non-empty, no stub)"
  PASS=$((PASS+1))
}

check_status() {
  local path="$1"
  local want="$2"
  local got
  got=$(curl -so /dev/null -w "%{http_code}" "http://127.0.0.1:$PORT$path")
  if [ "$got" = "$want" ]; then
    echo "PASS $path (status $got)"
    PASS=$((PASS+1))
  else
    echo "FAIL $path — got $got, want $want"
    FAIL=$((FAIL+1))
  fi
}

echo "--- 200 routes ---"
check_200 "/"
check_200 "/tasks"
check_200 "/tasks?state=active"
check_200 "/tasks/6"
check_200 "/agents"
check_200 "/agents/company/chief-of-staff"
check_200 "/skills"
check_200 "/skills/task-register"
check_200 "/departments"
check_200 "/departments/company"
check_200 "/activity"
check_200 "/static/console.css"

echo
echo "--- input-validation 400s ---"
check_status "/tasks/abc" 400
check_status "/agents/eng/..%2Fpasswd" 400
check_status "/activity?since=2026-13-99" 400

echo
# The _stub_handler fallback in __init__.py is intentional (covers
# routes added without explicit per-resource registration). The check
# below only flags stubs leaking into per-resource handler modules.
echo "--- no leftover Stub: in per-resource handler modules ---"
if grep -rF "Stub:" ui/handlers/ --exclude=__init__.py --exclude-dir=__pycache__ ; then
  echo "FAIL stub marker found in per-resource handler modules"
  FAIL=$((FAIL+1))
else
  echo "PASS no leftover Stub: markers in per-resource handler modules"
  PASS=$((PASS+1))
fi

echo
echo "summary: $PASS passed, $FAIL failed"
exit $((FAIL > 0))
