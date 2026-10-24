import './styles.css'
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { Events, Ipc } from '../../apps/desktop/src/shared/channels'
import { schemas } from '../../apps/desktop/src/shared/schemas'
import type { InstanceInfo, ManagedHost, OnboardingStatus, PythonInstallState, Settings } from '../../apps/desktop/src/shared/types'
import { Field, Input, Modal, Select, Sheet, Spinner, Switch, Textarea, ToastProvider, useToast } from '../../apps/desktop/src/renderer/src/components/ui'
import { SettingsPage } from '../../apps/desktop/src/renderer/src/pages/Settings'
import { StudioPage } from '../../apps/desktop/src/renderer/src/pages/Studio'
import { useApp } from '../../apps/desktop/src/renderer/src/store'
import { Collapse, MotionPanel, Presence, useUiAnimationEnabled } from '../../apps/desktop/src/renderer/src/components/motion'
import { NotificationPanel } from '../../apps/desktop/src/renderer/src/components/NotificationPanel'
import { DevicesPage } from '../../apps/desktop/src/renderer/src/pages/Devices'
import { Oobe } from '../../apps/desktop/src/renderer/src/components/Oobe'
import { ModelsPage } from '../../apps/desktop/src/renderer/src/pages/Models'
import { EnginePage } from '../../apps/desktop/src/renderer/src/pages/Engine'

let fixtureHosts: ManagedHost[] = []
let failOobeSave = false
let oobeComplete = false
let oobeNeedsDevice = false
let oobePythonReady = true
let pythonInstallState: PythonInstallState | null = null
let pythonInstallAttempts = 0
let finishPythonInstall: (() => void) | null = null
const fixtureListeners = new Map<string, Set<(data: unknown) => void>>()
const oobeSteps = ['python', 'device', 'engine', 'model'] as const
function onboarding(hostId = 'local'): OnboardingStatus {
  return { hostId, bundleId: 'fixture-bundle', bundleName: 'MOSS-Image SFT', ready: oobeComplete && hostId === 'local' && oobePythonReady, checkedAt: '', steps: oobeSteps.map((id, index) => ({
    id, title: ['Python', '推理设备', 'MossInfer 引擎', '模型'][index],
    detail: [oobePythonReady ? '本机 Python 3.12.14' : '本机未找到 Python 3.10+，可安装内置 Python', 'NVIDIA GPU', '下载 MossInfer 引擎', 'MOSS-Image SFT · 0/4 个组件已就绪，需准备主模型、文本编码器、VAE 与配置'][index],
    status: (id === 'python' ? oobePythonReady : oobeComplete && hostId === 'local' || id === 'device' && !oobeNeedsDevice) ? 'ok' : 'missing',
    action: index === 0 ? 'install-python' : index === 1 ? 'devices' : index === 2 ? 'engines' : 'models',
    modelIds: id === 'model' ? ['dit', 'text', 'vae', 'support'] : undefined,
    sizeBytes: id === 'model' ? 27_199_050_000 : undefined,
  })) }
}

