import './styles.css'
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { Ipc } from '../../apps/desktop/src/shared/channels'
import { schemas } from '../../apps/desktop/src/shared/schemas'
import type { InstanceInfo, ManagedHost, Settings } from '../../apps/desktop/src/shared/types'
import { Field, Input, Modal, Select, Sheet, Spinner, Switch, Textarea, ToastProvider, useToast } from '../../apps/desktop/src/renderer/src/components/ui'
import { SettingsPage } from '../../apps/desktop/src/renderer/src/pages/Settings'
import { HomePage } from '../../apps/desktop/src/renderer/src/pages/Home'
import { StudioPage } from '../../apps/desktop/src/renderer/src/pages/Studio'
import { useApp } from '../../apps/desktop/src/renderer/src/store'
import { Collapse, MotionPanel, Presence, useUiAnimationEnabled } from '../../apps/desktop/src/renderer/src/components/motion'
import { NotificationPanel } from '../../apps/desktop/src/renderer/src/components/NotificationPanel'
import { DevicesPage } from '../../apps/desktop/src/renderer/src/pages/Devices'

let fixtureHosts: ManagedHost[] = []

let savedSettings: Settings = {
  theme: 'system', uiAnimation: 'system', language: 'zh-CN', networkMode: 'auto', gitMirror: null,
  pipIndex: null, hfEndpoint: null, modelsRoot: null, pythonPath: null,
  autoCheckUpdates: false, desktopNotifications: false, updateChannel: 'stable',
  dismissedAnnouncements: [], dismissedUpdateVersion: null, sidebarCollapsed: false,
  galleryRoots: [], homeBackground: null, trainerRoot: null, disabledDevices: [], deviceLabels: {},
}
window.clover = {
  platform: 'win32', version: '0.1.0', acrylic: false, windowKind: 'launcher', channel: 'dev',
  on: () => () => undefined,
  async invoke<T>(channel: string, payload?: unknown): Promise<T> {
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
    if (channel === Ipc.settingsUpdate) savedSettings = { ...savedSettings, ...payload as Partial<Settings> }
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
  const animate = useUiAnimationEnabled()
  const settings = useApp((state) => state.settings)
  return (
    <>
      <nav className="flex gap-2">
        <button id="view-controls" onClick={() => setView('controls')}>Controls</button>
        <button id="view-settings" onClick={() => setView('settings')}>Settings</button>
        <button id="view-home" onClick={() => setView('home')}>Home</button>
        <button id="view-devices" onClick={() => setView('devices')}>Devices</button>
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
      <MotionPanel transitionKey={view} data-testid="page-motion">
        {view === 'settings' ? <SettingsPage /> : view === 'home' ? <HomePage /> : view === 'devices' ? <ToastProvider><DevicesPage /></ToastProvider> : view === 'studio' ? <ToastProvider><StudioPage /></ToastProvider> : (
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

createRoot(document.getElementById('root')!).render(<StrictMode><MemoryRouter><Fixture /></MemoryRouter></StrictMode>)
