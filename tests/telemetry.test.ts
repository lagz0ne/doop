import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  RENDER_LOG_BODY,
  TELEMETRY_REPORTS_PER_WINDOW,
  forwardRenderReport,
  parseResourceAttributes,
  renderTelemetry,
  resetTelemetryLimits,
  resetTelemetryWarning,
  type KeyValue,
  type TelemetryCaller,
} from '../server/telemetry.ts'
import { renderReportSchema, type RenderReport } from '../shared/renderTrialSchema.ts'
import { stubEnv, unstubAllEnvs } from './envStub.ts'

/**
 * The render trial's report route: what it accepts, who may call it, and the
 * OTLP/HTTP JSON it sends to a collector. A local HTTP server stands in for
 * the collector.
 */

function sampleReport(): RenderReport {
  return {
    v: 1,
    epoch: 1,
    gpu: { level: 'on', reason: 'explore' },
    zoomPictures: { level: 'off', reason: 'override' },
    env: {
      renderer: 'ANGLE (Vendor, Some GPU Direct3D11 vs_5_0 ps_5_0, D3D11)',
      hardware: true,
      dpr: 2,
      width: 1500,
      height: 900,
      cores: 8,
      memory: 8,
      display: 16.7,
      touch: false,
      frames: '100-199',
    },
    rows: [
      { kind: 'pan', stratum: 'heavy', live: false, gestures: 3, frames: 120, slow: 12, mean: 18.5, p95: 33.2 },
      { kind: 'zoom', stratum: 'light', live: true, gestures: 1, frames: 40, slow: 0, mean: 16.8, p95: 17.4 },
    ],
    verdicts: {
      gpu: { winner: null, onShare: 0.1, offShare: 0.25, onFrames: 120, offFrames: 300, onLoads: 1, offLoads: 2 },
      zoomPictures: {
        winner: 'off',
        onShare: null,
        offShare: null,
        onFrames: 0,
        offFrames: 0,
        onLoads: 0,
        offLoads: 0,
      },
    },
  }
}

/* the collector stand-in: records every request body */
const received: { path: string; type: string; body: unknown }[] = []
let collectorStatus = 200
let collector: Server
let collectorOrigin: string
let waiters: (() => void)[] = []
const nextDelivery = () => new Promise<void>((resolve) => waiters.push(resolve))

/* the route under test, with callers chosen by a test header */
let app: Server
let origin: string
const callers: Record<string, TelemetryCaller> = {
  alice: { id: 'user-alice', impersonated: false },
  guest: { id: 'guest-1', impersonated: false },
  admin: { id: 'user-alice', impersonated: true },
}

const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let text = ''
    req.on('data', (chunk) => (text += chunk))
    req.on('end', () => resolve(text))
  })

beforeAll(async () => {
  collector = createServer((req, res) => {
    void readBody(req).then((text) => {
      received.push({ path: req.url ?? '', type: req.headers['content-type'] ?? '', body: JSON.parse(text) })
      res.statusCode = collectorStatus
      res.end()
      waiters.forEach((w) => w())
      waiters = []
    })
  })
  await new Promise<void>((resolve) => collector.listen(0, '127.0.0.1', resolve))
  collectorOrigin = `http://127.0.0.1:${(collector.address() as AddressInfo).port}`

  const server = express()
  server.post(
    '/api/telemetry/render',
    ...renderTelemetry(async (req) => callers[req.get('x-test-caller') ?? ''] ?? null),
  )
  await new Promise<void>((resolve) => {
    app = server.listen(0, '127.0.0.1', resolve)
  })
  origin = `http://127.0.0.1:${(app.address() as AddressInfo).port}`
})
afterAll(async () => {
  await new Promise<void>((resolve) => app.close(() => resolve()))
  await new Promise<void>((resolve) => collector.close(() => resolve()))
})
beforeEach(() => {
  received.length = 0
  collectorStatus = 200
  resetTelemetryLimits()
  resetTelemetryWarning()
})
afterEach(() => {
  unstubAllEnvs()
  vi.restoreAllMocks()
})

