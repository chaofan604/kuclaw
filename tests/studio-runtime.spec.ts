import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MockAgentRuntime } from '../src/main/runtime/mock-runtime.js'
import { SessionStore } from '../src/main/runtime/session-store.js'
import { StudioRuntime } from '../src/main/runtime/studio-runtime.js'

describe('StudioRuntime', () => {
  it('keeps daily and project sessions in separate stores', async () => {
    const root = await mkdtemp(join(tmpdir(), 'harness-studio-modes-'))
    const projectPath = join(root, 'project', 'sessions.json')
    const dailyPath = join(root, 'daily', 'sessions.json')
    const project = new MockAgentRuntime(new SessionStore(projectPath, 'project'), undefined, 'project')
    const daily = new MockAgentRuntime(new SessionStore(dailyPath, 'daily'), undefined, 'daily')
    const runtime = new StudioRuntime(daily, project, join(root, 'daily-workspace'))

    const dailySession = await runtime.createSession('daily')
    const projectSession = await runtime.createSession('project', '/work/customer-portal')

    await expect(runtime.listSessions('daily')).resolves.toEqual([
      expect.objectContaining({ id: dailySession.id, scope: 'daily', title: '新对话' }),
    ])
    await expect(runtime.listSessions('project')).resolves.toEqual([
      expect.objectContaining({ id: projectSession.id, scope: 'project' }),
    ])
    expect(await readFile(dailyPath, 'utf8')).toContain(dailySession.id)
    expect(await readFile(dailyPath, 'utf8')).not.toContain(projectSession.id)
    expect(await readFile(projectPath, 'utf8')).toContain(projectSession.id)
    expect(await readFile(projectPath, 'utf8')).not.toContain(dailySession.id)

    await runtime.deleteSession('daily', dailySession.id)
    await expect(runtime.listSessions('daily')).resolves.toEqual([])
    await expect(runtime.listSessions('project')).resolves.toHaveLength(1)
    expect(await readFile(dailyPath, 'utf8')).not.toContain(dailySession.id)
    expect(await readFile(projectPath, 'utf8')).toContain(projectSession.id)

    await runtime.dispose()
  })

  it('requires a folder only for project sessions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'harness-studio-mode-validation-'))
    const runtime = new StudioRuntime(
      new MockAgentRuntime(new SessionStore(join(root, 'daily.json'), 'daily'), undefined, 'daily'),
      new MockAgentRuntime(new SessionStore(join(root, 'project.json'), 'project'), undefined, 'project'),
      join(root, 'daily-workspace'),
    )

    await expect(runtime.createSession('daily')).resolves.toMatchObject({ scope: 'daily' })
    await expect(runtime.createSession('project')).rejects.toThrow('请先选择项目文件夹')
    await runtime.dispose()
  })
})
