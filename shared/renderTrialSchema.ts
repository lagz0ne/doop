import { z } from 'zod'
import {
  FRAME_BUCKETS,
  GESTURE_KINDS,
  RENDERER_MAX_CHARS,
  RENDER_REPORT_VERSION,
  STRATA,
  TRIAL_LEVELS,
  TRIAL_REASONS,
} from './renderTrial.ts'

/**
 * The render trial's report: what one browser measured while the camera
 * moved, and which of the two render experiments it had on. The browser
 * builds it (src/lib/renderTrial.ts), the server validates it here and
 * forwards it (server/telemetry.ts). The browser imports only the types.
 *
 * Nothing in it names a person, a canvas or a frame: the trial needs the arm,
 * the device class and the frame timings, and nothing else leaves the
 * browser. Counts in `rows` cover only the time since the previous report of
 * the same page load, so summing rows across reports never counts a frame
 * twice.
 */

const count = z.number().int().min(0).max(10_000_000)
const ms = z.number().finite().min(0).max(1000)
const share = z.number().finite().min(0).max(1)
const level = z.enum(TRIAL_LEVELS)

const factor = z.object({ level, reason: z.enum(TRIAL_REASONS) }).strict()

const row = z
  .object({
    kind: z.enum(GESTURE_KINDS),
    stratum: z.enum(STRATA),
    /* a live document was in view when the gesture started */
    live: z.boolean(),
    gestures: count,
    frames: count,
    slow: count,
    mean: ms,
    p95: ms,
  })
  .strict()
  .refine((r) => r.slow <= r.frames, { message: 'more slow frames than frames' })

/** The trial's current leaning for one factor in this browser; winner null
 *  while it is still exploring. Shares are null while a level has no frames. */
const verdict = z
  .object({
    winner: level.nullable(),
    onShare: share.nullable(),
    offShare: share.nullable(),
    onFrames: count,
    offFrames: count,
    onLoads: count,
    offLoads: count,
  })
  .strict()

const environment = z
  .object({
    /* the unmasked WebGL renderer, truncated; printable ASCII only, so a log
       line never carries control characters */
    renderer: z
      .string()
      .max(RENDERER_MAX_CHARS)
      .regex(/^[\x20-\x7e]*$/),
    /* hardware WebGL2 without a major performance caveat; null = not probed */
    hardware: z.boolean().nullable(),
    dpr: z.number().finite().min(0.1).max(10),
    /* the window, rounded to 100 px */
    width: z.number().int().min(0).max(20_000),
    height: z.number().int().min(0).max(20_000),
    cores: z.number().int().min(1).max(1024).nullable(),
    memory: z.number().finite().min(0).max(1024).nullable(),
    /* the estimated display refresh interval, ms */
    display: z.number().finite().min(1).max(100),
    touch: z.boolean(),
    frames: z.enum(FRAME_BUCKETS),
  })
  .strict()

export const renderReportSchema = z
  .object({
    v: z.literal(RENDER_REPORT_VERSION),
    epoch: z.number().int().min(0).max(1_000_000),
    gpu: factor,
    zoomPictures: factor,
    env: environment,
    rows: z
      .array(row)
      .min(1)
      .max(GESTURE_KINDS.length * STRATA.length * 2),
    verdicts: z.object({ gpu: verdict, zoomPictures: verdict }).strict(),
  })
  .strict()

export type RenderReport = z.infer<typeof renderReportSchema>
export type RenderReportRow = RenderReport['rows'][number]
export type RenderVerdict = RenderReport['verdicts']['gpu']
export type RenderEnvironment = RenderReport['env']
