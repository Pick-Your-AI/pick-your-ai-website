#!/usr/bin/env bash
# Server-side release manager for PickYour.AI on GoDaddy cPanel shared hosting.
# Runs on the host over SSH, streamed by the workflow:  ssh host 'bash -s' -- <cmd> [args] < remote-release.sh
#
# Layout (all under the deploy user's home; nothing outside DOCROOT and RELEASES is touched):
#   ~/pickyour-releases/<sha>/          one immutable copy of dist/ per commit
#   ~/pickyour-releases/.state/current  sha of the active release
#   ~/pickyour-releases/.state/previous sha that was active before it (rollback target)
#   ~/pickyour-releases/.state/restore  sha that was live when the last activation started
#   ~/pickyour-releases/.state/log      append-only activation log
#   ~/pickyour-releases/backups/        tarball of the docroot taken before each activation
#
# Commands:
#   prepare <sha>            print the staging dir to rsync into (creates it)
#   finalize <sha>           move the staged upload into place as releases/<sha>
#   validate <sha>           check the release is complete and stamped with <sha>
#   activate <sha>           back up docroot, then sync releases/<sha> into it
#   restore                  return to what was live before the last activation (or empty docroot)
#   status                   print current/previous/available releases
#   prune [keep]             keep the newest <keep> releases (default 5) plus current/previous
set -euo pipefail
umask 022

DOCROOT="${PYAI_DOCROOT:-$HOME/public_html/pickyour.ai}"
RELEASES="$HOME/pickyour-releases"
STATE="$RELEASES/.state"
BACKUPS="$RELEASES/backups"
LOCK="$RELEASES/.lock"
PRESERVE=(.well-known cgi-bin)

die() { echo "remote-release: $*" >&2; exit 1; }
log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*" >>"$STATE/log"; echo "$*"; }
need_sha() { [[ "${1:-}" =~ ^[0-9a-f]{40}$ ]] || die "expected a full 40-char commit sha, got '${1:-}'"; }

# Safety rails: refuse to run against anything but the addon docroot.
[[ "$DOCROOT" == "$HOME/public_html/pickyour.ai" ]] || die "unexpected docroot $DOCROOT"
[ -d "$DOCROOT" ] || die "docroot $DOCROOT does not exist"
mkdir -p "$STATE" "$BACKUPS"

# One release operation at a time, even if two workflows race past GitHub's concurrency group.
exec 9>"$LOCK"
flock -w 300 9 || die "timed out waiting for release lock"

excludes() { for p in "${PRESERVE[@]}"; do printf -- '--exclude=/%s\n' "$p"; done; }

sync_into_docroot() {
  local src="$1"
  # --delay-updates stages every changed file and renames them all at the end, so the
  # docroot flips from old to new in one short burst; --delete-delay removes stale files
  # afterwards. Excluded paths (.well-known, cgi-bin) are never modified or deleted.
  mapfile -t ex < <(excludes)
  rsync -a --delete-delay --delay-updates "${ex[@]}" "$src/" "$DOCROOT/"
}

backup_docroot() {
  local stamp; stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  tar -C "$DOCROOT" --exclude=./.well-known --exclude=./cgi-bin -czf "$BACKUPS/docroot-$stamp.tgz" .
  # Keep the 5 most recent backups.
  ls -1t "$BACKUPS"/docroot-*.tgz 2>/dev/null | tail -n +6 | xargs -r rm -f --
}

