import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type {
  ModelConfiguration,
  ModelSelection,
  ComposerFileAttachment,
  ContextStatus,
  McpServerSummary,
  PendingInteraction,
  QuestionAnswer,
  SessionRecord,
  SessionScope,
  SessionSummary,
  ToolCard,
  WorkspaceChanges,
  WorkspaceFileContent,
  WorkspaceFileDiff,
  WorkspaceTreeEntry,
} from '../shared/contracts'
import { SimpleModelSettings } from './SimpleModelSettings'
import { ScheduledTasksPage } from './ScheduledTasksPage'
import { SyntaxHighlightedCode, languageLabelForPath } from './syntax-highlighting'
import { isConversationAtBottom, scrollConversationToBottom } from './conversation-scroll'
import {
  activeAtToken,
  activeSlashToken,
  formatFileMention,
  splitMentionSegments,
  type ActiveAtToken,
  type ActiveSlashToken,
  type MentionCandidate,
} from './composer-mentions'

type IconName =
  | 'arrow-left'
  | 'arrow-right'
  | 'bell'
  | 'brain'
  | 'branch'
  | 'check'
  | 'changes'
  | 'chevron'
  | 'clock'
  | 'commit'
  | 'copy'
  | 'edit'
  | 'file'
  | 'folder'
  | 'folder-open'
  | 'github'
  | 'goal'
  | 'help'
  | 'laptop'
  | 'panel'
  | 'plan'
  | 'plugin'
  | 'plus'
  | 'pull-request'
  | 'search'
  | 'send'
  | 'settings'
  | 'shield'
  | 'source'
  | 'stop'
  | 'terminal'
  | 'thread'
  | 'trash'

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, JSX.Element> = {
    'arrow-left': <path d="m15 18-6-6 6-6" />,
    'arrow-right': <path d="m9 18 6-6-6-6" />,
    bell: <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />,
    brain: <><path d="M9.5 4.5A3 3 0 0 0 4 6a3 3 0 0 0 .7 5.9A3.5 3.5 0 0 0 8 18h1.5V4.5Z" /><path d="M14.5 4.5A3 3 0 0 1 20 6a3 3 0 0 1-.7 5.9A3.5 3.5 0 0 1 16 18h-1.5V4.5ZM9.5 9H7m7.5 3H17M9.5 15H8m6.5-7H16" /></>,
    branch: <path d="M6 3v12a4 4 0 0 0 4 4h8M18 5v6M15 8h6M6 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />,
    check: <path d="m5 12 4 4L19 6" />,
    changes: <path d="M6 3h12v18H6zM9 8h6M9 12h6M9 16h4" />,
    chevron: <path d="m9 6 6 6-6 6" />,
    clock: <path d="M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />,
    commit: <path d="M3 12h5m8 0h5M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z" />,
    copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" /></>,
    edit: <><path d="m4 20 4.2-1 10.7-10.7a2 2 0 0 0-2.8-2.8L5.4 16.2 4 20Z" /><path d="m14.5 7 2.8 2.8" /></>,
    file: <path d="M7 3h7l4 4v14H7zM14 3v4h4" />,
    folder: <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />,
    'folder-open': <><path d="M3 6h5l2 2h9a2 2 0 0 1 2 2v1" /><path d="M3 6v11a2 2 0 0 0 2 2h13.4a2 2 0 0 0 1.94-1.5l1.54-6A2 2 0 0 0 19.94 10H8.24a2 2 0 0 0-1.79 1.1L3 18" /></>,
    github: <path d="M15 22v-4a4 4 0 0 0-1-3c3.3-.4 6.8-1.6 6.8-7A5.4 5.4 0 0 0 19.4 4 5 5 0 0 0 19.3 1S18.2.6 15 2.5a13.4 13.4 0 0 0-7 0C4.8.6 3.7 1 3.7 1a5 5 0 0 0-.1 3A5.4 5.4 0 0 0 2.2 7.8c0 5.4 3.5 6.6 6.8 7A4 4 0 0 0 8 18v4M8 19c-3 .9-3-1.5-4-2" />,
    goal: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></>,
    help: <><circle cx="12" cy="12" r="9" /><path d="M9.8 9a2.4 2.4 0 1 1 3.5 2.2c-.9.4-1.3 1-1.3 1.8M12 17h.01" /></>,
    laptop: <path d="M4 5h16v11H4zM2 19h20" />,
    panel: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></>,
    plan: <><path d="M9 18h6M10 22h4" /><path d="M8.4 14.5A7 7 0 1 1 15.6 14.5C14.6 15.2 14 16 14 17h-4c0-1-.6-1.8-1.6-2.5Z" /></>,
    plugin: <path d="M8 3v3M16 3v3M7 6h10v4a5 5 0 0 1-5 5 5 5 0 0 1-5-5V6ZM12 15v6" />,
    plus: <path d="M12 5v14M5 12h14" />,
    'pull-request': <><circle cx="6" cy="5" r="2" /><circle cx="18" cy="19" r="2" /><path d="M6 7v10M18 17V9a4 4 0 0 0-4-4h-2M9 2l3 3-3 3" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
    send: <path d="M12 19V5m0 0-6 6m6-6 6 6" />,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" /></>,
    shield: <path d="M12 3 5 6v5c0 4.6 3 8 7 10 4-2 7-5.4 7-10V6l-7-3ZM12 8v5M12 16h.01" />,
    source: <><circle cx="6" cy="17" r="2" /><circle cx="18" cy="7" r="2" /><path d="M8 17h3a3 3 0 0 0 3-3v-4a3 3 0 0 1 3-3M8 7h3" /></>,
    stop: <rect x="7" y="7" width="10" height="10" rx="1.5" />,
    terminal: <path d="m5 7 4 4-4 4m7 0h7" />,
    thread: <path d="M4 5h16v11H8l-4 4V5ZM8 9h8M8 12h5" />,
    trash: <><path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6" /></>,
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  )
}

function basename(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path
}

function shortPath(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : path
}

const SESSION_VIEW_STATE_KEY = 'harness-studio:session-view-state'

interface SessionViewState {
  scope: SessionScope
  selected: Partial<Record<SessionScope, string>>
}

function readSessionViewState(): SessionViewState {
  const fallback: SessionViewState = { scope: 'daily', selected: {} }
  try {
    const raw = localStorage.getItem(SESSION_VIEW_STATE_KEY)
    if (raw === null) return fallback
    const value = JSON.parse(raw) as unknown
    if (typeof value !== 'object' || value === null) return fallback
    const record = value as Record<string, unknown>
    const scope = record.scope === 'project' ? 'project' : 'daily'
    const selectedValue = typeof record.selected === 'object' && record.selected !== null
      ? record.selected as Record<string, unknown>
      : {}
    return {
      scope,
      selected: {
        ...(typeof selectedValue.daily === 'string' ? { daily: selectedValue.daily } : {}),
        ...(typeof selectedValue.project === 'string' ? { project: selectedValue.project } : {}),
      },
    }
  } catch {
    return fallback
  }
}

function writeSessionViewState(state: SessionViewState): void {
  try {
    localStorage.setItem(SESSION_VIEW_STATE_KEY, JSON.stringify(state))
  } catch {
    // Browser storage can be unavailable; durable Session data remains authoritative.
  }
}

function SessionListItem({
  session,
  active,
  tabIndex,
  deleting,
  onSelect,
  onDelete,
}: {
  session: SessionSummary
  active: boolean
  tabIndex?: number | undefined
  deleting: boolean
  onSelect: (id: string) => void
  onDelete: (id: string) => void
}) {
  const running = session.status === 'running'
  const deleteLabel = running
    ? `会话正在运行，暂时无法删除「${session.title}」`
    : `删除会话「${session.title}」`
  return (
    <div className={`thread-item ${active ? 'active' : ''}`}>
      <button className="thread-select" tabIndex={tabIndex} onClick={() => onSelect(session.id)}>
        <span>{session.title}</span>
        {running && <i className="running-dot" />}
      </button>
      <button
        className={`thread-delete ${deleting ? 'loading' : ''}`}
        aria-label={deleteLabel}
        title={running ? '请先停止当前会话' : deleting ? '正在删除…' : '删除会话'}
        tabIndex={tabIndex}
        disabled={running || deleting}
        onClick={() => onDelete(session.id)}
      >
        {deleting ? <span className="session-create-spinner" /> : <Icon name="trash" />}
      </button>
    </div>
  )
}

export function ProjectList({
  sessions,
  currentId,
  creatingCwd,
  deletingId,
  onSelect,
  onCreateSession,
  onDelete,
}: {
  sessions: SessionSummary[]
  currentId: string | undefined
  creatingCwd?: string | undefined
  deletingId?: string | undefined
  onSelect: (id: string) => void
  onCreateSession: (cwd: string) => void
  onDelete: (id: string) => void
}) {
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(() => new Set())
  const projectOrder = useRef<string[]>([])
  const projects = useMemo(() => {
    const grouped = new Map<string, SessionSummary[]>()
    for (const session of sessions) {
      const existing = grouped.get(session.cwd) ?? []
      existing.push(session)
      grouped.set(session.cwd, existing)
    }
    const present = new Set(grouped.keys())
    const order = projectOrder.current.filter(cwd => present.has(cwd))
    for (const cwd of grouped.keys()) {
      if (!order.includes(cwd)) order.push(cwd)
    }
    projectOrder.current = order
    return order.flatMap(cwd => {
      const projectSessions = grouped.get(cwd)
      return projectSessions === undefined ? [] : [[cwd, projectSessions] as const]
    })
  }, [sessions])

  function toggleProject(cwd: string) {
    setCollapsedProjects(current => {
      const next = new Set(current)
      if (next.has(cwd)) next.delete(cwd)
      else next.add(cwd)
      return next
    })
  }

  return (
    <div className="projects">
      <div className="section-label">项目</div>
      {projects.map(([cwd, projectSessions]) => {
        const collapsed = collapsedProjects.has(cwd)
        const projectName = basename(cwd)
        return (
          <section
            className={`project-group ${collapsed ? 'collapsed' : ''} ${projectSessions.some(session => session.id === currentId) ? 'active' : ''}`}
            key={cwd}
          >
            <div className="project-name" title={cwd}>
              <button
                className="project-toggle"
                aria-expanded={!collapsed}
                aria-label={`${collapsed ? '展开' : '收起'} ${projectName} 的会话`}
                onClick={() => toggleProject(cwd)}
              >
                <span className={`project-folder-icon ${collapsed ? 'closed' : 'open'}`}>
                  <Icon name={collapsed ? 'folder' : 'folder-open'} />
                </span>
                <span>{projectName}</span>
              </button>
              <button
                className={`project-new-session ${creatingCwd === cwd ? 'loading' : ''}`}
                aria-label={creatingCwd === cwd
                  ? `正在 ${projectName} 中新建会话`
                  : `在 ${projectName} 中新建会话`}
                title={creatingCwd === cwd ? '正在新建…' : '新建会话'}
                disabled={creatingCwd !== undefined}
                onClick={() => onCreateSession(cwd)}
              >
                {creatingCwd === cwd ? <span className="session-create-spinner" /> : <Icon name="plus" />}
              </button>
            </div>
            <div className="project-threads-shell" aria-hidden={collapsed}>
              <div className="project-threads">
                {projectSessions.map(session => (
                  <SessionListItem
                    session={session}
                    active={session.id === currentId}
                    tabIndex={collapsed ? -1 : undefined}
                    deleting={session.id === deletingId}
                    key={session.id}
                    onSelect={onSelect}
                    onDelete={onDelete}
                  />
                ))}
              </div>
            </div>
          </section>
        )
      })}
      {projects.length === 0 && <p className="projects-empty">打开一个项目后，任务会出现在这里。</p>}
    </div>
  )
}

export function DailyList({
  sessions,
  currentId,
  deletingId,
  onSelect,
  onDelete,
}: {
  sessions: SessionSummary[]
  currentId: string | undefined
  deletingId?: string | undefined
  onSelect: (id: string) => void
  onDelete: (id: string) => void
}) {
  return (
    <div className="projects daily-sessions">
      <div className="section-label">对话</div>
      <div className="daily-thread-list">
        {sessions.map(session => (
          <SessionListItem
            session={session}
            active={session.id === currentId}
            deleting={session.id === deletingId}
            key={session.id}
            onSelect={onSelect}
            onDelete={onDelete}
          />
        ))}
      </div>
      {sessions.length === 0 && <p className="projects-empty">新建对话后，会话会保存在这里。</p>}
    </div>
  )
}

