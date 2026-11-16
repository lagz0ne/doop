import type { ReactNode } from 'react'
import { canvasPages } from '../../shared/pages'
import { roleOf, toolAllowed, useStore, type PanelTab } from '../lib/store'
import { TOOLS, type Tool } from '../lib/tools'
import { useOpenThreadCount } from '../lib/comments'
import { useT } from '../lib/i18n'
import { TOOL_ICONS } from './Stage'
import type { Presence } from '../../shared/types'
import { locatePresence } from '../lib/locate'
import { flyToPresence, PeerAvatars, PresenceFace, presenceLabel } from './PeerAvatars'
import { Avatar } from './ui/avatar'
import { Toolbar, ToolbarButton, ToolbarControl, ToolbarDivider, ToolbarDot } from './ui/toolbar'
import {
  DropdownMenu,
  DropdownMenuCaption,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
import { Tooltip } from './ui/tooltip'
import {
  ChevronDownIcon,
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
 * bottom of the canvas, icons only with their names on hover. The bar keeps to
 * moving around and reviewing; everything else is one menu away.
 *
 * In order: Hand and Comment; the zoom (the Stage draws its own control into `zoomSlot`, keeping
 * its menu and handlers); the page picker (the canvas's pages, in place of a
 * Pages panel); and the faces of who is here, which open the one menu for the
 * rest: the comments panel, import, export, share, the design panel, settings
 * and your name. The page decides what each may do and passes null for what
 * this person is not offered. Back to the canvases and the canvas's name and
 * id are not in the bar: `CanvasLabel` puts them quietly at the top left,
 * where a glance tells what this is, and the bar's room goes to the page's
 * name.
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
 * and fits; pinching zooms), the Comments sheet, the page picker, and ••• for
 * the rest (the canvas actions sheet: its name, Present, share, export, your
 * name, settings).
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
  /** the canvas actions sheet */
  onMore: () => void
}