let savedSettings: Settings = {
  theme: 'system', uiAnimation: 'system', language: 'zh-CN', networkMode: 'auto', gitMirror: null,
  pipIndex: null, hfEndpoint: null, modelsRoot: null, pythonPath: null,
  autoCheckUpdates: false, desktopNotifications: false, updateChannel: 'stable',
  dismissedAnnouncements: [], dismissedUpdateVersion: null, sidebarCollapsed: false,
  onboardingState: 'dismissed', onboardingHostId: 'local',
  galleryRoots: [], homeBackground: null, trainerRoot: null, disabledDevices: [], deviceLabels: {},
}
window.clover = {
  platform: 'win32', version: '0.1.0', acrylic: false, windowKind: 'launcher', channel: 'dev',
  on: (channel, callback) => {
    const listeners = fixtureListeners.get(channel) ?? new Set()
    listeners.add(callback)
    fixtureListeners.set(channel, listeners)
    return () => { listeners.delete(callback) }
  },
  async invoke<T>(channel: string, payload?: unknown): Promise<T> {
    if (channel === Ipc.onboardingStatus) return { ok: true, data: onboarding((payload as { hostId?: string })?.hostId) } as T
    if (channel === Ipc.pythonInstallState) return { ok: true, data: pythonInstallState } as T
    if (channel === Ipc.pythonInstall) {
      pythonInstallAttempts++
      const publish = (state: PythonInstallState): void => {
        pythonInstallState = state
        fixtureListeners.get(Events.pythonInstall)?.forEach(listener => listener(state))
      }
      if (pythonInstallAttempts === 1) {
        publish({ phase: 'error', bytes: 0, totalBytes: 0, percent: 0, error: 'Fixture Python download failed' })
      } else {
        publish({ phase: 'downloading', bytes: 5, totalBytes: 10, percent: 50, version: '3.12.14' })
        await new Promise<void>(resolve => { finishPythonInstall = () => {
          oobePythonReady = true
          savedSettings = { ...savedSettings, pythonPath: '/fixture/managed/python' }
          useApp.setState({ settings: savedSettings })
          fixtureListeners.get(Events.settingsChanged)?.forEach(listener => listener(savedSettings))
          publish({ phase: 'done', bytes: 10, totalBytes: 10, percent: 100, version: '3.12.14', path: savedSettings.pythonPath! })
          finishPythonInstall = null
          resolve()
        } })
      }
      return { ok: true, data: pythonInstallState } as T
    }
    if (channel === Ipc.mossInferDownloadState) return { ok: true, data: null } as T
    if (channel === Ipc.engineStatus) return { ok: true, data: { available: false, path: null } } as T
    if (channel === Ipc.engineRemoteStatus) return { ok: true, data: { online: true, available: false, path: '/fixture/engine/bin/moss-server', root: '/fixture/engine', gpu: 'Fixture GPU', checkedAt: '' } } as T
    if (channel === Ipc.engineSystemCuda) return { ok: true, data: { supported: false, gpu: 'Fixture GPU', cublasLt: [], preferredFlavour: 'cu13', error: 'Fixture missing CUDA' } } as T
    if (channel === Ipc.modelsCatalog) return { ok: true, data: fixtureOobeCatalog } as T
    if (channel === Ipc.modelsRemoteInventory) return { ok: true, data: { root: '/fixture/models', files: 0, models: [], adapters: [] } } as T
    if (channel === Ipc.hostsList) return { ok: true, data: fixtureHosts } as T
    if (channel === Ipc.hostsSave) {
      const input = schemas.hostSave.parse(payload)
      document.getElementById('host-request')!.textContent = JSON.stringify(input)
      const { password, ...config } = input
      const host = { ...config, id: input.id ?? 'fixture-ssh', kind: 'ssh', status: 'unchecked', devices: [], hasPassword: input.authMethod === 'password' } as ManagedHost
      fixtureHosts = [...fixtureHosts.filter((item) => item.id !== host.id), host]
      return { ok: true, data: host } as T
    }
    if (channel === Ipc.hostsTest) return { ok: true, data: { ...fixtureHosts[0], status: 'ok' } } as T
    if (channel === Ipc.pickDialog) {
      document.getElementById('pick-request')!.textContent = JSON.stringify(schemas.pickDialog.parse(payload))
      return { ok: true, data: 'C:\\Users\\fixture\\.ssh\\key with spaces' } as T
    }
    if (channel === Ipc.settingsUpdate) {
      if (failOobeSave) { failOobeSave = false; return { ok: false, error: { code: 'E_WRITE', message: 'Fixture save failed' } } as T }
      savedSettings = { ...savedSettings, ...schemas.settingsUpdate.parse(payload) }
    }
    if (channel === Ipc.backendInfo) return { ok: true, data: { ready: true, url: 'http://studio-fixture', token: 'fixture' } } as T
    if (channel === Ipc.windowOpen) document.getElementById('window-request')!.textContent = JSON.stringify(schemas.windowOpen.parse(payload))
    const data = channel === Ipc.settingsUpdate ? savedSettings : channel === Ipc.appInfo || channel === Ipc.envScan ? null : []
    return { ok: true, data } as T
  },
}
window.addEventListener('mossstudio:window-intent', (event) => {
  document.getElementById('window-request')!.textContent = JSON.stringify((event as CustomEvent).detail)
})
useApp.setState({ settings: savedSettings, ready: true, notificationsOpen: false })

function ToastProbe(): React.JSX.Element {
  const toast = useToast()
  return <button id="push-toast" onClick={() => toast.push('Fixture toast')}>Toast</button>
}

const fixtureInstances = ['instance-a', 'instance-b'].map((id) => ({
  id, name: id, runtimeState: 'ready', placement: { kind: 'local' },
})) as InstanceInfo[]

