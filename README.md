# doop, patched build

Our build of [doop](https://github.com/kgoedecke/doop), the multiplayer design canvas for
people and AI agents, as it runs at https://doop.example.com.

This branch (`main`) does not hold doop's code as something to edit. It holds:

- `vendor/doop`: upstream doop, pinned at a release tag (a git submodule).
- `patches/`: our changes, one `git format-patch` file each, applied in order.
- `transforms/`: scripted rewrites run after the patches (none yet).
- `bin/doop`: the tool that combines them, checks them and releases them.

`bin/doop apply` builds `build/doop` = pin + patches + transforms. `bin/doop release --push` tags
that build as `vX.Y.Z-patched.N` on this repository and moves the `patched` branch to it; the
deployment builds doop's own Dockerfile from that tag. `docs/history.md` records what we changed,
why, and every release and deploy. `CLAUDE.md` is the working manual.

Branches and tags here:

- `main`: this build repo (trunk-based).
- `patched` and the `v*-patched.*` tags: the built doop source, what gets deployed.
- `upstream-main`: what this fork's `main` held before it became the build repo (a mirror of
  kgoedecke/doop's main at the time).

doop is AGPL-3.0; so are our patches. The built source for every deployed version is the
`v*-patched.*` tag of the same name.
