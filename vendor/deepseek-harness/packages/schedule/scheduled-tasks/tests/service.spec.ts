import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { ScheduledTasks } from '../src/index.ts'
import type { ScheduledTaskInput } from '../src/types.ts'

const baseInput: ScheduledTaskInput = {
  name: 'daily review',
  workspacePath: '/tmp/scheduled-workspace',
  cron: '0 1 * * *',
  timeZone: 'Asia/Shanghai',
  prompt: 'Review the latest changes.',
  model: { provider: 'deepseek', model: 'deepseek-chat' },
}

/** Fake of the SessionController seam: records calls, keeps prompts pending until released. */
class FakeSessions {
  readonly created: { cwd: string; agentPreset?: string }[] = []
  readonly selections: unknown[] = []
  readonly prompts: unknown[] = []
  private readonly resolvers: Array<() => void> = []

  create(request: { cwd: string; agentPreset?: string }): { sessionId: string } {
    this.created.push(request)
    return { sessionId: `session-${this.created.length}` }
  }

  selectModel(request: unknown): unknown {
    this.selections.push(request)
    return { selected: request }
  }

  async prompt(request: unknown, _signal?: AbortSignal): Promise<unknown> {
    this.prompts.push(request)
    await new Promise<void>(resolve => this.resolvers.push(resolve))
    return { accepted: true }
  }

  cancel(_request: unknown): { accepted: true } {
    this.release()
    return { accepted: true }
  }

  release(): void {
    for (const resolve of this.resolvers) resolve()
    this.resolvers.length = 0
  }
}

/** A booted composition plus the teardown fiber and the real workspace directory tasks point at. */
interface Booted {
  readonly ctx: Context
  readonly fiber: Fiber
  readonly workspace: string
  readonly databasePath: string
  readonly sessions: FakeSessions
}

/** Drain the microtasks the async execute() path needs before side effects land. */
async function flush(): Promise<void> {
  await new Promise(resolve => setImmediate(resolve))
}

async function boot(databasePath?: string): Promise<Booted> {
  const workspace = await mkdtemp(join(tmpdir(), 'scheduled-tasks-'))
  const sessions = new FakeSessions()
  const ctx = new Context()
  ctx.provide('sessionController', sessions as never)
  const path = databasePath ?? join(workspace, 'tasks.sqlite')
  const fiber = await ctx.plugin(ScheduledTasks, { databasePath: path, maxRuntimeMs: 60_000 })
  return { ctx, fiber, workspace, databasePath: path, sessions }
}

function input(booted: Booted, overrides: Partial<ScheduledTaskInput> = {}): ScheduledTaskInput {
  return { ...baseInput, workspacePath: booted.workspace, ...overrides }
}

function idle(ctx: Context, sessionId: string): void {
  ctx.emit('agent/status', { agent: { id: sessionId }, status: 'idle' } as never)
}

