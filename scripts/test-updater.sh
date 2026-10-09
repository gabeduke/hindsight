#!/usr/bin/env bash
# Exercise deploy/hindsight-update end to end, with nothing real touched:
#
#   - a fake GitHub and a fake Hindsight, one small Python server, serve the
#     latest-release answer, the release archives, SHA256SUMS and
#     /api/status;
#   - each fake release's install.sh copies its "binary" into place and
#     restarts, the way the real one does;
#   - systemctl is a stub on PATH: a restart makes the fake Hindsight report
#     whatever version ~/hindsight/bin/hindsight now says.
#
# Run by scripts/test-release-scripts.sh, so CI runs it too.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UPDATER="$HERE/../deploy/hindsight-update"
T="$(mktemp -d)"
trap 'kill "$SERVER_PID" 2>/dev/null || true; rm -rf "$T"' EXIT
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

export HOME="$T/home"
ROOT="$HOME/hindsight"
WWW="$T/www"
mkdir -p "$ROOT/bin" "$ROOT/web/static" "$HOME/.config/systemd/user" "$WWW" "$T/stub"

# --- the fake Hindsight: a "binary" that prints its version ------------------
binary() { printf '#!/bin/sh\necho %s\n' "$1"; }
binary dev > "$ROOT/bin/hindsight"; chmod +x "$ROOT/bin/hindsight"
echo "ui dev" > "$ROOT/web/static/index.html"
echo dev > "$T/running"       # what /api/status reports
echo false > "$T/saving"

# --- systemctl: a restart brings up whatever binary is installed -------------
cat > "$T/stub/systemctl" <<EOF
#!/bin/sh
echo "systemctl \$*" >> "$T/systemctl.log"
case "\$*" in
  *restart*hindsight.service*) "$ROOT/bin/hindsight" > "$T/running" ;;
esac
exit 0
EOF
chmod +x "$T/stub/systemctl"
export PATH="$T/stub:$PATH"

# --- releases ------------------------------------------------------------------
# release TAG MODE: ok, fail (install.sh exits 1), wrong (comes up as another
# version) or badsum (SHA256SUMS doesn't match).
release() {
  local tag="$1" mode="$2" name="hindsight_$1_linux_arm64" d="$T/build/$1"
  mkdir -p "$d/$name/bin" "$d/$name/web/static" "$WWW/gabeduke/hindsight/releases/download/$tag"
  if [ "$mode" = wrong ]; then binary v0.0.0 > "$d/$name/bin/hindsight"; else binary "$tag" > "$d/$name/bin/hindsight"; fi
  chmod +x "$d/$name/bin/hindsight"
  echo "ui $tag" > "$d/$name/web/static/index.html"
  cat > "$d/$name/install.sh" <<EOF
#!/bin/sh
set -e
[ "$mode" = fail ] && { echo "install broke" >&2; exit 1; }
SRC="\$(cd "\$(dirname "\$0")" && pwd)"
install -m 755 "\$SRC/bin/hindsight" "\$HOME/hindsight/bin/hindsight"
rm -rf "\$HOME/hindsight/web/static" && cp -R "\$SRC/web/static" "\$HOME/hindsight/web/static"
systemctl --user restart hindsight.service
EOF
  chmod +x "$d/$name/install.sh"
  tar -C "$d" -czf "$WWW/gabeduke/hindsight/releases/download/$tag/$name.tar.gz" "$name"
  (cd "$WWW/gabeduke/hindsight/releases/download/$tag" && sha256sum "$name.tar.gz" > SHA256SUMS)
  [ "$mode" = badsum ] && echo "0000  $name.tar.gz" > "$WWW/gabeduke/hindsight/releases/download/$tag/SHA256SUMS"
  return 0
}
latest() {
  mkdir -p "$WWW/repos/gabeduke/hindsight/releases"
  printf '{"tag_name": "%s", "name": "%s"}\n' "$1" "$1" > "$WWW/repos/gabeduke/hindsight/releases/latest"
}

# --- the server ------------------------------------------------------------------
cat > "$T/server.py" <<'EOF'
import http.server, os, sys
T, WWW = sys.argv[1], sys.argv[2]
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=WWW, **k)
    def log_message(self, *a): pass
    def do_GET(self):
        if self.path == '/api/status':
            if os.path.exists(T + '/down'):
                self.send_error(503); return
            v = open(T + '/running').read().strip()
            s = open(T + '/saving').read().strip()
            body = ('{"version":"%s","saving":%s}' % (v, s)).encode()
            self.send_response(200); self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)
            return
        return super().do_GET()
