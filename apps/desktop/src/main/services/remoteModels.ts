import type { TrainingHost } from '@shared/types'
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

export async function prepareRemoteDefaultModel(
  host: TrainingHost,
  repo = DEFAULT_REPO,
  revision = 'main',
): Promise<{ path: string; revision: string; files: number }> {
  const url = `${HF}/api/models/${repo}/revision/${encodeURIComponent(revision)}`
  const response = await fetch(url, { headers: { 'user-agent': 'MossStudio' }, signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`HF API ${response.status}: ${repo}@${revision}`)
  const meta = (await response.json()) as HfRevision
  const sha = String(meta.sha ?? '')
  const files = (meta.siblings ?? []).map((item) => String(item.rfilename ?? '')).filter(safeRelative)
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
