import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { MemoryStore } from './memory-store.js'

export function createMemoryMcpServer(databasePath: string): { server: McpServer; store: MemoryStore } {
  const store = new MemoryStore(databasePath)
  const server = new McpServer({ name: 'harness-studio-memory', version: '0.1.0' }, { capabilities: { tools: {} } })

  server.registerTool('search', {
  description: 'Search durable local memories by content or source.',
  inputSchema: { query: z.string(), limit: z.number().int().min(1).max(200).optional() },
}, ({ query, limit }) => ({ content: [{ type: 'text', text: JSON.stringify(store.search(query, limit)) }] }))

  server.registerTool('write', {
  description: 'Write a new durable local memory with its source.',
  inputSchema: { content: z.string().min(1), source: z.string().optional() },
}, ({ content, source }) => ({ content: [{ type: 'text', text: JSON.stringify(store.create(content, source ?? 'agent')) }] }))

  server.registerTool('update', {
  description: 'Update an existing durable local memory.',
  inputSchema: { id: z.string().min(1), content: z.string().min(1), source: z.string().optional() },
}, ({ id, content, source }) => ({ content: [{ type: 'text', text: JSON.stringify(store.update(id, content, source)) }] }))

  server.registerTool('delete', {
  description: 'Delete one durable local memory by id.',
  inputSchema: { id: z.string().min(1) },
}, ({ id }) => {
  store.remove(id)
  return { content: [{ type: 'text', text: JSON.stringify({ deleted: true, id }) }] }
  })

  return { server, store }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const databaseIndex = process.argv.indexOf('--db')
  const databasePath = databaseIndex < 0 ? undefined : process.argv[databaseIndex + 1]
  if (databasePath === undefined) throw new Error('memory MCP requires --db <path>')
  const { server, store } = createMemoryMcpServer(databasePath)
  const transport = new StdioServerTransport()
  process.once('SIGTERM', () => { store.close() })
  await server.connect(transport)
}
