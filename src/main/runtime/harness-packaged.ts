import { existsSync } from 'node:fs'
import { lstat, mkdir, readlink, symlink, unlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { DevelopmentHarnessPaths } from './harness-development.js'

async function ensureRuntimeLink(path: string, target: string): Promise<void> {
  const absoluteTarget = resolve(target)
  try {
    const info = await lstat(path)
    if (!info.isSymbolicLink()) throw new Error(`${path} 必须是 Harness Runtime 符号链接`)
    const existing = resolve(join(path, '..'), await readlink(path))
    if (existing === absoluteTarget) return
    await unlink(path)
    await symlink(absoluteTarget, path, 'dir')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    await symlink(absoluteTarget, path, 'dir')
  }
}

/** Prepare the writable profile/home that points only into the signed packaged runtime. */
export async function preparePackagedHarness(
  runtimeDir: string,
  dataRoot: string,
  homeDir: string = join(dataRoot, 'home'),
): Promise<DevelopmentHarnessPaths> {
  const profileDir = join(dataRoot, 'profile')
  await Promise.all([
    mkdir(profileDir, { recursive: true }),
    mkdir(join(homeDir, 'sessions'), { recursive: true }),
  ])
  await writeFile(join(profileDir, 'package.json'), `${JSON.stringify({
    name: 'harness-studio-profile',
    private: true,
    type: 'module',
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
  }, null, 2)}\n`, 'utf8')
  const rootConfig = join(profileDir, 'desktop.cordis.yml')
  if (!existsSync(rootConfig)) await writeFile(rootConfig, '[]\n', 'utf8')
  await ensureRuntimeLink(join(profileDir, 'node_modules'), join(runtimeDir, 'node_modules'))
  return { runtimeDir, profileDir, homeDir }
}
