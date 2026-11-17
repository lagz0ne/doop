import { afterAll, beforeAll, expect, it } from 'vitest'
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import WebSocket from 'ws'
import type { Canvas, Frame, Presence, ServerMessage } from '../shared/types'
import { personFocus } from '../server/roomFocus.ts'
import { Client, startServer, type Server } from './harness.ts'

let server: Server
let owner: Client
let stranger: Client
let agent: McpClient
let strangerAgent: McpClient

async function connect(client: Client, name: string): Promise<McpClient> {
  const { secret } = await (await client.post('/api/agent-keys', { name })).json()
  const mcp = new McpClient({ name: 'focus-test', version: '1.0.0' })
  await mcp.connect(
    new StreamableHTTPClientTransport(new URL('/mcp', server.base), {
      requestInit: { headers: { Authorization: `Bearer ${secret}` } },
    }),
  )
  return mcp
}

beforeAll(async () => {
  server = await startServer()
  owner = await new Client(server).signUp('focus@test.dev', 'Focus Owner')
  stranger = await new Client(server).signUp('focus-stranger@test.dev', 'Stranger')
  agent = await connect(owner, 'Focus agent')
  strangerAgent = await connect(stranger, 'Stranger agent')
}, 60_000)

afterAll(async () => {
  await agent?.close()
  await strangerAgent?.close()
  server?.stop()
})

async function call(mcp: McpClient, name: string, args: Record<string, unknown>) {
  const result = await mcp.callTool({ name, arguments: args })
  const content = result.content as { type: string; text?: string }[]
  return { isError: !!result.isError, body: content.find((item) => item.type === 'text')!.text! }
}

async function json(mcp: McpClient, name: string, args: Record<string, unknown>) {
  const { isError, body } = await call(mcp, name, args)
  expect(isError, body).toBe(false)
  return JSON.parse(body)
}

async function frame(canvas: Canvas, name: string, x: number, y: number): Promise<Frame> {
  const res = await owner.post(`/api/canvases/${canvas.id}/frames`, {
    name,
    html: `<h1>${name}</h1>`,
    x,
    y,
    width: 1000,
    height: 800,
  })
  expect(res.status, await res.clone().text()).toBe(200)
  return res.json()
}

async function join(canvas: Canvas) {
  const ws = new WebSocket(`ws://localhost:${server.port}/ws`, { headers: { Cookie: owner.header() } })
  const messages: ServerMessage[] = []
  ws.on('message', (data) => messages.push(JSON.parse(String(data))))
  await new Promise<void>((resolve) => ws.once('open', resolve))
  ws.send(JSON.stringify({ type: 'join', canvasId: canvas.id, clientId: 'focus-tab', name: 'x', kind: 'user' }))
  await expect.poll(() => messages.some((m) => m.type === 'init')).toBe(true)
  return ws
}

it("tells an agent the frame a person selected and what is on their screen, and nobody else's", async () => {
  const canvas: Canvas = await (await owner.post('/api/canvases', { name: 'Focus' })).json()
  const left = await frame(canvas, 'Left', 0, 0)
  const right = await frame(canvas, 'Right', 1200, 0)
  const far = await frame(canvas, 'Far', 10_000, 0)

  const empty = await json(agent, 'get_focus', { canvas_id: canvas.id })
  expect(empty.people).toEqual([])
  expect(empty.note).toMatch(/Nobody/)

  const ws = await join(canvas)
  try {
    /* a 1600x900 screen at 50% from world (-100, 0): 3200x1800 of world,
       all of Left and Right, none of Far */
    ws.send(JSON.stringify({ type: 'viewport', viewport: { x: 50, y: 0, zoom: 0.5, width: 1600, height: 900 } }))
    ws.send(JSON.stringify({ type: 'cursor', x: 1300, y: 100 }))
    await expect
      .poll(async () => (await json(agent, 'get_focus', { canvas_id: canvas.id })).people[0]?.view)
      .toBeTruthy()
    const [person] = (await json(agent, 'get_focus', { canvas_id: canvas.id })).people
    expect(person).toMatchObject({
      name: 'Focus Owner',
      you: true,
      selectedFrame: null,
      view: { x: -100, y: 0, width: 3200, height: 1800, zoom: 0.5 },
      pointerFrame: { id: right.id, name: 'Right' },
    })
    expect(person.framesInView.map((f: { id: string }) => f.id).sort()).toEqual([left.id, right.id].sort())
    expect(person.framesInView.map((f: { id: string }) => f.id)).not.toContain(far.id)

    /* a selection is the focus, whatever fills the screen */
    ws.send(JSON.stringify({ type: 'editing', frameId: far.id }))
    await expect
      .poll(async () => (await json(agent, 'get_focus', { canvas_id: canvas.id })).people[0]?.focus?.id)
      .toBe(far.id)

    /* get_canvas carries the same */
    const read = await json(agent, 'get_canvas', { canvas_id: canvas.id })
    expect(read.people[0].selectedFrame).toEqual({ id: far.id, name: 'Far' })

    /* without a canvas: the canvases with people on them */
    const open = await json(agent, 'get_focus', {})
    expect(open.canvases.map((c: { id: string }) => c.id)).toContain(canvas.id)

    /* another account's agent learns nothing about this canvas */
    expect((await call(strangerAgent, 'get_focus', { canvas_id: canvas.id })).isError).toBe(true)
    const theirs = await json(strangerAgent, 'get_focus', {})
    expect(theirs.canvases.map((c: { id: string }) => c.id)).not.toContain(canvas.id)
  } finally {
    ws.close()
  }
})

it('ranks the frames in view by how much of the screen each fills', () => {
  const at = (id: string, x: number, width: number) =>
    ({ id, name: id, x, y: 0, width, height: 100, html: '', canvasId: 'c' }) as Frame
  const canvas = { id: 'c', name: 'c', frames: [at('small', 0, 100), at('big', 200, 2000)] } as unknown as Canvas
  const presence: Presence = {
    clientId: 'p',
    name: 'P',
    color: '#000',
    kind: 'user',
    viewport: { x: 0, y: 0, zoom: 1, width: 1000, height: 500 },
  }
  const focus = personFocus(canvas, presence)
  expect(focus.framesInView).toEqual([
    { id: 'big', name: 'big', visible: 0.4 },
    { id: 'small', name: 'small', visible: 1 },
  ])
  expect(focus.focus).toEqual({ id: 'big', name: 'big' })
})
