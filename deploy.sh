#!/bin/bash
# Sync to the Pi, build there (PortAudio is cgo), and restart the service.
#
#   ./deploy.sh            sync, build, restart (clears the ring)
#   ./deploy.sh --static   web/static only: no rebuild, no restart
#   ./deploy.sh --dry-run  what a deploy would change, by content, and delete
#   ./deploy.sh --status   the rig's /api/status: is it idle?
#
# `make deploy`, `make deploy-static`, `make deploy-dry` and `make pi-status`
# run these.
set -euo pipefail
cd "$(dirname "$0")"

# Host/user live in an untracked file so this repo carries no personal config.
# Create deploy.local.env with e.g.  HINDSIGHT_HOST=pi@hindsight.local
# The older DASHCAM_* spellings still work; see the fallbacks below. A git
# worktree has no copy of its own, so it reads the main checkout's.
ENV_FILE=deploy.local.env
if [ ! -f "$ENV_FILE" ] && common="$(git rev-parse --git-common-dir 2>/dev/null)"; then
  ENV_FILE="$common/../deploy.local.env"
fi
[ -f "$ENV_FILE" ] && . "$ENV_FILE"

# host resolution — keep an existing deploy.local.env working
HOST="${HINDSIGHT_HOST:-${DASHCAM_HOST:-}}"
HOST="${HOST:?set HINDSIGHT_HOST (e.g. pi@hindsight.local), or put it in deploy.local.env}"
DEST="${HINDSIGHT_DEST:-${DASHCAM_DEST:-hindsight}}"

# ssh agent bypass
#
# Set HINDSIGHT_NO_AGENT=1 in deploy.local.env on a machine where an ssh agent
# holds the key hostage.
#
# 1Password installs `Host * IdentityAgent ...` in ~/.ssh/config, so every host
# goes through its agent. Listing keys does not need the vault but *signing*
# does, so every deploy fails whenever 1Password is locked -- which reads like
# the agent going stale mid-session. Unsetting SSH_AUTH_SOCK does not help: the
# agent is chosen by ssh_config, not the environment. A throwaway config is the
# only thing that overrides it, and it has to be handed to rsync too.
SSH=(ssh)
if [ "${HINDSIGHT_NO_AGENT:-${DASHCAM_NO_AGENT:-}}" = "1" ]; then
  KEY="${HINDSIGHT_SSH_KEY:-${DASHCAM_SSH_KEY:-$HOME/.ssh/id_rsa}}"
  CFG="$(mktemp)"
  trap 'rm -f "$CFG"' EXIT
  # Note the space form: scp and rsync reject `IdentityAgent=none`.
  printf 'Host *\n  IdentityAgent none\n  IdentitiesOnly yes\n  IdentityFile %s\n' "$KEY" > "$CFG"
  SSH=(ssh -F "$CFG")
  echo "[*] bypassing the ssh agent, using $KEY"
fi

if [ "${1:-}" = "--status" ]; then
  "${SSH[@]}" "$HOST" "curl -fsS http://127.0.0.1:5000/api/status" && echo
  exit 0
fi

# Static-only fast path. main.go serves the UI with
# http.FileServer(http.Dir(staticDir())), so HTML/CSS/JS changes are picked up
# from disk on the next request -- no rebuild, no restart. That turns the
# layout iteration loop from about a minute into about a second.
if [ "${1:-}" = "--static" ]; then
  echo "[*] syncing web/static only to $HOST:~/$DEST"
  rsync -az --delete -e "${SSH[*]}" ./web/static/ "$HOST:~/$DEST/web/static/"
  echo "[*] done (no rebuild, no restart)"
  exit 0
fi

# What never goes to the Pi. An excluded path is also safe from --delete, so
# the Pi keeps its own copy.
#   node_modules: docs/development.md tells you to install Playwright at the
#     repo root to take screenshots; a deploy before you clean it up would push
#     a few hundred MB of Chromium to the Pi over the LAN.
#   .claude, .playwright-mcp, .superpowers: tooling scratch in a checkout. The
#     Pi's .playwright-mcp holds older screenshots and a jam zip that exist
#     nowhere else; a checkout's own copy must never replace it.
EXCLUDES=(
  --exclude 'jam_saves'
  --exclude '.venv'
  --exclude '.git'
  --exclude '*.log'
  --exclude 'bin'
  --exclude 'hindsight.env'
  --exclude 'deploy.local.env'
  --exclude 'node_modules'
  --exclude '.superpowers'
  --exclude '.claude'
  --exclude '.playwright-mcp'
  # The tape (TAPE_DIR's default) and the updater's own files live in the
  # same folder as the checkout; --delete must never touch them.
  --exclude '/tapes'
  --exclude '/releases'
  --exclude '/update.json'
  --exclude '/.update.lock'
)

if [ "${1:-}" = "--dry-run" ]; then
  # By content (-c): timestamps differ between checkouts, so a plain dry run
  # lists every file.
  echo "[*] what a deploy would change on $HOST:~/$DEST (nothing is sent)"
  out="$(rsync -azc --dry-run --itemize-changes --delete -e "${SSH[*]}" "${EXCLUDES[@]}" ./ "$HOST:~/$DEST/")"
  printf '%s\n' "$out" | grep -E '^(<f|cd|\*deleting)' || true
  echo "[*] $(printf '%s\n' "$out" | grep -c '^<f' || true) files to send, $(printf '%s\n' "$out" | grep -c '^\*deleting' || true) to delete"
  exit 0
fi

echo "[*] syncing to $HOST:~/$DEST"
rsync -az --delete -e "${SSH[*]}" "${EXCLUDES[@]}" ./ "$HOST:~/$DEST/"

# Stamp the build with where it came from, as release.yml stamps a release:
# v2026.10.09.3-4-gabc1234 is that release plus four commits, so the page
# shows what's running and the Update button only offers a newer release.
# Without tags (a shallow clone) it's the bare hash; without git, "dev".
VERSION="$(git describe --tags --dirty --always 2>/dev/null || echo dev)"
[[ "$VERSION" =~ ^[0-9A-Za-z._+-]+$ ]] || VERSION=dev

echo "[*] building $VERSION on the Pi"
"${SSH[@]}" "$HOST" "cd ~/$DEST && go build -ldflags '-X main.version=$VERSION' -o bin/hindsight ./cmd/hindsight"

# The updater behind the Update button, as install.sh puts it, so a rig
# deployed from source can update itself to a release too.
echo "[*] installing the updater"
"${SSH[@]}" "$HOST" "cd ~/$DEST && install -m 755 deploy/hindsight-update bin/hindsight-update && \
  mkdir -p ~/.config/systemd/user && \
  install -m 644 deploy/hindsight-update@.service ~/.config/systemd/user/ && \
  systemctl --user daemon-reload"

echo "[*] restarting"
"${SSH[@]}" "$HOST" "systemctl --user restart hindsight.service"
sleep 3
"${SSH[@]}" "$HOST" "systemctl --user is-active hindsight.service && \
  curl -fsS http://127.0.0.1:5000/api/status | head -c 200 && echo"

echo "[*] done"
