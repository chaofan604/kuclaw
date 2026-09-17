import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, readFileSync, symlinkSync } from 'node:fs'
import { chmod, copyFile, cp, lstat, mkdir, readFile, readdir, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const projectRoot = resolve(import.meta.dirname, '..')
const upstreamRoot = join(projectRoot, 'vendor', 'deepseek-harness')
const outputRoot = join(projectRoot, 'build-resources', 'runtime')
const nodeRoot = join(outputRoot, 'node')
const harnessRoot = join(outputRoot, 'harness')
const downloads = join(projectRoot, 'build-resources', 'downloads')
const lock = JSON.parse(readFileSync(join(projectRoot, 'upstream-lock.json'), 'utf8'))
const nodeVersion = lock.bundledNodeVersion
const archiveName = `node-v${nodeVersion}-darwin-arm64.tar.gz`
const archivePath = join(downloads, archiveName)
const expectedSha256 = '4fc3266a3702eebc39cc37661cf4eeceeade307e242ab64e4d7ce7949197e11f'

async function download(url, path) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`package runtime: ${url} returned HTTP ${response.status}`)
  await writeFile(path, new Uint8Array(await response.arrayBuffer()), { mode: 0o600 })
}

async function run(command, args, options = {}) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolvePromise() : reject(new Error(`${command} exited with ${code}`)))
  })
}

async function prepareNode() {
  const destination = join(nodeRoot, 'node')
  if (existsSync(destination)) {
    await run(destination, ['--version'])
    return
  }
  mkdirSync(downloads, { recursive: true })
  mkdirSync(nodeRoot, { recursive: true })
  if (!existsSync(archivePath)) {
    await download(`https://nodejs.org/dist/v${nodeVersion}/${archiveName}`, archivePath)
  }
  const body = await readFile(archivePath)
  const actual = createHash('sha256').update(body).digest('hex')
  if (actual !== expectedSha256) throw new Error(`package runtime: checksum mismatch for ${archiveName}`)
  await new Promise((resolvePromise, reject) => {
    const child = spawn('tar', ['-xOzf', archivePath, `node-v${nodeVersion}-darwin-arm64/bin/node`], {
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    const output = createWriteStream(destination, { flags: 'wx', mode: 0o755 })
    child.stdout.pipe(output)
    child.once('error', reject)
    output.once('error', reject)
    child.once('exit', code => code === 0 ? resolvePromise() : reject(new Error(`tar exited with ${code}`)))
  })
  await chmod(destination, 0o755)
  await run(destination, ['--version'])
}

async function copyPackageWithoutDependencies(source, target) {
  await cp(source, target, {
    recursive: true,
    dereference: true,
    preserveTimestamps: true,
    filter: path => path === source || basename(path) !== 'node_modules',
  })
}

let internalPackageSources

async function loadInternalPackageSources() {
  if (internalPackageSources !== undefined) return internalPackageSources
  const sources = new Map()
  const ignored = new Set([
    '.git', '.cache', '.dsh-build', 'coverage', 'dist', 'lib', 'node_modules',
    'release', 'snapshots', 'tests', 'test', 'website',
  ])
  const visit = async directory => {
    const manifestPath = join(directory, 'package.json')
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
      if (typeof manifest.name === 'string' && manifest.name.startsWith('@deepseek-ai/')) {
        sources.set(manifest.name, directory)
      }
    }
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || ignored.has(entry.name) || entry.name.startsWith('.')) continue
      await visit(join(directory, entry.name))
    }
  }
  await visit(upstreamRoot)
  internalPackageSources = sources
  return sources
}

async function materializeInternalClosure(root) {
  const sources = await loadInternalPackageSources()
  const pending = ['@deepseek-ai/dsh-desktop-host', '@deepseek-ai/dsh']
  const visited = new Set()
  let count = 0
  while (pending.length > 0) {
    const name = pending.pop()
    if (name === undefined || visited.has(name)) continue
    visited.add(name)
    const target = join(root, 'node_modules', ...name.split('/'))
    const linkedSource = join(upstreamRoot, 'node_modules', ...name.split('/'))
    const source = existsSync(linkedSource) ? linkedSource : sources.get(name)
    const manifestRoot = source ?? target
    const manifest = JSON.parse(await readFile(join(manifestRoot, 'package.json'), 'utf8'))
    for (const section of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const dependency of Object.keys(manifest[section] ?? {})) {
        if (dependency.startsWith('@deepseek-ai/')) pending.push(dependency)
      }
    }
    if (existsSync(target)) continue
    if (source === undefined || !existsSync(source)) throw new Error(`package runtime: cannot materialize ${name}`)
    await mkdir(dirname(target), { recursive: true })
    await copyPackageWithoutDependencies(source, target)
    count += 1
  }
  return count
}

