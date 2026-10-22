import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  downloadFile,
  resolveFiles,
  safePath,
  selectFiles,
  validateSnapshot,
  materialize,
} from '../apps/desktop/src/main/services/modelFiles.ts'

const payload = Buffer.from('verified-model-fixture-0123456789')
const file = {
  path: 'model.safetensors',
  size: payload.length,
  oid: createHash('sha256').update(payload).digest('hex'),
}
const sha = '1'.repeat(40)
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'clover-files-'))
  const server = createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    await run({ root, server, base })
  } finally {
    await new Promise((r) => server.close(r))
    await rm(root, { recursive: true, force: true })
  }
}
function send(response, body, status = 200, headers = {}) {
  response.writeHead(status, headers)
  response.end(body)
}
async function transfer(mode, initial, expectedRequests = 1) {
  await fixture(async ({ root, server, base }) => {
    const target = join(root, 'blob')
    if (initial) await writeFile(`${target}.part`, initial)
    let count = 0
    server.on('request', (req, res) => {
      count++
      const offset = Number(req.headers.range?.match(/\d+/)?.[0] ?? 0)
      if (mode === '416' && count === 1) return send(res, '', 416)
      if (mode === '206')
        return send(res, payload.subarray(offset), 206, {
          'content-range': `bytes ${offset}-${payload.length - 1}/${payload.length}`,
        })
      send(res, payload)
    })
    await downloadFile(base, target, file, new AbortController().signal, () => {})
    assert.deepEqual(await readFile(target), payload)
    assert.equal(count, expectedRequests)
  })
}
test('Range 206 resumes at the existing offset', () => transfer('206', payload.subarray(0, 8)))
test('Range ignored with 200 replaces the partial file', () =>
  transfer('200', payload.subarray(0, 8)))
test('416 retries a fresh request', () => transfer('416', payload.subarray(0, 8), 2))
test('oversized partial file starts over', () => transfer('200', Buffer.alloc(payload.length + 1)))
test('a complete partial file is verified without a request', () =>
  fixture(async ({ root, base }) => {
    await writeFile(join(root, 'blob.part'), payload)
    await downloadFile(base, join(root, 'blob'), file, new AbortController().signal, () => {})
    assert.deepEqual(await readFile(join(root, 'blob')), payload)
  }))
test('corrupt same-size blob is repaired; shared writers download only once', () =>
  fixture(async ({ root, server, base }) => {
    const target = join(root, 'blob')
    await writeFile(target, Buffer.alloc(payload.length))
    let count = 0
    server.on('request', (_, res) => {
      count++
      send(res, payload)
    })
    await Promise.all(
      [1, 2, 3].map(() => downloadFile(base, target, file, new AbortController().signal, () => {})),
    )
    assert.equal(count, 1)
    assert.deepEqual(await readFile(target), payload)
  }))
test('incorrect Content-Range is rejected', () =>
  fixture(async ({ root, server, base }) => {
    await writeFile(join(root, 'blob.part'), payload.subarray(0, 8))
    server.on('request', (_, res) =>
      send(res, payload.subarray(8), 206, {
        'content-range': `bytes 0-${payload.length - 1}/${payload.length}`,
      }),
    )
    await assert.rejects(
      downloadFile(base, join(root, 'blob'), file, new AbortController().signal, () => {}),
      /续传范围/,
    )
  }))
test('wrong SHA and truncated responses never become completed files', () =>
  fixture(async ({ root, server, base }) => {
    server.on('request', (req, res) =>
      send(res, req.url === '/short' ? payload.subarray(0, 5) : Buffer.alloc(payload.length)),
    )
    for (const route of ['/short', '/bad']) {
      const target = join(root, route.slice(1))
      await assert.rejects(
        downloadFile(base + route, target, file, new AbortController().signal, () => {}),
        /校验失败/,
      )
      await assert.rejects(readFile(target))
    }
  }))
test('abort keeps a partial file and a later request resumes', () =>
  fixture(async ({ root, server, base }) => {
    const controller = new AbortController()
    const target = join(root, 'blob')
    server.on('request', (req, res) => {
      const offset = Number(req.headers.range?.match(/\d+/)?.[0] ?? 0)
      if (offset)
        return send(res, payload.subarray(offset), 206, {
          'content-range': `bytes ${offset}-${payload.length - 1}/${payload.length}`,
        })
      res.writeHead(200)
      res.write(payload.subarray(0, 8))
      setTimeout(() => res.end(payload.subarray(8)), 50)
    })
    await assert.rejects(
      downloadFile(base, target, file, controller.signal, (n) => {
        if (n === 8) controller.abort()
      }),
    )
    assert.equal((await readFile(`${target}.part`)).length, 8)
    await downloadFile(base, target, file, new AbortController().signal, () => {})
    assert.deepEqual(await readFile(target), payload)
  }))
test('revision and paginated tree are resolved before selecting files', () =>
  fixture(async ({ server, base }) => {
    const paths = []
    server.on('request', (req, res) => {
      paths.push(req.url)
      if (req.url.includes('/revision/')) return send(res, JSON.stringify({ sha }))
      if (req.url === '/page2')
        return send(
          res,
          JSON.stringify([{ type: 'file', path: 'two.bin', size: 2, oid: '2'.repeat(40) }]),
        )
      send(
        res,
        JSON.stringify([{ type: 'file', path: 'one.bin', size: 1, oid: '1'.repeat(40) }]),
        200,
        { link: `<${base}/page2>; rel="next"` },
      )
    })
    const snapshot = await resolveFiles(base, 'team/model', 'release/v1')
    assert.equal(snapshot.sha, sha)
    assert.equal(snapshot.files.length, 2)
    assert(paths[0].endsWith('/revision/release%2Fv1'))
    assert.throws(() => selectFiles(snapshot.files, ['missing/*']))
  }))
test('unsafe paths are rejected', () => {
  for (const path of ['../escape', '/outside', 'C:\\bad', 'a\\b', 'a:stream'])
    assert.throws(() => safePath('/cache', path))
})
test('component completeness requires its own weights and every index shard', () =>
  fixture(async ({ root }) => {
    await mkdir(join(root, 'transformer'))
    await mkdir(join(root, 'vae'))
    await writeFile(join(root, 'transformer/config.json'), '{}')
    await writeFile(join(root, 'vae/model.safetensors'), 'vae')
    let files = [
      { path: 'transformer/config.json', size: 2, oid: null },
      { path: 'vae/model.safetensors', size: 3, oid: null },
    ]
    assert.equal(await validateSnapshot(root, files, 'dit', 'transformer'), false)
    await writeFile(join(root, 'transformer/model.safetensors'), 'dit')
    files.push({ path: 'transformer/model.safetensors', size: 3, oid: null })
    assert.equal(await validateSnapshot(root, files, 'dit', 'transformer'), true)
    const index = JSON.stringify({ weight_map: { a: 'missing.safetensors' } })
    await writeFile(join(root, 'transformer/model.safetensors.index.json'), index)
    files.push({
      path: 'transformer/model.safetensors.index.json',
      size: Buffer.byteLength(index),
      oid: null,
    })
    assert.equal(await validateSnapshot(root, files, 'dit', 'transformer'), false)
  }))
test('materialized weights remain readable without symbolic links', () =>
  fixture(async ({ root }) => {
    await writeFile(join(root, 'source'), payload)
    await materialize(join(root, 'source'), join(root, 'nested/target'))
    assert.deepEqual(await readFile(join(root, 'nested/target')), payload)
  }))

