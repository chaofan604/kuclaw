import { existsSync } from 'node:fs'
import { lstat, mkdir, readFile, readlink, symlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

interface PackageManifest {
  readonly name?: string
}

/** Paths for one source-adjacent Desktop Host composition. */
export interface DevelopmentHarnessPaths {
  readonly runtimeDir: string
  readonly profileDir: string
  readonly homeDir: string
}

async function packageDirectories(root: string): Promise<string[]> {
  const directories: string[] = []
  const groups = ['packages', 'apps', 'vendor']
  for (const group of groups) {
    const groupRoot = join(root, group)
    const entries = await (await import('node:fs/promises')).readdir(groupRoot, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const direct = join(groupRoot, entry.name)
      if (existsSync(join(direct, 'package.json'))) {
        directories.push(direct)
        continue
      }
      const children = await (await import('node:fs/promises')).readdir(direct, { withFileTypes: true })
      for (const child of children) {
        if (child.isDirectory() && existsSync(join(direct, child.name, 'package.json'))) {
          directories.push(join(direct, child.name))
        }
      }
    }
  }
  return directories
}

async function ensureLink(path: string, target: string): Promise<void> {
  const absoluteTarget = resolve(target)
  try {
    const stat = await lstat(path)
    if (!stat.isSymbolicLink()) throw new Error(`${path} exists and is not a symbolic link`)
    const existing = resolve(join(path, '..'), await readlink(path))
    if (existing !== absoluteTarget) {
      throw new Error(`${path} points to ${existing}, expected ${absoluteTarget}`)
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    await symlink(absoluteTarget, path)
  }
}

/**
 * Prepare the development-only runtime and profile links used by the fixed
 * upstream Desktop Host.
 */
export async function prepareDevelopmentHarness(
  upstreamRoot: string,
  dataRoot: string,
  homeDir: string = join(dataRoot, 'home'),
): Promise<DevelopmentHarnessPaths> {
  const runtimeDir = join(dataRoot, 'runtime')
  const profileDir = join(dataRoot, 'profile')
  const runtimeLinks = join(runtimeDir, 'node_modules', '@deepseek-ai')
  const profileLinks = join(profileDir, 'node_modules', '@deepseek-ai')
  await Promise.all([
    mkdir(runtimeLinks, { recursive: true }),
    mkdir(profileLinks, { recursive: true }),
    mkdir(join(homeDir, 'sessions'), { recursive: true }),
  ])

  await writeFile(join(profileDir, 'package.json'), `${JSON.stringify({
    name: 'harness-studio-profile',
    private: true,
    type: 'module',
    dsh: {
      profile: {
        bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'],
      },
    },
  }, null, 2)}\n`, 'utf8')
  const profileConfig = join(profileDir, 'desktop.cordis.yml')
  if (!existsSync(profileConfig)) await writeFile(profileConfig, '[]\n', 'utf8')

  const runtimePackages = [
    ['dsh', join(upstreamRoot, 'apps', 'cli')],
    ['dsh-desktop-host', join(upstreamRoot, 'apps', 'desktop-host')],
    ['dsh-web-frontend', join(upstreamRoot, 'apps', 'web')],
  ] as const
  for (const [name, target] of runtimePackages) {
    await ensureLink(join(runtimeLinks, name), target)
  }

  for (const directory of await packageDirectories(upstreamRoot)) {
    const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as PackageManifest
    if (manifest.name?.startsWith('@deepseek-ai/') !== true) continue
    await ensureLink(join(profileLinks, manifest.name.slice('@deepseek-ai/'.length)), directory)
  }
  return { runtimeDir, profileDir, homeDir }
}
