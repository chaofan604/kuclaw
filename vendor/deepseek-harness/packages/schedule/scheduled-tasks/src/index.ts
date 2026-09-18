/** Host-scoped persistent scheduled tasks that launch independent Sessions. */
import { randomUUID } from 'node:crypto'
import { mkdirSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Context, Service } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type { SessionPromptRequest } from '@deepseek-ai/dsh-api-session-controller/types'
import { nextCronAt, validateCron } from './cron.ts'
import type {
  ScheduledTask, ScheduledTaskId, ScheduledTaskInput, ScheduledTaskRun, ScheduledTaskRunId,
  ScheduledTaskRunStatus, ScheduledTaskUpdate,
} from './types.ts'

export type * from './types.ts'
export { nextCronAt, validateCron } from './cron.ts'

/** Monotonic SQLite schema version owned by this provider. */
export const SCHEMA_VERSION = 2

declare module '@deepseek-ai/cordis' {
  interface Context { scheduledTasks: ScheduledTasks }
}

interface TaskRow {
  id: string
  name: string
  workspace_path: string
  cron: string
  time_zone: string
  prompt: string
  model_json: string
  preset: string
  enabled: number
  concurrency: 'skip' | 'queue'
  missed_run_policy: 'skip' | 'run-once'
  next_run_at: number
  created_at: number
  updated_at: number
}
interface RunRow {
  id: string
  task_id: string
  scheduled_at: number
  session_id: string | null
  status: ScheduledTaskRunStatus
  started_at: number | null
  finished_at: number | null
  error_code: string | null
  error_message: string | null
}

/** Provider configuration. */
export interface Config {
  /** SQLite file owned by this Host composition. */
  readonly databasePath: string
  /** Maximum duration of one spawned Agent run. */
  readonly maxRuntimeMs?: number
}

type ChangedListener = (taskId?: ScheduledTaskId, runId?: ScheduledTaskRunId) => void

/** SQLite-backed Host service for App-authored recurring Agent tasks. */
export class ScheduledTasks extends Service {
  static inject = ['sessionController']
  static Config: Schema<Config> = Schema.object({
    databasePath: Schema.string().required(),
    maxRuntimeMs: Schema.number().min(60_000).default(86_400_000),
  })

  private readonly database: DatabaseSync
  private readonly maxRuntimeMs: number
  private readonly listeners = new Set<ChangedListener>()
  private readonly activeTasks = new Set<ScheduledTaskId>()
  private readonly activeRuns = new Set<ScheduledTaskRunId>()
  private readonly queuedRuns = new Map<ScheduledTaskId, ScheduledTaskRunId[]>()
  private readonly runTimeouts = new Map<ScheduledTaskRunId, ReturnType<typeof setTimeout>>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private closed = false