describe('ScheduledTasks', () => {
  it('creates a task, computes the next occurrence, and repersists across restarts', async () => {
    const first = await boot()
    const task = first.ctx.scheduledTasks.create(input(first))
    expect(task.enabled).toBe(true)
    expect(task.preset).toBe('')
    expect(task.nextRunAt).toBeGreaterThan(Date.now())
    await first.fiber.dispose()

    const second = await boot(first.databasePath)
    const tasks = second.ctx.scheduledTasks.list()
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ id: task.id, cron: '0 1 * * *', timeZone: 'Asia/Shanghai' })
    const database = new DatabaseSync(first.databasePath)
    expect((database.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(2)
    database.close()
    await second.fiber.dispose()
  })

  it('migrates the legacy default marker to the deployment default', async () => {
    const first = await boot()
    const task = first.ctx.scheduledTasks.create(input(first))
    await first.fiber.dispose()

    const database = new DatabaseSync(first.databasePath)
    database.prepare("UPDATE scheduled_tasks SET preset = 'default' WHERE id = ?").run(task.id)
    database.exec('PRAGMA user_version = 1')
    database.close()

    const second = await boot(first.databasePath)
    expect(second.ctx.scheduledTasks.list()[0]?.preset).toBe('')
    const migrated = new DatabaseSync(first.databasePath)
    expect((migrated.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(2)
    migrated.close()
    await second.fiber.dispose()
  })

  it('rejects invalid input loudly', async () => {
    const booted = await boot()
    expect(() => booted.ctx.scheduledTasks.create(input(booted, { cron: '0 1 * *' }))).toThrow('five fields')
    expect(() => booted.ctx.scheduledTasks.create(input(booted, { timeZone: 'Mars/Olympus' }))).toThrow('IANA')
    expect(() => booted.ctx.scheduledTasks.create(input(booted, { name: '  ' }))).toThrow('required')
    await booted.fiber.dispose()
  })

  it('runs one independent Session per execution and records the outcome', async () => {
    const booted = await boot()
    const task = booted.ctx.scheduledTasks.create(input(booted))
    const run = booted.ctx.scheduledTasks.runNow(task.id)
    await flush()

    expect(booted.sessions.created).toEqual([{ cwd: booted.workspace }])
    expect(booted.sessions.selections).toEqual([{ sessionId: 'session-1', provider: 'deepseek', model: 'deepseek-chat' }])
    expect(booted.sessions.prompts).toHaveLength(1)
    const prompt = booted.sessions.prompts[0] as { content: { type: string; text: string }[] }
    expect(prompt.content).toEqual([{ type: 'text', text: baseInput.prompt }])

    idle(booted.ctx, 'session-1')
    const history = booted.ctx.scheduledTasks.listRuns(task.id)
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({ id: run.id, status: 'succeeded', sessionId: 'session-1' })
    expect(history[0]?.finishedAt).toBeDefined()
    await booted.fiber.dispose()
  })

  it('skips a second run while the task is still active', async () => {
    const booted = await boot()
    const task = booted.ctx.scheduledTasks.create(input(booted))
    const first = booted.ctx.scheduledTasks.runNow(task.id)
    await flush()
    const second = booted.ctx.scheduledTasks.runNow(task.id)

    expect(second.status).toBe('skipped')
    expect(second.errorCode).toBe('concurrency-skip')
    expect(booted.sessions.created).toHaveLength(1)

    booted.sessions.release()
    idle(booted.ctx, 'session-1')
    const settled = booted.ctx.scheduledTasks.listRuns(task.id).filter(run => run.id === first.id)
    expect(settled[0]?.status).toBe('succeeded')
    await booted.fiber.dispose()
  })

  it('queues a second run when the task opts into queueing', async () => {
    const booted = await boot()
    const task = booted.ctx.scheduledTasks.create(input(booted, { concurrency: 'queue' }))
    booted.ctx.scheduledTasks.runNow(task.id)
    await flush()
    const second = booted.ctx.scheduledTasks.runNow(task.id)

    expect(second.status).toBe('pending')
    expect(booted.sessions.created).toHaveLength(1)

    booted.sessions.release()
    idle(booted.ctx, 'session-1')
    await flush()
    expect(booted.sessions.created).toHaveLength(2)

    booted.sessions.release()
    idle(booted.ctx, 'session-2')
    await flush()
    expect(booted.ctx.scheduledTasks.listRuns(task.id).map(run => run.status).sort()).toEqual(['succeeded', 'succeeded'])
    expect(booted.ctx.scheduledTasks.listRuns(task.id).filter(run => run.id === second.id)[0]?.status).toBe('succeeded')
    await booted.fiber.dispose()
  })

  it('cancels a queued run without releasing or restarting the active run', async () => {
    const booted = await boot()
    const task = booted.ctx.scheduledTasks.create(input(booted, { concurrency: 'queue' }))
    const first = booted.ctx.scheduledTasks.runNow(task.id)
    await flush()
    const second = booted.ctx.scheduledTasks.runNow(task.id)

    await booted.ctx.scheduledTasks.cancelRun(second.id)
    expect(booted.sessions.created).toHaveLength(1)
    expect(() => booted.ctx.scheduledTasks.remove(task.id)).toThrow('running')

    booted.sessions.release()
    idle(booted.ctx, 'session-1')
    await flush()

    expect(booted.sessions.created).toHaveLength(1)
    expect(booted.ctx.scheduledTasks.listRuns(task.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: first.id, status: 'succeeded' }),
      expect.objectContaining({ id: second.id, status: 'cancelled' }),
    ]))
    await booted.fiber.dispose()
  })

  it('cancels a live execution and keeps the history entry', async () => {
    const booted = await boot()
    const task = booted.ctx.scheduledTasks.create(input(booted))
    const run = booted.ctx.scheduledTasks.runNow(task.id)
    await flush()
    await booted.ctx.scheduledTasks.cancelRun(run.id)

    expect(booted.sessions.prompts).toHaveLength(1)
    const history = booted.ctx.scheduledTasks.listRuns(task.id).filter(value => value.id === run.id)
    expect(history[0]?.status).toBe('cancelled')
    expect(history[0]?.finishedAt).toBeDefined()
    await booted.fiber.dispose()
  })

  it('refuses to delete a running task and deletes an idle one', async () => {
    const booted = await boot()
    const task = booted.ctx.scheduledTasks.create(input(booted))
    booted.ctx.scheduledTasks.runNow(task.id)
    await flush()
    expect(() => booted.ctx.scheduledTasks.remove(task.id)).toThrow('running')

    booted.sessions.release()
    idle(booted.ctx, 'session-1')
    booted.ctx.scheduledTasks.remove(task.id)
    expect(booted.ctx.scheduledTasks.list()).toHaveLength(0)
    await booted.fiber.dispose()
  })
})
