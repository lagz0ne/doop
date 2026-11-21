# v0.15.0-patched.3

Upstream v0.15.0, patches 0057-0060 on top of patched.2 (0001-0056). A frame's picture is
drawn soon after its design changes, instead of the first time someone looks, and a frame still
waiting for its picture shows a placeholder instead of a white box.

## Before deploying

- Database dump: not needed, there are no migrations.

## Deploying

- No dependency or Dockerfile changes.
- **New optional setting:** `PREVIEW_PRERENDER` (default on). The server draws a frame's
  smallest picture in the background about 4 s after its html or size last changed, and not
  while an agent is still streaming into it. It draws one frame at a time, at background
  priority. Set `PREVIEW_PRERENDER=0` to draw pictures only when they are first asked for, as
  before. That suits a deployment whose renderer is a remote browser billed per session
  (`REMOTE_BROWSER_URL`).
- **Expect more Chromium work right after edits.** An agent's burst of edits now costs one
  background render per changed frame: about 0.3-0.7 s for a screen-sized frame and 2-6 s for
  a tall page. It used to cost nothing until someone looked.
- The version file next to each stored picture (`thumb/<id>.<level>ver` in object storage)
  now holds `<version> <design hash>`. Older files are still read as a version alone.

## Checking

- Edit a frame and wait 10 s. A page opened from a fresh browser then shows that frame's
  picture at once.
- `prerender failed` lines in the server log mean a background render failed; the picture is
  then drawn on request, as before.
- Moving or renaming a frame no longer redraws its picture: no new `[slow-op] GET /i/` line
  for it.

## Rolling back

- Point the deployment at `v0.15.0-patched.2`. Nothing in the database changed. patched.2
  reads the newer version files as unknown versions: it serves each stored picture at once
  and redraws it once in the background.
