import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url))
const ts = require('typescript')
function load(name, mocks) {
  const source = readFileSync(new URL(`../apps/desktop/src/main/${name}.ts`, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
  const module = { exports: {} }
  new Function('require', 'module', 'exports', 'process', 'fetch', outputText)(id => id in mocks ? mocks[id] : require(id), module, module.exports, mocks.process ?? process, mocks.fetch ?? fetch)
  return module.exports
}

test('Python detection rejects old/failing interpreters and accepts working Store aliases', async () => {
  let output = 'Python 3.12.14', code = 0, calls = 0
  const { pythonVersion } = load('lib/python', {
    process: { platform: 'win32' },
    './run': { run: async () => { calls++; return { code, stdout: output, stderr: '' } } },
  })
  assert.equal(await pythonVersion('C:/Python/python.exe'), '3.12.14')
  for (const version of ['2.7.18', '3.9.23', '4.0.0']) {
    output = `Python ${version}`
    assert.equal(await pythonVersion('C:/Python/python.exe'), null)
  }
  output = 'Python 3.12.14'; code = 1
  assert.equal(await pythonVersion('C:/Python/python.exe'), null)
  code = 0
  assert.equal(await pythonVersion('C:/Users/test/AppData/Local/Microsoft/WindowsApps/python.exe'), '3.12.14')
  assert.equal(calls, 6)
})

function fixture(options, check) {
  const root = mkdtempSync(join(tmpdir(), 'managed-python-'))
  const version = '3.12.14', release = '20261021'
  const platform = options.platform ?? 'darwin', arch = options.arch ?? 'arm64'
  const triple = platform === 'win32' ? 'x86_64-pc-windows-msvc' : platform === 'linux' ? 'x86_64-unknown-linux-gnu' : 'aarch64-apple-darwin'
  const name = `cpython-${version}+${release}-${triple}-install_only.tar.gz`
  const url = `https://github.com/astral-sh/python-build-standalone/releases/download/${release}/${name}`
  const archive = Buffer.from('test Python archive')
  const checksum = createHash('sha256').update(archive).digest('hex')
  let settings = { pythonPath: null, theme: 'dark' }
  const state = { requests: [], events: [], tarCalls: 0, failHash: options.failHash ?? false, failProbe: options.failProbe ?? false }
  const managed = load('services/managedPython', {
    process: { platform, arch, report: { getReport: () => ({ header: { glibcVersionRuntime: '2.36' } }) } },
    '@shared/channels': { Events: { pythonInstall: 'python', settingsChanged: 'settings' } },
    '../lib/events': { emit: (name, value) => state.events.push({ name, value }) },
    '../lib/paths': { paths: { managedPython: () => join(root, 'python') } },
    '../lib/python': { pythonVersion: async path => existsSync(path) ? version : null },
    './settings': { getSettings: () => settings, updateSettings: patch => (settings = { ...settings, ...patch }) },
    './trainerEnv': { pickPython: async () => { if (options.existing) return { path: '/existing/python', version: '3.13.2' }; throw Error('No Python') } },
    '../lib/run': { run: async (command, args) => {
      if (command === 'tar') {
        state.tarCalls++
        const directory = join(args[3], 'python')
        mkdirSync(join(directory, 'bin'), { recursive: true })
        writeFileSync(platform === 'win32' ? join(directory, 'python.exe') : join(directory, 'bin/python3'), 'interpreter')
        return { code: 0, stdout: '', stderr: '' }
      }
      assert.equal(args[0], '-I')
      assert.match(args[2], /venv, ensurepip, ssl/)
      return { code: state.failProbe ? 1 : 0, stdout: `${version}\n`, stderr: state.failProbe ? 'broken Python' : '' }
    } },
    fetch: async request => {
      state.requests.push(request)
      if (request.endsWith('/releases/latest')) return new Response(JSON.stringify({ tag_name: release, assets: [{ name, browser_download_url: url, size: archive.length, digest: options.noDigest ? null : `sha256:${state.failHash ? '0'.repeat(64) : checksum}` }] }))
      if (request.endsWith('/SHA256SUMS')) return new Response(`${checksum}  ${name}\n`)
      assert.equal(request, url)
      return new Response(archive)
    },
  })
  return Promise.resolve().then(() => check({ ...managed, state, root, settings: () => settings }))
    .finally(() => rmSync(root, { recursive: true, force: true }))
}

test('existing Python is reused without downloading or changing settings', () => fixture({ existing: true }, async api => {
  const result = await api.installManagedPython()
  assert.equal(result.phase, 'done')
  assert.equal(result.path, '/existing/python')
  assert.deepEqual(api.state.requests, [])
  assert.equal(api.settings().pythonPath, null)
}))

for (const [platform, arch] of [['darwin', 'arm64'], ['win32', 'x64'], ['linux', 'x64']]) {
  test(`installs and verifies app-local Python on ${platform} without an existing interpreter`, () => fixture({ platform, arch }, async api => {
    const first = api.installManagedPython()
    assert.equal(api.installManagedPython(), first, 'Concurrent clicks must share one installation')
    const result = await first
    assert.equal(result.phase, 'done', result.error)
    assert.equal(result.version, '3.12.14')
    assert.ok(existsSync(result.path))
    assert.equal(api.settings().pythonPath, result.path)
    assert.equal(api.settings().theme, 'dark')
    assert.equal(api.state.tarCalls, 1)
    assert.deepEqual(api.state.events.filter(event => event.name === 'python').map(event => event.value.phase).filter((value, i, phases) => value !== phases[i - 1]), ['querying', 'downloading', 'verifying', 'extracting', 'done'])
  }))
}

test('checksum failure never extracts or configures the download and can be retried', () => fixture({ failHash: true }, async api => {
  const failed = await api.installManagedPython()
  assert.equal(failed.phase, 'error')
  assert.match(failed.error, /SHA256/)
  assert.equal(api.state.tarCalls, 0)
  assert.equal(api.settings().pythonPath, null)
  api.state.failHash = false
  assert.equal((await api.installManagedPython()).phase, 'done')
}))

test('a Python that cannot import venv/pip/ssl is never activated', () => fixture({ failProbe: true }, async api => {
  const result = await api.installManagedPython()
  assert.equal(result.phase, 'error')
  assert.match(result.error, /校验失败/)
  assert.equal(api.settings().pythonPath, null)
}))

test('SHA256SUMS is required when an asset has no digest', () => fixture({ noDigest: true }, async api => {
  assert.equal((await api.installManagedPython()).phase, 'done')
  assert.ok(api.state.requests.some(url => url.endsWith('/SHA256SUMS')))
}))
