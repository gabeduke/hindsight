# Moving between releases

**Date:** 2026-10-09 · **Status:** asked for by Gabe on 2026-10-09, after
[the Update button](2026-10-09-update-button-design.md) · **Repo:**
`hindsight`

## Why

The Update button only went forward, to the latest release. Gabe wants two
more things:
- **to flip back** through earlier releases, though never to one before the
  button existed, which would take the button away;
- **to see what he'd be loading:** each release's notes between what's
  running and the pick.

He also hit two rough edges on the first day:
- a `deploy.sh` build said `dev`, so the footer didn't say what was running;
- a page left open never noticed a new release.

## What

**The footer.** It reads *Hindsight v… · **Releases** · the guide*, with
**● Update to v…** under it when a newer release is out. Releases appears
wherever the updater is installed.

**The sheet:**
- It lists every release from the floor up, newest first by version, with
  its date, and badges for *running* and *latest*. It's a radio group, so the
  arrow keys move the pick.
- Picking a release shows what moving to it changes:
  - **Forward:** *This brings in* every release after the running one, up to
    the pick, each with its notes.
  - **Back:** *This takes out* every release after the pick, up to the
    running one, in amber. The key says **Go back to v…**.
  - **The running release:** no key.
  - **A `deploy.sh` build:** its base release is offered as *Go back to*,
    with a note that the build is ahead by commits.
  - **A `dev` build:** shows the release's own notes.
- Then it's the same install as before: the warning, the progress, the
  reload, and the rollback message.
- **Update to v…** opens the same sheet with the latest picked.

**The floor.** `UpdateFloor = v2026.10.09.3`, the first release with the
updater.
- `GET /api/update/releases` lists nothing below it.
- `POST /api/update` refuses anything below it with `400`.
- `hindsight-update` refuses it too, comparing with `sort -V` so that `.10`
  ranks above `.9`. `UPDATE_FORCE=1` overrides it from a shell. `UPDATE_FLOOR`
  is for tests.

**`GET /api/update/releases`** returns `{running, floor, releases:[{tag,
date, url, changes}], error}`.
- It reads GitHub's `/releases?per_page=50` and drops drafts, prereleases and
  anything below the floor.
- It sorts the rest by version.
- `changes` are the release body's commit lines, without the changelog's
  `[skip ci]` commits or the hashes.
- It's cached like `latest`: ten minutes, or one minute after a failure.

**Cleaner notes.** `release.yml` now leaves the changelog's own commits out
of each release's notes. It uses `--invert-grep --grep='\[skip ci\]$'`,
anchored to the end of a line, so a commit that only mentions the marker in
its body keeps its place. The API filters them out of older releases too.

Never put the literal marker in a commit message or PR description: GitHub
skips CI for a push whose head commit mentions it anywhere. The review caught
this commit's first message doing exactly that.

**Rechecks.** The page asks `/api/update` again every hour while it stays
open, and when the tab becomes visible after ten minutes or more away.

**`deploy.sh` stamps its build** with
`git describe --tags --dirty --always`, for example
`v2026.10.09.4-2-gabc1234`. Versions compare by the release before the
`-`/`+`, on the Pi and in the page. So a stamped build is `available` an
update only when a later release is out.
- Without tags (a shallow clone), it shows the bare hash, which is treated
  like `dev`.
- Anything that isn't `[0-9A-Za-z._+-]` becomes `dev`, before it goes near
  the ssh command line.

**The rest:** tips rows for *Releases* and *Update to …*, guide §3.2
rewritten with [rig] checks, `docs/api.md`, and the cache at v62.

## Tests

- `releases_test.go`:
  - the floor, the drafts and sorting by version (`.10` over `.9`, whatever
    the publish dates);
  - the changes, with the noise dropped;
  - the cache;
  - a `404` without an updater;
  - git-stamped versions comparing as their release.
- `update_test.go`: `POST` refuses tags below the floor. The versions in its
  fixtures moved above the floor.
- `update.test.js`: `cmpVersion`, `versionParts`, and `plan` going forward,
  back, staying the same, from a stamped build and from `dev`.
- `test-updater.sh`, 29 checks: below the floor fails and says why, and a
  `.10` installs over a `.9` floor.
- By hand: the demo running v2026.10.09.4 against a fake GitHub with .2 to
  .6. Screenshots at 390 px (light) and 1280 px (dark) show the forward and
  back views. The key is hidden on the running release.

## Review

An independent review found these, all fixed before the PR:
- the marker in the commit message, above;
- the Update line opening a sheet that showed only an error when the
  releases list failed. It now falls back to the latest alone;
- a `deploy.sh` build not getting its *running* badge (*running +*) or the
  default pick;
- an import in the middle of the test file.

## Not done

- **Paging past 50 releases.** At roughly one a merge, that's weeks of
  history.
- **Pinning a channel for the kit** (`UPDATE_CHANNEL_URL`). It's still K3.
