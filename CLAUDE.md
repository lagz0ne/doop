# doop (patched build)

Our build of [doop](https://github.com/kgoedecke/doop), the design canvas that runs at
https://doop.example.com (the host's design lives there). This repo does not contain doop's code
as something to edit. It holds **upstream, pinned and untouched**, plus **our changes as
patches and transforms**, plus the tool that combines them.

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

## Layout

| path | what |
|---|---|
| `vendor/doop` | upstream doop, pinned (submodule; its git dir also has the `fork` remote = github.com/the fork/doop) |
| `patches/` | our changes, in order |
| `transforms/` | scripted rewrites, in order |
| `bin/doop` | the tool (below); `bin/shims/bunx` lets doop's own git hooks run |
| `bin/doopctl` | users, sharing, canvas owners and agent keys on a running doop (below) |
| `build/doop` | generated: pin + patches + transforms (keeps its `node_modules`, `dist`, `data` across rebuilds) |
| `build/base` | generated: the pristine pin, for A/B perf runs |
| `perf/` | render-perf harness and results (`perf/README.md`); traces in `perf/out/` (ignored) |
| `docs/history.md` | what we changed and why, deploy history, decisions |

## bin/doop

    bin/doop status            # pin, patches, transforms, build state, last release, last deploy
    bin/doop apply             # build/doop := pin + patches + transforms
    bin/doop edit              # build/doop := pin + patches, on branch 'work'
    bin/doop commit -m "…"     # git commit in build/doop (doop's lint-staged + commitlint run)
    bin/doop export            # build/doop's commits → patches/ (rewrites the series)
    bin/doop check [--test]    # vendor pristine, everything applies (--test: typecheck + vitest)
    bin/doop base              # build/base := pristine pin
    bin/doop serve [--base]    # local production doop on :4477 (patched) / :4478 (base), for perf
    bin/doop release [--push]  # tag <upstream>-patched.<n>, move fork branch 'patched', push to the fork
    bin/doop upgrade <tag>     # move the pin to a new upstream tag, re-apply, refresh patches

`apply`/`edit` refuse to throw away uncommitted or unexported work in build/doop; `--force`
(before the command) overrides.

## bin/doopctl

Manages a running doop through its operator API (`/api/operator`, our `feat(operator)` patch):
accounts, canvas sharing, canvas owners and agent keys. `bin/doopctl --help` lists everything.

    bin/doopctl users                              # accounts
    bin/doopctl users create <email> [--name N]    # works while sign-up is closed; prints a password once
    bin/doopctl share "Big canvas"              # who can open a canvas, and its link setting
    bin/doopctl share add <canvas> <email>...      # members (accounts must exist)
    bin/doopctl share link <canvas> none|view|comment|edit
    bin/doopctl keys create <email> <name>         # MCP agent key; secret printed once

- **Talks to the server, never the database.** Canvas members, owners and link access live in
  the server's memory with write-through, so a direct database write is lost or ignored.
- **Token:** `DOOP_ADMIN_TOKEN`, else `~/.config/doop/doop-admin-token` (mode 600). The
  server side is off until the hub sets the same `DOOP_ADMIN_TOKEN` (32+ chars) on the the deployer
  app. Whoever holds it controls every account and canvas.
- **Target:** `https://doop.example.com`, or `--url` / `DOOP_URL` (e.g. a local `bin/doop serve`).
  In production the operator API is **host-only** (the human's choice, 2026-11-12): Traefik allows
  `/api/operator` from loopback alone, so doopctl connects to doop.example.com through
  `127.0.0.1:443`, with TLS and Host still `doop.example.com`. So it works only on this machine.
  `--connect` / `DOOP_CONNECT` overrides that (an address, or `dns`).
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

**Release and deploy:**
1. Commit this repo first; a release must come from a commit.
2. `bin/doop release --push`. It tags the build `vX.Y.Z-patched.N` on the fork and moves `patched`.
3. Deploying is the hub's job (the deployer is hub-owned). Send the `hubq send …` line that
   `release` prints (skill `hub-request`). The hub points app `<app>`
   (`<app-id>`) at the tag and deploys.
4. Check with `deploys doop` (read-only), then open https://doop.example.com.

   Rollback: ask the hub to point the app at the previous tag (or at `kgoedecke/doop` + the plain
   upstream tag).

## Paseo

Work on doop through Paseo: project `doop` (`<project>`), workspace `doop`
(`<workspace>`, **local** isolation, at this directory). Scripts (`paseo.json`):
`status`, `check`, `test` (check --test), and the services `app` (patched doop) and `base`
(pristine upstream), each on a Paseo port behind its proxy URL, for perf A/B.

Don't use worktree isolation here: there is one `build/doop` (shared node_modules + local data),
and a new superproject worktree would have no `vendor/doop` until `git submodule update --init`
re-clones it. Agents share the local workspace and take turns on `build/doop` (`apply`/`edit`
refuse to clobber unexported work).

## Facts

- Builds are reproducible. `git am --committer-date-is-author-date` with a fixed committer
  (`lagz0ne`, overridable via `DOOP_COMMITTER_NAME/EMAIL`) means the same pin and patches
  give the same commit hash: pin v0.12.0 + 0001-0004 = `38b882d` = `v0.12.0-patched.2`, + 0001-0006
  = `ed357c2` = `v0.12.0-patched.3`. `bin/doop status` shows what is released and what is deployed;
  `patches/` can be ahead of both.
- the deployer builds doop from the **fork's tag** with doop's own Dockerfile; we never push images.
  Patches must not need Dockerfile or dependency changes unless the hub is told (it verifies
  this before deploying).
- Production data is the `doop-data` volume (`/app/data`) plus Postgres `doop-db`, all
  hub-managed. Local `build/*/data` is throwaway perf data.
- Machine: bun is `~/.bun/bin/bun` (not on the default PATH, and there's no `bunx`);
  `bin/doop` adds both. Use `bin/doop commit` (or put `bin/shims` and `~/.bun/bin` on PATH)
  when committing in build/doop, or doop's husky hooks fail.
- The disk is slow (HDD RAID1): `bun install` and `vite build` take minutes, so leave
  `build/doop/node_modules` in place.
- The UI hides the team/product chrome (Share, Owned/Shared scopes, Community, Automations,
  Integrations, Webhooks, plan line, Help, and on Home the Agents rail section and the "Ask me what
  to design" hero) behind `FULL_UI` (`src/lib/fullUi.ts`, our `feat(ui)` patch). Workspaces stay
  (the human, 2026-11-12). Only the entry points are hidden, not the routes.
  `localStorage['doop:full-ui']='on'` plus a reload brings it back in one browser.
- Using doop as a design tool (the host's canvas, the doop MCP, canvas import tooling) is
  the host's business (`../host-app`, skill `doop-ui`), not this repo's.
