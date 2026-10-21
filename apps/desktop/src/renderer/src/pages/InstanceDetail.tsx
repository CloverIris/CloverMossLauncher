import { ArrowLeft, FolderOpen, GitBranch, Package, RefreshCw, ShieldCheck, Terminal, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Ipc } from '@shared/channels'
import type { CommitInfo, RuntimeInfo } from '@shared/types'
import { call } from '../lib/api'
import { ModelBindingEditor } from '../components/ModelBindingEditor'
import { dateTime, relative } from '../lib/format'
import { useApp } from '../store'
import { Button, Card, EmptyState, Input, Pill, Select, Spinner, StatusDot, useToast } from '../components/ui'

const EMPTY_LOGS: string[] = []

export function InstanceDetailPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const toast = useToast()
  const instance = useApp((state) => state.instances.find((item) => item.id === id))
  const logs = useApp((state) => (id ? state.runtimeLogs[id] ?? EMPTY_LOGS : EMPTY_LOGS))
  const refreshInstances = useApp((state) => state.refreshInstances)
  const catalog = useApp((state) => state.catalog)
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null)
  const [busy, setBusy] = useState<'install' | 'isolate' | 'update' | null>(null)
  const [commits, setCommits] = useState<CommitInfo[]>([])
  const [targetCommit, setTargetCommit] = useState('')
  const [commitError, setCommitError] = useState('')
  const [bindings, setBindings] = useState<Array<{ id: string; enabled: boolean; strength: number }>>([])
  const logRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    if (!instance) void refreshInstances()
  }, [instance, refreshInstances])

  useEffect(() => {
    if (!id) return
    void call<RuntimeInfo | null>(Ipc.runtimeState, { id })
      .then(setRuntime)
      .catch(() => setRuntime(null))
  }, [id, instance?.runtimeState])

  useEffect(() => {
    if (!instance) return
    setBindings(
      instance.adapterBindings?.length
        ? instance.adapterBindings
        : instance.adapters.map((adapterId) => ({ id: adapterId, enabled: true, strength: 1 })),
    )
  }, [instance?.id, instance?.adapterBindings, instance?.adapters])

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logs])

  useEffect(() => {
    if (!instance) return
    const placement = instance.placement
    const request =
      placement.kind === 'ssh'
        ? call<CommitInfo[]>(Ipc.instanceRemoteCommits, {
            hostId: placement.hostId,
            branch: instance.branch,
            limit: 80,
            source: instance.source,
          })
        : call<CommitInfo[]>(Ipc.gitCommits, {
            branch: instance.branch,
            limit: 80,
            source: instance.source,
          })
    void request
      .then((rows) => {
        setCommitError('')
        setCommits(rows)
        setTargetCommit((current) => current || instance.commit)
      })
      .catch((error) => {
        setCommitError(error instanceof Error ? error.message : String(error))
        setCommits([])
      })
  }, [instance?.branch, instance?.commit, instance])

  if (!instance) {
    return (
      <EmptyState
        icon={<Package className="size-7" />}
        title="实例不存在"
        description="它可能已被删除，或者还在加载。"
        action={
          <Button tone="secondary" onClick={() => void refreshInstances()}>
            <RefreshCw className="size-3.5" /> 重新加载
          </Button>
        }
      />
    )
  }

  async function install(): Promise<void> {
    if (!id) return
    setBusy('install')
    try {
      await call(Ipc.runtimeInstall, { instanceId: id })
      await refreshInstances()
      toast.push('依赖安装完成', 'success')
    } catch (error) {
      toast.push(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(null)
    }
  }

  async function isolate(): Promise<void> {
    if (!id) return
    setBusy('isolate')
    try {
      const result = await call<RuntimeInfo>(Ipc.runtimeIsolate, { id })
      setRuntime(result)
      await refreshInstances()
      toast.push('已转为独立运行时，接下来需要安装依赖', 'success')
    } catch (error) {
      toast.push(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(null)
    }
  }

  async function updateVersion(): Promise<void> {
    if (!id || !targetCommit || targetCommit === instance?.commit) return
    setBusy('update')
    try {
      await call(Ipc.instanceUpdate, { id, commit: targetCommit })
      await refreshInstances()
      toast.push('版本 pin 已更新', 'success')
    } catch (error) {
      toast.push(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(null)
    }
  }

  async function saveBindings(): Promise<void> {
    if (!id) return
    setBusy('update')
    try {
      await call(Ipc.instanceAdapters, { id, bindings })
      await refreshInstances()
      toast.push('适配器绑定已保存', 'success')
    } catch (error) {
      toast.push(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(null)
    }
  }

  async function remove(): Promise<void> {
    if (!id) return
    try {
      await call(Ipc.instanceDelete, { id, keepOutputs: true })
      await refreshInstances()
      navigate('/instances')
      toast.push('实例已删除', 'success')
    } catch (error) {
      toast.push(error instanceof Error ? error.message : String(error), 'error')
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => navigate('/instances')}
          className="inline-flex items-center gap-1.5 text-[12px] text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
        >
          <ArrowLeft className="size-3.5" /> 实例
        </button>
        <div className="flex items-center gap-1.5">
          {instance.placement.kind === 'local' ? (
            <Button tone="ghost" onClick={() => void call(Ipc.instanceOpen, { id: instance.id })}>
              <span className="inline-flex items-center gap-1.5">
                <FolderOpen className="size-3.5" /> 打开目录
              </span>
            </Button>
          ) : null}
          <Button tone="ghost" onClick={() => void remove()}>
            <span className="inline-flex items-center gap-1.5 text-red-500">
              <Trash2 className="size-3.5" /> 删除
            </span>
          </Button>
        </div>
      </div>

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[22px] font-semibold tracking-tight">{instance.name}</h1>
            {instance.channel === 'stable' ? <Pill tone="accent">稳定版</Pill> : null}
            {instance.channel === 'experimental' ? <Pill tone="amber">实验</Pill> : null}
            {instance.channel === 'custom' ? <Pill tone="blue">自定义</Pill> : null}
            {instance.placement.kind === 'ssh' ? (
              <Pill tone="blue">远端 · {instance.placement.hostName ?? instance.placement.hostId}</Pill>
            ) : null}
            {instance.dirty ? <Pill tone="amber">有本地改动</Pill> : null}
          </div>
          <p className="mt-1 text-[12px] text-[var(--color-text-tertiary)]">
            {instance.branch} · <span className="font-mono">{instance.shortCommit}</span> · {dateTime(instance.commitDate)}
          </p>
        </div>
        <div className="flex items-center gap-2 text-[11.5px] text-[var(--color-text-secondary)]">
          <StatusDot status={instance.status === 'ok' ? 'ok' : instance.status === 'missing' ? 'error' : 'warn'} />
          {instance.status === 'ok' ? '代码完整' : instance.status === 'missing' ? '代码目录缺失' : '运行时缺失'}
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="px-5 py-4">
          <h2 className="text-[13px] font-semibold">版本</h2>
          <dl className="mt-3 space-y-2 text-[11.5px]">
            {[
              ['分支', instance.branch],
              ['提交', instance.commit],
              ['时间', dateTime(instance.commitDate)],
              ['作者', instance.author || '—'],
              ['来源', instance.source],
              ['位置', instance.placement.kind === 'ssh' ? `${instance.placement.hostName ?? instance.placement.hostId} · ${instance.placement.root}` : '本机'],
              ['创建于', relative(instance.createdAt)],
            ].map(([label, value]) => (
              <div key={label} className="flex items-start justify-between gap-4">
                <dt className="shrink-0 text-[var(--color-text-tertiary)]">{label}</dt>
                <dd className="min-w-0 truncate text-right font-mono text-[11px]" title={value}>{value}</dd>
              </div>
            ))}
          </dl>
          {instance.subject ? (
            <p className="mt-3 rounded-lg bg-[var(--color-surface-secondary)] px-3 py-2 text-[11.5px] leading-5 text-[var(--color-text-secondary)]">
              {instance.subject}
            </p>
          ) : null}
          <div className="mt-3 border-t border-[var(--color-border-subtle)] pt-3">
            <div className="flex items-center gap-1.5 text-[10.5px] text-[var(--color-text-tertiary)]">
              <GitBranch className="size-3" /> 切换 pin / 回滚
            </div>
            <div className="mt-1.5 flex items-center gap-1.5">
              <Select
                value={targetCommit}
                onChange={(event) => setTargetCommit(event.target.value)}
                className="min-w-0 flex-1"
              >
                {commits.length === 0 ? <option value={instance.commit}>{instance.shortCommit}（当前）</option> : null}
                {commits.map((item) => (
                  <option key={item.sha} value={item.sha}>
                    {item.short} · {item.subject.slice(0, 52)}
                  </option>
                ))}
              </Select>
              <Button
                tone="secondary"
                size="sm"
                disabled={
                  busy !== null ||
                  !targetCommit ||
                  targetCommit === instance.commit ||
                  instance.dirty
                }
                onClick={() => void updateVersion()}
              >
                {busy === 'update' ? <Spinner className="size-3" /> : '切换'}
              </Button>
            </div>
            {commitError ? (
              <p className="mt-1.5 text-[9.5px] leading-4 text-red-300">读取提交失败：{commitError}</p>
            ) : null}
            {instance.dirty ? (
              <p className="mt-1.5 text-[9.5px] text-amber-300/80">实例有本地修改，先清理或提交后再切换 pin。</p>
            ) : instance.placement.kind === 'ssh' ? (
              <p className="mt-1.5 text-[9.5px] text-[var(--color-text-tertiary)]">
                远端切换只移动 worktree commit；如果依赖变化，需要重新安装远端依赖。
              </p>
            ) : (
              <p className="mt-1.5 text-[9.5px] text-[var(--color-text-tertiary)]">切换只移动 commit pin，不重新下载权重；可随时切回列表中的任意提交。</p>
            )}
          </div>
        </Card>

        <Card className="px-5 py-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[13px] font-semibold">运行时</h2>
            <Pill tone={runtime?.state === 'ready' ? 'accent' : runtime?.state === 'error' ? 'red' : 'amber'}>
              {runtime?.state === 'ready'
                ? '就绪'
                : runtime?.state === 'error'
                  ? '异常'
                  : runtime?.state === 'installing'
                    ? '安装中'
                    : '待安装'}
            </Pill>
          </div>
          {runtime ? (
            <dl className="mt-3 space-y-2 text-[11.5px]">
              <div className="flex justify-between gap-4">
                <dt className="text-[var(--color-text-tertiary)]">Python</dt>
                <dd className="font-mono">{runtime.pythonVersion}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-[var(--color-text-tertiary)]">模式</dt>
                <dd>{runtime.kind === 'shared' ? '共享' : runtime.remote ? '独立 · 远端' : '独立'}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-[var(--color-text-tertiary)]">依赖</dt>
                <dd>{runtime.deps.length} 个</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-[var(--color-text-tertiary)]">锁</dt>
                <dd className="font-mono">{runtime.lockHash.slice(0, 10)}</dd>
              </div>
            </dl>
          ) : (
            <p className="mt-3 text-[11.5px] text-[var(--color-text-tertiary)]">运行时记录缺失，可重建实例。</p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button tone="primary" size="sm" disabled={busy !== null} onClick={() => void install()}>
              {busy === 'install' ? <Spinner className="size-3.5" /> : runtime?.state === 'ready' ? '重新安装依赖' : '安装依赖'}
            </Button>
            {runtime?.kind === 'shared' && instance.placement.kind === 'local' ? (
              <Button tone="secondary" size="sm" disabled={busy !== null} onClick={() => void isolate()}>
                {busy === 'isolate' ? <Spinner className="size-3.5" /> : '转为独立'}
              </Button>
            ) : null}
          </div>
          <p className="mt-2 text-[10.5px] leading-4 text-[var(--color-text-tertiary)]">
            依赖安装会下载 torch / diffusers / transformers，macOS 约 1–2 GB，CUDA 环境更大。
          </p>
        </Card>
      </div>

      <Card className="model-binding-panel px-5 py-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[13px] font-semibold">模型与适配器</h2>
          <Button tone="ghost" onClick={() => navigate('/models')}>
            管理模型
          </Button>
        </div>
        <ModelBindingEditor instance={instance} />
        <div className="mt-3 border-t border-[var(--color-border-subtle)] pt-3">
          <div className="flex items-center justify-between">
            <span className="text-[10.5px] text-[var(--color-text-tertiary)]">适配器启用与强度（记录到实例）</span>
            <Button tone="secondary" size="sm" onClick={() => void saveBindings()} disabled={busy !== null}>
              {busy === 'update' ? <Spinner className="size-3" /> : '保存绑定'}
            </Button>
          </div>
          {(catalog?.adapters ?? []).filter((adapter) => adapter.installed).length === 0 ? (
            <p className="mt-2 text-[10.5px] text-[var(--color-text-tertiary)]">还没有已安装的适配器；先到模型页下载或由训练产物登记。</p>
          ) : (
            <div className="mt-2 space-y-1.5">
              {(catalog?.adapters ?? []).filter((adapter) => adapter.installed).map((adapter) => {
                const binding = bindings.find((item) => item.id === adapter.id)
                const enabled = binding?.enabled ?? false
                return (
                  <div key={adapter.id} className="flex items-center gap-2 rounded-[5px] border border-[var(--color-border-subtle)] px-2.5 py-1.5">
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(event) => {
                        const next = bindings.filter((item) => item.id !== adapter.id)
                        setBindings([...next, { id: adapter.id, enabled: event.target.checked, strength: binding?.strength ?? 1 }])
                      }}
                      className="size-3 accent-[var(--color-accent)]"
                    />
                    <span className="min-w-0 flex-1 truncate text-[10.5px]">{adapter.name}</span>
                    <span className="text-[9px] text-[var(--color-text-tertiary)]">{adapter.kind}</span>
                    <Input
                      type="number"
                      min={0}
                      max={4}
                      step={0.05}
                      value={binding?.strength ?? 1}
                      disabled={!enabled}
                      onChange={(event) => {
                        const strength = Number(event.target.value)
                        const next = bindings.filter((item) => item.id !== adapter.id)
                        setBindings([...next, { id: adapter.id, enabled, strength: Number.isFinite(strength) ? strength : 1 }])
                      }}
                      className="h-6 w-14 text-right disabled:opacity-40"
                    />
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] px-4 py-2.5">
          <div className="flex items-center gap-2 text-[12.5px] font-medium">
            <Terminal className="size-3.5" /> 运行时输出
          </div>
          <span className="text-[10.5px] text-[var(--color-text-tertiary)]">{logs.length} 行</span>
        </div>
        <pre
          ref={logRef}
          className="h-48 overflow-y-auto bg-[var(--color-surface-secondary)] px-4 py-3 font-mono text-[10.5px] leading-5 text-[var(--color-text-secondary)]"
        >
          {logs.length ? logs.join('\n') : '尚无输出。安装依赖或启动实例后，日志会出现在这里。'}
        </pre>
      </Card>

      <div className="flex items-center gap-2 text-[10.5px] text-[var(--color-text-tertiary)]">
        <ShieldCheck className="size-3.5" />
        实例固定到 commit；回滚只需切换 pin，不重新下载权重。
      </div>
    </div>
  )
}
