import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'

export type WindowKind = 'launcher' | 'creator' | 'terminal' | 'trainer' | 'devices'

const windows = new Map<WindowKind, BrowserWindow>()
const isDev = !app.isPackaged
const screenshot = process.argv.includes('--screenshot')

const config: Record<WindowKind, { width: number; height: number; minWidth: number; minHeight: number; route: string; title: string }> = {
  launcher: { width: 1180, height: 760, minWidth: 960, minHeight: 640, route: '/', title: 'MossStudio' },
  creator: { width: 1600, height: 920, minWidth: 1200, minHeight: 720, route: '/studio', title: 'MossStudio' },
  terminal: { width: 1120, height: 720, minWidth: 900, minHeight: 560, route: '/terminal', title: 'MossStudio Terminal' },
  trainer: { width: 1280, height: 840, minWidth: 980, minHeight: 640, route: '/trainer', title: 'Kohaku Trainer' },
  devices: { width: 1180, height: 780, minWidth: 960, minHeight: 640, route: '/devices', title: 'MossStudio Devices' },
}

export function createAppWindow(kind: WindowKind, show = true): BrowserWindow {
  const existing = windows.get(kind)
  if (existing && !existing.isDestroyed()) {
    existing.show()
    existing.focus()
    return existing
  }

  const acrylic = !screenshot && (process.platform === 'darwin' || process.platform === 'win32')
  const meta = config[kind]
  const win = new BrowserWindow({
    width: meta.width,
    height: meta.height,
    minWidth: meta.minWidth,
    minHeight: meta.minHeight,
    show: false,
    title: meta.title,
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 16, y: 15 } }
      : process.platform === 'win32'
        ? {
            titleBarStyle: 'hidden' as const,
            titleBarOverlay: { color: '#00000000', symbolColor: '#e9eef7', height: 44 },
          }
        : {}),
    ...(process.platform === 'darwin'
      ? { vibrancy: 'under-window' as const, visualEffectState: 'active' as const }
      : {}),
    ...(process.platform === 'win32' ? { backgroundMaterial: 'acrylic' as const } : {}),
    backgroundColor: acrylic ? '#00000000' : '#191b1f',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      additionalArguments: [
        acrylic ? '--clover-acrylic' : '--clover-opaque',
        `--clover-window=${kind}`,
        `--clover-channel=${app.isPackaged ? 'release' : 'dev'}`,
      ],
    },
  })

  win.once('ready-to-show', () => {
    if (show) win.show()
  })

  win.webContents.on('console-message', (...args: unknown[]) => {
    const details = args[1] as { level?: string; message?: string } | number | undefined
    if (details && typeof details === 'object' && details.message) {
      console.log(`[renderer:${details.level ?? 'log'}]`, details.message)
    } else if (typeof args[2] === 'string') {
      console.log('[renderer]', args[2])
    }
  })
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('[renderer:gone]', details.reason, details.exitCode)
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    const current = win.webContents.getURL()
    if (url !== current) {
      event.preventDefault()
      if (url.startsWith('https://')) void shell.openExternal(url)
    }
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#${meta.route}`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: meta.route })
  }

  windows.set(kind, win)
  win.on('closed', () => {
    if (windows.get(kind) === win) windows.delete(kind)
  })
  return win
}

export function openWindow(kind: WindowKind, route?: string): BrowserWindow {
  const win = createAppWindow(kind)
  if (route) {
    const apply = (): void => {
      void win.webContents.executeJavaScript(`location.hash = '#${route}'`)
    }
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', apply)
    else apply()
  }
  return win
}

export function getWindow(kind: WindowKind): BrowserWindow | undefined {
  const win = windows.get(kind)
  return win && !win.isDestroyed() ? win : undefined
}
