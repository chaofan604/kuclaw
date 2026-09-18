import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { McpServerInput, McpServerSummary } from '../../shared/contracts.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { MODEL_STREAM_IDLE_TIMEOUT_MS } from './harness-policy.js'

interface StoredMcpServer extends McpServerInput {
  toolCallTimeoutMs: number
}

interface StoredMcpConfiguration {
  version: 1
  servers: StoredMcpServer[]
}

interface BuiltInMemoryMcp {
  command: string
  scriptPath: string
  databasePath: string
}

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/u
const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/u

const PREFER_WEB_FETCH_PLUGIN = `export const name = 'harness-studio-prefer-web-fetch'
export const inject = ['tools', 'systemPrompt']

const GUIDANCE = [
  'When the user writes in Chinese, use Simplified Chinese for both your reasoning and final response; keep code, commands, paths, and product names unchanged.',
  'For current facts, documentation, or anything that needs the public web, call web_search first, then web_fetch on the best URLs.',
  'If web_fetch fails, try another relevant search result before answering.',
  'Describe unavailable sources in user terms; do not expose provider, DNS, or network implementation errors unless the user asks for diagnostics.',
  'Do not use bash, curl, wget, python, or node to search or download the web.',
].join(' ')

const WEB_CLI = /\\b(curl|wget|httpie|aria2c)\\b/i
const SCRIPT_FETCH = /\\b(python3?|node|nodejs|deno|bun)\\b[\\s\\S]{0,400}https?:\\/\\//i

function commandOf(value) {
  if (value === null || typeof value !== 'object') return ''
  const command = value.command
  return typeof command === 'string' ? command : ''
}

export function apply(ctx) {
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'harness-studio:guidance',
    order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_SUFFIX') - 1,
    text: GUIDANCE,
  }))
  ctx.on('tools/pre-execute', async (exec, next) => {
    const decision = await next()
    if (decision.kind !== 'allow') return decision
    if (exec.name !== 'bash' && exec.name !== 'pwsh') return decision
    const command = commandOf(exec.arguments)
    if (!WEB_CLI.test(command) && !SCRIPT_FETCH.test(command)) return decision
    return {
      kind: 'deny',
      reason: 'Do not download HTTP(S) pages with bash. Call web_fetch with the URL.',
    }
  })
}
`

const WEB_SEARCH_PLUGIN = `export const name = 'harness-studio-web-search'
export const inject = ['web']

function decodeDuckUrl(href) {
  try {
    const parsed = new URL(href, 'https://html.duckduckgo.com')
    const target = parsed.searchParams.get('uddg')
    return target === null ? parsed.href : target
  } catch {
    return href
  }
}

function parseResults(html, limit) {
  const sources = []
  const seen = new Set()
  const pattern = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\\s\\S]*?)<\\/a>/gi
  for (const match of html.matchAll(pattern)) {
    const url = decodeDuckUrl(match[1] ?? '')
    if (!url.startsWith('http') || seen.has(url)) continue
    seen.add(url)
    const title = (match[2] ?? '').replace(/<[^>]+>/g, ' ').replace(/\\s+/g, ' ').trim()
    sources.push(title === '' ? { url } : { url, title })
    if (sources.length >= limit) break
  }
  return sources
}

export function apply(ctx) {
  ctx.effect(() => ctx.web.registerSearchProvider({
    id: 'harness-studio-ddg',
    available: () => true,
    async search(request, signal) {
      const response = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(request.query), {
        signal,
        headers: { 'user-agent': 'harness-studio/0.1' },
      })
      if (!response.ok) throw new Error('web search failed: HTTP ' + String(response.status))
      const sources = parseResults(await response.text(), request.maxResults ?? 8)
      return { sources, truncated: false }
    },
  }))
}
`

function validate(server: McpServerInput): StoredMcpServer {
  if (!ID_PATTERN.test(server.id)) throw new Error('MCP 配置 ID 不合法')
  if (!SERVER_NAME_PATTERN.test(server.serverName)) throw new Error('MCP serverName 不合法')
  const toolCallTimeoutMs = server.toolCallTimeoutMs ?? 60_000
  if (!Number.isSafeInteger(toolCallTimeoutMs) || toolCallTimeoutMs <= 0) throw new Error('MCP 工具超时必须是正整数')
  if (server.transport === 'stdio') {
    if (server.command?.trim() === '') throw new Error('stdio MCP 必须指定 command')
    if (server.command === undefined) throw new Error('stdio MCP 必须指定 command')
    return {
      id: server.id,
      serverName: server.serverName,
      transport: 'stdio',
      enabled: server.enabled,
      command: server.command,
      args: [...(server.args ?? [])],
      cwd: server.cwd ?? '',
      env: { ...(server.env ?? {}) },
      toolCallTimeoutMs,
    }
  }
  let url: URL
  try { url = new URL(server.url ?? '') } catch { throw new Error('HTTP MCP 地址不是有效 URL') }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('HTTP MCP 地址仅支持 http 或 https')
  return {
    id: server.id,
    serverName: server.serverName,
    transport: 'streamable-http',
    enabled: server.enabled,
    url: url.toString(),
    headers: { ...(server.headers ?? {}) },
    toolCallTimeoutMs,
  }
}

