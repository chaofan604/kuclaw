import React, { useEffect, useMemo, useState } from 'react'
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
  const [selectedId, setSelectedId] = useState<string>()
  const [runs, setRuns] = useState<ScheduledTaskRun[]>([])
  const [draft, setDraft] = useState<Draft>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const selected = tasks.find(task => task.id === selectedId)
  const models = useMemo(() => modelConfiguration?.groups.flatMap(group => group.models.map(model => ({
    value: `${group.id}\u0000${model.id}`, provider: group.id, providerName: group.name, model,
  }))) ?? [], [modelConfiguration])

  async function refresh(): Promise<void> {
    try {
      const next = await window.harnessStudio.scheduledTasks.list()
      setTasks(next)
      setSelectedId(current => current !== undefined && next.some(task => task.id === current) ? current : next[0]?.id)
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
    if (selectedId === undefined) { setRuns([]); return }
    let cancelled = false
    const load = async () => {
      const next = await window.harnessStudio.scheduledTasks.listRuns(selectedId, 50)
      if (!cancelled) setRuns(next)
    }
    void load().catch(() => { if (!cancelled) setRuns([]) })
    const timer = setInterval(() => void load(), 3_000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [selectedId])

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
      setSelectedId(task.id)
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
        <div><h1>定时任务</h1><p>按计划启动独立 Session 和 Agent，每次运行互不共享上下文。</p></div>
        <button className="scheduled-primary" onClick={() => setDraft(newDraft(modelConfiguration))}>创建定时任务</button>
      </header>
      {error !== undefined && <div className="scheduled-error">{error}</div>}
      <div className="scheduled-layout">
        <div className="scheduled-list">
          {tasks.length === 0 && <div className="scheduled-empty"><b>还没有定时任务</b><span>创建后，Harness Host 会负责持久化和调度。</span></div>}
          {tasks.map(task => (
            <article className={`scheduled-card ${task.id === selectedId ? 'active' : ''}`} key={task.id} onClick={() => setSelectedId(task.id)}>
              <div className="scheduled-card-title"><b>{task.name}</b><span className={task.enabled ? 'enabled' : 'paused'}>{task.enabled ? '已启用' : '已暂停'}</span></div>
              <code>{task.cron} · {task.timeZone}</code>
              <p title={task.workspacePath}>{task.workspacePath}</p>
              <small>下次运行：{dateTime(task.nextRunAt)}</small>
              <div className="scheduled-card-actions">
                <button onClick={event => { event.stopPropagation(); setDraft(taskDraft(task)) }}>编辑</button>
                <button onClick={event => { event.stopPropagation(); void window.harnessStudio.scheduledTasks.setEnabled(task.id, !task.enabled) }}>{task.enabled ? '暂停' : '恢复'}</button>
                <button onClick={event => { event.stopPropagation(); void window.harnessStudio.scheduledTasks.runNow(task.id) }}>立即运行</button>
                <button className="danger" onClick={event => {
                  event.stopPropagation()
                  if (window.confirm(`删除定时任务“${task.name}”？`)) void window.harnessStudio.scheduledTasks.remove(task.id)
                }}>删除</button>
              </div>
            </article>
          ))}
        </div>
        <aside className="scheduled-history">
          <h2>{selected === undefined ? '运行历史' : `${selected.name} · 运行历史`}</h2>
          {selected === undefined && <p>选择一个任务查看每次独立执行。</p>}
          {selected !== undefined && runs.length === 0 && <p>还没有运行记录。</p>}
          {runs.map(run => (
            <div className="scheduled-run" key={run.id}>
              <span className={`run-status ${run.status}`}>{statusLabel(run.status)}</span>
              <div><b>{dateTime(run.scheduledAt)}</b>{run.errorMessage !== undefined && <small>{run.errorMessage}</small>}</div>
              {run.status === 'running' && <button onClick={() => void window.harnessStudio.scheduledTasks.cancelRun(run.id)}>取消</button>}
              {run.sessionId !== undefined && <button onClick={() => onOpenSession(run.sessionId!)}>打开 Session</button>}
            </div>
          ))}
        </aside>
      </div>
      {draft !== undefined && (
        <div className="scheduled-editor-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setDraft(undefined) }}>
          <form className="scheduled-editor" onSubmit={event => { event.preventDefault(); void save() }}>
            <header><div><h2>{draft.id === undefined ? '创建定时任务' : '编辑定时任务'}</h2><p>每次触发都会创建一个新的项目 Session。</p></div><button type="button" aria-label="关闭" onClick={() => setDraft(undefined)}>×</button></header>
            <label><span>任务名称</span><input required value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} placeholder="每日代码检查" /></label>
            <label><span>工程目录</span><div className="scheduled-path-input"><input required readOnly value={draft.workspacePath} placeholder="选择工程目录" /><button type="button" onClick={() => void pickWorkspace()}>选择…</button></div></label>
            <div className="scheduled-form-grid">
              <label><span>Cron 表达式</span><input required value={draft.cron} onChange={event => setDraft({ ...draft, cron: event.target.value })} placeholder="0 1 * * *" /><small>格式：分 时 日 月 周</small></label>
              <label><span>时区</span><input required list="scheduled-time-zones" value={draft.timeZone} onChange={event => setDraft({ ...draft, timeZone: event.target.value })} /><datalist id="scheduled-time-zones">{COMMON_TIME_ZONES.map(value => <option value={value} key={value} />)}</datalist></label>
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
      )}
    </section>
  )
}