  constructor(ctx: Context, config: Config) {
    super(ctx, 'scheduledTasks')
    mkdirSync(dirname(config.databasePath), { recursive: true })
    this.database = new DatabaseSync(config.databasePath)
    this.maxRuntimeMs = config.maxRuntimeMs ?? 86_400_000
    const schema = this.database.prepare('PRAGMA user_version').get() as { user_version: number }
    if (schema.user_version > SCHEMA_VERSION) {
      this.database.close()
      throw new Error(`scheduled-tasks database schema ${String(schema.user_version)} is newer than supported schema ${String(SCHEMA_VERSION)}`)
    }
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS scheduled_tasks (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, workspace_path TEXT NOT NULL,
        cron TEXT NOT NULL, time_zone TEXT NOT NULL, prompt TEXT NOT NULL,
        model_json TEXT NOT NULL, preset TEXT NOT NULL, enabled INTEGER NOT NULL,
        concurrency TEXT NOT NULL, missed_run_policy TEXT NOT NULL,
        next_run_at INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS scheduled_task_runs (
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
        scheduled_at INTEGER NOT NULL, session_id TEXT, status TEXT NOT NULL,
        started_at INTEGER, finished_at INTEGER, error_code TEXT, error_message TEXT
      );
      CREATE INDEX IF NOT EXISTS scheduled_task_due ON scheduled_tasks(enabled, next_run_at);
      CREATE INDEX IF NOT EXISTS scheduled_task_run_history ON scheduled_task_runs(task_id, scheduled_at DESC);
    `)
    if (schema.user_version < 2) {
      this.database.prepare("UPDATE scheduled_tasks SET preset = '' WHERE preset = 'default'").run()
    }
    if (schema.user_version < SCHEMA_VERSION) this.database.exec(`PRAGMA user_version = ${String(SCHEMA_VERSION)}`)
    this.database.prepare('UPDATE scheduled_task_runs SET status = \'failed\', finished_at = ?, error_code = \'host-restarted\', error_message = \'Host restarted before the run completed\' WHERE status IN (\'pending\', \'running\')').run(Date.now())
    ctx.on('agent/status', ({ agent, status }) => {
      const run = this.runForSession(String(agent.id))
      if (run === undefined || status === 'running') return
      this.finish(run, 'succeeded')
    }, { global: true })
    ctx.on('agent/error', ({ agent, error }) => {
      const run = this.runForSession(String(agent.id))
      if (run !== undefined) this.finish(run, 'failed', 'agent-error', error instanceof Error ? error.message : String(error))
    }, { global: true })
    ctx.effect(() => () => { this.dispose() }, 'scheduled-tasks teardown')
    this.recoverMissedRuns()
    this.scheduleWake()
  }

  /**
   * List tasks ordered by next occurrence.
   * @returns every stored task, earliest next occurrence first.
   */
  list(): ScheduledTask[] {
    return (this.database.prepare('SELECT * FROM scheduled_tasks ORDER BY next_run_at, created_at').all() as unknown as TaskRow[]).map(taskFromRow)
  }

  /**
   * Create one persistent task and arm its first occurrence.
   * @param input - user-authored fields; invalid rules, zones, or required fields throw.
   * @returns the stored task with its computed next occurrence.
   */
  create(input: ScheduledTaskInput): ScheduledTask {
    const value = normalizeInput(input)
    const now = Date.now()
    const task: ScheduledTask = {
      id: randomUUID() as ScheduledTaskId, ...value, nextRunAt: nextCronAt(value.cron, value.timeZone, now), createdAt: now, updatedAt: now,
    }
    this.writeTask(task)
    this.changed(task.id)
    this.scheduleWake()
    return task
  }

  /**
   * Update one task without changing its identity or creation time.
   * @param update - task id plus the fields to replace.
   * @returns the stored task with its re-derived next occurrence.
   */
  update(update: ScheduledTaskUpdate): ScheduledTask {
    const current = this.requireTask(update.id)
    const value = normalizeInput({ ...current, ...update })
    const now = Date.now()
    const task: ScheduledTask = { ...current, ...value, nextRunAt: nextCronAt(value.cron, value.timeZone, now), updatedAt: now }
    this.writeTask(task)
    this.changed(task.id)
    this.scheduleWake()
    return task
  }

  /**
   * Enable or pause one task.
   * @param id - task identity.
   * @param enabled - whether the task may fire.
   * @returns the stored task after the change.
   */
  setEnabled(id: ScheduledTaskId, enabled: boolean): ScheduledTask {
    return this.update({ id, enabled })
  }

  /**
   * Delete one idle task and its retained run history.
   * @param id - task identity; a task with an active run is refused.
   */
  remove(id: ScheduledTaskId): void {
    if (this.activeTasks.has(id)) throw new Error('cannot delete a task while it is running')
    if (this.database.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(id).changes === 0) throw new Error('scheduled task not found')
    this.changed(id)
    this.scheduleWake()
  }

  /**
   * Start one independent run immediately without moving its Cron anchor.
   * @param id - task identity.
   * @returns the admitted run, already `skipped` when the task is active under `skip`.
   */
  runNow(id: ScheduledTaskId): ScheduledTaskRun {
    const task = this.requireTask(id)
    return this.admit(task, Date.now())
  }

  /**
   * Cancel one running scheduled execution.
   * @param id - run identity; a settled run is a no-op.
   */
  cancelRun(id: ScheduledTaskRunId): Promise<void> {
    const run = this.requireRun(id)
    if (run.status !== 'pending' && run.status !== 'running') return Promise.resolve()
    if (run.sessionId !== undefined) this.ctx.sessionController.cancel({ sessionId: run.sessionId as never })
    this.finish(run, 'cancelled')
    return Promise.resolve()
  }

  /**
   * List retained run history newest first.
   * @param taskId - task identity.
   * @param limit - maximum rows, bounded to 1..200; defaults to 50.
   * @returns the task's runs, newest scheduled first.
   */
  listRuns(taskId: ScheduledTaskId, limit: number = 50): ScheduledTaskRun[] {
    const bounded = Math.min(200, Math.max(1, Math.floor(limit)))
    return (this.database.prepare('SELECT * FROM scheduled_task_runs WHERE task_id = ? ORDER BY scheduled_at DESC LIMIT ?').all(taskId, bounded) as unknown as RunRow[]).map(runFromRow)
  }

  /**
   * Observe committed task or run changes.
   * @param listener - called after a task or run row is committed.
   * @returns the disposer that stops the observation.
   */
  onChanged(listener: ChangedListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private admit(task: ScheduledTask, scheduledAt: number): ScheduledTaskRun {
    if (this.activeTasks.has(task.id)) {
      const run = this.createRun(task.id, scheduledAt, task.concurrency === 'skip' ? 'skipped' : 'pending')
      if (task.concurrency === 'queue') this.queuedRuns.set(task.id, [...this.queuedRuns.get(task.id) ?? [], run.id])
      return run
    }
    const run = this.createRun(task.id, scheduledAt, 'pending')
    void this.execute(task, run)
    return run
  }

  private async execute(task: ScheduledTask, run: ScheduledTaskRun): Promise<void> {
    this.activeTasks.add(task.id)
    this.activeRuns.add(run.id)
    try {
      if (!statSync(task.workspacePath).isDirectory()) throw new Error('workspace path is not a directory')
      const created = await this.ctx.sessionController.create({
        cwd: task.workspacePath,
        ...(task.preset === '' ? {} : { agentPreset: task.preset }),
      })
      if (!this.activeRuns.has(run.id)) {
        this.ctx.sessionController.cancel({ sessionId: created.sessionId })
        return
      }
      await this.ctx.sessionController.selectModel({ sessionId: created.sessionId, ...task.model })
      if (!this.activeRuns.has(run.id)) {
        this.ctx.sessionController.cancel({ sessionId: created.sessionId })
        return
      }
      const running = this.patchRun(run.id, { status: 'running', sessionId: String(created.sessionId), startedAt: Date.now() })
      const timeout = setTimeout(() => {
        this.ctx.sessionController.cancel({ sessionId: created.sessionId })
        this.finish(running, 'timed-out', 'timeout', 'Scheduled task exceeded its maximum runtime')
      }, this.maxRuntimeMs)
      this.runTimeouts.set(run.id, timeout)
      const requestId = randomUUID() as SessionPromptRequest['requestId']
      await this.ctx.sessionController.prompt({
        requestId, sessionId: created.sessionId, mode: 'queue',
        content: [{ type: 'text', text: task.prompt }], clientTimeZone: task.timeZone,
      }, new AbortController().signal)
    } catch (error: unknown) {
      this.finish(run, 'failed', 'start-failed', error instanceof Error ? error.message : String(error))
    }
  }

  private finish(run: ScheduledTaskRun, status: ScheduledTaskRunStatus, errorCode?: string, errorMessage?: string): void {
    const current = this.requireRun(run.id)
    if (current.status !== 'pending' && current.status !== 'running') return
    const wasActive = this.activeRuns.delete(run.id)
    this.removeQueuedRun(run.taskId, run.id)
    const timeout = this.runTimeouts.get(run.id)
    if (timeout !== undefined) clearTimeout(timeout)
    this.runTimeouts.delete(run.id)
    this.patchRun(run.id, {
      status, finishedAt: Date.now(),
      ...(errorCode === undefined ? {} : { errorCode }),
      ...(errorMessage === undefined ? {} : { errorMessage }),
    })
    if (!wasActive) return
    this.activeTasks.delete(run.taskId)
    const queue = this.queuedRuns.get(run.taskId) ?? []
    const nextId = queue.shift()
    if (queue.length === 0) this.queuedRuns.delete(run.taskId)
    else this.queuedRuns.set(run.taskId, queue)
    if (nextId !== undefined) {
      const nextRun = this.requireRun(nextId)
      void this.execute(this.requireTask(run.taskId), nextRun)
    }
  }

  private removeQueuedRun(taskId: ScheduledTaskId, runId: ScheduledTaskRunId): void {
    const queue = this.queuedRuns.get(taskId)
    if (queue === undefined) return
    const remaining = queue.filter(id => id !== runId)
    if (remaining.length === 0) this.queuedRuns.delete(taskId)
    else this.queuedRuns.set(taskId, remaining)
  }

  private createRun(taskId: ScheduledTaskId, scheduledAt: number, status: ScheduledTaskRunStatus): ScheduledTaskRun {
    const now = Date.now()
    const run: ScheduledTaskRun = {
      id: randomUUID() as ScheduledTaskRunId, taskId, scheduledAt, status,
      ...(status === 'skipped' ? { finishedAt: now, errorCode: 'concurrency-skip' } : {}),
    }
    this.database.prepare(`INSERT INTO scheduled_task_runs
      (id, task_id, scheduled_at, status, finished_at, error_code) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(run.id, taskId, scheduledAt, status, run.finishedAt ?? null, run.errorCode ?? null)
    this.changed(taskId, run.id)
    return run
  }

  private patchRun(id: ScheduledTaskRunId, patch: Partial<ScheduledTaskRun>): ScheduledTaskRun {
    const value = { ...this.requireRun(id), ...patch }
    this.database.prepare(`UPDATE scheduled_task_runs SET session_id = ?, status = ?, started_at = ?,
      finished_at = ?, error_code = ?, error_message = ? WHERE id = ?`)
      .run(
        value.sessionId ?? null, value.status, value.startedAt ?? null, value.finishedAt ?? null,
        value.errorCode ?? null, value.errorMessage ?? null, id,
      )
    this.changed(value.taskId, id)
    return value
  }

  private tick(): void {
    if (this.closed) return
    const now = Date.now()
    const due = (this.database.prepare(`SELECT * FROM scheduled_tasks
      WHERE enabled = 1 AND next_run_at <= ? ORDER BY next_run_at`).all(now) as unknown as TaskRow[]).map(taskFromRow)
    for (const task of due) {
      const scheduledAt = task.nextRunAt
      const next = nextCronAt(task.cron, task.timeZone, now)
      this.database.prepare('UPDATE scheduled_tasks SET next_run_at = ?, updated_at = ? WHERE id = ?').run(next, now, task.id)
      this.admit(task, scheduledAt)
    }
    this.scheduleWake()
  }

  private recoverMissedRuns(): void {
    const now = Date.now()
    const due = this.list().filter(task => task.enabled && task.nextRunAt <= now)
    for (const task of due) {
      const scheduledAt = task.nextRunAt
      const next = nextCronAt(task.cron, task.timeZone, now)
      this.database.prepare('UPDATE scheduled_tasks SET next_run_at = ?, updated_at = ? WHERE id = ?').run(next, now, task.id)
      if (task.missedRunPolicy === 'run-once') this.admit(task, scheduledAt)
      else this.createRun(task.id, scheduledAt, 'skipped')
    }
  }

  private scheduleWake(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    if (this.closed) return
    const row = this.database.prepare(`SELECT next_run_at FROM scheduled_tasks
      WHERE enabled = 1 ORDER BY next_run_at LIMIT 1`).get() as { next_run_at: number } | undefined
    if (row === undefined) return
    this.timer = setTimeout(
      () => { this.tick() },
      Math.min(2_147_000_000, Math.max(0, row.next_run_at - Date.now())),
    )
  }

  private writeTask(task: ScheduledTask): void {
    this.database.prepare(`INSERT INTO scheduled_tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, workspace_path=excluded.workspace_path, cron=excluded.cron,
      time_zone=excluded.time_zone, prompt=excluded.prompt, model_json=excluded.model_json, preset=excluded.preset,
      enabled=excluded.enabled, concurrency=excluded.concurrency, missed_run_policy=excluded.missed_run_policy,
      next_run_at=excluded.next_run_at, updated_at=excluded.updated_at`)
      .run(task.id, task.name, task.workspacePath, task.cron, task.timeZone, task.prompt, JSON.stringify(task.model), task.preset,
        task.enabled ? 1 : 0, task.concurrency, task.missedRunPolicy, task.nextRunAt, task.createdAt, task.updatedAt)
  }

  private requireTask(id: ScheduledTaskId): ScheduledTask {
    const row = this.database.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id) as unknown as TaskRow | undefined
    if (row === undefined) throw new Error('scheduled task not found')
    return taskFromRow(row)
  }

