import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { Arch, build, Platform } from 'electron-builder'

const projectRoot = resolve(import.meta.dirname, '..')
const manifest = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8'))
const archName = process.argv[2]
const output = process.argv[3]

if (archName !== 'arm64' && archName !== 'x64') {
  throw new Error('usage: node scripts/build-release.mjs <arm64|x64> <output-directory>')
}
if (output === undefined || output.trim() === '') {
  throw new Error('release output directory is required')
}

const runtimeDirectory = archName === 'arm64' ? 'runtime' : 'runtime-x64-final'
const runtimeRoot = resolve(projectRoot, 'build-resources', runtimeDirectory)
for (const required of ['node/node', 'harness/lib/index.js', 'harness/config/desktop.cordis.patch.yml']) {
  if (!existsSync(resolve(runtimeRoot, required))) {
    throw new Error(`release runtime is incomplete: ${resolve(runtimeRoot, required)}`)
  }
}

const baseConfig = manifest.build
await build({
  targets: Platform.MAC.createTarget('zip', archName === 'arm64' ? Arch.arm64 : Arch.x64),
  config: {
    ...baseConfig,
    directories: {
      ...baseConfig.directories,
      output,
    },
    extraResources: [
      {
        from: resolve(runtimeRoot, 'node'),
        to: 'runtime/node',
      },
      {
        from: resolve(runtimeRoot, 'harness'),
        to: 'runtime/harness',
      },
    ],
    artifactName: `Kuclaw-v${manifest.version}-macOS-${archName}.\${ext}`,
  },
  publish: 'never',
})
