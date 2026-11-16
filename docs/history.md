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
| 2026-11-14 | On phones a finger on a frame in the Comment tool commented instead of panning, a pinch or double tap could zoom the page, and a frame's menu opened mid-pan or while a finger rested (Radix's 700 ms touch press is cancelled only by a move over the trigger, and the stage captures the pointer for a pan). Decided: a phone only reviews, 0028 feat(ui). A touch pans in Hand and Comment, a tap comments; the page is held still as tldraw and Excalidraw do it (`user-scalable=no`, WebKit gesture events cancelled, `touch-action: manipulation`); the menu waits for a 1600 ms hold (the platforms' long press is about 500 ms) that a drift of 10 px, a lift or a second finger ends; the role counts as review at most on the client (the server's role is untouched), so every edit control steps aside |
| 2026-11-15 | Upstream: still no release after v0.14.0, `main` unchanged since 2026-11-11. Its open PR #505 (four security fixes, not merged) carried in part, until upstream releases it: 0029 (a frame's own script could post the editing runtime's save message and store its HTML under the viewer's name; saves are refused for frames with scripts, inline handlers or `javascript:` URLs) and 0030 (`AGENT_GUIDELINE_WRITES=false` stops agents writing the style guides every later agent run reads as rules), both unchanged and under their author's name, plus 0031 (inline text editing is not offered where 0029 would drop its save). Not carried: the frame CSP (it blocks remote scripts, so a design loading one from a CDN would stop rendering) and the non-root container (a Dockerfile change, and the data volume would need new ownership). A local copy of a production canvas (271 frames) has no frame 0029 refuses |
| 2026-11-15 | Agents work over MCP as their own account, so the canvases they create are theirs, and the person they work for was only a member, without Share. Two answers, both taken: hand those canvases to the person (`doopctl share owner`, the agent stays a member with edit), and 0032, which lets a canvas's own people (owner, members, workspace members) set its link, as Google Docs and Figma let editors share by default. Someone in by the link alone still cannot change it, so a link cannot widen itself. No migration |
| 2026-11-15 | The GPU picture layer tried and shelved, then measured properly (GPU compositing on a software GL, counts over timings): a camera frame's cost follows the number of compositor layers, and every frame shell is one. Four levers came out of it and were built in parallel side trees, then merged: 0033 (shells far from the view leave the render tree) and 0034 (the grids scale while the zoom moves) are on; 0035 (pictures in place of live documents while the zoom moves, `doop:zoom-pictures`) and 0036 (the picture layer reworked so a drawn frame has nothing in the DOM, `doop:gpu`) are switches, off by default: one changes what is on screen mid-gesture, the other could only be measured on a software GL here |
| 2026-11-15 | Asked whether anything observed how the canvas renders for real people: nothing did (the product analytics are off on a self-hosted build, and no trace of a gesture left the browser). So the two switches became a trial every browser runs on itself (0039): it tries each level over page loads, counts slow frames in real pans and zooms, and keeps what is smoother there; the GPU layer only ever on hardware WebGL2. Each browser reports its counts to the server, which forwards them to an OpenTelemetry collector when one is configured (0038). Before the GPU layer could be handed to real browsers its untested paths were audited and two defects fixed (0037) |
| 2026-11-16 | Asked for a way to change the renderer without the console, and to see which one is drawing. The switches became a pick per browser (0040): Settings → Appearance → Canvas renderer (GPU layer and zoom pictures, each Auto, the trial's default, or a fixed level) and an optional label in the zoom pill naming what draws this load and why, whose menu is the same pick. The levels stay fixed per page load, as the trial needs, so a later pick offers a reload (Chrome's graphics-acceleration switch works the same way, applying on relaunch) |
| 2026-11-16 | Reported: zooming in or out, frames go white for a moment instead of keeping what they showed through the transition. Measured with a screencast of the zoom (`perf/zoomflash.mjs`): when a zoom settles, frames change how they are drawn (GPU canvas or shell to a live view and back) and previews change level, and each change started from an empty `<img>`. Fixed by handing over the way map tiles do, the old picture kept until the new one has drawn (0041) |
| 2026-11-16 | A review of the reviewer layout's controls, state by state (each control on a canvas, the owner commenting on it), asked for less: only the Hand and Comment in the dock, nothing of the agents (AI activity, Agents, Connect AI), no design tokens ("maybe for agents only"), the pages to the full height instead of sharing it with Layers ("layers we don't really use"), and one bar on a phone. Done in 0042; it supersedes 0013's Pages/Layers fold and More tools menu. Agents keep everything over MCP; the docked layout or `doop:full-ui` brings the full editor back. The same review found the renderer label striking DOM, not GPU, when the GPU layer failed (0043) |
| 2026-11-16 | Reported: the getting-started card flashes on opening a canvas and goes away; asked to remove it. The role reads as edit until the canvas loads, so the checklist mounted at once and unmounted when the real role (or a phone's review cap) arrived. It is about connecting an agent, so the reviewer UI drops it with the rest of the agents; with FULL_UI on it waits for the canvas (0044) |
| 2026-11-16 | Asked for a smaller dock: the pages in it as a pick-one instead of a panel, no renderer label, and import, export, comment threads and the people grouped behind one control, so the dock holds navigation and review and the rest is a second layer. Done in 0045: seven controls where there were fifteen, and no left panel. Page management (add, rename, order) stays in the full editor; a phone keeps its Comments button, the comments being its main way to review |
| 2026-11-16 | Asked for the canvas's name and the back to go to the top left, subtle, since people read it once and move on, and for the room to go to the page's name with some limit. Done in 0047; the id menu went along with the name. Phones keep their dock (the name is in their actions sheet) |

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
| 0028 | feat(ui): a phone reviews: one finger pans, a long hold for menus, no editing | reviewer layout on a phone: `reviewOnly` caps `roleOf` at review (`grantedRole` keeps the server's), dock is back, Hand, Comment, Comments, Layers, •••; a touch pans in Hand and Comment and a tap comments; viewport `maximum-scale=1, user-scalable=no` while mounted; `useTouchHold` replaces Radix's 700 ms touch press with a 1600 ms hold tracked on window. Mouse unchanged |
| 0029 | fix(frames): refuse doop:edited saves for frames with executable content | from kgoedecke/doop#505, unchanged: the save message from a frame is ignored when the stored or incoming HTML has a script, an inline handler or a `javascript:` URL. Such frames still render; the Design panel's style and image edits on them apply live but are not saved |
| 0030 | feat(agents): a switch to keep agents from writing style guides (AGENT_GUIDELINE_WRITES) | from kgoedecke/doop#505: `AGENT_GUIDELINE_WRITES=false` makes `set_guidelines` (MCP and resident) refuse and point to a comment; people still write guides. Default true |
| 0031 | fix(frames): offer inline text editing only where its save is accepted | `canEdit` uses 0029's test, so text editing is not offered on a frame with inline handlers; a test for 0030's switch |
| 0032 | feat(share): a canvas's editors set its link, not only its owner | `canSetLink` (owner, members, workspace members) gates the link's level and password; `canSetLink: true` on the person's canvas copies drives Share; link-only visitors and guests refused |
| 0033 | perf(canvas): frame shells far from the view leave the render tree | every shell is a compositor layer and each camera frame rebuilds the layer list, at every zoom. Shells more than 0.5 viewports out (kept to 0.75 once in, 1.5 while the camera moves, exact 120 ms after it rests) get `hidden`, written only for the shells that cross a margin (`src/lib/shellCull.ts`). Layers at 60%: 136 → 40. `localStorage['doop:cull-shells']='off'` turns it off |
| 0034 | perf(canvas): scale the stage grids while the zoom moves, paint them at rest | the dot grid's `background-size` followed the zoom, so its layer (the size of the view) was rastered whole on every zoom frame. Now painted at one zoom and scaled by transform up to 10% above it, exact 120 ms after the zoom rests; the pixel grid the same (`src/lib/stageGrid.ts`). A 30-frame pinch: 140 tiles in 30 frames → 24 in 5 |
| 0035 | perf(canvas): show frame pictures in place of live documents while the zoom moves | a live document is rastered again at every zoom step. With `localStorage['doop:zoom-pictures']='on'` its picture stands in while the zoom moves and the document comes back once it has painted at the new zoom (`doop:painted`); a frame being worked in (selected, edited, moved, streaming, Prototype mode) keeps its document. Raster tasks in the frames' process over a pinch: 338 → 28. Off by default: the picture is the server's render, without the document's scroll or script state |
| 0036 | perf(canvas): culled frames drawn whole on one WebGL2 canvas, no DOM for them (experiment, doop:gpu) | the shelved picture layer, reworked on what the measurement showed: a drawn frame has no element at all, its picture, name and hover ring are on the canvas and a press is resolved by arithmetic (`src/lib/gpuPictures.ts`, `gpuLabels.ts`, `StagePictures.tsx`). Frames with a badge or icon, or with DOM under them, stay shells. Layers at fit: 204 → 9. `localStorage['doop:gpu']='on'` (hardware WebGL2) or `'force'`; off by default until measured on a real GPU |
| 0037 | fix(canvas): the GPU layer at any screen density, and shells where the GPU falls short | what 0036 left untested. Names were measured at the CSS size, but Chromium shapes text at the device size, so above 1x a name was cut at another letter than its title (up to 6 px off): now measured at the device size (`gpuLabels.ts`). A WebGL canvas asked for more than the GPU gives comes back smaller and not in proportion, and every picture was drawn in the wrong place: such a canvas is given up and every frame stays a shell (`PictureRenderer.fitsStage`). A change of screen density is noticed on the next camera move. Browser tests for marquee, peers' changes, an agent's stream, a phone's pan, tap and hold |
| 0038 | feat(telemetry): render trial reports, forwarded to an OpenTelemetry collector | `POST /api/telemetry/render` takes a browser's report (a closed schema of enums and numbers, `shared/renderTrialSchema.ts`: no canvas, frame or account in it), from a signed-in session only, same site only, 30 per ten minutes per account. With `OTEL_EXPORTER_OTLP_ENDPOINT` set each row goes out as an OTLP/HTTP JSON log record (body `render trial`, attributes `doop.render.*`); unset, reports are dropped. Plain `fetch`, no SDK dependency (`server/telemetry.ts`) |
| 0039 | perf(canvas): a render trial decides the GPU layer and zoom pictures per browser | with `doop:gpu` or `doop:zoom-pictures` unset, each page load is given a level of each (2×2), the Stage's gestures are timed frame by frame, and the browser leans to the level with fewer slow frames (`src/lib/renderTrial.ts`, `renderTrialClient.ts`). `localStorage['doop:render-trial']='off'` turns it off (the switches as they were, nothing measured or sent); an explicit switch still wins and is still measured |
| 0040 | feat(canvas): pick the renderer in Settings, and a label that names it | Settings → Appearance → Canvas renderer writes `doop:gpu` / `doop:zoom-pictures` (Auto removes them) and switches the renderer label, a view option (`doop:view-options`, off by default, also in the zoom menu). The label reads GPU, DOM or Live, `· pictures`, and auto / set / reload; its tooltip gives each level's reason, its menu the same pick plus Reload. A GPU layer asked for that did not start shows struck through (`useGpuPictures.failed`). `decidedRenderTrial()` lets Settings read the load without starting one |
| 0041 | fix(canvas): a frame keeps its picture through a zoom's settle | what drew a frame stays until its replacement has painted: the GPU canvas keeps drawing a frame under its new FrameView (`gpuScene`'s `under`) and FrameSlot keeps the shell beneath one, the view transparent until its picture is decoded or its document shown (1.5 s at most, then the store's `painted`); a preview whose URL changes keeps the last picture beneath the new one until it decodes; a new preview starts with the frame's last shown picture beneath, and an already loaded URL is eager and sync-decoded. Zoom screencasts, two runs per renderer on a software GL: GPU + zoom pictures from 62% white at the settle in 3 of 4 runs to no flag in 8 zooms, DOM from ~80% zooming in to none; 1 flag left in 32 zooms (DOM + pictures, mid-gesture on a stalled run) |
| 0042 | feat(ui): the reviewer layout keeps to reviewing | with FULL_UI off and floating panels: the dock's tools are the Hand and Comment (no More tools; a key-picked tool or Prototype mode shows as a pressed way back while on); no AI activity or Connect AI; the side panel is the comments alone (no Tasks / Activity / Memory tabs, memory pill, decision toast, working-now line or ⌘K composer); the left panel is the pages at full height (`LayersPanel pagesOnly`, no layer tree, no Tokens tab or rail buttons; 0013's fold removed); a phone has one bar (back, Hand, Comment, the zoom %, Comments, Pages, •••) with Present in the canvas actions and no floating zoom pill |
| 0043 | fix(canvas): the renderer label names a failed GPU layer GPU, struck through | `rendererName()`: the name was picked from `gpu`, false once the layer failed, so the strike fell on DOM |
| 0044 | fix(ui): no getting-started checklist in the reviewer UI, or before the canvas loads | `Onboarding` mounts only with FULL_UI and a loaded canvas: `grantedRole` falls back to edit before load, so it showed for a moment and vanished for a reviewer |
| 0045 | feat(ui): the reviewer dock keeps to moving around and reviewing | the dock: back, name, Hand, Comment, the zoom, a page picker (`PagePicker`, a radio menu), and the faces of who is here opening one menu (`DockMenu`: comments panel with an open-threads dot, import, export, share, design panel, settings, your name); no Pages panel or rail island (`chromeLayout` `bareLeft`), 0042's pages-only faces of LayersPanel/PagesPanel removed; no renderer label or its view option in the dock's zoom control; a phone's Pages sheet becomes the picker |
| 0046 | fix(ui): the dock menu's faces are pictures, following is a row | 0045's menu trigger held the presence stack, whose faces are buttons (follow a person, fly to an agent's frame): opening the menu also followed whoever was there. The trigger draws plain faces (yours, up to three, then +N); each person or agent is a row of the menu (follow / stop following; go where the agent works, disabled while unknown) |
| 0047 | feat(ui): the canvas's name sits quietly at the top left, the dock gives its room to the page | back, the canvas's name (still its rename field) and id menu leave the dock for `CanvasLabel` at the top left, a pill faint until hovered or focused, the name truncated at 240px; the page picker's name may run to 320px (was 200); fits keep 52px clear at the top (`LABEL_CLEAR`); phones unchanged |

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

Tried and not shipped (2026-11-15): culled frames' pictures drawn on one WebGL2 canvas under the
frame stack, behind `localStorage['doop:gpu']` (`on` for hardware WebGL2 only, `force` for any),
with the shells left in the DOM, transparent, for the pointer and the names. WebGPU was ruled out
first (not enabled by default in Chrome on Linux yet), and PixiJS too (a new dependency for one
textured-quad shader). It works: the same pictures, a little sharper (mipmaps), 1549 → 1174
elements on the 188-frame page, a lost context handing the pictures back to the shells. As built
it does not pay, and the first measurement gave the wrong reason. Under Chrome's software
compositor (the default without a GPU) it looked several times slower (pan at fit 169 → 1042 ms
of main thread), but that is the WebGL canvas being read back every frame, an artifact. With GPU
compositing on (SwiftShader behind ANGLE, the flags in `perf/README.md`) the true reason shows:
a shell that still paints its name is still a compositor layer, so the canvas was added to the
~190 layers, not put in their place (`perf/layervariants.mjs`: 201 drawing layers off, 194
forced; with the names hidden too only 6 draw, but 198 layers remain). A real wheel pan at fit
(`perf/camera.mjs`, 30 events, main / compositor thread ms): 290-367 / 191-258 as shipped,
443-540 / 331-369 with the canvas as built, 247-322 / 235-284 with the names hidden as well:
empty layers still cost. That version stayed outside the series (`perf/gpucheck.mjs`
is its probe); 0036 is its rework, below.

Where a camera frame's time goes (2026-11-15, the investigation after that). Measured with GPU
compositing and by counts and thread time that do not depend on the GPU, since this machine has
none: CPU time of the GPU process under SwiftShader is pixel fill on eight worker threads and
says nothing about a real GPU.

- Every culled frame is one compositor layer of its own (1440×900, no compositing reason:
  Chrome's layerizer will not merge sparse content). Nothing in the DOM merges them: not the
  names hidden, the clips off, the stacking contexts off, nor the pictures as bare `<img>`s or
  background divs with no wrapper at all (`perf/layervariants.mjs`).
- Every camera frame rebuilds that layer list. A transform written to a `will-change: transform`
  element (the world, or the dot grid alone) makes Blink run a full
  `PaintArtifactCompositor::Update` ("Layerize" in a trace), whose cost follows the number of
  layers: about 5 ms a frame on the 188-frame page, 0.2 ms with the shells not painted. It is the
  largest single item on the editor's main thread in every gesture: 196 of 375 ms in a pan at
  fit, 155 of 671 in a pinch 60→95%, 260 of 936 in a pan at 60%. The compositor thread pays per
  layer too.
- It is paid at every zoom, not only at fit. At 60% six frames are in view and 96 shells still
  have layers (Chrome paints 4000 px around the view under a composited transform), and the
  rebuild runs over all of them.
- What it is worth (a real wheel pan, 30 events, main / compositor thread ms, two interleaved
  rounds). At 60%: 521-587 / 324-349 as shipped, 187-221 / 114-122 with the shells more than a
  screen away taken out of the render tree (`display: none`, what tldraw does with shapes outside
  the view). At fit, where every frame is in view: 290-367 / 191-258 as shipped, 92-108 / 46-48
  with no shell painted, which is the ceiling for one canvas drawing every picture, provided the
  shells it replaces paint nothing (names on the canvas or in one overlay, the pointer resolved
  by arithmetic).
- Refuted: getting Blink's direct transform update with an idle additive `transform` animation
  on the world and the grid. It does skip the rebuild (30 → 0 full updates), but commits and the
  compositor thread then cost more than was saved (pan at fit: main 290 → 230 ms, compositor
  205 → 350). Refuted too: pinning the raster scale of live frames with `will-change: transform`
  inside the frame documents, or with a perspective ancestor.
- Live frames re-raster on every zoom step (`perf/trace-pinch.mjs`, `perf/raster.mjs`): in a
  pinch of 30 frames each of the 4 live documents' layers was rastered in 27-28 of them, about 3
  tiles each time (348 raster tasks in the frames' process, 678 of 1111 ms of the GPU process's
  main thread spent flushing them). Only hiding the live frames stops it (`visibility: hidden`
  does, measured), so the lever is their pictures in their place while a zoom gesture lasts, as
  map tiles are scaled and then redrawn; the picture is the server's render and can differ from
  the live document.
- The dot grid is re-rastered whole on every zoom frame (a layer the size of the view, about 4.7
  tiles a frame), since its `background-size` follows the zoom, and so is one tile of the floating
  chrome's layer (the zoom pill's text). Scaling the grid's layer by transform during the
  gesture and repainting it at rest would stop the first.
- Not measurable here: how much of the raster work above a real GPU hides. A probe in a real
  browser (frame intervals with the grid, the live frames and the shells toggled) would say.

Built from that (0033-0036, 2026-11-15), each in a side tree of its own and measured again after
the merge, on the same 188-frame page under the same software GL. Counts first; timings are a
real wheel pan of 30 events, main / compositor thread ms, on a loaded machine.

- 0033, shells out of the render tree (on). Compositor layers at 60%: 136 → 40; at 28%: 116
  remain; at fit 204 → 198 (every frame is in view there, so fit is unchanged). Wheel pan at 60%:
  499-561 / 293-317 → 247-284 / 136-162; at 28%: 688-960 / 305-453 → 204-296 / 146-223. That is
  about 2× at 60%, short of the 2.7× the bare `display: none` variant measured: 21 shells stay
  painted inside the margins, which are what keeps a pan from showing holes. `hidden` was chosen
  over `visibility: hidden` (twice the style cost per toggle and an override of the framework's
  `[hidden]` rule), `content-visibility: hidden` (115 layers stay) and not rendering the shell
  (React work on every crossing). Known cost: a lazy preview image under `display: none` starts
  loading only when its shell comes within half a viewport.
- 0034, the grids (on). Dot grid raster in a 30-frame pinch 60→95%: 140 tiles in 30 frames → 24
  in 5; back down: 139 → 79 in 6 (zooming out the grid is painted one band below the camera, so
  it is only ever magnified, up to 10%); a deep pinch: 450 → 75; the pixel grid 120 → 20.
- 0035, pictures during a zoom (switch). Raster tasks in the frames' process over the pinch:
  309-338 → 25-30; a live document's layer: 70-87 tiles in 25-27 frames → 7 in 2. Editor main
  thread 415-450 → 347-360 ms; the editor rasters a little more (the pictures). Not captured
  frame by frame: the moment the document comes back. A picture can stay up to 1 s after the
  zoom rests if its document does not report a paint.
- 0036, the picture layer (switch). Layers at fit: 204 → 9; Layerize in a pan at fit:
  151-254 ms → 11-21; wheel pan at fit: 304-474 / 215-355 → 238-290 / 118-154 on the merged
  build (the author's runs: 270-337 / 196-246 → 128-216 / 97-120). Still above the 92-108 / 46-48
  ceiling: the canvas is drawn synchronously on every camera change, and under a software GL
  that draw is the main thread's. Frame names are drawn from an atlas, 0.84/255 mean pixel
  difference from the DOM's in light, 2.5/255 in dark; kerning is lost across the ellipsis cut.
  Not verified: a real GPU, a device pixel ratio above 1, a touch long hold and a double click
  on a drawn frame.
- All switches together: 9 layers at fit, 31 at 60%.

The render trial (0037-0039, 2026-11-15). The question was whether the two switches could be
decided by observation, per environment, and not by a guess made on a machine without a GPU.
Nothing observed rendering before: the product analytics are off in a self-hosted build and
would not carry frame timings anyway. What was built, and why this way:

- The unit is the browser, not the fleet. What decides whether the GPU layer or the pictures pay
  is the machine (its GPU, its display, its canvases), so each browser tries the levels on its
  own page loads and keeps its own verdict in `localStorage`; the server only hears about it.
  The arms are the 2×2 of the two switches: neither, the GPU layer, zoom pictures, both.
- The measure is the interval between animation frames while the camera moves, the only frame
  timing a page can read. A frame is slow when its interval is over 1.5× the display's own
  (estimated from the shortest intervals seen). Counts of slow frames are compared, not means.
- A factor is judged only on gestures it can change: the GPU layer on every gesture that starts
  with a culled frame in view, zoom pictures on zooms with a live document in view. The first
  version judged the GPU layer on heavy scenes only; on a software GL it also made a pinch at
  60% worse (14 → 157 slow frames of 360), which that rule would not have seen.
- Exploration: a level is drawn at random until one is two loads ahead, then the other is due
  (the big stick design of Soares and Wu, a standard restricted randomization). The first
  version alternated strictly, which paired the two factors' levels load after load, so one
  factor's effect would have been read as the other's. A level needs 600 judged frames and 3
  judged loads before a verdict.
- The verdict is conservative: a level is kept on only when it has at least 20% fewer slow
  frames and at least two percentage points fewer; otherwise off. A browser with no slow frames
  at either level settles on off and stops exploring. While a verdict is open to revision the
  other level is still tried on one load in ten (epsilon-greedy).
- The GPU layer is only ever tried on hardware WebGL2 (`failIfMajorPerformanceCaveat`, as Mapbox
  GL gates its renderer, plus the unmasked renderer's name), and a lost context or a renderer
  that cannot be made takes that load's frames back to shells; after two such loads the browser
  stops trying it.
- An explicit switch (`doop:gpu`, `doop:zoom-pictures`) wins, is measured and reported, and
  teaches the trial nothing. `doop:render-trial='force'` lets a software GL into the trial, for
  testing it here.

Measured here (188-frame page, 1600×1000, SwiftShader, two interleaved rounds, slow frames of
frames recorded by the trial's own recorder). Pan at fit: neither 0/240, zoom pictures 0/240,
GPU layer 61/240, both 56/240. Pinch at 60%: neither 14/360, zoom pictures 0/360, GPU layer
157/360, both 22/360. So on this machine the trial settles on zoom pictures on and the GPU layer
off, and the hardware gate keeps the GPU layer away from any software GL to begin with. What the
recorder itself costs in a wheel pan: full compositor updates 30-32 against 30-31, main thread
257-414 against 278-409 ms; it asks for an animation frame between sparse wheel events, so
empty frames are counted in a trace (Layerize 86-111 → 129-135 in the author's runs) while
update count and time stay as they were.

Not verified: any real GPU, any phone, Safari. That is what the trial is for, and the reports
are how to read it; a query over the forwarded records, by arm, summing `doop.render.frames` and
`doop.render.slow_frames`, gives each arm's share of slow frames, and
`doop.render.verdict.gpu` / `doop.render.verdict.zoom_pictures` say what each browser settled on.
Known gap of the GPU layer: a drawn frame has no element, so its name is not exposed to
assistive technology while it is drawn.

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

Tests for 0028 (2026-11-14): `bin/doop check --test` 2264 pass, 0 fail; the new
`phoneReviewBrowser` (390x844 touch) and the reviewer layout, clipboard, context menu and comment
browser files: 78 of 78.

Tests for 0029-0031 (2026-11-15): `bin/doop check --test` 2265 pass, 0 fail (with
`agentGuidelineWrites`, the switch refusing an agent's guide over MCP). `--browser`: 2641 pass, 11
fail: the 10 `elementPanelBrowser` failures pristine v0.14.0 has here, and `interactionsPanelBrowser`,
which passed twice run alone. At the next upgrade, drop
0029 and 0030 if upstream merged #505 (0031 then depends on how upstream left `canEdit`).

Tests for 0033-0036 (2026-11-15): `bin/doop check --browser` 2731 pass, 12 fail: the 10
`elementPanelBrowser` failures pristine v0.14.0 has here, and `oidc` and `elementIds` (1 each,
timeouts under load; 19 of 19 run alone). The patches add 8 test files (`shellCull`, `stageGrid`,
`zoomPictures`, `gpuPictures`, each with a browser file).

Tests for 0037-0039 (2026-11-15): `bin/doop check --browser` 2786 pass, 10 fail: the 10
`elementPanelBrowser` failures pristine v0.14.0 has here. New files: `renderTrial` (the rules:
eligibility, exploration, verdicts, the recorder), `renderTrialBrowser` (a load assigned, its
gestures recorded, the report sent on hide and saying nothing of the canvas; an explicit switch;
the trial off), `telemetry` (the route and the OTLP encoding); `gpuPicturesBrowser` grew by the
audited paths. The other browser tests run with the trial off (`tests/browser.ts`). End to end
on a local production build with a stand-in collector: an unset browser on a software GL got the
GPU layer `ineligible` and explored zoom pictures, and each report arrived as `POST /v1/logs`
with one record per row under the configured resource attributes.

Tests for 0040 (2026-11-16): new `rendererSetting.test.ts` (the keys, Auto, a pick matched
against a load, the label's state), the label in `zoomMenu.test.tsx`, `viewOptions.test.ts`
updated for the new option. `bin/doop check --test`: 2384 pass, none fail. Browser files run alone:
`renderTrialBrowser`, `gpuPicturesBrowser`, `zoomPicturesBrowser`, `phoneReviewBrowser`,
`fitSelectionBrowser` all pass. Checked on a local production build: the label in the reviewer
dock (software GL: DOM, the GPU layer not available), a pick turning it to "reload", the reload
showing "set", and the Settings card.

Tests for 0041 (2026-11-16): `gpuScene` cases in `gpuPictures.test.ts` (a frame gone live drawn
under its view until it paints, nothing under one a lower live frame overlaps or whose picture is
not ready) and `pictureReady` with the picture kept beneath in `zoomPictures.test.ts`. The full
suite under load 30-40 from other work: 2707 pass, 64 fail, every failed file passing when run
alone except the 10 `elementPanelBrowser` failures pristine v0.14.0 has here. The flash itself
is measured with `perf/zoomflash.mjs` (numbers in the 0041 row).

Tests for 0042-0043 (2026-11-16): `reviewerLayoutBrowser` (the dock's two tools and nothing of
the agents, a key-picked tool and the click back to the Hand, Prototype mode shown only while on,
the pages alone in the left panel, one comments tab) and `phoneReviewBrowser` (one bar: the zoom
level in the dock, no -/+ and no Present on screen); `rendererName` cases in
`rendererSetting.test.ts`. The full suite with the browser files under load 25-40: 2794 pass, 20
fail: the 10 `elementPanelBrowser` failures pristine v0.14.0 has here, and `oidc`, `elementIds`,
`elementIdBackfill`, `drawingBrowser`, `fitSelectionBrowser`, `interactionsPanelBrowser` and
`elementContextMenuBrowser`, each passing when run alone (`drawingBrowser` failing different
tests on each run under load).

Tests for 0044 (2026-11-16): `reviewerLayoutBrowser` checks there is no Getting started card
(it fails without the patch); that file and `phoneReviewBrowser` pass, and so does the typecheck.

Tests for 0045 (2026-11-16): `reviewerLayoutBrowser` (what the dock leaves out, the renderer label
kept out with its option on, no left panel, picking a page from the dock, the menu's items and the
comments opened and closed from it) and `phoneReviewBrowser` (the picker in the phone's dock). The
17 test files touching the pages, layers, zoom pill and renderer: 249 of 250 pass under load 40;
the one failure (`reviewerLayoutBrowser`'s full-UI case, a page load timing out) passes alone,
twice.

Tests for 0046 (2026-11-16): `reviewerLayoutBrowser` puts a peer in the room, finds no button
inside the menu's trigger (0045's held the stack's buttons), opens the menu with nobody followed and
follows the peer from their row; that file and `phoneReviewBrowser` pass, and so does the typecheck.

Tests for 0047 (2026-11-16): `reviewerLayoutBrowser` finds the label in the top-left corner,
under 340px wide with the id menu, and no back or id in the dock; `phoneReviewBrowser` finds no
label on a phone. Both files pass together (17 tests, load average 37); the phone file once failed
in its setup under that load and passed alone.

Upgrading past v0.14.0 (found 2026-11-14): drizzle's migrator applies a migration only when it is
newer than the last one applied (`created_at` < the journal's `when`), not by name. Upstream's
0049-0052 on `main` are dated 2026-11-07 to 2026-11-10, before our 0049-0051 (2026-11-12 to
2026-11-14), so on a database that has ours they would be skipped silently. At that upgrade: renumber
our migrations after upstream's, make them idempotent (`IF NOT EXISTS`), and date them after
upstream's last one; then check on a copy of the production database that every upstream table
and column exists before deploying.

Upstreaming: not attempted yet. Patches 0001-0004 and 0007-0009 are generic enough to offer to
kgoedecke/doop (0007 is a plain bug fix).