export function ModeMenu({
  active,
  onSelect,
  onClose,
}: {
  active: SessionScope
  onSelect: (scope: SessionScope) => void
  onClose: () => void
}) {
  return (
    <div className="mode-menu" role="menu">
      <button className={active === 'daily' ? 'active' : ''} role="menuitem" onClick={() => { onSelect('daily'); onClose() }}>
        <span className="mode-menu-icon"><Icon name="thread" /></span>
        <span><b>日常工作模式</b><small>创建、整理和探索</small></span>
        {active === 'daily' && <Icon name="check" />}
      </button>
      <button className={active === 'project' ? 'active' : ''} role="menuitem" onClick={() => { onSelect('project'); onClose() }}>
        <span className="mode-menu-icon"><Icon name="laptop" /></span>
        <span><b>工程开发模式</b><small>构建、调试和发布</small></span>
        {active === 'project' && <Icon name="check" />}
      </button>
    </div>
  )
}

function DiffView({ diff }: { diff: NonNullable<ToolCard['diff']> }) {
  return (
    <pre className="diff-view">
      {diff.map((line, index) => (
        <code className={`diff-line ${line.kind}`} key={index}>
          <span>{line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' '}</span>
          {line.text}
        </code>
      ))}
    </pre>
  )
}

const HIDDEN_TOOLS = new Set(['job_list', 'todo_write', 'list_agents'])

type SessionMessage = SessionRecord['messages'][number]
type SessionReasoning = NonNullable<SessionRecord['reasoning']>[number]

export interface ConversationTurn {
  id: string
  user: SessionMessage
  assistants: SessionMessage[]
  reasoning: SessionReasoning[]
  tools: ToolCard[]
}

