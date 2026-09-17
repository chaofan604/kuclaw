import { mkdtemp, mkdir, readdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { HarnessHostClient } from '../src/main/runtime/dsh-host-client.js'
import { HarnessHostProcess } from '../src/main/runtime/dsh-host-process.js'
import { HarnessAgentRuntime } from '../src/main/runtime/harness-runtime.js'
import { McpManager } from '../src/main/runtime/mcp-manager.js'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const vendorDir = join(repoRoot, 'vendor', 'deepseek-harness')
const hostEntry = join(vendorDir, 'apps', 'desktop-host', 'lib', 'index.js')
const upstreamLock = JSON.parse(readFileSync(join(repoRoot, 'upstream-lock.json'), 'utf8')) as {
  dshVersion: string
  desktopHostProtocolVersion: number
}

/** Build a minimal runtime dir: node_modules links to the built workspace packages. */
async function makeRuntimeDir(): Promise<string> {
  const runtimeDir = await mkdtemp(join(tmpdir(), 'harness-runtime-'))
  const links = join(runtimeDir, 'node_modules', '@deepseek-ai')
  await mkdir(links, { recursive: true })
  await Promise.all([
    ['dsh', join(vendorDir, 'apps', 'cli')],
    ['dsh-desktop-host', join(vendorDir, 'apps', 'desktop-host')],
    ['dsh-web-frontend', join(vendorDir, 'apps', 'web')],
  ].map(([name, target]) => symlink(target, join(links, name))))
  return runtimeDir
}

/** Link every built first-party package into the profile, as upstream dev mode does. */
async function linkWorkspacePackages(projectDir: string): Promise<void> {
  const links = join(projectDir, 'node_modules', '@deepseek-ai')
  await mkdir(links, { recursive: true })
  const packageDirs: string[] = []
  for (const root of [join(vendorDir, 'packages'), join(vendorDir, 'apps'), join(vendorDir, 'vendor')]) {
    for (const entry of await readdir(root)) {
      const dir = join(root, entry)
      if (existsSync(join(dir, 'package.json'))) { packageDirs.push(dir); continue }
      if (!existsSync(join(dir, 'package.json')) && !(await import('node:fs')).statSync(dir).isDirectory()) continue
      for (const child of await readdir(dir)) {
        const nested = join(dir, child)
        if (existsSync(join(nested, 'package.json'))) packageDirs.push(nested)
      }
    }
  }
  for (const dir of packageDirs) {
    const name = (JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as { name?: string }).name
    if (name === undefined || !name.startsWith('@deepseek-ai/')) continue
    await symlink(dir, join(links, name.slice('@deepseek-ai/'.length)))
  }
}

const hostAvailable = existsSync(hostEntry)

describe.skipIf(!hostAvailable)('HarnessHostProcess', () => {
  it('boots the vendor host child and completes the protocol handshake', async () => {
    const providerRequests: Array<{
      path: string
      authorization?: string
      apiKey?: string
      model?: string
      reasoning?: Record<string, unknown>
      include?: unknown
      tools?: string[]
      requestedWebFetch?: boolean
      includedWebFetchResult?: boolean
    }> = []
    let webFetchIssued = false
    const provider = createServer((request, response) => {
      const requestPath = new URL(request.url ?? '/', 'http://provider.test').pathname
      if (request.method === 'GET' && requestPath.endsWith('/models')) {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({
          data: [{
            id: 'discovered-model',
            name: 'Discovered Model',
            context_window: 131_072,
            max_output_tokens: 16_384,
          }],
        }))
        return
      }
      let body = ''
      request.setEncoding('utf8')
      request.on('data', (chunk: string) => { body += chunk })
      request.on('end', () => {
        const parsed = JSON.parse(body) as {
          max_tokens?: number
          model?: string
          messages?: unknown[]
          reasoning?: Record<string, unknown>
          include?: unknown
          tools?: Array<{ name?: string; function?: { name?: string } }>
        }
        const serializedMessages = JSON.stringify(parsed.messages ?? [])
        providerRequests.push({
          path: requestPath,
          requestedWebFetch: serializedMessages.includes('exercise deterministic web_fetch'),
          includedWebFetchResult: serializedMessages.includes('verified fixture page'),
          ...(typeof request.headers.authorization === 'string' ? { authorization: request.headers.authorization } : {}),
          ...(typeof request.headers['x-api-key'] === 'string' ? { apiKey: request.headers['x-api-key'] } : {}),
          ...(typeof parsed.model === 'string' ? { model: parsed.model } : {}),
          ...(parsed.reasoning === undefined ? {} : { reasoning: parsed.reasoning }),
          ...(parsed.include === undefined ? {} : { include: parsed.include }),
          ...(parsed.tools === undefined ? {} : {
            tools: parsed.tools.flatMap(tool => {
              const name = tool.name ?? tool.function?.name
              return name === undefined ? [] : [name]
            }),
          }),
        })
        if (requestPath.endsWith('/responses')) {
          const text = 'HARNESS_RESPONSES_STREAM_OK'
          const item = { id: 'msg_1', type: 'message', status: 'completed', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text, annotations: [] }] }
          response.writeHead(200, { 'content-type': 'text/event-stream' })
          response.end([
            `data: ${JSON.stringify({ type: 'response.created', response: { id: 'resp_1', status: 'in_progress', output: [] } })}`,
            `data: ${JSON.stringify({ type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress', content: [] } })}`,
            `data: ${JSON.stringify({ type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: text })}`,
            `data: ${JSON.stringify({ type: 'response.output_item.done', output_index: 0, item })}`,
            `data: ${JSON.stringify({ type: 'response.completed', response: { id: 'resp_1', status: 'completed', output: [item], usage: { input_tokens: 3, output_tokens: 1, total_tokens: 4, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } } })}`,
            '',
          ].join('\n\n'))
          return
        }
        if (requestPath.endsWith('/messages')) {
          const text = 'HARNESS_ANTHROPIC_STREAM_OK'
          const events = [
            ['message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', content: [], model: parsed.model, stop_reason: null, stop_sequence: null, usage: { input_tokens: 3, output_tokens: 0 } } }],
            ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
            ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }],
            ['content_block_stop', { type: 'content_block_stop', index: 0 }],
            ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } }],
            ['message_stop', { type: 'message_stop' }],
          ] as const
          response.writeHead(200, { 'content-type': 'text/event-stream' })
          response.end(`${events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}`).join('\n\n')}\n\n`)
          return
        }
        if (serializedMessages.includes('exercise deterministic web_fetch')
          && !serializedMessages.includes('verified fixture page')
          && !webFetchIssued) {
          webFetchIssued = true
          response.writeHead(200, { 'content-type': 'text/event-stream' })
          response.end([
            'data: {"choices":[{"delta":{"role":"assistant","content":""},"index":0,"finish_reason":null}]}',
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-web-fetch-1","type":"function","function":{"name":"web_fetch","arguments":"{\\"url\\":\\"https://fixture.test/olympics\\"}"}}]},"index":0,"finish_reason":null}]}',
            'data: {"choices":[{"delta":{"content":""},"index":0,"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":3,"completion_tokens":1}}',
            'data: [DONE]',
            '',
          ].join('\n\n'))
          return
        }
        const text = serializedMessages.includes('exercise deterministic web_fetch')
          ? serializedMessages.includes('verified fixture page')
            ? 'HARNESS_WEB_FETCH_STREAM_OK'
            : 'HARNESS_WEB_FETCH_RESULT_MISSING'
          : parsed.max_tokens === 64 ? 'Harness test' : 'HARNESS_RUNTIME_STREAM_OK'
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.end([
          `data: {"choices":[{"delta":{"content":"${text}"}}]}`,
          'data: {"choices":[{"delta":{"content":""},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":1}}',
          'data: [DONE]',
          '',
        ].join('\n\n'))
      })
    })
    await new Promise<void>((resolve, reject) => {
      provider.once('error', reject)
      provider.listen(0, '127.0.0.1', resolve)
    })
    const providerAddress = provider.address()
    if (providerAddress === null || typeof providerAddress === 'string') {
      throw new Error('mock provider did not bind a TCP port')
    }
    const home = await mkdtemp(join(tmpdir(), 'harness-host-home-'))
    const projectDir = await mkdtemp(join(tmpdir(), 'harness-host-profile-'))
    await writeFile(join(projectDir, 'package.json'), JSON.stringify({ name: 'harness-studio-profile', private: true, type: 'module', dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } } }), 'utf8')
    const profilePath = join(projectDir, 'cordis.patch.yml')
    await writeFile(profilePath, '[]\n', 'utf8')
    await new McpManager(
      join(projectDir, 'mcp.json'),
      profilePath,
      () => Promise.resolve(),
    ).list()
    const fetchFixturePath = join(projectDir, 'web-fetch-fixture.mjs')
    await writeFile(fetchFixturePath, `export const name = 'web-fetch-fixture'
