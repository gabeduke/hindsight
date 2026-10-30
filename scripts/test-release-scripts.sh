#!/usr/bin/env bash
# Exercise the release helper scripts without pushing anything.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fail=0

check() {
  local name="$1" want="$2" got="$3"
  if [ "$want" = "$got" ]; then
    echo "ok   - $name"
  else
    echo "FAIL - $name"
    echo "       want: $want"
    echo "       got:  $got"
    fail=1
  fi
}

# next-tag.sh reads existing tags on stdin and takes the date as $1.
check "first release of the day" \
  "v2026.09.09.1" \
  "$(printf '' | "$HERE/next-tag.sh" 2026.09.09)"

check "second release of the day increments" \
  "v2026.09.09.2" \
  "$(printf 'v2026.09.09.1\n' | "$HERE/next-tag.sh" 2026.09.09)"

check "counts only today's tags" \
  "v2026.09.09.1" \
  "$(printf 'v2026.09.08.1\nv2026.09.08.2\n' | "$HERE/next-tag.sh" 2026.09.09)"

check "does not trip over a double-digit count" \
  "v2026.09.09.11" \
  "$(printf 'v2026.09.09.%s\n' 1 2 3 4 5 6 7 8 9 10 | "$HERE/next-tag.sh" 2026.09.09)"

check "a gap from a deleted tag does not collide with an existing one" \
  "v2026.09.09.4" \
  "$(printf 'v2026.09.09.1\nv2026.09.09.3\n' | "$HERE/next-tag.sh" 2026.09.09)"

# changelog-entry.sh renders a section from lines of "subject (sha)" on stdin.
entry="$(printf -- '- Do a thing (abc1234)\n- Do another (def5678)\n' \
  | "$HERE/changelog-entry.sh" v2026.09.09.1 2026-09-09)"
case "$entry" in
  "## v2026.09.09.1 — 2026-09-09"*) echo "ok   - entry starts with the heading" ;;
  *) echo "FAIL - entry heading: got ${entry%%$'\n'*}"; fail=1 ;;
esac
case "$entry" in
  *"- Do another (def5678)"*) echo "ok   - entry carries every commit" ;;
  *) echo "FAIL - entry dropped a commit"; fail=1 ;;
esac

check "empty range falls back to No changes recorded" \
  "## v2026.09.09.1 — 2026-09-09

- No changes recorded." \
  "$(printf '' | "$HERE/changelog-entry.sh" v2026.09.09.1 2026-09-09)"

# get.sh, the curl-pipe-bash bootstrap: it parses, and refuses bad options
# before it touches anything.
bash -n "$HERE/get.sh" && echo "ok   - get.sh parses" || { echo "FAIL - get.sh syntax"; fail=1; }
case "$("$HERE/get.sh" --bogus 2>&1 || true)" in
  *"unknown option --bogus"*) echo "ok   - get.sh rejects unknown options" ;;
  *) echo "FAIL - get.sh accepted --bogus"; fail=1 ;;
esac

# The updater behind the Update button, against a fake GitHub and Pi.
"$HERE/test-updater.sh" || fail=1

