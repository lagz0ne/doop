import { createServer, type Server as HttpServer } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client, freePort, startServer, type Server } from './harness.ts'

/* Review verdicts on a real server: who may give one (review and up), the
   changes_requested status, the frame.approval event, and an edit after a
   verdict asking for another look. */

let server: Server
let owner: Client
let commenter: Client
let canvasId: string
let frameId: string
let hook: HttpServer
const deliveries: Record<string, unknown>[] = []

interface Entry {
  status: string
  by: string
  at: number
  frameUpdatedAt: number
  versionId?: string
}
interface FrameNow {
  updatedAt: number
  html: string
  approval?: { status: string; verdict?: string; history?: Entry[] } | null
}

async function frameNow(): Promise<FrameNow> {
  const canvas = (await (await owner.get(`/api/canvases/${canvasId}`)).json()) as {
    frames: (FrameNow & { id: string })[]
  }
  return canvas.frames.find((f) => f.id === frameId)!
}

function verdict(client: Client, status: string, expectedUpdatedAt: number) {
  return client.req(`/api/frames/${frameId}/approval`, {
    method: 'PUT',
    body: JSON.stringify({ status, expectedUpdatedAt }),
  })
}

beforeAll(async () => {
  const hookPort = await freePort()
  hook = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      deliveries.push(JSON.parse(body))
      res.end('ok')
    })
  }).listen(hookPort, '127.0.0.1')
  server = await startServer({ WEBHOOK_ALLOW_PRIVATE_URLS: 'true' })
  owner = await new Client(server).signUp('owner@example.com', 'Olive Owner')
  commenter = await new Client(server).signUp('commenter@example.com', 'Cal Commenter')
  canvasId = ((await (await owner.post('/api/canvases', { name: 'Review' })).json()) as { id: string }).id
  const created = await owner.post(`/api/canvases/${canvasId}/frames`, {
    name: 'Home',
    width: 400,
    height: 300,
    html: '<html><body><h1>Hi</h1></body></html>',
  })
  frameId = ((await created.json()) as { id: string }).id
  await owner.patch(`/api/canvases/${canvasId}`, { linkAccess: 'comment' })
  const wh = await owner.post('/api/webhooks', { url: `http://127.0.0.1:${hookPort}/`, events: ['frame.approval'] })
  expect(wh.status, await wh.clone().text()).toBeLessThan(300)
}, 90_000)

afterAll(() => {
  server?.stop()
  hook?.close()
})

describe('review verdicts', () => {
  it('lets an editor request changes, but not someone who may only comment', async () => {
    const { updatedAt } = await frameNow()
    expect((await verdict(commenter, 'changes_requested', updatedAt)).status).toBe(403)
    expect((await verdict(owner, 'rejected', updatedAt)).status).toBe(400)
    const res = await verdict(owner, 'changes_requested', updatedAt)
    expect(res.status, await res.clone().text()).toBe(200)
    expect(((await res.json()) as { approval: { status: string; approvedBy: string } }).approval).toMatchObject({
      status: 'changes_requested',
      approvedBy: 'Olive Owner',
    })
  })

  it('reports the verdict to webhooks', async () => {
    await expect.poll(() => deliveries.find((d) => d.type === 'frame.approval'), { timeout: 10_000 }).toBeTruthy()
    expect(deliveries.find((d) => d.type === 'frame.approval')).toMatchObject({
      status: 'changes_requested',
      actor: { name: 'Olive Owner', kind: 'user' },
      frame: { id: frameId },
    })
  })

  it('asks for another review once the design changes after the verdict', async () => {
    const edited = await owner.patch(`/api/frames/${frameId}`, { html: '<html><body><h1>Hi!</h1></body></html>' })
    expect(edited.status).toBe(200)
    expect((await frameNow()).approval?.status).toBe('needs_review')
    /* and the verdict can be given again on the new revision */
    const again = await verdict(owner, 'ready_for_dev', (await frameNow()).updatedAt)
    expect(again.status).toBe(200)
    expect((await frameNow()).approval?.status).toBe('ready_for_dev')
  })
})

describe('verdict history', () => {
  it('keeps the last verdict and its history through an edit, with the reviewed state filed as a version', async () => {
    const before = await frameNow()
    const sent = await verdict(owner, 'changes_requested', before.updatedAt)
    expect(sent.status).toBe(200)
    const after = await frameNow()
    expect(after.approval).toMatchObject({ status: 'changes_requested', verdict: 'changes_requested' })
    const last = after.approval!.history!.at(-1)!
    expect(last).toMatchObject({ status: 'changes_requested', by: 'Olive Owner', frameUpdatedAt: before.updatedAt })
    expect(last.versionId).toBeTruthy()

    /* the same person tweaks it at once: one burst, so only the verdict's own
       snapshot keeps the reviewed state */
    await owner.patch(`/api/frames/${frameId}`, { html: '<html><body><h1>Revised</h1></body></html>' })
    await owner.patch(`/api/frames/${frameId}`, { html: '<html><body><h1>Revised again</h1></body></html>' })
    const edited = await frameNow()
    expect(edited.approval).toMatchObject({ status: 'needs_review', verdict: 'changes_requested' })
    expect(edited.approval!.history!.at(-1)).toEqual(last)
    await expect
      .poll(async () => (await owner.get(`/api/frames/${frameId}/versions/${last.versionId}`)).status, {
        timeout: 8000,
      })
      .toBe(200)
    const reviewed = (await (await owner.get(`/api/frames/${frameId}/versions/${last.versionId}`)).json()) as {
      html: string
      savedAt: number
    }
    expect(reviewed.html).toBe(before.html)
    expect(reviewed.savedAt).toBe(last.frameUpdatedAt)
  })

  it('appends verdicts oldest first, keeps the last 20 and clears with a move to draft', async () => {
    for (let i = 0; i < 22; i++) {
      const status = i % 2 ? 'changes_requested' : 'ready_for_dev'
      const res = await verdict(owner, status, (await frameNow()).updatedAt)
      expect(res.status, await res.clone().text()).toBe(200)
    }
    const { approval } = await frameNow()
    expect(approval!.history).toHaveLength(20)
    expect(approval!.history!.at(-1)!.status).toBe('changes_requested')
    const ats = approval!.history!.map((e) => e.at)
    expect([...ats].sort((a, b) => a - b)).toEqual(ats)
    expect((await verdict(owner, 'draft', (await frameNow()).updatedAt)).status).toBe(200)
    expect((await frameNow()).approval ?? null).toBeNull()
  })
})
