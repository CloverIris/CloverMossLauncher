import { app } from 'electron'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, chmodSync } from 'node:fs'
import { rename } from 'node:fs/promises'
import { once } from 'node:events'
import { join } from 'node:path'
import type { MossInferDownloadState, Settings } from '@shared/types'
import { Events } from '@shared/channels'
import { emit } from '../lib/events'
import { paths } from '../lib/paths'
import { run } from '../lib/run'
import { probeMossInfer, shutdownMossInfer } from './mossInfer'
import { getSettings, updateSettings } from './settings'

/**
 * Downloads the MossInfer engine package from the upstream repo xycld/owoinfer:
 * - stable: the latest GitHub Release assets (anonymous, sha256-verified via SHA256SUMS);
 * - dev: the latest successful `ci` run's Actions artifact (requires a token: GitHub
 *   answers 401 on artifact zips even for public repos).
 * The extracted tree keeps its upstream layout (bin/moss-server + lib/), and the
 * installed server path is written to settings.mossInferServerPath.
 */

const REPO = 'xycld/owoinfer'
const API = `https://api.github.com/repos/${REPO}`

let current: MossInferDownloadState | null = null
let controller: AbortController | null = null

function publish(patch: Partial<MossInferDownloadState> & { phase: MossInferDownloadState['phase'] }): void {
  if (!current) return
  current = { ...current, ...patch, updatedAt: new Date().toISOString() }
  emit(Events.mossInferDownload, current)
}

export function getMossInferDownloadState(): MossInferDownloadState | null {
  return current
}

export function cancelMossInferDownload(): MossInferDownloadState | null {
  controller?.abort()
  return current
}

function resolveGithubToken(settings: Settings): string | null {
  if (settings.githubToken) return settings.githubToken
  for (const key of ['GH_TOKEN', 'GITHUB_TOKEN']) {
    const value = process.env[key]?.trim()
    if (value) return value
  }
  try {
    const probe = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8', timeout: 3000 })
    const token = (probe.stdout ?? '').trim()
    if (probe.status === 0 && token) return token
  } catch {
    // gh CLI not installed
  }
  return null
}

async function ghJson(path: string, token: string | null): Promise<unknown> {
  const response = await fetch(`${API}${path}`, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': `MossStudio-Launcher/${app.getVersion()}`,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`GitHub API ${path} 返回 HTTP ${response.status}`)
  return response.json()
}

interface GhAsset {
  name: string
  browser_download_url: string
  size: number
}

interface GhArtifact {
  id: number
  name: string
  expired: boolean
  size_in_bytes: number
}

// Archive names: mossinfer-<version>-<os>-cu<N>-x86_64[-system-cuda].<ext>
function osToken(): 'linux' | 'windows' {
  return process.platform === 'win32' ? 'windows' : 'linux'
}

function archiveExt(): 'tar.gz' | 'zip' {
  return process.platform === 'win32' ? 'zip' : 'tar.gz'
}

type Variant = 'system-cuda' | 'bundled'

function archiveBase(version: string, flavour: 'cu12' | 'cu13', variant: Variant): string {
  return `mossinfer-${version}-${osToken()}-${flavour}-x86_64${variant === 'system-cuda' ? '-system-cuda' : ''}`
}

async function downloadTo(
  url: string,
  target: string,
  token: string | null,
  totalHint: number,
): Promise<string> {
  const part = `${target}.part`
  if (existsSync(part)) rmSync(part, { force: true })
  const response = await fetch(url, {
    headers: {
      'user-agent': `MossStudio-Launcher/${app.getVersion()}`,
      // undici strips this header on the cross-origin redirect to the artifact blob store.
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    signal: controller?.signal,
    redirect: 'follow',
  })
  if (!response.ok) throw new Error(`下载失败：HTTP ${response.status}（${url.slice(0, 120)}）`)
  if (!response.body) throw new Error('下载响应没有 body')
  const length = Number(response.headers.get('content-length') ?? 0)
  const total = Number.isFinite(length) && length > 0 ? length : totalHint
  const hash = createHash('sha256')
  const stream = createWriteStream(part)
  let received = 0
  let lastEmit = 0
  let lastBytes = 0
  let lastTime = Date.now()
  const reader = response.body.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (controller?.signal.aborted) throw new Error('已取消下载')
      const chunk = Buffer.from(value)
      hash.update(chunk)
      received += chunk.length
      if (!stream.write(chunk)) await once(stream, 'drain')
      const timestamp = Date.now()
      if (timestamp - lastEmit >= 250) {
        const elapsed = Math.max(0.001, (timestamp - lastTime) / 1000)
        publish({
          phase: 'downloading',
          bytes: received,
          totalBytes: total,
          percent: total > 0 ? Math.min(99.9, (received / total) * 100) : 0,
          speedBps: Math.max(0, (received - lastBytes) / elapsed),
        })
        lastEmit = timestamp
        lastBytes = received
        lastTime = timestamp
      }
    }
  } finally {
    stream.end()
    await once(stream, 'finish').catch(() => undefined)
  }
  await rename(part, target)
  return hash.digest('hex')
}

