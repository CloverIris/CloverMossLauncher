import { useEffect, useRef, useState } from 'react'
import defaultHomeBackground from './assets/home-background.png'
import { Events } from '@shared/channels'
import type { Diagnostic } from '@shared/types'
import { onEvent } from './lib/api'
import { useToast } from './components/ui'
import { HashRouter, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ToastProvider } from './components/ui'
import { NotificationPanel } from './components/NotificationPanel'
import { UpdateDialog } from './components/UpdateDialog'
import { GalleryPage } from './pages/Gallery'
import { DiagnosticsPage } from './pages/Diagnostics'
import { DevicesPage } from './pages/Devices'
import { EnginePage } from './pages/Engine'
import { StudioPage } from './pages/Studio'
import { InstanceDetailPage } from './pages/InstanceDetail'
import { InstancesPage } from './pages/Instances'
import { ModelsPage } from './pages/Models'
import { SettingsPage } from './pages/Settings'
import { TerminalPage } from './pages/Terminal'
import { TrainingPage } from './pages/Training'
import { TrainerWindow } from './pages/TrainerWindow'
import { useApp } from './store'
import { cloverUrl } from './lib/clover'
import { MotionPanel } from './components/motion'
import { AppTitlebar } from './components/AppTitlebar'
import type { WindowIntent } from './lib/windows'
import {
  Bell,
  Boxes,
  Cpu,
  GraduationCap,
  Images,
  LayoutGrid,
  Package,
  Settings2,
  SquareTerminal,
  Stethoscope,
  X,
  GripVertical,
} from 'lucide-react'
import { IconButton, cn } from './components/ui'

function useAppBackground(): React.CSSProperties {
  const settings = useApp((state) => state.settings)
  const custom = Boolean(settings?.homeBackground)
  const source = custom ? cloverUrl(settings!.homeBackground!) : defaultHomeBackground
  return {
    backgroundImage: `linear-gradient(rgba(18,20,24,${custom ? 0.78 : 0.55}), rgba(18,20,24,${custom ? 0.90 : 0.70})), url("${source}")`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundColor: '#191b1f',
  }
}

const PAGES = [
  { to: '/studio', label: '创作', title: 'Studio', icon: LayoutGrid },
  { to: '/engines', label: '引擎', title: '引擎', icon: Boxes },
  { to: '/models', label: '模型', title: '模型与下载', icon: Package },
  { to: '/devices', label: '设备', title: '设备与连接', icon: Cpu },
  { to: '/training', label: '训练', title: '训练', icon: GraduationCap },
  { to: '/gallery', label: '画廊', title: '画廊', icon: Images },
  { to: '/diagnostics', label: '诊断', title: '诊断', icon: Stethoscope },
  { to: '/settings', label: '设置', title: '设置', icon: Settings2 },
] as const

