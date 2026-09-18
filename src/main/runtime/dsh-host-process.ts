/** Harness Studio lifecycle and authenticated HTTP adapter for the upstream Desktop Host. */

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  DESKTOP_HOST_PROTOCOL_VERSION,
  EXPECTED_DSH_VERSION,
} from './dsh-host-protocol.js'

interface ReadyEvent {
  readonly type: 'ready'
  readonly url: string
}

interface FatalEvent {
  readonly type: 'fatal'
  readonly message: string
}

type DesktopHostEvent = ReadyEvent | FatalEvent | { readonly type: 'shutdown-complete' }

const MAX_HOST_DIAGNOSTIC_CHARS = 64 * 1024

function errorOf(reason: unknown, fallback: string): Error {
  return reason instanceof Error ? reason : new Error(fallback)
}

function isDesktopHostEvent(message: unknown): message is DesktopHostEvent {
  if (typeof message !== 'object' || message === null || !('type' in message)) return false
  const candidate = message as Record<string, unknown>
  switch (candidate.type) {
    case 'ready': return typeof candidate.url === 'string'
    case 'fatal': return typeof candidate.message === 'string'
    case 'shutdown-complete': return true
    default: return false
  }
}

async function exitsWithin(exit: Promise<void>, milliseconds: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => { resolve(false) }, milliseconds)
    timer.unref()
  })
  try {
    return await Promise.race([exit.then(() => true), timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** Facts reported after the Host is ready and browser authentication is established. */
export interface HarnessHostReady {
  readonly protocolVersion: typeof DESKTOP_HOST_PROTOCOL_VERSION
  readonly dshVersion: string
}

export interface HarnessHostOptions {
  /** Node executable that runs the Host child. */
  nodeExecutable: string
  /** Directory whose node_modules carries @deepseek-ai/dsh-desktop-host. */
  runtimeDir: string
  /** Active dsh profile project directory. */
  projectDir: string
  /** Workspace development mode permits linked profile packages. */
  allowLinkedProfile?: boolean
  /** Extra child environment, including DSH_HOME and provider credentials. */
  environment?: NodeJS.ProcessEnv
  /** Receives the first unexpected child failure. */
  onFailure?: (error: Error) => void
  /** Exact Harness version paired with this App build. */
  expectedDshVersion?: string
}

interface AuthenticatedHost {
  readonly origin: string
  readonly cookie: string
}

/** One dsh backend running under the bundled Node executable. */
export class HarnessHostProcess {
  private child: ChildProcess | undefined
  private authenticated: AuthenticatedHost | undefined
  private readyResolve!: (ready: HarnessHostReady) => void
  private readyReject!: (error: Error) => void
  private readonly readyPromise = new Promise<HarnessHostReady>((resolve, reject) => {
    this.readyResolve = resolve
    this.readyReject = reject
  })
  private exitPromise: Promise<void> | undefined
  private stderr = ''
  private failureReported = false
  private stopping = false

  constructor(private readonly options: HarnessHostOptions) {}

  /** Start the child once and resolve after its authenticated Web application is ready. */
  async start(): Promise<HarnessHostReady> {
    if (this.child !== undefined) return this.readyPromise
    const installedEntry = join(
      this.options.runtimeDir, 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'index.js',
    )
    const entry = existsSync(installedEntry) ? installedEntry : join(this.options.runtimeDir, 'lib', 'index.js')
    const child = spawn(this.options.nodeExecutable, [
      '--expose-internals',
      entry,
      this.options.runtimeDir,
      this.options.projectDir,
      join(this.options.runtimeDir, 'primary-runtime'),
      this.options.allowLinkedProfile === true ? 'link' : 'runtime',
    ], {
      cwd: this.options.projectDir,
      env: {
        ...process.env,
        ...this.options.environment,
        HARNESS_STUDIO_DISABLE_OFFICE: '1',
        HARNESS_STUDIO_PORT: '0',
        NODE_OPTIONS: undefined,
        NODE_PATH: undefined,
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    })
    this.child = child
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      this.stderr = (this.stderr + chunk).slice(-MAX_HOST_DIAGNOSTIC_CHARS)
    })
    child.stdout?.pipe(process.stdout)
    child.on('message', (message: unknown) => {
      if (!isDesktopHostEvent(message)) {
        this.fail(new Error('dsh desktop host sent an invalid IPC event'))
        child.kill('SIGTERM')
        return
      }
      if (message.type === 'ready') {
        void this.acceptReady(message.url).catch((error: unknown) => {
          this.fail(errorOf(error, 'dsh desktop host authentication failed'))
          child.kill('SIGTERM')
        })
      } else if (message.type === 'shutdown-complete') {
        if (!this.stopping) this.fail(new Error('dsh desktop host acknowledged an unrequested shutdown'))
      } else {
        this.fail(new Error(message.message))
      }
    })
    child.once('error', (error) => { this.fail(error) })
    this.exitPromise = new Promise<void>((resolve) => {
      child.once('close', (code) => {
        const suffix = this.stderr.trim() === '' ? '' : `: ${this.stderr.trim()}`
        if (code !== 0 && code !== null) this.fail(new Error(`dsh host exited with ${String(code)}${suffix}`))
        else if (!this.stopping) this.fail(new Error(`dsh host stopped${suffix}`))
        resolve()
      })
    })
    return this.readyPromise
  }

  /** Forward one request through the Host's authenticated loopback server. */
  async fetch(request: Request): Promise<Response> {
    await this.start()
    const authenticated = this.authenticated
    if (authenticated === undefined) throw new Error('dsh host authentication is unavailable')
    const source = new URL(request.url)
    const target = new URL(`${source.pathname}${source.search}`, authenticated.origin)
    const headers = new Headers(request.headers)
    headers.set('cookie', authenticated.cookie)
    headers.delete('host')
    const hasBody = request.method !== 'GET' && request.method !== 'HEAD' && request.body !== null
    const init: RequestInit & { duplex?: 'half' } = {
      method: request.method,
      headers,
      signal: request.signal,
      redirect: 'manual',
      ...(hasBody ? { body: request.body, duplex: 'half' } : {}),
    }
    return fetch(target, init)
  }

  /** Request graceful teardown, then wait for child exit. */
  async stop(): Promise<void> {
    const child = this.child
    if (child === undefined) return
    this.stopping = true
    if (child.connected) child.send({ type: 'shutdown' }, (error) => {
      if (error !== null) this.fail(error)
    })
    const exited = this.exitPromise ?? Promise.resolve()
    if (!await exitsWithin(exited, 10_000)) child.kill('SIGTERM')
    if (!await exitsWithin(exited, 5_000)) child.kill('SIGKILL')
    this.child = undefined
    this.authenticated = undefined
  }

  private async acceptReady(url: string): Promise<void> {
    const response = await fetch(url, { redirect: 'manual' })
    const cookie = response.headers.get('set-cookie')?.split(';', 1)[0]
    if (response.status !== 303 || cookie === undefined || cookie === '') {
      throw new Error(`dsh host rejected its launch credential with HTTP ${String(response.status)}`)
    }
    const expectedDshVersion = this.options.expectedDshVersion ?? EXPECTED_DSH_VERSION
    this.authenticated = { origin: new URL(url).origin, cookie }
    this.readyResolve({
      protocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
      dshVersion: expectedDshVersion,
    })
  }

  private fail(error: Error): void {
    this.readyReject(error)
    if (!this.failureReported && !this.stopping) {
      this.failureReported = true
      try { this.options.onFailure?.(error) } catch (listenerError) {
        console.error('harness host failure listener failed', listenerError)
      }
    }
  }
}
