import { randomUUID } from 'node:crypto'
import type { HarnessHostProcess } from './dsh-host-process.js'

interface RpcSuccess<T> {
  readonly ok: true
  readonly value: T
}

interface RpcFailure {
  readonly ok: false
  readonly error: {
    readonly code: string
    readonly message: string
    readonly details: Record<string, unknown>
  }
}

interface RpcResponse<T> {
  readonly type: 'server-response'
  readonly rpcId: string
  readonly result: RpcSuccess<T> | RpcFailure
}

interface BusinessResponse<T> {
  readonly ok: boolean
  readonly value?: T
  readonly error?: RpcFailure['error']
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A business failure returned by a DeepSeek Harness Remote endpoint. */
export class HarnessRemoteError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'HarnessRemoteError'
  }
}

/**
 * Typed-at-the-edge client for the Desktop Host's unary and NDJSON Remote transports.
 *
 * Business payload validation remains owned by the fixed Harness version. This
 * adapter validates only the shared transport envelopes before product code
 * consumes them.
 */
export class HarnessHostClient {
  constructor(private readonly host: Pick<HarnessHostProcess, 'fetch'>) {}

  /** Invoke one generated unary Remote endpoint. */
  async call<T>(
    endpoint: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> {
    const rpcId = randomUUID()
    const response = await this.host.fetch(new Request(
      `http://dsh.internal/api/${endpoint}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'client-request',
          rpcId,
          method: endpoint,
          payload: { args },
        }),
        ...(signal === undefined ? {} : { signal }),
      },
    ))
    if (!response.ok) {
      throw new Error(`Harness endpoint ${endpoint} returned HTTP ${String(response.status)}: ${await response.text()}`)
    }
    const envelope = this.parseRpcResponse<T>(await response.json(), endpoint)
    if (envelope.rpcId !== rpcId) {
      throw new Error(`Harness endpoint ${endpoint} returned rpcId ${envelope.rpcId}, expected ${rpcId}`)
    }
    if (!envelope.result.ok) {
      throw new HarnessRemoteError(
        envelope.result.error.code,
        envelope.result.error.message,
        envelope.result.error.details,
      )
    }
    return envelope.result.value
  }

  /** Forward one authenticated streaming upload and unwrap its business result. */
  async postStream<T>(
    path: string,
    body: ReadableStream<Uint8Array>,
    headers: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<T> {
    const init: RequestInit & { duplex: 'half' } = {
      method: 'POST',
      headers,
      body,
      duplex: 'half',
      ...(signal === undefined ? {} : { signal }),
    }
    const response = await this.host.fetch(new Request(new URL(path, 'http://dsh.internal'), init))
    if (!response.ok) {
      throw new Error(`Harness upload returned HTTP ${String(response.status)}: ${await response.text()}`)
    }
    const envelope = await response.json() as BusinessResponse<T>
    if (envelope.ok === true && envelope.value !== undefined) return envelope.value
    const error = envelope.error
    if (envelope.ok !== false || error === undefined || typeof error.code !== 'string'
      || typeof error.message !== 'string' || !isRecord(error.details)) {
      throw new TypeError('Harness upload returned an invalid business response')
    }
    throw new HarnessRemoteError(error.code, error.message, error.details)
  }

  /** Open one generated streaming Remote endpoint over the Desktop Host NDJSON route. */
  async *stream<T>(
    endpoint: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ): AsyncGenerator<T> {
    const response = await this.host.fetch(new Request(
      'http://dsh.internal/.dsh/remote-stream',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint, payload: { args } }),
        signal,
      },
    ))
    if (!response.ok || response.body === null) {
      throw new Error(`Harness stream ${endpoint} returned HTTP ${String(response.status)}`)
    }
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let pending = ''
    try {
      for (;;) {
        const next = await reader.read()
        pending += decoder.decode(next.value, { stream: !next.done })
        let newline = pending.indexOf('\n')
        while (newline !== -1) {
          const line = pending.slice(0, newline)
          pending = pending.slice(newline + 1)
          if (line !== '') yield this.parseStreamItem<T>(line, endpoint)
          newline = pending.indexOf('\n')
        }
        if (next.done) break
      }
      if (pending !== '') yield this.parseStreamItem<T>(pending, endpoint)
    } finally {
      reader.releaseLock()
    }
  }

  private parseRpcResponse<T>(value: unknown, endpoint: string): RpcResponse<T> {
    if (!isRecord(value) || value.type !== 'server-response' || typeof value.rpcId !== 'string') {
      throw new TypeError(`Harness endpoint ${endpoint} returned an invalid server-response envelope`)
    }
    const result = value.result
    if (!isRecord(result)) {
      throw new TypeError(`Harness endpoint ${endpoint} returned an invalid result`)
    }
    if (result.ok === true) {
      return {
        type: 'server-response',
        rpcId: value.rpcId,
        result: { ok: true, value: result.value as T },
      }
    }
    if (result.ok !== false || !isRecord(result.error)) {
      throw new TypeError(`Harness endpoint ${endpoint} returned an invalid failure`)
    }
    const error = result.error
    if (typeof error.code !== 'string' || typeof error.message !== 'string' || !isRecord(error.details)) {
      throw new TypeError(`Harness endpoint ${endpoint} returned malformed error fields`)
    }
    return {
      type: 'server-response',
      rpcId: value.rpcId,
      result: {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      },
    }
  }

  private parseStreamItem<T>(line: string, endpoint: string): T {
    try {
      return JSON.parse(line) as T
    } catch (error) {
      throw new TypeError(
        `Harness stream ${endpoint} returned invalid NDJSON: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
}
