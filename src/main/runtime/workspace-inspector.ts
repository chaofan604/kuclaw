import { execFile } from 'node:child_process'
import { lstat, open, readdir, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import type {
  WorkspaceChange,
  WorkspaceChanges,
  WorkspaceFileContent,
  WorkspaceFileDiff,
  WorkspaceTreeEntry,
} from '../../shared/contracts.js'

const execFileAsync = promisify(execFile)
const MAX_FILE_BYTES = 1_048_576
const MAX_GIT_OUTPUT_BYTES = 8 * 1_048_576
const MAX_DIRECTORY_ENTRIES = 1_000
const HIDDEN_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'release'])

async function runGit(root: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
    windowsHide: true,
  })
  return stdout
}

function repositoryUnavailable(reason: unknown): boolean {
  return typeof reason === 'object' && reason !== null && 'code' in reason
    && ((reason as { code?: unknown }).code === 128 || (reason as { code?: unknown }).code === 'ENOENT')
}

async function projectRoot(root: string): Promise<string> {
  if (!isAbsolute(root)) throw new TypeError('Workspace root must be absolute')
  return realpath(root)
}

function staysInside(root: string, candidate: string): boolean {
  const path = relative(root, candidate)
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))
}

async function existingProjectPath(root: string, requestedPath: string): Promise<string> {
  if (requestedPath.includes('\0') || isAbsolute(requestedPath)) throw new TypeError('Workspace path must be relative')
  const canonicalRoot = await projectRoot(root)
  const lexical = resolve(canonicalRoot, requestedPath === '' ? '.' : requestedPath)
  if (!staysInside(canonicalRoot, lexical)) throw new TypeError('Workspace path escapes the project')
  const canonical = await realpath(lexical)
  if (!staysInside(canonicalRoot, canonical)) throw new TypeError('Workspace path resolves outside the project')
  return canonical
}

function changeKind(code: string): WorkspaceChange['kind'] {
  if (code === '??') return 'untracked'
  if (code.includes('U') || code === 'AA' || code === 'DD') return 'conflicted'
  if (code.includes('R') || code.includes('C')) return 'renamed'
  if (code.includes('D')) return 'deleted'
  if (code.includes('A')) return 'added'
  return 'modified'
}

function parseNumstat(raw: string): Map<string, { additions: number; deletions: number }> {
  const counts = new Map<string, { additions: number; deletions: number }>()
  for (const line of raw.split('\n')) {
    if (line === '') continue
    const [added, deleted, ...pathParts] = line.split('\t')
    const path = pathParts.join('\t')
    if (path === '') continue
    counts.set(path, {
      additions: added === '-' ? 0 : Number.parseInt(added ?? '0', 10) || 0,
      deletions: deleted === '-' ? 0 : Number.parseInt(deleted ?? '0', 10) || 0,
    })
  }
  return counts
}

async function untrackedLineCount(root: string, path: string): Promise<number> {
  try {
    const file = await readWorkspaceFile(root, path)
    if (file.binary) return 0
    if (file.content === '') return 0
    return file.content.split('\n').length - (file.content.endsWith('\n') ? 1 : 0)
  } catch {
    return 0
  }
}

