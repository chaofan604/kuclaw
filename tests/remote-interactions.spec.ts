import { describe, expect, it, vi } from 'vitest'
import { HarnessAgentRuntime } from '../src/main/runtime/harness-runtime.js'

describe('Harness Remote Events interactions', () => {
  it('publishes and answers an approval through the correlated event result', async () => {
    let streamController!: ReadableStreamDefaultController<Uint8Array>
    let reply: Record<string, unknown> | undefined
    const encoder = new TextEncoder()
    const host = {
      start: () => Promise.resolve({ protocolVersion: 3, dshVersion: 'test' }),
      stop: () => {
        try { streamController.close() } catch {}
        return Promise.resolve()
      },
      fetch: async (request: Request) => {
        if (new URL(request.url).pathname === '/.dsh/remote-stream') {
          const body = JSON.parse(await request.text()) as { endpoint: string }
          if (body.endpoint === 'session/control') {
            return new Response('{"type":"baseline","value":{"jobs":{},"projections":{}}}\n')
          }
          expect(body.endpoint).toBe('$events')
          return new Response(new ReadableStream<Uint8Array>({
            start(controller) {
              streamController = controller
              controller.enqueue(encoder.encode('{"type":"ready","clientId":"client-1","host":{"home":"/tmp"}}\n'))
              request.signal.addEventListener('abort', () => {
                try { controller.error(request.signal.reason) } catch {}
              }, { once: true })
            },
          }))
        }
        const envelope = JSON.parse(await request.text()) as {
          rpcId: string
          payload: { args: Record<string, unknown> }
        }
        reply = envelope.payload.args
        return Response.json({
          type: 'server-response',
          rpcId: envelope.rpcId,
          result: { ok: true, value: undefined },
        })
      },
    }
    const runtime = await HarnessAgentRuntime.create(host as never)
    runtime.setInteractionAnswererAvailable(true)
    streamController.enqueue(encoder.encode(`${JSON.stringify({
      type: 'waterfall',
      event: 'approval/request',
      eventId: 'approval-1',
      agentId: 'session-1',
      request: { toolName: 'bash', callId: 'call-1', reason: '运行测试命令' },
    })}\n`))

    await vi.waitFor(async () => {
      await expect(runtime.listPendingInteractions()).resolves.toMatchObject([{
        id: 'approval-1', kind: 'approval', sessionId: 'session-1', toolName: 'bash',
      }])
    })
    await runtime.answerApproval('approval-1', 'allowed-once')
    expect(reply).toEqual({
      clientId: 'client-1',
      eventId: 'approval-1',
      outcome: { kind: 'result', value: 'allowed-once' },
    })
    await expect(runtime.listPendingInteractions()).resolves.toEqual([])
    await runtime.dispose()
  })

  it('delegates requests while no UI answerer is connected', async () => {
    let streamController!: ReadableStreamDefaultController<Uint8Array>
    const replies: Record<string, unknown>[] = []
    const encoder = new TextEncoder()
    const host = {
      start: () => Promise.resolve({ protocolVersion: 3, dshVersion: 'test' }),
      stop: () => {
        try { streamController.close() } catch {}
        return Promise.resolve()
      },
      fetch: async (request: Request) => {
        if (new URL(request.url).pathname === '/.dsh/remote-stream') {
          const body = JSON.parse(await request.text()) as { endpoint: string }
          if (body.endpoint === 'session/control') {
            return new Response('{"type":"baseline","value":{"jobs":{},"projections":{}}}\n')
          }
          return new Response(new ReadableStream<Uint8Array>({
            start(controller) {
              streamController = controller
              controller.enqueue(encoder.encode('{"type":"ready","clientId":"client-2","host":{"home":"/tmp"}}\n'))
              request.signal.addEventListener('abort', () => {
                try { controller.error(request.signal.reason) } catch {}
              }, { once: true })
            },
          }))
        }
        const envelope = JSON.parse(await request.text()) as { rpcId: string; payload: { args: Record<string, unknown> } }
        replies.push(envelope.payload.args)
        return Response.json({ type: 'server-response', rpcId: envelope.rpcId, result: { ok: true, value: undefined } })
      },
    }
    const runtime = await HarnessAgentRuntime.create(host as never)
    streamController.enqueue(encoder.encode(`${JSON.stringify({
      type: 'waterfall', event: 'approval/request', eventId: 'approval-2', agentId: 'session-2',
      request: { toolName: 'bash' },
    })}\n`))
    await vi.waitFor(() => expect(replies).toHaveLength(1))
    expect(replies[0]).toMatchObject({ eventId: 'approval-2', outcome: { kind: 'next' } })
    await expect(runtime.listPendingInteractions()).resolves.toEqual([])
    await runtime.dispose()
  })
})