const fixtureCatalog = {
  bundles: [{ id: 'fixture-bundle', name: 'Fixture MOSS', description: '', components: { dit: 'dit', textEncoder: 'text', vae: 'vae' }, support: 'support', recommended: true }],
  models: [], adapters: [], source: 'builtin', updatedAt: new Date().toISOString(),
}
const fixtureDevices = [{ id: 'cuda:0', name: 'Fixture GPU', kind: 'cuda', detail: 'CUDA', available: true }]
const fixtureOobeCatalog = { ...fixtureCatalog, models: ['dit', 'text', 'vae', 'support'].map((id, index) => ({
  id, name: ['MOSS-Image SFT', 'Qwen 文本编码器', 'VAE 解码器', 'Pipeline'][index], provider: 'hf', repo: 'fixture/moss', revision: 'main',
  role: ['dit', 'text_encoder', 'vae', 'support'][index], format: 'diffusers', precision: 'bf16', sizeBytes: 1000, license: 'Fixture', tags: [], installed: false, installedBytes: 0,
})) }

window.fetch = async (_url, init) => {
  document.getElementById('studio-job')!.textContent = String(init?.body)
  return new Response(JSON.stringify({ id: 'fixture-job' }), { status: 200 })
}

function Fixture(): React.JSX.Element {
  const navigate = useNavigate()
  const [modal, setModal] = useState(false)
  const [sheet, setSheet] = useState(false)
  const [value, setValue] = useState('a')
  const [checked, setChecked] = useState(false)
  const [view, setView] = useState('controls')
  const [flyout, setFlyout] = useState(false)
  const [collapsed, setCollapsed] = useState(true)
  const [exitCount, setExitCount] = useState(0)
  const [oobeKey, setOobeKey] = useState(0)
  const animate = useUiAnimationEnabled()
  const settings = useApp((state) => state.settings)
  return (
    <>
      <nav className="flex gap-2">
        <button id="view-controls" onClick={() => setView('controls')}>Controls</button>
        <button id="view-settings" onClick={() => setView('settings')}>Settings</button>
        <button id="view-devices" onClick={() => setView('devices')}>Devices</button>
        <button id="view-oobe" onClick={() => {
          oobeComplete = false
          oobeNeedsDevice = false
          oobePythonReady = true
          pythonInstallState = null
          pythonInstallAttempts = 0
          savedSettings = { ...savedSettings, onboardingState: 'pending', onboardingHostId: 'local', uiAnimation: 'on' }
          useApp.setState({ settings: savedSettings, catalog: fixtureOobeCatalog as never, devices: fixtureDevices as never })
          document.documentElement.dataset.uiAnimation = 'on'
          fixtureHosts = [{ id: 'fixture-remote', name: 'Linux GPU', kind: 'ssh', host: 'gpu.example.com', user: 'fixture', trainerRoot: '/fixture/trainer', devices: [], status: 'unchecked' } as ManagedHost]
          navigate('/studio')
          setOobeKey((value) => value + 1)
          setView('oobe')
        }}>OOBE</button>
        <button id="remount-oobe" onClick={() => setOobeKey((value) => value + 1)}>Reopen app</button>
        <button id="oobe-ready" onClick={() => {
          oobeComplete = true
          useApp.setState({ catalog: { ...fixtureCatalog } as never })
        }}>Ready</button>
        <button id="oobe-needs-device" onClick={() => {
          oobeNeedsDevice = true
          useApp.setState({ catalog: { ...fixtureOobeCatalog } as never })
          navigate('/devices')
        }}>Device setup</button>
        <button id="oobe-download" onClick={() => useApp.setState({ downloads: [{ id: 'test-download', kind: 'model', targetId: 'dit', state: 'running', bytes: 5, totalBytes: 10 } as never] })}>Download</button>
        <button id="oobe-needs-python" onClick={() => { oobePythonReady = false; setOobeKey(value => value + 1) }}>No Python</button>
        <button id="oobe-python-installed" onClick={() => finishPythonInstall?.()}>Python installed</button>
        <button id="oobe-fail-save" onClick={() => { failOobeSave = true }}>Fail save</button>
        <button id="view-studio" onClick={() => {
          useApp.setState({ studioPrompt: 'Fixture prompt', catalog: fixtureCatalog as never, devices: fixtureDevices as never })
          setView('studio')
        }}>Studio</button>
        <button id="load-instances" onClick={() => useApp.setState({ instances: [...fixtureInstances] })}>Load instances</button>
        <button id="remove-instance-b" onClick={() => useApp.setState({ instances: fixtureInstances.slice(0, 1) })}>Remove B</button>
        <button id="clear-instances" onClick={() => useApp.setState({ instances: [] })}>Clear instances</button>
        <button id="request-instance-b" onClick={() => navigate('/studio?instanceId=instance-b')}>Open B</button>
        <button id="load-devices" onClick={() => useApp.setState({ devices: [{ id: 'cpu', name: 'CPU', kind: 'cpu', detail: 'Fixture CPU', available: true }] })}>Load devices</button>
        <button id="toggle-sidebar" onClick={() => void useApp.getState().toggleSidebar()}>Sidebar</button>
      </nav>
      <output id="studio-job" hidden />
      <output id="host-request" hidden />
      <output id="pick-request" hidden />
      <output id="window-request" hidden />
      <output id="saved-settings" hidden>{JSON.stringify(settings)}</output>
      <output id="motion-enabled" hidden>{animate ? 'on' : 'off'}</output>
      {view === 'oobe' ? <ToastProvider><OobeProbe key={oobeKey} /></ToastProvider> : null}
      <MotionPanel transitionKey={view} data-testid="page-motion" className={view === 'oobe' ? 'hidden' : undefined}>
        {view === 'settings' ? <SettingsPage /> : view === 'devices' ? <ToastProvider><DevicesPage /></ToastProvider> : view === 'studio' ? <ToastProvider><StudioPage /></ToastProvider> : (
          <div style={{ transform: 'translateX(20px)', backdropFilter: 'blur(2px)', width: 400, overflow: 'hidden' }}>
            <input id="typography" className="text-[10.5px] font-mono leading-5" />
            <button id="button-typography" className="text-[11px] font-medium">Typography</button>
            <Field label="Shared input" hint="Field hint"><Input /></Field>
            <Switch aria-label="Shared switch" checked={checked} onCheckedChange={setChecked} />
            <Spinner className="motion-probe" />
            <button id="toggle-flyout" onClick={() => setFlyout((value) => !value)}>Flyout</button>
            <output id="exit-count">{exitCount}</output>
            <Presence id="flyout-demo" open={flyout} preset="flyout" onExited={() => setExitCount((value) => value + 1)}>
              {flyout ? 'Original content' : 'Cleared content'}
            </Presence>
            <button id="toggle-collapse" onClick={() => setCollapsed((value) => !value)}>Collapse</button>
            <Collapse id="collapse-demo" open={!collapsed}>
              <button id="collapse-child" className="h-16">Collapse content</button>
            </Collapse>
            <button id="open-modal" onClick={() => setModal(true)}>Open modal</button>
            <button id="outside">Outside</button>
            <Modal open={modal} onClose={() => setModal(false)} title={modal ? 'Modal' : 'Cleared modal'} description="Description">
              <input id="inside" aria-label="Inside" />
              <Field label="Shared select">
                <Select value={value} onValueChange={setValue} options={[
                  { value: 'a', label: 'First' }, { value: 'b', label: 'Second' },
                  { value: 'disabled', label: 'Disabled', disabled: true },
                ]} />
              </Field>
              <output id="selected-value">{value}</output>
              <Field label="Shared textarea"><Textarea /></Field>
              <button id="open-sheet" onClick={() => setSheet(true)}>Open sheet</button>
              <Sheet open={sheet} onClose={() => setSheet(false)} title="Sheet">
                <input id="sheet-input" aria-label="Sheet input" />
              </Sheet>
            </Modal>
          </div>
        )}
      </MotionPanel>
      {view === 'controls' ? <ToastProvider><ToastProbe /></ToastProvider> : null}
      <button id="toggle-notifications" onClick={() => useApp.getState().setNotificationsOpen(!useApp.getState().notificationsOpen)}>Notifications</button>
      <NotificationPanel />
    </>
  )
}

