import type { ReactNode } from 'react'
import { roleOf, toolAllowed, useStore, type PanelTab } from '../lib/store'
import { TOOLS, type Tool } from '../lib/tools'
import { useOpenThreadCount } from '../lib/comments'
import { useT } from '../lib/i18n'
import { TOOL_ICONS } from './Stage'
import { PeerAvatars, PresenceFace } from './PeerAvatars'
import { Toolbar, ToolbarControl, ToolbarDivider, ToolbarDot } from './ui/toolbar'
import { Tooltip } from './ui/tooltip'
import {
  ChevronLeftIcon,
  CommentIcon,
  ExportIcon,
  GearIcon,
  ImportIcon,
  MoreHorizontalIcon,
  PageIcon,
  PrototypeModeIcon,
  ShareUpIcon,
  SlidersIcon,
} from './ui/icons'

/**
 * The reviewer layout's one bar (FULL_UI off, floating panels): what
 * the top bar, the tool rail, the zoom pill and the side rail held, along the
 * bottom of the canvas, icons only with their names on hover. Someone who
 * reviews needs the canvas, the Hand to move around it, Comment, and the
 * conversation with the agents; everything else is one click away, not in
 * view.
 *
 * In order: back to the canvases, the canvas's name and id; Hand and
 * Comment; the zoom (the Stage draws its own control into `zoomSlot`, keeping
 * its menu and handlers); who is here; Import, Export and Share; Comments (the
 * right-hand panel, which holds the comments alone here); the design panel,
 * settings and you. The page decides what each may do and passes null for
 * what this person is not offered.
 *
 * No tool list, no Prototype mode, no AI activity and no Connect AI: a
 * reviewer moves around and comments, and the agents work over MCP, not from
 * this bar. A tool picked by its key (V, F, R…) still shows in the dock while
 * it is the current one, and so does Prototype mode while it is on, so the
 * mode the canvas is in is always in view and one click from leaving.
 *
 * On a phone (`phone`) the canvas is review-only (State.reviewOnly) and the
 * same dock is the one control on screen, within a thumb's reach at the 40px
 * touch size: back, Hand, Comment, the zoom level (its menu has the steps
 * and fits; pinching zooms), the Comments sheet, Pages, and ••• for the rest
 * (the canvas actions sheet: its name, Present, share, export, your name,
 * settings).
 */
export function CanvasDock(props: DockProps & { phone?: false }): ReactNode
export function CanvasDock(props: PhoneDockProps & { phone: true }): ReactNode
export function CanvasDock(props: (DockProps & { phone?: false }) | (PhoneDockProps & { phone: true })) {
  return props.phone ? <PhoneDock {...props} /> : <DesktopDock {...props} />
}

type PanelProps = {
  panelTab: PanelTab
  panelOpen: boolean
  /** open the right-hand panel on a tab, or close it if it shows that tab */
  onPanel: ((tab: PanelTab) => void) | null
}

type PhoneDockProps = PanelProps & {
  onBack: (() => void) | null
  /** receives the element the zoom control is drawn into */
  zoomSlot: (el: HTMLElement | null) => void
  /** the Pages and layers sheet */
  onLayers: () => void
  /** the canvas actions sheet */
  onMore: () => void
}

type DockProps = PanelProps & {
  title: ReactNode
  idMenu: ReactNode
  onBack: (() => void) | null
  /** receives the element the zoom control is drawn into */
  zoomSlot: (el: HTMLElement | null) => void
  me: { name: string; image?: string; color: string }
  others: Parameters<typeof PeerAvatars>[0]['others']
  onRenameSelf: (() => void) | null
  onImport: (() => void) | null
  onExport: (() => void) | null
  inspector: { open: boolean; label: string; onToggle: () => void } | null
  onSettings: (() => void) | null
  /** the owner's Share dialog (link level and password) */
  onShare: (() => void) | null
}

function PhoneDock({ onBack, zoomSlot, panelTab, panelOpen, onPanel, onLayers, onMore }: PhoneDockProps) {
  const t = useT()
  return (
    <Toolbar
      aria-label={t('canvas.dock')}
      className="pointer-events-auto absolute bottom-[calc(8px+env(safe-area-inset-bottom))] left-1/2 z-[38] max-w-[calc(100%-16px)] -translate-x-1/2 gap-0 overflow-x-auto"
    >
      {onBack && (
        <ToolbarControl side="top" label={t('canvas.allCanvases')} onClick={onBack}>
          <ChevronLeftIcon />
        </ToolbarControl>
      )}
      <DockTools phone />
      <ToolbarDivider />
      <span ref={zoomSlot} className="flex items-center" />
      <ToolbarDivider />
      {onPanel && <PanelButtons panelTab={panelTab} panelOpen={panelOpen} onPanel={onPanel} />}
      <ToolbarControl side="top" label={t('panels.pagesTitle')} onClick={onLayers}>
        <PageIcon />
      </ToolbarControl>
      <ToolbarControl side="top" label={t('canvas.canvasActions')} onClick={onMore}>
        <MoreHorizontalIcon />
      </ToolbarControl>
    </Toolbar>
  )
}

/** Comments: the right-hand panel (a sheet on a phone), with a dot while
 *  threads are open. */
