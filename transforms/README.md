# transforms/

Scripts that rewrite the doop tree mechanically, for changes that would be brittle as a
diff: config defaults, branding strings, a dependency pin, a regex across many files.

- Name: `NN-what-it-does` (two-digit order), executable, any language (`#!` line).
- `bin/doop apply` runs them in order, **after** all patches, with cwd = `build/doop` and
  `DOOP_ROOT` / `DOOP_UPSTREAM` (the upstream tag) set. Each one becomes one
  `chore(transform): <name>` commit (no hooks, fixed date, so builds stay reproducible).
- **Fail loudly.** First assert the target still looks the way you expect (`grep -q … || exit 1`),
  then rewrite. A transform that exits non-zero, or changes nothing, stops the build: after an
  upstream upgrade that is the signal to look at it again.
- Transforms are never exported to `patches/` and `bin/doop edit` leaves them out.

Rule of thumb: logic and new code → patch; "set X to Y everywhere" → transform.
