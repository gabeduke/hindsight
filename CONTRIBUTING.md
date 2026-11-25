# Contributing to Hindsight

Ideas and help are welcome. Hindsight has just been through a cleanup to make
it easier to maintain, so this page is about keeping it that way: every
change should make the app better at what people already do with it, and
leave the code with no more ways of doing a thing than it had before.

`AGENTS.md` holds the rules every change follows, whether a person or an agent
writes it. This page is the process around them: how an idea becomes a merged
pull request.

## 1. Start with an issue, not a pull request

Open an issue on this repo for each idea: what you want to do, and the moment
in a session when you'd want it ("after a long jam I want to find the bit
where we found the groove"). The maintainer decides which ideas go ahead and
in what order. Please don't open pull requests for ideas that haven't been picked;
a pile of open pull requests is hard to review and goes stale fast.

A bug can go straight to a pull request if it is small and comes with a
regression test (see *4*).

## 2. Agree a spec before the code

For anything bigger than a bug fix, write a short spec in `docs/plan/` and
agree it with the maintainer on the issue before building
([0057](docs/decisions/0057-specs-before-code.md)). A spec merges on its own,
cuts no release, and is cheap to change. It says:

- **The journey.** Which story in `docs/flows.md` it serves or extends, or the
  new story, written the way those are. **No journey, no merge:** an API, a
  package or a setting that nothing a person does reaches is code to maintain
  that nobody uses.
- **What it extends.** The existing module it builds on (look in
  `docs/architecture.md` first) and what it adds to that module's interface.
  If it needs a new module, why the existing one can't be extended. A second
  way to do what the code already does (another cut path, another menu,
  another player) isn't accepted, even if it is kept "in step" by a test.
- **Where it shows up.** Which room, which key, which menu, checked against
  *Where things live in the UI* in `AGENTS.md`. If it needs an exception to a
  decision in `docs/decisions/`, the spec asks for it outright; that's the
  maintainer's decision ([0021](docs/decisions/0021-exceptions-are-gabes-decision.md)).
- **The build order**, as a short list of pull requests.

A foundation that several features share (a new file format, a background
job, a new interface) gets a spec of its own and lands before the features
that use it.

## 3. One pull request at a time, one whole feature

- **A whole feature, not a layer.** A pull request carries the backend, the
  UI and its flow together, so it can be tried in the demo the day it merges.
  A spec's build order may land a shared interface first
  ([0020](docs/decisions/0020-build-the-interface-first.md)), but not an
  endpoint waiting for a UI that comes later.
- **Small, and against `main` here.** Branch from this repo's `main`, rebase
  before asking for review, and keep a stack to two pull requests at most.
  The next one starts after the last one merges.
- **Name the interfaces it touches**: the module, what it exports, who calls
  it, whether that changed, and the update to its file under
  `docs/architecture/` in the same pull request
  ([0022](docs/decisions/0022-a-pr-names-its-interfaces.md)).
- **Link the issue and the spec.** When the feature is done, fold the spec into
  `docs/architecture/` and `docs/flows.md`, and delete it.

## 4. Checks before review

Put these in the pull request description:

- The checks in *The checks to run* in `AGENTS.md`, all passing. Go code is
  built and tested on a machine with a working toolchain
  ([0026](docs/decisions/0026-go-changes-merge-only-after-running.md)).
- **The table from `node scripts/flows.mjs`**
  ([0043](docs/decisions/0043-the-user-flows-are-the-goal.md)), with the new
  or extended flow passing.
- For a UI change, screenshots from the demo at phone and tablet size, in
  both colour schemes, with its flag on and off
  ([0042](docs/decisions/0042-look-at-it-before-it-merges.md)).
- For a bug fix, a regression test you've seen fail against the unfixed code
  ([0025](docs/decisions/0025-a-regression-test-fails-first.md)).

## 5. Review reads the diff

Before a merge, someone who didn't write the change reads the diff against
`AGENTS.md`: a fresh agent given the code and the rules, not the author's
summary ([0023](docs/decisions/0023-review-the-diff-not-the-summary.md)).
Expect questions about why something is new rather than extended; that is the
review doing its job.

## Working with an AI agent

Most work here is done with an agent, and that's fine. A few things help:

- **One idea per session.** Hand the agent the issue and the agreed spec, not
  a list of ideas. A session that builds a dozen features in one go makes a
  dozen pull requests nobody can review.
- **Point it at `AGENTS.md` and this page**, and tell it to stop and report
  when the right way is bigger than the task, rather than building around it.
- **Use the strongest model you have for audio and UI code.** Those are where
  a plausible-looking shortcut costs the most later. A lighter model is fine
  for mechanical work: renames, docs, test scaffolding.
- **Read what it made before you open the pull request.** You are the author;
  the agent is a tool.

## Bigger ideas that don't fit the app yet

Hardware concepts, separate command-line tools and research prototypes are
welcome as issues and as designs, but they live outside the app's tree (their
own repo, or a design doc under `docs/hardware/`) until there is a journey
that needs them in the app.
