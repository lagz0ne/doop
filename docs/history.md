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

Measured (Chrome traces, 188-frame page, frames out of process, editor main thread,
v0.12.0 → v0.12.0 + 0001-0004): pan at fit 2260 → 245 ms (37 slow frames → 0); zoom 8→60% 1700 →
480-540 ms; pan at 60% 1780 → 715 ms; fit jump 390 → 125 ms; open page 10.4 → 2.2 s renderer
CPU, editor heap 116 → 27 MB. Raw numbers: `perf/final-bench.txt`.

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

Upstreaming: not attempted yet. Patches 0001-0004 and 0007-0009 are generic enough to offer to
kgoedecke/doop (0007 is a plain bug fix).
