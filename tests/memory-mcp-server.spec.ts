import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it } from 'vitest'
import { createMemoryMcpServer } from '../src/main/runtime/memory-mcp-server.js'

describe('built-in memory MCP server', () => {
  it('exposes search, write, update, and delete over MCP', async () => {
    const root = await mkdtemp(join(tmpdir(), 'harness-memory-mcp-'))
    const { server, store } = createMemoryMcpServer(join(root, 'memory.sqlite'))
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'test', version: '1' })
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
    const listed = await client.listTools()
    expect(listed.tools.map(tool => tool.name).sort()).toEqual(['delete', 'search', 'update', 'write'])
    const written = await client.callTool({ name: 'write', arguments: { content: 'persistent fact', source: 'test' } })
    expect(JSON.stringify(written.content)).toContain('persistent fact')
    const searched = await client.callTool({ name: 'search', arguments: { query: 'persistent' } })
    expect(JSON.stringify(searched.content)).toContain('persistent fact')
    await client.close()
    await server.close()
    store.close()
  })
})
