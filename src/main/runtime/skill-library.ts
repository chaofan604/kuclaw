import { constants } from 'node:fs'
import { cp, mkdir, readFile, readdir, rename, stat } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import type { SkillEntry } from '../../shared/contracts.js'

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
const MAX_FILES = 256
const MAX_BYTES = 20 * 1024 * 1024

function unquote(value: string): string {
  const trimmed = value.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function field(frontmatter: string, name: string): string | undefined {
  const match = new RegExp(`^${name}:\\s*(.+)$`, 'mu').exec(frontmatter)
  return match === null ? undefined : unquote(match[1] ?? '')
}

function booleanField(frontmatter: string, name: string, fallback: boolean): boolean {
  const value = field(frontmatter, name)?.toLowerCase()
  if (value === undefined) return fallback
  if (['true', 'yes', 'on', '1'].includes(value)) return true
  if (['false', 'no', 'off', '0'].includes(value)) return false
  throw new Error(`${name} 必须是布尔值`)
}

async function metadata(path: string, enabled: boolean): Promise<SkillEntry> {
  const raw = await readFile(path, 'utf8')
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(raw)
  if (match === null) throw new Error('SKILL.md 必须以 YAML frontmatter 开头')
  const frontmatter = match[1] ?? ''
  const name = field(frontmatter, 'name')
  const description = field(frontmatter, 'description')
  if (name === undefined || !SKILL_NAME.test(name)) {
    throw new Error('Skill name 必须是小写 kebab-case')
  }
  if (description === undefined || description === '') throw new Error('Skill description 不能为空')
  const whenToUse = field(frontmatter, 'whenToUse')
  return {
    name,
    description,
    ...(whenToUse === undefined ? {} : { whenToUse }),
    path,
    modelInvocable: !booleanField(frontmatter, 'disable-model-invocation', false),
    userInvocable: booleanField(frontmatter, 'user-invocable', true),
    enabled,
    managed: true,
    source: 'user',
  }
}

async function preflight(path: string): Promise<void> {
  let files = 0
  let bytes = 0
  const visit = async (current: string): Promise<void> => {
    const info = await stat(current)
    if (info.isFile()) {
      files += 1
      bytes += info.size
      if (files > MAX_FILES || bytes > MAX_BYTES) {
        throw new Error('Skill bundle 超过 256 个文件或 20 MB 限制')
      }
      return
    }
    if (!info.isDirectory()) throw new Error('Skill bundle 只能包含普通文件和目录')
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('为避免导入目录外内容，Skill bundle 不能包含符号链接')
      await visit(join(current, entry.name))
    }
  }
  await visit(path)
}

function inside(root: string, path: string): boolean {
  const relative = resolve(path).slice(resolve(root).length)
  return relative === '' || relative.startsWith('/')
}

/** App-owned user skill storage. Disable is a reversible directory move. */
export class LocalSkillLibrary {
  constructor(
    private readonly enabledRoot: string,
    private readonly disabledRoot: string,
  ) {}

  async list(): Promise<SkillEntry[]> {
    const rows = await Promise.all([
      this.listRoot(this.enabledRoot, true),
      this.listRoot(this.disabledRoot, false),
    ])
    return rows.flat().sort((left, right) => left.name.localeCompare(right.name))
  }

  isManagedPath(path: string | undefined): boolean {
    return path !== undefined && (inside(this.enabledRoot, path) || inside(this.disabledRoot, path))
  }

  async import(sourcePath: string): Promise<SkillEntry> {
    const sourceInfo = await stat(sourcePath)
    const sourceRoot = sourceInfo.isDirectory() ? sourcePath : basename(sourcePath) === 'SKILL.md'
      ? dirname(sourcePath)
      : undefined
    const instructionPath = sourceRoot === undefined ? sourcePath : join(sourceRoot, 'SKILL.md')
    const entry = await metadata(instructionPath, true)
    await preflight(sourceRoot ?? sourcePath)
    await Promise.all([
      mkdir(this.enabledRoot, { recursive: true }),
      mkdir(this.disabledRoot, { recursive: true }),
    ])
    const destination = join(this.enabledRoot, entry.name)
    try {
      await stat(destination)
      throw new Error(`Skill "${entry.name}" 已经存在`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await mkdir(destination, { recursive: false })
    if (sourceRoot === undefined) {
      await cp(sourcePath, join(destination, 'SKILL.md'), {
        force: false,
        mode: constants.COPYFILE_EXCL,
      })
    } else {
      await cp(sourceRoot, destination, { recursive: true, force: false, errorOnExist: true })
    }
    return metadata(join(destination, 'SKILL.md'), true)
  }

  async setEnabled(name: string, enabled: boolean): Promise<void> {
    if (!SKILL_NAME.test(name)) throw new Error('Skill name 不合法')
    await Promise.all([
      mkdir(this.enabledRoot, { recursive: true }),
      mkdir(this.disabledRoot, { recursive: true }),
    ])
    const source = join(enabled ? this.disabledRoot : this.enabledRoot, name)
    const destination = join(enabled ? this.enabledRoot : this.disabledRoot, name)
    try {
      await stat(destination)
      throw new Error(`目标 Skill "${name}" 已经存在`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await rename(source, destination)
  }

  private async listRoot(root: string, enabled: boolean): Promise<SkillEntry[]> {
    try {
      const entries = await readdir(root, { withFileTypes: true })
      const rows: SkillEntry[] = []
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        try {
          rows.push(await metadata(join(root, entry.name, 'SKILL.md'), enabled))
        } catch {
          // Invalid app-owned imports remain on disk but are not advertised.
        }
      }
      return rows
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }
}
