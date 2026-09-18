import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { McpManager } from '../src/main/runtime/mcp-manager.js'

describe('McpManager', () => {
  it('writes fixed profile rows, redacts secrets, and restarts the Host', async () => {
    const root = await mkdtemp(join(tmpdir(), 'harness-mcp-manager-'))
    const storagePath = join(root, 'state', 'mcp.json')
    const profilePath = join(root, 'profile', 'cordis.patch.yml')
    let restarts = 0
    const manager = new McpManager(storagePath, profilePath, () => {
      restarts += 1
      return Promise.resolve()
    })
    const listed = await manager.save({
      id: 'memory',
      serverName: 'memory',
      transport: 'stdio',
      enabled: true,
      command: process.execPath,
      args: [join(process.cwd(), 'vendor/deepseek-harness/packages/mcp/mcp-client/tests/fixture-server.ts')],
      env: { MEMORY_TOKEN: 'never-return-this-value' },
    })
    expect(restarts).toBe(1)
    expect(listed).toMatchObject([{
      id: 'memory', serverName: 'memory', status: 'configured', envKeys: ['MEMORY_TOKEN'],
    }])
    expect(JSON.stringify(listed)).not.toContain('never-return-this-value')
    expect((await stat(storagePath)).mode & 0o777).toBe(0o600)

    const rows = JSON.parse(await readFile(profilePath, 'utf8')) as Array<Record<string, unknown>>
    expect(rows).toMatchObject([
      { id: 'llm-deepseek', config: { streamIdleTimeoutMs: 30_000 } },
      { id: 'web', config: { searchProvider: 'harness-studio-ddg', fetchProvider: 'http' } },
      {
        insert: [
          { id: 'harness-studio-prefer-web-fetch' },
          { id: 'harness-studio-web-search' },
          {
            id: 'harness-studio-mcp-memory',
            name: '@deepseek-ai/dsh-mcp-client',
            config: { serverName: 'memory', transport: 'stdio', command: process.execPath },
          },
        ],
      },
    ])
    expect(rows.some(row => row.id === 'tool-web')).toBe(false)
    expect(rows.some(row => row.id === 'system-prompt')).toBe(false)
    const guidance = await readFile(join(root, 'profile', 'harness-studio-prefer-web-fetch.mjs'), 'utf8')
    expect(guidance).toContain('use Simplified Chinese for both your reasoning and final response')
    expect(guidance).toContain('If web_fetch fails, try another relevant search result before answering.')
    expect(guidance).toContain(
      'do not expose provider, DNS, or network implementation errors unless the user asks for diagnostics.',
    )
    await expect(manager.test('memory')).resolves.toMatchObject({ status: 'ready', toolCount: 6 })
    await expect(manager.save({
      id: 'duplicate', serverName: 'memory', transport: 'stdio', enabled: true, command: 'node',
    })).rejects.toThrow('已被 memory 使用')

    await expect(manager.remove('memory')).resolves.toEqual([])
    expect(JSON.parse(await readFile(profilePath, 'utf8'))).toMatchObject([
      { id: 'llm-deepseek', config: { streamIdleTimeoutMs: 30_000 } },
      { id: 'web' },
      {
        insert: [
          { id: 'harness-studio-prefer-web-fetch' },
          { id: 'harness-studio-web-search' },
        ],
      },
    ])
    const updatedRows = JSON.parse(await readFile(profilePath, 'utf8')) as Array<Record<string, unknown>>
    expect(updatedRows.some(row => row.id === 'tool-web')).toBe(false)
    expect(updatedRows.some(row => row.id === 'system-prompt')).toBe(false)
  })

  it('writes a distinct session root into each mode profile', async () => {
    const root = await mkdtemp(join(tmpdir(), 'harness-mcp-mode-profiles-'))
    const projectProfile = join(root, 'project', 'cordis.patch.yml')
    const dailyProfile = join(root, 'daily', 'cordis.patch.yml')
    const projectSessions = join(root, 'sessions')
    const dailySessions = join(root, 'daily-sessions')
    const manager = new McpManager(
      join(root, 'mcp.json'),
      [
        { profilePath: projectProfile, sessionRoot: projectSessions },
        { profilePath: dailyProfile, sessionRoot: dailySessions },
      ],
      () => Promise.resolve(),
    )

    await manager.list()
    const projectRows = JSON.parse(await readFile(projectProfile, 'utf8')) as Array<Record<string, unknown>>
    const dailyRows = JSON.parse(await readFile(dailyProfile, 'utf8')) as Array<Record<string, unknown>>
    expect(projectRows[0]).toEqual({ id: 'session-persistence-jsonl', config: { root: projectSessions } })
    expect(dailyRows[0]).toEqual({ id: 'session-persistence-jsonl', config: { root: dailySessions } })
    expect(projectRows[1]).toEqual({ id: 'llm-deepseek', config: { streamIdleTimeoutMs: 30_000 } })
    expect(dailyRows[1]).toEqual({ id: 'llm-deepseek', config: { streamIdleTimeoutMs: 30_000 } })
  })
})
