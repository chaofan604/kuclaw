/** Launch the Desktop profile through the Web application and report its URL to Electron. */

import { once } from 'node:events'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadLayeredEnv, loadProfileDirectory } from '@deepseek-ai/dsh-app-boot'
import { runProfile } from '@deepseek-ai/dsh/profile-boot'
import type {} from '@deepseek-ai/dsh-api-gateway'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import * as desktopOffice from './office.ts'

import { installDesktopUpdateTaskControl } from './update-tasks.ts'

const DESKTOP_PATCH = fileURLToPath(new URL('../config/desktop.cordis.patch.yml', import.meta.url))

/** Preserve Harness Studio's NDJSON stream carrier while the upstream Web client uses WebSocket multiplexing. */
function installHarnessStudioStream(ctx: Awaited<ReturnType<typeof runProfile>>['ctx']): void {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/.dsh/remote-stream',
    handler: async (req, res) => {
      const rejection = ctx.connection.requestRejection(req)
      if (rejection !== undefined) {
        res.writeHead(rejection)
        res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
        return
      }
      if (req.method !== 'POST') {
        res.writeHead(405, { allow: 'POST' })
        res.end()
        return
      }
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      let body: unknown
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
      } catch {
        res.writeHead(400)
        res.end('body is not JSON')
        return
      }
      if (typeof body !== 'object' || body === null
        || !('endpoint' in body) || typeof body.endpoint !== 'string'
        || !('payload' in body)) {
        res.writeHead(400)
        res.end('invalid stream request')
        return
      }
      const abort = new AbortController()
      req.once('aborted', () => { abort.abort() })
      res.once('close', () => { abort.abort() })
      try {
        const values = await ctx.typertGateway.wireStream.open(body.endpoint, body.payload, abort.signal)
        res.writeHead(200, { 'content-type': 'application/x-ndjson' })
        for await (const value of values) {
          if (!res.write(`${JSON.stringify(value)}\n`)) await once(res, 'drain')
        }
        res.end()
      } catch (error) {
        if (!res.headersSent) {
          res.writeHead(500)
          res.end(error instanceof Error ? error.message : String(error))
        } else {
          res.destroy(error instanceof Error ? error : new Error(String(error)))
        }
      }
    },
  }), 'desktop-host: Harness Studio NDJSON stream')
}

async function main(): Promise<void> {
  const runtimeDir = process.argv[2] as string
  const projectDir = process.argv[3] as string
  const installAnchor = join(runtimeDir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
  const profile = loadProfileDirectory('dsh', projectDir, installAnchor)
  const application = runProfile({
    environment: loadLayeredEnv('dsh'),
    profile: 'desktop',
    resolutionMode: process.argv[5] === 'runtime' ? 'runtime' : 'link',
    resolvedProfile: { profile, installAnchor },
    patchFiles: [DESKTOP_PATCH],
    args: ['--no-open', '--port', process.env.HARNESS_STUDIO_PORT ?? '0'],
    ...(process.argv[6] === undefined ? {} : {
      packageManager: {
        command: process.execPath,
        args: ['--expose-internals', process.argv[6]],
        env: {
          ELECTRON_RUN_AS_NODE: '1',
          DSH_DESKTOP_NODE_EXECUTABLE: process.execPath,
          PATH: `${process.argv[7] ?? ''}${delimiter}${process.env.PATH ?? ''}`,
        },
      },
    }),
  })
  let stopping: Promise<void> | undefined
  const control: { updateTasks?: ReturnType<typeof installDesktopUpdateTaskControl> } = {}
  const send = (message: object): Promise<void> => new Promise((resolve, reject) => {
    if (!process.connected || process.send === undefined) { resolve(); return }
    process.send(message, (error) => { if (error === null) resolve(); else reject(error) })
  })
  const stop = (): Promise<void> => stopping ??= (async () => {
    // Startup failure is reported by main; shutdown only owns a tree that booted.
    const running = await application.catch(() => undefined)
    await running?.shutdown.shutdown(0)
    await send({ type: 'shutdown-complete' })
    if (process.connected) process.disconnect()
  })()
  process.on('message', (message: unknown) => {
    if (typeof message !== 'object' || message === null || !('type' in message)) return
    if (message.type === 'shutdown') { void stop(); return }
    if (message.type !== 'update-tasks' || !('requestId' in message) || !Number.isSafeInteger(message.requestId)
      || !('action' in message) || !['inspect', 'lock', 'unlock'].includes(String(message.action))) return
    void (async () => {
      try {
        if (stopping !== undefined || control.updateTasks === undefined) throw new Error('desktop update: Host is unavailable')
        const active = await control.updateTasks(message.action as 'inspect' | 'lock' | 'unlock')
        await send({ type: 'update-tasks', requestId: message.requestId, active })
      } catch (error) {
        await send({ type: 'update-tasks', requestId: message.requestId, active: true,
          error: error instanceof Error ? error.message : String(error) })
      }
    })().catch((error: unknown) => { console.error(error) })
  })
  process.once('disconnect', () => { void stop() })
  const { ctx } = await application
  installHarnessStudioStream(ctx)
  control.updateTasks = installDesktopUpdateTaskControl(ctx)
  if (process.env.HARNESS_STUDIO_DISABLE_OFFICE !== '1') {
    await ctx.plugin(desktopOffice, {
      source: process.argv[4] ?? join(runtimeDir, '..', 'runtime', 'primary-runtime'),
      root: join(resolveDshHome(), 'dsh-runtimes', 'dsh-primary-runtime'),
    })
  }
  const url = ctx.connection.authenticatedUrl(`http://127.0.0.1:${String(ctx.webServer.port)}`)
  if (process.connected) process.send?.({ type: 'ready', url, injections: ctx.webServer.collectIndexInjections() }, (error) => { if (error !== null) console.error(error) })
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    if (process.connected) process.send?.({ type: 'fatal', message }, (error) => { if (error !== null) console.error(error) })
    console.error(error)
    process.exitCode = 1
    if (process.connected) process.disconnect()
  })
}
