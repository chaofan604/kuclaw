import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { SessionRecord, SessionSummary, ToolCard } from '../shared/contracts'
import { isConversationAtBottom, scrollConversationToBottom } from './conversation-scroll'

function Icon({ name }: { name: 'plus' | 'folder' | 'send' | 'stop' | 'chevron' | 'spark' | 'terminal' | 'file' | 'git' }) {
  const paths: Record<string, JSX.Element> = {
    plus: <path d="M12 5v14M5 12h14" />,
    folder: <path d="M3.5 7.5h6l2-2h9v13h-17z" />,
    send: <path d="M12 19V5m0 14-6-6m6 6 6-6" />,
    stop: <rect x="7" y="7" width="10" height="10" rx="1.5" />,
    chevron: <path d="m9 6 6 6-6 6" />,
    spark: <path d="m12 4 1.5 5L19 10.5l-5.5 1.5L12 17l-1.5-5L5 10.5 10.5 9z" />,
    terminal: <path d="m5 7 4 4-4 4m7 0h7" />,
    file: <path d="M7 3h7l4 4v14H7z M14 3v4h4" />,
    git: <path d="M6 6a2 2 0 1 0 .001 0zM18 9a2 2 0 1 0 .001 0zM6 8v8a3 3 0 0 0 3 3h6m3-8v5a3 3 0 0 1-3 3" />,
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  )
}

function shortPath(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : path
}

