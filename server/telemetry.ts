import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express'
import { env } from './env.ts'
import { RENDER_REPORT_MAX_BYTES, armOf } from '../shared/renderTrial.ts'
import { renderReportSchema, type RenderReport, type RenderVerdict } from '../shared/renderTrialSchema.ts'

/**
 * POST /api/telemetry/render: the render trial's report from a browser
 * (shared/renderTrialSchema.ts). Valid reports are forwarded to an OpenTelemetry
 * collector as OTLP/HTTP JSON logs when OTEL_EXPORTER_OTLP_ENDPOINT is set,
 * and dropped otherwise. The body is a closed schema of enums and numbers,
 * so nothing about the caller reaches a log record: the caller's id is used
 * only to rate-limit.
 *
 * Plain fetch with the JSON encoding, not the OpenTelemetry SDK: one record
 * type, sent a few times per page load, does not need a dependency, a
 * batcher or a meter provider.
 */

/** Who is reporting: any signed-in session, a share-link guest's and an
 *  embedded panel's included. Impersonated sessions are an admin looking,
 *  not the person's browser, so their reports are dropped. */
export interface TelemetryCaller {
  id: string
  impersonated: boolean
}

export const TELEMETRY_WINDOW_MS = 10 * 60_000
/* a page reports at most every few minutes plus once per hide; 30 per ten
   minutes leaves room for a handful of tabs and still bounds a flood */
export const TELEMETRY_REPORTS_PER_WINDOW = 30
const COLLECTOR_TIMEOUT_MS = 3_000
const WARN_EVERY_MS = 10 * 60_000

const hits = new Map<string, number[]>()

function takeSlot(id: string, now: number): boolean {
  const recent = (hits.get(id) ?? []).filter((t) => now - t < TELEMETRY_WINDOW_MS)
  if (recent.length >= TELEMETRY_REPORTS_PER_WINDOW) {
    hits.set(id, recent)
    return false
  }
  recent.push(now)
  hits.set(id, recent)
  /* every caller who ever reported keeps an entry otherwise */
  if (hits.size > 10_000) {
    for (const [key, times] of hits) if (!times.some((t) => now - t < TELEMETRY_WINDOW_MS)) hits.delete(key)
  }
  return true
}

/** For tests: forget every caller's window. */
export function resetTelemetryLimits(): void {
  hits.clear()
}

/* the body parser's own errors (too large, not JSON) would reach Express's
   default handler, which answers with an HTML page; a report needs a status */
const parseBody = express.json({ limit: RENDER_REPORT_MAX_BYTES, type: () => true })
function quietBody(req: Request, res: Response, next: NextFunction): void {
  parseBody(req, res, (err?: unknown) => {
    if (!err) return next()
    const status = (err as { status?: unknown }).status
    res.status(status === 413 ? 413 : 400).end()
  })
}

export function renderTelemetry(callerOf: (req: Request) => Promise<TelemetryCaller | null>): RequestHandler[] {
  const handle = async (req: Request, res: Response): Promise<void> => {
    /* a beacon from another site would carry this browser's cookies only
       where SameSite allows; refuse it either way */
    if (req.get('sec-fetch-site') === 'cross-site') {
      res.status(403).end()
      return
    }
    const caller = await callerOf(req).catch(() => null)
    if (!caller) {
      res.status(401).end()
      return
    }
    const parsed = renderReportSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).end()
      return
    }
    /* over the limit or impersonated: accepted and dropped, so the browser
       has nothing to retry and nothing to show */
    res.status(204).end()
    if (caller.impersonated || !takeSlot(caller.id, Date.now())) return
    void forwardRenderReport(parsed.data)
  }
  return [
    quietBody,
    (req, res, next) => {
      handle(req, res).catch(next)
    },
  ]
}

/* ------------------------------------------------------------------ */
/* OTLP/HTTP JSON                                                      */
/* ------------------------------------------------------------------ */

type AnyValue = { stringValue: string } | { boolValue: boolean } | { intValue: string } | { doubleValue: number }
export interface KeyValue {
  key: string
  value: AnyValue
}

const str = (key: string, value: string): KeyValue => ({ key, value: { stringValue: value } })
const bool = (key: string, value: boolean): KeyValue => ({ key, value: { boolValue: value } })
/* int64 travels as a decimal string in OTLP's JSON encoding */
const int = (key: string, value: number): KeyValue => ({ key, value: { intValue: String(Math.round(value)) } })
const dbl = (key: string, value: number): KeyValue => ({ key, value: { doubleValue: value } })

export const RENDER_LOG_BODY = 'render trial'
const SCOPE = 'doop.render-trial'

/** `k=v,k=v`, values percent-decoded, as the OpenTelemetry SDKs read it. */
export function parseResourceAttributes(raw: string | undefined): Map<string, string> {
  const attrs = new Map<string, string>()
  for (const pair of (raw ?? '').split(',')) {
    const at = pair.indexOf('=')
    if (at <= 0) continue
    const key = pair.slice(0, at).trim()
    let value = pair.slice(at + 1).trim()
    try {
      value = decodeURIComponent(value)
    } catch {
      /* a stray % keeps the raw text */
    }
    if (key) attrs.set(key, value)
  }
  return attrs
}