# release.yml's paths: which merges cut a release. Like next-tag.sh, this
# would otherwise only ever be exercised by a real release -- and its failure
# mode is the quiet one, a change to what ships that silently stops shipping.
#
# The patterns are read from the workflow rather than repeated here, so
# editing that list is what this tests. They use ** only, and inside [[ ]] a
# bash * already crosses /, so ** -> * is an exact translation.
WF="$HERE/../.github/workflows/release.yml"
mapfile -t patterns < <(awk '
  /^    paths:/ { on = 1; next }
  on && /^      - / { gsub(/^      - .|.$/, ""); print; next }
  on { exit }
' "$WF")
for i in "${!patterns[@]}"; do patterns[i]="${patterns[i]//\*\*/\*}"; done

if [ "${#patterns[@]}" -eq 0 ]; then
  echo "FAIL - release filter: no paths found in release.yml"; fail=1
fi

# GitHub's rule: a file counts if the last pattern it matches is a positive
# one, so a later '!x' carves out and a later 'x' carves back in. A push
# releases when any of its files counts.
counts() {
  local f="$1" pat hit=no
  for pat in "${patterns[@]}"; do
    if [[ $pat == '!'* ]]; then
      # shellcheck disable=SC2053
      [[ $f == ${pat:1} ]] && hit=no
    else
      # shellcheck disable=SC2053
      [[ $f == $pat ]] && hit=yes
    fi
  done
  echo "$hit"
}
releases() {
  local f
  for f in "$@"; do
    [ "$(counts "$f")" = yes ] && { echo yes; return; }
  done
  echo no
}
check "a code change releases" \
  "yes" "$(releases internal/tape/crate.go)"
check "a UI change releases" \
  "yes" "$(releases web/static/lib/play/piclock.js)"
check "a dependency bump releases" \
  "yes" "$(releases go.sum)"
# docs/guide.md is embedded by docs/embed.go, so it ships inside the binary.
check "the embedded guide releases" \
  "yes" "$(releases docs/guide.md)"
check "the installer and updater release" \
  "yes" "$(releases deploy/install.sh)"
check "the hub's Dockerfile releases" \
  "yes" "$(releases deploy/hub/Dockerfile)"
check "a spec cuts no release" \
  "no" "$(releases docs/superpowers/specs/2026-10-14-play-mode-design.md)"
check "the agent notes cut no release" \
  "no" "$(releases AGENTS.md CLAUDE.md)"
check "a developer doc cuts no release" \
  "no" "$(releases docs/development.md README.md)"
check "dev scripts and the Makefile cut no release" \
  "no" "$(releases scripts/test-release-scripts.sh Makefile deploy.sh)"
check "a workflow edit cuts no release" \
  "no" "$(releases .github/workflows/release.yml)"
check "the hub's manifests cut no release" \
  "no" "$(releases deploy/hub/kustomization.yaml)"
check "a spec plus its code still releases" \
  "yes" "$(releases docs/superpowers/specs/x-design.md web/static/lib/objects/vu.js)"

# Everything the archive packs, bar the three documents that ride along,
# must be on the list -- or a change to it would build and never ship.
# Read from the "Assemble the archive" step's cp lines, so adding a file
# there without adding it here fails.
missing=""
while read -r src; do
  case "$src" in dist/*|README.md|CHANGELOG.md|LICENSE) continue ;; esac
  [ "$(counts "$src/x")" = yes ] || [ "$(counts "$src")" = yes ] || missing="$missing $src"
done < <(awk '/name: Assemble the archive/ { on = 1 } on && /^ *cp / { for (i = 2; i < NF; i++) if ($i !~ /^-/) print $i } on && /^ *tar / { exit }' "$WF")
check "everything the archive packs releases" "" "${missing# }"

# install.sh runs under pipefail, and its port_held() ends in a grep -v that
# exits 1 when it is handed nothing (no listeners) or only Caddy: that used to
# kill the whole install on a Pi whose ports 80 and 443 are free or Caddy's.
# `ss` is stubbed; sudo just runs its arguments.
INSTALL="$HERE/../deploy/install.sh"
ph="$(awk '/port_held\(\) \{/ { on = 1 } on { print } on && /^ *\}$/ { exit }' "$INSTALL")"
stub="$(mktemp -d)"
printf '#!/bin/sh\nshift\nexec "$@"\n' > "$stub/sudo"
chmod +x "$stub/sudo"
port_held_under_pipefail() { # ss output on stdin
  cat > "$stub/ss.out"
  printf '#!/bin/sh\ncat %s\n' "$stub/ss.out" > "$stub/ss"
  chmod +x "$stub/ss"
  ( set -euo pipefail; PATH="$stub:$PATH"; eval "$ph"; port_held 80; echo survived ) 2>&1 | tail -1
}
check "port_held survives a free port under pipefail" \
  "survived" "$(printf '' | port_held_under_pipefail)"
check "port_held survives a port only Caddy holds" \
  "survived" "$(printf 'LISTEN 0 4096 *:80 *:* users:(("caddy",pid=1,fd=7))\n' | port_held_under_pipefail)"
rm -rf "$stub"

# deploy.sh mirrors a checkout into the Pi's ~/hindsight with --delete, and
# the app, its updater and the Pi's owner keep files in that same folder. Each
# has to be excluded, or a deploy deletes it: the settings the Settings sheet
# saves went that way. Read from deploy.sh's EXCLUDES, so this tests the list.
DEPLOY="$HERE/../deploy.sh"
kept_by_deploy() {
  grep -qF -e "--exclude '/$1'" -e "--exclude '$1'" "$DEPLOY" && echo yes || echo no
}
for kept in settings.json hindsight.env bin jam_saves tapes tls releases update.json .update.lock; do
  check "a deploy keeps the Pi's $kept" "yes" "$(kept_by_deploy "$kept")"
done

exit "$fail"
