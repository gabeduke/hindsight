@AGENTS.md

`AGENTS.md`, above, is the rules; this file exists so Claude Code loads it.

Work is tracked in GitHub, not in a file: start from the issue or PR you were
given, or `gh issue list` / `gh pr list`. There is no session-handoff file to
read or write ([0067](docs/decisions/0067-github-issues-are-the-state.md)).
Home network details live in the untracked `deploy.local.env`, never in an
issue, a comment or a doc.
