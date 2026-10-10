# A real HTTPS name for every Hindsight, from a hub on the homelab

**Date:** 2026-10-09 · **Status:** direction agreed with Gabe on 2026-10-09
(option 2, "the Plex way") · **Repos:** `hindsight` (hub + Pi client),
`homelab` (manifests)

## Why

The PWA, the phone's mic and the wake lock all need a secure page. A Hindsight
on someone else's network (the brother-in-law's Pi) can't get one today:

- `.local` can't have a public certificate;
- Caddy's own CA means installing and trusting a root on every phone, and
  Android often can't resolve `.local` anyway;
- a tunnel through the homelab sends his audio across the internet and back.

Plex solved the same problem with `*.plex.direct`: each server gets a public
name that resolves to its **LAN** address and a real certificate for it, so the
browser talks to the box directly, over HTTPS, with nothing to install.

## Decisions (Gabe, 2026-10-09)

- **cert-manager and external-dns do the work.** The hub only writes
  Kubernetes objects: a `Certificate` (issuer `letsencrypt-aws-prod`, DNS-01
  through Route 53) and an external-dns `DNSEndpoint` (the A record). No AWS
  credentials on the hub, and none on any Pi.
- **"An operator that converts heartbeat calls into certificate objects."**
  No CRD of our own: the heartbeat handler applies the two objects itself
  (server-side apply, so a repeat is a no-op). Visibility is
  `kubectl -n hindsight get certificates,dnsendpoints -l app.kubernetes.io/managed-by=hindsight-hub`.

## What

### Names

Each Hindsight is enrolled under a short name chosen by hand, e.g. `mike`:
**`mike.hindsight.leetserve.com`**, an A record to the Pi's current LAN
address, TTL 60. The certificate is for exactly that name. The hub itself is
`hub.hindsight.leetserve.com`, an ordinary Ingress.

`hindsight.leetserve.com` (the main rig through the proxy, behind
forward-auth) is untouched; names under it are separate records.

### The hub (`cmd/hindsight-hub`, in this repo)

A small Go service in the `hindsight` namespace, one replica, image
`ghcr.io/gabeduke/hindsight-hub` (arm64).

**Enrollment** is a Secret, `hindsight-devices`: one key per device name, the
value the SHA-256 of its token. `scripts/hub-enroll.sh mike` makes a token,
patches the Secret, and prints the token once for the Pi's env file.

**`POST /v1/heartbeat`** — `Authorization: Bearer <token>`,
`{"lan_ip": "192.168.1.55", "version": "v2026.10.10.2"}`:

1. find the device by token hash (constant-time compare); 401 otherwise;
2. refuse a `lan_ip` that isn't private (RFC 1918 / ULA) — the hub must never
   point a leetserve.com name at someone's public address;
3. apply `DNSEndpoint <name>` (`<name>.hindsight.leetserve.com A lan_ip`) and
   `Certificate <name>` (secret `<name>-tls`), labelled
   `app.kubernetes.io/managed-by=hindsight-hub`, annotated with the last
   heartbeat time and version;
4. answer `{"name": "mike.hindsight.leetserve.com", "cert_ready": true,
   "cert_not_after": "…"}`.

Heartbeats are rate-limited per device (one a minute is plenty).

**`GET /v1/certificate`** — same auth; answers the `<name>-tls` Secret's
`tls.crt` and `tls.key` as one PEM bundle, with an `ETag` of the cert's
serial so the Pi can ask cheaply (`If-None-Match` → 304). 404 until
cert-manager has issued it.

RBAC: in its own namespace only — get/patch the devices Secret, get the
`<name>-tls` Secrets, apply `certificates.cert-manager.io` and
`dnsendpoints.externaldns.k8s.io`.

### The Pi (`internal/hub`, in Hindsight)

