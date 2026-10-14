#!/usr/bin/env bash
# Install the latest Hindsight release on a Raspberry Pi, from one command:
#
#   curl -fsSL https://raw.githubusercontent.com/gabeduke/hindsight/main/scripts/get.sh | bash
#
# Options (pass after `bash -s --`):
#   --check       run the checks only; change nothing
#   --yes         answer yes to every question (for unattended runs)
#   --no-tailscale  leave Tailscale alone
# Environment:
#   HINDSIGHT_VERSION=v2026.10.10.5   install that release instead of the latest
#
# It checks the machine, offers to put Tailscale on it, downloads the release
# and verifies its checksum, then runs the release's own install.sh (which
# installs the apt packages, the service, and starts it). Re-running upgrades.
# Run it as the normal login user, not with sudo; it asks for sudo itself.
#
# Everything is inside main() and called on the last line, so a download that
# is cut off halfway runs nothing.
set -euo pipefail

REPO="gabeduke/hindsight"

say()  { echo "[*] $*"; }
warn() { echo "[!] $*" >&2; }
die()  { echo "error: $*" >&2; exit 1; }

# stdin is the script when piped, so questions go to the terminal instead.
have_tty() { (: </dev/tty) 2>/dev/null; }

# ask "question" [default y|n] -> 0 for yes. With no terminal (or --yes) the
# default is taken, and --yes makes every default yes.
ask() {
  local q="$1" def="${2:-n}" reply hint="[y/N]"
  [ "$def" = y ] && hint="[Y/n]"
  if [ "$YES" = 1 ]; then return 0; fi
  if ! have_tty; then [ "$def" = y ]; return; fi
  read -r -p "    $q $hint " reply </dev/tty || reply=""
  reply="${reply:-$def}"
  [ "$reply" = y ] || [ "$reply" = Y ]
}

preflight() {
  [ "$(uname -s)" = "Linux" ] || die "this installs on a Raspberry Pi (Linux); found $(uname -s)"
  [ "$(uname -m)" = "aarch64" ] || die "needs 64-bit Raspberry Pi OS (arm64); this is $(uname -m). Re-flash with the 64-bit image."
  [ "$(id -u)" -ne 0 ] || die "don't run this as root or with sudo; run it as your normal login user (it uses sudo where it must)"

  command -v apt-get >/dev/null || die "needs Raspberry Pi OS / Debian (apt-get not found)"
  local c
  for c in curl tar sha256sum awk; do
    command -v "$c" >/dev/null || die "$c is required: sudo apt-get install -y $c"
  done
  command -v systemctl >/dev/null || die "systemd is required"
  systemctl --user show-environment >/dev/null 2>&1 \
    || die "no systemd user session. Log in as the user that will run Hindsight (over SSH or at the Pi), not via sudo or su."
  command -v sudo >/dev/null || die "sudo is required for apt and lingering"

  local model mem_kb
  model="$(tr -d '\0' </proc/device-tree/model 2>/dev/null || true)"
  mem_kb="$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)"
  MEM_MB=$((mem_kb / 1024))
  case "$model" in
    *"Raspberry Pi 5"*) ;;
    *"Raspberry Pi"*)   warn "$model: Hindsight is built and tested on a Pi 5; other models may struggle with capture" ;;
    *)                  warn "this doesn't look like a Raspberry Pi (${model:-no model reported}); carrying on" ;;
  esac
  say "${model:-this machine}, ${MEM_MB} MB RAM, $(. /etc/os-release 2>/dev/null; echo "${PRETTY_NAME:-unknown OS}")"

  # The binary is built against glibc 2.36 (Debian 12); older won't run it.
  local glibc
  glibc="$(getconf GNU_LIBC_VERSION 2>/dev/null | awk '{print $2}')"
  if [ -n "$glibc" ] && [ "$(printf '2.36\n%s\n' "$glibc" | sort -V | head -1)" != "2.36" ]; then
    die "glibc $glibc is too old; Hindsight needs Raspberry Pi OS Bookworm (Debian 12) or newer"
  fi

  curl -fsSI "https://github.com/$REPO/releases/latest" >/dev/null 2>&1 \
    || die "can't reach github.com; check the Pi's network"
}

# The ring is uncompressed audio held in RAM (see hindsight.env.example), and
# the default 900 s is sized for an 8 GB Pi. On a fresh install, pick a ring
# the machine can afford; an existing hindsight.env is never touched.
size_ring_for_ram() {
  [ -f "$HOME/hindsight/hindsight.env" ] && return 0
  local secs=""
  if   [ "$MEM_MB" -lt 3000 ]; then secs=120
  elif [ "$MEM_MB" -lt 6000 ]; then secs=300
  fi
  [ -n "$secs" ] || return 0
  say "only ${MEM_MB} MB of RAM: starting with a ${secs}-second buffer instead of 900 (change RING_SECONDS in ~/hindsight/hindsight.env)"
  mkdir -p "$HOME/hindsight"
  printf '# Written by get.sh: this Pi has %s MB of RAM.\nRING_SECONDS=%s\n' "$MEM_MB" "$secs" > "$HOME/hindsight/hindsight.env"
}

