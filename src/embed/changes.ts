import type { ApprovalHistoryEntry, Frame } from '../../shared/types'

/* What the compare view needs to know about two states of a frame. */

/** The frame's last verdict, if any: the state the reviewer decided on is
 *  this entry's version (filed when the verdict was given, server/actions.ts).
 *  Approvals from before verdict history have no entries. */
export function lastVerdict(frame: Frame): ApprovalHistoryEntry | null {
  return frame.approval?.history?.at(-1) ?? null
}

/** Is there a decided state to compare the frame with: a verdict with its
 *  version, and a design change since? Only a design change turns a verdict
 *  into needs_review (server/store.ts); updatedAt is no guide, since giving
 *  the verdict itself writes the frame. */
export function canCompare(frame: Frame): boolean {
  return !!lastVerdict(frame)?.versionId && frame.approval?.status === 'needs_review'
}

/** The text a person reads in a document, one run per text node, in order. */
export function textRuns(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  for (const el of doc.querySelectorAll('script,style,template,noscript')) el.remove()
  const runs: string[] = []
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (text) runs.push(text)
  }
  return runs
}

export interface TextChange {
  removed: string[]
  added: string[]
}

/** The runs that differ between two documents, grouped where they replace one
 *  another: a longest-common-subsequence walk, so a line edited in place reads
 *  as "this became that" rather than as a list of everything after it. */
export function textChanges(before: readonly string[], after: readonly string[]): TextChange[] {
  const n = before.length
  const m = after.length
  /* frames are a screen of text; past this the table is not worth its memory */
  if (n * m > 4_000_000) return [{ removed: [...before], added: [...after] }]
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i]![j] = before[i] === after[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
  const changes: TextChange[] = []
  let open: TextChange | null = null
  let i = 0
  let j = 0
  const flush = () => {
    if (open) changes.push(open)
    open = null
  }
  while (i < n || j < m) {
    if (i < n && j < m && before[i] === after[j]) {
      flush()
      i++
      j++
    } else if (j < m && (i === n || lcs[i]![j + 1]! >= lcs[i + 1]![j]!)) {
      ;(open ??= { removed: [], added: [] }).added.push(after[j++]!)
    } else {
      ;(open ??= { removed: [], added: [] }).removed.push(before[i++]!)
    }
  }
  flush()
  return changes
}
