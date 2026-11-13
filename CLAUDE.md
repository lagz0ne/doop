# doop build

A patched build of [doop](https://github.com/kgoedecke/doop), the multiplayer design canvas for
people and AI agents. This repo does not contain doop's code as something to edit. It holds
**upstream, pinned and untouched**, plus **our changes as patches and transforms**, plus the
tool that combines them.

This repo is public and kept neutral: nothing about a particular deployment (hostnames,
accounts, canvases, infrastructure ids, local paths, the apps that use it) goes into tracked
files, patches or commit messages. That lives in git-ignored files: `CLAUDE.local.md` (this
manual's local half, which Claude Code loads too), `.env.local` (settings for the tools, keys
in `.env.example`) and `local/` (notes, deploy log, hooks).

## The rule

**Never change doop's code directly. Patch or transform it.**

- `vendor/doop` is upstream (git submodule → github.com/kgoedecke/doop), checked out at the
  pinned tag. Never edit, commit or build in it. `bin/doop check` fails if it isn't pristine.
- `patches/NNNN-*.patch` are our code changes, one commit each (`git format-patch` output),
  applied in order with `git am`.
- `transforms/NN-*` are scripts that rewrite the tree mechanically, run after the patches
  (see `transforms/README.md`).
- `build/doop` is **generated** (git-ignored, a worktree of vendor): pin + patches + transforms.
  Work happens there, but only what you `export` survives. `bin/doop apply` rebuilds it from scratch.
- A side worktree of vendor (`build/<name>`, for work in parallel) is a scratch tree too: commit
  there in patch form (one conventional commit per patch), then bring the commits into build/doop
  (`bin/doop edit`, `git cherry-pick`), `bin/doop export` and `bin/doop check --test`. Never
  release, deploy or hand anyone a build from a side tree. `bin/doop status` lists every side tree
  holding work that is not in `patches/` yet.
- Every session working on doop follows this. A change that is not a patch in `patches/` (or a
  transform) does not exist: it is not reviewed, not released and lost on the next rebuild.

## Layout

| path | what |
|---|---|
| `vendor/doop` | upstream doop, pinned (submodule; its git dir also has the remote releases are pushed to, `fork` by default) |
| `patches/` | our changes, in order |
| `transforms/` | scripted rewrites, in order |
| `bin/doop` | the tool (below); `bin/shims/bunx` lets doop's own git hooks run |
| `bin/doopctl` | users, sharing, canvas owners and agent keys on a running doop (below) |
| `build/doop` | generated: pin + patches + transforms (keeps its `node_modules`, `dist`, `data` across rebuilds) |
| `build/base` | generated: the pristine pin, for A/B perf runs |
| `perf/` | render-perf harness and results (`perf/README.md`); traces in `perf/out/` (ignored) |
| `docs/history.md` | what we changed and why, and the decisions behind it |
| `.env.example` | the settings `bin/doop` and `bin/doopctl` read from `.env.local` |

## bin/doop

    bin/doop status            # pin, patches, transforms, build state, last release (and deploy)
    bin/doop apply             # build/doop := pin + patches + transforms
    bin/doop edit              # build/doop := pin + patches, on branch 'work'
    bin/doop commit -m "…"     # git commit in build/doop (doop's lint-staged + commitlint run)
    bin/doop export            # build/doop's commits → patches/ (rewrites the series)
    bin/doop check [--test]    # vendor pristine, everything applies (--test: typecheck + vitest)
    bin/doop check --browser  # --test plus the ~30 browser test files (Playwright's Chromium)
    bin/doop base              # build/base := pristine pin
    bin/doop serve [--base]    # local production doop on :4477 (patched) / :4478 (base), for perf
    bin/doop release [--push]  # tag <upstream>-<suffix>.<n>, move the release branch, push
    bin/doop upgrade <tag>     # move the pin to a new upstream tag, re-apply, refresh patches

`apply`/`edit` refuse to throw away uncommitted or unexported work in build/doop; `--force`
(before the command) overrides. Release naming, the push remote, the committer and the
post-release hook come from `.env.local` (`.env.example` lists them and their defaults).

## bin/doopctl

Manages a running doop through its operator API (`/api/operator`, our `feat(operator)` patch):
accounts, canvas sharing, canvas owners and agent keys. `bin/doopctl --help` lists everything.

    bin/doopctl users                              # accounts
    bin/doopctl users create <email> [--name N]    # works while sign-up is closed; prints a password once
    bin/doopctl share "<canvas name>"              # who can open a canvas, and its link setting
    bin/doopctl share add <canvas> <email>...      # members (accounts must exist)
    bin/doopctl share link <canvas> none|view|comment|review|edit [--password-stdin | --no-password]
    bin/doopctl keys create <email> <name>         # MCP agent key; secret printed once

- **Talks to the server, never the database.** Canvas members, owners and link access live in
  the server's memory with write-through, so a direct database write is lost or ignored.
- **Token:** `DOOP_ADMIN_TOKEN`, else the file `DOOP_ADMIN_TOKEN_FILE`, else
  `~/.config/doop/admin-token` (mode 600). The server side is off until the instance has the
  same `DOOP_ADMIN_TOKEN` (32+ chars). Whoever holds it controls every account and canvas.
- **Target:** `--url` / `DOOP_URL`, default `http://localhost:4477` (`bin/doop serve`).
  `--connect` / `DOOP_CONNECT` opens the connection to another address with TLS and Host kept,
  for an instance whose proxy admits `/api/operator` from loopback only.
- **Safety:** passwords never go in argv (`--password-stdin`, or the server generates one).
  Destructive commands ask for "yes", or need `--yes` when there is no terminal. `users delete`
  shows which canvases go with the account first. Every write is logged by the server as
  `[operator] …`.

## Workflows

**Change doop (new patch, or amend one):**
1. `bin/doop edit`
2. Change files in `build/doop`, then `bin/doop commit -am "perf(canvas): …"`. Use one commit
   per patch with a conventional message (doop's commitlint enforces it); the message body
   is the patch's documentation, so say why and give numbers. To amend or split an existing
   patch, `git -C build/doop rebase -i <pin>`.
3. `bin/doop export && bin/doop check --test`
4. Commit `patches/` in this repo.

**Mechanical change:** add `transforms/NN-name`, then `bin/doop apply` to see the result, then commit it.

**Upgrade upstream:** `bin/doop upgrade vX.Y.Z`. If a patch conflicts, resolve it in
`build/doop`, run `git -C build/doop am --continue`, then `bin/doop export`. Check that every
transform still applies, then `bin/doop check --test` and commit (`vendor/doop` + `patches/`).

**Release:**
1. Commit this repo first; a release must come from a commit.
2. `bin/doop release --push`. It tags the build `vX.Y.Z-<suffix>.N`, moves the release branch
   and pushes both. A deployment builds doop's own Dockerfile from that tag.
3. `DOOP_POST_RELEASE` (if set) is run with the tag, e.g. to ask for the deploy.

## Facts

- Builds are reproducible. `git am --committer-date-is-author-date` with a fixed committer
  (`DOOP_COMMITTER_NAME/EMAIL`) means the same pin and patches give the same commit hash.
  `bin/doop status` shows what is released; `patches/` can be ahead of it.
- Patches must not need Dockerfile or dependency changes unless whoever deploys is told.
- Local `build/*/data` is throwaway perf data.
- bun: `bin/doop` puts `~/.bun/bin` and a `bunx` shim on PATH. Use `bin/doop commit` (or put
  `bin/shims` and bun on PATH) when committing in build/doop, or doop's husky hooks fail.
- `bun install` and `vite build` are slow on a slow disk, so leave `build/doop/node_modules`
  in place.
- The UI hides the team/product chrome (Share, Owned/Shared scopes, Community, Automations,
  Integrations, Webhooks, plan line, Help, and on Home the Agents rail section and the "Ask me what
  to design" hero) behind `FULL_UI` (`src/lib/fullUi.ts`, our `feat(ui)` patch). Workspaces stay.
  Only the entry points are hidden, not the routes. Share comes back for a canvas's owner (0020:
  the link's level and an optional password; visitors give a name, and the password, at a door).
  With FULL_UI off the editor also uses a reviewer layout (patch 0013, `CanvasDock.tsx`): one
  dock along the bottom instead of the top bar, tool rail and side rail, the Hand first, Layers
  folded; the review panel at `/embed` uses the same layout (0014).
  `localStorage['doop:full-ui']='on'` plus a reload brings it back in one browser.
