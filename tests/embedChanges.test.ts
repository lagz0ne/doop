// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { canCompare, lastVerdict, textChanges, textRuns } from '../src/embed/changes.ts'
import type { Frame } from '../shared/types.ts'

/* The review panel's compare view: which state the last verdict was given on,
   and what text changed since. */

describe('textRuns', () => {
  it('reads the text a person sees, in order, without styles or scripts', () => {
    const html =
      '<html><head><style>p{color:red}</style></head><body><h1>Invite</h1><p>Link works\n 7 days</p>' +
      '<script>var x = "no"</script><button>Open</button></body></html>'
    expect(textRuns(html)).toEqual(['Invite', 'Link works 7 days', 'Open'])
  })
})

describe('textChanges', () => {
  it('pairs a line edited in place as one change', () => {
    expect(
      textChanges(
        ['Viet invited you', 'Link works 7 days', 'Open'],
        ['Viet invited you', 'Link expires Wed 19 Nov', 'Open'],
      ),
    ).toEqual([{ removed: ['Link works 7 days'], added: ['Link expires Wed 19 Nov'] }])
  })

  it('reports runs added and removed on their own', () => {
    expect(textChanges(['a', 'b'], ['a', 'b', 'c'])).toEqual([{ removed: [], added: ['c'] }])
    expect(textChanges(['a', 'b', 'c'], ['a', 'c'])).toEqual([{ removed: ['b'], added: [] }])
  })

  it('finds nothing when only layout or style changed', () => {
    expect(textChanges(textRuns('<p style="color:red">Hi</p>'), textRuns('<p style="color:blue">Hi</p>'))).toEqual([])
  })
})

describe('what to compare against', () => {
  const frame = (approval: Frame['approval'], updatedAt: number) => ({ id: 'f', updatedAt, approval }) as Frame
  const entry = {
    status: 'changes_requested' as const,
    by: 'Ada',
    byUserId: 'u',
    at: 1,
    frameUpdatedAt: 10,
    versionId: 'v1',
  }
  const approval = {
    status: 'needs_review' as const,
    approvedBy: 'Ada',
    approvedByUserId: 'u',
    approvedAt: 1,
    approvedFrameUpdatedAt: 10,
    verdict: 'changes_requested' as const,
    history: [entry],
  }

  it('is the version filed with the last verdict, once the design changed after it', () => {
    expect(lastVerdict(frame(approval, 12))).toEqual(entry)
    expect(canCompare(frame(approval, 12))).toBe(true)
  })

  it('is nothing before a design change (the verdict itself writes the frame), without a filed version, or without a verdict', () => {
    expect(canCompare(frame({ ...approval, status: 'changes_requested' }, 11))).toBe(false)
    expect(canCompare(frame({ ...approval, history: [{ ...entry, versionId: undefined }] }, 12))).toBe(false)
    expect(canCompare(frame(null, 12))).toBe(false)
    expect(lastVerdict(frame(null, 12))).toBe(null)
  })
})
