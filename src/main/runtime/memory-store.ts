import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { MemoryEntry } from '../../shared/contracts.js'

interface MemoryRow {
  id: string
  content: string
  source: string
  created_at: number
  updated_at: number
}

function entry(row: MemoryRow): MemoryEntry {
  return {
    id: row.id,
    content: row.content,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export class MemoryStore {
  private readonly database: DatabaseSync

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true })
    this.database = new DatabaseSync(path)
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS memory_entries (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        source TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS memory_entries_updated_at ON memory_entries(updated_at DESC);
    `)
  }

  search(rawQuery: string, rawLimit = 50): MemoryEntry[] {
    const query = rawQuery.trim()
    const limit = Math.min(200, Math.max(1, Math.floor(rawLimit)))
    const rows = query === ''
      ? this.database.prepare(`
          SELECT id, content, source, created_at, updated_at
          FROM memory_entries ORDER BY updated_at DESC LIMIT ?
        `).all(limit)
      : this.database.prepare(`
          SELECT id, content, source, created_at, updated_at
          FROM memory_entries
          WHERE content LIKE ? ESCAPE '\\' OR source LIKE ? ESCAPE '\\'
          ORDER BY updated_at DESC LIMIT ?
        `).all(`%${query.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`, `%${query.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`, limit)
    return (rows as unknown as MemoryRow[]).map(entry)
  }

  create(content: string, source: string): MemoryEntry {
    const normalized = content.trim()
    if (normalized === '') throw new Error('记忆内容不能为空')
    const now = Date.now()
    const value: MemoryEntry = { id: randomUUID(), content: normalized, source: source.trim() || 'agent', createdAt: now, updatedAt: now }
    this.database.prepare(`
      INSERT INTO memory_entries (id, content, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
    `).run(value.id, value.content, value.source, value.createdAt, value.updatedAt)
    return value
  }

  update(id: string, content: string, source?: string): MemoryEntry {
    const normalized = content.trim()
    if (normalized === '') throw new Error('记忆内容不能为空')
    const existing = this.database.prepare(`
      SELECT id, content, source, created_at, updated_at FROM memory_entries WHERE id = ?
    `).get(id) as unknown as MemoryRow | undefined
    if (existing === undefined) throw new Error('记忆不存在')
    const updatedAt = Date.now()
    const nextSource = source?.trim() || existing.source
    this.database.prepare(`
      UPDATE memory_entries SET content = ?, source = ?, updated_at = ? WHERE id = ?
    `).run(normalized, nextSource, updatedAt, id)
    return entry({ ...existing, content: normalized, source: nextSource, updated_at: updatedAt })
  }

  remove(id: string): void {
    this.database.prepare('DELETE FROM memory_entries WHERE id = ?').run(id)
  }

  clear(): void {
    this.database.exec('DELETE FROM memory_entries')
  }

  close(): void {
    this.database.close()
  }
}
