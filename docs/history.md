# History

What we changed in doop, why, and the decisions behind it. (Deployment specifics are kept
outside this repo.)

## Timeline

| when | what |
|---|---|
| 2026-11-11 | doop is slow with many items on a page (a real design canvas with ~200 live frames per page). Decided: patch doop ourselves and stay on open source, as a public fork |
| 2026-11-11 | Patch 0001 (keep live iframes only near the camera) released, then held: frames without a live document couldn't be selected or dragged at low zoom |
| 2026-11-11 | v0.12.0 + 0001-0004 (`38b882d`): fixes that bug and is much faster. Deployed |
| 2026-11-12 | This repo set up: vendor + patches + transforms. Patches 0001-0004 rebuild `38b882d` exactly |
| 2026-11-12 | We care about the canvas, not doop's multi-user product. Decided: don't strip accounts out of the code (identity is wired through REST, WS and MCP, and upstream moved 526 files from v0.12.0 to v0.14.0 in 8 days, so a strip would be a hard fork); hide the team/product chrome instead (`feat(ui)`, flag `FULL_UI`) |
| 2026-11-12 | A safe, fast CLI for users and sharing. Decided: an operator API in the server plus `bin/doopctl` as its client (mmctl's model), with a bearer `DOOP_ADMIN_TOKEN`, not an admin login. Writing the DB directly is unsafe (sharing lives in server memory), and doop's own API can't do it (sign-up closed, sharing owner-only, no admin in production without SMTP) |
| 2026-11-12 | v0.12.0 + 0001-0006 released and deployed. The operator API is reachable from the server's host only: the reverse proxy admits `/api/operator` from loopback alone, as a case-insensitive match, because Express matches routes case-insensitively and `/api/Operator` would bypass a plain prefix rule; `bin/doopctl --connect` connects through 127.0.0.1 with TLS and Host kept. Note: a 401 alone doesn't prove the API is on (the session gate also answers 401) |
| 2026-11-12 | v0.12.0 + 0001-0009 (`6914e39`, 0007-0009: preview fidelity) released and deployed. Checked read-only on production: a page of 32 culled frames asks for `/i/<id>.webp?preview&s=0.25`, all 200 `image/webp`, `immutable`, loaded 1.7 s after opening; the pictures are in the frames' own font and a 12640×400 banner is 3160 px wide at 0.25 and 12640 px at 1 |
| 2026-11-12 | Make doop lightweight and embeddable in other systems instead of a standalone service; the use is a design system worked by AI and reviewed by humans. Several host apps use one doop through MCP, each with its own login; only agents write to the canvases. Decided: (1) one doop backend, embedded UI: each host shows a doop review panel in an iframe and signs its user in with a short-lived token (the Metabase / Superset guest-token model), nobody logs into doop; not doop-as-a-library (AGPL would reach the host, React 18 vs 19, one copy per host). (2) Humans review only: look, comment, approve or request changes; no editor in the panel. (3) First upgrade to v0.14.0 and check our patches |
| 2026-11-12 | Pin moved v0.12.0 → v0.14.0 (526 files upstream). Upstream fixed none of what our patches fix, so all 9 stay; v0.14.0 + 0001-0009 = `144b2ea`. 0001, 0004 and 0008 needed hand merges (0004: the shell now carries v0.14's stacking order, rotation and borderless surface), 0005 was redone on v0.14's rewritten rail/home/settings and also hides the account menu's "Get desktop app" and "Doop website" links, 0006 applied as it was. What a deploy brings: 9 DB migrations (0040-0048, so a database backup first and no rollback to v0.12 builds without it), `fonts-dejavu-core` in the Dockerfile, optional `SECRETS_ENCRYPTION_KEYS` (unset = stored credentials stay plaintext, with a boot warning), design tokens (MCP `get_tokens` / `create_tokens` / `set_tokens`), and signed-out viewing of link-shared canvases |
| 2026-11-13 | Before deploying v0.14.0: link sharing turned off on every canvas (v0.14.0 lets signed-out visitors view link-shared canvases), with `bin/doopctl`. v0.14.0 + 0001-0009 released and deployed, database dumped first, 9 migrations applied |
| 2026-11-13 | Embedded review: 0010 feat(review) (a `review` role between comment and edit, `changes_requested`, `frame.approval` event and webhook) and 0011 feat(embed) (host-signed 5-minute token → a session for one canvas at one role, route allow-list, reviewer room filter, `DOOP_EMBED_HOSTS`, `TRUSTED_ORIGINS` for the panel hostname, migration 0049). Calls: approve without edit; reviewers see frames, pages, comments and verdicts only; the panel gets its own hostname, since people still use doop directly; agents hear verdicts by polling `changes_requested` plus the panel's `doop:verdict` postMessage. The proposal was drawn on doop itself, as an explainer page and a clickable prototype of a host's review tab |
| 2026-11-13 | 0012 feat(embed): the review panel at `/embed` (own small bundle, frame-ancestors limited to the configured hosts, token in the fragment, the editor's frame runtime for live frames and pinned comments, request changes / approve, compare with the version of the last verdict, postMessage to the host page). Checked end to end with a stand-in host app (`perf/embed-host.mjs`, `perf/embed-e2e.mjs`). v0.14.0 + 0001-0012 released and deployed (database dump first, migration 0049); embedding stays off (`/embed` 404) until a host is configured |
| 2026-11-13 | Panel hostname: a dedicated one over a cookie-less subpath (sized at half a day: bearer token in the panel's memory, no cookie; kept as the fallback for a host on another site). Keep `allow-same-origin` off the panel's frame iframes: designs must never share the panel's origin. Smoke test with a host-signed view token: `/embed` 200 with the host in `frame-ancestors`; exchange 200 with a host-only cookie; the canvas reads without memory; another canvas 403; a frame edit 403; the same token again 401; another origin 403 |
| 2026-11-13 | A simpler editor for someone who comments and reviews but does not design: Import / Export / Connect AI / the AI activity panel into a bottom dock with settings and profile; Layers foldable and folded; title, home and canvas id merged with the zoom into one bar; tools folded, Hand by default; dock icons only; Prototype mode kept with the tools; the review panel in the same layout. Shown first as before/after frames on doop, revised twice, then built: 0013 feat(ui) (the editor, FULL_UI off, desktop, floating panels; `doop:full-ui` on brings the old layout back) and 0014 feat(embed) (the panel). Browser tests run the full layout by default (`tests/browser.ts`); `reviewerLayoutBrowser.test.ts` covers the dock. v0.14.0 + 0001-0014 released and deployed |
| 2026-11-13 | This repo became public, as the fork's `main`; the fork's previous `main` (an upstream mirror) is kept as branch `upstream-main`. History was rewritten to keep it neutral: real canvases used as perf data, deployment names and ids stay local (git-ignored, see `CLAUDE.md`), and the patches were reworded to drop them |
| 2026-11-13 | Reviewers without an account: the hidden Share button was not the whole gap, since upstream's link gives signed-out visitors a look only and comment/edit need an account (sign-up is closed). Chose the review-link model (Frame.io review links, InVision share links: a name and an optional password) over making accounts per reviewer or one instance-wide password. Built on 0011's session-held grant. The owner decides everything: level (view, comment, review, edit) and whether there is a password; one password per canvas, so a leak exposes one canvas and changing it signs earlier guests out. Share is back for the owner with FULL_UI off. 0020 adds migration 0050 (a database dump before deploying) |
| 2026-11-14 | v0.14.0 + 0001-0020 released and deployed (database dump first, migration 0050); every canvas's link stays off until its owner picks a level |
| 2026-11-14 | Phones still showed the editor's phone layout (top bar, tool strip, Layers and Prototype mode first) while desktop and the panel used the reviewer layout. Decided: the same layout on phones, review first, as phone design viewers do it (a bottom bar within thumb reach, the rest behind •••): 0021 feat(ui). The dock holds back, Hand, Comment, the tool list, Comments, Pages and layers and •••, at the 40px touch size, and fits a 320 px screen (283 px; a tool picked from the list takes the list's button, Prototype mode stays in the list, AI activity is a tab of the Comments sheet) |
| 2026-11-14 | v0.14.0 + 0001-0021 released and deployed |
| 2026-11-14 | Issue #2: agents could reply to and resolve comments but not start one, read a frame's HTML only through MCP, and hear comment webhooks for every canvas without the element named; with FULL_UI off nobody could set a hook. Decided: 0022 `add_comment` (the browser's anchors, an element by id or selector, refused when it is not there rather than falling back to the frame; an @mention needs edit and is metered like the browser's), 0023 `GET /api/frames/:id/html` for agent keys and sessions (no public URL: that would be new exposure; served under a sandbox CSP, since frame HTML carries scripts), 0024 hooks limited to listed canvases, `elementId` and `snippet` in the payload, and hooks managed through the operator API (`bin/doopctl webhooks`) rather than unhiding the Settings pane. 0024 adds migration 0051 |
| 2026-11-14 | PR #1 (written against 0001-0020) carried over as 0025-0026. Its review found the direct-only switch trusts the proxy to add `X-Forwarded-For`/`Forwarded`; rather than drop it, 0027 adds a separate listener for the operator API (the admin-port model of Caddy and Envoy), and the switch's limit is documented |
| 2026-11-14 | Upstream checked: no release after v0.14.0; 44 commits on `main`, none covering #2. Its migrations 0049-0052 are dated before ours (see Upgrading) |

## Patches

| # | what | why |
|---|---|---|
| 0001 | perf(canvas): keep live iframes only for frames near the camera | every frame was a live document, laid out and held at once (203 frames: ~590 ms click to paint). Far or zoomed-out frames show their preview image; `localStorage['doop:cull']='off'` restores the old behaviour |
| 0002 | perf(ui): drop the `body:has()` rule that restyled the document on every insertion | `body:has([data-panel-resizing]) *` invalidated the whole document's style on every insertion: 40-70 ms per click on a 188-frame page |
| 0003 | perf(previews): versioned previews are immutable and their versions outlive a restart | culled frames show hundreds of previews: current-version previews are now `immutable` (was max-age=60), and the rendered version is stored beside each thumbnail so a restart doesn't re-render them all |
| 0004 | perf(canvas): culled frames are shells, a pan is one transform, documents boot in turn | FrameShell instead of a full FrameView for frames without a live document; camera offset only on the label layer; staged document boot; fixes 0001's selection bug |
| 0005 | feat(ui): put away the team and product chrome on a one-person instance | used for the canvas: Share, Owned/Shared filters, Community, Automations, Integrations, avatar stacks, plan line, Help menu, the Webhooks pane, and on Home the Agents rail section and the "Ask me what to design" hero, hidden behind `FULL_UI` (`src/lib/fullUi.ts`). Workspaces kept. Entry points only; routes and server unchanged. `localStorage['doop:full-ui']='on'` restores |
| 0006 | feat(operator): a token-gated API for users, sharing, canvas owners and agent keys | backs `bin/doopctl`. `/api/operator` answers only a bearer `DOOP_ADMIN_TOKEN` (32+ chars) and is absent while it is unset. Works with sign-up closed; audit lines `[operator] …`; `tests/operator.test.ts` |
| 0007 | fix(screenshot): wait for a frame's web fonts before capturing it | a render waited for `load` + 120 ms, which does not cover `font-display: swap` fonts: 5-13 of 24 real frames were captured in the fallback face (other widths and line breaks than the live frame), and the picture was then cached as immutable. Now waits for `document.fonts.ready` (≤ 3 s): 0 of 24. Upstream bug, worth offering |
| 0008 | perf(previews): the canvas shows each frame's preview at the scale it is on screen | the preview was the dashboard thumbnail, one 640 px JPEG q70 whatever the frame or zoom (a 12640×400 banner: 640×20 px). Now a pyramid of WebP q90 pictures at 0.25 / 0.5 / 1 (`/i/<id>.webp?preview&s=`), the level picked from zoom × devicePixelRatio when the camera rests, sharp levels only near the view |
| 0009 | fix(canvas): a frame keeps its preview until its document has painted | a frame going live showed a blank iframe first: a fully white frame for 68-86 ms on every click or camera rest. The picture now stays until the frame runtime reports `doop:shown` |
| 0010 | feat(review): a review role, a changes-requested verdict and verdict history | reviewers give verdicts without edit rights; agents find the frames sent back |
| 0011 | feat(embed): sign host apps' reviewers in to one canvas through a short-lived token | the server side of the embedded review panel |
| 0012 | feat(embed): the review panel host apps embed, at `/embed` | review in the host app without going to doop |
| 0013 | feat(ui): a reviewer's layout, one dock at the bottom | the editor for someone who comments and reviews |
| 0014 | feat(embed): the review panel in the editor's reviewer layout | one layout for both |
| 0015 | perf(canvas): a zoom step restyles the canvas only when its chrome has drifted | the stage's inherited `--zoom` restyled ~1550 elements and repainted every frame name on each zoom step. It now follows a moving camera in 10% steps and is exact at rest; the label layer always has the exact zoom (`data-stage-labels`). The Stage no longer re-renders per zoom step (`useCanvasDrawing` read the zoom at all times) |
| 0016 | perf(canvas): a pan press restyles nothing | with the Hand tool each press and release restyled the whole document (15 + 13 ms): `user-select` set on the root, and a descendant cursor rule swapped on the stage. Now a `selectstart` guard and one cover element (0.8 + 0.3 ms) |
| 0017 | perf(canvas): ask once per document whether it is a canvas element | a regular expression over each frame's whole HTML, several times per frame per render (30 ms of opening a 188-frame page) |
| 0018 | perf(canvas): boot one document per frame while frames come late | two boots were one main-thread task of up to 36 ms; the batch is two only while frames come on time |
| 0019 | perf(canvas): only the frames in view go live | the half-viewport live margin booted 12 documents per rest where 4-6 were on screen. Entry margin 0.1, keep margin 0.5; previews keep the half-viewport margin for their sharp level |
| 0020 | feat(share): share-link guests: a name, an optional password, the link's level | reviewers without an account: the owner picks the link's level and an optional password; visitors give a name (and the password) and get that level on that canvas only, read live, ended by a new password. `doopctl share link <canvas> [level] --password-stdin \| --no-password` |
| 0021 | feat(ui): phones get the reviewer layout, review first | one layout everywhere with FULL_UI off: the bottom dock on phones too, sized for a thumb; ••• opens the canvas actions (import, share, export, Connect AI, your name, settings) |
| 0022 | feat(mcp): agents start comment threads with `add_comment` | the MCP side of POST `/api/frames/:id/comments` and canvas comments: an element (`element_id` or `selector`, stamped like the browser does), a point on a frame, or a point on a page; the agent is the author; comment role, an @mention needs edit and uses a resident task |
| 0023 | feat(api): read a frame's HTML over HTTP with an agent key | `GET /api/frames/:id/html` for a script holding an agent key (`dpk_…` bearer, view role) or a session; `no-store`, `sandbox` CSP, `x-doop-frame-updated-at`. The key opens this route only |
| 0024 | feat(webhooks): limit hooks to canvases, name the element, manage them from the operator API | `canvasIds` per hook (empty = all, checked on create and on every delivery; migration 0051), `elementId` + `snippet` in comment payloads, `/api/operator/users/:user/webhooks` behind `bin/doopctl webhooks list\|create\|enable\|disable\|test\|delete` (secret printed once). The Settings pane does not edit `canvasIds` yet |
| 0025 | fix(mcp): name the configured origin on the public host, not the proxy's scheme | behind a proxy that speaks http to doop and sets `X-Forwarded-Proto: http`, the OAuth protected-resource metadata and the MCP 401 challenge said `http://<host>/mcp`, and strict MCP clients refuse it. On `BETTER_AUTH_URL`'s host they now name that origin; other hosts (dev ports) are echoed as before (PR #1) |
| 0026 | feat(operator): a direct-only switch keeps the operator API off the public edge | `DOOP_OPERATOR_DIRECT_ONLY=true`: `/api/operator` is 404 for any request a proxy forwarded (`X-Forwarded-For` / `Forwarded`), token or not; only direct calls to doop's port reach it. Holds only behind a proxy that adds one of those headers (a bare nginx `proxy_pass` adds neither). Default off (PR #1) |
| 0027 | feat(operator): serve the operator API on a listener of its own | the form of 0026 that does not depend on the proxy (review of PR #1): `DOOP_OPERATOR_LISTEN=[host:]port` (host 127.0.0.1 by default) serves the API there and nowhere on `PORT`, as Caddy keeps its admin API on `localhost:2019`. Default off |

Measured (Chrome traces, 188-frame page, frames out of process, editor main thread,
v0.12.0 → v0.12.0 + 0001-0004): pan at fit 2260 → 245 ms (37 slow frames → 0); zoom 8→60% 1700 →
480-540 ms; pan at 60% 1780 → 715 ms; fit jump 390 → 125 ms; open page 10.4 → 2.2 s renderer
CPU, editor heap 116 → 27 MB. Raw numbers: `perf/final-bench.txt`.

Second render pass (0015-0019, 2026-11-13), from fresh traces of v0.14.0 + 0001-0014 on the same
188-frame page (`perf/trace-live.mjs`, `perf/events.mjs`, `perf/longtasks.mjs`,
`perf/presscheck.mjs`, `perf/bench.mjs` through `perf/ab.sh`). The machine was loaded (load
10-30) and has no GPU, so every number is a median of interleaved pairs and says nothing about
raster or compositing cost on a real display. Editor main thread, before → after: zoom over live
frames (60>95>60%) 741-1015 → 511-516 ms; six presses with the Hand tool 293 → 149 ms (slow
frames 5 → 0); leaving a neighbourhood and coming back 435 → 183 ms, its frames showing their
documents after 602 → 329 ms; live documents at 60% 12 → 4-6. Pan at fit, zoom 8→60% and the fit
jump are unchanged within the noise.

With the wheel events of a pinch sent one per animation frame from inside the page (`bench.mjs`
"pinch 60>95>60%", five interleaved runs at load 20-40), a zoom over live frames went 2080 →
1460 ms of editor main thread, and its style time 950 → 265 ms. The stepped zoom scenario
understates 0015 on a loaded machine: its steps then come more than 120 ms apart, so each one
counts as a camera at rest and the chrome's zoom is rewritten at every step, as before the patch.
Screenshots of both builds at rest (fit, a frame selected, 20%, 45%, 90%, after a pan) are
identical pixel for pixel (`perf/look.mjs`, `perf/diff.mjs`); mid-pan they differ as intended:
the frames a long pan brings in show their pictures, where the old build showed live documents
that had not painted yet. Released as v0.14.0-patched.3.

Tests for 0015-0019: `bin/doop check --test` 2234 pass, 2 fail, 382 skipped (that run has no
browser, so the browser files are skipped); the two failures are server tests that time out
under load (`oidc`, `rate-limit-wiring`; both pass alone, and `rate-limit-wiring` fails the same
way on the pristine pin). With a browser, the full suite on the same code: 2559 pass, the 10
`elementPanelBrowser` failures that pristine v0.14.0 has on this machine, and timeouts under
load; the canvas browser files run on their own (`liveFramesBrowser`, `drawingBrowser`,
`reviewerLayoutBrowser`, `fitSelectionBrowser`, `zoomToolBrowser`, `frameResizeBrowser`,
`textSelectionBrowser`, `pageCanvasBrowser`): 179 of 179.

Tried and not shipped: keeping a frame's document alive after it leaves the view (moved with
`Node.moveBefore` into a clipped holder and back; `perf/parkcheck.mjs`). It works (a kept document
gets no animation frames, keeps its viewport and its script-made state) but did not pay: going
live is paced per frame and costs a FrameView mount either way, so a neighbourhood was back on
screen no sooner, and the kept documents cost memory. It would pay together with a lighter live
frame (a document shown without the full FrameView until the pointer reaches it). Looked at and
left: one message router for all frames in place of three window listeners per live frame (a few
per cent of a pan at most); frame names in one overlay layer (hiding them halves the main-thread
cost of a pan at fit, 216 → 122 ms, but a pan at fit already drops no frames, and upstream put
the names inside the frames so that they stack with them); the ~200 compositor layers, one per
frame (Chrome will not merge sparse layers). Still unmeasured: what a zoom step over live
out-of-process frames costs in raster on a real GPU (each step re-rasters every live frame once
the zoom is past 25%), which is the reason to consider covering live frames with their pictures
while a zoom gesture lasts.

Preview fidelity (0007-0009, 2026-11-12: culled frames looked too rasterized, and a clicked
frame looked very different from its neighbours). Three causes, measured on a copy of a real
canvas with `perf/look.mjs`, `perf/boot.mjs`, `perf/fonts.mts`: one fixed-size JPEG for every
frame and zoom; server renders captured before the web font arrived; a white flash while a
document boots. Stored previews: 0.25 median 4.3 KB, 0.5 8.4 KB, 1 33.7 KB (the 640 px JPEG:
11.7 KB). Pan and zoom cost is unchanged within noise against 0001-0004 alone
(`perf/refine-bench.txt`, interleaved runs on a loaded machine). Not done: a preview whose font
or image request fails outright is still stored as current (retrying it needs a "degraded
render" notion in thumbs.ts).

A CDN in front of `/i/` may cache `.webp`/`.jpg`/`.png` responses at the edge by URL including
the query and send browsers a longer max-age than doop's 60 s (the versioned, `immutable`
preview URLs keep their year). Then an unversioned `/i/<id>.jpg?preview` (the dashboard
thumbnail) can be hours old in a browser, and a 404 can be remembered at the edge for minutes.

Upgrade to v0.14.0, tests (2026-11-12): typecheck, oxlint and prettier clean on every patched
file; full vitest with a browser 2562 pass, 14 fail. The 10 `elementPanelBrowser` failures are
the same on pristine v0.14.0; `drawingBrowser`, `oidc`, `claudeExtension` and `elementIds` (1
each) pass when run alone, on both trees (timeouts under load). Local production build on the
migrated perf data: culling, preview levels and the boot cover behave as before
(`perf/look.mjs`, `perf/boot.mjs`). The main client bundle grew upstream from 1.7 to 2.1 MB, plus
a lazy 10 MB MuPDF wasm for PDF import. Known follow-up: any frame write bumps `updatedAt` (a
move, a restack, a rotation), and previews are keyed on it, so moving a frame re-renders its
pictures though they are unchanged.

Tests for 0022-0024 (2026-11-14): `bin/doop check --browser` 2631 pass, 11 fail: the 10
`elementPanelBrowser` failures pristine v0.14.0 has here, and `agentToolParity`, which asked
whether resident agents get `add_comment` (not yet: they answer the threads they are handed; now
listed as a gap). `bin/doopctl webhooks` smoke-tested against a local server.

Tests for 0025-0027 (2026-11-14): `bin/doop check --browser` 2635 pass, 11 fail: the same 10
`elementPanelBrowser` failures, and a `drawingBrowser` drag; run alone, three of its path-snap
tests then failed as well, and failed the same way on the 0001-0024 tree, so they are this
machine's, not the patches' (which touch the server only). `operator` and `access`: 31 of 31.

Upgrading past v0.14.0 (found 2026-11-14): drizzle's migrator applies a migration only when it is
newer than the last one applied (`created_at` < the journal's `when`), not by name. Upstream's
0049-0052 on `main` are dated 2026-11-07 to 2026-11-10, before our 0049-0051 (2026-11-12 to
2026-11-14), so on a database that has ours they would be skipped silently. At that upgrade: renumber
our migrations after upstream's, make them idempotent (`IF NOT EXISTS`), and date them after
upstream's last one; then check on a copy of the production database that every upstream table
and column exists before deploying.

Upstreaming: not attempted yet. Patches 0001-0004 and 0007-0009 are generic enough to offer to
kgoedecke/doop (0007 is a plain bug fix).