function OobeProbe(): React.JSX.Element {
  const location = useLocation()
  return <div className="app-shell flex h-[calc(100vh-48px)] flex-col bg-[#191b1f]">
    <header className="glass-thin flex h-11 shrink-0 items-center justify-between border-b border-white/10 px-5"><span className="text-[12px] font-semibold">MossStudio</span><Oobe /></header>
    <output id="oobe-route" hidden>{location.pathname}{location.search}</output>
    <div id="oobe-page-scroll" className="min-h-0 flex-1 overflow-y-auto p-6">{location.pathname === '/models' ? <ModelsPage /> : location.pathname === '/engines' ? <EnginePage /> : location.pathname === '/devices' ? <DevicesPage /> : <><h1 className="text-[22px] font-semibold">Studio</h1><p className="mt-2 text-[12px] text-[var(--color-text-secondary)]">准备好模型与引擎，开始你的第一次创作。</p></>}</div>
    <nav className="glass-thin flex h-9 shrink-0 items-center gap-10 border-t border-white/10 px-5 text-[10px] text-[var(--color-text-secondary)]">创作　引擎　模型　设备　训练　画廊　诊断　设置</nav>
  </div>
}

createRoot(document.getElementById('root')!).render(<StrictMode><MemoryRouter><Fixture /></MemoryRouter></StrictMode>)
