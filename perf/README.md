# perf/: render-performance harness for the doop editor

Started in the investigation that produced patches 0001-0004. Outputs (Chrome traces,
screenshots) are in `out/`, which git ignores.

## Local setup

    bin/doop apply && bin/doop serve           # patched doop on http://localhost:4477
    bin/doop base  && bin/doop serve --base    # pristine upstream on :4478, for A/B

`local.json` / `local-base.json` (ignored) hold the local perf account
(`{canvas, email, password, name}`) for those servers. `stress.py` (and `base/stress.py` for
:4478) builds the 188-frame stress page from a canvas export in `canvas.json`. The measurements
here used a copy of a real design canvas, which is not part of this repo: `canvas.json` and the
script that copied it (`seed.py`) are git-ignored, so bring your own canvas.

## Scripts (node, puppeteer-core from build/doop/node_modules)

| script | what |
|---|---|
| `trace.mjs <out.json> [page] [cull=on\|off]` | Chrome trace (all processes) through fixed scenarios: open, pan at fit, zoom 8→60%, pan at 60%, fit jump |
| `analyze.mjs <trace>` | CPU per process/thread, event self time, top JS functions, input latency per scenario |
| `jsprof.mjs <trace>` | source-mapped JS profile (needs `vite build --sourcemap`, which `serve` does) |
| `bench.mjs` | main-thread busy time + worst frame gap for pan / zoom / fit, per CSS variant |
| `look.mjs <prefix> [page] [dpr]` | screenshots of previews next to live frames: fit, one frame clicked, a few zooms, mid-pan (`CULL=off`: every frame live, the reference). Forces the device scale factor on the browser: emulating it does not reach out-of-process frames, which then look blurred |
| `boot.mjs <prefix> [page] [zoom]` | what a frame shows while its document boots (screencast of one frame after a click): finds the white flash |
| `fonts.mts [n]` | are a frame's web fonts in place when the server captures it? Runs the server's own `loadFramePage` (`TREE=base` for upstream); run from `build/doop` with tsx, see its header |
| `formats.mjs` | bytes and encode time of a preview per scale and format (jpeg/webp/png) |
| `embed-host.mjs [port]` | a stand-in host app for the review panel: signs the review token as a host app's server would (HS256, `HOST_SECRET`, `CANVAS`) and embeds `/embed`; answers `doop:need-token`, logs every panel message. Also the reference for the host side |
| `embed-e2e.mjs <frameId>` | the review flow end to end in a browser against `bin/doop serve` started with `DOOP_EMBED_HOSTS` naming `http://localhost:4499` (the same secret in `HOST_SECRET`): request changes with a pinned comment, an edit as the agent, compare, approve, and a reviewer edit refused |
| `diff.mjs`, `crop.mjs` | compare a screenshot region with a reference (mean pixel difference); cut and enlarge a region |
| `fit.mjs`, `pancheck.mjs`, `layers.mjs`, `wake.mjs`, `oop.mjs` | single-question probes (fit stall, pan, layer count, frame wake-up, out-of-process frames on :4478) |

`final-bench.txt` is the before/after that justified releasing patches 0001-0004. Headline (188 frames, editor
main thread): pan at fit 2260 → 245 ms, zoom 8→60% 1700 → 480-540 ms, open page
10.4 → 2.2 s renderer CPU, heap 116 → 27 MB.

`refine-bench.txt` is `bench.mjs` on v0.12.0 + 0001-0004 and with patches 0007-0009 added, interleaved (the
machine was loaded, so only the comparison means anything, not the absolute numbers).

## probes/ (local only)

Probes that run against a deployed instance and its real canvases (cross-page prototype flow,
preview levels and cache headers on production) live in `probes/`, which git ignores: they name
the instance, its accounts and its canvases.
