/**
 * The render trial's vocabulary, shared by the browser that measures
 * (src/lib/renderTrial.ts) and the server that forwards its reports to an
 * OpenTelemetry collector (server/telemetry.ts). The report's schema is in
 * renderTrialSchema.ts, apart, so the editor's bundle does not carry zod.
 *
 */

export const TRIAL_FACTORS = ['gpu', 'zoomPictures'] as const
export type TrialFactor = (typeof TRIAL_FACTORS)[number]

export const TRIAL_LEVELS = ['off', 'on'] as const
export type TrialLevel = (typeof TRIAL_LEVELS)[number]

/** Why a factor has the level it has on this page load:
 *  explore - the trial is still sampling both levels;
 *  exploit - the trial has a winner and uses it;
 *  epsilon - the trial has a winner and took the other level this once;
 *  override - an explicit localStorage key set it;
 *  ineligible - this browser cannot have it on (no hardware WebGL2, or the layer failed);
 *  off - the trial is switched off, or its storage is unusable. */
export const TRIAL_REASONS = ['explore', 'exploit', 'epsilon', 'override', 'ineligible', 'off'] as const
export type TrialReason = (typeof TRIAL_REASONS)[number]

export const GESTURE_KINDS = ['pan', 'zoom'] as const
export type GestureKind = (typeof GESTURE_KINDS)[number]

/** heavy: at least HEAVY_CULLED culled frames (shells or pictures) were in
 *  view when the gesture started; light: fewer. */
export const STRATA = ['light', 'heavy'] as const
export type Stratum = (typeof STRATA)[number]

export const FRAME_BUCKETS = ['<20', '20-49', '50-99', '100-199', '200+'] as const
export type FrameBucket = (typeof FRAME_BUCKETS)[number]

export function frameBucket(frames: number): FrameBucket {
  if (frames < 20) return '<20'
  if (frames < 50) return '20-49'
  if (frames < 100) return '50-99'
  if (frames < 200) return '100-199'
  return '200+'
}

/** The 2x2 cell: A neither experiment, B the GPU layer, C both, D zoom pictures only. */
export type TrialArm = 'A' | 'B' | 'C' | 'D'
export function armOf(gpu: TrialLevel, zoomPictures: TrialLevel): TrialArm {
  if (gpu === 'on') return zoomPictures === 'on' ? 'C' : 'B'
  return zoomPictures === 'on' ? 'D' : 'A'
}

export const RENDER_REPORT_VERSION = 1
/** The body limit of the telemetry route; a full report is about 2 KB. */
export const RENDER_REPORT_MAX_BYTES = 8 * 1024
export const RENDERER_MAX_CHARS = 80
