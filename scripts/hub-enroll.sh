#!/usr/bin/env bash
# Enrol a Hindsight with the hub: make a token, put its SHA-256 in the
# hindsight-devices Secret under the device's name, and print the token --
# once; the cluster only ever holds its hash.
#
#   scripts/hub-enroll.sh mike                 # new device
#   scripts/hub-enroll.sh mike --rotate        # new token for an existing one
#   scripts/hub-enroll.sh mike hindsight       # namespace (default hindsight)
#
# Uses your kubectl context. The hub re-reads the Secret within 30 s.
set -euo pipefail

usage() { echo "usage: $0 <name> [namespace] [--rotate]" >&2; exit 2; }

rotate=false
args=()
for a in "$@"; do
  case "$a" in
    --rotate) rotate=true ;;
    -h|--help) usage ;;
    -*) echo "unknown flag: $a" >&2; usage ;;
    *) args+=("$a") ;;
  esac
done
[ "${#args[@]}" -ge 1 ] && [ "${#args[@]}" -le 2 ] || usage
name="${args[0]}"
ns="${args[1]:-hindsight}"
secret=hindsight-devices

# Must match hubserver.ValidName: a lowercase DNS label, since it becomes
# <name>.hindsight.leetserve.com and the names of two Kubernetes objects.
if ! [[ "$name" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$ ]]; then
  echo "invalid name '$name': use a-z, 0-9 and '-', up to 63, not starting or ending with '-'" >&2
  exit 1
fi
case "$name" in
  hub|find|www|hindsight-hub|hindsight-devices)
    echo "'$name' is reserved by the hub itself" >&2; exit 1 ;;
esac

command -v kubectl >/dev/null || { echo "kubectl not found" >&2; exit 1; }

if command -v openssl >/dev/null; then
  token="$(openssl rand -hex 32)"
else
  token="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
fi
if command -v sha256sum >/dev/null; then
  hash="$(printf '%s' "$token" | sha256sum | cut -d' ' -f1)"
else
  hash="$(printf '%s' "$token" | shasum -a 256 | cut -d' ' -f1)"
fi
[ "${#token}" -eq 64 ] && [ "${#hash}" -eq 64 ] || { echo "could not make a token" >&2; exit 1; }

if kubectl -n "$ns" get secret "$secret" >/dev/null 2>&1; then
  existing="$(kubectl -n "$ns" get secret "$secret" -o go-template="{{ index .data \"$name\" }}" 2>/dev/null || true)"
  if [ -n "$existing" ] && [ "$existing" != "<no value>" ] && ! $rotate; then
    echo "'$name' is already enrolled; pass --rotate to give it a new token (the old one stops working)" >&2
    exit 1
  fi
  kubectl -n "$ns" patch secret "$secret" --type merge \
    -p "{\"stringData\":{\"$name\":\"$hash\"}}" >/dev/null
else
  kubectl -n "$ns" create secret generic "$secret" \
    --from-literal="$name=$hash" >/dev/null
  kubectl -n "$ns" label secret "$secret" app.kubernetes.io/part-of=hindsight-hub >/dev/null
fi

cat <<OUT
Enrolled $name -> $name.hindsight.leetserve.com

Add these to the Pi's ~/hindsight/hindsight.env and restart hindsight.
The token is not stored anywhere else; this is the only time it is shown.

HUB_URL=https://hub.hindsight.leetserve.com
HUB_TOKEN=$token
OUT
