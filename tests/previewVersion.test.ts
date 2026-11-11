import { beforeEach, expect, it, vi } from 'vitest'
import type { Frame } from '../shared/types.ts'

/* What GET /i/<id>.jpg?preview&v=<version> answers with: the editor's culled
   frames ask for the frame's current version and keep showing it until the
   next edit, so a thumbnail on record as older must not be that answer. */

const mocks = vi.hoisted(() => ({ getStored: vi.fn(), create: vi.fn() }))
vi.mock('../server/thumbs.ts', () => ({ getStored: mocks.getStored, create: mocks.create }))
vi.mock('../server/screenshot.ts', () => ({ renderFrame: vi.fn() }))

import { getImage, type ImageRequest } from '../server/previews.ts'

let n = 0
const frame = (updatedAt: number): Frame =>
  ({
    id: `pv-${++n}`,
    canvasId: 'c',
    name: 'f',
    x: 0,
    y: 0,
    width: 1280,
    height: 900,
    html: '<p>x</p>',
    updatedAt,
  }) as Frame
const request = (version?: number): ImageRequest => ({
  ext: 'jpg',
  scale: 1,
  quality: 90,
  preview: true,
  ...(version === undefined ? null : { version }),
  ip: `ip-${n}`,
  isAuthenticated: () => Promise.resolve(false),
})

beforeEach(() => {
  mocks.getStored.mockReset()
  mocks.create.mockReset().mockResolvedValue(Buffer.from('rendered'))
})

it('serves a current thumbnail as it is', async () => {
  mocks.getStored.mockResolvedValue({ buf: Buffer.from('stored'), fresh: true, known: true })
  expect(await getImage(frame(7), request(7))).toEqual({ status: 'ok', buf: Buffer.from('stored'), fresh: true })
  expect(mocks.create).not.toHaveBeenCalled()
})

it('renders before answering a request for the current version when the thumbnail is known to be older', async () => {
  mocks.getStored.mockResolvedValue({ buf: Buffer.from('old'), fresh: false, known: true })
  expect(await getImage(frame(7), request(7))).toEqual({ status: 'ok', buf: Buffer.from('rendered'), fresh: true })
  expect(mocks.create).toHaveBeenCalledTimes(1)
})

it('serves the old thumbnail to a request that names no version, or another one', async () => {
  mocks.getStored.mockResolvedValue({ buf: Buffer.from('old'), fresh: false, known: true })
  expect(await getImage(frame(7), request())).toEqual({ status: 'ok', buf: Buffer.from('old'), fresh: false })
  expect(await getImage(frame(7), request(6))).toEqual({ status: 'ok', buf: Buffer.from('old'), fresh: false })
  expect(mocks.create).not.toHaveBeenCalled()
})

it('serves a thumbnail of unknown age at once (stored before versions were recorded)', async () => {
  mocks.getStored.mockResolvedValue({ buf: Buffer.from('legacy'), fresh: false, known: false })
  expect(await getImage(frame(7), request(7))).toEqual({ status: 'ok', buf: Buffer.from('legacy'), fresh: false })
  expect(mocks.create).not.toHaveBeenCalled()
})