async function materializeExternalLinks(root) {
  let count = 0
  const insideRoot = target => {
    const path = relative(root, target)
    return path === '' || (path !== '..' && !path.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`))
  }
  const visit = async directory => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink()) {
        const target = resolve(dirname(path), await readlink(path))
        if (insideRoot(target)) continue
        const targetInfo = await lstat(target)
        await rm(path, { recursive: true, force: true })
        await copyPackageWithoutDependencies(target, path)
        count += 1
        if (targetInfo.isDirectory()) await visit(path)
        continue
      }
      if (entry.isDirectory()) await visit(path)
    }
  }
  await visit(root)
  return count
}

async function linkHoistedDependencies(root) {
  const modules = join(root, 'node_modules')
  const hoisted = join(modules, '.pnpm', 'node_modules')
  let count = 0
  const link = async (source, target) => {
    if (existsSync(target)) return
    await mkdir(dirname(target), { recursive: true })
    await symlink(relative(dirname(target), source), target, 'dir')
    count += 1
  }
  for (const entry of await readdir(hoisted, { withFileTypes: true })) {
    const source = join(hoisted, entry.name)
    if (entry.name.startsWith('@') && entry.isDirectory()) {
      for (const scoped of await readdir(source, { withFileTypes: true })) {
        if (scoped.isDirectory() || scoped.isSymbolicLink()) {
          await link(join(source, scoped.name), join(modules, entry.name, scoped.name))
        }
      }
      continue
    }
    if (entry.isDirectory() || entry.isSymbolicLink()) await link(source, join(modules, entry.name))
  }
  return count
}

async function prepareHarness() {
  const entry = join(harnessRoot, 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'index.js')
  if (!existsSync(entry)) {
    if (existsSync(harnessRoot)) {
      throw new Error(`package runtime: ${harnessRoot} is incomplete; move it aside manually before retrying`)
    }
    mkdirSync(join(outputRoot), { recursive: true })
    await run('pnpm', [
      '--dir', upstreamRoot,
      '--filter', '@deepseek-ai/dsh-desktop-host',
      'deploy', '--prod', '--legacy', harnessRoot,
    ], { env: { ...process.env, CI: 'true' } })
    const scope = join(harnessRoot, 'node_modules', '@deepseek-ai')
    const selfLink = join(scope, 'dsh-desktop-host')
    if (!existsSync(selfLink)) symlinkSync('../..', selfLink)
  }
  if (!existsSync(entry)) throw new Error('package runtime: deployed Harness omits the Desktop Host entry')
  const scheduledTasksTarget = join(harnessRoot, 'node_modules', '@deepseek-ai', 'dsh-scheduled-tasks')
  const scheduledControllerTarget = join(harnessRoot, 'node_modules', '@deepseek-ai', 'dsh-api-scheduled-task-controller')
  const webFetchTarget = join(harnessRoot, 'node_modules', '@deepseek-ai', 'dsh-web-fetch-http')
  const llmPiAiTarget = join(harnessRoot, 'node_modules', '@deepseek-ai', 'dsh-llm-pi-ai')
  await Promise.all([
    mkdir(join(scheduledTasksTarget, 'lib'), { recursive: true }),
    mkdir(join(scheduledControllerTarget, 'lib'), { recursive: true }),
    mkdir(join(webFetchTarget, 'lib'), { recursive: true }),
    mkdir(join(llmPiAiTarget, 'lib'), { recursive: true }),
  ])
  await Promise.all([
    copyFile(join(upstreamRoot, 'apps', 'desktop-host', 'package.json'), join(harnessRoot, 'package.json')),
    copyFile(join(upstreamRoot, 'apps', 'desktop-host', 'lib', 'index.js'), entry),
    copyFile(
      join(upstreamRoot, 'apps', 'desktop-host', 'config', 'desktop.cordis.patch.yml'),
      join(harnessRoot, 'config', 'desktop.cordis.patch.yml'),
    ),
    copyFile(
      join(upstreamRoot, 'packages', 'schedule', 'scheduled-tasks', 'package.json'),
      join(scheduledTasksTarget, 'package.json'),
    ),
    cp(
      join(upstreamRoot, 'packages', 'schedule', 'scheduled-tasks', 'lib'),
      join(scheduledTasksTarget, 'lib'),
      { recursive: true, dereference: true },
    ),
    copyFile(
      join(upstreamRoot, 'packages', 'api', 'scheduled-task-controller', 'package.json'),
      join(scheduledControllerTarget, 'package.json'),
    ),
    cp(
      join(upstreamRoot, 'packages', 'api', 'scheduled-task-controller', 'lib'),
      join(scheduledControllerTarget, 'lib'),
      { recursive: true, dereference: true },
    ),
    copyFile(
      join(upstreamRoot, 'packages', 'web', 'web-fetch-http', 'package.json'),
      join(webFetchTarget, 'package.json'),
    ),
    cp(
      join(upstreamRoot, 'packages', 'web', 'web-fetch-http', 'lib'),
      join(webFetchTarget, 'lib'),
      { recursive: true, dereference: true },
    ),
    copyFile(
      join(upstreamRoot, 'packages', 'llm', 'llm-pi-ai', 'package.json'),
      join(llmPiAiTarget, 'package.json'),
    ),
    cp(
      join(upstreamRoot, 'packages', 'llm', 'llm-pi-ai', 'lib'),
      join(llmPiAiTarget, 'lib'),
      { recursive: true, dereference: true },
    ),
  ])
  const materialized = await materializeExternalLinks(harnessRoot)
  const added = await materializeInternalClosure(harnessRoot)
  const hoisted = await linkHoistedDependencies(harnessRoot)
  console.log(`package runtime: materialized ${materialized} external link(s), ${added} internal peer package(s), and ${hoisted} hoisted dependency link(s)`)
}

async function prepareMemoryServer() {
  const destination = join(harnessRoot, 'harness-studio')
  await mkdir(destination, { recursive: true })
  await Promise.all([
    copyFile(join(projectRoot, 'dist', 'main', 'runtime', 'memory-mcp-server.js'), join(destination, 'memory-mcp-server.js')),
    copyFile(join(projectRoot, 'dist', 'main', 'runtime', 'memory-store.js'), join(destination, 'memory-store.js')),
  ])
}

if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  throw new Error('package runtime: this release target requires macOS arm64')
}
await prepareNode()
await prepareHarness()
await prepareMemoryServer()
console.log(`package runtime: Node ${nodeVersion} and Harness ${lock.dshVersion} ready`)