/** Read the current Git worktree state beneath one Session project. */
export async function readWorkspaceChanges(root: string): Promise<WorkspaceChanges> {
  const canonicalRoot = await projectRoot(root)
  let statusOutput: string
  try {
    statusOutput = await runGit(canonicalRoot, [
      'status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.',
    ])
  } catch (reason) {
    if (repositoryUnavailable(reason)) return { isRepository: false, additions: 0, deletions: 0, files: [] }
    throw reason
  }

  let branch: string | undefined
  try {
    branch = (await runGit(canonicalRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD'])).trim() || undefined
  } catch {
    try {
      branch = (await runGit(canonicalRoot, ['rev-parse', '--short', 'HEAD'])).trim() || undefined
    } catch {
      branch = undefined
    }
  }

  let numstat = ''
  try {
    numstat = await runGit(canonicalRoot, ['diff', '--numstat', 'HEAD', '--', '.'])
  } catch {
    const [staged, unstaged] = await Promise.all([
      runGit(canonicalRoot, ['diff', '--numstat', '--cached', '--', '.']).catch(() => ''),
      runGit(canonicalRoot, ['diff', '--numstat', '--', '.']).catch(() => ''),
    ])
    numstat = `${staged}${unstaged}`
  }
  const counts = parseNumstat(numstat)
  const records = statusOutput.split('\0').filter(record => record !== '')
  const files: WorkspaceChange[] = []
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (record === undefined || record.length < 4) continue
    const code = record.slice(0, 2)
    const path = record.slice(3)
    const kind = changeKind(code)
    const measured = counts.get(path)
    const additions = measured?.additions ?? (kind === 'untracked' ? await untrackedLineCount(canonicalRoot, path) : 0)
    const deletions = measured?.deletions ?? 0
    files.push({
      path,
      kind,
      staged: code[0] !== ' ' && code[0] !== '?',
      additions,
      deletions,
    })
    if (code.includes('R') || code.includes('C')) index += 1
  }
  files.sort((left, right) => left.path.localeCompare(right.path))
  return {
    isRepository: true,
    ...(branch === undefined ? {} : { branch }),
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    files,
  }
}

/** List one project directory without following symbolic links. */
export async function listWorkspaceDirectory(root: string, path = ''): Promise<WorkspaceTreeEntry[]> {
  const canonicalRoot = await projectRoot(root)
  const directory = await existingProjectPath(canonicalRoot, path)
  if (!(await stat(directory)).isDirectory()) throw new TypeError('Workspace path is not a directory')
  const entries = await readdir(directory, { withFileTypes: true })
  return entries
    .filter(entry => !entry.isSymbolicLink() && entry.name !== '.DS_Store'
      && (!entry.isDirectory() || !HIDDEN_DIRECTORIES.has(entry.name)))
    .slice(0, MAX_DIRECTORY_ENTRIES)
    .map(entry => ({
      path: relative(canonicalRoot, resolve(directory, entry.name)).split(sep).join('/'),
      name: entry.name,
      kind: entry.isDirectory() ? 'directory' as const : 'file' as const,
    }))
    .sort((left, right) => left.kind === right.kind
      ? left.name.localeCompare(right.name)
      : left.kind === 'directory' ? -1 : 1)
}

/** Read a bounded text preview for one selected project file. */
export async function readWorkspaceFile(root: string, path: string): Promise<WorkspaceFileContent> {
  const canonicalRoot = await projectRoot(root)
  const file = await existingProjectPath(canonicalRoot, path)
  const fileStat = await lstat(file)
  if (!fileStat.isFile()) throw new TypeError('Workspace path is not a file')
  const bytes = fileStat.size
  const previewBytes = Math.min(bytes, MAX_FILE_BYTES)
  const buffer = Buffer.alloc(previewBytes)
  const handle = await open(file, 'r')
  try {
    await handle.read(buffer, 0, previewBytes, 0)
  } finally {
    await handle.close()
  }
  const binary = buffer.subarray(0, 8_192).includes(0)
  return {
    path,
    content: binary ? '' : buffer.toString('utf8'),
    bytes,
    truncated: bytes > buffer.byteLength,
    binary,
  }
}

function addedFilePatch(path: string, content: string): string {
  const lines = content.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return [
    `diff --git a/${path} b/${path}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${path}`,
    `@@ -0,0 +1,${String(lines.length)} @@`,
    ...lines.map(line => `+${line}`),
  ].join('\n')
}

/** Read the current unified patch for one changed project file. */
export async function readWorkspaceDiff(root: string, path: string): Promise<WorkspaceFileDiff> {
  const changes = await readWorkspaceChanges(root)
  const change = changes.files.find(candidate => candidate.path === path)
  if (change === undefined) throw new TypeError('Requested file has no current Git change')
  let patch: string
  if (change.kind === 'untracked') {
    const file = await readWorkspaceFile(root, path)
    patch = file.binary ? '' : addedFilePatch(path, file.content)
  } else {
    const canonicalRoot = await projectRoot(root)
    try {
      patch = await runGit(canonicalRoot, ['diff', '--no-ext-diff', '--unified=3', 'HEAD', '--', path])
    } catch {
      const [staged, unstaged] = await Promise.all([
        runGit(canonicalRoot, ['diff', '--no-ext-diff', '--unified=3', '--cached', '--', path]).catch(() => ''),
        runGit(canonicalRoot, ['diff', '--no-ext-diff', '--unified=3', '--', path]).catch(() => ''),
      ])
      patch = `${staged}${unstaged}`
    }
  }
  return {
    path,
    patch,
    kind: change.kind,
    additions: change.additions,
    deletions: change.deletions,
  }
}