tailscale_connected() { command -v tailscale >/dev/null && tailscale ip -4 >/dev/null 2>&1; }

setup_tailscale() {
  [ "$TAILSCALE" = 1 ] || return 0
  if ! command -v tailscale >/dev/null; then
    say "Tailscale is not installed on this Pi"
    if ask "install it (the official script from tailscale.com)?" y; then
      curl -fsSL https://tailscale.com/install.sh | sh \
        || { warn "Tailscale install failed; carrying on without it"; return 0; }
    else
      return 0
    fi
  fi
  if tailscale_connected; then
    say "Tailscale is connected ($(tailscale ip -4 | head -1))"
    return 0
  fi
  say "Tailscale is installed but this Pi isn't signed in to your tailnet"
  if have_tty && ask "sign in now? (it prints a link to open on your phone or laptop)" y; then
    sudo tailscale up </dev/tty \
      || warn "tailscale up didn't finish; run it later with: sudo tailscale up"
  else
    warn "sign in later with: sudo tailscale up"
  fi
}

# Phones only give a web page the microphone over HTTPS, and a tailnet
# address gets a real certificate from `tailscale serve`.
serve_over_tailscale() {
  [ "$TAILSCALE" = 1 ] && tailscale_connected || return 0
  local port="$1"
  if sudo tailscale serve status 2>/dev/null | grep -q "127.0.0.1:$port"; then
    say "tailscale serve already points at Hindsight"
  elif ask "serve Hindsight over HTTPS on your tailnet (needed for the phone mic)?" y; then
    sudo tailscale serve --bg --https=443 "http://127.0.0.1:$port" \
      || { warn "tailscale serve failed. HTTPS certificates must be enabled for your tailnet (https://login.tailscale.com/admin/dns); then run: sudo tailscale serve --bg --https=443 http://127.0.0.1:$port"; return 0; }
  else
    return 0
  fi
  sudo tailscale serve status 2>/dev/null | sed 's/^/    /' || true
}

main() {
  local CHECK=0 YES=0 TAILSCALE=1 MEM_MB=0 arg
  for arg in "$@"; do
    case "$arg" in
      --check) CHECK=1 ;;
      --yes|-y) YES=1 ;;
      --no-tailscale) TAILSCALE=0 ;;
      *) die "unknown option $arg (--check, --yes, --no-tailscale)" ;;
    esac
  done

  preflight
  if [ "$CHECK" = 1 ]; then
    if ! command -v tailscale >/dev/null; then say "tailscale: not installed"
    elif tailscale_connected; then say "tailscale: connected"
    else say "tailscale: installed, not signed in"; fi
    say "checks passed; nothing was changed"
    return 0
  fi

  # sudo once up front, so the password prompt isn't buried in apt's output.
  if have_tty; then sudo -v </dev/tty || die "sudo didn't authenticate"; else sudo -n true 2>/dev/null || die "sudo needs a password and there is no terminal; run this from a login shell"; fi

  setup_tailscale

  # Which release.
  local base tag
  if [ -n "${HINDSIGHT_VERSION:-}" ]; then
    tag="$HINDSIGHT_VERSION"
    base="https://github.com/$REPO/releases/download/$tag"
  else
    base="https://github.com/$REPO/releases/latest/download"
  fi

  local work
  work="$(mktemp -d)"
  # shellcheck disable=SC2064
  trap "rm -rf '$work'" EXIT
  cd "$work"

  say "downloading ${tag:-the latest release}"
  curl -fsSLO "$base/SHA256SUMS" || die "no release found at $base (is HINDSIGHT_VERSION right?)"
  local tarball
  tarball="$(awk '{print $2}' SHA256SUMS | head -1)"
  [ -n "$tarball" ] || die "SHA256SUMS was empty"
  curl -fsSLO "$base/$tarball" || die "could not download $tarball"
  sha256sum -c SHA256SUMS >/dev/null || die "checksum mismatch for $tarball; not installing it"
  say "checksum ok: $tarball"

  tar xzf "$tarball"
  local dir="${tarball%.tar.gz}"
  [ -x "$dir/install.sh" ] || die "$tarball has no install.sh"

  size_ring_for_ram

  say "running the installer"
  # install.sh may ask a question (migrating an old audio-dashcam install),
  # so give it the terminal; with none, it takes the safe default.
  if have_tty; then (cd "$dir" && ./install.sh </dev/tty); else (cd "$dir" && ./install.sh </dev/null); fi

  local port
  port="$(sed -n 's/^[[:space:]]*PORT=["'"'"']\{0,1\}\([0-9]*\).*/\1/p' "$HOME/hindsight/hindsight.env" 2>/dev/null | tail -1)"
  serve_over_tailscale "${port:-5000}"

  echo
  say "done. Open http://$(hostname).local:${port:-5000} on the same network."
  say "Plug the audio interface in if you haven't; Settings (foot of the page) shows what it found."
  say "Update later from the Update button in Settings, or re-run this command."
}

main "$@"
