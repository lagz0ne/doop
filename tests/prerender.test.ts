import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Frame } from '../shared/types'
import { createPrerender, quietFor, type PrerenderDeps } from '../server/prerender.ts'

const frame = (id: string, extra: Partial<Frame> = {}): Frame =>
  ({
    id,
    canvasId: 'c',
    name: id,
    x: 0,
    y: 0,
    width: 1280,
    height: 900,
    html: '<p>x</p>',
    updatedAt: 1,
    ...extra,
  }) as Frame

function setup(frames: Frame[], over: Partial<PrerenderDeps> = {}) {
  const byId = new Map(frames.map((f) => [f.id, f]))
  const drawn: string[] = []
  const deps: PrerenderDeps = {
    getFrame: (id) => byId.get(id),
    busy: () => false,
    isCurrent: () => Promise.resolve(false),
    draw: (f) => {
      drawn.push(f.id)
      return Promise.resolve()
    },
    skip: () => false,
    settleMs: 1000,
    ...over,
  }
  return { prerender: createPrerender(deps), drawn }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('prerender', () => {
  it('draws a frame once its changes have settled, once for a burst of them', async () => {
    const { prerender, drawn } = setup([frame('a')])
    for (let i = 0; i < 5; i++) {
      prerender.schedule('a')
      await vi.advanceTimersByTimeAsync(500)
    }
    expect(drawn).toEqual([])
    await vi.advanceTimersByTimeAsync(1000)
    await prerender.idle()
    expect(drawn).toEqual(['a'])
  })

  it('waits for a stream into the frame to end', async () => {
    let streaming = true
    const { prerender, drawn } = setup([frame('a')], { busy: () => streaming })
    prerender.schedule('a')
    await vi.advanceTimersByTimeAsync(5000)
    expect(drawn).toEqual([])
    streaming = false
    await vi.advanceTimersByTimeAsync(1000)
    await prerender.idle()
    expect(drawn).toEqual(['a'])
  })

  it('leaves out what has nothing to draw, is hidden, gone, or already current', async () => {
    const { prerender, drawn } = setup(
      [frame('current'), frame('hidden', { hidden: true }), frame('element'), frame('due')],
      {
        isCurrent: (f) => Promise.resolve(f.id === 'current'),
        skip: (f) => f.id === 'element',
      },
    )
    for (const id of ['current', 'hidden', 'element', 'gone', 'due']) prerender.schedule(id)
    await vi.advanceTimersByTimeAsync(1000)
    await prerender.idle()
    expect(drawn).toEqual(['due'])
  })

  it('draws one frame at a time, and again one that changed while it was drawn', async () => {
    const finish: Array<() => void> = []
    const order: string[] = []
    const { prerender } = setup([frame('a'), frame('b')], {
      draw: (f) => {
        order.push(f.id)
        return new Promise<void>((r) => finish.push(r))
      },
    })
    prerender.schedule('a')
    prerender.schedule('b')
    await vi.advanceTimersByTimeAsync(1000)
    expect(order).toEqual(['a'])
    /* a changes again while it is being drawn */
    prerender.schedule('a')
    finish.shift()!()
    await vi.advanceTimersByTimeAsync(0)
    expect(order).toEqual(['a', 'b'])
    await vi.advanceTimersByTimeAsync(1000)
    finish.shift()!()
    await vi.advanceTimersByTimeAsync(0)
    expect(order).toEqual(['a', 'b', 'a'])
    finish.shift()!()
    await prerender.idle()
    expect(prerender.pending()).toEqual({ settling: 0, due: 0, drawing: false })
  })

  it('keeps going after a failed render', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const drawn: string[] = []
    const { prerender } = setup([frame('bad'), frame('good')], {
      draw: (f) => {
        drawn.push(f.id)
        return f.id === 'bad' ? Promise.reject(new Error('boom')) : Promise.resolve()
      },
    })
    prerender.schedule('bad')
    prerender.schedule('good')
    await vi.advanceTimersByTimeAsync(1000)
    await prerender.idle()
    expect(drawn).toEqual(['bad', 'good'])
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })
})

describe('quietFor', () => {
  it('waits while interactive renders run or wait, then for the quiet spell after the last one', async () => {
    let clock = 10_000
    const state = { interactive: 1, interactiveQueued: 0, lastInteractiveAt: 9_000 }
    const slept: number[] = []
    const sleep = (ms: number) => {
      slept.push(ms)
      clock += ms
      /* the screenshot finishes during the first wait */
      if (slept.length === 1) Object.assign(state, { interactive: 0, lastInteractiveAt: clock })
      return Promise.resolve()
    }
    await quietFor(
      2000,
      () => state,
      () => clock,
      sleep,
    )
    expect(slept).toEqual([1000, 2000])
    expect(clock - state.lastInteractiveAt).toBeGreaterThanOrEqual(2000)
  })

  it('does not wait when nothing interactive has run lately', async () => {
    const sleep = vi.fn(() => Promise.resolve())
    await quietFor(
      2000,
      () => ({ interactive: 0, interactiveQueued: 0, lastInteractiveAt: 0 }),
      () => 50_000,
      sleep,
    )
    expect(sleep).not.toHaveBeenCalled()
  })
})
