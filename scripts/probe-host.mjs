/** Probe the booted dsh desktop host for its API surface. Development tool. */
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, readdir, readFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const vendorDir = new URL('..', import.meta.url).pathname + 'vendor/deepseek-harness'
const home = await mkdtemp(join(tmpdir(), 'hs-probe-home-'))
const project = await mkdtemp(join(tmpdir(), 'hs-probe-profile-'))
await writeFile(join(project, 'package.json'), JSON.stringify({
  name: 'p', private: true, type: 'module',
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
}))
const links = join(project, 'node_modules', '@deepseek-ai')
await mkdir(links, { recursive: true })
const rlinks = join(home, 'runtime', 'node_modules', '@deepseek-ai')
await mkdir(rlinks, { recursive: true })
for (const root of ['packages', 'apps', 'vendor']) {
  for (const e of await readdir(join(vendorDir, root))) {
    const d = join(vendorDir, root, e)
    let dirs = [d]
    try { dirs = (await readdir(d)).map(c => join(d, c)) } catch {}
    for (const p of [d, ...dirs]) {
      try {
        const m = JSON.parse(await readFile(join(p, 'package.json'), 'utf8'))
        if (!m.name?.startsWith('@deepseek-ai/')) continue
        await symlink(p, join(links, m.name.split('/')[1])).catch(() => {})
      } catch {}
    }
  }
}
for (const [n, t] of [['dsh', join(vendorDir, 'apps', 'cli')], ['dsh-desktop-host', join(vendorDir, 'apps', 'desktop-host')], ['dsh-web-frontend', join(vendorDir, 'apps', 'web')]])
  await symlink(t, join(rlinks, n)).catch(() => {})

const child = spawn(process.execPath, [
  join(vendorDir, 'apps', 'desktop-host', 'lib', 'index.js'),
  join(home, 'runtime'), project, '--allow-linked-profile',
], { stdio: ['ignore', 'inherit', 'inherit', 'pipe', 'pipe', 'ipc'], env: { ...process.env, DSH_HOME: home } })

let buf = Buffer.alloc(0)
const streams = new Map()
let sid = 0
child.stdio[4]?.on('data', c => {
  buf = Buffer.concat([buf, c])
  for (;;) {
    if (buf.length < 13) return
    const len = buf.readUInt32BE(9)
    if (buf.length < 13 + len) return
    const type = buf.readUInt8(4), id = buf.readUInt32BE(5), pl = buf.subarray(13, 13 + len)
    buf = buf.subarray(13 + len)
    if (type === 1) {
      const meta = JSON.parse(pl.toString())
      streams.set(id, { ...streams.get(id), status: meta, chunks: [] })
    } else if (type === 2) {
      const s = streams.get(id); s?.chunks.push(pl)
    } else if (type === 3 || type === 4) {
      const s = streams.get(id)
      if (s) { s.done = type === 3; s.resolve?.() }
    }
  }
})
await new Promise((res, rej) => {
  child.on('message', m => { if (m.type === 'ready') res(m); else if (m.type === 'fatal') rej(new Error(m.message)) })
  setTimeout(() => rej(new Error('ready timeout')), 60000)
})
console.log('READY')

function encodeReq(id, method, url, body) {
  const enc = (t, p) => {
    const f = Buffer.alloc(13 + p.length)
    f.writeUInt32BE(0x44534833, 0); f.writeUInt8(t, 4); f.writeUInt32BE(id, 5); f.writeUInt32BE(p.length, 9)
    p.copy(f, 13)
    return f
  }
  const frames = [enc(1, Buffer.from(JSON.stringify({ url, method, headers: [['content-type', 'application/json']], hasBody: !!body })))]
  if (body) frames.push(enc(2, Buffer.from(body)), enc(3, Buffer.alloc(0)))
  return Buffer.concat(frames)
}

async function probe(method, path, body) {
  const id = ++sid
  child.stdio[3].write(encodeReq(id, method, 'http://dsh.local' + path, body))
  const settled = new Promise(res => {
    const t = setInterval(() => {
      const s = streams.get(id)
      if (s?.done || s === undefined && !streams.has(id)) { clearInterval(t); res() }
    }, 20)
    setTimeout(() => { clearInterval(t); res() }, 6000)
  })
  await settled
  const s = streams.get(id)
  console.log(method, path, '->', s?.status?.status ?? 'no-response', Buffer.concat(s?.chunks ?? []).toString().slice(0, 240).replaceAll('\n', ' '))
}

for (const ep of ['session-controller.list', 'session-controller.history', 'session-controller.control', 'session-query.search'])
  await probe('POST', '/api', JSON.stringify({ endpoint: ep, payload: {} }))
child.send({ type: 'shutdown' })
setTimeout(() => { child.kill('SIGKILL') }, 3000)
