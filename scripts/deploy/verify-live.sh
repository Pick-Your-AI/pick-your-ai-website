#!/usr/bin/env bash
# Verifies the live site through Cloudflare after an activation.
# Usage: verify-live.sh <expected-sha> [base-url]
# Exits non-zero (and prints why) unless every check passes.
set -uo pipefail

SHA="${1:?expected sha}"
BASE="${2:-${PRODUCTION_URL:-https://pickyour.ai}}"
BASE="${BASE%/}"
HOST="${BASE#https://}"
ATTEMPTS="${VERIFY_ATTEMPTS:-12}"
SLEEP="${VERIFY_SLEEP:-5}"
UA="pickyour-deploy-verify/1.0 (+https://github.com/Pick-Your-AI/pickyour.ai)"
fail=0

c() { curl -sS --proto '=https' --tlsv1.2 -A "$UA" -H 'Cache-Control: no-cache' -H 'Pragma: no-cache' "$@"; }
ok() { echo "  ok   $*"; }
bad() { echo "  FAIL $*"; fail=1; }

echo "Verifying $BASE serves commit $SHA"

# 1. version.json (cache-busted) must report the expected commit. Retry while the edge/origin settle.
live=""
for i in $(seq 1 "$ATTEMPTS"); do
  live="$(c --max-time 15 "$BASE/version.json?v=$SHA-$(date +%s)-$i" | python3 -c 'import json,sys; print(json.load(sys.stdin)["commit"])' 2>/dev/null || true)"
  [ "$live" = "$SHA" ] && break
  echo "  ..   attempt $i: live commit '${live:-<none>}', waiting ${SLEEP}s"
  sleep "$SLEEP"
done
[ "$live" = "$SHA" ] && ok "version.json commit = $SHA" || bad "version.json commit '${live:-<none>}' != $SHA"

# 2. Home page over HTTPS: 200, HTML, revalidating cache policy, security headers.
hdr="$(c -o /tmp/pyai-index.html -D - --max-time 15 "$BASE/?v=$SHA")"
code="$(printf '%s' "$hdr" | head -1 | awk '{print $2}')"
[ "$code" = "200" ] && ok "GET / → 200" || bad "GET / → $code"
grep -qi '^content-type: text/html' <<<"$hdr" && ok "/ is text/html" || bad "/ content-type"
grep -qi '^cache-control:.*no-cache' <<<"$hdr" && ok "/ Cache-Control no-cache" || bad "/ missing Cache-Control no-cache"
for h in content-security-policy x-content-type-options referrer-policy permissions-policy strict-transport-security; do
  grep -qi "^$h:" <<<"$hdr" && ok "header $h" || bad "missing header $h"
done
grep -q 'id="root"' /tmp/pyai-index.html && ok "index.html has #root" || bad "index.html has no #root"

# 3. Every asset referenced by index.html loads (200, immutable cache).
assets="$(grep -oE '/assets/[^"'"'"' >]+' /tmp/pyai-index.html | sort -u)"
[ -n "$assets" ] || bad "no /assets/ references in index.html"
for a in $assets; do
  ah="$(c -o /dev/null -D - --max-time 15 "$BASE$a")"
  acode="$(printf '%s' "$ah" | head -1 | awk '{print $2}')"
  [ "$acode" = "200" ] && ok "GET $a → 200" || bad "GET $a → $acode"
  grep -qi '^cache-control:.*immutable' <<<"$ah" || bad "$a not served immutable"
done

# 4. SPA deep links refresh to index.html (200 HTML), unknown asset is a real 404.
for route in /builder /catalog /compare /methodology /about "/some/unknown/deep/link"; do
  rcode="$(c -o /tmp/pyai-route.html -w '%{http_code}' --max-time 15 "$BASE$route")"
  if [ "$rcode" = "200" ] && grep -q 'id="root"' /tmp/pyai-route.html; then ok "deep link $route → 200 SPA"; else bad "deep link $route → $rcode"; fi
done
mcode="$(c -o /dev/null -w '%{http_code}' --max-time 15 "$BASE/assets/does-not-exist-$SHA.js")"
[ "$mcode" = "404" ] && ok "missing asset → 404" || bad "missing asset → $mcode (expected 404)"

# 5. Canonical redirects: http → https and www → apex.
loc="$(curl -sS -o /dev/null -w '%{http_code} %{redirect_url}' -A "$UA" --max-time 15 "http://$HOST/builder")"
[[ "$loc" == 30[18]\ https://$HOST/builder ]] && ok "http → https ($loc)" || bad "http redirect: $loc"
loc="$(c -o /dev/null -w '%{http_code} %{redirect_url}' --max-time 15 "https://www.$HOST/builder?x=1")"
[[ "$loc" == "301 https://$HOST/builder?x=1" ]] && ok "www → apex ($loc)" || bad "www redirect: $loc"

# 6. Preserved paths are not swallowed by the SPA fallback.
wk="$(c -o /tmp/pyai-wk -w '%{http_code}' --max-time 15 "$BASE/.well-known/pyai-nonexistent")"
if [ "$wk" != "200" ] || ! grep -q 'id="root"' /tmp/pyai-wk; then ok "/.well-known not rewritten ($wk)"; else bad "/.well-known served SPA"; fi

if [ "$fail" -ne 0 ]; then echo "Live verification FAILED"; exit 1; fi
echo "Live verification passed for $SHA"