Off unless **`HUB_URL`** and **`HUB_TOKEN`** are set (env file only: a secret
and a location, so not in the app's settings).

- **Heartbeat** at start, every 10 minutes, and within 30 s of the LAN
  address changing (the source address of the route to the hub, checked every
  30 s). Errors back off and are logged; Hindsight never waits on the hub.
- **Certificate**: fetched after a heartbeat says `cert_ready`, when the
  ETag changes, and kept in `~/hindsight/tls/` (0600), so a restart without
  the internet still serves the last one.
- **Handed to Caddy** on a loopback-only listener, `127.0.0.1:5001/tls`,
  which Caddy's `get_certificate http` asks at handshake. It is a separate
  listener, not a route on `:5000`, because Caddy proxies `:5000` to the
  whole LAN and this answers a private key.
- **`/api/status`** gains `hub`: `{name, url, last_heartbeat, error,
  cert_not_after}`; the Settings sheet shows the secure address with a link,
  or why there isn't one.

### Caddy on the Pi (`deploy/Caddyfile`, installed by `install.sh`)

```caddyfile
{
	auto_https disable_redirects
}

https:// {
	tls {
		get_certificate http http://127.0.0.1:5001/tls
	}
	reverse_proxy 127.0.0.1:5000
}

http:// {
	reverse_proxy 127.0.0.1:5000
}
```

`install.sh` installs Caddy and this file when `HUB_URL` is set (or with
`--https`), so a plain install is unchanged. The local-CA setup page on the
gift Pi goes away.

### Delivery (Gabe, 2026-10-09: Argo CD, images like his other repos)

- **Manifests live here**, in `deploy/hub/` (kustomize: Deployment, Service,
  Ingress for `hub.hindsight.leetserve.com`, ServiceAccount + Role +
  RoleBinding, the devices Secret is created by the enroll script, not
  committed). The homelab adds one Argo CD `Application` pointing at
  `https://github.com/gabeduke/hindsight`, `path: deploy/hub`,
  `targetRevision: main`, automated sync, into the existing `hindsight`
  namespace.
- **The image is built by the release workflow**: a `hub-image` job after
  `release`, on the native arm64 runner (no QEMU), pushes
  `ghcr.io/gabeduke/hindsight-hub:<release tag>` and `:latest` with the
  workflow's `GITHUB_TOKEN` (`packages: write`), then commits
  `kustomize edit set image` to `deploy/hub/kustomization.yaml` on main with
  `[skip ci]`, best effort, the way the changelog commit is. Argo rolls it
  out. As in cash-for-kids, the tag in git is what runs.
- The Dockerfile (`deploy/hub/Dockerfile`) is a static `CGO_ENABLED=0`
  build on distroless. A Hindsight image itself (cgo, PortAudio) can follow
  the same job later.

## Limits

- **DNS rebinding protection.** Some routers (OpenWrt/dnsmasq with
  `rebind-protection`, Pi-hole's option, some ISP boxes) refuse public names
  that answer private addresses. Plex has the same limit; the fix is an
  exception for `hindsight.leetserve.com` on that router. The plain
  `http://hindsight.local` keeps working regardless.
- **The LAN address is in public DNS** and the name in Certificate
  Transparency logs. A private address reveals nothing reachable.
- **Let's Encrypt limits**: 50 certificates per registered domain per week,
  far above a few family boxes; renewals are cert-manager's.
- **external-dns runs `upsert-only`**: a retired device's record stays until
  deleted by hand.

## Testing

- Hub: token auth (good, bad, unknown device), public `lan_ip` refused, the
  applied objects' shape (fake dynamic client), ETag/304, rate limit.
- Pi: heartbeat timing and backoff, address-change detection, the cert
  store's permissions, the loopback listener not reachable on `:5000`.
- End to end on the gift Pi: enrol `mike`, set the env, and from a phone on
  the same Wi-Fi `https://mike.hindsight.leetserve.com` loads with no
  warning, installs as a PWA, and the Phone button opens the mic.

## Later

- **`find.hindsight.leetserve.com`**: the hub knows which devices heartbeat
  from which public IP, so a page can list "the Hindsights in your house" and
  link to them.
- The main rig enrolled too, for LAN-direct HTTPS at home.