function sha256Of(sumsText: string, name: string): string | null {
  for (const line of sumsText.split(/\r?\n/)) {
    const match = line.trim().match(/^([a-f0-9]{64})\s+(\S+)$/)
    if (!match) continue
    const file = match[2]!.replace(/^\*/, '')
    if (file === name || file.endsWith(`/${name}`)) return match[1]!
  }
  return null
}

async function pythonBin(): Promise<string> {
  for (const candidate of ['python3', 'python']) {
    const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8', timeout: 5000 })
    if (probe.status === 0) return candidate
  }
  throw new Error('解压需要系统 Python（python3/python）')
}

async function extractZip(zip: string, dest: string): Promise<void> {
  const py = await pythonBin()
  mkdirSync(dest, { recursive: true })
  const result = await run(py, ['-m', 'zipfile', '-e', zip, dest], { timeoutMs: 120_000 })
  if (result.code !== 0) throw new Error(`zip 解压失败：${result.stderr.slice(0, 300)}`)
}

async function extractArchive(archive: string, dest: string): Promise<void> {
  mkdirSync(dest, { recursive: true })
  // Prefer the system tar (bsdtar on Windows also reads zip; GNU tar needs python for zip).
  const isZip = archive.endsWith('.zip')
  if (!isZip || process.platform === 'win32') {
    const result = await run('tar', ['-xf', archive, '-C', dest], { timeoutMs: 300_000 })
    if (result.code === 0) return
  }
  if (isZip) return extractZip(archive, dest)
  const py = await pythonBin()
  const result = await run(py, ['-m', 'tarfile', '-e', archive, dest], { timeoutMs: 300_000 })
  if (result.code !== 0) throw new Error(`归档解压失败：${result.stderr.slice(0, 300)}`)
}

function singleTopDir(dir: string): string {
  const entries = readdirSync(dir, { withFileTypes: true })
  if (entries.length !== 1 || !entries[0]!.isDirectory()) {
    throw new Error(`引擎包结构不符合预期（${dir} 下应有单一顶层目录）`)
  }
  return join(dir, entries[0]!.name)
}

async function installTree(
  extractedRoot: string,
  stamp: string,
): Promise<{ serverPath: string; installDir: string }> {
  const top = singleTopDir(extractedRoot)
  const installDir = join(paths.mossinfer(), stamp)
  rmSync(installDir, { recursive: true, force: true })
  mkdirSync(paths.mossinfer(), { recursive: true })
  await rename(top, installDir)
  const serverPath = join(
    installDir,
    'bin',
    process.platform === 'win32' ? 'moss-server.exe' : 'moss-server',
  )
  if (!existsSync(serverPath)) throw new Error(`引擎包里没有 ${serverPath}`)
  if (process.platform !== 'win32') chmodSync(serverPath, 0o755)
  return { serverPath, installDir }
}

/**
 * The system-cuda package variant ships no CUDA libraries; the engine dlopens
 * libcublasLt.so.<major> by soname, and the executable's RUNPATH ($ORIGIN/../lib)
 * is on that search path — so installing the NVIDIA PyPI wheels' libraries into
 * the package's own lib/ satisfies it without root or system-wide changes.
 */
