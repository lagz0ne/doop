# doop, patched

A patched build of [doop](https://github.com/kgoedecke/doop), the multiplayer design canvas for
people and AI agents: faster canvases with many frames, sharper previews, a quieter UI for
people who review rather than design, an operator API, and an embeddable review panel that
host apps sign their users in to.

This branch (`main`) does not hold doop's code as something to edit. It holds:

- `vendor/doop`: upstream doop, pinned at a release tag (a git submodule).
- `patches/`: our changes, one `git format-patch` file each, applied in order.
- `transforms/`: scripted rewrites run after the patches (none yet).
- `bin/doop`: the tool that combines them, checks them and releases them.
- `bin/doopctl`: a client for the operator API (accounts, sharing, agent keys).

`bin/doop apply` builds `build/doop` = pin + patches + transforms. `bin/doop release --push` tags
that build as `vX.Y.Z-<suffix>.N` and moves the release branch to it; a deployment builds doop's
own Dockerfile from that tag. `docs/history.md` records what we changed and why. `CLAUDE.md` is
the working manual; `.env.example` lists the settings for a local setup.

Branches here:

- `main`: this build repo (trunk-based).
- the release branch and tags: the built doop source, what gets deployed.
- `upstream-main`: what this fork's `main` held before it became the build repo (a mirror of
  kgoedecke/doop's main at the time).

doop is AGPL-3.0; so are our patches. The built source for every released version is the tag
of the same name.
