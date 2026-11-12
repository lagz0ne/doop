# perf/: render-performance harness for the doop editor

Moved here from `tmp/2026-11-11-doop-crosspage/` (the investigation that produced
patches 0001-0004). Outputs (Chrome traces, screenshots) are in `out/`, which git ignores.

## Local setup

    bin/doop apply && bin/doop serve           # patched doop on http://localhost:4477
    bin/doop base  && bin/doop serve --base    # pristine upstream on :4478, for A/B

`local.json` / `local-base.json` (ignored) hold the local perf account
(`{canvas, email, password, name}`) for those servers; `seed.py` / `stress.py` create it and
seed the 188-frame stress page from `canvas.json` (uses `../host-app/scripts/canvas`).
`base/` is the same seed for the :4478 server.

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
| `diff.mjs`, `crop.mjs` | compare a screenshot region with a reference (mean pixel difference); cut and enlarge a region |
| `fit.mjs`, `pancheck.mjs`, `layers.mjs`, `wake.mjs`, `oop.mjs` | single-question probes (fit stall, pan, layer count, frame wake-up, out-of-process frames on :4478) |

`final-bench.txt` is the before/after that justified patched.2. Headline (188 frames, editor
main thread): pan at fit 2260 → 245 ms, zoom 8→60% 1700 → 480-540 ms, open page
10.4 → 2.2 s renderer CPU, heap 116 → 27 MB.

`refine-bench.txt` is `bench.mjs` on patched.2 and on patches 0007-0009, interleaved (the
machine was loaded, so only the comparison means anything, not the absolute numbers).

## probes/

Playwright probes against **production** doop.example.com, logged in as the agent account
(`~/.config/doop/doop-claude-*`), on the host's "Big canvas" canvas. They measured the
cross-page prototype flow (`cases.json`) and gave `baseline-v0.12.0.txt`. They use the host's
playwright install (`../host-app/node_modules`). Read-only, except `layout.new.py`, which
reorganised the host's canvas pages (a reorg) and should not be re-run blindly.
