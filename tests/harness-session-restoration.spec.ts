import { describe, expect, it } from 'vitest'
import { HarnessAgentRuntime } from '../src/main/runtime/harness-runtime.js'

function rpcResponse(request: Request, value: unknown): Promise<Response> {
  return request.json().then((body: unknown) => {
    const rpcId = typeof body === 'object' && body !== null && 'rpcId' in body
      ? String(body.rpcId)
      : ''
    return Response.json({
      type: 'server-response',
      rpcId,
      result: { ok: true, value },
    })
  })
}

describe('Harness session restoration', () => {
  it('returns the latest followed state when a user reopens a session', async () => {
    const encoder = new TextEncoder()
    let sessionController!: ReadableStreamDefaultController<Uint8Array>
    let controlController!: ReadableStreamDefaultController<Uint8Array>
    let commandArguments: Record<string, unknown> | undefined
    let promptArguments: Record<string, unknown> | undefined
    const persistentStream = (request: Request, opening: unknown, capture?: (controller: ReadableStreamDefaultController<Uint8Array>) => void) =>
      new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          capture?.(controller)
          controller.enqueue(encoder.encode(`${JSON.stringify(opening)}\n`))
          request.signal.addEventListener('abort', () => {
            try { controller.error(request.signal.reason) } catch {}
          }, { once: true })
        },
      }))
    const host = {
      start: () => Promise.resolve({ protocolVersion: 3, dshVersion: 'test' }),
      stop: () => Promise.resolve(),
      fetch: async (request: Request) => {
        if (new URL(request.url).pathname === '/.dsh/remote-stream') {
          const body = JSON.parse(await request.text()) as { endpoint: string }
          if (body.endpoint === '$events') {
            return persistentStream(request, { type: 'ready', clientId: 'client-1', host: { home: '/tmp' } })
          }
          if (body.endpoint === 'session/control') {
            return persistentStream(
              request,
              { type: 'baseline', value: { jobs: {}, projections: {} } },
              controller => { controlController = controller },
            )
          }
          if (body.endpoint === 'workspace/follow') {
            return new Response('{"type":"baseline","value":{"archivedSessionIds":[]}}\n')
          }
          expect(body.endpoint).toBe('session/follow')
          return persistentStream(request, {
            type: 'snapshot',
            header: { id: 'session-1', createdAt: 1, cwd: '/tmp/project' },
            cursor: -1,
            records: [],
            hasMore: false,
            projections: {
              values: {
                goal: {
                  goal: {
                    id: 'goal-1',
                    revision: 1,
                    objective: '交付可用版本',
                    phase: 'active',
                    maxGoalRounds: 8,
                  },
                  roundsStarted: 2,
                  createdAt: 1,
                  updatedAt: 2,
                },
                plan: { active: true, pending: false },
                permissions: {
                  options: [
                    { value: 'workspace-write', name: 'Workspace write' },
                    { value: 'danger-full-access', name: 'Full access' },
                  ],
                  currentValue: 'workspace-write',
                },
              },
            },
            assistantStream: { revision: 0 },
          }, controller => { sessionController = controller })
        }
        const body = await request.clone().json() as {
          method: string
          payload?: { args?: Record<string, unknown> }
        }
        if (body.method === 'session/create') return rpcResponse(request, { sessionId: 'session-1' })
        if (body.method === 'commands/execute') {
          commandArguments = body.payload?.args
          const line = String(body.payload?.args?.line ?? '')
          return rpcResponse(request, line.startsWith('/permission')
            ? { commandId: 'command-permission', result: { kind: 'success' } }
            : line.startsWith('/review')
              ? { commandId: 'command-1', result: { kind: 'success' } }
              : line.startsWith('/rejected')
              ? { commandId: 'command-2', result: { kind: 'error', text: 'Goal objective is required.' } }
              : line.startsWith('/goal')
                ? { commandId: 'command-3', result: { kind: 'error', text: 'A goal is already paused.' } }
                : undefined)
        }
        if (body.method === 'session/prompt') promptArguments = body.payload?.args
        return rpcResponse(request, undefined)
      },
    }
    const runtime = await HarnessAgentRuntime.create(host as never)
    const opened = await runtime.createSession('/tmp/project')
    expect(opened.messages).toEqual([])
    expect(opened.goalStatus).toEqual({
      objective: '交付可用版本',
      phase: 'active',
      roundsStarted: 2,
    })
    expect(opened.planStatus).toEqual({ active: true, pending: false })
    const permissionSwitch = runtime.selectPermissionPreset('session-1', 'danger-full-access')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(commandArguments).toEqual({
      agentId: 'session-1',
      line: '/permission danger-full-access',
      submittedAttachments: [],
    })
    await expect(runtime.getSession('session-1')).resolves.toMatchObject({
      permissionSelection: { currentValue: 'workspace-write' },
    })
    controlController.enqueue(encoder.encode(`${JSON.stringify({
      type: 'projection',
      sessionId: 'session-1',
      key: 'permissions',
      value: {
        options: [
          { value: 'workspace-write', name: 'Workspace write' },
          { value: 'danger-full-access', name: 'Full access' },
        ],
        currentValue: 'danger-full-access',
      },
      seq: 0,
    })}\n`))
    await expect(permissionSwitch).resolves.toMatchObject({
      currentValue: 'danger-full-access',
    })

    await runtime.run('session-1', {
      text: '检查这个入口',
      references: [{ path: 'src/main.ts', serializedText: '@src/main.ts' }],
      attachments: [{ receiptId: 'receipt-1', name: 'brief.pdf', bytes: 42 }],
    })
    expect(promptArguments).toMatchObject({
      request: {
        sessionId: 'session-1',
        mode: 'queue',
        content: [
          { type: 'file', receiptId: 'receipt-1' },
          { type: 'text', text: '@src/main.ts 检查这个入口' },
        ],
      },
    })
    await runtime.runCommand('session-1', {
      command: 'review',
      text: '检查安全问题',
      references: [{ path: 'src/main.ts', serializedText: '@src/main.ts' }],
      attachments: [{ receiptId: 'receipt-1', name: 'brief.pdf', bytes: 42 }],
    })
    expect(commandArguments).toEqual({
      agentId: 'session-1',
      line: '/review @src/main.ts 检查安全问题',
      submittedAttachments: [{ type: 'file', receiptId: 'receipt-1' }],
    })
    await expect(runtime.runCommand('session-1', {
      command: 'rejected', text: '', references: [], attachments: [],
    })).rejects.toThrow('命令执行失败，请稍后重试。')
    await expect(runtime.runCommand('session-1', {
      command: 'goal', text: '写一个重启 nginx 的脚本', references: [], attachments: [],
    })).rejects.toThrow('当前已有一个目标。请先点击“目标”退出，再创建新目标。')
    await expect(runtime.runCommand('session-1', {
      command: 'missing', text: '', references: [], attachments: [],
    })).rejects.toThrow('当前会话不支持该命令')

    const goalCommandUpdated = new Promise<void>(resolve => {
      const unsubscribe = runtime.subscribe(event => {
        if (event.type === 'session-updated' && event.session.messages.length === 1) {
          unsubscribe()
          resolve()
        }
      })
    })
    sessionController.enqueue(encoder.encode(`${JSON.stringify({
      type: 'event',
      event: {
        type: 'command/run',
        seq: 0,
        time: 2,
        data: {
          commandId: 'goal-command-1',
          name: 'goal',
          args: ' 交付可用版本 ',
          source: { kind: 'user' },
        },
      },
    })}\n`))
    await goalCommandUpdated
    await expect(runtime.getSession('session-1')).resolves.toMatchObject({
      messages: [{
        id: 'goal-command-1',
        role: 'user',
        text: '交付可用版本',
        invocation: { kind: 'goal', name: 'goal', label: '目标' },
      }],
    })

    const firstUpdated = new Promise<void>(resolve => {
      const unsubscribe = runtime.subscribe(event => {
        if (event.type === 'session-updated' && event.session.messages.length === 2) {
          unsubscribe()
          resolve()
        }
      })
    })
    sessionController.enqueue(encoder.encode(`${JSON.stringify({
      type: 'event',
      event: {
        type: 'command/run',
        seq: 1,
        time: 3,
        data: {
          commandId: 'plan-command-1',
          name: 'plan',
          args: ' 设计迁移方案',
          source: { kind: 'user' },
        },
      },
    })}\n`))
    sessionController.enqueue(encoder.encode(`${JSON.stringify({
      type: 'event',
      event: {
        type: 'user/message',
        seq: 2,
        time: 4,
        data: {
          id: 'message-1',
          content: [
            { type: 'file', attachment: { attachmentId: 'sha256:brief', name: 'brief.pdf', bytes: 42 } },
            { type: 'text', text: '设计迁移方案' },
          ],
          source: { kind: 'user' },
        },
      },
    })}\n`))
    await firstUpdated

    const secondUpdated = new Promise<void>(resolve => {
      const unsubscribe = runtime.subscribe(event => {
        if (event.type === 'session-updated' && event.session.messages.length === 3) {
          unsubscribe()
          resolve()
        }
      })
    })
    sessionController.enqueue(encoder.encode(`${JSON.stringify({
      type: 'event',
      event: {
        type: 'user/message',
        seq: 3,
        time: 5,
        data: {
          id: 'message-2',
          content: [
            { type: 'file', attachment: { attachmentId: 'sha256:script', name: '1.py', bytes: 180 } },
          ],
          source: { kind: 'user' },
        },
      },
    })}\n`))
    await secondUpdated

    await expect(runtime.getSession('session-1')).resolves.toMatchObject({
      messages: [
        {
          id: 'goal-command-1',
          text: '交付可用版本',
          invocation: { kind: 'goal', name: 'goal', label: '目标' },
        },
        {
          id: 'message-1',
          text: '设计迁移方案',
          invocation: { kind: 'plan', name: 'plan', label: '计划' },
          attachments: [{ id: 'sha256:brief', name: 'brief.pdf', bytes: 42 }],
        },
        {
          id: 'message-2',
          text: '',
          attachments: [{ id: 'sha256:script', name: '1.py', bytes: 180 }],
        },
      ],
    })
    await runtime.dispose()
  })
})
