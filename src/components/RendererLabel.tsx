import { useState } from 'react'
import { useStore } from '../lib/store'
import { useGpuPictures } from '../lib/gpuPictures'
import { cullingEnabled } from '../lib/liveFrames'
import { renderTrial } from '../lib/renderTrialClient'
import {
  isGpuSetting,
  isZoomPicturesSetting,
  readRendererSetting,
  rendererState,
  settingApplied,
  writeRendererSetting,
  type RendererSetting,
  type RendererSource,
  type RendererState,
} from '../lib/rendererSetting'
import { useT, type PlainMessageKey } from '../lib/i18n'
import { cn } from '../lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCaption,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
import { ToolbarButton } from './ui/toolbar'
import { Tooltip } from './ui/tooltip'

const SOURCE: Record<RendererSource, PlainMessageKey> = {
  trial: 'canvas.rendererSourceTrial',
  set: 'canvas.rendererSourceSet',
  unavailable: 'canvas.rendererSourceUnavailable',
  fixed: 'canvas.rendererSourceFixed',
}

function gpuLine(s: RendererState): PlainMessageKey {
  if (s.allLive) return 'canvas.rendererAllLive'
  if (s.gpuFailed) return 'canvas.rendererGpuFailed'
  return s.gpu ? 'canvas.rendererGpuOn' : 'canvas.rendererGpuOff'
}

/**
 * The renderer label, a button at the start of the zoom pill: what draws this
 * canvas on this page load (GPU layer or DOM pictures, plus zoom pictures) and
 * whether the render trial picked it (auto) or this browser did (set). Its
 * tooltip says why for each; its menu changes the pick, which applies at the
 * next load (the levels are fixed per load), so the menu offers the reload.
 * Shown while the `renderer` view option is on (the zoom menu, Settings →
 * Appearance).
 */
export function RendererLabel() {
  const t = useT()
  const gpuFailed = useGpuPictures((s) => s.failed)
  const hide = useStore((s) => s.toggleViewOption)
  const [setting, setSetting] = useState(readRendererSetting)
  const decision = renderTrial()
  const state = rendererState(decision, { culling: cullingEnabled(), gpuFailed })
  const pending = !settingApplied(setting, decision)

  function pick(next: RendererSetting) {
    if (writeRendererSetting(next)) setSetting(next)
  }

  const name = t(state.allLive ? 'canvas.rendererLive' : state.gpu ? 'canvas.rendererGpu' : 'canvas.rendererDom')
  const tag = pending
    ? t('canvas.rendererTagReload')
    : state.auto
      ? t('canvas.rendererTagAuto')
      : state.gpuSource === 'set' || state.zoomSource === 'set'
        ? t('canvas.rendererTagSet')
        : ''
  const tip = (
    <>
      {t(gpuLine(state))} ({t(SOURCE[state.gpuSource])})
      <br />
      {t(state.zoomPictures ? 'canvas.rendererZoomOn' : 'canvas.rendererZoomOff')} ({t(SOURCE[state.zoomSource])})
      {pending && (
        <>
          <br />
          {t('canvas.rendererPending')}
        </>
      )}
    </>
  )

  return (
    <DropdownMenu>
      <Tooltip label={tip}>
        <DropdownMenuTrigger asChild>
          <ToolbarButton
            aria-label={t('canvas.rendererAria')}
            data-renderer={state.allLive ? 'live' : state.gpu ? 'gpu' : 'dom'}
            data-zoom-pictures={state.zoomPictures ? 'on' : 'off'}
            className="w-auto min-w-0 gap-1 whitespace-nowrap px-1.5 font-mono text-caption sm:w-auto sm:px-1.5"
          >
            <span className="flex items-center gap-1">
              <span className={cn('text-ink', state.gpuFailed && 'line-through')}>{name}</span>
              {state.zoomPictures && <span>· {t('canvas.rendererPictures')}</span>}
              {tag && <span className={cn('text-ink-faint', pending && 'text-ink')}>{tag}</span>}
            </span>
          </ToolbarButton>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent side="top" align="start" width="md">
        <DropdownMenuCaption>{t('canvas.rendererMenuGpu')}</DropdownMenuCaption>
        <DropdownMenuRadioGroup
          value={setting.gpu}
          onValueChange={(v) => isGpuSetting(v) && pick({ ...setting, gpu: v })}
        >
          <DropdownMenuRadioItem value="auto" description={t('canvas.rendererOptionAutoHint')}>
            {t('canvas.rendererOptionAuto')}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="on">{t('canvas.rendererOptionOn')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="off">{t('canvas.rendererOptionOff')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="force">{t('canvas.rendererOptionForce')}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuCaption>{t('canvas.rendererMenuZoom')}</DropdownMenuCaption>
        <DropdownMenuRadioGroup
          value={setting.zoomPictures}
          onValueChange={(v) => isZoomPicturesSetting(v) && pick({ ...setting, zoomPictures: v })}
        >
          <DropdownMenuRadioItem value="auto" description={t('canvas.rendererOptionAutoHint')}>
            {t('canvas.rendererOptionAuto')}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="on">{t('canvas.rendererOptionOn')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="off">{t('canvas.rendererOptionOff')}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        {pending && (
          <DropdownMenuItem onSelect={() => location.reload()}>{t('canvas.rendererReload')}</DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => hide('renderer')}>{t('canvas.hideRenderer')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
