# Release notes for whoever deploys

Each release that needs more than "build the tag and restart" gets a note here, saying what
the person deploying it has to do. Mastodon and GitLab publish upgrade notes the same way.

- `NEXT.md` holds the notes for the next release. Write it with the patch work, as the
  "Unreleased" section of a Keep a Changelog file is written.
- `bin/doop release` refuses to tag when the build changes something a deployment must
  act on and there is no `NEXT.md`. Those changes are migrations, dependencies
  (`package.json`, `bun.lock`), the `Dockerfile`, `docker-compose.yml` and `.env.example`,
  compared with the last release.
- On release, `NEXT.md` goes into the tag's message and onto the GitHub release for the tag
  (with `--push`, when `gh` is there). It becomes `<tag>.md` and is committed. The
  post-release hook gets its path as `$2`.
- A note never names a deployment: no hostnames, accounts or ids. Those stay in the
  deployment's own runbook.

## What a note says

Leave out the sections that don't apply.

```markdown
# <tag>

Upstream vX.Y.Z (was vA.B.C), patches NNNN-MMMM. One line on what changes for people.

## Before deploying
- Database dump: yes/no, and why (which migrations).

## Deploying
- Dependencies added or removed; Dockerfile changes.
- Environment: new required settings, changed defaults, new optional ones worth knowing.
- Behaviour a supervisor or proxy must allow for.

## Checking
- What shows it worked (boot log lines, a page, an endpoint).

## Rolling back
- To which tag, and whether the database has to go back too.
```