function resourceAttributes(): KeyValue[] {
  const attrs = parseResourceAttributes(env.OTEL_RESOURCE_ATTRIBUTES)
  /* OTEL_SERVICE_NAME wins over a service.name in the attribute list */
  attrs.set('service.name', env.OTEL_SERVICE_NAME ?? attrs.get('service.name') ?? 'doop')
  return [...attrs].map(([key, value]) => str(key, value))
}

function verdictAttributes(prefix: string, v: RenderVerdict): KeyValue[] {
  const out = [
    str(prefix, v.winner ?? 'exploring'),
    int(`${prefix}.on_frames`, v.onFrames),
    int(`${prefix}.off_frames`, v.offFrames),
    int(`${prefix}.on_loads`, v.onLoads),
    int(`${prefix}.off_loads`, v.offLoads),
  ]
  if (v.onShare !== null) out.push(dbl(`${prefix}.on_share`, v.onShare))
  if (v.offShare !== null) out.push(dbl(`${prefix}.off_share`, v.offShare))
  return out
}

/** One flat attribute list per row, so a log query can group by arm, kind
 *  and stratum and sum frames and slow frames without unpacking a body. */
export function renderLogRecords(report: RenderReport, now: number): object[] {
  const time = `${now}000000`
  const e = report.env
  const shared: KeyValue[] = [
    int('doop.render.epoch', report.epoch),
    str('doop.render.arm', armOf(report.gpu.level, report.zoomPictures.level)),
    str('doop.render.gpu', report.gpu.level),
    str('doop.render.gpu.reason', report.gpu.reason),
    str('doop.render.zoom_pictures', report.zoomPictures.level),
    str('doop.render.zoom_pictures.reason', report.zoomPictures.reason),
    str('doop.render.env.renderer', e.renderer),
    dbl('doop.render.env.dpr', e.dpr),
    str('doop.render.env.viewport', `${e.width}x${e.height}`),
    dbl('doop.render.env.display_ms', e.display),
    bool('doop.render.env.touch', e.touch),
    str('doop.render.env.frames', e.frames),
    ...verdictAttributes('doop.render.verdict.gpu', report.verdicts.gpu),
    ...verdictAttributes('doop.render.verdict.zoom_pictures', report.verdicts.zoomPictures),
  ]
  if (e.hardware !== null) shared.push(bool('doop.render.env.hardware', e.hardware))
  if (e.cores !== null) shared.push(int('doop.render.env.cores', e.cores))
  if (e.memory !== null) shared.push(dbl('doop.render.env.memory_gb', e.memory))
  return report.rows.map((row) => ({
    timeUnixNano: time,
    observedTimeUnixNano: time,
    severityNumber: 9,
    severityText: 'INFO',
    body: { stringValue: RENDER_LOG_BODY },
    attributes: [
      ...shared,
      str('doop.render.gesture.kind', row.kind),
      str('doop.render.gesture.stratum', row.stratum),
      bool('doop.render.gesture.live', row.live),
      int('doop.render.gestures', row.gestures),
      int('doop.render.frames', row.frames),
      int('doop.render.slow_frames', row.slow),
      dbl('doop.render.slow_share', row.frames ? row.slow / row.frames : 0),
      dbl('doop.render.interval.mean_ms', row.mean),
      dbl('doop.render.interval.p95_ms', row.p95),
    ],
  }))
}

export function otlpLogsBody(report: RenderReport, now: number): object {
  return {
    resourceLogs: [
      {
        resource: { attributes: resourceAttributes() },
        scopeLogs: [{ scope: { name: SCOPE }, logRecords: renderLogRecords(report, now) }],
      },
    ],
  }
}

let lastWarning = -Infinity
function warn(message: string): void {
  const now = Date.now()
  if (now - lastWarning < WARN_EVERY_MS) return
  lastWarning = now
  console.warn(`[telemetry] ${message} (further failures are quiet for ${WARN_EVERY_MS / 60_000} minutes)`)
}

/** For tests: let the next failure warn again. */
export function resetTelemetryWarning(): void {
  lastWarning = -Infinity
}

/** Sends one report's records; never throws. Resolves false when nothing
 *  was sent (no collector configured, or it failed). */
export async function forwardRenderReport(report: RenderReport, now = Date.now()): Promise<boolean> {
  const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT
  if (!endpoint) return false
  try {
    const res = await fetch(`${endpoint}/v1/logs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(otlpLogsBody(report, now)),
      signal: AbortSignal.timeout(COLLECTOR_TIMEOUT_MS),
    })
    await res.body?.cancel()
    if (!res.ok) {
      warn(`the collector answered ${res.status}`)
      return false
    }
    return true
  } catch (err) {
    warn(`the collector is unreachable: ${err instanceof Error ? err.message : String(err)}`)
    return false
  }
}
