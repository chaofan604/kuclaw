/** Harness Studio port of the upstream dsh Desktop Host child transport.
 *
 * Ported from vendor/deepseek-harness/apps/desktop/src/host-process.ts (MIT).
 * Spawns the upstream Node host child, verifies the protocol handshake, and
 * forwards fetch requests over the framed fd3/fd4 byte pipes.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { Readable, Writable } from 'node:stream'
import {
  DESKTOP_HOST_PROTOCOL_VERSION,
  DESKTOP_REQUEST_PIPE_FD,
  DESKTOP_RESPONSE_PIPE_FD,
  DesktopHostResponseDecoder,
  encodeDesktopRequestCancel,
  encodeDesktopRequestData,
  encodeDesktopRequestEnd,
  encodeDesktopRequestStart,
  type DesktopHostCommand,
  type DesktopHostEvent,
  type DesktopHostResponseFrame,
} from './dsh-host-protocol.js'

interface PendingResponse {
  readonly resolve: (response: Response) => void
  readonly reject: (error: Error) => void
  responseStarted: boolean
  controller?: ReadableStreamDefaultController<Uint8Array>
  requestReader?: ReadableStreamDefaultReader<Uint8Array>
  removeAbort?: () => void
}

function errorOf(reason: unknown, fallback: string): Error {
  return reason instanceof Error ? reason : new Error(fallback)
}

function isDesktopHostEvent(message: unknown): message is DesktopHostEvent {
  if (typeof message !== 'object' || message === null || !('type' in message)) return false
  const candidate = message as Record<string, unknown>
  return (candidate.type === 'ready' && candidate.protocolVersion === DESKTOP_HOST_PROTOCOL_VERSION
    && typeof candidate.dshVersion === 'string')
    || (candidate.type === 'fatal' && typeof candidate.message === 'string')
}

/** Facts reported by one ready dsh host child. */
export interface HarnessHostReady {
  readonly protocolVersion: typeof DESKTOP_HOST_PROTOCOL_VERSION
  readonly dshVersion: string
}

export interface HarnessHostOptions {
  /** Node executable that runs the host child (bundled Node in production). */
  nodeExecutable: string
  /** Directory whose node_modules carries @deepseek-ai/dsh-desktop-host. */
  runtimeDir: string
  /** Active dsh profile project directory. */
  projectDir: string
  /** Workspace development mode: allow bundles resolved outside runtime and profile. */
  allowLinkedProfile?: boolean
  /** Extra child environment (e.g. DSH_HOME, DEEPSEEK_API_KEY). */
  environment?: NodeJS.ProcessEnv
  /** Receives the first fatal child or transport failure. */
  onFailure?: (error: Error) => void
  /** Exact Harness version paired with this App build. */
  expectedDshVersion?: string
}

/** One dsh backend running under an upstream Node.js executable. */
export class HarnessHostProcess {
  private child: ChildProcess | undefined
  private requestPipe: Writable | undefined
  private responsePipe: Readable | undefined
  private readonly responseDecoder = new DesktopHostResponseDecoder()
  private requestWriteTail: Promise<void> = Promise.resolve()
  private nextStreamId = 1
  private readonly pending = new Map<number, PendingResponse>()
  private readonly readyPromise: Promise<HarnessHostReady>
  private readyResolve!: (ready: HarnessHostReady) => void
  private readyReject!: (error: Error) => void
  private exitPromise: Promise<void> | undefined
  private stderr = ''
  private failureReported = false

  constructor(private readonly options: HarnessHostOptions) {
    this.readyPromise = new Promise<HarnessHostReady>((resolve, reject) => {
      this.readyResolve = resolve
      this.readyReject = reject
    })
  }

