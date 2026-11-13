import { expect, it } from 'vitest'
import { priorVerdicts } from '../server/actions.ts'
import type { FrameApproval } from '../shared/types.ts'

/* An approval stored before verdicts were kept has no history: its one
   recorded verdict becomes the first entry, with no reviewed version. */

const legacy: FrameApproval = {
  status: 'needs_review',
  approvedBy: 'Reviewer',
  approvedByUserId: 'u1',
  approvedAt: 100,
  approvedFrameUpdatedAt: 90,
}

it('starts a history from an approval that predates it', () => {
  expect(priorVerdicts(legacy)).toEqual([
    { status: 'ready_for_dev', by: 'Reviewer', byUserId: 'u1', at: 100, frameUpdatedAt: 90 },
  ])
  expect(priorVerdicts({ ...legacy, verdict: 'changes_requested' })[0]!.status).toBe('changes_requested')
})

it('keeps a stored history as it is, and has none for a draft', () => {
  const history = [
    { status: 'ready_for_dev' as const, by: 'R', byUserId: 'u', at: 1, frameUpdatedAt: 1, versionId: 'v' },
  ]
  expect(priorVerdicts({ ...legacy, history })).toBe(history)
  expect(priorVerdicts(null)).toEqual([])
  expect(priorVerdicts(undefined)).toEqual([])
})
