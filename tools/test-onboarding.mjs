import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url))
const ts = require('typescript')
function load(name, mocks) {
  const source = readFileSync(new URL(`../apps/desktop/src/main/services/${name}.ts`, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
  const module = { exports: {} }
  new Function('require', 'module', 'exports', 'process', 'fetch', outputText)((id) => id in mocks ? mocks[id] : require(id), module, module.exports, mocks.process ?? process, mocks.fetch ?? fetch)
  return module.exports
}

const catalog = JSON.parse(readFileSync(new URL('../release/models.json', import.meta.url), 'utf8'))
const settings = { modelsRoot: null, disabledDevices: [], deviceLabels: {} }
function fixture(options = {}) {
  const models = catalog.models.map((entry) => ({ ...entry, sizeBytes: entry.size_bytes, installed: options.installed?.includes(entry.id) ?? false, installState: options.partial === entry.id ? 'partial' : 'missing' }))
  return load('onboarding', {
    process: { platform: options.platform ?? 'win32' },
    '../lib/paths': { paths: { hub: () => '/fixture/hub' } },
    './devices': { listDevices: () => options.noGpu ? [{ kind: 'mps', available: true }] : [{ kind: 'cuda', name: 'NVIDIA', available: true }] },
    './models': { getCatalog: async () => ({ ...catalog, models }) },
    './modelReadiness': { legacyModelReady: async () => options.legacy ?? false },
    './mossInfer': { resolveServerPath: () => options.engine ? '/fixture/moss-server' : null },
    './trainerEnv': { pickPython: async () => { if (options.noPython) throw new Error('missing Python'); return { path: '/fixture/python', version: '3.12.14' } } },
    './trainingHosts': { getTrainingHost: (_settings, id) => id === 'ssh-a' ? { id, name: 'Remote', kind: 'ssh' } : undefined },
    './remoteEngine': { remoteEngineStatus: async () => ({ online: !options.offline, available: options.engine, gpu: options.noGpu ? '' : 'NVIDIA' }) },
    './remoteModels': { scanRemoteModels: async () => ({ models: models.map((model) => ({ id: model.id, installed: options.remoteInstalled?.includes(model.id) ?? false })) }) },
  }).getOnboardingStatus
}
const sft = ['moss-sft-dit', 'qwen35-encoder', 'flux2-vae-small', 'moss-pipeline']

test('first run lists Python and inference requirements without retired instances', async () => {
  const status = await fixture()(settings)
  assert.deepEqual(status.steps.map((step) => step.id), ['python', 'device', 'engine', 'model'])
  assert.equal(status.ready, false)
  assert.equal(status.steps[0].status, 'ok')
  assert.equal(status.steps[2].action, 'engines')
  assert.deepEqual(status.steps[3].modelIds, sft)
  assert.match(status.steps[3].detail, /0\/4/)
})

test('missing local Python offers the built-in installer even for an otherwise ready remote host', async () => {
  const status = await fixture({ noPython: true, engine: true, remoteInstalled: sft })(settings, 'ssh-a')
  assert.equal(status.ready, false)
  assert.equal(status.steps[0].status, 'missing')
  assert.equal(status.steps[0].action, 'install-python')
  assert.ok(status.steps.slice(1).every(step => step.status === 'ok'))
})

test('partial downloads and missing support cannot complete a model bundle', async () => {
  const status = await fixture({ engine: true, installed: sft.slice(1, 3), partial: 'moss-sft-dit' })(settings)
  assert.equal(status.ready, false)
  assert.equal(status.steps.find((step) => step.id === 'model').status, 'partial')
  assert.match(status.steps[3].detail, /2\/4/)
  assert.equal(status.steps[3].sizeBytes, catalog.models.filter((model) => ['moss-sft-dit', 'moss-pipeline'].includes(model.id)).reduce((sum, model) => sum + model.size_bytes, 0))
})

test('an installed Base bundle satisfies the guide without forcing another SFT download', async () => {
  const status = await fixture({ engine: true, installed: ['moss-base-dit', ...sft.slice(1)] })(settings)
  assert.equal(status.bundleId, 'moss-base')
  assert.equal(status.ready, true)
})

test('a partially prepared Base bundle reuses its existing main model', async () => {
  const status = await fixture({ engine: true, installed: ['moss-base-dit', 'flux2-vae-small'] })(settings)
  assert.equal(status.bundleId, 'moss-base')
  assert.equal(status.steps.find((step) => step.id === 'model').status, 'partial')
  assert.match(status.steps[3].detail, /2\/4/)
  assert.equal(status.ready, false)
})

test('a complete legacy model is recognized while macOS still requires an NVIDIA host', async () => {
  const status = await fixture({ engine: true, legacy: true, platform: 'darwin', noGpu: true })(settings)
  assert.equal(status.ready, false)
  assert.match(status.steps[1].detail, /SSH/)
  assert.ok(status.steps.slice(3).every((step) => step.status === 'ok'))
})

test('remote readiness never combines local models with a remote engine', async () => {
  const status = await fixture({ engine: true, installed: sft })(settings, 'ssh-a')
  assert.equal(status.hostId, 'ssh-a')
  assert.equal(status.ready, false)
  assert.ok(status.steps.slice(3).every((step) => step.status === 'missing'))
})

test('the selected remote host can complete its own checklist', async () => {
  assert.equal((await fixture({ engine: true, remoteInstalled: sft })(settings, 'ssh-a')).ready, true)
  assert.equal((await fixture({ engine: true, installed: sft, offline: true })(settings, 'ssh-a')).ready, false)
  await assert.rejects(() => fixture()(settings, 'removed-host'), /重新选择/)
})

function remoteScanner(files) {
  return load('remoteModels', { './ssh': { posixQuote: (value) => `'${value}'`, remoteAbsolute: async () => '/models', sshExec: async () => ({ code: 0, stdout: files.join('\n') }) } }).scanRemoteModels
}
const snapshot = '/models/hf/hub/models--OpenMOSS-Team--MOSS-Image-SFT/snapshots/aaa'
const remoteFiles = [
  'transformer/config.json', 'transformer/model-00001-of-00002.safetensors', 'transformer/model-00002-of-00002.safetensors',
  'text_encoder/config.json', 'text_encoder/model.safetensors', 'tokenizer/tokenizer_config.json', 'tokenizer/tokenizer.json',
  'vae/config.json', 'vae/model.safetensors', 'model_index.json', 'pipeline_moss_image.py', 'scheduler/scheduler_config.json',
].map((path) => `${snapshot}/${path}`)

test('remote component globs recognize a complete snapshot including pipeline and tokenizer', async () => {
  const inventory = await remoteScanner(remoteFiles)({}, catalog)
  assert.ok(sft.every((id) => inventory.models.find((model) => model.id === id).installed))
})

test('remote inventory rejects missing shards, tokenizer and mixed revisions', async () => {
  for (const missing of ['transformer/model-00002-of-00002.safetensors', 'tokenizer/tokenizer.json']) {
    const files = remoteFiles.filter((path) => path !== `${snapshot}/${missing}`)
    files.push(`${snapshot.replace('/aaa', '/bbb')}/${missing}`)
    const inventory = await remoteScanner(files)({}, catalog)
    const id = missing.startsWith('transformer') ? 'moss-sft-dit' : 'qwen35-encoder'
    assert.equal(inventory.models.find((model) => model.id === id).installed, false)
  }
})

test('remote component downloads expand directory globs without downloading unrelated weights', async () => {
  const commands = []
  const { prepareRemoteModel } = load('remoteModels', {
    fetch: async () => ({ ok: true, json: async () => ({ sha: 'a'.repeat(40), siblings: remoteFiles.map((path) => ({ rfilename: path.slice(snapshot.length + 1) })) }) }),
    './ssh': { posixQuote: (value) => `'${value}'`, remoteAbsolute: async () => '/models', sshExec: async (_host, script) => { commands.push(script); return { code: 0 } } },
  })
  const result = await prepareRemoteModel({}, catalog.models.find((model) => model.id === 'moss-sft-dit'))
  assert.equal(result.files, 3)
  assert.match(commands[0], /transformer\/model-00002-of-00002.safetensors/)
  assert.doesNotMatch(commands[0], /text_encoder\/model.safetensors/)
})
