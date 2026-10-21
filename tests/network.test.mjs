import assert from 'node:assert/strict'
import test from 'node:test'
import { applyGitMirror, probeNetwork } from '../apps/desktop/src/main/services/network.ts'

const source = 'https://github.com/CloverIris/MossStudio.git'
const mirrored = `https://ghproxy.net/${source}`

test('ghproxy prefixes include the original GitHub URL exactly once', () => {
  for (const prefix of [
    'https://ghproxy.net/',
    'https://ghproxy.net',
    'https://ghproxy.net/https://github.com/',
    'https://ghproxy.net/https://github.com',
  ]) {
    assert.equal(applyGitMirror(source, prefix), mirrored, prefix)
  }
  assert.equal(
    applyGitMirror(source, 'https://gh-proxy.com/https://github.com/'),
    `https://gh-proxy.com/${source}`,
  )
})

test('direct and other mirror formats retain their existing behavior', () => {
  assert.equal(applyGitMirror(source, null), source)
  assert.equal(applyGitMirror(source, 'https://kkgithub.com/'), 'https://kkgithub.com/CloverIris/MossStudio.git')
  assert.equal(applyGitMirror(source, 'https://mirror.example/'), 'https://mirror.example/github.com/CloverIris/MossStudio.git')
})

test('network probing selects a working ghproxy prefix in auto and mirror modes', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 200 }))
  for (const mode of ['auto', 'mirror']) {
    const report = await probeNetwork(mode)
    assert.equal(report.selected.git, 'https://ghproxy.net/')
    assert.equal(applyGitMirror(source, report.selected.git), mirrored)
  }
  assert.equal((await probeNetwork('direct')).selected.git, null)
})
