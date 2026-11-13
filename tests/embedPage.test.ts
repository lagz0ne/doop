import express from 'express'
import { mkdtempSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/* The review panel's page (server/embedPage.ts): served only while a host app
   is configured, framable only by those hosts, never cached, and its raw file
   is not reachable without those rules. */

const hosts = vi.hoisted(() => ({ origins: [] as string[] }))
vi.mock('../server/embed.ts', () => ({ embedHostOrigins: () => hosts.origins }))

import { embedFrameAncestors, serveEmbedPage } from '../server/embedPage.ts'
import { readHostMessage } from '../src/embed/session.ts'

let base = ''
let close: () => void = () => {}
beforeAll(async () => {
  const dist = mkdtempSync(path.join(tmpdir(), 'doop-embed-page-'))
  writeFileSync(path.join(dist, 'embed.html'), '<!doctype html><title>Doop review</title>')
  const app = express()
  serveEmbedPage(app, dist)
  app.use(express.static(dist))
  const server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  close = () => server.close()
})
afterAll(() => close())

describe('the /embed page', () => {
  it('is not there while no host app is configured', async () => {
    hosts.origins = []
    expect((await fetch(`${base}/embed`)).status).toBe(404)
  })

  it('may be framed by the configured hosts only, and is not cached', async () => {
    hosts.origins = ['https://app.example.com', 'https://wiki.example.com']
    const res = await fetch(`${base}/embed`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-security-policy')).toBe(
      'frame-ancestors https://app.example.com https://wiki.example.com',
    )
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('referrer-policy')).toBe('no-referrer')
    expect(await res.text()).toContain('Doop review')
  })

  it('is not served under its file name, where those rules would not apply', async () => {
    hosts.origins = ['https://app.example.com']
    expect((await fetch(`${base}/embed.html`)).status).toBe(404)
  })

  it('writes one frame-ancestors directive', () => {
    expect(embedFrameAncestors(['https://a.example'])).toBe('frame-ancestors https://a.example')
  })
})

describe('messages from the host page', () => {
  const host = 'https://app.example.com'
  it('reads a fresh token or a frame to open from the host origin', () => {
    expect(readHostMessage({ origin: host, data: { type: 'doop:token', token: 'abc' } }, host)).toEqual({
      type: 'doop:token',
      token: 'abc',
    })
    expect(readHostMessage({ origin: host, data: { type: 'doop:open', frameId: 'AngBH82LGm' } }, host)).toEqual({
      type: 'doop:open',
      frameId: 'AngBH82LGm',
    })
  })

  it('ignores every other window, and anything malformed', () => {
    expect(readHostMessage({ origin: 'https://evil.example', data: { type: 'doop:token', token: 'x' } }, host)).toBe(
      null,
    )
    expect(readHostMessage({ origin: host, data: { type: 'doop:open', frameId: '../x' } }, host)).toBe(null)
    expect(readHostMessage({ origin: host, data: { type: 'doop:token', token: 42 } }, host)).toBe(null)
    expect(readHostMessage({ origin: host, data: 'doop:token' }, host)).toBe(null)
    expect(readHostMessage({ origin: host, data: { type: 'doop:verdict' } }, host)).toBe(null)
  })
})