export async function installCudaLibraries(
  installDir: string,
  flavour: 'cu12' | 'cu13',
  settings: Settings,
): Promise<void> {
  const major = flavour === 'cu12' ? 12 : 13
  // CUDA 12 wheels carry the -cu12 suffix; CUDA 13 dropped it (the -cu13 names are
  // 0.0.1 placeholders that build from source and fail).
  const packages =
    major === 12
      ? ['nvidia-cuda-runtime-cu12', 'nvidia-cublas-cu12']
      : ['nvidia-cuda-runtime>=13,<14', 'nvidia-cublas>=13,<14']
  const index = settings.pipIndex ?? 'https://pypi.org/simple'
  const target = join(paths.cache(), `mossinfer-cuda-libs-${flavour}`)
  rmSync(target, { recursive: true, force: true })
  mkdirSync(target, { recursive: true })
  const env = {
    UV_CACHE_DIR: join(paths.cache(), 'uv'),
    PIP_CACHE_DIR: join(paths.cache(), 'pip'),
  }
  const uv = spawnSync('uv', ['--version'], { encoding: 'utf8', timeout: 5000 })
  if (uv.status === 0) {
    const result = await run(
      'uv',
      ['pip', 'install', '--target', target, '--no-deps', '--index-url', index, ...packages],
      { timeoutMs: 600_000, env },
    )
    if (result.code !== 0) throw new Error(`CUDA 库下载失败（uv）：${result.stderr.slice(0, 400)}`)
  } else {
    const py = await pythonBin()
    const result = await run(
      py,
      ['-m', 'pip', 'install', '--target', target, '--no-deps', '--index-url', index, ...packages],
      { timeoutMs: 600_000, env },
    )
    if (result.code !== 0) throw new Error(`CUDA 库下载失败（pip）：${result.stderr.slice(0, 400)}`)
  }
  const destDir = join(installDir, process.platform === 'win32' ? 'bin' : 'lib')
  mkdirSync(destDir, { recursive: true })
  // Wheel layouts differ: cu12 packages use nvidia/<project>/lib, cu13 merged them
  // into nvidia/cu13/lib. Walk nvidia/ and copy every shared library found.
  const libs: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!/^lib.*\.so[.\d]*$/.test(entry.name) && !/64_\d+\.dll$/.test(entry.name)) continue
      cpSync(full, join(destDir, entry.name))
      libs.push(entry.name)
    }
  }
  walk(join(target, 'nvidia'))
  if (!libs.some((name) => name.includes('cublasLt'))) {
    throw new Error(`CUDA 库安装失败：wheel 里没找到 cublasLt（${libs.join(', ') || '空'}）`)
  }
}

/** IPC entry: install the CUDA libraries next to the currently configured moss-server. */
export async function installMossInferCudaLibs(): Promise<{ installed: string[] }> {
  const settings = getSettings()
  const serverPath = settings.mossInferServerPath
  if (!serverPath || !existsSync(serverPath)) throw new Error('还没有安装 moss-server，请先下载引擎')
  const probe = await probeMossInfer(serverPath)
  const runtimeVersion = Number(
    (probe['probe'] as Record<string, unknown> | undefined)?.['runtime_cuda_version'] ?? 0,
  )
  const major = Math.floor(runtimeVersion / 1000)
  if (major !== 12 && major !== 13) throw new Error(`无法识别引擎的 CUDA 主版本（${runtimeVersion}）`)
  const installDir = join(serverPath, '..', '..')
  const flavour: 'cu12' | 'cu13' = major === 12 ? 'cu12' : 'cu13'
  const libDir = join(installDir, process.platform === 'win32' ? 'bin' : 'lib')
  await installCudaLibraries(installDir, flavour, settings)
  await shutdownMossInfer()
  return { installed: readdirSync(libDir).filter((name) => name.includes('.so') || name.endsWith('.dll')) }
}

interface Source {
  url: string
  token: string | null
  totalHint: number
  expectedSha: string | null // null = verify after download from a bundled .sha256 (dev artifact)
  stamp: string
  label: string
  effectiveVariant: Variant
  fallbackNote?: string
}

async function queryStable(flavour: 'cu12' | 'cu13', variant: Variant): Promise<Source> {
  const release = (await ghJson('/releases/latest', null)) as {
    tag_name: string
    assets: GhAsset[]
  }
  const version = release.tag_name.replace(/^v/, '')
  const pick = (v: Variant): GhAsset | undefined =>
    release.assets.find((item) => item.name === `${archiveBase(version, flavour, v)}.${archiveExt()}`)
  let effectiveVariant = variant
  let asset = pick(variant)
  let fallbackNote: string | undefined
  if (!asset) {
    const other: Variant = variant === 'system-cuda' ? 'bundled' : 'system-cuda'
    asset = pick(other)
    if (asset) {
      effectiveVariant = other
      fallbackNote = `该 release 没有 ${variant} 变体，已回退到 ${other} 包`
    }
  }
  if (!asset) {
    throw new Error(
      `最新 release ${release.tag_name} 里没有 ${archiveBase(version, flavour, variant)}.${archiveExt()}` +
        (release.assets.length ? `（现有资产：${release.assets.map((a) => a.name).slice(0, 6).join(', ')}…）` : '（该 release 还没有资产）'),
    )
  }
  const name = asset.name
  const sumsAsset = release.assets.find((item) => item.name === 'SHA256SUMS')
  let expected: string | null = null
  if (sumsAsset) {
    const response = await fetch(sumsAsset.browser_download_url, { signal: AbortSignal.timeout(20_000) })
    if (response.ok) expected = sha256Of(await response.text(), name)
  }
  return {
    url: asset.browser_download_url,
    token: null,
    totalHint: asset.size,
    expectedSha: expected,
    stamp: `stable-${release.tag_name}-${flavour}${effectiveVariant === 'system-cuda' ? '-system-cuda' : ''}`,
    label: `release ${release.tag_name}`,
    effectiveVariant,
    fallbackNote,
  }
}