validate() {
  local sha="$1" dir="$RELEASES/$1"
  [ -d "$dir" ] || die "release $sha not found on host"
  [ -s "$dir/index.html" ] || die "release $sha has no index.html"
  [ -s "$dir/.htaccess" ] || die "release $sha has no .htaccess"
  [ -d "$dir/assets" ] || die "release $sha has no assets/"
  ls "$dir"/assets/*.js >/dev/null 2>&1 || die "release $sha has no JS assets"
  python3 - "$dir/version.json" "$sha" <<'PY' || die "release $sha version.json does not match"
import json, sys
v = json.load(open(sys.argv[1]))
assert v["commit"] == sys.argv[2], f"commit {v['commit']} != {sys.argv[2]}"
for k in ("builtAt", "contractVersion", "contractSourceSha", "dataMode"):
    assert v.get(k), f"missing {k}"
PY
  # Every asset referenced by index.html must exist in the release.
  local ref
  for ref in $(grep -oE '/assets/[^"'"'"' >]+' "$dir/index.html" | sort -u); do
    [ -f "$dir$ref" ] || die "index.html references missing $ref"
  done
  echo "release $sha valid"
}

cmd="${1:-}"; shift || true
case "$cmd" in
  prepare)
    need_sha "${1:-}"
    staging="$RELEASES/.incoming-$1"
    rm -rf "$staging"
    # Seed from the newest existing release so rsync only transfers what changed.
    seed="$(cat "$STATE/current" 2>/dev/null || true)"
    if [ -n "$seed" ] && [ -d "$RELEASES/$seed" ]; then cp -a "$RELEASES/$seed" "$staging"; else mkdir -p "$staging"; fi
    echo "$staging"
    ;;
  finalize)
    need_sha "${1:-}"
    staging="$RELEASES/.incoming-$1"
    [ -d "$staging" ] || die "nothing staged for $1"
    rm -rf "${RELEASES:?}/$1"
    mv "$staging" "$RELEASES/$1"
    touch "$RELEASES/$1"
    echo "finalized $1"
    ;;
  validate)
    need_sha "${1:-}"; validate "$1"
    ;;
  activate)
    need_sha "${1:-}"; sha="$1"
    validate "$sha" >/dev/null
    cur="$(cat "$STATE/current" 2>/dev/null || true)"
    # Record what is live *before* touching the docroot, so `restore` returns to it even if
    # this activation dies halfway through.
    echo "$cur" >"$STATE/restore"
    backup_docroot
    if [ "$cur" != "$sha" ]; then echo "$cur" >"$STATE/previous"; fi
    echo "$sha" >"$STATE/current"
    sync_into_docroot "$RELEASES/$sha"
    for p in "${PRESERVE[@]}"; do [ -e "$DOCROOT/$p" ] || die "preserved path $p missing after activation"; done
    log "activated $sha (was: ${cur:-none})"
    ;;
  restore)
    # Return to whatever was live before the most recent activation.
    target="$(cat "$STATE/restore" 2>/dev/null || true)"
    failed="$(cat "$STATE/current" 2>/dev/null || true)"
    if [ -n "$target" ] && [ -d "$RELEASES/$target" ]; then
      validate "$target" >/dev/null
      sync_into_docroot "$RELEASES/$target"
      echo "$target" >"$STATE/current"
      log "restored $target (replacing ${failed:-none})"
    else
      # First-ever deploy failed: return the docroot to its pre-deploy state
      # (only the preserved .well-known and cgi-bin).
      empty="$(mktemp -d)"
      sync_into_docroot "$empty"
      rmdir "$empty"
      : >"$STATE/current"
      log "restored empty docroot (nothing was live before; replaced ${failed:-none})"
    fi
    ;;
  status)
    echo "current=$(cat "$STATE/current" 2>/dev/null || true)"
    echo "previous=$(cat "$STATE/previous" 2>/dev/null || true)"
    echo "releases:"; ls -1t "$RELEASES" | grep -E '^[0-9a-f]{40}$' || true
    echo "docroot:"; ls -A "$DOCROOT"
    ;;
  prune)
    keep="${1:-5}"
    cur="$(cat "$STATE/current" 2>/dev/null || true)"
    prev="$(cat "$STATE/previous" 2>/dev/null || true)"
    rm -rf "$RELEASES"/.incoming-*
    n=0
    for r in $(ls -1t "$RELEASES" | grep -E '^[0-9a-f]{40}$'); do
      n=$((n + 1))
      if [ "$n" -le "$keep" ] || [ "$r" = "$cur" ] || [ "$r" = "$prev" ]; then continue; fi
      rm -rf "${RELEASES:?}/$r"
      log "pruned $r"
    done
    ;;
  *)
    die "unknown command '$cmd' (prepare|finalize|validate|activate|restore|status|prune)"
    ;;
esac
