import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { MockAgentRuntime } from '../src/main/runtime/mock-runtime.js'
import { HarnessRuntimeSupervisor } from '../src/main/runtime/harness-supervisor.js'
import { SessionStore } from '../src/main/runtime/session-store.js'

describe('HarnessRuntimeSupervisor', () => {
  it('replaces a failed Host runtime while keeping sessions and subscribers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'harness-supervisor-'))
    const store = new SessionStore(join(root, 'sessions.json'))
    let fail: ((error: Error) => void) | undefined
    let created = 0
    const supervisor = await HarnessRuntimeSupervisor.create((onFailure) => {
      created += 1
      fail = onFailure
      return Promise.resolve(new MockAgentRuntime(store))
    })
    const phases: string[] = []
    supervisor.subscribe(event => {
      if (event.type === 'host-status') phases.push(event.status.phase)
    })
    const session = await supervisor.createSession(root)
    fail?.(new Error('host crashed'))
    await vi.waitFor(async () => {
      expect(created).toBe(2)
      await expect(supervisor.getHostStatus()).resolves.toEqual({ phase: 'ready' })
    })
    await expect(supervisor.getSession(session.id)).resolves.toMatchObject({ id: session.id })
    expect(phases).toContain('restarting')
    await supervisor.dispose()
  })
})