const post = (body: unknown, caller: string | null = 'alice', headers: Record<string, string> = {}) =>
  fetch(`${origin}/api/telemetry/render`, {
    method: 'POST',
    /* sendBeacon with a string body sends text/plain; the route reads any type */
    headers: { 'content-type': 'text/plain;charset=UTF-8', ...(caller ? { 'x-test-caller': caller } : {}), ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

const attrs = (list: KeyValue[]) =>
  Object.fromEntries(list.map(({ key, value }) => [key, Object.values(value)[0] as unknown]))

describe('POST /api/telemetry/render', () => {
  it('accepts a valid report with 204 and drops it while no collector is set', async () => {
    const send = vi.spyOn(globalThis, 'fetch')
    const res = await post(sampleReport())
    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')
    /* the only fetch is the test's own request */
    expect(send).toHaveBeenCalledTimes(1)
    expect(await forwardRenderReport(sampleReport())).toBe(false)
  })

  it('lets a share-link guest report', async () => {
    stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', collectorOrigin)
    const delivered = nextDelivery()
    expect((await post(sampleReport(), 'guest')).status).toBe(204)
    await delivered
    expect(received).toHaveLength(1)
  })

  it('refuses a request without a session, and a cross-site one', async () => {
    expect((await post(sampleReport(), null)).status).toBe(401)
    expect((await post(sampleReport(), 'alice', { 'sec-fetch-site': 'cross-site' })).status).toBe(403)
    expect((await post(sampleReport(), 'alice', { 'sec-fetch-site': 'same-origin' })).status).toBe(204)
  })

  it('refuses garbage: not JSON, wrong shapes, extra fields, identifying fields, oversize', async () => {
    const r = sampleReport()
    const bad: unknown[] = [
      'not json',
      '',
      null,
      [],
      { ...r, v: 2 },
      { ...r, gpu: { level: 'maybe', reason: 'explore' } },
      { ...r, rows: [] },
      { ...r, rows: [{ ...r.rows[0], slow: 500 }] },
      { ...r, rows: [{ ...r.rows[0], mean: -1 }] },
      { ...r, rows: [{ ...r.rows[0], frames: 1.5 }] },
      { ...r, rows: Array.from({ length: 9 }, () => r.rows[0]) },
      { ...r, userId: 'user-alice' },
      { ...r, env: { ...r.env, canvasId: 'c1' } },
      { ...r, env: { ...r.env, renderer: 'x'.repeat(81) } },
      { ...r, env: { ...r.env, renderer: 'line\nbreak' } },
      { ...r, env: { ...r.env, userAgent: 'Mozilla/5.0' } },
    ]
    for (const body of bad) {
      const res = await post(body)
      expect(res.status, JSON.stringify(body)?.slice(0, 80)).toBe(400)
    }
    const huge = await post({ ...r, padding: 'x'.repeat(10_000) })
    expect(huge.status).toBe(413)
  })

  it('answers 204 past the rate limit but forwards nothing more', async () => {
    stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', collectorOrigin)
    for (let i = 0; i < TELEMETRY_REPORTS_PER_WINDOW; i++) {
      const delivered = nextDelivery()
      expect((await post(sampleReport())).status).toBe(204)
      await delivered
    }
    expect((await post(sampleReport())).status).toBe(204)
    /* another caller has a window of its own */
    const delivered = nextDelivery()
    expect((await post(sampleReport(), 'guest')).status).toBe(204)
    await delivered
    expect(received).toHaveLength(TELEMETRY_REPORTS_PER_WINDOW + 1)
  })

  it('drops an impersonating admin’s report', async () => {
    stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', collectorOrigin)
    expect((await post(sampleReport(), 'admin')).status).toBe(204)
    expect(await forwardRenderReport(sampleReport())).toBe(true)
    /* only the direct forward arrived */
    expect(received).toHaveLength(1)
  })
})

describe('the OTLP body', () => {
  it('sends one INFO log record per row with flat attributes and the resource', async () => {
    stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', `${collectorOrigin}/`)
    stubEnv('OTEL_RESOURCE_ATTRIBUTES', 'deployment.environment=test,service.name=ignored,team=a%2Cb')
    stubEnv('OTEL_SERVICE_NAME', 'doop-test')
    expect(await forwardRenderReport(sampleReport(), 1_700_000_000_000)).toBe(true)
    expect(received).toHaveLength(1)
    const [{ path, type, body }] = received as [{ path: string; type: string; body: OtlpBody }]
    expect(path).toBe('/v1/logs')
    expect(type).toBe('application/json')
    const [resourceLogs] = body.resourceLogs
    expect(attrs(resourceLogs!.resource.attributes)).toEqual({
      'deployment.environment': 'test',
      'service.name': 'doop-test',
      team: 'a,b',
    })
    const [scope] = resourceLogs!.scopeLogs
    expect(scope!.scope.name).toBe('doop.render-trial')
    const records = scope!.logRecords
    expect(records).toHaveLength(2)
    const [pan, zoom] = records
    expect(pan).toMatchObject({
      timeUnixNano: '1700000000000000000',
      severityNumber: 9,
      severityText: 'INFO',
      body: { stringValue: RENDER_LOG_BODY },
    })
    expect(attrs(pan!.attributes)).toEqual({
      'doop.render.epoch': '1',
      'doop.render.arm': 'B',
      'doop.render.gpu': 'on',
      'doop.render.gpu.reason': 'explore',
      'doop.render.zoom_pictures': 'off',
      'doop.render.zoom_pictures.reason': 'override',
      'doop.render.env.renderer': 'ANGLE (Vendor, Some GPU Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'doop.render.env.hardware': true,
      'doop.render.env.dpr': 2,
      'doop.render.env.viewport': '1500x900',
      'doop.render.env.cores': '8',
      'doop.render.env.memory_gb': 8,
      'doop.render.env.display_ms': 16.7,
      'doop.render.env.touch': false,
      'doop.render.env.frames': '100-199',
      'doop.render.verdict.gpu': 'exploring',
      'doop.render.verdict.gpu.on_share': 0.1,
      'doop.render.verdict.gpu.off_share': 0.25,
      'doop.render.verdict.gpu.on_frames': '120',
      'doop.render.verdict.gpu.off_frames': '300',
      'doop.render.verdict.gpu.on_loads': '1',
      'doop.render.verdict.gpu.off_loads': '2',
      'doop.render.verdict.zoom_pictures': 'off',
      'doop.render.verdict.zoom_pictures.on_frames': '0',
      'doop.render.verdict.zoom_pictures.off_frames': '0',
      'doop.render.verdict.zoom_pictures.on_loads': '0',
      'doop.render.verdict.zoom_pictures.off_loads': '0',
      'doop.render.gesture.kind': 'pan',
      'doop.render.gesture.stratum': 'heavy',
      'doop.render.gesture.live': false,
      'doop.render.gestures': '3',
      'doop.render.frames': '120',
      'doop.render.slow_frames': '12',
      'doop.render.slow_share': 0.1,
      'doop.render.interval.mean_ms': 18.5,
      'doop.render.interval.p95_ms': 33.2,
    })
    expect(attrs(zoom!.attributes)).toMatchObject({ 'doop.render.gesture.kind': 'zoom', 'doop.render.slow_share': 0 })
  })

  it('defaults service.name to doop, or takes it from the attribute list', async () => {
    stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', collectorOrigin)
    await forwardRenderReport(sampleReport())
    stubEnv('OTEL_RESOURCE_ATTRIBUTES', 'service.name=design')
    await forwardRenderReport(sampleReport())
    const names = (received as { body: OtlpBody }[]).map(
      (r) => attrs(r.body.resourceLogs[0]!.resource.attributes)['service.name'],
    )
    expect(names).toEqual(['doop', 'design'])
  })

  it('swallows a failing or unreachable collector and warns once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', collectorOrigin)
    collectorStatus = 500
    expect(await forwardRenderReport(sampleReport())).toBe(false)
    stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://127.0.0.1:9')
    expect(await forwardRenderReport(sampleReport())).toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/collector answered 500/)
  })

  it('parses resource attributes the way the SDKs do', () => {
    expect([...parseResourceAttributes(' a = 1 ,=x,b,c=%E2%9C%93,d=50%')]).toEqual([
      ['a', '1'],
      ['c', '✓'],
      ['d', '50%'],
    ])
    expect(parseResourceAttributes(undefined).size).toBe(0)
  })

  it('keeps the sample report valid, so the tests above test the route and not the sample', () => {
    expect(renderReportSchema.safeParse(sampleReport()).success).toBe(true)
  })
})

interface OtlpBody {
  resourceLogs: {
    resource: { attributes: KeyValue[] }
    scopeLogs: { scope: { name: string }; logRecords: { attributes: KeyValue[] }[] }[]
  }[]
}
