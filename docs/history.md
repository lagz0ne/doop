# History

## Upstream and deploy

| when | what |
|---|---|
| ≤ 2026-11-10 | doop deployed by the hub from `kgoedecke/doop` tag `v0.12.0` (the deployer app `<app>`, Postgres 16 `doop-db`, https://doop.example.com) |
| 2026-11-11 04:04 | The human: doop is slow with many items on a page (the host's "Big canvas" canvas, ~200 live frames per page). The host app first split its canvas into lighter pages (a reorg) |
| 2026-11-11 04:51 | The human's call: patch doop ourselves and stay on open source (doop isn't exposed commercially). Public fork `github.com/the fork/doop` |
| 2026-11-11 05:04 | `v0.12.0-patched.1` = patch 0001 (keep live iframes only near the camera). Deploy request a deploy request |
| 2026-11-11 06:06 | patched.1 put on hold: frames without a live document couldn't be selected or dragged at low zoom |
| 2026-11-11 06:23 | `v0.12.0-patched.2` (`38b882d`) = patches 0001-0004, fixes that bug and is much faster |
| 2026-11-11 07:22 | patched.2 deployed by the hub queue worker (a deploy request) after the human prioritized it. Live since |
| 2026-11-12 | This repo set up: vendor + patches + transforms. Patches 0001-0004 rebuild `38b882d` exactly |
| 2026-11-12 | The human: we care about the canvas, not doop's multi-user product. Decided: don't strip accounts out of the code (identity is wired through REST, WS and MCP, and upstream moved 526 files from v0.12.0 to v0.14.0 in 8 days, so a strip would be a hard fork); hide the team/product chrome instead (`feat(ui)`, flag `FULL_UI`) |
| 2026-11-12 | The human: a safe, fast CLI for users and sharing. Decided: an operator API in the server plus `bin/doopctl` as its client (mmctl's model), with a bearer `DOOP_ADMIN_TOKEN`, not an admin login. Writing the DB directly is unsafe (sharing lives in server memory), this account has no Docker for a container-local mode, and doop's own API can't do it (sign-up closed, sharing owner-only, no admin in production without SMTP) |
| 2026-11-12 05:0x | `v0.12.0-patched.3` (`ed357c2`) = patches 0001-0006, released from a second checkout while another agent held build/doop. Deploy request a deploy request |
| 2026-11-12 05:20 | patched.3 deployed (a deploy request). Hidden UI live. The hub left the operator API off pending the human's OK on exposure, and noted that a 401 alone doesn't prove the API is on (the session gate also answers 401) |
| 2026-11-12 08:45 | The human chose option A, host-only, and unblocked a deploy request. `DOOP_ADMIN_TOKEN` set (token in `~/.config/doop/doop-admin-token`). Traefik route `the proxy's dynamic config` allows `/api/operator` from loopback/docker gateway only, as a case-insensitive regex, because Express matches routes case-insensitively and `/api/Operator` would have bypassed a plain prefix. doopctl connects via 127.0.0.1 (efee048). Checked: 401 "operator token required" locally, 403 publicly for every spelling, `doopctl users` lists 2 accounts. Found: 1 ownerless canvas ("Welcome Canvas", `<canvas>`) that any account can edit; left for the human |
| 2026-11-12 05:13 | `v0.12.0-patched.4` (`6914e39`) = patches 0001-0009 (0007-0009: preview fidelity), released after the human approved release and deploy. Deploy request a deploy request, written to run only after a deploy request and to change nothing but the tag. It sat blocked behind a deploy request until the human unblocked both |
| 2026-11-12 08:48 | patched.4 deployed (a deploy request), env unchanged. Checked on production, read-only (`perf/probes/previews.mjs`): a page of 32 culled frames asks for `/i/<id>.webp?preview&s=0.25`, all 200 `image/webp`, `immutable`, loaded 1.7 s after opening; the pictures are in the frames' own font (Public Sans) and a 12640×400 banner is 3160 px wide at 0.25 and 12640 px at 1. Rollback: tag `v0.12.0-patched.3` |
| 2026-11-12 | The human: make doop very lightweight and embeddable in the other systems instead of a standalone service; the use is a design system worked by AI and reviewed by humans. Researched first (doop internals, the hosts, prior art). Hosts are the host apps, all on the one doop through MCP, each with its own login; only agents write to the canvases; the host app already has an in-app Review tab over `/i/<frame>.png`. Decided by the human: (1) one doop backend, embedded UI: each host shows a doop review panel in an iframe and signs its user in with a short-lived token (the Metabase / Superset guest-token model), nobody logs into doop; not doop-as-a-library (AGPL would reach the host, React 18 vs 19, three copies). (2) Humans review only: look, comment, approve or request changes; no editor in the panel. (3) First upgrade to v0.14.0 and check our patches |
| 2026-11-12 | Pin moved v0.12.0 → v0.14.0 (526 files upstream). Upstream fixed none of what our patches fix, so all 9 stay; v0.14.0 + 0001-0009 = `144b2ea`. 0001, 0004 and 0008 needed hand merges (0004: the shell now carries v0.14's stacking order, rotation and borderless surface), 0005 was redone on v0.14's rewritten rail/home/settings and also hides the account menu's "Get desktop app" and "Doop website" links, 0006 applied as it was. Not released. What a deploy brings: 9 DB migrations (0040-0048, so a database backup first and no rollback to v0.12 builds without it), `fonts-dejavu-core` in the Dockerfile, optional `SECRETS_ENCRYPTION_KEYS` (unset = stored credentials stay plaintext, with a boot warning), design tokens (MCP `get_tokens` / `create_tokens` / `set_tokens`), and signed-out viewing of link-shared canvases (5 on production have a link level set) |
| 2026-11-13 | The human approved "release and deploy with a backup" and "turn the shared links off first". With `bin/doopctl`: link = none on the host's canvas (`<canvas>`), Second canvas canvas, Start here and Claude's first canvas; on a docs canvas (`<canvas>`) the human chose link off plus permanent membership for their account (it replaces host-c's a routine add-and-remove routine for approving). No canvas is link-shared now. `v0.14.0-patched.1` (`144b2ea`) released; deploy request a deploy request asks the hub for a database dump first (9 migrations), then the tag, env untouched. Rollback = restore the dump and tag `v0.12.0-patched.4` |
| 2026-11-13 | patched v0.14.0-patched.1 deployed (a deploy request): dump `backups/doop-db-20261113T015514Z.dump` and the data volume tarball taken first, 9 migrations applied, server up 02:12:59Z. The hub removed an unused `SECRETS_ENCRYPTION_KEYS` from the app (saved to `~/.config/doop/doop-secrets-encryption-keys`), so stored credentials stay plaintext as before |
| 2026-11-13 | Embedded review designed: another agent spiked and built 0010 feat(review) (a `review` role between comment and edit, `changes_requested`, `frame.approval` event and webhook) and 0011 feat(embed) (host-signed 5-minute token → a session for one canvas at one role, route allow-list, reviewer room filter, `DOOP_EMBED_HOSTS`, `TRUSTED_ORIGINS` for the panel hostname, migration 0049). Lead calls: approve without edit (role A); reviewers see frames, pages, comments and verdicts only; the panel gets its own hostname (review.example.com, to ask the hub) because the human still uses doop directly; agents hear verdicts by polling `changes_requested` plus the panel's `doop:verdict` postMessage. v0.14.0 + 0001-0011 = `362baf6`, not released. The proposal is drawn on doop itself: canvas `<canvas>` "Embedded review: how doop sits inside a host app" (page 1 explains, page 2 is a clickable prototype of the Design review tab in the host app, on the real "70 Invite email" frame) |
| 2026-11-13 | The human OK'd trying `review.example.com` (a second hostname for the panel). 0012 feat(embed): the review panel at `/embed` (own small bundle, frame-ancestors limited to the configured hosts, token in the fragment, the editor's frame runtime for live frames and pinned comments, request changes / approve, compare with the version of the last verdict, postMessage to the host page). Checked end to end with a stand-in host app (`perf/embed-host.mjs`, `perf/embed-e2e.mjs`). Not released |

The work was done in a Paseo agent session in `../host-app` (Claude transcript
`<session>`, queue name `agent`) and deployed by the hub
worker session `<session>`.

## Patches

| # | what | why |
|---|---|---|
| 0001 | perf(canvas): keep live iframes only for frames near the camera | every frame was a live document, laid out and held at once (203 frames: ~590 ms click to paint). Far or zoomed-out frames show their preview image; `localStorage['doop:cull']='off'` restores the old behaviour |
| 0002 | perf(ui): drop the `body:has()` rule that restyled the document on every insertion | `body:has([data-panel-resizing]) *` invalidated the whole document's style on every insertion: 40-70 ms per click on a 188-frame page |
| 0003 | perf(previews): versioned previews are immutable and their versions outlive a restart | culled frames show hundreds of previews: current-version previews are now `immutable` (was max-age=60), and the rendered version is stored beside each thumbnail so a restart doesn't re-render them all |
| 0004 | perf(canvas): culled frames are shells, a pan is one transform, documents boot in turn | FrameShell instead of a full FrameView for frames without a live document; camera offset only on the label layer; staged document boot; fixes patched.1's selection bug |
| 0005 | feat(ui): put away the team and product chrome on a one-person instance | used for the canvas: Share, Owned/Shared filters, Community, Automations, Integrations, avatar stacks, plan line, Help menu, the Webhooks pane, and on Home the Agents rail section and the "Ask me what to design" hero, hidden behind `FULL_UI` (`src/lib/fullUi.ts`). Workspaces kept (amended 2026-11-12 at the human's request; first version hid them). Entry points only; routes and server unchanged. `localStorage['doop:full-ui']='on'` restores |
| 0006 | feat(operator): a token-gated API for users, sharing, canvas owners and agent keys | backs `bin/doopctl`. `/api/operator` answers only a bearer `DOOP_ADMIN_TOKEN` (32+ chars) and is absent while it is unset. Works with sign-up closed; audit lines `[operator] …`; `tests/operator.test.ts` |
| 0007 | fix(screenshot): wait for a frame's web fonts before capturing it | a render waited for `load` + 120 ms, which does not cover `font-display: swap` fonts: 5-13 of 24 real frames were captured in the fallback face (other widths and line breaks than the live frame), and the picture was then cached as immutable. Now waits for `document.fonts.ready` (≤ 3 s): 0 of 24. Upstream bug, worth offering |
| 0008 | perf(previews): the canvas shows each frame's preview at the scale it is on screen | the preview was the dashboard thumbnail, one 640 px JPEG q70 whatever the frame or zoom (a 12640×400 banner: 640×20 px). Now a pyramid of WebP q90 pictures at 0.25 / 0.5 / 1 (`/i/<id>.webp?preview&s=`), the level picked from zoom × devicePixelRatio when the camera rests, sharp levels only near the view |
| 0009 | fix(canvas): a frame keeps its preview until its document has painted | a frame going live showed a blank iframe first: a fully white frame for 68-86 ms on every click or camera rest. The picture now stays until the frame runtime reports `doop:shown` |

Measured (Chrome traces, 188-frame page, frames out of process, editor main thread,
v0.12.0 → patched.2): pan at fit 2260 → 245 ms (37 slow frames → 0); zoom 8→60% 1700 →
480-540 ms; pan at 60% 1780 → 715 ms; fit jump 390 → 125 ms; open page 10.4 → 2.2 s renderer
CPU, editor heap 116 → 27 MB. Raw numbers: `perf/final-bench.txt`.

Preview fidelity (0007-0009, 2026-11-12; the human: culled frames look too rasterized, and a
clicked frame looks way different from its neighbours). Three causes, measured on the host's
canvas copy with `perf/look.mjs`, `perf/boot.mjs`, `perf/fonts.mts`: one fixed-size JPEG for
every frame and zoom; server renders captured before the web font arrived; a white flash
while a document boots. Stored previews: 0.25 median 4.3 KB, 0.5 8.4 KB, 1 33.7 KB (the
640 px JPEG: 11.7 KB). Pan and zoom cost is unchanged within noise against patched.2
(`perf/refine-bench.txt`, interleaved runs on a loaded machine). Not done: a preview whose
font or image request fails outright is still stored as current (retrying it needs a
"degraded render" notion in thumbs.ts).

Cloudflare sits in front of `/i/`: it caches `.webp`/`.jpg`/`.png` responses at the edge by
URL including the query, and sends browsers `max-age=14400` where doop said 60 (the versioned,
`immutable` preview URLs keep their year). So an unversioned `/i/<id>.jpg?preview` (the
dashboard thumbnail) can be up to 4 h old in a browser, and a 404 is remembered at the edge
for about 3 minutes (seen right after the patched.4 switch, on a URL probed during it). Not a
doop change; hub-owned if it ever needs tuning.

Upgrade to v0.14.0, tests (2026-11-12): typecheck, oxlint and prettier clean on every patched
file; full vitest with a browser 2562 pass, 14 fail. The 10 `elementPanelBrowser` failures are
the same on pristine v0.14.0 on this machine; `drawingBrowser`, `oidc`, `claudeExtension` and
`elementIds` (1 each) pass when run alone, on both trees (timeouts under load). Local production
build on the migrated perf data: culling, preview levels and the boot cover behave as on patched.4
(`perf/look.mjs`, `perf/boot.mjs`). The main client bundle grew upstream from 1.7 to 2.1 MB,
plus a lazy 10 MB MuPDF wasm for PDF import. Known follow-up: any frame write bumps `updatedAt`
(a move, a restack, a rotation), and previews are keyed on it, so moving a frame re-renders its
pictures though they are unchanged.

Upstreaming: not attempted yet. Patches 0001-0004 and 0007-0009 are generic enough to offer to
kgoedecke/doop (0007 is a plain bug fix).
