import { lstat, mkdir, mkdtemp, readlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { preparePackagedHarness } from '../src/main/runtime/harness-packaged.js'

async function runtimeRoot(parent: string, name: string): Promise<string> {
  const root = join(parent, name)
  await mkdir(join(root, 'node_modules'), { recursive: true })
  return root
}

describe('packaged Harness preparation', () => {
  it('relinks a persisted profile when the packaged application moves', async () => {
    const root = await mkdtemp(join(tmpdir(), 'harness-studio-packaged-'))
    const previous = await runtimeRoot(root, 'previous-runtime')
    const current = await runtimeRoot(root, 'current-runtime')
    const dataRoot = join(root, 'user-data')

    await preparePackagedHarness(previous, dataRoot)
    await preparePackagedHarness(current, dataRoot)

    const link = join(dataRoot, 'profile', 'node_modules')
    expect((await lstat(link)).isSymbolicLink()).toBe(true)
    expect(resolve(join(link, '..'), await readlink(link))).toBe(join(current, 'node_modules'))
  })

  it('refuses to replace a non-link profile dependency directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'harness-studio-packaged-invalid-'))
    const runtime = await runtimeRoot(root, 'runtime')
    const dataRoot = join(root, 'user-data')
    await mkdir(join(dataRoot, 'profile', 'node_modules'), { recursive: true })
    await writeFile(join(dataRoot, 'profile', 'node_modules', 'keep.txt'), 'keep\n')

    await expect(preparePackagedHarness(runtime, dataRoot)).rejects.toThrow('必须是 Harness Runtime 符号链接')
  })
})
