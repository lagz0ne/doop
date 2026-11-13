import { useState } from 'react'
import type { Frame } from '../../shared/types'
import { setFramesApproval, type ApprovalVerdict } from '../lib/frameApproval'
import { useStore } from '../lib/store'
import { getLocale, useT, type Translate } from '../lib/i18n'
import { useFrameSaves } from '../lib/frameSaves'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { CheckIcon, ClockIcon, MessageSquareIcon } from './ui/icons'
import { Switch } from './ui/switch'
import { Tooltip } from './ui/tooltip'

/** Who gave the verdict, and when; "previously" once the design changed since. */
function approvalLine(t: Translate, approval: NonNullable<Frame['approval']>): string {
  const vars = { name: approval.approvedBy, date: new Date(approval.approvedAt).toLocaleString(getLocale()) }
  if (approval.status === 'ready_for_dev') return t('stage.approvedByOn', vars)
  if (approval.status === 'changes_requested') return t('stage.changesRequestedByOn', vars)
  /* needs_review: the design changed since the last verdict, whichever it was */
  return approval.verdict === 'changes_requested'
    ? t('stage.changesRequestedEditedByOn', vars)
    : t('stage.previouslyApprovedByOn', vars)
}

export function FrameApprovalBadge({ frame, compact = false }: { frame: Frame; compact?: boolean }) {
  const t = useT()
  const approval = frame.approval
  if (!approval) return null
  const ready = approval.status === 'ready_for_dev'
  const sentBack = approval.status === 'changes_requested'
  const label = ready ? t('stage.readyForDev') : sentBack ? t('stage.changesRequested') : t('stage.needsReview')
  const Icon = ready ? CheckIcon : sentBack ? MessageSquareIcon : ClockIcon
  return (
    <Badge
      tone={ready ? 'success' : 'banned'}
      className="shrink-0"
      title={`${label} · ${approvalLine(t, approval)}`}
      aria-label={label}
    >
      <Icon className="size-3" aria-hidden />
      {!compact && label}
    </Badge>
  )
}

export function FrameApprovalControl({
  frame,
  hasUnsavedChanges = false,
}: {
  frame: Frame
  hasUnsavedChanges?: boolean
}) {
  const t = useT()
  const [saving, setSaving] = useState(false)
  const streaming = useStore((s) => !!s.streams[frame.id])
  const pendingSave = useFrameSaves((s) => !!s.pending[frame.id])
  const awaitingChanges = streaming || pendingSave || hasUnsavedChanges
  const ready = frame.approval?.status === 'ready_for_dev'
  const sentBack = frame.approval?.status === 'changes_requested'
  async function save(status: ApprovalVerdict) {
    setSaving(true)
    try {
      await setFramesApproval([frame], status)
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="flex flex-col gap-2">
      <Tooltip label={frame.approval ? approvalLine(t, frame.approval) : undefined} side="left">
        <label className="flex h-5 cursor-pointer items-center justify-between gap-2 text-label text-ink-faint">
          {t('stage.markAsApproved')}
          <Switch
            size="sm"
            className="data-[state=checked]:bg-success"
            aria-label={t('stage.markAsApproved')}
            aria-busy={saving}
            checked={ready}
            disabled={saving || (!ready && awaitingChanges)}
            onCheckedChange={(checked) => void save(checked ? 'ready_for_dev' : 'draft')}
          />
        </label>
      </Tooltip>
      {frame.approval && !ready && (
        <div>
          <FrameApprovalBadge frame={frame} />
        </div>
      )}
      <p className="text-caption text-ink-faint">
        {ready
          ? t('stage.approvalReady')
          : sentBack
            ? t('stage.approvalChangesRequested')
            : frame.approval?.verdict === 'changes_requested'
              ? t('stage.approvalRevised')
              : frame.approval
                ? t('stage.approvalChanged')
                : t('stage.approvalPrompt')}
      </p>
      {saving && (
        <p role="status" className="text-caption text-ink-faint">
          {t('stage.saving')}
        </p>
      )}
      {!ready && awaitingChanges && <p className="text-caption text-ink-faint">{t('stage.approvalWait')}</p>}
      {!sentBack && (
        <Button
          size="inline"
          variant="bare"
          className="self-start"
          disabled={saving || awaitingChanges}
          onClick={() => void save('changes_requested')}
        >
          {t('stage.requestChanges')}
        </Button>
      )}
      {frame.approval && !ready && (
        <Button
          size="inline"
          variant="bare"
          className="self-start"
          disabled={saving}
          onClick={() => void save('draft')}
        >
          {t('stage.moveToDraft')}
        </Button>
      )}
    </div>
  )
}
