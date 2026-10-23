import { Cpu, Download, HardDrive, RefreshCw, ShieldCheck, SquareTerminal, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Events, Ipc } from '@shared/channels'
import type { ManagedHost, MossInferDownloadState } from '@shared/types'
import { call, onEvent } from '../lib/api'
import { bytes, dateTime } from '../lib/format'
import { Button, Card, IconButton, Pill, Spinner, useToast } from '../components/ui'

interface LocalEngineInfo {
  available: boolean
  path: string | null
  version?: string
  error?: string
}

export function EnginePage(): React.JSX.Element {
  const toast = useToast()
  const [engine, setEngine] = useState<LocalEngineInfo | null>(null)
  const [download, setDownload] = useState<MossInferDownloadState | null>(null)
  const [probe, setProbe] = useState<Record<string, unknown> | null>(null)
  const [hosts, setHosts] = useState<ManagedHost[]>([])
  const [remote, setRemote] = useState<Record<string, { available: boolean; path: string; error?: string }>>({})
  const [busy, setBusy] = useState(false)
  const [preparing, setPreparing] = useState<string | null>(null)
  const [installingRemote, setInstallingRemote] = useState<string | null>(null)
  const [channel, setChannel] = useState<'stable' | 'dev'>('stable')
  const [variant, setVariant] = useState<'bundled' | 'system-cuda'>('bundled')

  const refresh = useCallback(async () => {
    try {
      const [next, current, hostList] = await Promise.all([
        call<LocalEngineInfo>(Ipc.engineStatus),
        call<MossInferDownloadState | null>(Ipc.mossInferDownloadState),
        call<ManagedHost[]>(Ipc.hostsList),
      ])
      setEngine(next)
      setDownload(current)
      setHosts(hostList.filter((host) => host.kind === 'ssh'))
    } catch (error) {
      toast.push(error instanceof Error ? error.message : String(error), 'error')
    }
  }, [toast])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => onEvent<MossInferDownloadState>(Events.mossInferDownload, setDownload), [])

  async function install(): Promise<void> {
    setBusy(true)
    try {
      const next = await call<MossInferDownloadState>(Ipc.mossInferDownload, { channel, variant })
      setDownload(next)
      await refresh()
    } catch (error) {
      toast.push(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function probeEngine(): Promise<void> {
    setBusy(true)
    try {
      const result = await call<Record<string, unknown>>(Ipc.engineProbe)
      setProbe(result)
      toast.push('引擎 hello 成功', 'success')
    } catch (error) {
      toast.push(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function prepareModel(hostId: string): Promise<void> {
    setPreparing(hostId)
    try {
      const result = await call<{ path: string; revision: string; files: number }>(Ipc.enginePrepareRemoteModel, { hostId })
      toast.push(`远端模型已准备：${result.files} 个文件`, 'success')
      await refresh()
    } catch (error) {
      toast.push(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setPreparing(null)
    }
  }

  async function installRemote(hostId: string): Promise<void> {
    setInstallingRemote(hostId)
    try {
      const result = await call<{ version: string; path: string; asset: string }>(Ipc.engineInstallRemote, { hostId })
      toast.push(`远端引擎 ${result.version} 已安装`, 'success')
      await refresh()
    } catch (error) {
      toast.push(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setInstallingRemote(null)
    }
  }

  async function checkRemote(hostId: string): Promise<void> {
    setBusy(true)
    try {
      const result = await call<{ available: boolean; path: string; error?: string }>(Ipc.engineRemoteStatus, { hostId })
      setRemote((previous) => ({ ...previous, [hostId]: result }))
      toast.push(result.available ? '远端引擎就绪' : '远端引擎缺失', result.available ? 'success' : 'info')
    } catch (error) {
      toast.push(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function installCuda(): Promise<void> {
    setBusy(true)
    try {
      const result = await call<{ installed: string[] }>(Ipc.mossInferCudaLibs)
      toast.push(`CUDA 库已安装：${result.installed.length} 个文件`, 'success')
      await refresh()
    } catch (error) {
      toast.push(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  const downloading = download && !['done', 'error'].includes(download.phase)

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">引擎</h1>
          <p className="mt-1 text-[12px] text-[var(--color-text-secondary)]">
            MossInfer sidecar 管理。推理算法在引擎里；MossStudio 只负责模型、任务和输出。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Pill tone={engine?.available ? 'accent' : 'amber'}>{engine?.available ? '本机引擎就绪' : '本机引擎缺失'}</Pill>
          <IconButton label="刷新" onClick={() => void refresh()} disabled={busy}><RefreshCw className="size-3.5" /></IconButton>
        </div>
      </header>

      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-accent-500/10 p-2 text-accent-300"><Cpu className="size-5" /></div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-[14px] font-semibold">本机 MossInfer</h2>
                <Pill tone={engine?.available ? 'accent' : 'red'}>{engine?.available ? 'ready' : 'missing'}</Pill>
              </div>
              <p className="mt-1 max-w-[720px] break-all font-mono text-[9.5px] text-[var(--color-text-tertiary)]">
                {engine?.path ?? engine?.error ?? '未检测到 moss-server'}
              </p>
              {engine?.version ? <p className="mt-1 text-[10px] text-[var(--color-text-secondary)]">{engine.version}</p> : null}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Button tone="secondary" onClick={() => void probeEngine()} disabled={busy || !engine?.available}>
              {busy ? <Spinner className="size-3.5" /> : <SquareTerminal className="size-3.5" />} 检测 hello
            </Button>
            <Button tone="ghost" onClick={() => void installCuda()} disabled={busy || !engine?.available}>
              <ShieldCheck className="size-3.5" /> 补 CUDA 库
            </Button>
          </div>
        </div>

        <div className="mt-4 grid gap-2 border-t border-[var(--color-border-subtle)] pt-3 sm:grid-cols-[1fr_1fr_auto]">
          <label className="space-y-1">
            <span className="text-[10px] text-[var(--color-text-tertiary)]">渠道</span>
            <select value={channel} onChange={(event) => setChannel(event.target.value as 'stable' | 'dev')} className="app-input w-full">
              <option value="stable">Stable Release</option>
              <option value="dev">Dev artifact（需要 GitHub token）</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[10px] text-[var(--color-text-tertiary)]">包类型</span>
            <select value={variant} onChange={(event) => setVariant(event.target.value as 'bundled' | 'system-cuda')} className="app-input w-full">
              <option value="bundled">bundled CUDA（推荐）</option>
              <option value="system-cuda">system CUDA</option>
            </select>
          </label>
          <Button tone="primary" className="self-end" onClick={() => void install()} disabled={busy || Boolean(downloading)}>
            <Download className="size-3.5" /> 下载/更新引擎
          </Button>
        </div>

        {download ? (
          <div className="mt-3 rounded-lg border border-[var(--color-border-subtle)] bg-white/[0.025] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-[10px]">
              <span className="font-medium">{download.phase} {download.version ? `· ${download.version}` : ''}</span>
              <span className="text-[var(--color-text-tertiary)]">
                {download.phase === 'downloading' ? `${bytes(download.bytes)} / ${bytes(download.totalBytes)} · ${bytes(download.speedBps)}/s` : download.updatedAt ? dateTime(download.updatedAt) : ''}
              </span>
              {downloading ? <button type="button" className="text-red-300" onClick={() => void call(Ipc.mossInferDownloadCancel)}><X className="size-3.5" /></button> : null}
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-accent-400 transition-all" style={{ width: `${download.phase === 'done' ? 100 : download.percent}%` }} />
            </div>
            {download.note ? <p className="mt-1 text-[9px] text-[var(--color-text-tertiary)]">{download.note}</p> : null}
            {download.error ? <p className="mt-1 text-[9px] text-red-300">{download.error}</p> : null}
          </div>
        ) : null}

        {probe ? (
          <pre className="mt-3 max-h-52 overflow-auto rounded-lg bg-black/25 p-3 font-mono text-[9px] leading-4 text-[var(--color-text-secondary)]">{JSON.stringify(probe, null, 2)}</pre>
        ) : null}
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-[14px] font-semibold">远端引擎</h2>
            <p className="mt-1 text-[10px] text-[var(--color-text-tertiary)]">Linux x86_64 + NVIDIA，SSH 启动同一 sidecar 协议。</p>
          </div>
          <Pill tone="amber">远端接入中</Pill>
        </div>
        <div className="mt-3 space-y-1.5">
          {hosts.length === 0 ? <p className="text-[10px] text-[var(--color-text-tertiary)]">还没有 SSH 主机。先在设备页添加 Linux NVIDIA 主机。</p> : null}
          {hosts.map((host) => {
            const status = remote[host.id]
            return (
              <div key={host.id} className="flex items-center justify-between gap-2 rounded border border-[var(--color-border-subtle)] px-2.5 py-2 text-[10px]">
                <div className="min-w-0">
                  <div className="flex items-center gap-2"><HardDrive className="size-3.5 text-[var(--color-text-tertiary)]" />{host.name}<span className="text-[var(--color-text-tertiary)]">{host.user}@{host.host}</span></div>
                  <p className="mt-0.5 truncate font-mono text-[8.5px] text-[var(--color-text-tertiary)]">{status?.path ?? host.engineRoot ?? '~/.mossstudio/engine/bin/moss-server'}{status?.error ? ` · ${status.error}` : ''}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {status ? <Pill tone={status.available ? 'accent' : 'red'}>{status.available ? 'ready' : 'missing'}</Pill> : null}
                  <Button tone="ghost" onClick={() => void checkRemote(host.id)} disabled={busy}>检测</Button>
                  <Button tone="ghost" onClick={() => void installRemote(host.id)} disabled={busy || installingRemote !== null}>{installingRemote === host.id ? <Spinner className="size-3" /> : '安装引擎'}</Button>
                  <Button tone="ghost" onClick={() => void prepareModel(host.id)} disabled={busy || preparing !== null}>{preparing === host.id ? <Spinner className="size-3" /> : '准备模型'}</Button>
                </div>
              </div>
            )
          })}
        </div>
      </Card>
    </div>
  )
}
