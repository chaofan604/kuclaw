import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MockAgentRuntime } from '../src/main/runtime/mock-runtime.js'
import { SessionStore } from '../src/main/runtime/session-store.js'
import type { ScheduledTaskInput } from '../src/shared/contracts.js'

const baseInput: ScheduledTaskInput = {
  name: '每日代码检查',
  workspacePath: '/tmp/project',
  cron: '0 1 * * *',
  timeZone: 'Asia/Shanghai',
  prompt: '检查最近的变更。',
  model: { provider: 'group-a', model: 'model-one' },
}

async function runtime() {
  const directory = await mkdtemp(join(tmpdir(), 'harness-studio-scheduled-'))
  return new MockAgentRuntime(new SessionStore(join(directory, 'sessions.json')))
}

async function waitFor(predicate: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  throw new Error(`timed out waiting for ${message}`)
}

describe('MockAgentRuntime scheduled tasks', () => {
  it('creates a task with a computed next run and rejects invalid cron', async () => {
    const agent = await runtime()
    await expect(agent.createScheduledTask({ ...baseInput, cron: '0 1 * *' })).rejects.toThrow('5 个字段')
    await expect(agent.createScheduledTask({ ...baseInput, timeZone: 'Mars/Olympus' })).rejects.toThrow('时区无效')

    const created = await agent.createScheduledTask(baseInput)
    expect(created.enabled).toBe(true)
    expect(created.concurrency).toBe('skip')
    expect(created.preset).toBe('')
    expect(created.nextRunAt).toBeGreaterThan(Date.now())
    const listed = await agent.listScheduledTasks()
    expect(listed).toHaveLength(1)
    await agent.dispose()
  })

  it('recomputes the next run when the cron changes and supports pausing', async () => {
    const agent = await runtime()
    const created = await agent.createScheduledTask(baseInput)
    const updated = await agent.updateScheduledTask({ id: created.id, cron: '30 2 * * *' })
    expect(updated.cron).toBe('30 2 * * *')
    expect(updated.nextRunAt).toBeGreaterThan(created.nextRunAt)

    const paused = await agent.setScheduledTaskEnabled(created.id, false)
    expect(paused.enabled).toBe(false)
    await expect(agent.updateScheduledTask({ id: 'missing', enabled: true })).rejects.toThrow('not found')
    await agent.dispose()
  })

  it('runs a task immediately in a fresh session bound to the task workspace', async () => {
    const agent = await runtime()
    const created = await agent.createScheduledTask(baseInput)
    const run = await agent.runScheduledTaskNow(created.id)
    expect(run.taskId).toBe(created.id)
    expect(run.status === 'running' || run.status === 'succeeded').toBe(true)
    expect(run.sessionId).toBeDefined()

    const session = run.sessionId === undefined ? undefined : await agent.getSession(run.sessionId)
    expect(session?.cwd).toBe('/tmp/project')

    await waitFor(async () => (await agent.listScheduledTaskRuns(created.id)).every(value => value.status !== 'running'),
      'the run to settle')
    const history = await agent.listScheduledTaskRuns(created.id)
    expect(history).toHaveLength(1)
    expect(['succeeded', 'failed', 'cancelled']).toContain(history[0]?.status)
    await agent.dispose()
  })

  it('cancels a running execution and keeps the history entry', async () => {
    const agent = await runtime()
    const created = await agent.createScheduledTask(baseInput)
    const run = await agent.runScheduledTaskNow(created.id)
    await agent.cancelScheduledTaskRun(run.id)
    const history = await agent.listScheduledTaskRuns(created.id)
    expect(history[0]?.status).toBe('cancelled')
    expect(history[0]?.finishedAt).toBeDefined()
    await agent.dispose()
  })

  it('removes a task together with its run history', async () => {
    const agent = await runtime()
    const created = await agent.createScheduledTask(baseInput)
    await agent.runScheduledTaskNow(created.id)
    await agent.removeScheduledTask(created.id)
    expect(await agent.listScheduledTasks()).toHaveLength(0)
    expect(await agent.listScheduledTaskRuns(created.id)).toHaveLength(0)
    await agent.dispose()
  })
})
