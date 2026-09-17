import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MockAgentRuntime } from '../src/main/runtime/mock-runtime.js'
import { SessionStore } from '../src/main/runtime/session-store.js'

async function runtime() {
  const directory = await mkdtemp(join(tmpdir(), 'harness-studio-'))
  return new MockAgentRuntime(new SessionStore(join(directory, 'sessions.json')))
}

describe('MockAgentRuntime', () => {
  it('stages clipboard image bytes as a composer attachment', async () => {
    const agent = await runtime()
    const session = await agent.createSession('/tmp/project')
    await expect(agent.uploadImage(session.id, {
      name: 'pasted.png',
      mediaType: 'image/png',
      bytes: new Uint8Array([1, 2, 3, 4]),
    })).resolves.toMatchObject({
      name: 'pasted.png',
      bytes: 4,
    })
    await agent.dispose()
  })

  it('streams a complete session and persists it for another store instance', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'harness-studio-persist-'))
    const file = join(directory, 'sessions.json')
    const first = new MockAgentRuntime(new SessionStore(file))
    const session = await first.createSession(directory)
    await first.run(session.id, {
      text: '建立运行时适配层',
      references: [{ path: 'src/main.ts', serializedText: '@src/main.ts' }],
      attachments: [{ receiptId: 'receipt-brief', name: 'brief.pdf', bytes: 42 }],
    })
    await new Promise<void>(resolve => {
      const unsubscribe = first.subscribe(event => {
        if (event.session.id === session.id && event.session.status === 'idle') {
          unsubscribe()
          resolve()
        }
      })
    })
    await first.dispose()

    const restored = await new SessionStore(file).get(session.id)
    expect(restored?.messages).toHaveLength(2)
    expect(restored?.messages[0]).toMatchObject({
      role: 'user',
      text: '@src/main.ts 建立运行时适配层',
      attachments: [{ id: 'receipt-brief', name: 'brief.pdf', bytes: 42 }],
    })
    expect(restored?.messages.at(-1)?.state).toBe('complete')
    expect(restored?.tools.some(tool => tool.kind === 'diff')).toBe(true)
  })

  it('deletes an idle session but keeps a running session until it is stopped', async () => {
    const agent = await runtime()
    const idle = await agent.createSession('/tmp/project')
    await agent.deleteSession(idle.id)
    await expect(agent.getSession(idle.id)).resolves.toBeUndefined()

    const running = await agent.createSession('/tmp/project')
    await agent.run(running.id, { text: '执行一个较长任务', references: [], attachments: [] })
    await expect(agent.deleteSession(running.id)).rejects.toThrow('请先停止当前会话，再删除。')
    await agent.cancel(running.id)
    await new Promise<void>(resolve => {
      const unsubscribe = agent.subscribe(event => {
        if (event.type === 'session-updated' && event.session.id === running.id && event.session.status === 'idle') {
          unsubscribe()
          resolve()
        }
      })
    })
    await expect(agent.deleteSession(running.id)).resolves.toBeUndefined()
    await expect(agent.listSessions()).resolves.toEqual([])
    await agent.dispose()
  })

  it('cancels one active run and keeps its durable interrupted output', async () => {
    const agent = await runtime()
    const session = await agent.createSession('/tmp/project')
    await agent.run(session.id, { text: '执行一个较长任务', references: [], attachments: [] })
    await agent.cancel(session.id)
    await new Promise<void>(resolve => {
      const unsubscribe = agent.subscribe(event => {
        if (event.session.id === session.id && event.session.status === 'idle') {
          unsubscribe()
          resolve()
        }
      })
    })
    const stopped = await agent.getSession(session.id)
    expect(stopped?.messages.at(-1)?.state).toBe('interrupted')
    expect(stopped?.status).toBe('idle')
    await agent.dispose()
  })

  it('lists workspace file candidates bounded to the session directory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'harness-studio-files-'))
    await mkdir(join(directory, 'src'), { recursive: true })
    await writeFile(join(directory, 'src', 'main.ts'), 'export {}\n')
    await writeFile(join(directory, 'src', 'util.ts'), 'export {}\n')
    await writeFile(join(directory, 'README.md'), '# Demo\n')
    const agent = new MockAgentRuntime(new SessionStore(join(directory, 'sessions.json')))
    const session = await agent.createSession(directory)

    const all = await agent.listWorkspaceFiles(session.id, '')
    expect(all.some(candidate => candidate.path === 'README.md' && candidate.kind === 'file')).toBe(true)
    expect(all.some(candidate => candidate.path === 'src/' && candidate.kind === 'directory')).toBe(true)

    const nested = await agent.listWorkspaceFiles(session.id, 'src/')
    expect(nested.map(candidate => candidate.path).sort()).toEqual(['src/main.ts', 'src/util.ts'])

    const filtered = await agent.listWorkspaceFiles(session.id, 'main')
    expect(filtered.map(candidate => candidate.path)).toEqual(['src/main.ts'])

    await expect(agent.listWorkspaceFiles('missing-session', '')).rejects.toThrow('找不到会话')
    await agent.dispose()
  })

  it('accepts only supported mock commands', async () => {
    const agent = await runtime()
    const commands = await agent.listCommands('any')
    expect(commands.map(command => command.name)).toContain('compact')
    await expect(agent.runCommand('any', {
      command: 'compact', text: '', references: [], attachments: [],
    })).resolves.toBeUndefined()
    await expect(agent.runCommand('any', {
      command: 'unknown', text: '', references: [], attachments: [],
    })).rejects.toThrow('模拟运行时不支持命令')
    await agent.dispose()
  })
})