async function queryDev(flavour: 'cu12' | 'cu13', variant: Variant, settings: Settings): Promise<Source> {
  const token = resolveGithubToken(settings)
  if (!token) {
    throw new Error(
      'GitHub Actions 构件下载需要 token（public 仓库也一样）：请设置 githubToken，或配置 GH_TOKEN 环境变量 / gh CLI 登录',
    )
  }
  const runs = (await ghJson('/actions/runs?branch=main&status=success&per_page=1&name=ci', token)) as {
    workflow_runs: Array<{ id: number; head_sha: string }>
  }
  const runInfo = runs.workflow_runs[0]
  if (!runInfo) throw new Error('main 分支上还没有成功的 ci 运行')
  const artifacts = (await ghJson(`/actions/runs/${runInfo.id}/artifacts`, token)) as {
    artifacts: GhArtifact[]
  }
  const name = `mossinfer-${process.platform === 'win32' ? 'windows-msvc' : 'linux'}-${flavour === 'cu13' ? 'cuda13' : 'cuda12'}`
  const artifact = artifacts.artifacts.find((item) => item.name === name)
  if (!artifact) throw new Error(`ci 运行 ${runInfo.id} 里没有构件 ${name}`)
  if (artifact.expired) throw new Error(`构件 ${name} 已过期（CI 保留 7 天）`)
  return {
    url: `${API}/actions/artifacts/${artifact.id}/zip`,
    token,
    totalHint: artifact.size_in_bytes,
    expectedSha: null,
    stamp: `dev-run${runInfo.id}-${runInfo.head_sha.slice(0, 8)}-${flavour}${variant === 'system-cuda' ? '-system-cuda' : ''}`,
    label: `ci run ${runInfo.id}（${runInfo.head_sha.slice(0, 8)}）`,
    effectiveVariant: variant, // final choice made after the outer zip is extracted
  }
}

