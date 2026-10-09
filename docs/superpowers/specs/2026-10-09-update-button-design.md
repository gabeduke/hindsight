# The Update button

**Date:** 2026-10-09 · **Status:** asked for by Gabe on 2026-10-09 ·
**Repo:** `hindsight` · Builds part of the kit spec's K3 (the updater with
rollback) and K3b (*Check for updates*), for the rig first.

## Why

Every merge to main publishes a release, but getting one onto the rig means
running `deploy.sh` from a laptop. Gabe wants a button in Hindsight that
installs the latest release on the Pi. His brother-in-law's kit wants the
same thing later.

## Decisions (Gabe, 2026-10-09)

- **The latest release,** not an approved channel. The kit can pin one
  later; see *Later*.
- **The button only.** No nightly timer: nothing installs unless someone taps
  it.
- **At the foot of Capture.** The version line becomes *Hindsight v… · the
  guide*, with **● Update to v…** under it. That's where the version already
  is, and it needs no settings page.

## What

**`deploy/hindsight-update [tag|latest]`** is a bash script installed to
`~/hindsight/bin/`. It:

1. takes a `flock`, so a second run waits;
2. resolves `latest` through GitHub's API;
3. accepts only `^v[0-9A-Za-z._-]+$`, before the tag names a path or a URL;
4. stops if the tag is what's running, or if a take is saving;
5. downloads the tarball and `SHA256SUMS` to `~/hindsight/releases/<tag>/`
   and checks them;
6. copies what's installed now to `releases/.previous`: the binary,
   `web/static` and the unit. That works whether a release or `deploy.sh`
   put them there;
7. runs the release's `install.sh </dev/null`, then checks that
   `/api/status` reports the new version;
8. on failure, restores `.previous` and restarts (`rolled_back`). If
   `install.sh` stopped before swapping anything (apt, say), it leaves
   Hindsight running and doesn't restart it. The message carries
   `install.sh`'s last error line;
9. keeps two releases on disk.

An `EXIT` trap ends any run that stops unexpectedly (a `set -e` step on a
full card, the unit's timeout) as `failed`, never in a working state.

Every step goes to the journal and to `~/hindsight/update.json` (state, tag,
from, message, at). The script runs from a private copy of itself, because
`install.sh` replaces it mid-run.

**`hindsight-update@.service`** is a oneshot user unit. The instance is the
tag. It runs outside Hindsight, which `install.sh` restarts.

**`install.sh`** also changes:
- It waits on `PORT`: the environment, then `hindsight.env`, then 5000. Before,
  it hardcoded 5000, so a rig on another port would always roll back.
- It waits about 30 s, not 16.
- It skips apt when the runtime packages are already installed.

**How it gets onto the Pi:**
- `install.sh` installs both files when the archive has them.
- `release.yml` puts them in the archive.
- `deploy.sh` installs them after its build, so a source-deployed rig gets
  the button too.
- `deploy.sh` also now excludes `tapes/`, `releases/`, `update.json` and
  `.update.lock` from `--delete`. `tapes/` is the default `TAPE_DIR`, and a
  deploy would have deleted it.

**`GET /api/update`** returns `{running, latest, available, error, notes, update}`.
- `latest` is cached for ten minutes, but a failure only for a minute;
  `?refresh=1` asks again. The ask runs on its own context, so a phone
  navigating away can't cache a cancelled answer for everyone.
- `available` compares the tags number by number. `dev` is always behind.
- The endpoint returns `404` where the script isn't installed beside the
  binary, so there's no button in the demo or on a Mac.

**`POST /api/update`** takes an optional body, `{tag}`.
- It writes a `queued` state stamped with the Pi's clock, starts the unit
  with `systemctl --user start --no-block`, and returns
  `202 {tag, since}`. The page tells this run's steps from the last one's by
  `since`, not by the phone's clock, which needn't agree with the Pi's.
- `400` for a bad tag.
- `409` while a take is saving, a phone is recording, or the tape is playing
  or recording, or while an update has written a working state in the last
  15 minutes.
- `502` if GitHub can't be reached.
- `UPDATE_REPO` (default `gabeduke/hindsight`) picks the repo.
  `UPDATE_GITHUB_API` and `UPDATE_GITHUB` are test overrides, read by both
  the script and the server.

**The page** is `lib/update.js`.
- The button appears only when `available` is true.
- The sheet asks first: the ring starts empty after the restart, and it links
  to *What's new* on GitHub.
- It then follows the install: the script's own steps, then *Restarting…*.
  It reloads once `/api/status` reports the new tag.
- On a rollback it says *Couldn't update to v…* with the script's message.
- A rollback that happened while no one was watching is toasted once.
- The line shows even in the short-landscape layout that otherwise hides it,
  while an update is waiting.

**The rest:**
- A tips row ("Update to …"), guide §3.2 with [rig] checks, `docs/api.md`,
  and `docs/configuration.md`.
- The service worker caches `lib/update.js`. Cache v61, stacked on #70.

## Tests

- `scripts/test-updater.sh` runs the real script against a fake GitHub, a
  fake `/api/status` and a stub `systemctl`, in 25 checks:
  - dev → latest;
  - already current;
  - a failing `install.sh` rolls back, says why, and doesn't restart what
    it never changed;
  - a release that comes up on the wrong version rolls back;
  - a bad checksum installs nothing;
  - refused while saving;
  - a bad tag is refused;
  - a named tag installs;
  - two releases are kept;
  - an unexpected failure (the rollback copy failing) ends as `failed`.

  `test-release-scripts.sh` calls it, so CI runs it.
- `internal/api/update_test.go`:
  - the availability rules, and numeric ordering (`.10` is after `.9`);
  - the cache and `refresh`;
  - GitHub down;
  - state passthrough;
  - a failure is cached only briefly;
  - a chunked empty body;
  - `POST` writes `queued` with the `since` it answers, starts the latest or
    a named tag, refuses bad tags, refuses while
    busy, and refuses while an update runs, but not on a stale state;
  - `404` without an updater.
- `lib/update.test.js` covers the button label and the progress phases,
  including that last run's failure isn't this one's.
- Checked by hand: the demo with the script beside the binary, a fake
  GitHub, and a stub `systemctl` walking `update.json` through a rollback.
  Screenshots at 390 px.

## Untested on the rig

- A real `install.sh` run from the unit: `sudo apt-get` without a TTY,
  which needs passwordless sudo, as Pi OS gives its default user.
- The restart, and the page reconnecting.

The guide's §3.2 checks cover both.

## Later

- **The kit's channel** (K3): `UPDATE_CHANNEL_URL`, a file naming the tag,
  read instead of `releases/latest`. The script and the endpoint each take
  one extra branch.
- **The nightly timer:** a `.timer` running `hindsight-update@latest`, if
  wanted.

## Review

An independent review found these, all fixed before the PR:
- the phone's clock compared with the Pi's;
- `install.sh`'s hardcoded port;
- runs that could end stuck in a working state;
- a cancelled or failed GitHub answer cached for ten minutes;
- a chunked empty `POST`;
- apt run on every update;
- the notes link ignoring `UPDATE_REPO`.
