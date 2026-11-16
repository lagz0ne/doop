import { useState } from 'react'
import { useStore } from '../lib/store'
import { decidedRenderTrial } from '../lib/renderTrialClient'
import {
  isGpuSetting,
  isZoomPicturesSetting,
  readRendererSetting,
  settingApplied,
  writeRendererSetting,
  type GpuSetting,
  type RendererSetting,
  type ZoomPicturesSetting,
} from '../lib/rendererSetting'
import { useT, type PlainMessageKey } from '../lib/i18n'
import { Button } from './ui/button'
import { Note } from './ui/note'
import { Switch } from './ui/switch'
import { ToggleChipGroup, ToggleChipItem } from './ui/toggle-chip'
import { CardDescription, CardHeader, CardRow, CardTitle, SettingsCard } from './ui/card'

const GPU_OPTIONS: { value: GpuSetting; label: PlainMessageKey }[] = [
  { value: 'auto', label: 'canvas.rendererOptionAuto' },
  { value: 'on', label: 'canvas.rendererOptionOn' },
  { value: 'off', label: 'canvas.rendererOptionOff' },
  { value: 'force', label: 'canvas.rendererOptionForce' },
]

const ZOOM_OPTIONS: { value: ZoomPicturesSetting; label: PlainMessageKey }[] = [
  { value: 'auto', label: 'canvas.rendererOptionAuto' },
  { value: 'on', label: 'canvas.rendererOptionOn' },
  { value: 'off', label: 'canvas.rendererOptionOff' },
]

/** Settings → Appearance → Canvas renderer: this browser's pick of the GPU
 *  layer and zoom pictures (rendererSetting.ts), and the renderer label's
 *  switch. A pick made after a canvas opened in this page load waits for a
 *  reload, which the card offers; before that, the first canvas reads it. */
export function RendererSettings() {
  const t = useT()
  const [setting, setSetting] = useState(readRendererSetting)
  const showLabel = useStore((s) => s.viewOptions.renderer)
  const toggleViewOption = useStore((s) => s.toggleViewOption)
  const decision = decidedRenderTrial()
  const pending = decision !== null && !settingApplied(setting, decision)

  function pick(next: RendererSetting) {
    if (writeRendererSetting(next)) setSetting(next)
  }

  return (
    <SettingsCard data-testid="renderer-settings">
      <CardHeader>
        <CardTitle>{t('settings.rendererTitle')}</CardTitle>
        <CardDescription>{t('settings.rendererDescription')}</CardDescription>
      </CardHeader>
      <CardRow label={t('settings.rendererGpuRow')}>
        <ToggleChipGroup
          aria-label={t('settings.rendererGpuAria')}
          value={setting.gpu}
          onValueChange={(v) => isGpuSetting(v) && pick({ ...setting, gpu: v })}
        >
          {GPU_OPTIONS.map(({ value, label }) => (
            <ToggleChipItem key={value} value={value}>
              {t(label)}
            </ToggleChipItem>
          ))}
        </ToggleChipGroup>
        <Note>{t('settings.rendererGpuNote')}</Note>
      </CardRow>
      <CardRow label={t('settings.rendererZoomRow')}>
        <ToggleChipGroup
          aria-label={t('settings.rendererZoomAria')}
          value={setting.zoomPictures}
          onValueChange={(v) => isZoomPicturesSetting(v) && pick({ ...setting, zoomPictures: v })}
        >
          {ZOOM_OPTIONS.map(({ value, label }) => (
            <ToggleChipItem key={value} value={value}>
              {t(label)}
            </ToggleChipItem>
          ))}
        </ToggleChipGroup>
        <Note>{t('settings.rendererZoomNote')}</Note>
      </CardRow>
      <CardRow label={t('settings.rendererLabelRow')}>
        <Switch
          aria-label={t('settings.rendererLabelRow')}
          checked={showLabel}
          onCheckedChange={() => toggleViewOption('renderer')}
        />
        <Note>{t('settings.rendererLabelNote')}</Note>
      </CardRow>
      {pending && (
        <CardRow
          action={
            <Button size="sm" onClick={() => location.reload()}>
              {t('settings.rendererReloadNow')}
            </Button>
          }
        >
          <Note>{t('canvas.rendererPending')}</Note>
        </CardRow>
      )}
    </SettingsCard>
  )
}