async function downloadAndInstall(
  channel: 'stable' | 'dev',
  flavour: 'cu12' | 'cu13',
  variant: Variant,
  settings: Settings,
): Promise<{ serverPath: string; stamp: string; effectiveVariant: Variant; fallbackNote?: string }> {
  const source = channel === 'stable' ? await queryStable(flavour, variant) : await queryDev(flavour, variant, settings)
  publish({ phase: 'downloading', version: source.label, bytes: 0, totalBytes: source.totalHint })
  const workDir = join(paths.mossinfer(), 'downloads')
  mkdirSync(workDir, { recursive: true })
  const downloadPath = join(workDir, `${source.stamp}.download`)
  const digest = await downloadTo(source.url, downloadPath, source.token, source.totalHint)

  publish({ phase: 'verifying', bytes: source.totalHint, percent: 100 })
  let archivePath = downloadPath
  let effectiveVariant = source.effectiveVariant
  let fallbackNote = source.fallbackNote
  if (channel === 'dev') {
    // The artifact is an outer zip wrapping the CPack archives + their .sha256 files.
    // Older CI runs predate the system-cuda variant: fall back to the bundled archive
    // from the same artifact (no second download).
    const outerDir = join(workDir, `${source.stamp}-outer`)
    rmSync(outerDir, { recursive: true, force: true })
    await extractZip(downloadPath, outerDir)
    rmSync(downloadPath, { force: true }) // the 800 MB artifact zip is no longer needed
    const pick = (wantSystemCuda: boolean): string | undefined =>
      readdirSync(outerDir).find(
        (name) =>
          name.endsWith(`.${archiveExt()}`) &&
          name.startsWith('mossinfer-') &&
          name.includes(`-${flavour}-`) &&
          (wantSystemCuda ? name.includes('-system-cuda') : !name.includes('-system-cuda')),
      )
    const wanted =
      source.effectiveVariant === 'system-cuda'
        ? (pick(true) ?? pick(false))
        : pick(false)
    if (!wanted) throw new Error('构件 zip 里没有找到引擎归档')
    if (!wanted.includes('-system-cuda') && source.effectiveVariant === 'system-cuda') {
      effectiveVariant = 'bundled'
      fallbackNote = '该 CI 构件没有 system-cuda 变体（上游 workflow 更新前的运行），已回退到完整包'
    }
    // keep the install dir name honest about what actually landed
    source.stamp = `${source.stamp.replace(/-system-cuda$/, '')}${effectiveVariant === 'system-cuda' ? '-system-cuda' : ''}`
    archivePath = join(outerDir, wanted)
    const shaFile = readdirSync(outerDir).find((name) => name === `${wanted}.sha256`)
    if (shaFile) {
      const expected = readFileSync(join(outerDir, shaFile), 'utf8').trim().split(/\s+/)[0]
      const actual = createHash('sha256').update(readFileSync(archivePath)).digest('hex')
      if (expected && actual !== expected) throw new Error(`引擎归档 sha256 校验失败（${wanted}）`)
    }
  } else if (source.expectedSha && digest !== source.expectedSha) {
    rmSync(downloadPath, { force: true })
    throw new Error('引擎包 sha256 校验失败（SHA256SUMS 不匹配）')
  }

  publish({ phase: 'extracting' })
  const extractDir = join(workDir, `${source.stamp}-extract`)
  rmSync(extractDir, { recursive: true, force: true })
  await extractArchive(archivePath, extractDir)
  const { serverPath, installDir } = await installTree(extractDir, source.stamp)
  rmSync(archivePath, { force: true }) // free the archive before the CUDA-libs download
  if (effectiveVariant === 'system-cuda') {
    publish({ phase: 'cuda_libs' })
    await installCudaLibraries(installDir, flavour, settings)
  }
  rmSync(workDir, { recursive: true, force: true })
  return { serverPath, stamp: source.stamp, effectiveVariant, fallbackNote }
}

export async function downloadMossInfer(
  channel: 'stable' | 'dev',
  flavourInput?: 'cu12' | 'cu13',
  variantInput?: Variant,
): Promise<MossInferDownloadState> {
  if (current && current.phase !== 'done' && current.phase !== 'error') return current
  const settings = getSettings()
  const variant: Variant = variantInput ?? settings.mossInferVariant
  controller = new AbortController()
  current = {
    channel,
    phase: 'querying',
    bytes: 0,
    totalBytes: 0,
    percent: 0,
    speedBps: 0,
    updatedAt: new Date().toISOString(),
  }
  publish({ phase: 'querying' })
  try {
    let flavour = flavourInput ?? 'cu13'
    let installed = await downloadAndInstall(channel, flavour, variant, settings)
    // Upstream decision procedure: install cu13 by default, probe, fall back to cu12.
    let probe = await probeMossInfer(installed.serverPath)
    let recommended = String((probe['probe'] as Record<string, unknown> | undefined)?.['recommended_flavour'] ?? '')
    if (flavour === 'cu13' && recommended === 'cu12') {
      publish({ phase: 'querying', version: '驱动只支持 CUDA 12，改下 cu12 包' })
      flavour = 'cu12'
      installed = await downloadAndInstall(channel, flavour, variant, settings)
      probe = await probeMossInfer(installed.serverPath)
      recommended = String((probe['probe'] as Record<string, unknown> | undefined)?.['recommended_flavour'] ?? '')
    }
    const update = updateSettings({
      mossInferServerPath: installed.serverPath,
      mossInferChannel: channel,
      mossInferVariant: installed.effectiveVariant,
    })
    emit(Events.settingsChanged, update)
    await shutdownMossInfer() // next job spawns the freshly installed binary
    publish({
      phase: 'done',
      percent: 100,
      serverPath: installed.serverPath,
      recommendedFlavour: recommended,
      variant: installed.effectiveVariant,
      note: installed.fallbackNote,
      cublaslt: (probe['probe'] as Record<string, unknown> | undefined)?.['cublaslt'],
    })
  } catch (error) {
    publish({ phase: 'error', error: error instanceof Error ? error.message : String(error) })
  }
  return current
}