s = http.server.ThreadingHTTPServer(('127.0.0.1', 0), H)
open(T + '/port', 'w').write(str(s.server_port))
s.serve_forever()
EOF
python3 "$T/server.py" "$T" "$WWW" & SERVER_PID=$!
for _ in $(seq 50); do [ -s "$T/port" ] && break; sleep 0.1; done
PORT="$(cat "$T/port")"
export PORT UPDATE_GITHUB="http://127.0.0.1:$PORT" UPDATE_GITHUB_API="http://127.0.0.1:$PORT" UPDATE_WAIT_TRIES=2

field() { grep -o "\"$1\":\"[^\"]*\"" "$ROOT/update.json" | sed "s/^\"$1\":\"//; s/\"$//"; }
run() { "$UPDATER" "$@" >> "$T/updater.log" 2>&1; }

# 1. A source build (dev) updates to the latest release.
release v2026.10.09.1 ok; latest v2026.10.09.1
run && rc=0 || rc=$?
check "dev -> latest exits 0" 0 "$rc"
check "dev -> latest is done" "done" "$(field state)"
check "dev -> latest is running it" v2026.10.09.1 "$(cat "$T/running")"
check "dev -> latest installed its UI" "ui v2026.10.09.1" "$(cat "$ROOT/web/static/index.html")"
check "it kept the dev build to roll back to" dev "$("$ROOT/releases/.previous/hindsight")"
check "it says where it came from" dev "$(field from)"

# 2. Already on the latest: nothing to do.
run && rc=0 || rc=$?
check "already on latest exits 0" 0 "$rc"
check "already on latest says so" "already on v2026.10.09.1" "$(field message)"

# 3. A release whose install fails rolls back.
release v2026.10.09.2 fail; latest v2026.10.09.2
run && rc=0 || rc=$?
check "failed install exits 1" 1 "$rc"
check "failed install rolls back" rolled_back "$(field state)"
check "failed install leaves the old one running" v2026.10.09.1 "$(cat "$T/running")"
check "failed install leaves the old UI" "ui v2026.10.09.1" "$(cat "$ROOT/web/static/index.html")"
check "failed install says why, and that nothing changed" \
  "v2026.10.09.2's install failed: install broke; nothing was changed, still on v2026.10.09.1" "$(field message)"

# 4. A release that comes up reporting another version rolls back.
release v2026.10.09.3 wrong
run v2026.10.09.3 && rc=0 || rc=$?
check "wrong version rolls back" rolled_back "$(field state)"
check "wrong version leaves the old one running" v2026.10.09.1 "$(cat "$T/running")"

# 5. A download that doesn't match its checksum is never installed.
release v2026.10.09.4 badsum
run v2026.10.09.4 && rc=0 || rc=$?
check "bad checksum fails" failed "$(field state)"
check "bad checksum installs nothing" v2026.10.09.1 "$(cat "$T/running")"

# 6. Not while a take is saving.
release v2026.10.09.5 ok
echo true > "$T/saving"
run v2026.10.09.5 && rc=0 || rc=$?
check "saving refuses" failed "$(field state)"
check "saving installs nothing" v2026.10.09.1 "$(cat "$T/running")"
echo false > "$T/saving"

# 7. Only a release tag: nothing that could walk out of releases/ or a URL.
run '../../etc' && rc=0 || rc=$?
check "a bad tag fails" failed "$(field state)"

# 8. A named release installs, and only two stay on disk.
run v2026.10.09.5 && rc=0 || rc=$?
check "a named release installs" v2026.10.09.5 "$(cat "$T/running")"
# shellcheck disable=SC2012
check "keeps two releases" 2 "$(ls -1d "$ROOT"/releases/v* | wc -l | tr -d ' ')"

# 9. A step that fails outside the script's own checks (here the copy kept
#    for a rollback, as on a full card) still ends in a final state, never a
#    working one the page would follow for ten minutes.
release v2026.10.09.6 ok
mkdir -p "$T/stub2"
REAL_CP="$(command -v cp)"
cat > "$T/stub2/cp" <<STUB
#!/bin/sh
case "\$*" in *"/.previous"*) echo "cp: No space left on device" >&2; exit 1 ;; esac
exec $REAL_CP "\$@"
STUB
chmod +x "$T/stub2/cp"
PATH="$T/stub2:$PATH" run v2026.10.09.6 && rc=0 || rc=$?
check "an unexpected failure exits non-zero" yes "$([ "$rc" != 0 ] && echo yes || echo no)"
check "an unexpected failure ends failed" failed "$(field state)"
check "an unexpected failure installs nothing" v2026.10.09.5 "$(cat "$T/running")"

if [ "$fail" != 0 ]; then
  echo "--- updater log"; cat "$T/updater.log"
fi
exit "$fail"
