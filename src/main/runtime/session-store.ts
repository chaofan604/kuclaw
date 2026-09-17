import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { SessionRecord, SessionScope, SessionSummary } from '../../shared/contracts.js'

interface StoredState {
  version: 1
  sessions: SessionRecord[]
}

export class SessionStore {
  private loaded = false
  private sessions = new Map<string, SessionRecord>()
  private writeTail: Promise<void> = Promise.resolve()

  constructor(
    private readonly filePath: string,
    private readonly scope: SessionScope = 'project',
  ) {}

  async list(): Promise<SessionSummary[]> {
    await this.load()
    return [...this.sessions.values()]
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map(session => ({
        id: session.id,
        scope: session.scope,
        title: session.title,
        cwd: session.cwd,
        updatedAt: session.updatedAt,
        status: session.status,
        preview: session.messages.at(-1)?.text ?? '空会话',
      }))
  }

  async get(sessionId: string): Promise<SessionRecord | undefined> {
    await this.load()
    const session = this.sessions.get(sessionId)
    return session === undefined ? undefined : structuredClone(session)
  }

  async put(session: SessionRecord): Promise<void> {
    await this.load()
    this.sessions.set(session.id, structuredClone(session))
    await this.persist()
  }

  async delete(sessionId: string): Promise<boolean> {
    await this.load()
    if (!this.sessions.delete(sessionId)) return false
    await this.persist()
    return true
  }

  async flush(): Promise<void> {
    await this.writeTail
  }

  private async persist(): Promise<void> {
    const snapshot: StoredState = {
      version: 1,
      sessions: [...this.sessions.values()].map(item => structuredClone(item)),
    }
    const write = this.writeTail.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true })
      const temporary = `${this.filePath}.${process.pid}.tmp`
      await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
      await rename(temporary, this.filePath)
    })
    this.writeTail = write.catch(() => undefined)
    await write
  }

  private async load(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as StoredState
      if (parsed.version !== 1 || !Array.isArray(parsed.sessions)) throw new Error('unsupported session store')
      for (const session of parsed.sessions) {
        this.sessions.set(session.id, {
          ...session,
          scope: this.scope,
          status: session.status === 'running' ? 'idle' : session.status,
          messages: session.messages.map(message => message.state === 'streaming'
            ? { ...message, state: 'interrupted' }
            : message),
          jobs: session.jobs ?? [],
        })
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}