export const inject = ['web']
export function apply(ctx) {
  ctx.effect(() => ctx.web.registerFetchProvider({
    id: 'http',
    available: () => true,
    fetch: async request => {
      await new Promise(resolve => setTimeout(resolve, 100))
      return {
        url: request.url,
        statusCode: 200,
        body: { kind: 'text', content: 'verified fixture page' },
        truncated: false,
      }
    },
  }))
}
`, 'utf8')
    const profileRows = JSON.parse(await readFile(profilePath, 'utf8')) as Array<{
      id?: string
      name?: string
      disabled?: boolean
      config?: Record<string, unknown>
      insert?: Array<{ id: string; name: string }>
    }>
    profileRows.push(
      { id: 'web-fetch-http', disabled: true },
      { insert: [{ id: 'web-fetch-fixture', name: fetchFixturePath }] },
    )
    await writeFile(profilePath, `${JSON.stringify(profileRows, null, 2)}\n`, 'utf8')
    await mkdir(join(home, 'sessions'), { recursive: true })
    const runtimeDir = await makeRuntimeDir()
    await linkWorkspacePackages(projectDir)
    const failures: Error[] = []
    const host = new HarnessHostProcess({
      nodeExecutable: process.execPath,
      runtimeDir,
      projectDir,
      allowLinkedProfile: true,
      environment: {
        DSH_HOME: home,
      },
      onFailure: (error) => { failures.push(error) },
      expectedDshVersion: upstreamLock.dshVersion,
    })

    const ready = await Promise.race([
      host.start(),
      new Promise<never>((resolve, reject) => setTimeout(() => reject(new Error('host handshake timed out')), 120_000)),
    ])
    expect(ready.protocolVersion).toBe(upstreamLock.desktopHostProtocolVersion)
    expect(ready.dshVersion).toBe(upstreamLock.dshVersion)

    const response = await host.fetch(new Request('http://dsh.local/api/health'))
    expect(response).toBeInstanceOf(Response)

    const client = new HarnessHostClient(host)
    await expect(client.call<{ items: unknown[] }>('session/list', { _request: {} }))
      .resolves.toEqual({ items: [] })

    const scheduled = await client.call<{ id: string; workspacePath: string; nextRunAt: number }>('scheduledTasks/create', {
      input: {
        name: 'desktop host smoke task',
        workspacePath: projectDir,
        cron: '0 1 * * *',
        timeZone: 'UTC',
        prompt: 'Inspect this workspace.',
        model: { provider: 'deepseek', model: 'deepseek-chat' },
      },
    })
    expect(scheduled.workspacePath).toBe(projectDir)
    expect(scheduled.nextRunAt).toBeGreaterThan(Date.now())
    await expect(client.call<Array<{ id: string }>>('scheduledTasks/list', {}))
      .resolves.toEqual([expect.objectContaining({ id: scheduled.id })])
    await client.call<void>('scheduledTasks/remove', { id: scheduled.id })
    await expect(client.call<Array<{ id: string }>>('scheduledTasks/list', {})).resolves.toEqual([])

    const created = await client.call<{ sessionId: string }>('session/create', {
      request: { cwd: projectDir },
    })
    expect(created.sessionId).toMatch(/^session-/u)

    const followAbort = new AbortController()
    const follow = client.stream<{
      type: string
      header?: { id?: string }
    }>('session/follow', {
      request: {
        address: { kind: 'session', sessionId: created.sessionId },
        assistantStream: true,
      },
    }, followAbort.signal)[Symbol.asyncIterator]()
    const opening = await follow.next()
    expect(opening).toMatchObject({
      done: false,
      value: {
        type: 'snapshot',
        header: { id: created.sessionId },
      },
    })
    followAbort.abort()
    await follow.return?.()

    const listed = await client.call<{
      items: Array<{ sessionId: string }>
    }>('session/list', { _request: {} })
    expect(listed.items.map(item => item.sessionId)).toContain(created.sessionId)

    const runtime = await HarnessAgentRuntime.create(host)
    const beforeConfiguration = await runtime.getModelConfiguration()
    expect(beforeConfiguration.profiles).toEqual([])
    await expect(runtime.discoverModels({
      protocol: 'openai-completions',
      baseURL: `http://127.0.0.1:${String(providerAddress.port)}`,
      apiKey: 'discovery-only-key',
    })).resolves.toMatchObject({
      models: [{ id: 'discovered-model' }],
    })
    const configured = await runtime.updateModelConfiguration({
      upsertProfile: {
        id: 'test-gateway',
        displayName: 'Test Gateway',
        protocol: 'openai-completions',
        baseURL: `http://127.0.0.1:${String(providerAddress.port)}`,
        apiKey: 'keyless-harness-studio-test',
        models: [{
          id: 'glm-5.3-flash',
          name: 'GLM 5.3 Flash',
          contextWindow: 262_144,
          maxTokens: 32_768,
        }],
      },
    })
    expect(configured.profiles).toMatchObject([{
      id: 'test-gateway',
      protocol: 'openai-completions',
      credentialConfigured: true,
      credentialWritable: true,
      models: [{ id: 'glm-5.3-flash' }],
    }])
    const configuredSettings = await client.call<{
      namespaces: Array<{ ns: string; value: unknown }>
    }>('settings/describe', {})
    expect(configuredSettings.namespaces.find(section => section.ns === 'llm-pi-ai')?.value).toMatchObject({
      providers: {
        'test-gateway': {
          streamIdleTimeoutMs: 30_000,
          reasoning: 'high',
          models: [{
            id: 'glm-5.3-flash',
            reasoningEfforts: { off: null, low: 'low', high: 'high', max: 'max' },
          }],
        },
      },
    })
    expect(configured.groups.find(group => group.id === 'test-gateway')?.models[0]).toMatchObject({
      id: 'glm-5.3-flash',
      reasoningEfforts: [
        { id: 'off' },
        { id: 'low' },
        { id: 'high' },
        { id: 'max' },
      ],
      defaultReasoningEffort: 'high',
    })
    expect(JSON.stringify(configured)).not.toContain('keyless-harness-studio-test')
    const restored = await runtime.getSession(created.sessionId)
    expect(restored).toMatchObject({ id: created.sessionId, cwd: projectDir })
    const pastedImage = new Uint8Array(100_000)
    pastedImage.set([137, 80, 78, 71])
    await expect(runtime.uploadImage(created.sessionId, {
      name: 'pasted.png',
      mediaType: 'image/png',
      bytes: pastedImage,
    })).resolves.toMatchObject({
      name: 'pasted.png',
      bytes: 100_000,
    })
    await expect(runtime.selectModel(created.sessionId, {
      provider: 'test-gateway',
      model: 'glm-5.3-flash',
      reasoningEffort: 'high',
    })).resolves.toMatchObject({
      provider: 'test-gateway',
      model: 'glm-5.3-flash',
      reasoningEffort: 'high',
    })
    let resolveStreamed!: (session: NonNullable<typeof restored>) => void
    const streamed = new Promise<NonNullable<typeof restored>>(resolve => { resolveStreamed = resolve })
    const unsubscribe = runtime.subscribe((event) => {
      const message = event.session.messages.find(candidate =>
        candidate.role === 'assistant' && candidate.text.includes('HARNESS_RUNTIME_STREAM_OK'))
      if (message !== undefined && event.session.status === 'idle') resolveStreamed(event.session)
    })
    await runtime.run(created.sessionId, { text: 'answer from the local provider', references: [], attachments: [] })
    const completed = await Promise.race([
      streamed,
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error('Harness runtime did not publish the completed stream')), 20_000).unref()
      }),
    ])
    expect(completed.messages.at(-1)).toMatchObject({
      role: 'assistant',
      text: 'HARNESS_RUNTIME_STREAM_OK',
      state: 'complete',
    })

    let sawWebFetchPending = false
    let resolveWebFetch!: (session: NonNullable<typeof restored>) => void
    const webFetchCompleted = new Promise<NonNullable<typeof restored>>(resolve => { resolveWebFetch = resolve })
    const stopWebFetch = runtime.subscribe(event => {
      const webFetch = event.session.tools.find(tool => tool.id === 'call-web-fetch-1')
      if (webFetch?.state === 'pending') sawWebFetchPending = true
      if (webFetch?.state === 'complete'
        && event.session.status === 'idle'
        && event.session.messages.some(message => message.text === 'HARNESS_WEB_FETCH_STREAM_OK')) {
        resolveWebFetch(event.session)
      }
    })
    await runtime.run(created.sessionId, { text: 'exercise deterministic web_fetch', references: [], attachments: [] })
    let fetched: NonNullable<typeof restored>
    try {
      fetched = await Promise.race([
        webFetchCompleted,
        new Promise<never>((_resolve, reject) => {
          setTimeout(() => reject(new Error('Harness runtime did not execute web_fetch')), 20_000).unref()
        }),
      ])
    } catch {
      throw new Error(`Harness runtime did not execute web_fetch: ${JSON.stringify({
        session: await runtime.getSession(created.sessionId),
        providerRequests,
        failures: failures.map(error => error.message),
      })}`)
    }
    stopWebFetch()
    expect(sawWebFetchPending).toBe(true)
    expect(fetched.tools).toContainEqual(expect.objectContaining({
      id: 'call-web-fetch-1',
      title: 'web_fetch',
      kind: 'web',
      state: 'complete',
      url: 'https://fixture.test/olympics',
      statusCode: 200,
    }))
    expect(fetched.messages.at(-1)).toMatchObject({
      role: 'assistant',
      text: 'HARNESS_WEB_FETCH_STREAM_OK',
      state: 'complete',
    })

    const exerciseProtocol = async (
      providerId: string,
      protocol: 'openai-responses' | 'anthropic-messages',
      expectedText: string,
      apiKey: string,
    ) => {
      const modelId = protocol === 'openai-responses'
        ? 'openai.gpt-5.6-sol'
        : `${providerId}-model`
      await runtime.updateModelConfiguration({
        upsertProfile: {
          id: providerId,
          displayName: providerId,
          protocol,
          baseURL: `http://127.0.0.1:${String(providerAddress.port)}`,
          apiKey,
          models: [{ id: modelId, name: providerId, contextWindow: 131_072, maxTokens: 4096 }],
        },
      })
      await runtime.selectModel(created.sessionId, {
        provider: providerId,
        model: modelId,
        ...(protocol === 'openai-responses' ? { reasoningEffort: 'high' } : {}),
      })
      let resolveCompleted!: () => void
      const seen = new Promise<void>(resolve => { resolveCompleted = resolve })
      const stop = runtime.subscribe(event => {
        if (event.type === 'session-updated'
          && event.session.status === 'idle'
          && event.session.messages.some(message => message.text === expectedText)) resolveCompleted()
      })
      await runtime.run(created.sessionId, {
        text: `exercise ${protocol}`,
        references: [],
        attachments: [],
      })
      try {
        await Promise.race([
          seen,
          new Promise<never>((_resolve, reject) => {
            setTimeout(() => reject(new Error(`${protocol} stream did not complete`)), 20_000).unref()
          }),
        ])
      } catch {
        throw new Error(`${protocol} stream did not complete: ${JSON.stringify({ session: await runtime.getSession(created.sessionId), providerRequests })}`)
      }
      stop()
    }
    await exerciseProtocol('responses-gateway', 'openai-responses', 'HARNESS_RESPONSES_STREAM_OK', 'responses-secret')
    await exerciseProtocol('anthropic-gateway', 'anthropic-messages', 'HARNESS_ANTHROPIC_STREAM_OK', 'anthropic-secret')
    expect(providerRequests).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: '/chat/completions',
        authorization: 'Bearer keyless-harness-studio-test',
        model: 'glm-5.3-flash',
        tools: expect.arrayContaining(['web_search', 'web_fetch']),
      }),
      expect.objectContaining({
        path: '/responses',
        authorization: 'Bearer responses-secret',
        model: 'openai.gpt-5.6-sol',
        reasoning: { effort: 'high' },
      }),
      expect.objectContaining({ path: '/v1/messages', apiKey: 'anthropic-secret', model: 'anthropic-gateway-model' }),
    ]))
    const responsesRequest = providerRequests.find(request => request.path === '/responses')
    expect(responsesRequest?.reasoning).not.toHaveProperty('summary')
    expect(responsesRequest?.include).toBeUndefined()
    await expect(runtime.getContextStatus(created.sessionId)).resolves.toMatchObject({
      contextWindow: 131_072,
      usage: { outputTokens: expect.any(Number) },
      compactions: [],
    })
    const removed = await runtime.updateModelConfiguration({ removeProfileId: 'test-gateway' })
    await runtime.updateModelConfiguration({ removeProfileId: 'responses-gateway' })
    const allRemoved = await runtime.updateModelConfiguration({ removeProfileId: 'anthropic-gateway' })
    expect(allRemoved.profiles).toEqual([])
    expect(removed.groups.some(group => group.id === 'test-gateway')).toBe(false)

    await runtime.deleteSession(created.sessionId)
    await expect(runtime.getSession(created.sessionId)).resolves.toBeUndefined()
    await expect(runtime.listSessions()).resolves.not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: created.sessionId }),
    ]))
    const archivedSource = await client.call<{ items: Array<{ sessionId: string }> }>(
      'session/list',
      { _request: {} },
    )
    expect(archivedSource.items.map(item => item.sessionId)).toContain(created.sessionId)

    unsubscribe()
    await runtime.dispose()
    expect(failures).toEqual([])
    await new Promise<void>(resolve => provider.close(() => { resolve() }))
  }, 180_000)
})
