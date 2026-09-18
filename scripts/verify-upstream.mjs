import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const projectRoot = resolve(import.meta.dirname, '..')
const upstreamRoot = resolve(projectRoot, 'vendor/deepseek-harness')
const lock = JSON.parse(await readFile(resolve(projectRoot, 'upstream-lock.json'), 'utf8'))
const revision = (await readFile(resolve(upstreamRoot, '.upstream-commit'), 'utf8')).trim()
const manifest = JSON.parse(await readFile(resolve(upstreamRoot, 'apps/cli/package.json'), 'utf8'))
const protocolSource = await readFile(resolve(upstreamRoot, 'apps/desktop/src/host-protocol.ts'), 'utf8')
const studioProtocolSource = await readFile(resolve(projectRoot, 'src/main/runtime/dsh-host-protocol.ts'), 'utf8')

if (revision !== lock.commit) {
  throw new Error(`Expected upstream ${lock.commit}, received ${revision}`)
}
if (manifest.version !== lock.dshVersion) {
  throw new Error(`Expected dsh ${lock.dshVersion}, received ${manifest.version}`)
}

const protocolVersion = Number(protocolSource.match(/DESKTOP_HOST_PROTOCOL_VERSION = (\d+)/)?.[1])
if (protocolVersion !== lock.desktopHostProtocolVersion) {
  throw new Error(`Expected desktop protocol ${lock.desktopHostProtocolVersion}, received ${String(protocolVersion)}`)
}
const studioProtocolVersion = Number(studioProtocolSource.match(/DESKTOP_HOST_PROTOCOL_VERSION = (\d+)/)?.[1])
const studioDshVersion = studioProtocolSource.match(/EXPECTED_DSH_VERSION = '([^']+)'/)?.[1]
if (studioProtocolVersion !== lock.desktopHostProtocolVersion || studioDshVersion !== lock.dshVersion) {
  throw new Error('Harness Studio Host version constants do not match upstream-lock.json')
}
if (!/^\d+\.\d+\.\d+$/u.test(lock.bundledNodeVersion)) {
  throw new Error(`Invalid bundled Node version ${String(lock.bundledNodeVersion)}`)
}

console.log(`Verified DeepSeek Harness ${lock.dshVersion} at ${lock.commit.slice(0, 12)}`)