export function buildConversationTurns(session: SessionRecord): ConversationTurn[] {
  const turns: ConversationTurn[] = []
  for (const message of session.messages) {
    if (message.role === 'user') {
      turns.push({ id: message.id, user: message, assistants: [], reasoning: [], tools: [] })
    } else {
      turns.at(-1)?.assistants.push(message)
    }
  }

  for (const reasoning of session.reasoning ?? []) {
    if (turns.length === 0) continue
    const turn = [...turns].reverse().find(candidate => candidate.user.createdAt <= reasoning.createdAt) ?? turns[0]
    turn?.reasoning.push(reasoning)
  }
  for (const tool of session.tools) {
    if (HIDDEN_TOOLS.has(tool.title) || turns.length === 0) continue
    const occurredAt = tool.createdAt ?? Number.MAX_SAFE_INTEGER
    const turn = [...turns].reverse().find(candidate => candidate.user.createdAt <= occurredAt) ?? turns[0]
    turn?.tools.push(tool)
  }
  return turns
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${String(seconds)} 秒`
  const hours = Math.floor(seconds / 3_600)
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  if (hours > 0) {
    const minuteRemainder = Math.floor((seconds % 3_600) / 60)
    return minuteRemainder === 0 ? `${String(hours)} 小时` : `${String(hours)} 小时 ${String(minuteRemainder)} 分钟`
  }
  return remainder === 0 ? `${String(minutes)} 分钟` : `${String(minutes)} 分钟 ${String(remainder)} 秒`
}

export function summarizeReasoning(text: string): string {
  void text
  return '正在思考'
}

function elapsedSince(startedAt: number, active: boolean, completedAt?: number): number {
  // Test fixtures and malformed legacy imports can carry sequence-like values
  // instead of Unix milliseconds. They must not render multi-year durations.
  if (startedAt < 1_000_000_000_000) return 0
  const end = active ? Date.now() : completedAt ?? startedAt
  return Math.max(0, Math.floor((end - startedAt) / 1_000))
}

function WorkIndicator({ startedAt, active, completedAt }: {
  startedAt: number
  active: boolean
  completedAt?: number
}) {
  const [elapsed, setElapsed] = useState(() => elapsedSince(startedAt, active, completedAt))
  useEffect(() => {
    setElapsed(elapsedSince(startedAt, active, completedAt))
    if (!active) return undefined
    const timer = window.setInterval(() => setElapsed(elapsedSince(startedAt, true)), 1_000)
    return () => window.clearInterval(timer)
  }, [active, completedAt, startedAt])
  return (
    <span className="work-indicator" role="status">
      <span>用时 {formatElapsed(elapsed)}</span>
    </span>
  )
}

export function ReasoningPassage({ passage, active = passage.state === 'streaming' }: {
  passage: SessionReasoning
  active?: boolean
}) {
  if (!active) return null
  return (
    <div className="reasoning-passage streaming" role="status">
      <span className="thinking-label">正在思考</span>
    </div>
  )
}

function actionWithDetail(title: string, detail: string | undefined): { title: string; detail?: string } {
  return detail === undefined || detail === '' ? { title } : { title, detail }
}

function toolAction(tool: ToolCard): { title: string; detail?: string } {
  const pending = tool.state === 'pending'
  if (tool.kind === 'read') return actionWithDetail(pending ? '正在读取' : '已读取', tool.path === undefined ? undefined : shortPath(tool.path))
  if (tool.kind === 'diff') return actionWithDetail(pending ? '正在编辑' : '已编辑', tool.path === undefined ? undefined : shortPath(tool.path))
  if (tool.kind === 'terminal') return { title: pending ? '正在运行命令' : '已运行命令' }
  if (tool.kind === 'search') return actionWithDetail(pending ? '正在搜索' : '已搜索', tool.detail)
  if (tool.kind === 'web') return actionWithDetail(pending ? '正在搜索网页' : '已搜索网页', tool.url)
  return { title: pending ? '正在处理' : '已完成操作' }
}

function toolIcon(tool: ToolCard): IconName {
  if (tool.kind === 'terminal') return 'terminal'
  if (tool.kind === 'search' || tool.kind === 'web') return 'search'
  if (tool.kind === 'diff') return 'edit'
  return 'file'
}

export function ToolStep({ tool }: { tool: ToolCard }) {
  const [open, setOpen] = useState(false)
  const action = toolAction(tool)
  const expandable = tool.output !== undefined || tool.diff !== undefined
  return (
    <div className={`tool-step ${tool.state} ${open ? 'open' : ''}`}>
      <button
        className="tool-step-row"
        disabled={!expandable}
        aria-expanded={expandable ? open : undefined}
        onClick={() => setOpen(value => !value)}
      >
        <span className="tool-step-icon"><Icon name={toolIcon(tool)} /></span>
        <span className="tool-step-title">{action.title}</span>
        {action.detail !== undefined && <code title={action.detail}>{action.detail}</code>}
        {tool.state === 'pending' && <span className="sr-only" role="status">进行中</span>}
        {tool.state === 'error' && <span className="tool-step-error">失败</span>}
        {expandable && <span className="tool-step-chevron"><Icon name="chevron" /></span>}
      </button>
      {open && (
        <div className="tool-step-body">
          {tool.diff !== undefined && <DiffView diff={tool.diff} />}
          {tool.output !== undefined && <pre className="tool-output">{tool.output}</pre>}
        </div>
      )}
    </div>
  )
}

function countedChinese(count: number, unit: string): string | undefined {
  return count === 0 ? undefined : `${String(count)} ${unit}`
}

export function summarizeToolActivity(tools: readonly ToolCard[]): string {
  const editedFiles = new Set(tools.filter(tool => tool.kind === 'diff').map(tool => tool.path).filter((path): path is string => path !== undefined)).size
  const exploredFiles = new Set(tools.filter(tool => tool.kind === 'read').map(tool => tool.path).filter((path): path is string => path !== undefined)).size
    || tools.filter(tool => tool.kind === 'read').length
  const searches = tools.filter(tool => tool.kind === 'search').length
  const commands = tools.filter(tool => tool.kind === 'terminal').length
  const webSearches = tools.filter(tool => tool.kind === 'web').length
  const other = tools.filter(tool => tool.kind === 'other').length
  const parts = [
    editedFiles > 0 ? `编辑 ${countedChinese(editedFiles, '个文件')}` : undefined,
    exploredFiles > 0 ? `读取 ${countedChinese(exploredFiles, '个文件')}` : undefined,
    searches > 0 ? `搜索 ${countedChinese(searches, '次')}` : undefined,
    commands > 0 ? `运行 ${countedChinese(commands, '条命令')}` : undefined,
    webSearches > 0 ? `搜索 ${countedChinese(webSearches, '个网页')}` : undefined,
    other > 0 ? `完成 ${countedChinese(other, '项操作')}` : undefined,
  ].filter((part): part is string => part !== undefined)
  return parts.length === 0 ? '完成处理' : parts.join('、')
}

type ActivityTimelineItem =
  | { kind: 'message'; item: SessionMessage }
  | { kind: 'tool'; item: ToolCard }

const TOOLS_PER_ACTIVITY_GROUP = 6

function ToolBatch({ tools, details }: {
  tools: readonly ToolCard[]
  details: readonly ActivityTimelineItem[]
}) {
  const [open, setOpen] = useState(false)
  const failed = tools.some(tool => tool.state === 'error')
  const latestPending = [...tools].reverse().find(tool => tool.state === 'pending')
  const label = latestPending === undefined
    ? summarizeToolActivity(tools)
    : [toolAction(latestPending).title, toolAction(latestPending).detail].filter(Boolean).join(' ')
  return (
    <div className={`tool-batch ${open ? 'open' : ''}`}>
      <button className="tool-batch-row" aria-expanded={open} onClick={() => setOpen(value => !value)}>
        <span className="tool-step-icon"><Icon name={toolIcon(latestPending ?? tools.at(-1)!)} /></span>
        <span role={latestPending === undefined ? undefined : 'status'}>{label}</span>
        {failed && <span className="tool-step-error">包含失败步骤</span>}
        <span className="tool-step-chevron"><Icon name="chevron" /></span>
      </button>
      <div className="tool-batch-collapse" aria-hidden={!open}>
        <div className="tool-batch-details">
          {details.map(entry => entry.kind === 'message'
            ? <div className="stage-response detail" key={entry.item.id}><Message message={entry.item} /></div>
            : <ToolStep key={entry.item.id} tool={entry.item} />)}
        </div>
      </div>
    </div>
  )
}

export function ActivityCard({
  tools,
  reasoning = [],
  messages = [],
  active,
  startedAt = Date.now(),
  completedAt,
}: {
  tools: readonly ToolCard[]
  reasoning?: readonly SessionReasoning[]
  messages?: readonly SessionMessage[]
  active: boolean
  startedAt?: number
  completedAt?: number
}) {
  const rawTrace = [
    ...reasoning.map(item => ({ kind: 'reasoning' as const, item })),
    ...tools.map(item => ({ kind: 'tool' as const, item })),
    ...messages.map(item => ({ kind: 'message' as const, item })),
  ].sort((left, right) => {
    const leftSequence = left.item.sequence ?? Number.MAX_SAFE_INTEGER
    const rightSequence = right.item.sequence ?? Number.MAX_SAFE_INTEGER
    return leftSequence === rightSequence
      ? (left.item.createdAt ?? Number.MAX_SAFE_INTEGER) - (right.item.createdAt ?? Number.MAX_SAFE_INTEGER)
      : leftSequence - rightSequence
  })
  type ActivityGroup = {
    passages: SessionReasoning[]
    items: ActivityTimelineItem[]
    messages: SessionMessage[]
    tools: ToolCard[]
  }
  const groups: ActivityGroup[] = []
  let group: ActivityGroup = { passages: [], items: [], messages: [], tools: [] }
  const flushGroup = () => {
    if (group.passages.length > 0 || group.items.length > 0) groups.push(group)
    group = { passages: [], items: [], messages: [], tools: [] }
  }
  for (const entry of rawTrace) {
    if (entry.kind === 'reasoning') {
      group.passages.push(entry.item)
      continue
    }
    if (entry.kind === 'message') {
      if (group.tools.length >= TOOLS_PER_ACTIVITY_GROUP) flushGroup()
      group.messages.push(entry.item)
      group.items.push(entry)
      continue
    }
    group.tools.push(entry.item)
    group.items.push(entry)
  }
  flushGroup()

  const pendingTool = [...tools].reverse().find(tool => tool.state === 'pending')
  return (
    <div className={`activity-timeline ${active ? 'active' : 'complete'}`} aria-label="工作进展">
      <div className="tool-activity-details">
        {groups.map((activityGroup, index) => {
          const firstMessage = activityGroup.messages.at(0)
          const visibleMessages = activityGroup.tools.length === 0 ? activityGroup.messages : firstMessage === undefined ? [] : [firstMessage]
          const detailItems = firstMessage === undefined
            ? activityGroup.items
            : activityGroup.items.filter(entry => entry.kind !== 'message' || entry.item.id !== firstMessage.id)
          const key = activityGroup.items.at(0)?.item.id
            ?? activityGroup.passages.at(0)?.id
            ?? `activity-${String(index)}`
          return (
            <div className="activity-group" key={key}>
              {visibleMessages.map(message => <div className="stage-response" key={message.id}><Message message={message} /></div>)}
              {activityGroup.tools.length > 0 && <ToolBatch tools={activityGroup.tools} details={detailItems} />}
            </div>
          )
        })}
        {active && pendingTool === undefined && (
          <div className="reasoning-passage streaming" role="status">
            <span className="thinking-label">正在思考</span>
          </div>
        )}
      </div>
      {!active && (
        <div className="activity-duration">
          <WorkIndicator
            startedAt={startedAt}
            active={false}
            {...(completedAt === undefined ? {} : { completedAt })}
          />
        </div>
      )}
    </div>
  )
}

function JobActivity({ job }: { job: SessionRecord['jobs'][number] }) {
  return (
    <div className="activity">
      <div className="activity-head">
        <span className="activity-icon"><Icon name="terminal" /></span>
        <span className="activity-title">后台任务 · {job.label}</span>
        <code>{job.status}</code>
        {(job.status === 'running' || job.status === 'stopping') && <span className="activity-spinner" />}
      </div>
      {job.detail !== undefined && <div className="activity-body"><pre className="tool-output">{job.detail}</pre></div>}
    </div>
  )
}

function AssistantMarkdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
      }}
    >
      {text}
    </ReactMarkdown>
  )
}

function UserMessageText({ text }: { text: string }) {
  if (text === '') return null
  return (
    <div className="user-message-text">
      {splitMentionSegments(text).map((segment, index) => segment.kind === 'mention' ? (
        <span
          aria-label={`项目文件引用 ${segment.value}`}
          className="sent-mention-token"
          key={`${String(index)}-${segment.value}`}
          title="项目文件引用"
        >
          {segment.value}
        </span>
      ) : <React.Fragment key={`${String(index)}-${segment.value}`}>{segment.value}</React.Fragment>)}
    </div>
  )
}

export function Message({ message }: { message: SessionMessage }) {
  if (message.role === 'user') {
    const attachments = message.attachments ?? []
    const clipboardText = message.text || attachments.map(attachment => attachment.name).join('\n')
    if (clipboardText === '' && attachments.length === 0) return null
    return (
      <article className="user-message">
        <div className={`user-bubble${attachments.length > 0 ? ' with-attachments' : ''}${message.text === '' ? ' attachment-only' : ''}`}>
          {attachments.length > 0 && (
            <div aria-label="已发送附件" className="sent-attachments">
              {attachments.map((attachment, index) => (
                <div
                  aria-label={`附件 ${attachment.name}`}
                  className="sent-attachment-card"
                  key={`${attachment.id}-${String(index)}`}
                  title={attachment.name}
                >
                  <span className="sent-attachment-icon"><Icon name="file" /></span>
                  <span className="sent-attachment-copy">
                    <b>{attachment.name}</b>
                    <small>电脑文件 · {formatFileSize(attachment.bytes)}</small>
                  </span>
                </div>
              ))}
            </div>
          )}
          <UserMessageText text={message.text} />
        </div>
        <div className="message-actions">
          <button aria-label="复制" onClick={() => void navigator.clipboard.writeText(clipboardText)}><Icon name="copy" /></button>
          <button aria-label="编辑"><Icon name="edit" /></button>
        </div>
      </article>
    )
  }
  if (message.text === '') return null
  return (
    <article className={`assistant-message ${message.state}`}>
      <div className="assistant-copy">
        <AssistantMarkdown text={message.text} />
        {message.state === 'streaming' && <span className="caret" />}
      </div>
      {message.state !== 'streaming' && (
        <div className="assistant-actions">
          <button aria-label="复制回答" onClick={() => void navigator.clipboard.writeText(message.text)}><Icon name="copy" /></button>
          {message.state === 'interrupted' && <span>回答已中断</span>}
          {message.state === 'error' && <span>回答失败</span>}
        </div>
      )}
    </article>
  )
}

function finalAssistantForTurn(turn: ConversationTurn, active: boolean): SessionMessage | undefined {
  const explicitAnswer = [...turn.assistants].reverse().find(message => message.presentation === 'answer')
  if (explicitAnswer !== undefined) return explicitAnswer
  const latest = turn.assistants.at(-1)
  if (!active) return latest?.presentation === 'activity' ? undefined : latest
  if (latest?.presentation === 'activity') return undefined
  return latest?.state === 'streaming' ? latest : undefined
}

export function ConversationTurnView({ turn, active }: { turn: ConversationTurn; active: boolean }) {
  const finalAssistant = finalAssistantForTurn(turn, active)
  const activityMessages = finalAssistant === undefined
    ? turn.assistants
    : turn.assistants.filter(message => message.id !== finalAssistant.id)
  const activityActive = active && finalAssistant === undefined
  const showActivity = activityActive
    || turn.tools.length > 0
    || turn.reasoning.length > 0
    || activityMessages.length > 0
  const completedAt = finalAssistant?.createdAt
    ?? turn.assistants.at(-1)?.createdAt
    ?? turn.tools.at(-1)?.createdAt
    ?? turn.user.createdAt
  return (
    <section className="conversation-turn">
      <Message message={turn.user} />
      <div className="turn-timeline">
        {showActivity && (
          <ActivityCard
            tools={turn.tools}
            reasoning={turn.reasoning}
            messages={activityMessages}
            active={activityActive}
            startedAt={turn.user.createdAt}
            {...(completedAt === undefined ? {} : { completedAt })}
          />
        )}
        {finalAssistant !== undefined && <Message message={finalAssistant} />}
      </div>
    </section>
  )
}

function InteractionPanel({ interaction, onDone, onError }: {
  interaction: PendingInteraction
  onDone: () => void
  onError: (message: string) => void
}) {
  const [selected, setSelected] = useState<Record<string, string[]>>({})
  const [custom, setCustom] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)

  async function answerApproval(decision: 'allowed-once' | 'rejected') {
    setSubmitting(true)
    try {
      await window.harnessStudio.permissions.answerApproval(interaction.id, decision)
      onDone()
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSubmitting(false)
    }
  }

  async function answerQuestions() {
    if (interaction.kind !== 'questions') return
    const answers: QuestionAnswer[] = interaction.questions.map(question => {
      const customAnswer = custom[question.id]?.trim()
      return {
        id: question.id,
        selected: selected[question.id] ?? [],
        ...(customAnswer ? { custom: customAnswer } : {}),
      }
    })
    setSubmitting(true)
    try {
      await window.harnessStudio.permissions.answerQuestions(interaction.id, answers)
      onDone()
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSubmitting(false)
    }
  }

  if (interaction.kind === 'approval') {
    return (
      <div className="interaction-panel">
        <b>{interaction.toolName} 请求执行权限</b>
        {interaction.reason !== undefined && <p>{interaction.reason}</p>}
        <div className="interaction-actions">
          <button disabled={submitting} onClick={() => void answerApproval('rejected')}>拒绝</button>
          <button className="primary" disabled={submitting} onClick={() => void answerApproval('allowed-once')}>允许一次</button>
        </div>
      </div>
    )
  }
  return (
    <div className="interaction-panel questions">
      {interaction.questions.map(question => (
        <section key={question.id}>
          {question.header !== undefined && <small>{question.header}</small>}
          <b>{question.question}</b>
          {question.detail !== undefined && <p>{question.detail}</p>}
          <div className="question-options">
            {question.options.map(option => {
              const active = selected[question.id]?.includes(option.label) === true
              return (
                <button
                  className={active ? 'active' : ''}
                  key={option.label}
                  onClick={() => setSelected(current => {
                    const values = current[question.id] ?? []
                    return {
                      ...current,
                      [question.id]: question.multiSelect
                        ? active ? values.filter(value => value !== option.label) : [...values, option.label]
                        : [option.label],
                    }
                  })}
                >
                  {option.label}{option.description === undefined ? '' : ` · ${option.description}`}
                </button>
              )
            })}
          </div>
          <input
            placeholder="其他答案（可选）"
            value={custom[question.id] ?? ''}
            onChange={event => setCustom(current => ({ ...current, [question.id]: event.target.value }))}
          />
        </section>
      ))}
      <div className="interaction-actions">
        <button disabled={submitting} onClick={() => void window.harnessStudio.permissions.cancel(interaction.id).then(onDone).catch(reason => onError(reason instanceof Error ? reason.message : String(reason)))}>取消</button>
        <button className="primary" disabled={submitting} onClick={() => void answerQuestions()}>提交答案</button>
      </div>
    </div>
  )
}

/** One selectable or informational row inside the slash menu. */
interface ComposerMenuItem {
  id: string
  section: string
  title: string
  displayTitle?: string
  description: string
  detail?: string
  detailTone?: 'ok' | 'bad' | 'wait' | 'muted'
  staticRow?: boolean
  invocation?: { kind: 'command' | 'skill'; name: string }
  onSelect?: () => void
}

const MCP_STATUS_TONE_CLASS: Record<NonNullable<ComposerMenuItem['detailTone']>, string> = {
  ok: 'ok',
  bad: 'bad',
  wait: 'wait',
  muted: 'muted',
}

function composerMenuIcon(item: ComposerMenuItem): IconName {
  if (item.invocation?.kind === 'skill') return 'brain'
  const name = item.invocation?.name.toLowerCase()
  if (name === 'goal') return 'goal'
  if (name === 'plan') return 'plan'
  return 'terminal'
}

function ComposerMenu({
  items,
  activeId,
  loading,
  menuRef,
  onSelect,
}: {
  items: ComposerMenuItem[]
  activeId: string | undefined
  loading: boolean
  menuRef: React.RefObject<HTMLDivElement>
  onSelect: (item: ComposerMenuItem) => void
}) {
  const sections: { label: string; items: ComposerMenuItem[] }[] = []
  for (const item of items) {
    const section = sections.at(-1)
    if (section !== undefined && section.label === item.section) section.items.push(item)
    else sections.push({ label: item.section, items: [item] })
  }
  return (
    <div className="composer-menu" ref={menuRef} role="listbox" aria-label="命令菜单">
      {loading && items.length === 0 && <div className="composer-menu-empty">正在加载命令…</div>}
      {!loading && items.length === 0 && <div className="composer-menu-empty">没有匹配的命令</div>}
      {sections.map(section => (
        <section key={section.label}>
          <div className="composer-menu-label">{section.label}</div>
          {section.items.map(item => item.staticRow ? (
            <div className="composer-menu-item static" key={item.id}>
              <span className="composer-menu-icon"><Icon name="plugin" /></span>
              <span className="composer-menu-text">
                <b>{item.title}</b>
                <small>{item.description}</small>
              </span>
              {item.detail !== undefined && (
                <span className={`composer-menu-detail ${MCP_STATUS_TONE_CLASS[item.detailTone ?? 'muted']}`}>
                  {item.detail}
                </span>
              )}
            </div>
          ) : (
            <button
              className="composer-menu-item"
              data-active={item.id === activeId}
              key={item.id}
              role="option"
              aria-selected={item.id === activeId}
              aria-label={`${item.title} ${item.description}`}
              onClick={() => onSelect(item)}
            >
              <span className={`composer-menu-icon ${item.section === '技能' ? 'skill' : 'command'}`}>
                <Icon name={composerMenuIcon(item)} />
              </span>
              <span className="composer-menu-text">
                <b>{item.displayTitle ?? item.title}</b>
                <small>{item.description}</small>
              </span>
            </button>
          ))}
        </section>
      ))}
    </div>
  )
}

function FileMentionMenu({
  items,
  activeIndex,
  loading,
  query,
  menuRef,
  onBrowse,
  onSelect,
}: {
  items: MentionCandidate[]
  activeIndex: number
  loading: boolean
  query: string
  menuRef: React.RefObject<HTMLDivElement>
  onBrowse: () => void
  onSelect: (candidate: MentionCandidate) => void
}) {
  return (
    <div className="composer-menu file-menu" ref={menuRef} role="listbox" aria-label="文件菜单">
      <div className="composer-menu-label">添加</div>
      <button
        className="composer-menu-item browse"
        data-active={activeIndex === 0}
        role="option"
        aria-selected={activeIndex === 0}
        aria-label="选择文件和文件夹"
        onClick={onBrowse}
      >
        <span className="composer-menu-icon browse"><Icon name="folder-open" /></span>
        <span className="composer-menu-text">
          <b>文件和文件夹</b>
          <small>从电脑选择</small>
        </span>
      </button>
      <div className="composer-menu-label workspace-label">项目文件</div>
      {loading && items.length === 0 && <div className="composer-menu-empty">正在查找项目文件…</div>}
      {items.map((candidate, index) => (
        <button
          className="composer-menu-item"
          data-active={index + 1 === activeIndex}
          key={`${candidate.kind}:${candidate.path}`}
          role="option"
          aria-selected={index + 1 === activeIndex}
          onClick={() => onSelect(candidate)}
        >
          <span className="composer-menu-icon">
            <Icon name={candidate.kind === 'directory' ? 'folder' : 'file'} />
          </span>
          <span className="composer-menu-text">
            <b>{basename(candidate.path.replace(/\/$/u, '')) || candidate.path}</b>
            <small>{candidate.path}</small>
          </span>
          {candidate.kind === 'directory' && <Icon name="chevron" />}
        </button>
      ))}
      {items.length === 0 && !loading && (
        <div className="composer-menu-empty">
          {query === '' ? '输入名称可查找项目文件' : `没有匹配“${query}”的项目文件`}
        </div>
      )}
    </div>
  )
}

function formatTokens(count: number): string {
  return count.toLocaleString('en-US')
}

function ModelStatusPanel({ sessionId, model, status, onClose }: {
  sessionId: string
  model: string
  status: ContextStatus | undefined
  onClose: () => void
}) {
  const projected = status?.projectedTokens ?? status?.pressureTokens
  const window = status?.contextWindow
  const percent = projected !== undefined && window !== undefined && window > 0
    ? Math.min(100, Math.round(100 * projected / window))
    : undefined
  return (
    <div className="modal-overlay" onClick={onClose}>
      <section className="model-status" role="dialog" aria-label="模型状态" onClick={event => event.stopPropagation()}>
        <header>
          <b>状态</b>
          <button aria-label="关闭" onClick={onClose}>×</button>
        </header>
        <div className="status-row">
          <span>会话 ID</span>
          <code title={sessionId}>{sessionId}</code>
          <button aria-label="复制会话 ID" onClick={() => void navigator.clipboard.writeText(sessionId)}>
            <Icon name="copy" />
          </button>
        </div>
        <div className="status-row">
          <span>模型</span>
          <b>{model}</b>
        </div>
        <div className="status-row">
          <span>上下文用量</span>
          <b>{projected === undefined || window === undefined
            ? '暂无数据'
            : `${formatTokens(projected)} / ${formatTokens(window)}${percent === undefined ? '' : ` · ${String(percent)}%`}`}</b>
        </div>
        {percent !== undefined && (
          <div className="usage-bar" role="img" aria-label={`上下文已使用 ${String(percent)}%`}>
            <span style={{ width: `${String(percent)}%` }} />
          </div>
        )}
        <div className="status-row muted">
          <span>系统 {formatTokens(status?.systemTokens ?? 0)} · 工具 {formatTokens(status?.toolsTokens ?? 0)} · 对话 {formatTokens(status?.messageTokens ?? 0)}</span>
        </div>
        <div className="status-row muted">
          <span>输入 {formatTokens(status?.usage.uncachedInputTokens ?? 0)} · 输出 {formatTokens(status?.usage.outputTokens ?? 0)} · 缓存读取 {formatTokens(status?.usage.cacheReadTokens ?? 0)}</span>
        </div>
        <div className="status-row">
          <span>速率限制</span>
          <b className="muted">暂无数据</b>
        </div>
        <div className="status-section">
          <small>压缩记录</small>
          {status === undefined || status.compactions.length === 0 ? (
            <p className="muted">暂无压缩记录</p>
          ) : status.compactions.slice(0, 5).map(record => (
            <div className="status-row" key={record.id}>
              <span>{new Date(record.startedAt).toLocaleTimeString()}</span>
              <b>{record.status === 'running'
                ? '正在压缩'
                : record.status === 'error'
                  ? '压缩失败'
                  : `已压缩 ${record.shadowedTokenCount === undefined ? '' : `${formatTokens(record.shadowedTokenCount)} token`}`}</b>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

type ComposerInvocation = {
  kind: 'command' | 'skill'
  name: string
  label: string
}

type ComposerMode = 'goal' | 'plan'

const COMPOSER_MODE_COPY: Record<ComposerMode, { label: string; placeholder: string; description: string }> = {
  goal: {
    label: '目标',
    placeholder: '描述你的目标，定义可衡量的成果…',
    description: '持续推进长期任务，直到目标完成或需要你确认',
  },
  plan: {
    label: '计划',
    placeholder: '描述你的任务以生成计划…',
    description: '只分析并制定计划，不执行代码修改',
  },
}

function isComposerMode(name: string): name is ComposerMode {
  return name === 'goal' || name === 'plan'
}

const COMMAND_FAILURE_COPY = [
  '当前已有一个目标。请先点击“目标”退出，再创建新目标。',
  '请输入目标内容后重试。',
  '目标设置失败，请稍后重试。',
  '计划模式切换失败，请稍后重试。',
] as const

const HIDDEN_COMPOSER_COMMANDS = new Set(['compact', 'export', 'feedback', 'permission'])

function commandFailureCopy(reason: unknown): string {
  const detail = reason instanceof Error ? reason.message : String(reason)
  return COMMAND_FAILURE_COPY.find(message => detail.includes(message))
    ?? '命令执行失败，请稍后重试。'
}

type ComposerEntity =
  | {
    id: string
    kind: 'reference'
    label: string
    detail: string
    path: string
    serializedText: string
  }
  | {
    id: string
    kind: 'attachment'
    label: string
    detail: string
    attachment: ComposerFileAttachment
  }

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

function ComposerEntities({ entities, invocation, onRemoveEntity, onRemoveInvocation }: {
  entities: ComposerEntity[]
  invocation: ComposerInvocation | undefined
  onRemoveEntity: (id: string) => void
  onRemoveInvocation: () => void
}) {
  if (entities.length === 0 && invocation === undefined) return null
  return (
    <div className="composer-entities" aria-label="已添加的上下文">
      {invocation !== undefined && (
        <div className={`composer-entity invocation ${invocation.kind}`}>
          <span className="composer-entity-symbol">/</span>
          <span className="composer-entity-copy">
            <b>{invocation.label}</b>
            <small>{invocation.kind === 'skill' ? '技能' : '命令'}</small>
          </span>
          <button aria-label={`移除${invocation.kind === 'skill' ? '技能' : '命令'} ${invocation.label}`} onClick={onRemoveInvocation}>×</button>
        </div>
      )}
      {entities.map(entity => (
        <div className={`composer-entity ${entity.kind}`} key={entity.id} title={entity.detail}>
          <span className="composer-entity-symbol">
            {entity.kind === 'reference' ? '@' : <Icon name="file" />}
          </span>
          <span className="composer-entity-copy">
            <b>{entity.label}</b>
            <small>{entity.detail}</small>
          </span>
          <button aria-label={`移除 ${entity.label}`} onClick={() => onRemoveEntity(entity.id)}>×</button>
        </div>
      ))}
    </div>
  )
}

type WorkspaceViewMode = 'conversation' | 'changes' | 'files'

const WORKSPACE_REFRESH_MS = 1_500

function WorkspaceFileTree({ session, selectedPath, onSelect, onError }: {
  session: SessionRecord
  selectedPath: string | undefined
  onSelect: (path: string) => void
  onError: (message: string) => void
}) {
  const [children, setChildren] = useState<Record<string, WorkspaceTreeEntry[]>>({})
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['']))
  const [loading, setLoading] = useState<Set<string>>(() => new Set())
  const [query, setQuery] = useState('')

  async function load(path: string): Promise<void> {
    if (children[path] !== undefined || loading.has(path)) return
    setLoading(current => new Set(current).add(path))
    try {
      const entries = await window.harnessStudio.workspace.listDirectory('project', session.id, path)
      setChildren(current => ({ ...current, [path]: entries }))
    } catch {
      onError('项目文件读取失败，请确认项目仍可访问。')
    } finally {
      setLoading(current => {
        const next = new Set(current)
        next.delete(path)
        return next
      })
    }
  }

  useEffect(() => {
    setChildren({})
    setExpanded(new Set(['']))
    setQuery('')
    void load('')
  }, [session.id])

  function toggle(entry: WorkspaceTreeEntry): void {
    if (entry.kind === 'file') {
      onSelect(entry.path)
      return
    }
    const opening = !expanded.has(entry.path)
    setExpanded(current => {
      const next = new Set(current)
      if (opening) next.add(entry.path)
      else next.delete(entry.path)
      return next
    })
    if (opening) void load(entry.path)
  }

  function rows(path: string, depth: number): JSX.Element[] {
    return (children[path] ?? []).flatMap(entry => {
      if (query !== '' && !entry.path.toLowerCase().includes(query.toLowerCase())) return []
      const open = expanded.has(entry.path)
      const row = (
        <button
          className={`workspace-tree-row ${selectedPath === entry.path ? 'active' : ''}`}
          key={entry.path}
          style={{ paddingLeft: `${String(12 + depth * 14)}px` }}
          title={entry.path}
          onClick={() => toggle(entry)}
        >
          {entry.kind === 'directory' && <span className={`tree-chevron ${open ? 'open' : ''}`}><Icon name="chevron" /></span>}
          <Icon name={entry.kind === 'directory' ? open ? 'folder-open' : 'folder' : 'file'} />
          <span>{entry.name}</span>
        </button>
      )
      return entry.kind === 'directory' && open
        ? [row, ...rows(entry.path, depth + 1)]
        : [row]
    })
  }

  return (
    <div className="workspace-tree">
      <label className="workspace-filter">
        <Icon name="search" />
        <input aria-label="筛选项目文件" placeholder="筛选文件…" value={query} onChange={event => setQuery(event.target.value)} />
      </label>
      <div className="workspace-tree-scroll">
        {loading.has('') && children[''] === undefined
          ? <div className="workspace-browser-empty">正在读取项目文件…</div>
          : rows('', 0)}
      </div>
    </div>
  )
}

function ContextPanel({
  current,
  contextStatus,
  changes,
  workspaceView,
  selectedPath,
  onCompact,
  onOpenChanges,
  onOpenFiles,
  onSelectChange,
  onSelectFile,
  onError,
}: {
  current: SessionRecord | undefined
  contextStatus: ContextStatus | undefined
  changes: WorkspaceChanges | undefined
  workspaceView: WorkspaceViewMode
  selectedPath: string | undefined
  onCompact: () => void
  onOpenChanges: () => void
  onOpenFiles: () => void
  onSelectChange: (path: string) => void
  onSelectFile: (path: string) => void
  onError: (message: string) => void
}) {
  const project = current === undefined ? '未选择项目' : basename(current.cwd)
  return (
    <aside className="context-panel">
      <section className="context-card workspace-browser-card">
        <header>
          <span title={current?.cwd}>{project}</span>
          {changes?.branch !== undefined && <code title="当前分支"><Icon name="branch" />{changes.branch}</code>}
        </header>
        <button className={`context-row ${workspaceView === 'changes' ? 'active' : ''}`} onClick={onOpenChanges}>
          <Icon name="changes" />
          <span>变更</span>
          <span className="changes-count"><b>+{String(changes?.additions ?? 0)}</b> <i>−{String(changes?.deletions ?? 0)}</i></span>
        </button>
        <button className={`context-row ${workspaceView === 'files' ? 'active' : ''}`} onClick={onOpenFiles}>
          <Icon name="folder-open" />
          <span>文件</span>
          <span className="workspace-file-count">{workspaceView === 'changes' ? String(changes?.files.length ?? 0) : ''}</span>
        </button>
        {workspaceView === 'changes' && (
          <div className="workspace-change-list" aria-label="项目变更文件">
            {changes?.isRepository === false && <div className="workspace-browser-empty">当前项目尚未初始化 Git 仓库</div>}
            {changes?.isRepository === true && changes.files.length === 0 && <div className="workspace-browser-empty">工作区没有未提交的变更</div>}
            {changes?.files.map(file => (
              <button
                className={selectedPath === file.path ? 'active' : ''}
                key={file.path}
                title={file.path}
                onClick={() => onSelectChange(file.path)}
              >
                <span className={`change-mark ${file.kind}`}>{file.kind === 'untracked' ? 'U' : file.kind[0]?.toUpperCase()}</span>
                <span>{file.path}</span>
                <small><b>+{String(file.additions)}</b> <i>−{String(file.deletions)}</i></small>
              </button>
            ))}
          </div>
        )}
        {workspaceView === 'files' && current !== undefined && (
          <WorkspaceFileTree
            session={current}
            selectedPath={selectedPath}
            onSelect={onSelectFile}
            onError={onError}
          />
        )}
      </section>

      {workspaceView === 'conversation' && (
        <section className="source-card context-status-card">
          <header><span>上下文</span><button disabled={current === undefined} onClick={onCompact}>压缩</button></header>
          <div className="source-row">
            <span>占用</span>
            <b>{contextStatus?.contextWindow === undefined
              ? '—'
              : `${String(Math.round(100 * (contextStatus.projectedTokens ?? contextStatus.pressureTokens ?? 0) / contextStatus.contextWindow))}%`}</b>
          </div>
          <div className="source-row muted">
            <span>系统 {String(contextStatus?.systemTokens ?? 0)} · 工具 {String(contextStatus?.toolsTokens ?? 0)} · 对话 {String(contextStatus?.messageTokens ?? 0)}</span>
          </div>
        </section>
      )}
    </aside>
  )
}

function WorkspaceContent({ mode, path, file, diff, loading, onClose }: {
  mode: Exclude<WorkspaceViewMode, 'conversation'>
  path: string | undefined
  file: WorkspaceFileContent | undefined
  diff: WorkspaceFileDiff | undefined
  loading: boolean
  onClose: () => void
}) {
  const title = path ?? (mode === 'changes' ? '项目变更' : '打开文件')
  const diffLines = diff?.patch.split('\n')
  return (
    <section className="workspace-content" aria-label={mode === 'changes' ? '变更查看器' : '文件查看器'}>
      <header>
        <span className="workspace-content-icon"><Icon name={mode === 'changes' ? 'changes' : 'file'} /></span>
        <b title={path}>{title}</b>
        {diff !== undefined && <small><em>+{String(diff.additions)}</em> <i>−{String(diff.deletions)}</i></small>}
        {mode === 'files' && path !== undefined && <small className="workspace-language">{languageLabelForPath(path)}</small>}
        <button aria-label="返回对话" onClick={onClose}>×</button>
      </header>
      <div className="workspace-code-view">
        {loading && <div className="workspace-content-empty">正在读取最新内容…</div>}
        {!loading && path === undefined && (
          <div className="workspace-content-empty">
            <Icon name={mode === 'changes' ? 'changes' : 'folder-open'} />
            <b>{mode === 'changes' ? '选择一个变更文件' : '打开文件'}</b>
            <span>{mode === 'changes' ? '从右侧列表查看实时 Diff' : '从右侧项目目录树中选择文件'}</span>
          </div>
        )}
        {!loading && mode === 'files' && file?.binary === true && <div className="workspace-content-empty">此文件无法以文本方式预览</div>}
        {!loading && mode === 'files' && path !== undefined && file?.binary === false && (
          <SyntaxHighlightedCode path={path} content={file.content} />
        )}
        {!loading && mode === 'changes' && path !== undefined && diffLines !== undefined && (
          <pre className="workspace-code changes">
            {diffLines.map((line, index) => {
              const diffKind = line.startsWith('+++') || line.startsWith('---')
                ? 'meta'
                : line.startsWith('+')
                  ? 'added'
                  : line.startsWith('-')
                    ? 'removed'
                    : line.startsWith('@@')
                      ? 'hunk'
                      : line.startsWith('diff ') || line.startsWith('index ')
                        ? 'meta'
                        : ''
              return (
                <code className={diffKind} key={`${String(index)}-${line}`}>
                  <span>{String(index + 1)}</span>
                  <span>{line || ' '}</span>
                </code>
              )
            })}
          </pre>
        )}
        {!loading && mode === 'changes' && path !== undefined && diff?.patch === '' && (
          <div className="workspace-content-empty">此变更没有可显示的文本 Diff</div>
        )}
        {!loading && mode === 'files' && file?.truncated === true && (
          <div className="workspace-truncated">文件较大，当前显示前 1 MB</div>
        )}
      </div>
    </section>
  )
}

export function CodexApp() {
  const [initialViewState] = useState(readSessionViewState)
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [current, setCurrent] = useState<SessionRecord>()
  const [sessionScope, setSessionScope] = useState<SessionScope>(initialViewState.scope)
  const [modeMenuOpen, setModeMenuOpen] = useState(false)
  const activeScope = useRef<SessionScope>(initialViewState.scope)
  const selectedSessionIds = useRef<Partial<Record<SessionScope, string>>>(initialViewState.selected)
  const [runtimeMode, setRuntimeMode] = useState<'simulation' | 'harness'>('simulation')
  const [contextStatus, setContextStatus] = useState<ContextStatus>()
  const [modelConfiguration, setModelConfiguration] = useState<ModelConfiguration>()
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [modelActionPending, setModelActionPending] = useState(false)
  const [permissionMenuOpen, setPermissionMenuOpen] = useState(false)
  const [permissionActionPending, setPermissionActionPending] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [composerEntities, setComposerEntities] = useState<ComposerEntity[]>([])
  const [composerInvocation, setComposerInvocation] = useState<ComposerInvocation>()
  const [selectedComposerMode, setSelectedComposerMode] = useState<ComposerMode>()
  const [pendingModeMessage, setPendingModeMessage] = useState<{
    sessionId: string
    mode: ComposerMode
    expectedText: string
    message: SessionMessage
  }>()
  const [modeActionPending, setModeActionPending] = useState(false)
  const [composerMenu, setComposerMenu] = useState<
    { kind: 'slash'; token: ActiveSlashToken } | { kind: 'files'; token: ActiveAtToken } | undefined
  >(undefined)
  const [slashItems, setSlashItems] = useState<ComposerMenuItem[]>([])
  const [slashLoading, setSlashLoading] = useState(false)
  const [fileItems, setFileItems] = useState<MentionCandidate[]>([])
  const [filesLoading, setFilesLoading] = useState(false)
  const [pickingFiles, setPickingFiles] = useState(false)
  const [menuActiveIndex, setMenuActiveIndex] = useState(0)
  const [statusOpen, setStatusOpen] = useState(false)
  const [compacting, setCompacting] = useState(false)
  const [compactNotice, setCompactNotice] = useState<{ tone: 'success' | 'muted' | 'error'; text: string }>()
  const [error, setError] = useState<string>()
  const [creatingSession, setCreatingSession] = useState(false)
  const [creatingProjectCwd, setCreatingProjectCwd] = useState<string>()
  const [deletingSessionId, setDeletingSessionId] = useState<string>()
  const [contextOpen, setContextOpen] = useState(true)
  const [workspaceView, setWorkspaceView] = useState<WorkspaceViewMode>('conversation')
  const [workspaceChanges, setWorkspaceChanges] = useState<WorkspaceChanges>()
  const [selectedWorkspacePath, setSelectedWorkspacePath] = useState<string>()
  const [workspaceFile, setWorkspaceFile] = useState<WorkspaceFileContent>()
  const [workspaceDiff, setWorkspaceDiff] = useState<WorkspaceFileDiff>()
  const [workspaceContentLoading, setWorkspaceContentLoading] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [appPage, setAppPage] = useState<'conversation' | 'scheduled-tasks'>('conversation')
  const [pendingInteractions, setPendingInteractions] = useState<PendingInteraction[]>([])
  const conversationViewport = useRef<HTMLElement>(null)
  const conversationPinned = useRef(true)
  const previousSessionId = useRef<string | undefined>(undefined)
  const currentSessionId = useRef<string | undefined>(current?.id)
  currentSessionId.current = current?.id
  const textarea = useRef<HTMLTextAreaElement>(null)
  const composerMenuRef = useRef<HTMLDivElement>(null)
  const harnessCommandNames = useRef<Set<string>>(new Set(['compact']))
  const durablePendingModeMessage = pendingModeMessage !== undefined
    && pendingModeMessage.sessionId === current?.id
    && current.messages.some(message => message.role === 'user' && message.text === pendingModeMessage.expectedText)
  const conversationSession = current === undefined || pendingModeMessage === undefined
    || pendingModeMessage.sessionId !== current.id || durablePendingModeMessage
    ? current
    : { ...current, messages: [...current.messages, pendingModeMessage.message] }
  const conversationTurns = useMemo(
    () => conversationSession === undefined ? [] : buildConversationTurns(conversationSession),
    [conversationSession],
  )

  function rememberView(scope: SessionScope, sessionId?: string): void {
    const selected = { ...selectedSessionIds.current }
    if (sessionId !== undefined) selected[scope] = sessionId
    selectedSessionIds.current = selected
    writeSessionViewState({ scope, selected })
  }

  function forgetSession(scope: SessionScope, sessionId: string): void {
    if (selectedSessionIds.current[scope] !== sessionId) return
    const selected = { ...selectedSessionIds.current }
    delete selected[scope]
    selectedSessionIds.current = selected
    writeSessionViewState({ scope: activeScope.current, selected })
  }

  async function restoreSession(scope: SessionScope, items: SessionSummary[]): Promise<void> {
    const remembered = selectedSessionIds.current[scope]
    const sessionId = remembered !== undefined && items.some(item => item.id === remembered)
      ? remembered
      : items[0]?.id
    if (sessionId === undefined) return
    const session = await window.harnessStudio.sessions.get(scope, sessionId)
    if (activeScope.current !== scope || session === undefined) return
    rememberView(scope, session.id)
    setCurrent(session)
  }

  useEffect(() => {
    let cancelled = false
    const initialScope = activeScope.current
    void window.harnessStudio.sessions.list(initialScope).then(async items => {
      if (cancelled || activeScope.current !== initialScope) return
      setSessions(items)
      await restoreSession(initialScope, items)
    })
    void window.harnessStudio.runtime.mode().then(setRuntimeMode)
    void window.harnessStudio.permissions.listPending().then(setPendingInteractions)
    const unsubscribe = window.harnessStudio.runtime.subscribe(event => {
      if (event.type === 'interaction-requested') {
        setPendingInteractions(current => [
          event.interaction,
          ...current.filter(item => item.id !== event.interaction.id),
        ])
        return
      }
      if (event.type === 'interaction-cancelled') {
        setPendingInteractions(current => current.filter(item => item.id !== event.interactionId))
        return
      }
      if (event.type === 'host-status') return
      if (event.session.scope !== activeScope.current) return
      const summary: SessionSummary = {
        id: event.session.id,
        scope: event.session.scope,
        title: event.session.title,
        cwd: event.session.cwd,
        updatedAt: event.session.updatedAt,
        status: event.session.status,
        preview: event.session.messages.at(-1)?.text ?? '空会话',
      }
      setSessions(existing => [summary, ...existing.filter(item => item.id !== summary.id)]
        .sort((left, right) => right.updatedAt - left.updatedAt))
      setCurrent(active => active?.id === event.session.id ? event.session : active)
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  useEffect(() => window.harnessStudio.application.onOpenSettings(() => {
    setSettingsOpen(true)
  }), [])

  useEffect(() => {
    if (!modeMenuOpen && !modelMenuOpen && !permissionMenuOpen) return
    const closeOutsideMenus = (event: PointerEvent): void => {
      if (!(event.target instanceof Element)) return
      if (event.target.closest('.mode-switcher') === null) setModeMenuOpen(false)
      if (event.target.closest('.model-picker') === null) setModelMenuOpen(false)
      if (event.target.closest('.permission-picker') === null) setPermissionMenuOpen(false)
    }
    document.addEventListener('pointerdown', closeOutsideMenus)
    return () => document.removeEventListener('pointerdown', closeOutsideMenus)
  }, [modeMenuOpen, modelMenuOpen, permissionMenuOpen])

  useLayoutEffect(() => {
    setModelMenuOpen(false)
    setPermissionMenuOpen(false)
    setComposerMenu(undefined)
    setPrompt('')
    setComposerEntities([])
    setComposerInvocation(undefined)
    setSelectedComposerMode(undefined)
    setPendingModeMessage(undefined)
    setCompactNotice(undefined)
    setWorkspaceView('conversation')
    setWorkspaceChanges(undefined)
    setSelectedWorkspacePath(undefined)
    setWorkspaceFile(undefined)
    setWorkspaceDiff(undefined)
  }, [current?.id])

  useEffect(() => {
    if (settingsOpen) return
    void window.harnessStudio.models.getConfiguration().then(setModelConfiguration)
  }, [settingsOpen])

  useLayoutEffect(() => {
    const viewport = conversationViewport.current
    const sessionChanged = previousSessionId.current !== current?.id
    previousSessionId.current = current?.id
    if (sessionChanged) conversationPinned.current = true
    if (viewport !== null && conversationPinned.current) scrollConversationToBottom(viewport)
  }, [current?.id, current?.messages.length])

  useEffect(() => {
    if (selectedComposerMode === 'goal'
      && current?.goalStatus !== undefined
      && current.goalStatus.phase !== 'complete') setSelectedComposerMode(undefined)
    if (selectedComposerMode === 'plan' && (current?.planStatus?.active === true || current?.planStatus?.pending === true)) {
      setSelectedComposerMode(undefined)
    }
  }, [current?.goalStatus, current?.planStatus, selectedComposerMode])

  useEffect(() => {
    if (durablePendingModeMessage) setPendingModeMessage(undefined)
  }, [durablePendingModeMessage])

  useEffect(() => {
    if (current === undefined) {
      setContextStatus(undefined)
      return
    }
    void window.harnessStudio.context.get(current.id).then(setContextStatus).catch(() => setContextStatus(undefined))
  }, [current?.id, current?.updatedAt])

  useEffect(() => {
    if (current === undefined || current.scope !== 'project') {
      setWorkspaceChanges(undefined)
      return
    }
    let cancelled = false
    let reading = false
    const refresh = async (): Promise<void> => {
      if (reading) return
      reading = true
      try {
        const changes = await window.harnessStudio.workspace.changes('project', current.id)
        if (!cancelled) setWorkspaceChanges(changes)
      } catch {
        if (!cancelled) setWorkspaceChanges(undefined)
      } finally {
        reading = false
      }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), WORKSPACE_REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [current?.id, current?.scope])

  useEffect(() => {
    if (current === undefined || selectedWorkspacePath === undefined || workspaceView === 'conversation') {
      setWorkspaceFile(undefined)
      setWorkspaceDiff(undefined)
      setWorkspaceContentLoading(false)
      return
    }
    let cancelled = false
    let reading = false
    let firstRequest = true
    const refresh = async (): Promise<void> => {
      if (reading) return
      reading = true
      if (firstRequest) setWorkspaceContentLoading(true)
      try {
        if (workspaceView === 'changes') {
          const next = await window.harnessStudio.workspace.diff('project', current.id, selectedWorkspacePath)
          if (!cancelled) {
            setWorkspaceDiff(next)
            setWorkspaceFile(undefined)
          }
        } else {
          const next = await window.harnessStudio.workspace.readFile('project', current.id, selectedWorkspacePath)
          if (!cancelled) {
            setWorkspaceFile(next)
            setWorkspaceDiff(undefined)
          }
        }
      } catch {
        if (!cancelled) setError(workspaceView === 'changes'
          ? '文件变更读取失败，请稍后重试。'
          : '文件内容读取失败，请确认文件仍可访问。')
      } finally {
        firstRequest = false
        if (!cancelled) setWorkspaceContentLoading(false)
        reading = false
      }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), WORKSPACE_REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [current?.id, selectedWorkspacePath, workspaceView])

  useEffect(() => {
    const sessionId = current?.id
    if (sessionId === undefined || current?.permissionSelection !== undefined) return
    let cancelled = false
    void window.harnessStudio.permissions.get(sessionId).then(selection => {
      if (cancelled || selection === undefined) return
      setCurrent(session => session?.id === sessionId ? { ...session, permissionSelection: selection } : session)
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [current?.id, current?.permissionSelection])

  async function switchSessionScope(scope: SessionScope) {
    if (scope === activeScope.current) return
    activeScope.current = scope
    rememberView(scope)
    setSessionScope(scope)
    setCurrent(undefined)
    setContextStatus(undefined)
    setError(undefined)
    const items = await window.harnessStudio.sessions.list(scope)
    if (activeScope.current !== scope) return
    setSessions(items)
    await restoreSession(scope, items)
  }

  async function selectSession(sessionId: string) {
    setAppPage('conversation')
    setError(undefined)
    const session = await window.harnessStudio.sessions.get(sessionScope, sessionId)
    if (session === undefined) return
    rememberView(sessionScope, session.id)
    setCurrent(session)
  }

  async function createDailySession() {
    if (creatingSession) return
    setError(undefined)
    setCreatingSession(true)
    setAppPage('conversation')
    try {
      const session = await window.harnessStudio.sessions.create('daily')
      rememberView('daily', session.id)
      setCurrent(session)
      textarea.current?.focus()
    } catch {
      setError('新建对话失败，请稍后重试。')
    } finally {
      setCreatingSession(false)
    }
  }

  async function openProject() {
    if (creatingSession) return
    setError(undefined)
    try {
      const cwd = await window.harnessStudio.workspace.pick()
      if (cwd !== undefined) await createProjectSession(cwd)
    } catch {
      setError('无法打开项目，请确认文件夹仍可访问，然后重试。')
    }
  }

  async function createProjectSession(cwd: string) {
    if (creatingSession) return
    setError(undefined)
    setCreatingSession(true)
    setAppPage('conversation')
    setCreatingProjectCwd(cwd)
    try {
      const session = await window.harnessStudio.sessions.create('project', cwd)
      rememberView('project', session.id)
      setCurrent(session)
      textarea.current?.focus()
    } catch {
      setError('新建任务失败，请确认项目文件夹仍可访问，然后重试。')
    } finally {
      setCreatingProjectCwd(undefined)
      setCreatingSession(false)
    }
  }

  function createSession() {
    return sessionScope === 'daily' ? createDailySession() : openProject()
  }

  async function openScheduledSession(sessionId: string): Promise<void> {
    if (activeScope.current !== 'project') {
      activeScope.current = 'project'
      setSessionScope('project')
    }
    const [items, session] = await Promise.all([
      window.harnessStudio.sessions.list('project'),
      window.harnessStudio.sessions.get('project', sessionId),
    ])
    setSessions(items)
    if (session !== undefined) {
      rememberView('project', session.id)
      setCurrent(session)
      setAppPage('conversation')
    }
  }

  async function deleteSession(sessionId: string) {
    if (deletingSessionId !== undefined) return
    const scope = sessionScope
    setError(undefined)
    setDeletingSessionId(sessionId)
    try {
      await window.harnessStudio.sessions.delete(scope, sessionId)
      forgetSession(scope, sessionId)
      if (activeScope.current !== scope) return
      const remaining = sessions.filter(session => session.id !== sessionId)
      setSessions(existing => existing.filter(session => session.id !== sessionId))
      if (currentSessionId.current === sessionId) {
        setCurrent(undefined)
        setContextStatus(undefined)
        await restoreSession(scope, remaining)
      }
    } catch (reason) {
      const message = reason instanceof Error && reason.message.includes('请先停止当前会话')
        ? '请先停止当前会话，再删除。'
        : '删除会话失败，请稍后重试。'
      setError(message)
    } finally {
      setDeletingSessionId(undefined)
    }
  }

  async function send() {
    if (current === undefined || pickingFiles) return
    const references = composerEntities.flatMap(entity => entity.kind === 'reference'
      ? [{ path: entity.path, serializedText: entity.serializedText }]
      : [])
    const attachments = composerEntities.flatMap(entity => entity.kind === 'attachment'
      ? [entity.attachment]
      : [])
    const directCommand = /^\/([a-z0-9_-]+)(?:\s|$)/iu.exec(prompt.trim())
    const directCommandName = directCommand?.[1]?.toLowerCase()
    const knownDirectCommand = directCommandName !== undefined && harnessCommandNames.current.has(directCommandName)
    if (prompt.trim() === '' && references.length === 0 && attachments.length === 0
      && composerInvocation === undefined && selectedComposerMode === undefined) return

    const previousPrompt = prompt
    const previousEntities = composerEntities
    const previousInvocation = composerInvocation
    const previousMode = selectedComposerMode
    setPrompt('')
    setComposerEntities([])
    setComposerInvocation(undefined)
    setComposerMenu(undefined)
    setError(undefined)
    try {
      if (selectedComposerMode !== undefined || composerInvocation?.kind === 'command' || knownDirectCommand) {
        const command = selectedComposerMode ?? composerInvocation?.name ?? directCommandName!
        const argumentText = selectedComposerMode !== undefined
          ? prompt
          : composerInvocation === undefined && directCommand !== null
            ? prompt.trim().slice(directCommand[0].length).trim()
            : prompt
        const normalizedCommand = command.toLowerCase()
        if (isComposerMode(normalizedCommand)) {
          const submittedText = [
            ...references.map(reference => reference.serializedText),
            argumentText.trim(),
          ].filter(part => part !== '').join(' ')
          const messageId = `pending-mode-${crypto.randomUUID()}`
          setPendingModeMessage({
            sessionId: current.id,
            mode: normalizedCommand,
            expectedText: normalizedCommand === 'goal'
              ? `/goal${submittedText === '' ? '' : ` ${submittedText}`}`
              : submittedText,
            message: {
              id: messageId,
              role: 'user',
              text: submittedText,
              createdAt: Date.now(),
              state: 'complete',
              ...(attachments.length === 0 ? {} : {
                attachments: attachments.map(attachment => ({
                  id: attachment.receiptId,
                  name: attachment.name,
                  bytes: attachment.bytes,
                })),
              }),
            },
          })
        }
        await window.harnessStudio.sessions.command(sessionScope, current.id, {
          command,
          text: argumentText,
          references,
          attachments,
        })
      } else {
        const text = composerInvocation?.kind === 'skill'
          ? `/${composerInvocation.name}${prompt.trim() === '' ? '' : ` ${prompt.trim()}`}`
          : prompt
        await window.harnessStudio.sessions.run(sessionScope, current.id, {
          text,
          references,
          attachments,
        })
      }
    } catch (reason) {
      console.error('Composer submission failed:', reason)
      setPrompt(previousPrompt)
      setComposerEntities(previousEntities)
      setComposerInvocation(previousInvocation)
      setSelectedComposerMode(previousMode)
      setPendingModeMessage(pending => pending?.sessionId === current.id ? undefined : pending)
      setError(previousMode !== undefined || previousInvocation?.kind === 'command' || knownDirectCommand
        ? commandFailureCopy(reason)
        : '消息发送失败，请检查连接后重试。')
    }
  }

  async function cancel() {
    if (current === undefined) return
    await window.harnessStudio.sessions.cancel(sessionScope, current.id)
  }

  async function selectModel(selection: ModelSelection) {
    if (current === undefined || modelActionPending) return
    setError(undefined)
    setModelMenuOpen(false)
    setModelActionPending(true)
    try {
      const selected = await window.harnessStudio.sessions.selectModel(sessionScope, current.id, selection)
      setCurrent(session => session?.id === current.id ? { ...session, modelSelection: selected } : session)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setModelActionPending(false)
    }
  }

  async function selectPermission(preset: string) {
    if (current === undefined || permissionActionPending) return
    setError(undefined)
    setPermissionActionPending(true)
    try {
      await window.harnessStudio.permissions.select(current.id, preset)
      setPermissionMenuOpen(false)
    } catch {
      setError('权限切换失败，请稍后重试。')
    } finally {
      setPermissionActionPending(false)
    }
  }

  async function openStatusPanel() {
    if (current === undefined) return
    setComposerMenu(undefined)
    setPrompt('')
    setStatusOpen(true)
    try {
      setContextStatus(await window.harnessStudio.context.get(current.id))
    } catch {
      setError('状态读取失败，请稍后重试。')
    }
  }

  function openWorkspaceChanges(): void {
    setWorkspaceView('changes')
    setContextOpen(true)
    setWorkspaceFile(undefined)
    if (workspaceChanges?.files.some(file => file.path === selectedWorkspacePath) !== true) {
      setSelectedWorkspacePath(workspaceChanges?.files[0]?.path)
    }
  }

  function openWorkspaceFiles(): void {
    setWorkspaceView('files')
    setContextOpen(true)
    setSelectedWorkspacePath(undefined)
    setWorkspaceFile(undefined)
    setWorkspaceDiff(undefined)
  }

  function closeWorkspaceView(): void {
    setWorkspaceView('conversation')
    setSelectedWorkspacePath(undefined)
    setWorkspaceFile(undefined)
    setWorkspaceDiff(undefined)
  }

  async function compactContext() {
    if (current === undefined || compacting) return
    setError(undefined)
    setCompactNotice({ tone: 'muted', text: '正在压缩上下文…' })
    setCompacting(true)
    try {
      const result = await window.harnessStudio.context.compact(current.id)
      setCompactNotice(result.status === 'unchanged'
        ? { tone: 'muted', text: '当前上下文无需压缩' }
        : { tone: 'success', text: '上下文压缩完成' })
      void window.harnessStudio.context.get(current.id).then(setContextStatus).catch(() => undefined)
    } catch (reason) {
      console.error('Context compaction failed:', reason)
      setCompactNotice({ tone: 'error', text: '上下文压缩失败，请稍后重试。' })
    } finally {
      setCompacting(false)
    }
  }

  async function exitComposerMode(mode: ComposerMode) {
    if (selectedComposerMode === mode) {
      setSelectedComposerMode(undefined)
      return
    }
    if (current === undefined || modeActionPending) return
    setModeActionPending(true)
    setError(undefined)
    try {
      await window.harnessStudio.sessions.command(sessionScope, current.id, {
        command: mode,
        text: mode === 'goal' ? 'clear' : 'off',
        references: [],
        attachments: [],
      })
    } catch (reason) {
      console.error('Mode exit failed:', reason)
      setError(mode === 'goal' ? '退出目标模式失败，请稍后重试。' : '退出计划模式失败，请稍后重试。')
    } finally {
      setModeActionPending(false)
    }
  }

  function updateComposerMenu(text: string, caret: number): void {
    const slash = activeSlashToken(text, caret)
    if (slash !== undefined) {
      setComposerMenu(current => current?.kind === 'slash'
        && current.token.query === slash.query
        && current.token.end === slash.end
        ? current
        : { kind: 'slash', token: slash })
      return
    }
    const lineStart = text.lastIndexOf('\n', Math.max(0, caret - 1)) + 1
    const token = activeAtToken(text.slice(lineStart), caret - lineStart, lineStart)
    if (token !== undefined) {
      setComposerMenu(current => current?.kind === 'files'
        && current.token.start === token.start
        && current.token.query === token.query
        ? current
        : { kind: 'files', token })
      return
    }
    setComposerMenu(undefined)
  }

  const slashQuery = composerMenu?.kind === 'slash' ? composerMenu.token.query.toLowerCase() : undefined
  useEffect(() => {
    if (composerMenu?.kind !== 'slash' || current === undefined) return
    let cancelled = false
    setSlashLoading(true)
    setSlashItems([])
    Promise.all([
      window.harnessStudio.sessions.commands(current.id).catch(() => []),
      window.harnessStudio.skills.list(current.id).catch(() => []),
      window.harnessStudio.mcp.list().catch(() => []),
    ]).then(([commands, skills, servers]) => {
      if (cancelled) return
      harnessCommandNames.current = new Set([
        'compact',
        ...commands.map(command => command.name.toLowerCase()),
      ])
      const items: ComposerMenuItem[] = [
        {
          id: 'app:status',
          section: '命令',
          title: '/status',
          displayTitle: '状态',
          description: '显示会话 ID、上下文用量和速率限制',
          onSelect: () => void openStatusPanel(),
        },
        {
          id: 'app:compact',
          section: '命令',
          title: '/compact',
          displayTitle: '压缩上下文',
          description: '压缩当前对话的上下文',
          onSelect: () => {
            setComposerMenu(undefined)
            setPrompt('')
            void compactContext()
          },
        },
      ]
      for (const command of commands) {
        const commandName = command.name.toLowerCase()
        if (HIDDEN_COMPOSER_COMMANDS.has(commandName)) continue
        const modeCopy = isComposerMode(commandName) ? COMPOSER_MODE_COPY[commandName] : undefined
        items.push({
          id: `cmd:${command.name}`,
          section: '命令',
          title: `/${command.name}`,
          displayTitle: modeCopy?.label ?? command.name,
          description: modeCopy?.description ?? command.description,
          invocation: { kind: 'command', name: command.name },
        })
      }
      for (const skill of skills.filter(candidate => candidate.userInvocable)) {
        items.push({
          id: `skill:${skill.name}`,
          section: '技能',
          title: `/${skill.name}`,
          displayTitle: skill.name,
          description: skill.description,
          invocation: { kind: 'skill', name: skill.name },
        })
      }
      for (const server of servers) {
        items.push({
          id: `mcp:${server.id}`,
          section: 'MCP',
          title: server.serverName,
          description: server.enabled ? 'MCP 服务器' : 'MCP 服务器（未启用）',
          detail: !server.enabled
            ? '未启用'
            : server.status === 'ready'
              ? '连接正常'
              : server.status === 'error'
                ? '连接失败'
                : '正在检测连接',
          detailTone: !server.enabled
            ? 'muted'
            : server.status === 'ready'
              ? 'ok'
              : server.status === 'error'
                ? 'bad'
                : 'wait',
          staticRow: true,
        })
      }
      const normalizedQuery = slashQuery ?? ''
      setSlashItems(normalizedQuery === ''
        ? items
        : items.filter(item => `${item.title} ${item.description}`.toLowerCase().includes(normalizedQuery)))
      setSlashLoading(false)
      setMenuActiveIndex(0)
    })
    return () => { cancelled = true }
  }, [composerMenu?.kind, slashQuery, current?.id])

  useEffect(() => {
    if (composerMenu?.kind !== 'files' || current === undefined) return
    const query = composerMenu.token.query
    let cancelled = false
    setFilesLoading(true)
    const timer = setTimeout(() => {
      void window.harnessStudio.workspace.files(current.id, query).then(items => {
        if (cancelled) return
        setFileItems(items)
        setMenuActiveIndex(0)
        setFilesLoading(false)
      }).catch(() => {
        if (cancelled) return
        setFileItems([])
        setFilesLoading(false)
      })
    }, 120)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [composerMenu, current?.id])

  useEffect(() => {
    if (composerMenu === undefined) return
    const container = composerMenuRef.current
    if (container === null) return
    container.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [menuActiveIndex, composerMenu, slashItems, fileItems])

  const selectableSlashItems = slashItems.filter(item => !item.staticRow)
  const activeSlashId = selectableSlashItems[menuActiveIndex]?.id

  function moveMenuActive(delta: number): void {
    const count = composerMenu?.kind === 'slash'
      ? selectableSlashItems.length
      : fileItems.length + 1
    if (count === 0) return
    setMenuActiveIndex(index => (index + delta + count) % count)
  }

  function acceptSlashItem(item: ComposerMenuItem): void {
    item.onSelect?.()
    if (item.onSelect !== undefined || item.invocation === undefined) return
    const token = composerMenu?.kind === 'slash'
      ? composerMenu.token
      : activeSlashToken(prompt, textarea.current?.selectionStart ?? prompt.length)
    const next = token === undefined ? prompt : prompt.slice(0, token.start) + prompt.slice(token.end)
    setPrompt(next)
    const invocationName = item.invocation.name.toLowerCase()
    if (item.invocation.kind === 'command' && isComposerMode(invocationName)) {
      setSelectedComposerMode(invocationName)
      setComposerInvocation(undefined)
    } else {
      setSelectedComposerMode(undefined)
      setComposerInvocation({
        kind: item.invocation.kind,
        name: item.invocation.name,
        label: item.title.replace(/^\//u, ''),
      })
    }
    setComposerMenu(undefined)
    requestAnimationFrame(() => {
      textarea.current?.focus()
      textarea.current?.setSelectionRange(next.length, next.length)
    })
  }

  function acceptFileCandidate(candidate: MentionCandidate): void {
    if (composerMenu?.kind !== 'files') return
    const token = composerMenu.token
    const insertion = formatFileMention(candidate, token.quoted)
    if (insertion === undefined) return
    if (candidate.kind === 'directory') {
      const next = prompt.slice(0, token.start) + insertion + prompt.slice(token.end)
      const caret = token.start + insertion.length
      setPrompt(next)
      requestAnimationFrame(() => {
        textarea.current?.focus()
        textarea.current?.setSelectionRange(caret, caret)
        updateComposerMenu(next, caret)
      })
      return
    }
    const next = prompt.slice(0, token.start) + prompt.slice(token.end)
    setPrompt(next)
    setComposerEntities(entities => entities.some(entity => entity.kind === 'reference'
      && entity.serializedText === insertion)
      ? entities
      : [...entities, {
        id: crypto.randomUUID(),
        kind: 'reference',
        label: basename(candidate.path),
        detail: `项目文件 · ${candidate.path}`,
        path: candidate.path,
        serializedText: insertion,
      }])
    setComposerMenu(undefined)
    requestAnimationFrame(() => {
      textarea.current?.focus()
      textarea.current?.setSelectionRange(token.start, token.start)
    })
  }

  async function pickFileFromDisk() {
    if (current === undefined || pickingFiles) return
    const sessionId = current.id
    const token = composerMenu?.kind === 'files' ? composerMenu.token : undefined
    const nextPrompt = token === undefined
      ? prompt
      : prompt.slice(0, token.start) + prompt.slice(token.end)
    setComposerMenu(undefined)
    setError(undefined)
    setPickingFiles(true)
    try {
      const attachments = await window.harnessStudio.workspace.pickFiles(sessionScope, sessionId)
      if (currentSessionId.current !== sessionId || attachments.length === 0) return
      setPrompt(nextPrompt)
      setComposerEntities(entities => [
        ...entities,
        ...attachments.map(attachment => ({
          id: crypto.randomUUID(),
          kind: 'attachment' as const,
          label: attachment.name,
          detail: `电脑文件 · ${formatFileSize(attachment.bytes)}`,
          attachment,
        })),
      ])
      requestAnimationFrame(() => {
        textarea.current?.focus()
        const caret = token?.start ?? nextPrompt.length
        textarea.current?.setSelectionRange(caret, caret)
      })
    } catch (reason) {
      console.error('File selection failed:', reason)
      setError('文件添加失败，请确认文件仍可访问，然后重试。')
    } finally {
      setPickingFiles(false)
    }
  }

  const activeSelection = current?.modelSelection ?? modelConfiguration?.defaultSelection
  const addedProviderIds = new Set(modelConfiguration?.profiles.map(profile => profile.id) ?? [])
  const addedModelGroups = modelConfiguration?.groups.filter(group => addedProviderIds.has(group.id)) ?? []
  const addedModels = addedModelGroups.flatMap(group => group.models.map(model => ({
    provider: group.id,
    model,
  })))
  const activeModel = addedModels
    .find(item => item.provider === activeSelection?.provider && item.model.id === activeSelection.model)?.model
  const activePermission = current?.permissionSelection?.options
    .find(option => option.value === current.permissionSelection?.currentValue)
  const pendingInteraction = pendingInteractions.find(item => item.sessionId === current?.id)
  const activeGoal = current?.goalStatus !== undefined && current.goalStatus.phase !== 'complete'
  const activePlan = current?.planStatus === undefined
    ? false
    : current.planStatus.pending
      ? !current.planStatus.active
      : current.planStatus.active
  const composerMode: ComposerMode | undefined = selectedComposerMode
    ?? (activePlan ? 'plan' : activeGoal ? 'goal' : undefined)
  const composerModePersisted = selectedComposerMode === undefined && composerMode !== undefined
  const hasComposerContent = prompt.trim() !== ''
    || composerEntities.length > 0
    || composerInvocation !== undefined
    || selectedComposerMode !== undefined

  if (settingsOpen) return <SimpleModelSettings onClose={() => setSettingsOpen(false)} />

  return (
    <div className={`app-shell ${appPage === 'conversation' && contextOpen && sessionScope === 'project' ? 'context-open' : ''}`}>
      <aside className="sidebar">
        <div className="window-toolbar">
          <button aria-label="切换侧边栏"><Icon name="panel" /></button>
          <button aria-label="后退"><Icon name="arrow-left" /></button>
          <button aria-label="前进" disabled><Icon name="arrow-right" /></button>
        </div>

        <div className="brand-row">
          <div className="mode-switcher">
            <button
              className="brand"
              aria-haspopup="menu"
              aria-expanded={modeMenuOpen}
              onClick={() => setModeMenuOpen(open => !open)}
            >
              {sessionScope === 'daily' ? '日常工作' : '工程开发'}
              <Icon name="chevron" />
            </button>
            {modeMenuOpen && (
              <ModeMenu
                active={sessionScope}
                onSelect={scope => void switchSessionScope(scope)}
                onClose={() => setModeMenuOpen(false)}
              />
            )}
          </div>
          <div className="brand-actions">
            <button aria-label="搜索"><Icon name="search" /></button>
            <button aria-label="通知"><Icon name="bell" /></button>
          </div>
        </div>

        <nav className="primary-nav">
          <button disabled={creatingSession} onClick={() => void createSession()}><Icon name="thread" /><span>新对话</span></button>
          {sessionScope === 'project' && <button><Icon name="pull-request" /><span>Pull Request</span></button>}
          <button className={appPage === 'scheduled-tasks' ? 'active' : ''} onClick={() => setAppPage('scheduled-tasks')}><Icon name="clock" /><span>定时任务</span></button>
          <button><Icon name="plugin" /><span>插件</span></button>
        </nav>

        {sessionScope === 'project' ? (
          <ProjectList
            sessions={sessions}
            currentId={current?.id}
            creatingCwd={creatingProjectCwd}
            deletingId={deletingSessionId}
            onSelect={id => void selectSession(id)}
            onCreateSession={cwd => void createProjectSession(cwd)}
            onDelete={id => void deleteSession(id)}
          />
        ) : (
          <DailyList
            sessions={sessions}
            currentId={current?.id}
            deletingId={deletingSessionId}
            onSelect={id => void selectSession(id)}
            onDelete={id => void deleteSession(id)}
          />
        )}

        <div className="sidebar-account">
          <button onClick={() => setSettingsOpen(true)}><Icon name="settings" /><span>Harness Studio</span></button>
          <button aria-label="帮助"><Icon name="help" /></button>
        </div>
      </aside>

      <main className="workspace">
        <header className="workspace-header">
          <div className="workspace-title">
            <Icon name={appPage === 'scheduled-tasks' ? 'clock' : sessionScope === 'daily' ? 'thread' : 'folder'} />
            <span>{appPage === 'scheduled-tasks' ? '定时任务' : current?.title ?? (sessionScope === 'daily' ? '新对话' : '新任务')}</span>
          </div>
          {appPage === 'conversation' && sessionScope === 'project' && (
            <button
              className={`context-toggle ${contextOpen ? 'active' : ''}`}
              aria-label="切换项目上下文"
              onClick={() => setContextOpen(value => !value)}
            >
              <Icon name="panel" />
            </button>
          )}
        </header>

        {appPage === 'scheduled-tasks' ? (
          <ScheduledTasksPage modelConfiguration={modelConfiguration} onOpenSession={id => void openScheduledSession(id)} />
        ) : workspaceView === 'conversation' ? (
          <section
            className="conversation"
            ref={conversationViewport}
            onScroll={event => { conversationPinned.current = isConversationAtBottom(event.currentTarget) }}
          >
          <div className="conversation-inner">
            {current === undefined ? (
              <div className="empty-thread">
                <h1>{sessionScope === 'daily' ? '开始新对话' : '开始一个任务'}</h1>
                <p>{sessionScope === 'daily'
                  ? '无需选择项目，直接创建会话并开始交流。'
                  : '选择代码项目，然后描述你希望完成的工作。'}</p>
                <button disabled={creatingSession} onClick={() => void createSession()}>
                  <Icon name={sessionScope === 'daily' ? 'thread' : 'folder'} />
                  {creatingSession
                    ? sessionScope === 'daily' ? '正在新建…' : '正在打开…'
                    : sessionScope === 'daily' ? '新建对话' : '打开项目'}
                </button>
              </div>
            ) : conversationSession?.messages.length === 0 ? (
              <div className="empty-thread compact">
                <h1>{sessionScope === 'daily' ? '新对话' : basename(current.cwd)}</h1>
                {sessionScope === 'project' && <p>{shortPath(current.cwd)}</p>}
                <span>{sessionScope === 'daily' ? '在下方输入内容开始交流。' : '在下方输入任务开始工作。'}</span>
              </div>
            ) : (
              <>
                {conversationTurns.map((turn, index) => {
                  const active = current.status === 'running' && index === conversationTurns.length - 1
                  return <ConversationTurnView turn={turn} active={active} key={turn.id} />
                })}
                {current.status === 'running' && current.jobs.some(job => job.status === 'running' || job.status === 'stopping') && (
                  <div className="activity-list">
                    {current.jobs
                      .filter(job => job.status === 'running' || job.status === 'stopping')
                      .map(job => <JobActivity job={job} key={job.id} />)}
                  </div>
                )}
              </>
            )}
            <div />
          </div>
          </section>
        ) : (
          <WorkspaceContent
            mode={workspaceView}
            path={selectedWorkspacePath}
            file={workspaceFile}
            diff={workspaceDiff}
            loading={workspaceContentLoading}
            onClose={closeWorkspaceView}
          />
        )}

        {appPage === 'conversation' && workspaceView === 'conversation' && <div className="composer-dock">
          {error !== undefined && <div className="composer-error">{error}</div>}
          {compactNotice !== undefined && (
            <div className={`composer-notice ${compactNotice.tone}`} role="status">
              {compacting && <span className="composer-notice-spinner" />}
              <span>{compactNotice.text}</span>
              {!compacting && (
                <button aria-label="关闭压缩提示" onClick={() => setCompactNotice(undefined)}>×</button>
              )}
            </div>
          )}
          {pendingInteraction !== undefined && (
            <InteractionPanel
              interaction={pendingInteraction}
              onDone={() => setPendingInteractions(current => current.filter(item => item.id !== pendingInteraction.id))}
              onError={setError}
            />
          )}
          <div className="composer">
            {composerMenu?.kind === 'slash' && (
              <ComposerMenu
                items={slashItems}
                activeId={activeSlashId}
                loading={slashLoading}
                menuRef={composerMenuRef}
                onSelect={acceptSlashItem}
              />
            )}
            {composerMenu?.kind === 'files' && (
              <FileMentionMenu
                items={fileItems}
                activeIndex={menuActiveIndex}
                loading={filesLoading}
                query={composerMenu.token.query}
                menuRef={composerMenuRef}
                onBrowse={() => void pickFileFromDisk()}
                onSelect={acceptFileCandidate}
              />
            )}
            <ComposerEntities
              entities={composerEntities}
              invocation={composerMode === undefined ? composerInvocation : undefined}
              onRemoveEntity={id => setComposerEntities(entities => entities.filter(entity => entity.id !== id))}
              onRemoveInvocation={() => setComposerInvocation(undefined)}
            />
            <div className="composer-input-row">
              <textarea
                ref={textarea}
                rows={1}
              aria-label={sessionScope === 'daily' ? '输入消息' : '描述编程任务'}
              placeholder={current === undefined
                ? sessionScope === 'daily' ? '请先新建一个对话…' : '先打开一个代码项目…'
                : pendingInteraction === undefined
                  ? composerMode === undefined
                    ? sessionScope === 'daily' ? '输入消息，@ 引用文件，/ 使用命令…' : '描述任务，@ 引用文件，/ 使用命令…'
                    : COMPOSER_MODE_COPY[composerMode].placeholder
                  : '请先处理上方请求…'}
              value={prompt}
              disabled={current === undefined || pendingInteraction !== undefined}
              onChange={event => {
                const value = event.target.value
                setPrompt(value)
                const caret = event.target.selectionStart ?? value.length
                updateComposerMenu(value, caret)
              }}
              onSelect={event => {
                const element = event.currentTarget
                updateComposerMenu(element.value, element.selectionStart ?? 0)
              }}
              onKeyDown={event => {
                if (composerMenu !== undefined) {
                  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault()
                    moveMenuActive(event.key === 'ArrowDown' ? 1 : -1)
                    return
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    setComposerMenu(undefined)
                    return
                  }
                  if (event.key === 'Enter' || event.key === 'Tab') {
                    event.preventDefault()
                    if (composerMenu.kind === 'slash') {
                      const item = selectableSlashItems[menuActiveIndex]
                      if (item !== undefined) acceptSlashItem(item)
                    } else if (menuActiveIndex === 0) {
                      void pickFileFromDisk()
                    } else {
                      const candidate = fileItems[menuActiveIndex - 1]
                      if (candidate !== undefined) acceptFileCandidate(candidate)
                    }
                    return
                  }
                }
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void send()
                }
              }}
              />
            </div>
            <div className="composer-bar">
              <div className="composer-options">
                <button
                  aria-label="从电脑添加文件"
                  disabled={current === undefined || pickingFiles}
                  onClick={() => void pickFileFromDisk()}
                >
                  <Icon name="plus" />
                </button>
                <div className="permission-picker">
                  <button
                    className="permission"
                    aria-haspopup="menu"
                    aria-expanded={permissionMenuOpen}
                    disabled={current?.permissionSelection === undefined || permissionActionPending}
                    title={current === undefined
                      ? '请先新建会话'
                      : current.permissionSelection === undefined
                        ? '当前会话未提供权限模式'
                        : permissionActionPending
                          ? '正在切换权限模式'
                          : '切换权限模式'}
                    onClick={() => setPermissionMenuOpen(open => !open)}
                  >
                    <Icon name="shield" />
                    <span>{permissionActionPending
                      ? '正在切换权限…'
                      : activePermission?.name ?? current?.permissionSelection?.currentValue ?? '权限模式'}</span>
                    <Icon name="chevron" />
                  </button>
                  {permissionMenuOpen && current?.permissionSelection !== undefined && (
                    <div className="permission-menu" role="menu">
                      {current.permissionSelection.options.map(option => (
                        <button
                          className={option.value === current.permissionSelection?.currentValue ? 'active' : ''}
                          disabled={option.value === 'custom' || permissionActionPending}
                          key={option.value}
                          role="menuitem"
                          onClick={() => void selectPermission(option.value)}
                        >
                          <span>{option.name}</span>
                          {option.value === current.permissionSelection?.currentValue && <Icon name="check" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {composerMode !== undefined && (
                  <button
                    className={`composer-mode ${composerMode} ${composerModePersisted ? 'active' : 'selected'}`}
                    aria-label={`退出${COMPOSER_MODE_COPY[composerMode].label}模式`}
                    disabled={modeActionPending}
                    title={composerModePersisted
                      ? `已开启${COMPOSER_MODE_COPY[composerMode].label}模式，点击退出`
                      : COMPOSER_MODE_COPY[composerMode].description}
                    onClick={() => void exitComposerMode(composerMode)}
                  >
                    <Icon name={composerMode === 'goal' ? 'goal' : 'plan'} />
                    <span>{COMPOSER_MODE_COPY[composerMode].label}</span>
                    {composerModePersisted && <i aria-hidden="true" />}
                  </button>
                )}
              </div>
              <div className="composer-submit">
                <div className="model-picker">
                  <button
                    type="button"
                    className={`model-name${modelActionPending ? ' pending' : ''}`}
                    disabled={current === undefined || modelActionPending}
                    aria-haspopup="menu"
                    aria-expanded={modelMenuOpen}
                    aria-busy={modelActionPending}
                    onClick={() => setModelMenuOpen(value => !value)}
                  >
                    {activeModel?.name ?? activeSelection?.model ?? (runtimeMode === 'harness' ? '选择模型' : 'Simulation')}
                    <Icon name="chevron" />
                  </button>
                  {modelMenuOpen && current !== undefined && (
                    <div className="model-menu" role="menu" aria-label="模型列表">
                      {addedModels.length === 0 && <div className="model-menu-empty">请先在设置中添加模型</div>}
                      <div className="model-menu-list">
                        {addedModels.map(({ provider, model }) => (
                          <button
                            type="button"
                            className={activeSelection?.provider === provider && activeSelection.model === model.id ? 'active' : ''}
                            key={`${provider}:${model.id}`}
                            aria-pressed={activeSelection?.provider === provider && activeSelection.model === model.id}
                            onClick={() => void selectModel({
                              provider,
                              model: model.id,
                              ...(model.defaultReasoningEffort === undefined
                                ? {}
                                : { reasoningEffort: model.defaultReasoningEffort }),
                            })}
                          >
                            {model.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <span className="effort">高</span>
                {current?.status === 'running' ? (
                  <button className="send-button" aria-label="停止" onClick={() => void cancel()}><Icon name="stop" /></button>
                ) : (
                  <button
                    className="send-button"
                    aria-label="发送"
                    disabled={current === undefined || !hasComposerContent || pickingFiles}
                    onClick={() => void send()}
                  >
                    <Icon name="send" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>}
      </main>

      {appPage === 'conversation' && contextOpen && sessionScope === 'project' && (
        <ContextPanel
          current={current}
          contextStatus={contextStatus}
          changes={workspaceChanges}
          workspaceView={workspaceView}
          selectedPath={selectedWorkspacePath}
          onCompact={() => void compactContext()}
          onOpenChanges={openWorkspaceChanges}
          onOpenFiles={openWorkspaceFiles}
          onSelectChange={path => {
            setWorkspaceView('changes')
            setSelectedWorkspacePath(path)
          }}
          onSelectFile={path => {
            setWorkspaceView('files')
            setSelectedWorkspacePath(path)
          }}
          onError={setError}
        />
      )}

      {statusOpen && current !== undefined && (
        <ModelStatusPanel
          sessionId={current.id}
          model={activeModel?.name ?? activeSelection?.model ?? '—'}
          status={contextStatus}
          onClose={() => setStatusOpen(false)}
        />
      )}
    </div>
  )
}
