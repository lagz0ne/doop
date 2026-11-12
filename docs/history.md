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
| 0005 | feat(ui): put away the team and product chrome on a one-person instance | one person plus agents: workspaces, Share, Owned/Shared filters, Community, Automations, Integrations, avatar stacks, plan line, Help menu and the Webhooks pane hidden behind `FULL_UI` (`src/lib/fullUi.ts`). Entry points only; routes and server unchanged. `localStorage['doop:full-ui']='on'` restores |
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

Upstreaming: not attempted yet. Patches 0001-0004 and 0007-0009 are generic enough to offer to
kgoedecke/doop (0007 is a plain bug fix).
