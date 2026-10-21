import { app } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Announcement, Settings, UpdateState } from '@shared/types'
import { compareSemver, findInstaller } from '@shared/release'
import { paths } from '../lib/paths'
import { loadReleaseDocument, localReleaseDir } from './release'
import { getSettings, updateSettings } from './settings'
import { pushLocalNotification } from './desktopNotifications'

export { localReleaseDir }

let lastNotifiedUpdateVersion: string | null = null

async function fetchText(url: string, timeoutMs = 6000): Promise<string> {
  const response = await fetch(url, {
    headers: { 'user-agent': `MossStudio-Launcher/${app.getVersion()}` },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return await response.text()
}

async function resolveBody(
  docBody: string,
  raw: { body_markdown?: string; body_url?: string },
  localDir: string | null,
): Promise<string> {
  if (raw.body_markdown) return raw.body_markdown
  if (!raw.body_url) return ''
  if (localDir && raw.body_url.includes('CloverIris/MossStudio')) {
    const readme = join(localDir, 'README.md')
    if (existsSync(readme)) return readFileSync(readme, 'utf8')
  }
  try {
    return await fetchText(raw.body_url)
  } catch {
    return docBody || '公告内容暂时无法加载。'
  }
}

function releaseNotes(body: string): string {
  const marker = body.indexOf('## 发布说明')
  if (marker < 0) return body
  return body.slice(marker + '## 发布说明'.length).replace(/^\s+/, '').trim()
}

export async function checkUpdates(settings?: Settings): Promise<UpdateState> {
  const effective = settings ?? getSettings()
  const checkedAt = new Date().toISOString()
  const currentVersion = app.getVersion()

  try {
    const loaded = await loadReleaseDocument(false, effective.updateChannel)
    const doc = loaded.document
    const localDir = localReleaseDir()
    const now = Date.now()
    const dismissed = new Set(effective.dismissedAnnouncements)
    const announcements: Announcement[] = []

    for (const raw of doc.announcements) {
      if (dismissed.has(raw.id)) continue
      if (raw.starts_at && Date.parse(raw.starts_at) > now) continue
      if (raw.ends_at && Date.parse(raw.ends_at) < now) continue
      announcements.push({
        id: raw.id,
        level: raw.level,
        title: raw.title,
        body: await resolveBody(loaded.body, raw, localDir),
        bodyUrl: raw.body_url,
        startsAt: raw.starts_at,
        endsAt: raw.ends_at ?? null,
        dismissible: raw.dismissible ?? true,
        pinned: raw.pinned ?? false,
        action: raw.action,
      })
    }
    announcements.sort((a, b) => Number(b.pinned) - Number(a.pinned))

    const updateAvailable = compareSemver(doc.app.version, currentVersion) > 0
    const state: UpdateState = {
      checkedAt,
      currentVersion,
      latestVersion: doc.app.version,
      updateAvailable,
      channel: doc.app.channel,
      manifestSource: loaded.source,
      home: doc.home,
      announcements,
      releaseNotes: releaseNotes(loaded.body),
      publishedAt: doc.app.published_at,
      releaseUrl: doc.app.notes_url,
      installer: findInstaller(doc.installers, process.platform, process.arch),
      mandatory: doc.app.mandatory ?? false,
    }
    const quiet =
      process.argv.includes('--smoke') ||
      process.argv.includes('--screenshot') ||
      process.argv.some((arg) => arg.startsWith('--scenario='))
    if (
      updateAvailable &&
      doc.app.version !== lastNotifiedUpdateVersion &&
      doc.app.version !== effective.dismissedUpdateVersion &&
      !quiet
    ) {
      const shown = pushLocalNotification({
        title: `发现新版本 ${doc.app.version}`,
        body: '打开启动器查看更新说明并选择是否安装。',
        windowKind: 'launcher',
        route: '/settings',
      })
      if (shown) lastNotifiedUpdateVersion = doc.app.version
    }
    return state
  } catch (error) {
    return {
      checkedAt,
      currentVersion,
      latestVersion: null,
      updateAvailable: false,
      channel: 'stable',
      manifestSource: 'none',
      announcements: [],
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Legacy install sources still live in manifest.json. Keep this reader until the
 * recommended commit is moved into a release document of its own.
 */
export function getRecommendedCommit(): string | null {
  const local = localReleaseDir()
  if (local) {
    try {
      const manifest = JSON.parse(readFileSync(join(local, 'manifest.json'), 'utf8')) as {
        sources?: { moss?: { recommended_commit?: string } }
      }
      return manifest.sources?.moss?.recommended_commit ?? null
    } catch {
      // fall through
    }
  }
  try {
    const cached = JSON.parse(readFileSync(join(paths.cache(), 'release.json'), 'utf8')) as {
      manifest?: { sources?: { moss?: { recommended_commit?: string } } }
    }
    return cached.manifest?.sources?.moss?.recommended_commit ?? null
  } catch {
    return null
  }
}

export function dismissAnnouncement(id: string): void {
  const settings = getSettings()
  updateSettings({ dismissedAnnouncements: [...settings.dismissedAnnouncements, id] })
}
