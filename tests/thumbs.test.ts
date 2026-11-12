import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Frame } from '../shared/types'

/* Deferred renders so tests control when Chromium "finishes" */
const mocks = vi.hoisted(() => ({
  renderFrame: vi.fn(),
  putObject: vi.fn(),
  getObject: vi.fn(),
  deleteObject: vi.fn(),
}))

vi.mock('../server/screenshot.ts', () => ({ renderFrame: mocks.renderFrame }))
vi.mock('../server/storage.ts', () => ({
  putObject: mocks.putObject,
  getObject: mocks.getObject,
  deleteObject: mocks.deleteObject,
}))

import * as thumbs from '../server/thumbs.ts'

const frame = (id: string): Frame =>
  ({
    id,
    canvasId: 'c',
    name: id,
    x: 0,
    y: 0,
    width: 1280,
    height: 900,
    html: '',
    updatedAt: 1,
    updatedBy: 't',
  }) as Frame

function deferredRenders() {
  const resolvers: Array<(b: Buffer) => void> = []
  mocks.renderFrame.mockImplementation(() => new Promise<Buffer>((r) => resolvers.push(r)))
  return resolvers
}

const tick = () => new Promise((r) => setTimeout(r, 25))

beforeEach(() => {
  mocks.renderFrame.mockReset()
  mocks.putObject.mockReset().mockResolvedValue(undefined)
  mocks.getObject.mockReset().mockResolvedValue(null)
  mocks.deleteObject.mockReset().mockResolvedValue(undefined)
})

