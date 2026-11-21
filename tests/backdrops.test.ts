import { describe, expect, it } from 'vitest'
import { backdropIds, staticElementCount, type BackdropCandidate } from '../src/lib/backdrops'
import { computeLiveFrames, type FrameBox } from '../src/lib/liveFrames'

const panelHtml = (title: string) =>
  `<!doctype html><html><head><style>body{margin:0;background:var(--e-card)}</style></head>` +
  `<body><div style="padding:48px"><h2>${title}</h2><p>Actor, need, trigger.</p></div></body></html>`
const screenHtml = `<!doctype html><html><body>${'<div><span>row</span><button>Go</button></div>'.repeat(40)}</body></html>`

const panel = (id: string, x: number, y: number, width: number, height: number): BackdropCandidate => ({
  id,
  x,
  y,
  width,
  height,
  html: panelHtml(id),
})
const screen = (id: string, x: number, y: number): BackdropCandidate => ({
  id,
  x,
  y,
  width: 1440,
  height: 900,
  html: screenHtml,
})

describe('staticElementCount', () => {
  it('counts the elements outside head, style and script', () => {
    expect(staticElementCount(panelHtml('a'))).toBe(5)
  })
  it('is null for a document with something that moves', () => {
    expect(staticElementCount('<body><script>1</script></body>')).toBeNull()
    expect(staticElementCount('<style>@keyframes p{}</style><body></body>')).toBeNull()
    expect(staticElementCount('<body><video src="a.mp4"></video></body>')).toBeNull()
  })
})

describe('backdropIds', () => {
  it('finds nested panels behind screens', () => {
    const frames = [
      panel('journey', 0, 0, 10000, 5000),
      panel('group', 200, 400, 4000, 1500),
      screen('s1', 300, 500),
      screen('s2', 1900, 500),
    ]
    expect([...backdropIds(frames)].sort()).toEqual(['group', 'journey'])
  })
  it('leaves a screen with a frame dropped on it alone', () => {
    /* a real one: 5960x3028 with 728 elements, two screens laid over it */
    const busy = `<body>${'<div><span>row</span><button>Go</button></div>'.repeat(250)}</body>`
    const big = { ...screen('settings', 0, 0), width: 6000, height: 3000, html: busy }
    expect(backdropIds([big, screen('s1', 100, 100)]).size).toBe(0)
  })
  it('leaves a sparse panel that contains nothing alone', () => {
    expect(backdropIds([panel('header', 0, 0, 1600, 900), screen('s1', 0, 1000)]).size).toBe(0)
  })
  it('leaves a panel that moves, a small one and a turned one alone', () => {
    const moving = { ...panel('m', 0, 0, 4000, 2000), html: '<body><canvas></canvas></body>' }
    const small = panel('small', 0, 3000, 900, 900)
    const turned = { ...panel('t', 0, 5000, 4000, 2000), rotation: 10 }
    const frames = [
      moving,
      screen('a', 10, 10),
      small,
      { ...screen('b', 10, 3010), width: 400, height: 400 },
      turned,
      screen('c', 10, 5010),
    ]
    expect(backdropIds(frames).size).toBe(0)
  })
  it('does not count canvas elements (stickers, shapes) as content held', () => {
    const shape = { ...screen('shape', 100, 100), element: true }
    expect(backdropIds([panel('p', 0, 0, 4000, 2000), shape]).size).toBe(0)
  })
})

describe('computeLiveFrames with backdrops', () => {
  it('never makes a backdrop live by distance, only when pinned', () => {
    const frames: FrameBox[] = [
      { id: 'panel', x: 0, y: 0, width: 10000, height: 5000, backdrop: true },
      { id: 's1', x: 300, y: 500, width: 1440, height: 900 },
    ]
    const camera = { x: -100, y: -300, zoom: 0.6 }
    const stage = { width: 1600, height: 1000 }
    const live = computeLiveFrames(frames, camera, stage, new Set(), new Set())
    expect(live.has('panel')).toBe(false)
    expect(live.has('s1')).toBe(true)
    expect(computeLiveFrames(frames, camera, stage, new Set(['panel']), new Set()).has('panel')).toBe(true)
  })
})
