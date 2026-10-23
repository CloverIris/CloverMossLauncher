import type { TrainingHost } from '@shared/types'
import { posixQuote, remoteAbsolute, sshExec } from './ssh'
import { getSettings } from './settings'
import { resolveGithubToken } from './mossInferDownload'

const REPO = 'xycld/owoinfer'
const API = `https://api.github.com/repos/${REPO}`

interface Release {
  tag_name?: string
  assets?: Array<{ name?: string; browser_download_url?: string; size?: number }>
}

interface Artifact {
  id?: number
  name?: string
  expired?: boolean
  size_in_bytes?: number
  archive_download_url?: string
}

function pickAsset(release: Release): { name: string; url: string } {
  const assets = release.assets ?? []
  const candidate =
    assets.find((asset) => /linux.*cu13.*x86_64.*\.tar\.gz$/i.test(asset.name ?? '') && !/system-cuda/i.test(asset.name ?? '')) ??
    assets.find((asset) => /linux.*cu12.*x86_64.*\.tar\.gz$/i.test(asset.name ?? '') && !/system-cuda/i.test(asset.name ?? ''))
  if (!candidate?.browser_download_url || !candidate.name) throw new Error('上游 Release 没有 Linux bundled 引擎包')
  return { name: candidate.name, url: candidate.browser_download_url }
}

async function releaseSource(): Promise<{ version: string; url: string; name: string } | null> {
  const response = await fetch(`${API}/releases/latest`, { headers: { 'user-agent': 'MossStudio' }, signal: AbortSignal.timeout(30_000) })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`GitHub Release ${response.status}`)
  const release = (await response.json()) as Release
  const asset = pickAsset(release)
  return { version: String(release.tag_name ?? 'artifact').replace(/^v/, ''), url: asset.url, name: asset.name }
}

async function artifactSource(): Promise<{ version: string; url: string; name: string }> {
  const settings = getSettings()
  const token = resolveGithubToken(settings)
  if (!token) {
    throw new Error('上游目前没有 Release，只有 GitHub Actions artifacts。请在 Engine 页填写 GitHub Token（或设置 GH_TOKEN）。')
  }
  const runs = await fetch(`${API}/actions/workflows/ci.yml/runs?branch=main&status=success&per_page=1`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'MossStudio' },
    signal: AbortSignal.timeout(30_000),
  })
  if (!runs.ok) throw new Error(`查询 CI runs 失败：HTTP ${runs.status}`)
  const runData = (await runs.json()) as { workflow_runs?: Array<{ id?: number; head_sha?: string }> }
  const run = runData.workflow_runs?.[0]
  if (!run?.id) throw new Error('没有成功的 ci 运行')
  const artifactsResponse = await fetch(`${API}/actions/runs/${run.id}/artifacts`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'MossStudio' },
    signal: AbortSignal.timeout(30_000),
  })
  if (!artifactsResponse.ok) throw new Error(`查询 artifacts 失败：HTTP ${artifactsResponse.status}`)
  const data = (await artifactsResponse.json()) as { artifacts?: Artifact[] }
  const artifact =
    data.artifacts?.find((item) => item.name === 'mossinfer-linux-cuda13' && !item.expired) ??
    data.artifacts?.find((item) => item.name === 'mossinfer-linux-cuda12' && !item.expired)
  if (!artifact?.archive_download_url) throw new Error('最新 ci 运行没有 Linux 引擎 artifact')
  // Resolve the authenticated API URL to its short-lived signed blob URL locally;
  // only the signed URL is handed to the remote curl command.
  const signed = await fetch(artifact.archive_download_url, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'MossStudio' },
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  })
  const location = signed.headers.get('location')
  if (!location) throw new Error(`无法获取 artifact 下载地址（HTTP ${signed.status}）`)
  return { version: `ci-${String(run.head_sha ?? '').slice(0, 8)}`, url: location, name: artifact.name ?? 'artifact' }
}

export async function installRemoteEngine(host: TrainingHost, progress?: (phase: 'checking' | 'querying' | 'downloading' | 'extracting' | 'installing' | 'done' | 'error', message: string, percent?: number) => void): Promise<{ version: string; path: string; asset: string }> {
  const root = (await remoteAbsolute(host, host.engineRoot || '~/.mossstudio/engine')).replace(/\/$/, '')
  progress?.('checking', '检查远端 Linux/curl/tar/unzip…', 5)
  const remote = await sshExec(host, 'uname -s -m; command -v curl >/dev/null 2>&1; command -v tar >/dev/null 2>&1; command -v unzip >/dev/null 2>&1; echo READY', 20_000)
  if (!/Linux\s+x86_64/i.test(remote.stdout) || !remote.stdout.includes('READY')) {
    throw new Error('远端引擎安装只支持 Linux x86_64，且需要 curl/tar/unzip')
  }
  progress?.('querying', '查询上游 Release / CI artifact…', 15)
  const source = (await releaseSource()) ?? (await artifactSource())
  progress?.('downloading', `下载 ${source.name}…`, 25)
  const staging = `${root}.staging`
  const archive = `${staging}.download`
  const script = [
    'set -e',
    `rm -rf ${posixQuote(staging)} ${posixQuote(archive)}`,
    `mkdir -p ${posixQuote(staging)}`,
    `curl -L --fail --retry 3 --silent --show-error --progress-bar -o ${posixQuote(archive)} ${posixQuote(source.url)}`,
    `mkdir -p ${posixQuote(`${staging}/outer`)}`,
    `unzip -q ${posixQuote(archive)} -d ${posixQuote(`${staging}/outer`)}`,
    `archive=$(find ${posixQuote(`${staging}/outer`)} -type f -name 'mossinfer-*linux-*x86_64*.tar.gz' ! -name '*-system-cuda*' | head -n1)`,
    `test -n "$archive"`,
    `mkdir -p ${posixQuote(`${staging}/engine`)}`,
    `tar -xzf "$archive" -C ${posixQuote(`${staging}/engine`)}`,
    `top=$(find ${posixQuote(`${staging}/engine`)} -mindepth 1 -maxdepth 1 -type d | head -n1)`,
    `test -n "$top"`,
    `test -x "$top/bin/moss-server"`,
    `rm -rf ${posixQuote(root)}`,
    `mv "$top" ${posixQuote(root)}`,
    `chmod +x ${posixQuote(`${root}/bin/moss-server`)}`,
    `rm -rf ${posixQuote(staging)}`,
  ].join('\n')
  progress?.('extracting', '远端解压/安装引擎…', 70)
  const result = await sshExec(host, script, 30 * 60_000)
  if (result.code !== 0) {
    progress?.('error', '远端安装失败', 100)
    throw new Error(`远端引擎安装失败：${(result.stderr || result.stdout).trim().slice(-1800)}`)
  }
  progress?.('done', `引擎 ${source.version} 已安装`, 100)
  return { version: source.version, path: `${root}/bin/moss-server`, asset: source.name }
}
