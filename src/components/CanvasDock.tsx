import type { ReactNode } from 'react'
import { canEditOpenCanvas, roleOf, toolAllowed, useStore, type PanelTab } from '../lib/store'
import { TOOLS, type Tool } from '../lib/tools'
import { useOpenThreadCount } from '../lib/comments'
import { useT } from '../lib/i18n'
import { cn } from '@/lib/utils'
import { TOOL_ICONS } from './Stage'
import { PeerAvatars, PresenceFace } from './PeerAvatars'
import { Toolbar, ToolbarButton, ToolbarControl, ToolbarDivider, ToolbarDot } from './ui/toolbar'
import { MenuHint } from './ui/menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
import { Tooltip } from './ui/tooltip'
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  CommentIcon,
  ExportIcon,
  GearIcon,
  ImportIcon,
  LayersIcon,
  MoreHorizontalIcon,
  PlusIcon,
  PrototypeModeIcon,
  ShareUpIcon,
  SlidersIcon,
  SparkIcon,
} from './ui/icons'

/**
 * The reviewer layout's one bar (FULL_UI off, floating panels): what
 * the top bar, the tool rail, the zoom pill and the side rail held, along the
 * bottom of the canvas, icons only with their names on hover. Someone who
 * reviews needs the canvas, the Hand to move around it, Comment, and the
 * conversation with the agents; everything else is one click away, not in
 * view.
 *
 * In order: back to the canvases, the canvas's name and id; Hand, Comment,
 * Prototype mode and the rest of the tools in a list that opens upwards; the
 * zoom (the Stage draws its own control into `zoomSlot`, keeping its menu and
 * handlers); who is here; Import and Export; Comments and AI activity (the
 * right-hand panel on that tab) and Connect AI; the design panel, settings
 * and you. The page decides what each may do and passes null for what this
 * person is not offered.
 *
 * On a phone (`phone`) the canvas is review-only (State.reviewOnly) and the
 * same dock holds what reviewing needs within a thumb's reach, at the 40px
 * touch size: back, Hand, Comment, the Comments sheet (whose tabs hold AI
 * activity), Pages and layers, and ••• for the rest (the canvas actions
 * sheet: its name, export, share, settings). No tool list: every other tool
 * edits. Pinching zooms; the zoom pill floats above it.
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
  onConnect: (() => void) | null
  inspector: { open: boolean; label: string; onToggle: () => void } | null
  onSettings: (() => void) | null
  /** the owner's Share dialog (link level and password) */
  onShare: (() => void) | null
}

function PhoneDock({ onBack, panelTab, panelOpen, onPanel, onLayers, onMore }: PhoneDockProps) {
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
      {onPanel && <PanelButtons panelTab={panelTab} panelOpen={panelOpen} onPanel={onPanel} aiActivity={false} />}
      <ToolbarControl side="top" label={t('canvas.layers')} onClick={onLayers}>
        <LayersIcon />
      </ToolbarControl>
      <ToolbarControl side="top" label={t('canvas.canvasActions')} onClick={onMore}>
        <MoreHorizontalIcon />
      </ToolbarControl>
    </Toolbar>
  )
}

/** Comments, and AI activity for an editor: each opens the right-hand panel
 *  (a sheet on a phone) on its tab, with a dot for what is waiting. */
function PanelButtons({
  panelTab,
  panelOpen,
  onPanel,
  aiActivity = true,
}: Omit<PanelProps, 'onPanel'> & {
  onPanel: (tab: PanelTab) => void
  /** off on a phone, where the panel's sheet has its own AI activity tab */
  aiActivity?: boolean
}) {
  const t = useT()
  const openThreads = useOpenThreadCount()
  const working = useStore((s) => s.tasks.filter((x) => x.agentName && !x.endedAt && !x.failedAt).length)
  /* a viewer or commenter's panel is Comments alone (ActivityPanel) */
  const canEdit = useStore(canEditOpenCanvas)
  const showing = (tab: PanelTab) => panelOpen && panelTab === tab
  return (
    <>
      <ToolbarControl
        side="top"
        label={openThreads ? t('canvas.commentsOpen', { open: openThreads }) : t('canvas.comments')}
        aria-pressed={showing('comments')}
        className="aria-pressed:bg-paper-deep aria-pressed:text-ink"
        onClick={() => onPanel('comments')}
      >
        <CommentIcon />
        {openThreads > 0 && <ToolbarDot className="bg-brand" />}
      </ToolbarControl>
      {aiActivity && canEdit && (
        <ToolbarControl
          side="top"
          label={working ? t('canvas.agentsWorking', { working }) : t('canvas.aiActivity')}
          aria-pressed={showing('tasks')}
          className="aria-pressed:bg-paper-deep aria-pressed:text-ink"
          onClick={() => onPanel('tasks')}
        >
          <SparkIcon />
          {working > 0 && <ToolbarDot className="bg-success" />}
        </ToolbarControl>
      )}
    </>
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
  onConnect,
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
      {(onPanel || onConnect) && <ToolbarDivider />}
      {onPanel && <PanelButtons panelTab={panelTab} panelOpen={panelOpen} onPanel={onPanel} />}
      {onConnect && (
        <ToolbarControl
          side={side}
          label={t('canvas.connectAi')}
          className="bg-ink text-paper hover:bg-ink hover:text-paper"
          onClick={onConnect}
        >
          <PlusIcon />
        </ToolbarControl>
      )}
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

/** Hand, Comment and Prototype mode, as the rail's foot had them, and every
 *  other tool in a list that opens upwards. A phone reviews, so it gets the
 *  Hand and Comment alone. */
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
  const listed = TOOLS.filter((e) => e.id !== 'zoom' && toolAllowed(e.id, role))
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
      {/* a phone stops here: the rest is for editing */}
      {!phone && (
        <>
          <ToolbarControl
            side="top"
            label={t('stage.modePrototype')}
            aria-pressed={prototypeMode}
            className={pressed}
            onClick={() => useStore.getState().setPrototypeMode(!prototypeMode)}
          >
            <PrototypeModeIcon />
          </ToolbarControl>
          {/* a tool picked from the list shows here, so the current one is always in view */}
          {picked && (
            <ToolbarControl side="top" label={label(tool)} aria-pressed className={pressed}>
              {TOOL_ICONS[tool]}
            </ToolbarControl>
          )}
          <DropdownMenu>
            <Tooltip label={t('stage.moreTools')} side="top">
              <DropdownMenuTrigger asChild>
                <ToolbarButton
                  aria-label={t('stage.moreTools')}
                  className={cn('data-[state=open]:bg-paper-deep', pressed)}
                >
                  <ChevronDownIcon className={cn('rotate-180')} />
                </ToolbarButton>
              </DropdownMenuTrigger>
            </Tooltip>
            <DropdownMenuContent side="top" align="start" width="sm">
              {listed.map((entry) => (
                <DropdownMenuItem key={entry.id} onSelect={() => setTool(entry.id)}>
                  {TOOL_ICONS[entry.id]}
                  {t(entry.label)}
                  {tool === entry.id ? <CheckIcon size="rail" className="ml-auto" /> : <MenuHint>{entry.key}</MenuHint>}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => useStore.getState().setPrototypeMode(!prototypeMode)}>
                <PrototypeModeIcon size="rail" />
                {t('stage.modePrototypeShort')}
                {prototypeMode && <CheckIcon size="rail" className="ml-auto" />}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
    </>
  )
}
