import { beforeEach, expect, it, vi } from 'vitest'

/* persistence is not under test: which writes count as a new picture is */
vi.mock('../server/db/persist.ts', () => ({
  saveCanvas: () => {},
  saveFrame: () => {},
  savePageCopy: () => Promise.resolve(),
  saveCanvasCopy: () => Promise.resolve(),
}))

const { store } = await import('../server/store.ts')

const changed: string[] = []
store.onDrawnChange((frameId) => changed.push(frameId))
let canvasId: string

beforeEach(() => {
  canvasId = store.createCanvas('drawn', 'kevin').id
  changed.length = 0
})

it('tells of a frame whose html or size changed, and not of a move, a rename or a restack', () => {
  const f = store.createFrame(canvasId, { name: 'a', html: '<p>a</p>' }, 'kevin')!
  expect(changed).toEqual([f.id])
  store.updateFrame(f.id, { x: 300, y: 40 }, 'kevin')
  store.updateFrame(f.id, { name: 'renamed', z: -1, locked: true }, 'kevin')
  store.updateFrame(f.id, { html: '<p>a</p>' }, 'kevin')
  expect(changed).toEqual([f.id])
  store.updateFrame(f.id, { html: '<p>b</p>' }, 'kevin')
  store.updateFrame(f.id, { width: 1000 }, 'kevin')
  expect(changed).toEqual([f.id, f.id, f.id])
})

it('does not tell of a new frame with nothing in it', () => {
  store.createFrame(canvasId, { name: 'empty' }, 'kevin')
  expect(changed).toEqual([])
})
