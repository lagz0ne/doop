import {
  PREVIEW_MAX_HEIGHT,
  PREVIEW_SCALES,
  previewRenderScale,
  type Frame,
  type PreviewScale,
} from '../shared/types.ts'
import * as storage from './storage.ts'

/**
 * Persisted dashboard previews: `thumb/<frameId>.jpg` in byte storage,
 * stale-while-revalidate on top.
 *
 * The stored object survives redeploys — which wipe the in-process image
 * cache — so a dashboard never shows blank tiles waiting on Chromium: a
 * possibly-stale thumbnail is served instantly and refreshed in the
 * background. The key is deliberately unversioned; freshness lives in the
 * `written` map (frameId → the frame.updatedAt the stored thumb was rendered
 * from), and beside each thumbnail in `thumb/<frameId>.ver`, read back once
 * per frame after a restart. Without that sidecar a restart forgot every
 * version, and the first visit to a big canvas re-rendered each frame it
 * showed (the editor's culled frames show these previews, hundreds a page).
 * A thumbnail stored before the sidecar existed still degrades to one
 * background re-render — never to a blank tile.
 *
 * Beside the card thumbnail a frame has one stored picture per level of the
 * editor's preview pyramid (PREVIEW_SCALES in shared/types.ts): the whole
 * frame at that scale, as WebP, for the canvas to show in place of the live
 * document. Each is rendered when first asked for and kept the same way,
 * with its own version; every function here takes the level, and none means
 * the card thumbnail.
 */

/** What all the bookkeeping below is keyed by: a frame's card thumbnail, or
 *  one level of its preview pyramid. */
const slot = (frameId: string, level?: PreviewScale) => (level === undefined ? frameId : `${frameId}@${level}`)

/** frame.updatedAt the stored thumb was rendered from; absent = unknown */
const written = new Map<string, number>()
/** in-flight render+persist per frame — concurrent callers share it */
const pending = new Map<string, Promise<Buffer>>()
/** background revalidation throttle: an agent saving every few seconds
 *  must not turn each dashboard poll into a Chromium render */
const lastAttempt = new Map<string, number>()
const MIN_REVALIDATE_MS = 30_000
/** frames purged mid-render — a pending create must not re-persist them */
const dead = new Set<string>()

/* storage keys are `<name>.<ext>` with no further dots (storage.ts), so a
   level goes into the extension: thumb/<id>.p25 is the 0.25 picture */
const keyFor = (frameId: string, level?: PreviewScale) =>
  level === undefined ? `thumb/${frameId}.jpg` : `thumb/${frameId}.p${level * 100}`
const versionKeyFor = (frameId: string, level?: PreviewScale) =>
  level === undefined ? `thumb/${frameId}.ver` : `thumb/${frameId}.p${level * 100}ver`
const mimeFor = (level?: PreviewScale) => (level === undefined ? 'image/jpeg' : 'image/webp')

/* Global bound on concurrent preview renders. Per-frame dedupe caps repeat
   requests but not breadth: a post-restart dashboard of 50 stale canvases
   (or an anonymous crawler walking known frame URLs) would otherwise launch
   50 Chromium pages at once. Excess renders queue, they are not dropped. */
const MAX_CONCURRENT_RENDERS = 3
let active = 0
const waiting: Array<() => void> = []

/* lazy like every other screenshot.ts consumer (dev never pays for
   puppeteer-core until the first render), but single-flight */
let screenshot: Promise<typeof import('./screenshot.ts')> | undefined
const loadScreenshot = () => (screenshot ??= import('./screenshot.ts'))

/** The preview render: card-sized, clipped, cheap — matches what /i/?preview
 *  serves, because this IS what /i/?preview serves. */