function StudioShell(): React.JSX.Element {
  const location = useLocation()
  const navigate = useNavigate()
  const toast = useToast()
  const backgroundStyle = useAppBackground()
  const notificationsOpen = useApp((state) => state.notificationsOpen)
  const setNotificationsOpen = useApp((state) => state.setNotificationsOpen)
  const [terminalOpen, setTerminalOpen] = useState(false)
  const studio = location.pathname === '/studio'
  const page = PAGES.find((item) => location.pathname === item.to || location.pathname.startsWith(`${item.to}/`)) ?? PAGES[0]

  useEffect(() => {
    const listener = (event: Event): void => {
      const intent = (event as CustomEvent<WindowIntent>).detail
      if (intent.target === 'terminal') setTerminalOpen(true)
      else if (intent.target === 'management') navigate(intent.route ?? '/settings')
      else navigate('/studio')
    }
    window.addEventListener('mossstudio:window-intent', listener)
    return () => window.removeEventListener('mossstudio:window-intent', listener)
  }, [navigate])

  useEffect(
    () =>
      onEvent<Diagnostic>(Events.diagnostic, (diagnostic) => {
        if (diagnostic.toast) toast.push(diagnostic.title, diagnostic.severity === 'warning' ? 'info' : 'error')
      }),
    [toast],
  )

  return (
    <div className="app-shell flex h-full flex-col text-[var(--color-text)]">
      <header className="glass-thin drag relative flex h-11 shrink-0 items-center justify-between border-b border-[var(--color-border-subtle)] pl-[78px] pr-2">
        <div className="no-drag flex items-center gap-2">
          <IconButton label="回到创作" className="size-7" onClick={() => navigate('/studio')}>
            <LayoutGrid className="size-4" />
          </IconButton>
          <span className="text-[12px] font-semibold">MossStudio</span>
          <span className="rounded border border-white/10 px-1 py-px text-[8px] uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
            {page.title}
          </span>
        </div>
        <div className="no-drag flex items-center gap-0.5">
          <IconButton label={terminalOpen ? '关闭终端' : '打开终端'} className="size-7" onClick={() => setTerminalOpen((open) => !open)}>
            <SquareTerminal className="size-3.5" />
          </IconButton>
          <IconButton
            label={notificationsOpen ? '隐藏通知' : '显示通知'}
            className={cn('size-7', notificationsOpen && 'bg-white/[0.07]')}
            onClick={() => setNotificationsOpen(!notificationsOpen)}
          >
            <Bell className="size-3.5" />
          </IconButton>
        </div>
      </header>

      <main className={cn('content-surface min-h-0 min-w-0 flex-1', studio ? 'overflow-hidden' : 'overflow-y-auto')} style={backgroundStyle}>
        <MotionPanel
          transitionKey={location.pathname}
          className={studio ? 'h-full w-full px-3 py-2' : 'mx-auto w-full max-w-[1200px] px-6 py-5'}
        >
          <ErrorBoundary>
            <Routes>
              <Route path="/studio" element={<StudioPage />} />
              <Route path="/engines" element={<EnginePage />} />
              <Route path="/instances" element={<InstancesPage />} />
              <Route path="/instances/:id" element={<InstanceDetailPage />} />
              <Route path="/models" element={<ModelsPage />} />
              <Route path="/devices" element={<DevicesPage />} />
              <Route path="/training" element={<TrainingPage />} />
              <Route path="/gallery" element={<GalleryPage />} />
              <Route path="/diagnostics" element={<DiagnosticsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/studio" replace />} />
            </Routes>
          </ErrorBoundary>
        </MotionPanel>
      </main>

      <nav className="glass-thin flex h-9 shrink-0 items-stretch border-t border-[var(--color-border-subtle)] px-1">
        {PAGES.map((item) => {
          const Icon = item.icon
          const active = location.pathname === item.to || location.pathname.startsWith(`${item.to}/`)
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={cn(
                'relative flex min-w-[68px] flex-1 items-center justify-center gap-1.5 border-b-2 px-2 text-[10px] transition',
                active
                  ? 'border-accent-400 bg-white/[0.05] text-[var(--color-text)]'
                  : 'border-transparent text-[var(--color-text-tertiary)] hover:bg-white/[0.03] hover:text-[var(--color-text-secondary)]',
              )}
            >
              <Icon className="size-3" />
              {item.label}
            </NavLink>
          )
        })}
      </nav>

      {terminalOpen ? (
        <div className="fixed inset-x-0 bottom-9 z-40 h-[42vh] border-t border-[var(--color-border-subtle)] bg-[#14171c] shadow-2xl">
          <div className="flex h-8 items-center justify-between border-b border-[var(--color-border-subtle)] px-3">
            <span className="text-[10px] font-medium">终端</span>
            <IconButton label="关闭终端" onClick={() => setTerminalOpen(false)}><X className="size-3.5" /></IconButton>
          </div>
          <div className="h-[calc(42vh-32px)]">
            <ErrorBoundary><TerminalPage /></ErrorBoundary>
          </div>
        </div>
      ) : null}
      <NotificationPanel />
      <UpdateDialog />
    </div>
  )
}

function TrainerShell(): React.JSX.Element {
  const backgroundStyle = useAppBackground()
  return (
    <div className="app-shell flex h-full flex-col text-[var(--color-text)]">
      <AppTitlebar kind="trainer" appName="Kohaku Trainer" appTag="external" />
      <MotionPanel transitionKey="trainer" className="min-h-0 flex-1 overflow-y-auto" style={backgroundStyle}>
        <TrainerWindow />
      </MotionPanel>
    </div>
  )
}

export function App(): React.JSX.Element {
  const init = useApp((state) => state.init)
  const kind = window.clover.windowKind
  useEffect(() => { void init() }, [init])
  return (
    <ToastProvider>
      <HashRouter>
        {kind === 'trainer' ? <TrainerShell /> : <StudioShell />}
      </HashRouter>
    </ToastProvider>
  )
}