type DockProps = PanelProps & {
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

function PhoneDock({ onBack, zoomSlot, panelTab, panelOpen, onPanel, onMore }: PhoneDockProps) {
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
      <PagePicker phone />
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
  return (
    <Toolbar
      aria-label={t('canvas.dock')}
      className="pointer-events-auto absolute bottom-3.5 left-1/2 z-[38] max-w-[calc(100%-28px)] -translate-x-1/2 overflow-x-auto"
    >
      <DockTools />
      <ToolbarDivider />
      <span ref={zoomSlot} className="flex items-center" />
      <ToolbarDivider />
      <PagePicker />
      <ToolbarDivider />
      <DockMenu
        me={me}
        others={others}
        onRenameSelf={onRenameSelf}
        onImport={onImport}
        onExport={onExport}
        onShare={onShare}
        panelTab={panelTab}
        panelOpen={panelOpen}
        onPanel={onPanel}
        inspector={inspector}
        onSettings={onSettings}
      />
    </Toolbar>
  )
}

/** The reviewer layout's top left, on a desktop: back to the canvases, the
 *  canvas's name (its rename field where this person may edit) and its id
 *  menu, on a pill that stays faint until the pointer comes to it. People
 *  read it once and move on, so it takes the least room that names the
 *  canvas: the name truncates at 240px, whole in its tooltip. */
export function CanvasLabel({
  title,
  idMenu,
  onBack,
}: {
  title: ReactNode
  idMenu: ReactNode
  onBack: (() => void) | null
}) {
  const t = useT()
  const name = useStore((s) => s.canvas?.name)
  return (
    <Toolbar
      aria-label={t('canvas.canvasLabel')}
      className="pointer-events-auto absolute top-2.5 left-3.5 z-[38] h-9 gap-0.5 bg-surface/70 px-1 py-0 shadow-none backdrop-blur-sm transition-[background-color,box-shadow] duration-150 hover:bg-surface hover:shadow-ring focus-within:bg-surface focus-within:shadow-ring"
    >
      {onBack && (
        <ToolbarControl side="bottom" label={t('canvas.allCanvases')} onClick={onBack}>
          <ChevronLeftIcon />
        </ToolbarControl>
      )}
      <span className="flex min-w-0 max-w-[240px] items-center" title={name}>
        {title}
      </span>
      {idMenu}
    </Toolbar>
  )
}

/** The canvas's pages as a pick-one menu, in place of a Pages panel: the
 *  trigger names the page shown (a phone shows the icon alone). Adding,
 *  renaming and ordering pages stay with the full editor's Pages panel. */
function PagePicker({ phone = false }: { phone?: boolean }) {
  const t = useT()
  const canvas = useStore((s) => s.canvas)
  const activePageId = useStore((s) => s.activePageId)
  if (!canvas) return null
  const pages = canvasPages(canvas)
  const active = pages.find((page) => page.id === activePageId) ?? pages[0]
  if (!active) return null
  return (
    <DropdownMenu>
      <Tooltip label={t('panels.pagesTitle')} side="top">
        <span className="inline-flex">
          <DropdownMenuTrigger asChild>
            <ToolbarButton
              aria-label={t('canvas.pagePicker', { page: active.name })}
              className={phone ? undefined : 'flex w-auto max-w-[320px] gap-1.5 px-2 sm:w-auto sm:px-2'}
            >
              <PageIcon />
              {!phone && <span className="min-w-0 truncate">{active.name}</span>}
              {!phone && <ChevronDownIcon className="flex-none text-ink-faint" />}
            </ToolbarButton>
          </DropdownMenuTrigger>
        </span>
      </Tooltip>
      <DropdownMenuContent side="top" align="center" width="md">
        <DropdownMenuCaption>{t('panels.pagesTitle')}</DropdownMenuCaption>
        <DropdownMenuRadioGroup value={active.id} onValueChange={(id) => useStore.getState().setActivePage(id)}>
          {pages.map((page) => (
            <DropdownMenuRadioItem key={page.id} value={page.id}>
              <span className="truncate">{page.name}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Who is here, as the trigger of the one menu for what a reviewer reaches
 *  for now and then: the people and agents here (follow a person, go to where
 *  an agent works, as a click on their face does in the full layout), the
 *  comments panel (the trigger wears a dot while threads are open), import,
 *  export, share, the design panel, settings and your name. The trigger's
 *  faces are pictures only: a face that followed on click inside the menu's
 *  button would do both at once. */
function DockMenu({
  me,
  others,
  onRenameSelf,
  onImport,
  onExport,
  onShare,
  panelTab,
  panelOpen,
  onPanel,
  inspector,
  onSettings,
}: Pick<
  DockProps,
  | 'me'
  | 'others'
  | 'onRenameSelf'
  | 'onImport'
  | 'onExport'
  | 'onShare'
  | 'panelTab'
  | 'panelOpen'
  | 'onPanel'
  | 'inspector'
  | 'onSettings'
>) {
  const t = useT()
  const openThreads = useOpenThreadCount()
  const here = others.map((p) => p.name).join(', ')
  const commentsShown = panelOpen && panelTab === 'comments'
  const files = onImport || onExport || onShare
  const yours = inspector || onSettings || onRenameSelf
  return (
    <DropdownMenu>
      <Tooltip label={here ? t('canvas.hereNow', { names: here }) : t('canvas.justYou')} side="top">
        <span className="inline-flex">
          <DropdownMenuTrigger asChild>
            <ToolbarButton
              aria-label={t('canvas.dockMenu')}
              className="relative flex w-auto gap-1 px-1 sm:w-auto sm:px-1"
            >
              <span className="flex items-center">
                <PresenceFace name={me.name} image={me.image} color={me.color} kind="user" />
                {others.slice(0, FACES - 1).map((p) => (
                  <PresenceFace
                    key={p.clientId}
                    name={p.name}
                    image={p.image}
                    color={p.color}
                    kind={p.kind}
                    className="-ml-[7px]"
                  />
                ))}
                {others.length > FACES - 1 && (
                  <Avatar
                    size={24}
                    className="-ml-[7px]"
                    name={`+${others.length - FACES + 1}`}
                    color="var(--ink-faint)"
                  >
                    +{others.length - FACES + 1}
                  </Avatar>
                )}
              </span>
              <ChevronDownIcon className="flex-none text-ink-faint" />
              {openThreads > 0 && <ToolbarDot className="bg-brand" />}
            </ToolbarButton>
          </DropdownMenuTrigger>
        </span>
      </Tooltip>
      <DropdownMenuContent side="top" align="end" width="lg">
        <DropdownMenuCaption>{here ? t('canvas.hereNow', { names: here }) : t('canvas.justYou')}</DropdownMenuCaption>
        {others.map((p) => (
          <PresenceItem key={p.clientId} presence={p} />
        ))}
        {others.length > 0 && <DropdownMenuSeparator />}
        {onPanel && (
          <DropdownMenuItem onSelect={() => onPanel('comments')}>
            <CommentIcon />
            {commentsShown
              ? t('canvas.commentsClose')
              : openThreads > 0
                ? t('canvas.commentsOpen', { open: openThreads })
                : t('canvas.comments')}
          </DropdownMenuItem>
        )}
        {files && <DropdownMenuSeparator />}
        {onImport && (
          <DropdownMenuItem onSelect={onImport}>
            <ImportIcon />
            {t('canvas.import')}
          </DropdownMenuItem>
        )}
        {onExport && (
          <DropdownMenuItem onSelect={onExport}>
            <ExportIcon />
            {t('canvas.export')}
          </DropdownMenuItem>
        )}
        {onShare && (
          <DropdownMenuItem onSelect={onShare}>
            <ShareUpIcon />
            {t('canvas.share')}
          </DropdownMenuItem>
        )}
        {yours && <DropdownMenuSeparator />}
        {inspector && (
          <DropdownMenuItem onSelect={inspector.onToggle}>
            <SlidersIcon />
            {inspector.label}
          </DropdownMenuItem>
        )}
        {onSettings && (
          <DropdownMenuItem onSelect={onSettings}>
            <GearIcon />
            {t('shell.settings')}
          </DropdownMenuItem>
        )}
        {onRenameSelf && (
          <DropdownMenuItem onSelect={onRenameSelf}>
            <PresenceFace name={me.name} image={me.image} color={me.color} kind="user" size={22} />
            <span className="flex min-w-0 flex-col">
              <span className="truncate">{me.name}</span>
              <span className="text-caption text-ink-faint">{t('canvas.changeYourName')}</span>
            </span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** How many faces the menu's trigger shows, yours first; a "+N" disc
 *  counts the rest. */
const FACES = 3

/** Someone here, in the dock's menu: a person to follow around the canvas
 *  (and stop following), an agent to go to where it is working. */
function PresenceItem({ presence: p }: { presence: Presence }) {
  const t = useT()
  const followed = useStore((s) => s.following === p.clientId)
  const locatable = useStore((s) => p.kind === 'agent' && locatePresence(p, s) !== undefined)
  const face = <PresenceFace name={p.name} image={p.image} color={p.color} kind={p.kind} size={22} />
  if (p.kind === 'user')
    return (
      <DropdownMenuItem onSelect={() => useStore.getState().setFollowing(followed ? null : p.clientId)}>
        {face}
        <span className="truncate">
          {followed ? t('canvas.stopFollowing', { name: p.name }) : t('canvas.followAround', { name: p.name })}
        </span>
      </DropdownMenuItem>
    )
  return (
    <DropdownMenuItem disabled={!locatable} onSelect={() => flyToPresence(p)}>
      {face}
      <span className="truncate">{presenceLabel(p, t)}</span>
    </DropdownMenuItem>
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
