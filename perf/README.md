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
| `jsprof.mjs <trace> [scenario]` | source-mapped JS profile (needs `vite build --sourcemap`, which `serve` does; `TREE=` names a build tree other than `build/doop`) |
| `bench.mjs` | main-thread busy time, worst frame gap and live document count for pan / zoom / press / fit, a pinch sent one wheel event per animation frame from inside the page, and leaving a neighbourhood and coming back (with the time until its frames show their documents). `ONLY=` picks scenarios by name; An argument is CSS to inject; `LS=` sets localStorage first; `JSON_OUT=` appends the numbers. Prints the CPU of the renderers and of the GPU process per scenario, and which compositing and raster mode the browser runs in |
| `ab.sh <name> <A url> <B url> [runs]` | `bench.mjs` on two servers, interleaved and alternating who goes first, with a table of medians. `A_LS` / `B_LS` give each side its own localStorage, so one server can be both sides; `CHROME_ARGS` adds browser flags (below); the table has the renderers' and the GPU process's CPU too |
| `trace-live.mjs <out.json> [page]` | Chrome trace of the gestures over live documents: zoom in small steps (60>95>60%), zoom across 100% (the layout zoom changes), six presses, a pan. `INV=1` adds style invalidation tracking |
| `events.mjs <trace> <scenario> <Event>...` | occurrences of a timeline event in a scenario: count, time, how many were forced from script, elements per event |
| `longtasks.mjs <trace> <scenario> [n]` | the longest main-thread tasks of the editor in a scenario, and what ran inside each |
| `presscheck.mjs` | a pan press with the Hand tool: the cursor shown, whether the drag selects text in the chrome, restyle cost at press and release |
| `camera.mjs [css]` | what one camera frame costs, write by write: 30 animation frames of a single DOM write (the world's transform, the dot grid's, the label layer's `--vx`/`--vy`, nothing) and a real wheel pan, each traced: main-thread and compositor-thread busy time of the editor, full compositor updates ("Layerize"), style, paint, commit. `ZOOM=0.6` zooms first, `V=grid,world,wheel` picks, `REPS=`, `SETUP=` is script run in the page first, `DUMP=1` lists what ran inside the updates |
| `layervariants.mjs` | compositor layers (count, drawing, megapixels, commonest sizes) as shipped and under CSS variants of the frame shells: names hidden, clips off, shells not painted, pictures as flat `<img>`s. `ZOOM=` as above |
| `trace-pinch.mjs <out.json\|-> [css]` | trace of a pan at fit, a pinch 60>95% and back, a pan at 60%, with CPU per thread of the GPU process (`-` skips the trace). `FRAMECSS=` injects CSS into every frame document |
| `raster.mjs <trace>` | raster and compositing work in such a trace per scenario: raster tasks, commits, layerizes and draws per process, raster tiles per layer |
| `gpucheck.mjs <prefix> [page]` | the probe behind the GPU picture layer (`doop:gpu`, patch 0036; written for its first version, see `docs/history.md`): WebGL2 present, shells, `<img>`s and live frames with it off and forced, screenshots of both |
| `parkcheck.mjs` | the probe behind the shelved experiment of keeping frame documents alive after they leave the view (see `docs/history.md`) |
| `look.mjs <prefix> [page] [dpr]` | screenshots of previews next to live frames: fit, one frame clicked, a few zooms, mid-pan (`CULL=off`: every frame live, the reference). Forces the device scale factor on the browser: emulating it does not reach out-of-process frames, which then look blurred |
| `boot.mjs <prefix> [page] [zoom]` | what a frame shows while its document boots (screencast of one frame after a click): finds the white flash |
| `fonts.mts [n]` | are a frame's web fonts in place when the server captures it? Runs the server's own `loadFramePage` (`TREE=base` for upstream); run from `build/doop` with tsx, see its header |
| `formats.mjs` | bytes and encode time of a preview per scale and format (jpeg/webp/png) |
| `embed-host.mjs [port]` | a stand-in host app for the review panel: signs the review token as a host app's server would (HS256, `HOST_SECRET`, `CANVAS`) and embeds `/embed`; answers `doop:need-token`, logs every panel message. Also the reference for the host side |
| `embed-e2e.mjs <frameId>` | the review flow end to end in a browser against `bin/doop serve` started with `DOOP_EMBED_HOSTS` naming `http://localhost:4499` (the same secret in `HOST_SECRET`): request changes with a pinned comment, an edit as the agent, compare, approve, and a reviewer edit refused |
| `diff.mjs`, `crop.mjs` | compare a screenshot region with a reference (mean pixel difference); cut and enlarge a region |
| `fit.mjs`, `pancheck.mjs`, `layers.mjs`, `wake.mjs`, `oop.mjs` | single-question probes (fit stall, pan, layer count, frame wake-up, out-of-process frames on :4478) |

## Measuring without a GPU

A headless Chrome on a machine with no GPU composites in software, which misleads: a WebGL
canvas is read back every frame, and layers cost nothing like what they cost on a GPU. For
anything about layers, raster or compositing, run with GPU compositing on a software GL
(`bench.mjs`, `ab.sh`, `trace.mjs`, `trace-live.mjs` and the scripts above all read `CHROME_ARGS`):

    CHROME_ARGS="--enable-unsafe-swiftshader --use-angle=swiftshader --ignore-gpu-blocklist --enable-gpu-rasterization --enable-gpu"

The render trial (patch 0039) would give every run a random level of zoom pictures (and of the
GPU layer on a hardware GL), so the scripts that open a canvas set `doop:render-trial='off'`
before `LS=` is applied: a run measures the switches it names and nothing else. To watch the
trial itself, pass `LS='{"doop:render-trial":"force"}'` (a software GL is let in) and read
`localStorage['doop:render-trial-data']`.

`bench.mjs` prints the mode it got. Even so, CPU time of the GPU process is then SwiftShader
filling pixels on eight worker threads: it follows layer area times frames and is no measure of
a real GPU. Compare what does not depend on the GPU: main-thread and compositor-thread time,
and counts (raster tasks and tiles per layer, full compositor updates, layers). `docs/history.md`
has what that gave ("Where a camera frame's time goes").

`final-bench.txt` is the before/after that justified releasing patches 0001-0004. Headline (188 frames, editor
main thread): pan at fit 2260 → 245 ms, zoom 8→60% 1700 → 480-540 ms, open page
10.4 → 2.2 s renderer CPU, heap 116 → 27 MB.

`refine-bench.txt` is `bench.mjs` on v0.12.0 + 0001-0004 and with patches 0007-0009 added, interleaved (the
machine was loaded, so only the comparison means anything, not the absolute numbers).

## probes/ (local only)

Probes that run against a deployed instance and its real canvases (cross-page prototype flow,
preview levels and cache headers on production) live in `probes/`, which git ignores: they name
the instance, its accounts and its canvases.