  /** Start the child once and resolve only after its complete composition is active. */
  async start(): Promise<HarnessHostReady> {
    if (this.child !== undefined) return this.readyPromise
    const installedEntry = join(this.options.runtimeDir, 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'index.js')
    const entry = existsSync(installedEntry) ? installedEntry : join(this.options.runtimeDir, 'lib', 'index.js')
    const child = spawn(this.options.nodeExecutable, [
      entry,
      this.options.runtimeDir,
      this.options.projectDir,
      ...(this.options.allowLinkedProfile === true ? ['--allow-linked-profile'] : []),
    ], {
      cwd: this.options.projectDir,
      env: {
        ...process.env,
        ...this.options.environment,
        NODE_OPTIONS: undefined,
        NODE_PATH: undefined,
      },
      stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe', 'ipc'],
    })
    const requestPipe = child.stdio[DESKTOP_REQUEST_PIPE_FD]
    const responsePipe = child.stdio[DESKTOP_RESPONSE_PIPE_FD]
    if (!(requestPipe instanceof Writable) || !(responsePipe instanceof Readable)) {
      child.kill('SIGTERM')
      throw new Error('dsh host did not expose the required byte pipes and IPC channel')
    }
    this.child = child
    this.requestPipe = requestPipe
    this.responsePipe = responsePipe
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => { this.stderr += chunk })
    child.stdout?.on('data', (chunk: Buffer) => process.stdout.write(chunk))
    responsePipe.on('data', (chunk: Buffer) => { this.acceptResponseBytes(chunk) })
    responsePipe.once('end', () => { this.fail(new Error('dsh host response pipe ended')) })
    requestPipe.once('error', (error) => { this.fail(error) })
    responsePipe.once('error', (error) => { this.fail(error) })
    child.on('message', (message: unknown) => {
      if (!isDesktopHostEvent(message)) {
        this.fail(new Error(`dsh host sent an invalid IPC event: ${JSON.stringify(message)}`))
        child.kill('SIGTERM')
        return
      }
      if (message.type === 'ready') {
        if (this.options.expectedDshVersion !== undefined
          && message.dshVersion !== this.options.expectedDshVersion) {
          this.fail(new Error(`dsh host version ${message.dshVersion} does not match ${this.options.expectedDshVersion}`))
          child.kill('SIGTERM')
          return
        }
        this.readyResolve(message)
      }
      else this.fail(new Error(message.message))
    })
    child.once('error', (error) => { this.fail(error) })
    this.exitPromise = new Promise<void>((resolve) => {
      child.once('close', (code) => {
        const suffix = this.stderr.trim() === '' ? '' : `: ${this.stderr.trim()}`
        if (code !== 0 && code !== null) this.fail(new Error(`dsh host exited with ${String(code)}${suffix}`))
        else this.fail(new Error(`dsh host stopped${suffix}`))
        resolve()
      })
    })
    return this.readyPromise
  }

  /** Forward one request to the child and resolve with its streaming Response. */
  async fetch(request: Request): Promise<Response> {
    await this.start()
    const child = this.child
    if (child === undefined || !child.connected || this.requestPipe === undefined) {
      throw new Error('dsh host is unavailable')
    }
    const streamId = this.nextStreamId++
    const method = request.method.toUpperCase()
    const hasBody = method !== 'GET' && method !== 'HEAD' && request.body !== null
    return new Promise<Response>((resolve, reject) => {
      const pending: PendingResponse = { resolve, reject, responseStarted: false }
      const abort = (): void => {
        if (!this.pending.has(streamId)) return
        const error = errorOf(request.signal.reason, 'request aborted')
        void pending.requestReader?.cancel(error).catch(() => undefined)
        this.enqueueRequestFrame(encodeDesktopRequestCancel(streamId)).catch((pipeError: unknown) => {
          this.fail(errorOf(pipeError, 'dsh request pipe failed'))
        })
        if (pending.controller === undefined) pending.reject(error)
        else pending.controller.error(error)
        this.finishPending(streamId)
      }
      if (request.signal.aborted) {
        reject(errorOf(request.signal.reason, 'request aborted'))
        return
      }
      request.signal.addEventListener('abort', abort, { once: true })
      pending.removeAbort = () => { request.signal.removeEventListener('abort', abort) }
      this.pending.set(streamId, pending)
      this.pumpRequest(streamId, request, hasBody).catch((error: unknown) => {
        this.failPending(streamId, errorOf(error, 'dsh request upload failed'))
      })
    })
  }

  /** Request graceful teardown, then wait for child exit. */
  async stop(): Promise<void> {
    const child = this.child
    if (child === undefined) return
    this.failureReported = true
    this.responsePipe?.resume()
    if (child.connected) this.send({ type: 'shutdown' })
    this.requestPipe?.destroy()
    const exited = this.exitPromise ?? Promise.resolve()
    const within = async (milliseconds: number): Promise<boolean> => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<false>(resolve => {
        timer = setTimeout(() => resolve(false), milliseconds)
        timer.unref()
      })
      try { return await Promise.race([exited.then(() => true), timeout]) } finally { clearTimeout(timer) }
    }
    if (!await within(10_000)) child.kill('SIGTERM')
    if (!await within(5_000)) child.kill('SIGKILL')
    this.child = undefined
    this.requestPipe = undefined
    this.responsePipe = undefined
  }

  private async pumpRequest(streamId: number, request: Request, hasBody: boolean): Promise<void> {
    await this.enqueueRequestFrame(encodeDesktopRequestStart(streamId, {
      url: request.url,
      method: method_of(request),
      headers: [...request.headers.entries()],
      hasBody,
    }))
    if (!hasBody) return
    const body = request.body
    if (body === null) throw new Error('dsh request body disappeared before upload')
    const reader = body.getReader()
    const pending = this.pending.get(streamId)
    if (pending === undefined) {
      await reader.cancel()
      return
    }
    pending.requestReader = reader
    try {
      for (;;) {
        const next = await reader.read()
        if (next.done) break
        await this.enqueueRequestFrame(encodeDesktopRequestData(streamId, next.value))
      }
      if (this.pending.has(streamId)) await this.enqueueRequestFrame(encodeDesktopRequestEnd(streamId))
    } finally {
      reader.releaseLock()
    }
  }

  private enqueueRequestFrame(frame: Buffer): Promise<void> {
    const write = this.requestWriteTail.then(async () => {
      const pipe = this.requestPipe
      if (pipe === undefined || pipe.destroyed) throw new Error('dsh host request pipe is unavailable')
      if (!pipe.write(frame)) await once(pipe, 'drain')
    })
    this.requestWriteTail = write.catch(() => undefined)
    return write
  }

  private send(message: DesktopHostCommand): void {
    const child = this.child
    if (child === undefined || !child.connected) throw new Error('dsh host IPC is unavailable')
    child.send(message, (error) => { if (error !== null) this.fail(error) })
  }

  private acceptResponseBytes(chunk: Buffer): void {
    try {
      for (const frame of this.responseDecoder.push(chunk)) this.handleResponseFrame(frame)
    } catch (error) {
      this.fail(errorOf(error, 'dsh host response pipe failed'))
      this.child?.kill('SIGTERM')
    }
  }

  private handleResponseFrame(frame: DesktopHostResponseFrame): void {
    const pending = this.pending.get(frame.streamId)
    if (pending === undefined) return
    switch (frame.type) {
      case 'start': {
        pending.responseStarted = true
        let body: ReadableStream<Uint8Array> | null = null
        if (frame.hasBody) {
          body = new ReadableStream<Uint8Array>({
            start: (controller) => { pending.controller = controller },
          })
        }
        pending.resolve(new Response(body, {
          status: frame.status,
          headers: new Headers(frame.headers.map(([name, value]) => [name, value] as [string, string])),
        }))
        return
      }
      case 'data':
        pending.controller?.enqueue(frame.data)
        return
      case 'end':
        pending.controller?.close()
        this.finishPending(frame.streamId)
        return
      case 'error':
        this.failPending(frame.streamId, new Error(frame.message))
        return
    }
  }

  private failPending(streamId: number, error: Error): void {
    const pending = this.pending.get(streamId)
    if (pending === undefined) return
    void pending.requestReader?.cancel(error).catch(() => undefined)
    if (pending.controller === undefined) pending.reject(error)
    else pending.controller.error(error)
    this.enqueueRequestFrame(encodeDesktopRequestCancel(streamId)).catch(() => undefined)
    this.finishPending(streamId)
  }

  private finishPending(streamId: number): void {
    const pending = this.pending.get(streamId)
    if (pending === undefined) return
    pending.removeAbort?.()
    this.pending.delete(streamId)
  }

  private fail(error: Error): void {
    this.readyReject(error)
    if (!this.failureReported) {
      this.failureReported = true
      try { this.options.onFailure?.(error) } catch (listenerError) {
        console.error('harness host failure listener failed', listenerError)
      }
    }
    for (const pending of this.pending.values()) {
      void pending.requestReader?.cancel(error).catch(() => undefined)
      if (pending.controller === undefined) pending.reject(error)
      else pending.controller.error(error)
      pending.removeAbort?.()
    }
    this.pending.clear()
    this.responsePipe?.resume()
  }
}

function method_of(request: Request): string {
  return request.method.toUpperCase()
}