function PanelButtons({
  panelTab,
  panelOpen,
  onPanel,
}: Omit<PanelProps, 'onPanel'> & { onPanel: (tab: PanelTab) => void }) {
  const t = useT()
  const openThreads = useOpenThreadCount()
  return (
    <ToolbarControl
      side="top"
      label={openThreads ? t('canvas.commentsOpen', { open: openThreads }) : t('canvas.comments')}
      aria-pressed={panelOpen && panelTab === 'comments'}
      className="aria-pressed:bg-paper-deep aria-pressed:text-ink"
      onClick={() => onPanel('comments')}
    >
      <CommentIcon />
      {openThreads > 0 && <ToolbarDot className="bg-brand" />}
    </ToolbarControl>
  )
}

function DesktopDock({
  title,
  idMenu,
  onBack,
  zoomSlot,
  me,
  others,
  onRenameSelf,
  onImport,
  onExport,
  panelTab,
  panelOpen,
  onPanel,
  inspector,
  onSettings,
  onShare,
}: DockProps) {
  const t = useT()
  const side = 'top' as const

  return (
    <Toolbar
      aria-label={t('canvas.dock')}
      className="pointer-events-auto absolute bottom-3.5 left-1/2 z-[38] max-w-[calc(100%-28px)] -translate-x-1/2 overflow-x-auto"
    >
      {onBack && (
        <ToolbarControl side={side} label={t('canvas.allCanvases')} onClick={onBack}>
          <ChevronLeftIcon />
        </ToolbarControl>
      )}
      <span className="flex min-w-0 max-w-[220px] items-center">{title}</span>
      {idMenu}
      <ToolbarDivider />
      <DockTools />
      <ToolbarDivider />
      <span ref={zoomSlot} className="flex items-center" />
      <ToolbarDivider />
      <Tooltip label={others.map((p) => p.name).join(', ') || t('canvas.justYou')} side={side}>
        <span className="flex items-center px-1">
          <PresenceFace name={me.name} image={me.image} color={me.color} kind="user" />
          <span className="-ml-[7px] flex items-center">
            <PeerAvatars others={others} />
          </span>
        </span>
      </Tooltip>
      {(onImport || onExport || onShare) && <ToolbarDivider />}
      {onImport && (
        <ToolbarControl side={side} label={t('canvas.import')} onClick={onImport}>
          <ImportIcon />
        </ToolbarControl>
      )}
      {onExport && (
        <ToolbarControl side={side} label={t('canvas.export')} onClick={onExport}>
          <ExportIcon />
        </ToolbarControl>
      )}
      {onShare && (
        <ToolbarControl side={side} label={t('canvas.share')} onClick={onShare}>
          <ShareUpIcon />
        </ToolbarControl>
      )}
      {onPanel && <ToolbarDivider />}
      {onPanel && <PanelButtons panelTab={panelTab} panelOpen={panelOpen} onPanel={onPanel} />}
      <ToolbarDivider />
      {inspector && (
        <ToolbarControl
          side={side}
          label={inspector.label}
          aria-pressed={inspector.open}
          className="aria-pressed:bg-paper-deep aria-pressed:text-ink"
          onClick={inspector.onToggle}
        >
          <SlidersIcon />
        </ToolbarControl>
      )}
      {onSettings && (
        <ToolbarControl side={side} label={t('shell.settings')} onClick={onSettings}>
          <GearIcon />
        </ToolbarControl>
      )}
      {onRenameSelf && (
        <ToolbarControl side={side} label={t('canvas.youAre', { name: me.name })} onClick={onRenameSelf}>
          <PresenceFace name={me.name} image={me.image} color={me.color} kind="user" size={22} />
        </ToolbarControl>
      )}
    </Toolbar>
  )
}

/** Hand and Comment. A tool picked by its key shows beside them while it is
 *  the current one, and Prototype mode while it is on, each pressed, so the
 *  canvas's mode is always in view; a click on either goes back to the Hand
 *  (or out of Prototype mode). A phone reviews: Hand and Comment alone. */
function DockTools({ phone = false }: { phone?: boolean }) {
  const t = useT()
  const tool = useStore((s) => s.tool)
  const role = useStore(roleOf)
  const prototypeMode = useStore((s) => s.prototypeMode)
  const setTool = useStore((s) => s.setTool)
  const label = (id: Tool) => {
    const entry = TOOLS.find((e) => e.id === id)!
    return t('stage.toolTooltip', { label: t(entry.label), key: entry.key })
  }
  const pressed = 'aria-pressed:bg-paper-deep aria-pressed:text-ink'
  const picked = tool !== 'hand' && tool !== 'comment' && tool !== 'zoom'
  return (
    <>
      <ToolbarControl
        side="top"
        label={label('hand')}
        aria-pressed={tool === 'hand'}
        className={pressed}
        onClick={() => setTool('hand')}
      >
        {TOOL_ICONS.hand}
      </ToolbarControl>
      {toolAllowed('comment', role) && (
        <ToolbarControl
          side="top"
          label={label('comment')}
          aria-pressed={tool === 'comment'}
          className={pressed}
          onClick={() => setTool('comment')}
        >
          {TOOL_ICONS.comment}
        </ToolbarControl>
      )}
      {!phone && picked && (
        <ToolbarControl side="top" label={label(tool)} aria-pressed className={pressed} onClick={() => setTool('hand')}>
          {TOOL_ICONS[tool]}
        </ToolbarControl>
      )}
      {!phone && prototypeMode && (
        <ToolbarControl
          side="top"
          label={t('stage.modePrototype')}
          aria-pressed
          className={pressed}
          onClick={() => useStore.getState().setPrototypeMode(false)}
        >
          <PrototypeModeIcon />
        </ToolbarControl>
      )}
    </>
  )
}
