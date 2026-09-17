import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import {
  listWorkspaceDirectory,
  readWorkspaceChanges,
  readWorkspaceDiff,
  readWorkspaceFile,
} from '../src/main/runtime/workspace-inspector.js'

const execFileAsync = promisify(execFile)
const roots: string[] = []

async function git(root: string, ...args: string[]): Promise<void> {
  await execFileAsync('git', ['-C', root, ...args])
}

async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'harness-studio-workspace-'))
  roots.push(root)
  await git(root, 'init', '-q')
  await git(root, 'config', 'user.name', 'Harness Studio Test')
  await git(root, 'config', 'user.email', 'test@example.invalid')
  await writeFile(join(root, 'app.ts'), 'export const value = 1\n')
  await git(root, 'add', 'app.ts')
  await git(root, 'commit', '-qm', 'initial')
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('workspace inspector', () => {
  it('reads live Git changes and unified file diffs', async () => {
    const root = await repository()
    await writeFile(join(root, 'app.ts'), 'export const value = 2\n')
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'src', 'new.ts'), 'export const created = true\n')

    const changes = await readWorkspaceChanges(root)
    expect(changes.isRepository).toBe(true)
    expect(changes.branch).toBeTruthy()
    expect(changes.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'app.ts', kind: 'modified', additions: 1, deletions: 1 }),
      expect.objectContaining({ path: 'src/new.ts', kind: 'untracked', additions: 1, deletions: 0 }),
    ]))

    const tracked = await readWorkspaceDiff(root, 'app.ts')
    expect(tracked.patch).toContain('-export const value = 1')
    expect(tracked.patch).toContain('+export const value = 2')

    const untracked = await readWorkspaceDiff(root, 'src/new.ts')
    expect(untracked.patch).toContain('--- /dev/null')
    expect(untracked.patch).toContain('+export const created = true')
  })

  it('lists and reads project files without exposing internal or escaping paths', async () => {
    const root = await repository()
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'src', 'feature.ts'), 'export function feature() {}\n')

    await expect(listWorkspaceDirectory(root)).resolves.toEqual(expect.arrayContaining([
      { path: 'src', name: 'src', kind: 'directory' },
      { path: 'app.ts', name: 'app.ts', kind: 'file' },
    ]))
    expect((await listWorkspaceDirectory(root)).some(entry => entry.name === '.git')).toBe(false)
    await expect(readWorkspaceFile(root, 'src/feature.ts')).resolves.toMatchObject({
      path: 'src/feature.ts',
      content: 'export function feature() {}\n',
      binary: false,
      truncated: false,
    })
    await expect(readWorkspaceFile(root, '../outside.txt')).rejects.toThrow('escapes the project')
  })
})