function relativeTime(timestamp: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000))
  if (seconds < 60) return '刚刚'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} 小时前`
  return new Date(timestamp).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

function toolIcon(kind: ToolCard['kind']) {
  if (kind === 'terminal') return <Icon name="terminal" />
  if (kind === 'diff') return <Icon name="git" />
  return <Icon name="file" />
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

function ToolRow({ tool }: { tool: ToolCard }) {
  const [open, setOpen] = useState(false)
  const hasBody = tool.diff !== undefined || tool.output !== undefined
  const status = tool.state === 'pending'
    ? <span className="tool-status running"><span className="spinner" />运行中</span>
    : tool.state === 'error'
      ? <span className="tool-status error">已停止</span>
      : <span className="tool-status">完成</span>
  return (
    <div className={`tool-row ${open ? 'open' : ''}`}>
      <button className="tool-row-head" onClick={() => hasBody && setOpen(value => !value)} disabled={!hasBody}>
        <span className="tool-row-icon">{toolIcon(tool.kind)}</span>
        <span className="tool-row-title">{tool.title}</span>
        {tool.path !== undefined && <code className="tool-row-path">{tool.path}</code>}
        {hasBody && <span className="tool-row-chevron"><Icon name="chevron" /></span>}
        {status}
      </button>
      {open && (
        <div className="tool-row-body">
          {tool.detail !== '' && <p>{tool.detail}</p>}
          {tool.url !== undefined && <p>{tool.statusCode === undefined ? tool.url : `${String(tool.statusCode)} · ${tool.url}`}</p>}
          {tool.total !== undefined && <p>{String(tool.total)} 条结果{tool.truncated === true ? '（已截断）' : ''}</p>}
          {tool.exitCode !== undefined && <p>退出码 {String(tool.exitCode)}</p>}
          {tool.signal !== undefined && <p>信号 {tool.signal}</p>}
          {tool.output !== undefined && <pre className="tool-output">{tool.output}</pre>}
          {tool.diff !== undefined && <DiffView diff={tool.diff} />}
        </div>
      )}
    </div>
  )
}

function Message({ role, text, state, time }: { role: 'user' | 'assistant'; text: string; state: string; time: number }) {
  if (role === 'user') {
    return (
      <div className="msg-user">
        <p>{text}</p>
      </div>
    )
  }
  return (
    <div className="msg-assistant">
      <p className="msg-time">{new Date(time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</p>
      <div className="msg-text">
        {text || <span className="msg-thinking">思考中<span className="dots" /></span>}
        {state === 'streaming' && text !== '' && <span className="caret" />}
      </div>
    </div>
  )
}

export function App() {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [current, setCurrent] = useState<SessionRecord>()
  const [runtimeMode, setRuntimeMode] = useState<'simulation' | 'harness'>('simulation')
  const [prompt, setPrompt] = useState('')
  const [error, setError] = useState<string>()
  const streamViewport = useRef<HTMLDivElement>(null)
  const streamPinned = useRef(true)
  const previousSessionId = useRef<string | undefined>(undefined)
  const textarea = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    void window.harnessStudio.sessions.list('project').then(setSessions)
    void window.harnessStudio.runtime.mode().then(setRuntimeMode)
    return window.harnessStudio.runtime.subscribe(event => {
      if (event.type !== 'session-updated') return
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
  }, [])

  useLayoutEffect(() => {
    const viewport = streamViewport.current
    const sessionChanged = previousSessionId.current !== current?.id
    previousSessionId.current = current?.id
    if (sessionChanged) streamPinned.current = true
    if (viewport !== null && streamPinned.current) scrollConversationToBottom(viewport)
  }, [current?.id, current?.messages.length])

  async function selectSession(sessionId: string) {
    setError(undefined)
    setCurrent(await window.harnessStudio.sessions.get('project', sessionId))
  }

  async function createProject() {
    setError(undefined)
    const cwd = await window.harnessStudio.workspace.pick()
    if (cwd === undefined) return
    setCurrent(await window.harnessStudio.sessions.create('project', cwd))
    textarea.current?.focus()
  }

  async function send() {
    if (current === undefined || prompt.trim() === '') return
    const next = prompt
    setPrompt('')
    setError(undefined)
    try {
      await window.harnessStudio.sessions.run('project', current.id, {
        text: next,
        references: [],
        attachments: [],
      })
    } catch (reason) {
      setPrompt(next)
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const runningTools = useMemo(() => current?.tools.filter(tool => tool.state === 'pending').length ?? 0, [current?.tools])

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-drag" />
        <button className="new-task" onClick={() => void createProject()}>
          <Icon name="plus" /> 新任务
        </button>
        <div className="session-list">
          {sessions.length > 0 && <div className="list-label">最近</div>}
          {sessions.map(session => (
            <button
              className={`session-item ${current?.id === session.id ? 'active' : ''}`}
              key={session.id}
              onClick={() => void selectSession(session.id)}
              title={session.cwd}
            >
              <span className="session-title">{session.title}</span>
              <span className="session-meta">{relativeTime(session.updatedAt)}</span>
            </button>
          ))}
        </div>
        <div className="sidebar-foot">
          <span className={`mode-dot ${runtimeMode}`} />
          <span>{runtimeMode === 'simulation' ? '模拟运行时' : 'Harness 已连接'}</span>
        </div>
      </aside>

      <main className="chat">
        <header className="chat-head">
          <div className="chat-head-drag" />
          {current === undefined ? (
            <span className="chat-title">Harness Studio</span>
          ) : (
            <span className="chat-title" title={current.cwd}>
              {current.title}
              <code className="chat-cwd">{shortPath(current.cwd)}</code>
            </span>
          )}
        </header>

        {current === undefined ? (
          <div className="welcome">
            <div className="welcome-inner">
              <h1>有什么可以帮你？</h1>
              <p>打开一个代码项目，把任务交给 Agent。它会读代码、改文件、跑命令，每一步都可以审阅。</p>
              <button className="welcome-open" onClick={() => void createProject()}>
                <Icon name="folder" /> 打开代码项目
              </button>
            </div>
          </div>
        ) : (
          <>
            <div
              className="stream"
              ref={streamViewport}
              onScroll={event => { streamPinned.current = isConversationAtBottom(event.currentTarget) }}
            >
              <div className="stream-inner">
                {current.messages.length === 0 && (
                  <div className="stream-empty">输入任务开始，比如“先介绍一下这个项目的结构”。</div>
                )}
                {current.messages.map(message => (
                  <Message role={message.role} text={message.text} state={message.state} time={message.createdAt} key={message.id} />
                ))}
                {current.tools.map(tool => <ToolRow tool={tool} key={tool.id} />)}
                {current.status === 'running' && runningTools === 0 && current.messages.at(-1)?.state === 'streaming' && (
                  <div className="stream-hint">正在工作…</div>
                )}
                <div />
              </div>
            </div>

            <div className="composer-area">
              {error !== undefined && <div className="composer-error">{error}</div>}
              <div className="composer">
                <textarea
                  ref={textarea}
                  rows={1}
                  aria-label="描述编程任务"
                  placeholder="描述任务…"
                  value={prompt}
                  onChange={event => setPrompt(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      void send()
                    }
                  }}
                />
                <div className="composer-foot">
                  <span className="composer-hint">↵ 发送 · ⇧↵ 换行</span>
                  {current.status === 'running' ? (
                    <button className="btn-stop" onClick={() => void cancel()}><Icon name="stop" /> 停止</button>
                  ) : (
                    <button className="btn-send" disabled={prompt.trim() === ''} onClick={() => void send()}>
                      <Icon name="send" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  )

  async function cancel() {
    if (current === undefined) return
    await window.harnessStudio.sessions.cancel('project', current.id)
  }
}
