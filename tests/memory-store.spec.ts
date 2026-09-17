import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MemoryStore } from '../src/main/runtime/memory-store.js'

describe('MemoryStore', () => {
  it('shares durable WAL-backed memories across independent clients', async () => {
    const root = await mkdtemp(join(tmpdir(), 'harness-memory-'))
    const path = join(root, 'memory.sqlite')
    const appStore = new MemoryStore(path)
    const mcpStore = new MemoryStore(path)
    const created = mcpStore.create('Remember the project uses pnpm.', 'session:test')
    expect(appStore.search('pnpm')).toEqual([created])
    const updated = appStore.update(created.id, 'Remember the project uses pnpm 11.', 'user')
    expect(mcpStore.search('pnpm 11')).toEqual([updated])
    mcpStore.remove(created.id)
    expect(appStore.search('')).toEqual([])
    appStore.close()
    mcpStore.close()
  })
})
