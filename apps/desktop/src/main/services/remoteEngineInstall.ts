import { posixQuote, sshExec } from './ssh'
import type { TrainingHost } from '@shared/types'

const API = 'https://api.github.com/repos/xycld/owoinfer'

interface Release {
  tag_name?: string
  assets?: Array<{ name?: string; browser_download_url?: string; size?: number }>
}

function pickAsset(release: Release): { name: string; url: string } {
  const assets = release.assets ?? []
  const candidate =
    assets.find((asset) => /linux.*cu13.*x86_64.*\.tar\.gz$/i.test(asset.name ?? '') && !/system-cuda/i.test(asset.name ?? '')) ??
    assets.find((asset) => /linux.*cu12.*x86_64.*\.tar\.gz$/i.test(asset.name ?? '') && !/system-cuda/i.test(asset.name ?? ''))
  if (!candidate?.browser_download_url || !candidate.name) throw new Error('上游 Release 没有 Linux bundled 引擎包')
  return { name: candidate.name, url: candidate.browser_download_url }
}

export async function installRemoteEngine(host: TrainingHost): Promise<{ version: string; path: string; asset: string }> {
  const root = (host.engineRoot || '~/.mossstudio/engine').replace(/\/$/, '')
  const remote = await sshExec(host, 'uname -s -m; command -v curl >/dev/null 2>&1; command -v tar >/dev/null 2>&1; echo READY', 20_000)
  if (!/Linux\s+x86_64/i.test(remote.stdout) || !remote.stdout.includes('READY')) {
    throw new Error('远端引擎安装只支持 Linux x86_64，且需要 curl/tar')
  }
  const response = await fetch(`${API}/releases/latest`, { headers: { 'user-agent': 'MossStudio' }, signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`GitHub Release ${response.status}`)
  const release = (await response.json()) as Release
  const version = String(release.tag_name ?? '').replace(/^v/, '')
  const asset = pickAsset(release)
  const staging = `${root}.staging`
  const archive = `${staging}.tar.gz`
  const script = [
    'set -e',
    `rm -rf ${posixQuote(staging)} ${posixQuote(archive)}`,
    `mkdir -p ${posixQuote(staging)}`,
    `curl -L --fail --retry 3 --silent --show-error -o ${posixQuote(archive)} ${posixQuote(asset.url)}`,
    `tar -xzf ${posixQuote(archive)} -C ${posixQuote(staging)}`,
    `top=$(find ${posixQuote(staging)} -mindepth 1 -maxdepth 1 -type d | head -n1)`,
    `test -n "$top"`,
    `test -x "$top/bin/moss-server"`,
    `rm -rf ${posixQuote(root)}`,
    `mv "$top" ${posixQuote(root)}`,
    `chmod +x ${posixQuote(`${root}/bin/moss-server`)}`,
    `rm -f ${posixQuote(archive)}`,
  ].join('\n')
  const result = await sshExec(host, script, 30 * 60_000)
  if (result.code !== 0) throw new Error(`远端引擎安装失败：${(result.stderr || result.stdout).trim().slice(-1500)}`)
  return { version, path: `${root}/bin/moss-server`, asset: asset.name }
}
