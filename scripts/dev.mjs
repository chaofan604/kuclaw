import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const children = new Set()
const harnessMode = process.argv.includes('--harness')
const projectRoot = resolve(import.meta.dirname, '..')

function run(command, args, options = {}) {
  const child = spawn(command, args, { stdio: 'inherit', ...options })
  children.add(child)
  child.once('exit', () => children.delete(child))
  return child
}

async function waitForServer(url) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // Vite is still starting.
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out waiting for ${url}`)
}

function stop() {
  for (const child of children) child.kill('SIGTERM')
}

process.once('SIGINT', stop)
process.once('SIGTERM', stop)

const build = run('pnpm', ['run', 'build:main'])
const buildCode = await new Promise(resolve => build.once('exit', resolve))
if (buildCode !== 0) process.exit(Number(buildCode ?? 1))

const vite = run('pnpm', ['exec', 'vite', '--host', '127.0.0.1', '--port', '5173'])
try {
  await waitForServer('http://127.0.0.1:5173')
  const electron = run('pnpm', ['exec', 'electron', '.'], {
    env: {
      ...process.env,
      HARNESS_STUDIO_DEV_SERVER: 'http://127.0.0.1:5173',
      ...(harnessMode ? {
        HARNESS_STUDIO_RUNTIME: 'harness',
        HARNESS_STUDIO_NODE_EXECUTABLE: process.execPath,
        HARNESS_STUDIO_UPSTREAM_ROOT: resolve(projectRoot, 'vendor/deepseek-harness'),
      } : {}),
    },
  })
  const exitCode = await new Promise(resolve => electron.once('exit', resolve))
  stop()
  process.exit(Number(exitCode ?? 0))
} catch (error) {
  stop()
  throw error
}
