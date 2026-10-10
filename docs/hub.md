# The hub

A Hindsight on someone else's network can't get a secure page on its own:
`.local` can't have a public certificate, and a private CA means trusting a
root on every phone. The PWA install, the Phone button's mic and the wake lock
all need one.

The hub fixes that the way Plex does with `*.plex.direct`. Each enrolled
Hindsight gets a public name, **`<name>.hindsight.leetserve.com`**, whose A
record is the Pi's **LAN** address, and a real Let's Encrypt certificate for
it. The phone talks to the Pi directly, over HTTPS, with nothing to install;
no audio goes anywhere near the homelab.

The hub (`cmd/hindsight-hub`) is a small Go service in the homelab cluster's
`hindsight` namespace, at `https://hub.hindsight.leetserve.com`. It does no
DNS or ACME itself. On each heartbeat it server-side applies two objects and
lets the cluster do the rest:

- an external-dns **`DNSEndpoint`** `<name>`: `<name>.hindsight.leetserve.com`
  A (or AAAA) the Pi's LAN address, TTL 60;
- a cert-manager **`Certificate`** `<name>` for that name, issuer
  `letsencrypt-aws-prod` (DNS-01 through Route 53), into the Secret
  `<name>-tls`, which the Pi then fetches.

So there are no AWS credentials on the hub, and none on any Pi. The design,
and why, is in
[the spec](superpowers/specs/2026-10-09-hub-certificates-design.md).

## Enrolling a device

Pick a short name: lowercase letters, digits and `-`, at most 63 (`hub`,
`find`, `www`, `hindsight-hub` and `hindsight-devices` are taken). With
`kubectl` pointed at the homelab:

```sh
scripts/hub-enroll.sh mike
```

It makes a random token, stores only its SHA-256 in the Secret
`hindsight-devices` (creating it the first time), and prints the token once:

```
HUB_URL=https://hub.hindsight.leetserve.com
HUB_TOKEN=3f9c…
```

Put both lines in the Pi's `~/hindsight/hindsight.env` and restart Hindsight.
The hub re-reads the Secret within 30 s. Within a couple of minutes of the
first heartbeat the certificate is issued and `https://mike.hindsight.leetserve.com`
works from any phone on that Wi-Fi.

A lost or leaked token: `scripts/hub-enroll.sh mike --rotate` replaces it (the
old one stops working) and prints a new one. Without `--rotate` the script
refuses to touch a name that's already enrolled. The namespace is the second
argument if it isn't `hindsight`.

To retire a device, delete its key from the Secret and its objects:

```sh
kubectl -n hindsight patch secret hindsight-devices --type json \
  -p '[{"op":"remove","path":"/data/mike"}]'
kubectl -n hindsight delete certificate,dnsendpoint mike
kubectl -n hindsight delete secret mike-tls
```

external-dns runs `upsert-only`, so the Route 53 record itself stays until it
is deleted by hand.

## The API

Both calls take `Authorization: Bearer <token>`; an unknown or missing token
is `401`.

**`POST /v1/heartbeat`** with `{"lan_ip": "192.168.1.55", "version": "v2026.10.10.2"}`
answers

```json
{"name": "mike.hindsight.leetserve.com", "cert_ready": true, "cert_not_after": "2027-01-07T12:00:00Z"}
```

`cert_not_after` (RFC 3339, UTC) is left out until there is a certificate.
`cert_ready` means the `<name>-tls` Secret holds a key and a certificate for
exactly that name, inside its validity.

- `lan_ip` must be private — RFC 1918 (`10/8`, `172.16/12`, `192.168/16`) or
  IPv6 ULA (`fc00::/7`, which gets an AAAA record) — or the answer is `400`:
  the hub never points a leetserve.com name at a public address.
- One apply per device per 30 s. Inside that window a heartbeat with the same
  address is answered from the last one; a *new* address is `429` with
  `Retry-After` (seconds), so the Pi's retry carries it.
- `503` when the cluster can't be reached or refuses the apply.

**`GET /v1/certificate`** answers the device's `tls.crt` then `tls.key` as one
PEM bundle (`application/x-pem-file`), with `ETag: "<serial, hex>"`. Send it
back as `If-None-Match` for a `304` when nothing has changed. `404` until
cert-manager has issued the certificate.

**`GET /healthz`** is `200 ok`.

## Operating it

Everything it manages, and when each device last called in:

```sh
kubectl -n hindsight get certificates,dnsendpoints -l app.kubernetes.io/managed-by=hindsight-hub
kubectl -n hindsight get dnsendpoints -l app.kubernetes.io/managed-by=hindsight-hub \
  -o custom-columns='NAME:.metadata.name,IP:.spec.endpoints[0].targets[0],LAST:.metadata.annotations.hindsight\.leetserve\.com/last-heartbeat,VERSION:.metadata.annotations.hindsight\.leetserve\.com/version'
kubectl -n hindsight logs deploy/hindsight-hub
```

A certificate that won't go ready is cert-manager's to explain:
`kubectl -n hindsight describe certificate mike` and its `CertificateRequest`
/ `Order` / `Challenge`.

**Deployment.** The manifests are in [`deploy/hub/`](../deploy/hub) (kustomize:
Deployment, Service, Ingress, ServiceAccount, Role, RoleBinding). The homelab's
Argo CD `Application` syncs that path from `main` into the existing `hindsight`
namespace. Every release also builds `ghcr.io/gabeduke/hindsight-hub:<tag>`
(arm64, distroless) in the release workflow's `hub-image` job, and commits
`Point the hub at <tag> [skip ci]` to `deploy/hub/kustomization.yaml`; Argo
rolls that out. The tag in git is what runs.

Settings, as environment on the Deployment:

| Variable | Default | |
|---|---|---|
| `HUB_DOMAIN` | `hindsight.leetserve.com` | Names are `<device>.<HUB_DOMAIN>` |
| `HUB_ISSUER` | `letsencrypt-aws-prod` | cert-manager issuer for device certificates |
| `HUB_ISSUER_KIND` | `ClusterIssuer` | |
| `HUB_DEVICES_SECRET` | `hindsight-devices` | The enrolment Secret |
| `HUB_HEARTBEAT_WINDOW` | `30s` | Least time between two applies for one device |
| `HUB_ADDR` | `:8080` | Listen address |

Its RBAC is its own namespace only: `get` on Secrets (by name; no list or
watch), and `get/list/create/patch` on `certificates.cert-manager.io` and
`dnsendpoints.externaldns.k8s.io`.

## Limits

- **DNS rebinding protection.** Some routers — OpenWrt/dnsmasq with
  `rebind-protection`, Pi-hole's option, some ISP boxes — refuse to answer a
  public name with a private address, so `mike.hindsight.leetserve.com` simply
  doesn't resolve on that network. Plex has the same limit. The fix is an
  exception for `hindsight.leetserve.com` on that router (dnsmasq:
  `rebind-domain-ok=/hindsight.leetserve.com/`). Plain `http://hindsight.local`
  keeps working regardless.
- **The LAN address is in public DNS**, and the name is in Certificate
  Transparency logs. A private address reveals nothing reachable.
- **Let's Encrypt** allows 50 certificates per registered domain per week, far
  above a few family boxes; renewals are cert-manager's.
