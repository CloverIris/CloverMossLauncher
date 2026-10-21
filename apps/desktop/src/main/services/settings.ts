import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import type { Settings } from '@shared/types'
import { paths } from '../lib/paths'

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  uiAnimation: 'system',
  language: 'zh-CN',
  networkMode: 'auto',
  gitMirror: null,
  pipIndex: null,
  hfEndpoint: null,
  modelsRoot: null,
  pythonPath: null,
  torchBackend: 'auto',
  torchIndex: null,
  autoCheckUpdates: true,
  desktopNotifications: true,
  lanWebEnabled: false,
  lanWebPort: null,
  lanWebInstanceId: null,
  updateChannel: 'stable',
  dismissedAnnouncements: [],
  dismissedUpdateVersion: null,
  sidebarCollapsed: false,
  galleryRoots: [],
  homeBackground: null,
  trainerRoot: null,
  disabledDevices: [],
  deviceLabels: {},
}

let cache: Settings | null = null

export function getSettings(): Settings {
  if (cache) return cache
  try {
    const raw = readFileSync(paths.settings(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<Settings>
    cache = { ...DEFAULT_SETTINGS, ...parsed }
    if (!Array.isArray(cache.dismissedAnnouncements)) cache.dismissedAnnouncements = []
  } catch {
    cache = { ...DEFAULT_SETTINGS }
  }
  return cache
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const next: Settings = { ...getSettings(), ...patch }
  if (patch.dismissedAnnouncements) {
    next.dismissedAnnouncements = Array.from(new Set(patch.dismissedAnnouncements)).slice(-200)
  }
  atomicWriteJson(paths.settings(), next)
  cache = next
  return next
}

export function atomicWriteJson(file: string, value: unknown): void {
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
  renameSync(tmp, file)
}

export function readJson<T>(file: string, fallback: T): T {
  if (!existsSync(file)) return fallback
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}
