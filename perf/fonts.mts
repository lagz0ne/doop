// Are a frame's web fonts in place when the server captures it? Loads real frames through the
// server's own loadFramePage (3 at once, as thumbs.ts renders) and reads document.fonts at the
// moment a screenshot would be taken.
// usage (from build/doop; TREE=base measures pristine upstream):
//   CHROME_PATH=… CHROME_NO_SANDBOX=true BETTER_AUTH_URL=http://localhost:4477 BETTER_AUTH_SECRET=x \
//     ./node_modules/.bin/tsx ../../perf/fonts.mts [n=24]
import { readFileSync } from 'node:fs'
import type { Frame } from '../build/doop/shared/types.ts'

const { loadFramePage } = (await import(
  `../build/${process.env.TREE ?? 'doop'}/server/screenshot.ts`
)) as typeof import('../build/doop/server/screenshot.ts')

const canvas = JSON.parse(readFileSync(new URL('./canvas.json', import.meta.url), 'utf8')) as { frames: Frame[] }
const n = Number(process.argv[2] ?? 24)
const frames = canvas.frames.filter((f) => f.width === 1440).slice(20, 20 + n)
let loaded = 0
let late = 0
let none = 0
const waits: number[] = []
await Promise.all(
  [0, 1, 2].map(async (worker) => {
    for (let i = worker; i < frames.length; i += 3) {
      const frame = frames[i]!
      const started = Date.now()
      const page = await loadFramePage(frame)
      const fonts = await page.page.evaluate(() => ({
        loaded: [...document.fonts].filter((f) => f.status === 'loaded').length,
        loading: [...document.fonts].filter((f) => f.status === 'loading').length,
        declared: document.fonts.size,
      }))
      waits.push(Date.now() - started)
      if (fonts.loading) late++
      else if (fonts.loaded) loaded++
      else none++
      console.log(frame.name.padEnd(36), `${Date.now() - started} ms`.padStart(8), JSON.stringify(fonts))
      await page.close()
    }
  }),
)
waits.sort((a, b) => a - b)
console.log(
  `\n${frames.length} frames: fonts in place ${loaded}, still loading ${late}, none loaded ${none}; load median ${waits[waits.length >> 1]} ms, max ${waits.at(-1)} ms`,
)
process.exit(0)
