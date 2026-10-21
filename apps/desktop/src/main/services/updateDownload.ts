import { app, shell } from 'electron'
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, rmSync } from 'node:fs'
import { rename } from 'node:fs/promises'
import { once } from 'node:events'
import { basename, join } from 'node:path'
import type { ReleaseInstaller, UpdateDownloadState } from '@shared/release'
import { Events } from '@shared/channels'
import { emit } from '../lib/events'
import { paths } from '../lib/paths'

const states = new Map<string, UpdateDownloadState>()
const controllers = new Map<string, AbortController>()

function now(): string {
  return new Date().toISOString()
}

function publish(state: UpdateDownloadState): UpdateDownloadState {
  states.set(state.version, state)
  emit(Events.updateDownload, state)
  return state
}

function safeVersion(version: string): string {
  return version.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 80) || 'unknown'
}

function installerPath(version: string, installer: ReleaseInstaller): string {
  let name = `MossStudio-${safeVersion(version)}.${installer.kind}`
  try {
    const candidate = basename(new URL(installer.url).pathname)
    if (candidate && candidate !== '/') name = candidate.replace(/[^A-Za-z0-9._-]/g, '-')
  } catch {
    // keep fallback name
  }
  const dir = join(paths.downloads(), 'updates', safeVersion(version))
  mkdirSync(dir, { recursive: true })
  return join(dir, name)
}

function validate(installer: ReleaseInstaller): void {
  const parsed = new URL(installer.url)
  const testHttp =
    process.env['CLOVER_UPDATE_TEST'] === '1' && parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1'
  if (parsed.protocol !== 'https:' && !testHttp) {
    throw new Error('安装包地址必须使用 HTTPS')
  }
  if (!/^[a-f0-9]{64}$/i.test(installer.sha256)) throw new Error('安装包缺少有效的 sha256')
  if (!Number.isFinite(installer.size_bytes) || installer.size_bytes <= 0) {
    throw new Error('安装包大小无效')
  }
}

export function getUpdateDownloadState(version: string): UpdateDownloadState | null {
  return states.get(version) ?? null
}

export function cancelUpdateDownload(version: string): UpdateDownloadState | null {
  const controller = controllers.get(version)
  if (controller) controller.abort()
  const state = states.get(version)
  return state ? { ...state } : null
}

export async function downloadUpdate(
  version: string,
  installer: ReleaseInstaller,
): Promise<UpdateDownloadState> {
  validate(installer)
  const active = states.get(version)
  if (active?.phase === 'downloading' || active?.phase === 'verifying') return active

  const controller = new AbortController()
  controllers.set(version, controller)
  const target = installerPath(version, installer)
  const part = `${target}.part`
  if (existsSync(part)) rmSync(part, { force: true })

  const baseState: UpdateDownloadState = {
    version,
    phase: 'downloading',
    bytes: 0,
    totalBytes: installer.size_bytes,
    percent: 0,
    speedBps: 0,
    path: target,
    updatedAt: now(),
  }
  publish(baseState)
  let stream: ReturnType<typeof createWriteStream> | null = null

  try {
    const response = await fetch(installer.url, {
      headers: { 'user-agent': `MossStudio-Launcher/${app.getVersion()}` },
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`下载失败：HTTP ${response.status}`)
    if (!response.body) throw new Error('下载响应没有 body')

    const length = Number(response.headers.get('content-length') ?? 0)
    const total = Number.isFinite(length) && length > 0 ? length : installer.size_bytes
    const hash = createHash('sha256')
    stream = createWriteStream(part)
    let received = 0
    let lastEmit = 0
    let lastBytes = 0
    let lastTime = Date.now()
    const reader = response.body.getReader()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (controller.signal.aborted) throw new Error('已取消下载')
      const chunk = Buffer.from(value)
      hash.update(chunk)
      received += chunk.length
      if (!stream.write(chunk)) await once(stream, 'drain')
      const timestamp = Date.now()
      if (timestamp - lastEmit >= 250) {
        const elapsed = Math.max(0.001, (timestamp - lastTime) / 1000)
        publish({
          ...baseState,
          phase: 'downloading',
          bytes: received,
          totalBytes: total,
          percent: total > 0 ? Math.min(99.9, (received / total) * 100) : 0,
          speedBps: Math.max(0, (received - lastBytes) / elapsed),
          updatedAt: now(),
        })
        lastEmit = timestamp
        lastBytes = received
        lastTime = timestamp
      }
    }
    stream.end()
    await once(stream, 'finish')

    publish({
      ...baseState,
      phase: 'verifying',
      bytes: received,
      totalBytes: total,
      percent: 100,
      updatedAt: now(),
    })
    const digest = hash.digest('hex')
    if (digest.toLowerCase() !== installer.sha256.toLowerCase()) {
      rmSync(part, { force: true })
      throw new Error('安装包 sha256 校验失败，已删除下载文件')
    }
    if (existsSync(target)) rmSync(target, { force: true })
    await rename(part, target)

    const ready: UpdateDownloadState = {
      ...baseState,
      phase: 'ready',
      bytes: received,
      totalBytes: total,
      percent: 100,
      speedBps: 0,
      path: target,
      updatedAt: now(),
    }
    if (process.env['CLOVER_UPDATE_TEST'] === '1') {
      return publish(ready)
    }
    const openError = await shell.openPath(target)
    if (openError) {
      return publish({
        ...ready,
        error: `安装程序已下载，但无法自动打开：${openError}`,
      })
    }
    return publish({ ...ready, phase: 'opened', updatedAt: now() })
  } catch (error) {
    stream?.destroy()
    rmSync(part, { force: true })
    const canceled = controller.signal.aborted
    return publish({
      ...baseState,
      phase: canceled ? 'canceled' : 'error',
      error: canceled
        ? '下载已取消'
        : error instanceof Error
          ? error.message
          : String(error),
      updatedAt: now(),
    })
  } finally {
    controllers.delete(version)
  }
}
