// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import {
  GPU_KEY,
  ZOOM_PICTURES_KEY,
  readRendererSetting,
  rendererState,
  settingApplied,
  writeRendererSetting,
} from '../src/lib/rendererSetting'
import type { TrialDecision } from '../src/lib/renderTrialClient'

/**
 * The renderer a person picks (Settings → Appearance, the renderer label) is
 * the switches the renderer reads, `doop:gpu` and `doop:zoom-pictures`, unset
 * for Auto; the label says what this page load draws with and why.
 */

afterEach(() => localStorage.clear())

const trial = (over: Partial<TrialDecision> = {}): TrialDecision => ({
  active: true,
  gpu: { level: 'on', reason: 'explore', mode: 'on' },
  zoomPictures: { level: 'off', reason: 'exploit' },
  ...over,
})

describe('readRendererSetting / writeRendererSetting', () => {
  it('is Auto with no keys, and Auto removes them', () => {
    expect(readRendererSetting()).toEqual({ gpu: 'auto', zoomPictures: 'auto' })
    localStorage.setItem(GPU_KEY, 'on')
    localStorage.setItem(ZOOM_PICTURES_KEY, 'off')
    expect(writeRendererSetting({ gpu: 'auto', zoomPictures: 'auto' })).toBe(true)
    expect(localStorage.getItem(GPU_KEY)).toBeNull()
    expect(localStorage.getItem(ZOOM_PICTURES_KEY)).toBeNull()
  })

  it('writes the values the renderer reads', () => {
    writeRendererSetting({ gpu: 'force', zoomPictures: 'on' })
    expect(localStorage.getItem(GPU_KEY)).toBe('force')
    expect(localStorage.getItem(ZOOM_PICTURES_KEY)).toBe('on')
    expect(readRendererSetting()).toEqual({ gpu: 'force', zoomPictures: 'on' })
  })

  it('reads a hand-set key as the renderer does: anything else is off', () => {
    localStorage.setItem(GPU_KEY, 'yes')
    localStorage.setItem(ZOOM_PICTURES_KEY, '1')
    expect(readRendererSetting()).toEqual({ gpu: 'off', zoomPictures: 'off' })
  })
})

describe('settingApplied', () => {
  it('Auto matches any level the trial gave, a pick only the same override', () => {
    expect(settingApplied({ gpu: 'auto', zoomPictures: 'auto' }, trial())).toBe(true)
    expect(settingApplied({ gpu: 'on', zoomPictures: 'auto' }, trial())).toBe(false)
    const set = trial({ gpu: { level: 'on', reason: 'override', mode: 'force' } })
    expect(settingApplied({ gpu: 'force', zoomPictures: 'auto' }, set)).toBe(true)
    expect(settingApplied({ gpu: 'on', zoomPictures: 'auto' }, set)).toBe(false)
    expect(settingApplied({ gpu: 'auto', zoomPictures: 'auto' }, set)).toBe(false)
    const zoomSet = trial({ zoomPictures: { level: 'off', reason: 'override' } })
    expect(settingApplied({ gpu: 'auto', zoomPictures: 'off' }, zoomSet)).toBe(true)
    expect(settingApplied({ gpu: 'auto', zoomPictures: 'on' }, zoomSet)).toBe(false)
  })
})

describe('rendererState', () => {
  it('names the GPU layer and where each level came from', () => {
    expect(rendererState(trial(), { culling: true, gpuFailed: false })).toMatchObject({
      gpu: true,
      gpuFailed: false,
      zoomPictures: false,
      gpuSource: 'trial',
      zoomSource: 'trial',
      auto: true,
    })
  })

  it('shows a GPU layer that did not start as failed, not as drawing', () => {
    const set = trial({ gpu: { level: 'on', reason: 'override', mode: 'on' } })
    expect(rendererState(set, { culling: true, gpuFailed: true })).toMatchObject({
      gpu: false,
      gpuFailed: true,
      gpuSource: 'set',
    })
  })

  it('with culling off every frame is live, and there is no GPU layer', () => {
    expect(rendererState(trial(), { culling: false, gpuFailed: false })).toMatchObject({
      gpu: false,
      gpuFailed: false,
      allLive: true,
    })
  })

  it('an untrialed load is fixed, an ineligible one unavailable', () => {
    const untrialed = trial({
      active: false,
      gpu: { level: 'off', reason: 'ineligible', mode: 'off' },
      zoomPictures: { level: 'off', reason: 'off' },
    })
    expect(rendererState(untrialed, { culling: true, gpuFailed: false })).toMatchObject({
      gpu: false,
      gpuSource: 'unavailable',
      zoomSource: 'fixed',
      auto: false,
    })
  })
})
