import React, { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type {
  ModelConfiguration, ModelSelection, ScheduledTask, ScheduledTaskInput, ScheduledTaskRun,
} from '../shared/contracts'

const COMMON_TIME_ZONES = ['Asia/Shanghai', 'UTC', 'America/Los_Angeles', 'America/New_York', 'Europe/London']

function dateTime(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(value)
}

function statusLabel(status: ScheduledTaskRun['status']): string {
  return {
    pending: '等待运行', running: '运行中', succeeded: '成功', failed: '失败', cancelled: '已取消',
    'timed-out': '已超时', skipped: '已跳过',
  }[status]
}

function runDuration(run: ScheduledTaskRun): string | undefined {
  if (run.startedAt === undefined) return undefined
  const end = run.finishedAt ?? Date.now()
  const seconds = Math.max(0, Math.round((end - run.startedAt) / 1_000))
  if (seconds < 60) return `${String(seconds)} 秒`
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return remainder === 0 ? `${String(minutes)} 分钟` : `${String(minutes)} 分 ${String(remainder)} 秒`
}

interface Draft {
  id?: string
  name: string
  workspacePath: string
  cron: string
  timeZone: string
  prompt: string
  model: ModelSelection
  enabled: boolean
  concurrency: 'skip' | 'queue'
  missedRunPolicy: 'skip' | 'run-once'
}

function newDraft(configuration: ModelConfiguration | undefined): Draft {
  return {
    name: '', workspacePath: '', cron: '0 1 * * *',
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai',
    prompt: '', model: configuration?.defaultSelection ?? { provider: '', model: '' }, enabled: true,
    concurrency: 'skip', missedRunPolicy: 'skip',
  }
}

function taskDraft(task: ScheduledTask): Draft {
  return { id: task.id, name: task.name, workspacePath: task.workspacePath, cron: task.cron, timeZone: task.timeZone,
    prompt: task.prompt, model: task.model, enabled: task.enabled, concurrency: task.concurrency, missedRunPolicy: task.missedRunPolicy }
}

export function ScheduledTasksPage({ modelConfiguration, onOpenSession }: {
  modelConfiguration: ModelConfiguration | undefined
  onOpenSession: (sessionId: string) => void
}) {
  const [tasks, setTasks] = useState<ScheduledTask[]>([])
  const [historyTaskId, setHistoryTaskId] = useState<string>()
  const [runs, setRuns] = useState<ScheduledTaskRun[]>([])
  const [runsLoading, setRunsLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string>()
  const [draft, setDraft] = useState<Draft>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const historyTask = tasks.find(task => task.id === historyTaskId)
  const enabledCount = tasks.filter(task => task.enabled).length
  const nextTask = tasks
    .filter(task => task.enabled)
    .sort((left, right) => left.nextRunAt - right.nextRunAt)[0]
  const models = useMemo(() => modelConfiguration?.groups.flatMap(group => group.models.map(model => ({
    value: `${group.id}\u0000${model.id}`, provider: group.id, providerName: group.name, model,
  }))) ?? [], [modelConfiguration])

  async function refresh(): Promise<void> {
    try {
      const next = await window.harnessStudio.scheduledTasks.list()
      setTasks(next)
      setHistoryTaskId(current => current !== undefined && next.some(task => task.id === current) ? current : undefined)
      setError(undefined)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '定时任务读取失败')
    }
  }

  useEffect(() => {
    void refresh()
    const unsubscribe = window.harnessStudio.scheduledTasks.subscribe(() => void refresh())
    const timer = setInterval(() => void refresh(), 5_000)
    return () => { unsubscribe(); clearInterval(timer) }
  }, [])

  useEffect(() => {
    if (historyTaskId === undefined) {
      setRuns([])
      setHistoryError(undefined)
      setRunsLoading(false)
      return
    }
    let cancelled = false
    setRunsLoading(true)
    const load = async () => {
      try {
        const next = await window.harnessStudio.scheduledTasks.listRuns(historyTaskId, 50)
        if (!cancelled) {
          setRuns(next)
          setHistoryError(undefined)
        }
      } catch (reason) {
        if (!cancelled) {
          setHistoryError(reason instanceof Error ? reason.message : '运行历史读取失败')
        }
      } finally {
        if (!cancelled) setRunsLoading(false)
      }
    }
    void load()
    const timer = setInterval(() => void load(), 3_000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [historyTaskId])

  useEffect(() => {
    if (historyTaskId === undefined) return
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setHistoryTaskId(undefined)
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [historyTaskId])

  async function save(): Promise<void> {
    if (draft === undefined || busy) return
    setBusy(true)
    setError(undefined)
    try {
      const input: ScheduledTaskInput = {
        name: draft.name, workspacePath: draft.workspacePath, cron: draft.cron, timeZone: draft.timeZone,
        prompt: draft.prompt, model: draft.model, enabled: draft.enabled, concurrency: draft.concurrency,
        missedRunPolicy: draft.missedRunPolicy,
      }
      const task = draft.id === undefined
        ? await window.harnessStudio.scheduledTasks.create(input)
        : await window.harnessStudio.scheduledTasks.update({ id: draft.id, ...input })
      await refresh()
      setDraft(undefined)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败，请检查 Cron、时区和工程目录。')
    } finally { setBusy(false) }
  }

  async function pickWorkspace(): Promise<void> {
    const path = await window.harnessStudio.workspace.pick()
    if (path !== undefined) setDraft(current => current === undefined ? current : { ...current, workspacePath: path })
  }

  return (
    <section className="scheduled-page">
      <header className="scheduled-page-header">
        <div>
          <span className="scheduled-eyebrow">AUTOMATIONS</span>
          <h1>定时任务</h1>
          <p>按计划启动独立 Session 和 Agent，每次运行互不共享上下文。</p>
        </div>
        <button className="scheduled-primary" onClick={() => setDraft(newDraft(modelConfiguration))}>创建定时任务</button>
      </header>
      <div className="scheduled-summary">
        <div><span>任务总数</span><b>{String(tasks.length)}</b></div>
        <div><span>正在调度</span><b>{String(enabledCount)}</b></div>
        <div className="next"><span>最近一次运行</span><b>{nextTask === undefined ? '暂无' : dateTime(nextTask.nextRunAt)}</b></div>
      </div>
      {error !== undefined && <div className="scheduled-error">{error}</div>}
      <div className="scheduled-layout">
        <div className="scheduled-list">
          {tasks.length === 0 && <div className="scheduled-empty"><b>还没有定时任务</b><span>创建后，Harness Host 会负责持久化和调度。</span></div>}
          {tasks.map(task => (
            <article className="scheduled-card" key={task.id}>
              <header className="scheduled-card-title">
                <div><span className="scheduled-card-kicker">SCHEDULED TASK</span><b>{task.name}</b></div>
                <span className={task.enabled ? 'enabled' : 'paused'}>{task.enabled ? '已启用' : '已暂停'}</span>
              </header>
              <div className="scheduled-card-schedule">
                <span>运行计划</span>
                <code>{task.cron}</code>
                <i>{task.timeZone}</i>
              </div>
              <p className="scheduled-card-prompt">{task.prompt}</p>
              <dl className="scheduled-card-meta">
                <div><dt>工程目录</dt><dd title={task.workspacePath}>{task.workspacePath}</dd></div>
                <div><dt>下次运行</dt><dd>{dateTime(task.nextRunAt)}</dd></div>
              </dl>
              <div className="scheduled-card-actions">
                <button className="history" onClick={() => setHistoryTaskId(task.id)}>运行历史</button>
                <button onClick={() => setDraft(taskDraft(task))}>编辑</button>
                <button onClick={() => void window.harnessStudio.scheduledTasks.setEnabled(task.id, !task.enabled)}>{task.enabled ? '暂停' : '恢复'}</button>
                <button onClick={() => void window.harnessStudio.scheduledTasks.runNow(task.id)}>立即运行</button>
                <button className="danger" onClick={() => {
                  if (window.confirm(`删除定时任务“${task.name}”？`)) void window.harnessStudio.scheduledTasks.remove(task.id)
                }}>删除</button>
              </div>
            </article>
          ))}
        </div>
      </div>
      {historyTask !== undefined && createPortal((
        <div className="scheduled-history-backdrop" role="presentation" onMouseDown={event => {
          if (event.target === event.currentTarget) setHistoryTaskId(undefined)
        }}>
          <section className="scheduled-history-modal" role="dialog" aria-modal="true" aria-label={`${historyTask.name} 运行历史`}>
            <header>
              <div>
                <span className="scheduled-eyebrow">RUN HISTORY</span>
                <h2>{historyTask.name}</h2>
                <p><code>{historyTask.cron}</code><span>{historyTask.timeZone}</span></p>
              </div>
              <button type="button" aria-label="关闭运行历史" onClick={() => setHistoryTaskId(undefined)}>×</button>
            </header>
            <div className="scheduled-history-body">
              {runsLoading && runs.length === 0 && <div className="scheduled-history-empty">正在读取运行记录…</div>}
              {!runsLoading && historyError !== undefined && <div className="scheduled-history-error">{historyError}</div>}
              {!runsLoading && historyError === undefined && runs.length === 0 && <div className="scheduled-history-empty">还没有运行记录</div>}
              {runs.map(run => {
                const duration = runDuration(run)
                return (
                  <article className="scheduled-run" key={run.id}>
                    <span className={`run-status ${run.status}`}>{statusLabel(run.status)}</span>
                    <div className="scheduled-run-copy">
                      <b>{dateTime(run.scheduledAt)}</b>
                      <span>{duration === undefined ? '尚未开始' : `耗时 ${duration}`}</span>
                      {run.errorMessage !== undefined && <small title={run.errorMessage}>{run.errorMessage}</small>}
                    </div>
                    <div className="scheduled-run-actions">
                      {run.status === 'running' && <button onClick={() => void window.harnessStudio.scheduledTasks.cancelRun(run.id)}>取消运行</button>}
                      {run.sessionId !== undefined && <button onClick={() => onOpenSession(run.sessionId!)}>打开 Session</button>}
                    </div>
                  </article>
                )
              })}
            </div>
          </section>
        </div>
      ), document.body)}
      {draft !== undefined && createPortal((
        <div className="scheduled-editor-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setDraft(undefined) }}>
          <form className="scheduled-editor" onSubmit={event => { event.preventDefault(); void save() }}>
            <header><div><h2>{draft.id === undefined ? '创建定时任务' : '编辑定时任务'}</h2><p>每次触发都会创建一个新的项目 Session。</p></div><button type="button" aria-label="关闭" onClick={() => setDraft(undefined)}>×</button></header>
            <label><span>任务名称</span><input required value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} placeholder="每日代码检查" /></label>
            <label><span>工程目录</span><div className="scheduled-path-input"><input required readOnly value={draft.workspacePath} placeholder="选择工程目录" /><button type="button" onClick={() => void pickWorkspace()}>选择…</button></div></label>
            <div className="scheduled-form-grid scheduled-timing-grid">
              <label><span>Cron 表达式</span><input required value={draft.cron} onChange={event => setDraft({ ...draft, cron: event.target.value })} placeholder="0 1 * * *" /><small>格式：分 时 日 月 周</small></label>
              <label><span>时区</span><input required list="scheduled-time-zones" value={draft.timeZone} onChange={event => setDraft({ ...draft, timeZone: event.target.value })} /><small>IANA 时区，例如 Asia/Shanghai</small><datalist id="scheduled-time-zones">{COMMON_TIME_ZONES.map(value => <option value={value} key={value} />)}</datalist></label>
            </div>
            <label><span>任务描述 Prompt</span><textarea required rows={7} value={draft.prompt} onChange={event => setDraft({ ...draft, prompt: event.target.value })} placeholder="检查项目最近的变更，运行测试并给出风险报告。" /></label>
            <label><span>运行模型</span><select required value={`${draft.model.provider}\u0000${draft.model.model}`} onChange={event => {
              const [provider, model] = event.target.value.split('\u0000')
              setDraft({ ...draft, model: { provider: provider!, model: model! } })
            }}><option value="">选择模型</option>{models.map(item => <option value={item.value} key={item.value}>{item.providerName} · {item.model.name}</option>)}</select></label>
            <details><summary>运行策略</summary><div className="scheduled-form-grid"><label><span>并发冲突</span><select value={draft.concurrency} onChange={event => setDraft({ ...draft, concurrency: event.target.value as Draft['concurrency'] })}><option value="skip">跳过本次</option><option value="queue">排队运行</option></select></label><label><span>错过运行</span><select value={draft.missedRunPolicy} onChange={event => setDraft({ ...draft, missedRunPolicy: event.target.value as Draft['missedRunPolicy'] })}><option value="skip">跳过</option><option value="run-once">恢复后补跑一次</option></select></label></div></details>
            <footer><button type="button" onClick={() => setDraft(undefined)}>取消</button><button className="scheduled-primary" disabled={busy} type="submit">{busy ? '正在保存…' : '保存任务'}</button></footer>
          </form>
        </div>
      ), document.body)}
    </section>
  )
}
