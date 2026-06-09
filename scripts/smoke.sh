#!/usr/bin/env bash
# Marina Stee — droplet-side smoke test.
#
# Runs FROM the droplet against localhost:4300 (the docker-compose
# host port). MUST run on the droplet itself, not from a GitHub
# Actions runner — runner IPs are blocked at the Cloudflare edge
# and would fail with a bot-challenge HTML page even when the app
# is healthy. CI SCPs this script up + execs it over SSH.
#
# Exits non-zero on first failed check so the deploy job marks
# failed. The compose `--force-recreate` swap takes ~60-90s, so
# we poll with 5s intervals up to 24 attempts (2 min total).
#
# Pattern A from CLAUDE.md §7.5.

set -euo pipefail

PORT="${PORT:-4300}"
URL="http://localhost:${PORT}"
MAX_ATTEMPTS=24
INTERVAL=5

echo "[smoke] target = ${URL}"
echo "[smoke] waiting up to $((MAX_ATTEMPTS * INTERVAL))s for container to be ready..."

attempt=1
while [ "$attempt" -le "$MAX_ATTEMPTS" ]; do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$URL" || echo "000")
  if [ "$code" = "200" ]; then
    echo "[smoke] OK — ${URL} → 200 on attempt ${attempt}"
    break
  fi
  echo "[smoke] attempt ${attempt}/${MAX_ATTEMPTS} — got ${code}, sleeping ${INTERVAL}s..."
  sleep "$INTERVAL"
  attempt=$((attempt + 1))
done

if [ "$attempt" -gt "$MAX_ATTEMPTS" ]; then
  echo "[smoke] FAILED — ${URL} never returned 200 after $((MAX_ATTEMPTS * INTERVAL))s"
  echo "[smoke] container logs (last 50 lines):"
  docker compose -f /opt/apps/marina-stee/docker-compose.yml logs --tail=50 app || true
  exit 1
fi

# Sanity-check a public route. Operator surfaces redirect when no
# Clerk session is present, so we hit a guaranteed-public one.
APPLY_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "${URL}/apply" || echo "000")
if [ "$APPLY_CODE" != "200" ]; then
  echo "[smoke] WARN — /apply returned ${APPLY_CODE} (expected 200)"
  exit 1
fi
echo "[smoke] OK — /apply → 200"

# Boater-facing routes must set Referrer-Policy: no-referrer per
# next.config.ts headers(). Verify the header is actually on the wire.
REFERRER=$(curl -s -I --max-time 5 "${URL}/apply" | tr -d '\r' | awk -F': ' 'tolower($1) == "referrer-policy" { print $2 }')
if [ "$REFERRER" != "no-referrer" ]; then
  echo "[smoke] FAILED — /apply Referrer-Policy = '${REFERRER}', expected 'no-referrer'"
  exit 1
fi
echo "[smoke] OK — /apply Referrer-Policy = no-referrer"

echo "[smoke] all checks passed"