describe('thumbs', () => {
  it('bounds concurrent renders globally — breadth across frames cannot fan out unbounded', async () => {
    const resolvers = deferredRenders()
    const all = Array.from({ length: 10 }, (_, i) => thumbs.create(frame(`cap-${i}`)))
    await tick()
    expect(mocks.renderFrame).toHaveBeenCalledTimes(3)

    /* finishing one admits exactly one waiter — never a burst */
    resolvers[0]!(Buffer.from('x'))
    await tick()
    expect(mocks.renderFrame).toHaveBeenCalledTimes(4)

    for (let i = 1; i < 10; i++) {
      resolvers[i]?.(Buffer.from('x'))
      await tick()
    }
    await Promise.all(all)
    expect(mocks.renderFrame).toHaveBeenCalledTimes(10)
  })

  it('does not persist a thumb for a frame purged mid-render', async () => {
    const resolvers = deferredRenders()
    const p = thumbs.create(frame('purged-mid-render'))
    await tick()
    thumbs.purge('purged-mid-render')
    resolvers[0]!(Buffer.from('late'))
    await p
    await tick()
    expect(mocks.putObject).not.toHaveBeenCalled()
  })

  it('deletes its own write when purge lands during the put', async () => {
    const resolvers = deferredRenders()
    let finishPut!: () => void
    mocks.putObject.mockImplementation(() => new Promise<void>((r) => (finishPut = r)))
    const p = thumbs.create(frame('purged-during-put'))
    await tick()
    resolvers[0]!(Buffer.from('x'))
    await tick() /* now inside putObject */
    thumbs.purge('purged-during-put')
    finishPut()
    await p
    await tick()
    expect(mocks.deleteObject).toHaveBeenCalledWith('thumb/purged-during-put.jpg')
  })

  it('getStored serves stored bytes and refreshes stale ones in the background, deduped', async () => {
    deferredRenders()
    mocks.getObject.mockResolvedValue(Buffer.from('stale'))
    const f = frame('stale-frame')
    const [a, b] = await Promise.all([thumbs.getStored(f), thumbs.getStored(f)])
    expect(a?.buf.toString()).toBe('stale')
    expect(b?.buf.toString()).toBe('stale')
    expect(a?.fresh).toBe(false)
    await tick()
    /* one background refresh, not one per request (dedupe + throttle) */
    expect(mocks.renderFrame).toHaveBeenCalledTimes(1)
  })

  it('stores the version beside the thumbnail', async () => {
    mocks.renderFrame.mockResolvedValue(Buffer.from('jpg'))
    await thumbs.create(frame('versioned'))
    expect(mocks.putObject).toHaveBeenCalledWith('thumb/versioned.jpg', Buffer.from('jpg'), 'image/jpeg')
    expect(mocks.putObject).toHaveBeenCalledWith('thumb/versioned.ver', Buffer.from('1'), 'text/plain')
  })

  it('knows a stored thumbnail is current after a restart, and does not render it again', async () => {
    /* nothing in memory for this frame: only storage knows its version */
    mocks.getObject.mockImplementation((key: string) =>
      Promise.resolve(Buffer.from(key.endsWith('.ver') ? '1' : 'kept')),
    )
    const stored = await thumbs.getStored(frame('after-restart'))
    expect(stored).toEqual({ buf: Buffer.from('kept'), fresh: true, known: true })
    await tick()
    expect(mocks.renderFrame).not.toHaveBeenCalled()
  })

  it('re-renders a stored thumbnail whose version is behind the frame', async () => {
    deferredRenders()
    mocks.getObject.mockImplementation((key: string) =>
      Promise.resolve(Buffer.from(key.endsWith('.ver') ? '0' : 'old')),
    )
    const stored = await thumbs.getStored(frame('behind'))
    expect(stored).toEqual({ buf: Buffer.from('old'), fresh: false, known: true })
    await tick()
    expect(mocks.renderFrame).toHaveBeenCalledTimes(1)
  })

  /* the editor's preview pyramid: one stored picture per level, beside the
     card thumbnail and independent of it */
  it('renders a pyramid level as the whole frame at that scale, in webp, under its own key', async () => {
    mocks.renderFrame.mockResolvedValue(Buffer.from('webp'))
    await thumbs.create(frame('level'), 0.5)
    expect(mocks.renderFrame).toHaveBeenCalledWith(expect.anything(), 0.5, { type: 'webp', quality: 90 })
    expect(mocks.putObject).toHaveBeenCalledWith('thumb/level.p50', Buffer.from('webp'), 'image/webp')
    expect(mocks.putObject).toHaveBeenCalledWith('thumb/level.p50ver', Buffer.from('1'), 'text/plain')
  })

  it('renders a huge frame below the level it was asked at, within the picture limits', async () => {
    mocks.renderFrame.mockResolvedValue(Buffer.from('webp'))
    await thumbs.create({ ...frame('strip'), width: 40_000, height: 400 }, 1)
    const scale = mocks.renderFrame.mock.calls[0]![1] as number
    expect(scale).toBeCloseTo(0.4) // 16000 px on the long side
  })

  it('keeps each level and the card thumbnail apart: one being current says nothing of another', async () => {
    mocks.renderFrame.mockResolvedValue(Buffer.from('new'))
    const f = frame('apart')
    await thumbs.create(f, 0.25)
    mocks.renderFrame.mockClear()
    mocks.getObject.mockImplementation((key: string) => Promise.resolve(key.endsWith('ver') ? null : Buffer.from('b')))
    expect((await thumbs.getStored(f, 0.25))?.fresh).toBe(true)
    expect((await thumbs.getStored(f, 1))?.fresh).toBe(false)
    expect((await thumbs.getStored(f))?.fresh).toBe(false)
    await tick()
    /* the two that were not current are refreshed, each as itself */
    expect(mocks.renderFrame).toHaveBeenCalledTimes(2)
    expect(mocks.renderFrame).toHaveBeenCalledWith(expect.anything(), 1, { type: 'webp', quality: 90 })
    expect(mocks.renderFrame).toHaveBeenCalledWith(expect.anything(), 0.5, expect.objectContaining({ type: 'jpeg' }))
  })

  it('purges every level with the frame', () => {
    thumbs.purge('gone')
    const deleted = mocks.deleteObject.mock.calls.map((c) => c[0] as string).sort()
    expect(deleted).toEqual(
      [
        'thumb/gone.jpg',
        'thumb/gone.ver',
        ...[25, 50, 100].flatMap((p) => [`thumb/gone.p${p}`, `thumb/gone.p${p}ver`]),
      ].sort(),
    )
  })
})