function summary(
  server: StoredMcpServer,
  status: McpServerSummary['status'],
  error?: string,
  toolCount?: number,
): McpServerSummary {
  return {
    id: server.id,
    serverName: server.serverName,
    transport: server.transport,
    enabled: server.enabled,
    ...(server.transport === 'stdio' ? {
      command: server.command ?? '',
      args: [...(server.args ?? [])],
      cwd: server.cwd ?? '',
      envKeys: Object.keys(server.env ?? {}).sort(),
    } : {
      url: server.url ?? '',
      headerKeys: Object.keys(server.headers ?? {}).sort(),
    }),
    toolCallTimeoutMs: server.toolCallTimeoutMs,
    status,
    ...(toolCount === undefined ? {} : { toolCount }),
    ...(error === undefined ? {} : { error }),
  }
}

interface ProfilePatchTarget {
  profilePath: string
  sessionRoot?: string
}

export class McpManager {
  private statuses = new Map<string, { status: McpServerSummary['status']; error?: string; toolCount?: number }>()

  constructor(
    private readonly storagePath: string,
    private readonly profilePath: string | readonly ProfilePatchTarget[],
    private readonly restartHost: () => Promise<void>,
    private readonly builtInMemory?: BuiltInMemoryMcp,
  ) {}

  async list(): Promise<McpServerSummary[]> {
    const configuration = await this.load()
    await this.writeProfile(configuration)
    return configuration.servers.map(server => {
      const state = this.statuses.get(server.id)
      return summary(server, state?.status ?? 'configured', state?.error, state?.toolCount)
    })
  }

  async save(input: McpServerInput): Promise<McpServerSummary[]> {
    const configuration = await this.load()
    const previous = configuration.servers.find(server => server.id === input.id)
    const merged = validate({
      ...input,
      ...(input.transport === 'stdio' && input.env === undefined && previous?.transport === 'stdio'
        ? { env: previous.env }
        : {}),
      ...(input.transport === 'streamable-http' && input.headers === undefined
        && previous?.transport === 'streamable-http' ? { headers: previous.headers } : {}),
    })
    const duplicate = configuration.servers.find(server => server.id !== merged.id
      && server.enabled && merged.enabled && server.serverName === merged.serverName)
    if (duplicate !== undefined) throw new Error(`MCP serverName "${merged.serverName}" 已被 ${duplicate.id} 使用`)
    configuration.servers = [
      ...configuration.servers.filter(server => server.id !== merged.id),
      merged,
    ].sort((left, right) => left.id.localeCompare(right.id))
    await this.persist(configuration)
    await this.restart(configuration.servers.filter(server => server.enabled).map(server => server.id))
    return this.list()
  }

  async remove(id: string): Promise<McpServerSummary[]> {
    if (!ID_PATTERN.test(id)) throw new Error('MCP 配置 ID 不合法')
    const configuration = await this.load()
    if (!configuration.servers.some(server => server.id === id)) return this.list()
    configuration.servers = configuration.servers.filter(server => server.id !== id)
    await this.persist(configuration)
    this.statuses.delete(id)
    await this.restart(configuration.servers.filter(server => server.enabled).map(server => server.id))
    return this.list()
  }

  async test(id: string): Promise<McpServerSummary> {
    const server = (await this.load()).servers.find(candidate => candidate.id === id)
    if (server === undefined) throw new Error('MCP 配置不存在')
    const client = new Client({ name: 'harness-studio', version: '0.1.0' })
    const scrubbedEnvironment = Object.fromEntries(Object.entries(process.env).flatMap(([name, value]) =>
      value === undefined || /KEY|PASSWORD|SECRET|TOKEN/iu.test(name) || name.startsWith('DSH_')
        ? []
        : [[name, value]]))
    const transport = server.transport === 'stdio'
      ? new StdioClientTransport({
        command: server.command ?? '',
        args: server.args ?? [],
        cwd: server.cwd ?? '',
        env: { ...scrubbedEnvironment, ...(server.env ?? {}) },
      })
      : new StreamableHTTPClientTransport(new URL(server.url ?? ''), {
        requestInit: { headers: server.headers ?? {} },
      })
    try {
      await client.connect(transport as Transport)
      const tools = await client.listTools(undefined, { timeout: server.toolCallTimeoutMs })
      const state = { status: 'ready' as const, toolCount: tools.tools.length }
      this.statuses.set(id, state)
      return summary(server, state.status, undefined, state.toolCount)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      this.statuses.set(id, { status: 'error', error: message })
      throw new Error(`MCP 连接测试失败：${message}`)
    } finally {
      await client.close().catch(() => undefined)
    }
  }

