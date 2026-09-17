/**
 * Verify the packaged Electron bundle actually contains the current build.
 * Guards against electron-builder exiting 0 while leaving a stale app.asar.
 *
 * Checks, inside release/<target>/<productName>.app/Contents/Resources/app.asar:
 *   1. dist/main/main.js exists and no longer contains the top-level
 *      `await app.whenReady()` deadlock shape (it must be inside a function).
 *   2. dist/renderer/index.html exists and references a built asset.
 *   3. package.json name matches the project.
 */
import { readFileSync, existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, readlink, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'

const projectRoot = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))
const productName = pkg.build?.productName ?? pkg.name
const target = process.argv[2] ?? 'mac-arm64'
const releaseRoot = process.argv[3] === undefined ? join(projectRoot, 'release') : join(projectRoot, process.argv[3])
const asarPath = join(releaseRoot, target, `${productName}.app`, 'Contents', 'Resources', 'app.asar')
const resourcesPath = join(releaseRoot, target, `${productName}.app`, 'Contents', 'Resources')

if (!existsSync(asarPath)) {
  console.error(`verify-package: missing ${asarPath}`)
  process.exit(1)
}

const raw = readFileSync(asarPath)
const pickleSize = raw.readUInt32LE(4)
const jsonSize = raw.readUInt32LE(12)
const header = JSON.parse(raw.subarray(16, 16 + jsonSize).toString('utf8'))
const dataStart = 8 + pickleSize

function extract(path) {
  let node = header
  for (const part of path.split('/')) {
    node = node.files?.[part]
    if (node === undefined) return undefined
  }
  if (node.files !== undefined) return undefined
  return raw.subarray(dataStart + Number(node.offset), dataStart + Number(node.offset) + Number(node.size))
}

const mainJs = extract('dist/main/main.js')?.toString('utf8')
if (mainJs === undefined) {
  console.error('verify-package: app.asar has no dist/main/main.js')
  process.exit(1)
}
if (!/async function bootstrap/.test(mainJs)) {
  console.error('verify-package: packaged main.js is stale (no async bootstrap) — rebuild and repackage')
  process.exit(1)
}
if (/^await app\.whenReady\(\)/m.test(mainJs)) {
  console.error('verify-package: packaged main.js has a top-level await app.whenReady() — this deadlocks the ESM main entry')
  process.exit(1)
}

const rendererHtml = extract('dist/renderer/index.html')?.toString('utf8')
if (rendererHtml === undefined || !rendererHtml.includes('assets/')) {
  console.error('verify-package: packaged renderer index.html is missing or references no assets')
  process.exit(1)
}

const packagedPkg = JSON.parse(extract('package.json').toString('utf8'))
if (packagedPkg.name !== pkg.name) {
  console.error(`verify-package: packaged package.json name ${packagedPkg.name} != ${pkg.name}`)
  process.exit(1)
}

const upstreamLock = JSON.parse(readFileSync(join(projectRoot, 'upstream-lock.json'), 'utf8'))
const bundledNode = join(resourcesPath, 'runtime', 'node', 'node')
const hostEntry = join(resourcesPath, 'runtime', 'harness', 'lib', 'index.js')
const dshManifest = join(resourcesPath, 'runtime', 'harness', 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
const memoryServer = join(resourcesPath, 'runtime', 'harness', 'harness-studio', 'memory-mcp-server.js')
for (const required of [bundledNode, hostEntry, dshManifest, memoryServer]) {
  if (!existsSync(required)) {
    console.error(`verify-package: missing runtime file ${required}`)
    process.exit(1)
  }
}
const nodeVersion = spawnSync(bundledNode, ['--version'], { encoding: 'utf8' })
if (nodeVersion.status !== 0 || nodeVersion.stdout.trim() !== `v${upstreamLock.bundledNodeVersion}`) {
  console.error(`verify-package: bundled Node version mismatch: ${nodeVersion.stdout.trim() || nodeVersion.stderr.trim()}`)
  process.exit(1)
}
const dshVersion = JSON.parse(readFileSync(dshManifest, 'utf8')).version
if (dshVersion !== upstreamLock.dshVersion) {
  console.error(`verify-package: bundled Harness ${dshVersion} != ${upstreamLock.dshVersion}`)
  process.exit(1)
}

async function verifyApplicationStartup() {
  const executable = join(releaseRoot, target, `${productName}.app`, 'Contents', 'MacOS', productName)
  const userData = await mkdtemp(join(tmpdir(), 'harness-studio-package-'))
  const staleRuntime = join(userData, 'previous-app', 'runtime', 'harness', 'node_modules')
  const profileModules = join(userData, 'harness', 'profile', 'node_modules')
  await mkdir(staleRuntime, { recursive: true })
  await mkdir(join(profileModules, '..'), { recursive: true })
  await symlink(staleRuntime, profileModules, 'dir')

  const output = []
  const child = spawn(executable, [`--user-data-dir=${userData}`], {
    env: { ...process.env, HARNESS_STUDIO_PACKAGE_VERIFY: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', chunk => output.push(chunk))
  child.stderr.on('data', chunk => output.push(chunk))
  const exited = new Promise(resolveExit => child.once('exit', (code, signal) => resolveExit({ code, signal })))

  try {
    const earlyExit = await Promise.race([
      exited.then(result => ({ type: 'exit', result })),
      new Promise(resolveWait => setTimeout(() => resolveWait({ type: 'ready' }), 12_000)),
    ])
    if (earlyExit.type === 'exit') {
      const startupLog = join(userData, 'logs', 'startup.log')
      const detail = existsSync(startupLog)
        ? await readFile(startupLog, 'utf8')
        : Buffer.concat(output).toString('utf8')
      throw new Error(`packaged application exited during startup (${JSON.stringify(earlyExit.result)}):\n${detail}`)
    }

    const linked = resolve(join(profileModules, '..'), await readlink(profileModules))
    const expected = join(resourcesPath, 'runtime', 'harness', 'node_modules')
    if (linked !== expected) {
      throw new Error(`persisted runtime link was not upgraded: ${linked} != ${expected}`)
    }
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
    const stopped = await Promise.race([
      exited.then(() => true),
      new Promise(resolveWait => setTimeout(() => resolveWait(false), 8_000)),
    ])
    if (!stopped && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    await rm(userData, { recursive: true, force: true })
  }
}

await verifyApplicationStartup()
console.log(`verify-package: ${asarPath} and packaged startup OK`)
