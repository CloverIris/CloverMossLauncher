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
import { AgentSidebar } from './components/AgentSidebar'
import { GalleryPage } from './pages/Gallery'
import { DiagnosticsPage } from './pages/Diagnostics'
import { DevicesPage } from './pages/Devices'
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

const MANAGEMENT_NAV = [
  { to: '/instances', label: '实例', icon: Boxes },
  { to: '/models', label: '模型与下载', icon: Package },
  { to: '/devices', label: '设备与连接', icon: Cpu },
  { to: '/training', label: '训练', icon: GraduationCap },
  { to: '/gallery', label: '画廊', icon: Images },
  { to: '/diagnostics', label: '诊断', icon: Stethoscope },
  { to: '/settings', label: '设置', icon: Settings2 },
]

function ManagementCenter(): React.JSX.Element {
  const location = useLocation()
  const navigate = useNavigate()
  const backgroundStyle = useAppBackground()
  return (
    <div className="flex min-h-0 flex-1">
      <aside className="glass-thin flex w-[220px] shrink-0 flex-col border-r border-[var(--color-border-subtle)] p-2">
        <div className="flex items-center justify-between px-2 py-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">工作台</span>
          <IconButton label="关闭工作台" onClick={() => navigate('/studio')}><X className="size-3.5" /></IconButton>
        </div>
        <nav className="space-y-0.5">
          {MANAGEMENT_NAV.map((item) => {
            const Icon = item.icon
            const active = location.pathname === item.to || location.pathname.startsWith(`${item.to}/`)
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={cn(
                  'flex items-center gap-2 rounded-[5px] px-2.5 py-2 text-[11px] transition',
                  active ? 'bg-white/[0.07] text-[var(--color-text)]' : 'text-[var(--color-text-secondary)] hover:bg-white/[0.04]',
                )}
              >
                <Icon className="size-3.5" />
                {item.label}
              </NavLink>
            )
          })}
        </nav>
        <p className="mt-auto px-2 pb-2 text-[8.5px] leading-4 text-[var(--color-text-tertiary)]">
          设备、下载、训练和设置都在这里；Studio 只保留创作。
        </p>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto" style={backgroundStyle}>
        <MotionPanel transitionKey={location.pathname} className="mx-auto w-full max-w-[1200px] px-6 py-5">
          <ErrorBoundary>
            <Routes>
              <Route path="/instances" element={<InstancesPage />} />
              <Route path="/instances/:id" element={<InstanceDetailPage />} />
              <Route path="/models" element={<ModelsPage />} />
              <Route path="/devices" element={<DevicesPage />} />
              <Route path="/training" element={<TrainingPage />} />
              <Route path="/gallery" element={<GalleryPage />} />
              <Route path="/diagnostics" element={<DiagnosticsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/settings" replace />} />
            </Routes>
          </ErrorBoundary>
        </MotionPanel>
      </main>
    </div>
  )
}

function AgentDock(): React.JSX.Element {
  const [pos, setPos] = useState(() => ({
    x: Math.max(12, window.innerWidth - 336),
    y: Math.max(60, window.innerHeight - 332),
  }))
  const drag = useRef<{ dx: number; dy: number } | null>(null)
  return (
    <div className="fixed z-30 flex h-[300px] w-[320px] flex-col overflow-hidden rounded-[8px] border border-[var(--color-border-subtle)] bg-[var(--color-surface)]/95 shadow-2xl" style={{ left: pos.x, top: pos.y }}>
      <div
        className="flex h-4 shrink-0 cursor-move items-center justify-center border-b border-[var(--color-border-subtle)] text-[var(--color-text-tertiary)]"
        onPointerDown={(event) => {
          drag.current = { dx: event.clientX - pos.x, dy: event.clientY - pos.y }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          if (!drag.current) return
          setPos({
            x: Math.min(window.innerWidth - 332, Math.max(8, event.clientX - drag.current.dx)),
            y: Math.min(window.innerHeight - 312, Math.max(52, event.clientY - drag.current.dy)),
          })
        }}
        onPointerUp={() => { drag.current = null }}
      >
        <GripVertical className="size-3" />
      </div>
      <div className="min-h-0 flex-1"><AgentSidebar /></div>
    </div>
  )
}

function StudioShell(): React.JSX.Element {
  const location = useLocation()
  const navigate = useNavigate()
  const toast = useToast()
  const backgroundStyle = useAppBackground()
  const notificationsOpen = useApp((state) => state.notificationsOpen)
  const notifications = useApp((state) => state.notifications)
  const setNotificationsOpen = useApp((state) => state.setNotificationsOpen)
  const [terminalOpen, setTerminalOpen] = useState(false)
  const management = location.pathname !== '/studio'

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
          <IconButton
            label={management ? '关闭工作台' : '打开工作台'}
            className="size-7"
            onClick={() => navigate(management ? '/studio' : '/settings')}
          >
            <LayoutGrid className="size-4" />
          </IconButton>
          <span className="text-[12px] font-semibold">MossStudio</span>
          <span className="rounded border border-white/10 px-1 py-px text-[8px] uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
            {management ? '工作台' : 'studio'}
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

      {management ? (
        <ManagementCenter />
      ) : (
        <div className="flex min-h-0 flex-1">
          <main className="content-surface min-w-0 flex-1 overflow-hidden" style={backgroundStyle}>
            <MotionPanel transitionKey={location.pathname} className="mx-auto w-full max-w-[1600px] px-3 py-2">
              <ErrorBoundary>
                <Routes>
                  <Route path="/studio" element={<StudioPage />} />
                  <Route path="*" element={<Navigate to="/studio" replace />} />
                </Routes>
              </ErrorBoundary>
            </MotionPanel>
          </main>
          <AgentDock />
        </div>
      )}
      {terminalOpen ? (
        <div className="fixed inset-x-0 bottom-0 z-40 h-[42vh] border-t border-[var(--color-border-subtle)] bg-[#14171c] shadow-2xl">
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
