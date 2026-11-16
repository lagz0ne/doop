import type { TrialReason } from '../../shared/renderTrial'
import type { GpuMode, TrialDecision } from './renderTrialClient'

/* The canvas renderer this browser asks for, as a person picks it (Settings →
   Appearance, or the renderer label beside the zoom pill), and what the
   label says this page load is drawing with.

   The picks are the switches the renderer has always read, so a hand-set key
   and a pick are the same thing: `doop:gpu` (on, force, off) and
   `doop:zoom-pictures` (on, off), each removed for Auto, where the render
   trial decides per page load (renderTrialClient.ts). Both are read once per
   page load, at the first canvas, so a pick made after a canvas opened takes
   effect at the next load. */

export const GPU_KEY = 'doop:gpu'
export const ZOOM_PICTURES_KEY = 'doop:zoom-pictures'

export type GpuSetting = 'auto' | GpuMode
export type ZoomPicturesSetting = 'auto' | 'on' | 'off'

export interface RendererSetting {
  gpu: GpuSetting
  zoomPictures: ZoomPicturesSetting
}

export const GPU_SETTINGS: readonly GpuSetting[] = ['auto', 'on', 'off', 'force']
export const ZOOM_PICTURES_SETTINGS: readonly ZoomPicturesSetting[] = ['auto', 'on', 'off']

export function isGpuSetting(value: string): value is GpuSetting {
  return (GPU_SETTINGS as readonly string[]).includes(value)
}

export function isZoomPicturesSetting(value: string): value is ZoomPicturesSetting {
  return (ZOOM_PICTURES_SETTINGS as readonly string[]).includes(value)
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/** What this browser asks for, read the way the renderer reads the keys:
 *  any value other than on (or force) is off. */
export function readRendererSetting(): RendererSetting {
  const gpu = read(GPU_KEY)
  const zoom = read(ZOOM_PICTURES_KEY)
  return {
    gpu: gpu === null ? 'auto' : gpu === 'on' || gpu === 'force' ? gpu : 'off',
    zoomPictures: zoom === null ? 'auto' : zoom === 'on' ? 'on' : 'off',
  }
}

/** Keeps a pick for the next page load; false when storage refused it. */
export function writeRendererSetting(next: RendererSetting): boolean {
  try {
    if (next.gpu === 'auto') localStorage.removeItem(GPU_KEY)
    else localStorage.setItem(GPU_KEY, next.gpu)
    if (next.zoomPictures === 'auto') localStorage.removeItem(ZOOM_PICTURES_KEY)
    else localStorage.setItem(ZOOM_PICTURES_KEY, next.zoomPictures)
    return true
  } catch {
    return false
  }
}

/** True when this page load already draws with what `setting` asks for, so
 *  no reload is needed: Auto is any level the trial (or its absence) gave, a
 *  pick is the same level set by hand. */
export function settingApplied(setting: RendererSetting, decision: TrialDecision): boolean {
  const gpuOk =
    setting.gpu === 'auto'
      ? decision.gpu.reason !== 'override'
      : decision.gpu.reason === 'override' && decision.gpu.mode === setting.gpu
  const zoomOk =
    setting.zoomPictures === 'auto'
      ? decision.zoomPictures.reason !== 'override'
      : decision.zoomPictures.reason === 'override' && decision.zoomPictures.level === setting.zoomPictures
  return gpuOk && zoomOk
}

/** Why a factor is what it is, as the label words it. */
export type RendererSource = 'trial' | 'set' | 'unavailable' | 'fixed'

export function sourceOf(reason: TrialReason): RendererSource {
  switch (reason) {
    case 'explore':
    case 'exploit':
    case 'epsilon':
      return 'trial'
    case 'override':
      return 'set'
    case 'ineligible':
      return 'unavailable'
    case 'off':
      return 'fixed'
  }
}

/** What the label shows for this page load. */
export interface RendererState {
  /** the GPU layer draws the culled frames; else they are DOM shells */
  gpu: boolean
  /** the GPU layer was asked for and did not start, or lost its context */
  gpuFailed: boolean
  /** culling is off (`doop:cull`): every frame is a live document */
  allLive: boolean
  zoomPictures: boolean
  gpuSource: RendererSource
  zoomSource: RendererSource
  /** the trial picked at least one of the two on this load */
  auto: boolean
}

export function rendererState(
  decision: TrialDecision,
  { culling, gpuFailed }: { culling: boolean; gpuFailed: boolean },
): RendererState {
  const asked = decision.gpu.mode !== 'off'
  const gpuSource = sourceOf(decision.gpu.reason)
  const zoomSource = sourceOf(decision.zoomPictures.reason)
  return {
    gpu: asked && culling && !gpuFailed,
    gpuFailed: asked && culling && gpuFailed,
    allLive: !culling,
    zoomPictures: decision.zoomPictures.level === 'on',
    gpuSource,
    zoomSource,
    auto: gpuSource === 'trial' || zoomSource === 'trial',
  }
}
