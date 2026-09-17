import { describe, expect, it } from 'vitest'
import { HarnessHostClient, HarnessRemoteError } from '../src/main/runtime/dsh-host-client.js'

function clientWith(fetch: (request: Request) => Promise<Response>): HarnessHostClient {
  return new HarnessHostClient({ fetch } as never)
}

describe('HarnessHostClient', () => {
  it('sends the generated unary envelope and returns its value', async () => {
    const client = clientWith(async (request) => {
      expect(new URL(request.url).pathname).toBe('/api/session/list')
      const body = await request.json() as { rpcId: string }
      expect(body).toMatchObject({
        type: 'client-request',
        method: 'session/list',
        payload: { args: { _request: {} } },
      })
      return Response.json({
        type: 'server-response',
        rpcId: body.rpcId,
        result: { ok: true, value: { items: [] } },
      })
    })
    await expect(client.call('session/list', { _request: {} })).resolves.toEqual({ items: [] })
  })

  it('streams a selected file to the authenticated upload route and unwraps its staged receipt', async () => {
    const client = clientWith(async (request) => {
      const url = new URL(request.url)
      expect(url.pathname).toBe('/api/session/uploadFileBinary')
      expect(url.searchParams.get('sessionId')).toBe('session-1')
      expect(request.headers.get('content-type')).toBe('application/octet-stream')
      expect(await request.text()).toBe('selected bytes')
      return Response.json({
        ok: true,
        value: {
          receiptId: 'receipt-1',
          file: { attachmentId: 'sha256', name: 'notes.txt', bytes: 14 },
        },
      })
    })
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('selected bytes'))
        controller.close()
      },
    })
    await expect(client.postStream(
      '/api/session/uploadFileBinary?sessionId=session-1',
      body,
      { 'content-type': 'application/octet-stream' },
    )).resolves.toMatchObject({ receiptId: 'receipt-1', file: { name: 'notes.txt', bytes: 14 } })
  })

  it('preserves a Remote business failure', async () => {
    const client = clientWith(async (request) => {
      const body = await request.json() as { rpcId: string }
      return Response.json({
        type: 'server-response',
        rpcId: body.rpcId,
        result: {
          ok: false,
          error: {
            code: 'session/not-found',
            message: 'missing',
            details: { sessionId: 's1' },
          },
        },
      })
    })
    await expect(client.call('session/cancel', { request: { sessionId: 's1' } }))
      .rejects.toEqual(new HarnessRemoteError('session/not-found', 'missing', { sessionId: 's1' }))
  })

  it('decodes the Desktop Host NDJSON stream', async () => {
    const client = clientWith(async (request) => {
      expect(new URL(request.url).pathname).toBe('/.dsh/remote-stream')
      expect(await request.json()).toEqual({
        endpoint: 'session/follow',
        payload: { args: { request: { address: { kind: 'session', sessionId: 's1' } } } },
      })
      return new Response('{"type":"snapshot","cursor":-1}\n{"type":"event","event":{"seq":0}}\n', {
        headers: { 'content-type': 'application/x-ndjson' },
      })
    })
    const controller = new AbortController()
    const values: unknown[] = []
    for await (const value of client.stream('session/follow', {
      request: { address: { kind: 'session', sessionId: 's1' } },
    }, controller.signal)) {
      values.push(value)
    }
    expect(values).toEqual([
      { type: 'snapshot', cursor: -1 },
      { type: 'event', event: { seq: 0 } },
    ])
  })
})
