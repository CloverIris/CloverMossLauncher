import type { Catalog, ModelEntry, TrainingHost } from '@shared/types'
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
  const files = onlyFiles?.length ? all.filter((file) => onlyFiles.some((suffix) => file === suffix || file.endsWith(`/${suffix}`) || file.endsWith(suffix))) : all
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
  model: ModelEntry,
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
  if (expected.length) {
    for (const file of candidates) {
      if (!expected.some((suffix) => file.endsWith(suffix) || file.split('/').at(-1) === suffix.split('/').at(-1))) continue
      const snapshot = file.match(/^(.*?\/snapshots\/[^/]+)/)
      return snapshot?.[1] ?? file.slice(0, file.lastIndexOf('/'))
    }
    return undefined
  }
  const index = candidates.find((file) => file.endsWith('/model_index.json'))
  if (index) return index.replace(/\/model_index\.json$/, '')
  return candidates[0]
}

export async function scanRemoteModels(host: TrainingHost, catalog: Catalog, modelsRoot?: string): Promise<RemoteModelInventory> {
  const root = await remoteAbsolute(host, modelsRoot || host.modelsRoot || '~/.mossstudio/models')
  const command = `test -d ${posixQuote(root)} && find ${posixQuote(root)} -maxdepth 8 -type f \\( -name '*.safetensors' -o -name '*.json' \\) -printf '%p\\n' 2>/dev/null | head -n 20000 || true`
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
