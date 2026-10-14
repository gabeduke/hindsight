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

# release.yml's paths-ignore: which merges cut a release. Like next-tag.sh,
# this would otherwise only ever be exercised by a real release -- and its
# failure mode is the quiet one, a feature that silently stops shipping.
#
# The patterns are read from the workflow rather than repeated here, so
# editing that list is what this tests. They use ** only, and inside [[ ]] a
# bash * already crosses /, so ** -> * is an exact translation.
WF="$HERE/../.github/workflows/release.yml"
mapfile -t ignore < <(awk '
  /^    paths-ignore:/ { on = 1; next }
  on && /^      - / { gsub(/^      - .|.$/, ""); print; next }
  on { exit }
' "$WF")

if [ "${#ignore[@]}" -eq 0 ]; then
  echo "FAIL - release filter: no paths-ignore found in release.yml"; fail=1
fi

# Skipped only when every changed file is ignored, which is what makes a
# mixed spec-and-code PR still release.
skips_release() {
  local f pat hit
  for f in "$@"; do
    hit=0
    for pat in "${ignore[@]}"; do
      # shellcheck disable=SC2053
      [[ $f == ${pat//\*\*/\*} ]] && { hit=1; break; }
    done
    [ "$hit" = 1 ] || { echo no; return; }
  done
  echo yes
}

check "a spec on its own cuts no release" \
  "yes" "$(skips_release docs/superpowers/specs/2026-10-14-play-mode-design.md)"
check "a design board cuts no release" \
  "yes" "$(skips_release design/Main.dc.html)"
check "a workflow edit cuts no release" \
  "yes" "$(skips_release .github/workflows/release.yml)"
check "the agent notes cut no release" \
  "yes" "$(skips_release AGENTS.md CLAUDE.md)"
# README.md goes into the tarball, so a root file is not ignored as such.
check "the README still releases" \
  "no" "$(skips_release README.md)"
check "an agent note plus code still releases" \
  "no" "$(skips_release AGENTS.md web/static/sw.js)"
check "a spec plus its code still releases" \
  "no" "$(skips_release docs/superpowers/specs/x-design.md web/static/lib/objects/vu.js)"
# docs/guide.md is embedded by docs/embed.go, so it ships inside the binary.
check "the embedded guide still releases" \
  "no" "$(skips_release docs/guide.md)"
check "a normal change still releases" \
  "no" "$(skips_release internal/tape/crate.go)"

exit "$fail"
