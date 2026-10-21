import { useEffect, useState } from 'react'
import defaultHomeBackground from './assets/home-background.png'
import { Events } from '@shared/channels'
import type { Diagnostic } from '@shared/types'
import { onEvent } from './lib/api'
import { useToast } from './components/ui'
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { CreatorSidebar, Sidebar } from './components/layout'
import { AppTitlebar } from './components/AppTitlebar'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ToastProvider } from './components/ui'
import { NotificationPanel } from './components/NotificationPanel'
import { UpdateDialog } from './components/UpdateDialog'
import { AgentSidebar } from './components/AgentSidebar'
import { Oobe } from './components/Oobe'
import { HomePage } from './pages/Home'
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

function LauncherShell(): React.JSX.Element {
  const location = useLocation()
  const toast = useToast()
  const settings = useApp((state) => state.settings)
  const notificationsOpen = useApp((state) => state.notificationsOpen)
  const notifications = useApp((state) => state.notifications)
  const toggleSidebar = useApp((state) => state.toggleSidebar)
  const setNotificationsOpen = useApp((state) => state.setNotificationsOpen)
  const onboarding = useApp((state) => state.onboarding)
  const [oobeDismissed, setOobeDismissed] = useState(false)
  const backgroundStyle = useAppBackground()

  useEffect(() => {
    if (location.pathname !== '/') setNotificationsOpen(false)
  }, [location.pathname, setNotificationsOpen])

  useEffect(
    () =>
      onEvent<Diagnostic>(Events.diagnostic, (diagnostic) => {
        if (diagnostic.toast) {
          toast.push(diagnostic.title, diagnostic.severity === 'warning' ? 'info' : 'error')
        }
      }),
    [toast],
  )

  return (
    <div className="app-shell flex h-full flex-col text-[var(--color-text)]">
      <AppTitlebar
        kind="launcher"
        collapsed={settings?.sidebarCollapsed ?? false}
        onToggleSidebar={() => void toggleSidebar()}
        notificationsOpen={notificationsOpen}
        onToggleNotifications={() => setNotificationsOpen(!notificationsOpen)}
        unread={notifications.filter((item) => !item.read).length}
      />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main
          className="content-surface min-w-0 flex-1 overflow-y-auto"
          style={backgroundStyle}
        >
          <MotionPanel transitionKey={location.pathname} className="mx-auto flex min-h-[calc(100vh-44px)] w-full max-w-[1100px] flex-col px-6 py-5">
            <ErrorBoundary>
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/instances" element={<InstancesPage />} />
                <Route path="/instances/:id" element={<InstanceDetailPage />} />
                <Route path="/models" element={<ModelsPage />} />
                <Route path="/training" element={<TrainingPage />} />
                <Route path="/gallery" element={<GalleryPage />} />
                <Route path="/diagnostics" element={<DiagnosticsPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </ErrorBoundary>
          </MotionPanel>
        </main>
        <NotificationPanel />
      </div>
      <UpdateDialog />
      {onboarding ? (
        <Oobe
          open={!oobeDismissed && !onboarding.ready}
          status={onboarding}
          onClose={() => setOobeDismissed(true)}
        />
      ) : null}
    </div>
  )
}

function CreatorShell(): React.JSX.Element {
  const location = useLocation()
  const backgroundStyle = useAppBackground()
  return (
    <div className="app-shell flex h-full flex-col text-[var(--color-text)]">
      <AppTitlebar kind="creator" appName="MossStudio" appTag="studio" />
      <div className="flex min-h-0 flex-1">
        <CreatorSidebar />
        <main className="content-surface min-w-0 flex-1 overflow-y-auto" style={backgroundStyle}>
          <MotionPanel transitionKey={location.pathname} className="mx-auto w-full max-w-[1500px] px-5 py-4">
            <ErrorBoundary>
              <Routes>
                <Route path="/studio" element={<StudioPage />} />
                <Route path="/gallery" element={<GalleryPage />} />
                <Route path="*" element={<Navigate to="/studio" replace />} />
              </Routes>
            </ErrorBoundary>
          </MotionPanel>
        </main>
        <AgentSidebar />
      </div>
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

function TerminalShell(): React.JSX.Element {
  const backgroundStyle = useAppBackground()
  return (
    <div className="app-shell flex h-full flex-col text-[var(--color-text)]">
      <AppTitlebar kind="terminal" />
      <MotionPanel transitionKey="terminal" className="min-h-0 flex-1" style={backgroundStyle}>
        <ErrorBoundary>
          <TerminalPage />
        </ErrorBoundary>
      </MotionPanel>
    </div>
  )
}

function DevicesShell(): React.JSX.Element {
  const backgroundStyle = useAppBackground()
  return (
    <div className="app-shell flex h-full flex-col text-[var(--color-text)]">
      <AppTitlebar kind="devices" appName="MossStudio Devices" />
      <div className="min-h-0 flex-1 overflow-y-auto" style={backgroundStyle}>
        <MotionPanel transitionKey="devices" className="mx-auto w-full max-w-[1100px] px-6 py-5">
          <ErrorBoundary>
            <DevicesPage />
          </ErrorBoundary>
        </MotionPanel>
      </div>
    </div>
  )
}

export function App(): React.JSX.Element {
  const init = useApp((state) => state.init)
  const kind = window.clover.windowKind

  useEffect(() => {
    void init()
  }, [init])

  return (
    <ToastProvider>
      {kind === 'creator' ? (
        <HashRouter>
          <CreatorShell />
        </HashRouter>
      ) : kind === 'devices' ? (
        <DevicesShell />
      ) : kind === 'terminal' ? (
        <TerminalShell />
      ) : kind === 'trainer' ? (
        <TrainerShell />
      ) : (
        <HashRouter>
          <LauncherShell />
        </HashRouter>
      )}
    </ToastProvider>
  )
}
