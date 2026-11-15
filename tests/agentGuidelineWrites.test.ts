import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client, startServer, type Server } from './harness.ts'

/* AGENT_GUIDELINE_WRITES=false: an agent's set_guidelines is refused over
   MCP, and a person still writes the guide through REST. */

let server: Server

beforeAll(async () => {
  server = await startServer({ AGENT_GUIDELINE_WRITES: 'false' })
}, 70_000)

afterAll(() => server?.stop())

async function mcpCall(secret: string, name: string, args: Record<string, unknown>) {
  const res = await fetch(`${server.base}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  })
  expect(res.status).toBe(200)
  const body = (await res.json()) as { result: { isError?: boolean; content: { text?: string }[] } }
  return { isError: !!body.result.isError, text: body.result.content.map((block) => block.text ?? '').join('\n') }
}

describe('AGENT_GUIDELINE_WRITES=false', () => {
  it('refuses an agent’s style guide and points to a comment', async () => {
    const owner = new Client(server)
    await owner.signUp('guides-owner@test.dev', 'Owner')
    const canvas = await (await owner.post('/api/canvases', { name: 'Guides' })).json()
    const key = (await (await owner.post('/api/agent-keys', { name: 'agent' })).json()).secret
    const result = await mcpCall(key, 'set_guidelines', {
      canvas_id: canvas.id,
      name: 'brand',
      markdown: '# Always do this',
      agent_name: 'Agent',
    })
    expect(result.isError).toBe(true)
    expect(result.text).toContain('AGENT_GUIDELINE_WRITES=false')
    expect(result.text).toContain('comment')
    const guides = await mcpCall(key, 'get_canvas', { canvas_id: canvas.id, agent_name: 'Agent' })
    expect(guides.text).not.toContain('Always do this')
  })
})
