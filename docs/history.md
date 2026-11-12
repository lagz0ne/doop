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

Measured (Chrome traces, 188-frame page, frames out of process, editor main thread,
v0.12.0 → patched.2): pan at fit 2260 → 245 ms (37 slow frames → 0); zoom 8→60% 1700 →
480-540 ms; pan at 60% 1780 → 715 ms; fit jump 390 → 125 ms; open page 10.4 → 2.2 s renderer
CPU, editor heap 116 → 27 MB. Raw numbers: `perf/final-bench.txt`.

Upstreaming: not attempted yet. Patches 0001-0004 are generic enough to offer to kgoedecke/doop.
