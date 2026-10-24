import type { AdapterEntry, Catalog, ModelEntry, TrainingHost } from '@shared/types'
import { posixQuote, remoteAbsolute, sshExec } from './ssh'

const HF = 'https://huggingface.co'
const DEFAULT_REPO = 'OpenMOSS-Team/MOSS-Image-SFT'

interface HfRevision {
  sha?: string
  siblings?: Array<{ rfilename?: string }>
}

function safeRelative(path: string): boolean {
  return Boolean(path) && !path.startsWith('/') && !path.split('/').includes('..') && !path.includes('\0')
}

async function prepareRemoteRepo(
  host: TrainingHost,
  repo: string,
  revision: string,
  onlyFiles?: string[],
): Promise<{ path: string; revision: string; files: number }> {
  const url = `${HF}/api/models/${repo}/revision/${encodeURIComponent(revision)}`
  const response = await fetch(url, { headers: { 'user-agent': 'MossStudio' }, signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`HF API ${response.status}: ${repo}@${revision}`)
  const meta = (await response.json()) as HfRevision
  const sha = String(meta.sha ?? '')
  const all = (meta.siblings ?? []).map((item) => String(item.rfilename ?? '')).filter(safeRelative)
  const files = onlyFiles?.length ? all.filter((file) => onlyFiles.some((suffix) => suffix.endsWith('/*')
    ? file.startsWith(suffix.slice(0, -1)) : file === suffix || file.endsWith(`/${suffix}`) || file.endsWith(suffix))) : all
  if (!/^[a-f0-9]{40,64}$/.test(sha) || !files.length) throw new Error('HF 没有返回有效 revision/files')

  const modelsRoot = await remoteAbsolute(host, host.modelsRoot || '~/.mossstudio/models')
  const cache = `${modelsRoot.replace(/\/$/, '')}/hf/hub/models--${repo.replace('/', '--')}`
  const target = `${cache}/snapshots/${sha}`
  const refs = `${cache}/refs`
  const fileList = files.join('\n')
  const script = [
    'set -e',
    'command -v curl >/dev/null 2>&1 || { echo "remote host has no curl" >&2; exit 3; }',
    `mkdir -p ${posixQuote(target)} ${posixQuote(refs)}`,
    `printf '%s\\n' ${posixQuote(sha)} > ${posixQuote(`${refs}/${revision.replace(/[^A-Za-z0-9._-]/g, '_')}`)}`,
    `while IFS= read -r rel; do`,
    `  case "$rel" in ""|/*|*..*) echo "unsafe path: $rel" >&2; exit 4;; esac`,
    `  mkdir -p "$(dirname ${posixQuote(target)}/$rel)"`,
    `  if [ ! -s ${posixQuote(target)}/"$rel" ]; then`,
    `    curl -L --fail --retry 3 --silent --show-error -o ${posixQuote(target)}/"$rel" ${posixQuote(`${HF}/${repo}/resolve/${sha}`)}/"$rel"`,
    `  fi`,
    `done <<'MOSSFILES'`,
    fileList,
    'MOSSFILES',
  ].join('\n')
  const result = await sshExec(host, script, 2 * 60 * 60_000)
  if (result.code !== 0) throw new Error(`远端模型下载失败：${(result.stderr || result.stdout).trim().slice(-1200)}`)
  return { path: target, revision: sha, files: files.length }
}

export async function prepareRemoteDefaultModel(
  host: TrainingHost,
  repo = DEFAULT_REPO,
  revision = 'main',
): Promise<{ path: string; revision: string; files: number }> {
  return prepareRemoteRepo(host, repo, revision)
}

export async function prepareRemoteModel(
  host: TrainingHost,
  model: ModelEntry | AdapterEntry,
): Promise<{ path: string; revision: string; files: number }> {
  return prepareRemoteRepo(host, model.repo, model.revision || 'main', model.files)
}


export interface RemoteModelInventoryEntry {
  id: string
  installed: boolean
  path?: string
}

export interface RemoteModelInventory {
  root: string
  files: number
  models: RemoteModelInventoryEntry[]
  adapters: RemoteModelInventoryEntry[]
}

function modelMatches(entry: ModelEntry, files: string[]): string | undefined {
  const repoToken = `models--${entry.repo.replace('/', '--')}`
  const expected = entry.files?.filter(Boolean) ?? []
  const candidates = files.filter((file) => file.includes(repoToken))
  const snapshots = [...new Set(candidates.map((file) => file.match(/^(.*?\/snapshots\/[^/]+)/)?.[1]).filter((path): path is string => Boolean(path)))]
  for (const snapshot of snapshots) {
    const relative = candidates.filter((file) => file.startsWith(`${snapshot}/`)).map((file) => file.slice(snapshot.length + 1))
    // Match every component glob within one revision, rather than treating a
    // single file (or files from different snapshots) as an installed model.
    if (!expected.every((pattern) => pattern.endsWith('/*')
      ? relative.some((file) => file.startsWith(pattern.slice(0, -1)))
      : relative.includes(pattern))) continue
    if (entry.format !== 'comfyui' && ['dit', 'text_encoder', 'vae'].includes(entry.role)) {
      const prefix = entry.subfolder ? `${entry.subfolder}/` : ''
      const weights = relative.filter((file) => file.startsWith(prefix) && file.endsWith('.safetensors'))
      if (!relative.includes(`${prefix}config.json`) || !weights.length) continue
      const complete = weights.every((file) => {
        const shard = file.match(/^(.*-)(\d+)-of-(\d+)\.safetensors$/)
        if (!shard) return true
        const count = Number(shard[3])
        return count > 0 && count <= weights.length && Array.from({ length: count }, (_, index) =>
          `${shard[1]}${String(index + 1).padStart(shard[2]!.length, '0')}-of-${shard[3]}.safetensors`,
        ).every((name) => relative.includes(name))
      })
      if (!complete) continue
      if (entry.role === 'text_encoder' && (!relative.includes('tokenizer/tokenizer_config.json')
        || !(relative.includes('tokenizer/tokenizer.json') || relative.includes('tokenizer/vocab.json') && relative.includes('tokenizer/merges.txt')))) continue
    }
    if (entry.role === 'support' && !relative.includes('scheduler/scheduler_config.json')) continue
    if (entry.role === 'full' && !relative.includes('model_index.json')) continue
    return snapshot
  }
  return undefined
}

export async function scanRemoteModels(host: TrainingHost, catalog: Catalog, modelsRoot?: string): Promise<RemoteModelInventory> {
  const root = await remoteAbsolute(host, modelsRoot || host.modelsRoot || '~/.mossstudio/models')
  const command = `test -d ${posixQuote(root)} && find ${posixQuote(root)} -maxdepth 8 -type f -size +0c \\( -name '*.safetensors' -o -name '*.json' -o -name '*.py' -o -name '*.txt' \\) -printf '%p\\n' 2>/dev/null | head -n 20000 || true`
  const result = await sshExec(host, command, 120_000)
  const files = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const models = catalog.models.map((entry) => {
    const path = modelMatches(entry, files)
    return { id: entry.id, installed: Boolean(path), path }
  })
  const adapters = catalog.adapters.map((entry) => {
    const repoToken = `models--${entry.repo.replace('/', '--')}`
    const candidates = files.filter((file) => file.includes(repoToken) || file.includes(entry.repo))
    const file = candidates.find((candidate) => entry.files.some((suffix) => candidate.endsWith(suffix))) ?? candidates[0]
    const path = file?.match(/^(.*?\/snapshots\/[^/]+)/)?.[1] ?? file?.slice(0, file.lastIndexOf('/')) ?? undefined
    return { id: entry.id, installed: Boolean(path), path }
  })
  return { root, files: files.length, models, adapters }
}