async function render(frame: Frame, level?: PreviewScale): Promise<Buffer> {
  if (active >= MAX_CONCURRENT_RENDERS) await new Promise<void>((r) => waiting.push(r))
  active++
  try {
    const { renderFrame } = await loadScreenshot()
    /* A level of the pyramid is the whole frame, unclipped, at that scale.
       WebP at 90 because the picture stands in for the live document right
       beside live ones: JPEG at 70 rings around every glyph and hairline,
       and WebP at 90 is clean at half the bytes of JPEG at 90 or PNG. */
    if (level !== undefined)
      return await renderFrame(frame, previewRenderScale(frame, level), { type: 'webp', quality: 90 })
    return await renderFrame(frame, Math.min(1, 640 / frame.width), {
      type: 'jpeg',
      quality: 70,
      maxHeight: PREVIEW_MAX_HEIGHT,
    })
  } finally {
    active--
    waiting.shift()?.()
  }
}

/** Render now, persist, and return the bytes. Deduped per frame; rejects on
 *  render failure (the caller decides what a failed render means). */
export function create(frame: Frame, level?: PreviewScale): Promise<Buffer> {
  const id = slot(frame.id, level)
  const inflight = pending.get(id)
  if (inflight) return inflight
  lastAttempt.set(id, Date.now())
  const p = render(frame, level).then(async (buf) => {
    /* persist is best-effort: a bucket hiccup must not fail the response
       that only needed the bytes */
    try {
      if (!dead.has(frame.id)) {
        await storage.putObject(keyFor(frame.id, level), buf, mimeFor(level))
        written.set(id, frame.updatedAt)
        /* purge may have run during the put — its delete can land before
           our write finishes, so re-check and clean up our own orphan */
        if (dead.has(frame.id)) await storage.deleteObject(keyFor(frame.id, level))
        else await storage.putObject(versionKeyFor(frame.id, level), Buffer.from(String(frame.updatedAt)), 'text/plain')
      }
    } catch (e) {
      console.error(`thumb persist failed for ${id}:`, e)
    }
    return buf
  })
  pending.set(id, p)
  p.catch(() => {}).finally(() => pending.delete(id))
  return p
}

/** The stored thumbnail, if there is one. When it is stale — or its
 *  freshness is unknown after a restart — a background re-render is kicked
 *  off (throttled, deduped, errors logged and swallowed) and the stored
 *  bytes are returned anyway: stale beats blank. Returns null when nothing
 *  is stored yet. */
export async function getStored(
  frame: Frame,
  level?: PreviewScale,
): Promise<{ buf: Buffer; fresh: boolean; known: boolean } | null> {
  const id = slot(frame.id, level)
  let buf: Buffer | null
  try {
    buf = await storage.getObject(keyFor(frame.id, level))
  } catch (e) {
    console.error(`thumb read failed for ${id}:`, e)
    return null
  }
  if (!buf) {
    /* the map claimed fresh but the object is gone (manual purge, new
       bucket) — forget, so the caller falls through to a live render */
    written.delete(id)
    return null
  }
  /* after a restart the version is on storage, not in memory: read it once */
  if (!written.has(id)) {
    const version = Number((await storage.getObject(versionKeyFor(frame.id, level)).catch(() => null))?.toString())
    if (Number.isFinite(version) && !written.has(id)) written.set(id, version)
  }
  const fresh = written.get(id) === frame.updatedAt
  const throttled = Date.now() - (lastAttempt.get(id) ?? 0) < MIN_REVALIDATE_MS
  if (!fresh && !throttled && !pending.has(id))
    create(frame, level).catch((e) => console.error(`thumb revalidate failed for ${id}:`, e))
  /* `known`: the version it was rendered from is on record (a thumbnail from
     before versions were stored is of unknown age, not known to be old) */
  return { buf, fresh, known: written.has(id) }
}

/** Frame (or its whole canvas) is gone — drop the derived object too, so the
 *  thumb folder holds only live frames. Best-effort fire-and-forget. */
export function purge(frameId: string): void {
  dead.add(frameId)
  for (const level of [undefined, ...PREVIEW_SCALES]) {
    written.delete(slot(frameId, level))
    lastAttempt.delete(slot(frameId, level))
    storage.deleteObject(keyFor(frameId, level)).catch(() => {})
    storage.deleteObject(versionKeyFor(frameId, level)).catch(() => {})
  }
}