  private async restart(enabledIds: string[]): Promise<void> {
    for (const id of enabledIds) this.statuses.set(id, { status: 'restarting' })
    try {
      await this.restartHost()
      for (const id of enabledIds) this.statuses.set(id, { status: 'configured' })
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      for (const id of enabledIds) this.statuses.set(id, { status: 'error', error: message })
      throw new Error(`MCP 配置已保存，但 Harness Host 重启失败：${message}`)
    }
  }

  private async load(): Promise<StoredMcpConfiguration> {
    try {
      const parsed = JSON.parse(await readFile(this.storagePath, 'utf8')) as StoredMcpConfiguration
      if (parsed.version !== 1 || !Array.isArray(parsed.servers)) throw new Error('MCP 配置格式不受支持')
      return { version: 1, servers: parsed.servers.map(validate) }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, servers: [] }
      throw error
    }
  }

  private async persist(configuration: StoredMcpConfiguration): Promise<void> {
    await mkdir(dirname(this.storagePath), { recursive: true })
    const temporary = `${this.storagePath}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify(configuration, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await chmod(temporary, 0o600)
    await rename(temporary, this.storagePath)
    await this.writeProfile(configuration)
  }

  private async writeProfile(configuration: StoredMcpConfiguration): Promise<void> {
    const targets: readonly ProfilePatchTarget[] = typeof this.profilePath === 'string'
      ? [{ profilePath: this.profilePath }]
      : this.profilePath
    await Promise.all(targets.map(target => this.writeProfileTarget(configuration, target)))
  }

  private async writeProfileTarget(
    configuration: StoredMcpConfiguration,
    target: ProfilePatchTarget,
  ): Promise<void> {
    const profilePath = target.profilePath
    await mkdir(dirname(profilePath), { recursive: true })
    const pluginDir = dirname(profilePath)
    const preferWebFetchPath = join(pluginDir, 'harness-studio-prefer-web-fetch.mjs')
    const webSearchPath = join(pluginDir, 'harness-studio-web-search.mjs')
    await writeFile(preferWebFetchPath, PREFER_WEB_FETCH_PLUGIN, 'utf8')
    await writeFile(webSearchPath, WEB_SEARCH_PLUGIN, 'utf8')
    const rows = [
      ...(target.sessionRoot === undefined ? [] : [{
        id: 'session-persistence-jsonl',
        config: { root: target.sessionRoot },
      }]),
      {
        id: 'llm-deepseek',
        config: { streamIdleTimeoutMs: MODEL_STREAM_IDLE_TIMEOUT_MS },
      },
      {
        id: 'web',
        config: {
          searchProvider: 'harness-studio-ddg',
          fetchProvider: 'http',
        },
      },
      // dsh-web-app disables the Host tool-web row and mounts it per Agent preset.
      // Re-enabling the Host row here makes every preset fail on duplicate tool names.
      {
        insert: [
          {
            id: 'harness-studio-prefer-web-fetch',
            name: preferWebFetchPath,
          },
          {
            id: 'harness-studio-web-search',
            name: webSearchPath,
          },
          ...(this.builtInMemory === undefined ? [] : [{
            id: 'harness-studio-memory',
            name: '@deepseek-ai/dsh-mcp-client',
            config: {
              serverName: 'memory',
              transport: 'stdio',
              command: this.builtInMemory.command,
              args: [this.builtInMemory.scriptPath, '--db', this.builtInMemory.databasePath],
              env: {},
              cwd: '',
              toolCallTimeoutMs: 60_000,
              failOnStartupError: false,
            },
          }]),
          ...configuration.servers.filter(server => server.enabled).map(server => ({
            id: `harness-studio-mcp-${server.id}`,
            name: '@deepseek-ai/dsh-mcp-client',
            config: server.transport === 'stdio' ? {
              serverName: server.serverName,
              transport: server.transport,
              command: server.command,
              args: server.args ?? [],
              env: server.env ?? {},
              cwd: server.cwd ?? '',
              toolCallTimeoutMs: server.toolCallTimeoutMs,
              failOnStartupError: false,
            } : {
              serverName: server.serverName,
              transport: server.transport,
              url: server.url,
              headers: server.headers ?? {},
              toolCallTimeoutMs: server.toolCallTimeoutMs,
              failOnStartupError: false,
            },
          })),
        ],
      },
    ]
    await mkdir(dirname(profilePath), { recursive: true })
    const temporary = `${profilePath}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify(rows, null, 2)}\n`, 'utf8')
    await rename(temporary, profilePath)
  }
}