  private requireRun(id: ScheduledTaskRunId): ScheduledTaskRun {
    const row = this.database.prepare('SELECT * FROM scheduled_task_runs WHERE id = ?').get(id) as unknown as RunRow | undefined
    if (row === undefined) throw new Error('scheduled task run not found')
    return runFromRow(row)
  }

  private runForSession(sessionId: string): ScheduledTaskRun | undefined {
    const row = this.database.prepare("SELECT * FROM scheduled_task_runs WHERE session_id = ? AND status = 'running' ORDER BY started_at DESC LIMIT 1").get(sessionId) as unknown as RunRow | undefined
    return row === undefined ? undefined : runFromRow(row)
  }

  private changed(taskId?: ScheduledTaskId, runId?: ScheduledTaskRunId): void {
    for (const listener of this.listeners) {
      try { listener(taskId, runId) } catch (error: unknown) { this.ctx.logger.warn(`scheduled-tasks listener failed: ${String(error)}`) }
    }
  }

  private dispose(): void {
    this.closed = true
    if (this.timer !== undefined) clearTimeout(this.timer)
    for (const timeout of this.runTimeouts.values()) clearTimeout(timeout)
    this.runTimeouts.clear()
    this.listeners.clear()
    this.database.close()
  }
}

function normalizeInput(input: ScheduledTaskInput): Omit<ScheduledTask, 'id' | 'nextRunAt' | 'createdAt' | 'updatedAt'> {
  const name = input.name.trim()
  const workspacePath = input.workspacePath.trim()
  const prompt = input.prompt.trim()
  const cron = input.cron.trim()
  const timeZone = input.timeZone.trim()
  if (name === '' || workspacePath === '' || prompt === '') throw new Error('name, workspacePath, and prompt are required')
  if (input.model.provider.trim() === '' || input.model.model.trim() === '') throw new Error('model provider and id are required')
  validateCron(cron, timeZone)
  return {
    name, workspacePath, prompt, cron, timeZone,
    model: {
      provider: input.model.provider.trim(),
      model: input.model.model.trim(),
      ...(input.model.reasoningEffort === undefined ? {} : { reasoningEffort: input.model.reasoningEffort }),
    },
    preset: input.preset?.trim() || '', enabled: input.enabled ?? true,
    concurrency: input.concurrency ?? 'skip', missedRunPolicy: input.missedRunPolicy ?? 'skip',
  }
}

function taskFromRow(row: TaskRow): ScheduledTask {
  return {
    id: row.id as ScheduledTaskId,
    name: row.name,
    workspacePath: row.workspace_path,
    cron: row.cron,
    timeZone: row.time_zone,
    prompt: row.prompt,
    model: JSON.parse(row.model_json) as ScheduledTask['model'],
    preset: row.preset,
    enabled: row.enabled === 1,
    concurrency: row.concurrency,
    missedRunPolicy: row.missed_run_policy,
    nextRunAt: row.next_run_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
function runFromRow(row: RunRow): ScheduledTaskRun {
  return {
    id: row.id as ScheduledTaskRunId,
    taskId: row.task_id as ScheduledTaskId,
    scheduledAt: row.scheduled_at,
    ...(row.session_id === null ? {} : { sessionId: row.session_id }),
    status: row.status,
    ...(row.started_at === null ? {} : { startedAt: row.started_at }),
    ...(row.finished_at === null ? {} : { finishedAt: row.finished_at }),
    ...(row.error_code === null ? {} : { errorCode: row.error_code }),
    ...(row.error_message === null ? {} : { errorMessage: row.error_message }),
  }
}

export default ScheduledTasks
