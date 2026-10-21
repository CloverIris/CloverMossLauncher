import {
  ArrowDownToLine,
  Check,
  ChevronDown,
  Cpu,
  Download,
  FolderOpen,
  HardDrive,
  Layers,
  Package,
  Pause,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { Ipc } from '@shared/channels'
import type { AdapterEntry, DownloadTask, ModelEntry } from '@shared/types'
import { call } from '../lib/api'
import { percent } from '../lib/format'
import { useApp } from '../store'
import { MotionPanel } from '../components/motion'
import {
  Button,
  Card,
  EmptyState,
  IconButton,
  Modal,
  Pill,
  ProgressBar,
  Spinner,
  cn,
  useToast,
} from '../components/ui'

function bytes(value: number): string {
  if (value >= 1e9) return `${(value / 1e9).toFixed(2).replace(/\.?0+$/, '')} GB`
  if (value >= 1e6) return `${(value / 1e6).toFixed(1).replace(/\.0$/, '')} MB`
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)} KB`
  return `${value} B`
}

const labels: Record<DownloadTask['state'], string> = {
  queued: '等待下载',
  running: '下载中',
  verifying: '校验中',
  paused: '已暂停',
  canceled: '已取消',
  done: '已完成',
  error: '下载失败',
}
const categories = [
  { id: 'all', name: '全部', icon: Package },
  { id: 'dit', name: 'MOSS 模型', icon: Layers },
  { id: 'text_encoder', name: 'Qwen 编码器', icon: Cpu },
  { id: 'vae', name: 'VAE', icon: Package },
  { id: 'adapter', name: '适配器', icon: ShieldCheck },
] as const
type Entry = { kind: 'model'; value: ModelEntry } | { kind: 'adapter'; value: AdapterEntry }

export function ModelsPage(): React.JSX.Element {
  const catalog = useApp((s) => s.catalog)
  const downloads = useApp((s) => s.downloads)
  const instances = useApp((s) => s.instances)
  const refreshCatalog = useApp((s) => s.refreshCatalog)
  const downloadModel = useApp((s) => s.downloadModel)
  const downloadAdapter = useApp((s) => s.downloadAdapter)
  const pauseDownload = useApp((s) => s.pauseDownload)
  const cancelDownload = useApp((s) => s.cancelDownload)
  const deleteModel = useApp((s) => s.deleteModel)
  const toast = useToast()
  const [category, setCategory] = useState<string>('dit')
  const [format, setFormat] = useState('diffusers')
  const [installedOnly, setInstalledOnly] = useState(false)
  const [query, setQuery] = useState('')
  const [bundleId, setBundleId] = useState('moss-sft')
  const [pending, setPending] = useState<Entry | null>(null)
  const [removing, setRemoving] = useState<Entry | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const bundle = catalog?.bundles?.find((b) => b.id === bundleId) ?? catalog?.bundles?.[0]
  const bundleModels = bundle
    ? [...Object.values(bundle.components), bundle.support]
        .map((id) => catalog?.models.find((m) => m.id === id))
        .filter((m): m is ModelEntry => Boolean(m))
    : []
  const missing = bundleModels.filter((m) => !m.installed)
  const remaining = missing.reduce((n, model) => {
    const task = downloads.find((t) => t.kind === 'model' && t.targetId === model.id)
    return n + Math.max(0, (task?.totalBytes || model.sizeBytes) - (task?.bytes ?? 0))
  }, 0)
  const bundleTasks = downloads.filter((t) => missing.some((m) => m.id === t.targetId))
  const bundleRunning = bundleTasks.some((t) =>
    ['running', 'queued', 'verifying'].includes(t.state),
  )
  const active = downloads.filter((t) => t.state !== 'done')
  const list = useMemo((): Entry[] => {
    const entries: Entry[] =
      category === 'adapter'
        ? (catalog?.adapters ?? []).map((value) => ({ kind: 'adapter', value }))
        : (catalog?.models ?? [])
            .filter(
              (m) =>
                (category === 'all' ||
                  m.role === category ||
                  (category === 'dit' && m.role === 'full')) &&
                (format === 'all' || (m.format ?? 'diffusers') === format),
            )
            .map((value) => ({ kind: 'model', value }))
    const q = query.trim().toLowerCase()
    return entries.filter(
      ({ value }) =>
        (!installedOnly || value.installed) &&
        (!q ||
          `${value.name} ${value.repo} ${'precision' in value ? value.precision : ''}`
            .toLowerCase()
            .includes(q)),
    )
  }, [catalog, category, format, installedOnly, query])

  async function install(): Promise<void> {
    if (!bundle) return
    setBusy('bundle')
    try {
      await call(Ipc.modelBundleInstall, { id: bundle.id })
      await refreshCatalog()
      toast.push('缺失组件已加入下载队列', 'success')
    } catch (e) {
      toast.push(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusy(null)
    }
  }
  async function importFolder(): Promise<void> {
    setBusy('import')
    try {
      const result = await call<{
        canceled: boolean
        added: number
        duplicates: number
      }>(Ipc.modelsImportFolder)
      if (result.canceled) return
      await refreshCatalog()
      setCategory('all')
      setFormat('comfyui')
      setInstalledOnly(false)
      setQuery('')
      toast.push(
        result.added
          ? `已导入 ${result.added} 个模型文件，重复内容 ${result.duplicates} 个已跳过`
          : `所选目录中的 ${result.duplicates} 个文件已导入过`,
        'success',
      )
    } catch (e) {
      toast.push(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusy(null)
    }
  }
  async function start(entry: Entry): Promise<void> {
    setBusy(entry.value.id)
    try {
      if (entry.kind === 'model') await downloadModel(entry.value.id)
      else await downloadAdapter(entry.value.id)
      setPending(null)
    } catch (e) {
      toast.push(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusy(null)
    }
  }
  async function resume(task: DownloadTask): Promise<void> {
    if (task.kind === 'model') {
      const value = catalog?.models.find((m) => m.id === task.targetId)
      if (value) return start({ kind: 'model', value })
    } else {
      const value = catalog?.adapters.find((m) => m.id === task.targetId)
      if (value) return start({ kind: 'adapter', value })
    }
    toast.push('条目已不在当前目录中，请刷新模型库。', 'error')
  }
  async function cancel(task: DownloadTask): Promise<void> {
    try {
      await cancelDownload(task.id)
      toast.push('下载已取消；已写入的临时分片保留，可重新开始', 'info')
    } catch (e) {
      toast.push(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  async function remove(): Promise<void> {
    if (!removing) return
    setBusy('delete')
    try {
      await deleteModel(removing.kind, removing.value.id)
      setRemoving(null)
      toast.push('组件已移除，共享文件已保留', 'success')
    } catch (e) {
      toast.push(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusy(null)
    }
  }
  const users = removing
    ? instances.filter(
        (i) =>
          i.models.includes(removing.value.id) ||
          i.adapters.includes(removing.value.id) ||
          Object.values(i.modelBinding ?? {}).includes(removing.value.id),
      )
    : []

  return (
    <div className="model-management space-y-5 pb-4">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">模型库</h1>
          <p className="mt-1 text-[12px] text-[var(--color-text-secondary)]">
            按需下载，自由组合。编码器与 VAE 只需准备一次。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button tone="secondary" disabled={busy !== null} onClick={() => void importFolder()}>
            {busy === 'import' ? <Spinner className="size-3.5" /> : <FolderOpen className="size-3.5" />}
            导入本地模型
          </Button>
          <IconButton label="刷新模型库" onClick={() => void refreshCatalog()}>
            <RefreshCw className="size-4" />
          </IconButton>
        </div>
      </header>

      {bundle ? (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-4 px-5 pt-4">
            <div className="min-w-0">
              <div className="mb-2 flex items-center gap-2 text-[11px] text-[var(--color-text-secondary)]">
                <Layers className="size-3.5 text-accent-400" /> 推荐组合{' '}
                <span className="text-[var(--color-text-tertiary)]">· 本地 Diffusers / ComfyUI</span>
              </div>
              <select
                aria-label="推荐模型组合"
                value={bundle.id}
                onChange={(e) => setBundleId(e.target.value)}
                className="model-select !h-9 !text-[16px] !font-semibold !px-2.5"
              >
                {catalog?.bundles?.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[12px] leading-5 text-[var(--color-text-secondary)]">
                {bundle.description}
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <Button
                tone={missing.length ? 'primary' : 'secondary'}
                disabled={busy === 'bundle' || bundleRunning || !missing.length}
                onClick={() => void install()}
              >
                {busy === 'bundle' || bundleRunning ? (
                  <Spinner className="size-3.5" />
                ) : missing.length ? (
                  <ArrowDownToLine className="size-3.5" />
                ) : (
                  <Check className="size-3.5" />
                )}
                {bundleRunning ? '正在准备组件' : missing.length ? '补齐组件' : '组合已就绪'}
              </Button>
              <span className="text-[11px] tabular-nums text-[var(--color-text-tertiary)]">
                {missing.length ? `还需约 ${bytes(remaining)}` : '可在实例详情绑定使用'}
              </span>
            </div>
          </div>
          <div className="model-composition mx-5 my-4 grid grid-cols-1 divide-y divide-[var(--color-border-subtle)] rounded-[6px] border border-[var(--color-border-subtle)] md:grid-cols-3 md:divide-x md:divide-y-0">
            {(['dit', 'textEncoder', 'vae'] as const).map((key, i) => {
              const model = catalog?.models.find((m) => m.id === bundle.components[key])
              const task = downloads.find((t) => t.targetId === model?.id && t.kind === 'model')
              return (
                <div key={key} className="min-w-0 px-3.5 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] tracking-wide text-[var(--color-text-tertiary)]">
                      {['01 · 主模型', '02 · 文本编码器', '03 · VAE'][i]}
                    </span>
                    <span
                      className={cn(
                        'text-[10px]',
                        model?.installed ? 'text-accent-400' : 'text-[var(--color-text-secondary)]',
                      )}
                    >
                      {model?.installed
                        ? '已就绪'
                        : task && task.state !== 'done'
                          ? labels[task.state]
                          : '待下载'}
                    </span>
                  </div>
                  <div className="mt-2 truncate text-[12px] font-medium" title={model?.name}>
                    {model?.name}
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[11px] text-[var(--color-text-tertiary)]">
                    <span>
                      {model?.precision.toUpperCase()} {i > 0 ? '· 多组合共用' : '· 可独立更换'}
                    </span>
                    <span className="tabular-nums">{bytes(model?.sizeBytes ?? 0)}</span>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border-subtle)] px-5 py-2.5 text-[11px] text-[var(--color-text-tertiary)]">
            <span>
              已就绪 {bundleModels.filter((m) => m.installed).length} / {bundleModels.length}{' '}
              项，包含运行配置
            </span>
            <span>切换主模型时，复用已下载的编码器与 VAE</span>
          </div>
        </Card>
      ) : null}

      {active.length ? (
        <Card className="overflow-hidden">
          <details open>
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-[12px] font-medium">
              <span className="flex items-center gap-2">
                <Download className="size-3.5 text-accent-400" /> 下载队列{' '}
                <span className="text-[var(--color-text-tertiary)]">{active.length}</span>
              </span>
              <ChevronDown className="size-3.5" />
            </summary>
            <div className="max-h-[280px] divide-y divide-[var(--color-border-subtle)] overflow-y-auto border-t border-[var(--color-border-subtle)]">
              {active.map((task) => (
                <div key={task.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <span className="truncate text-[12px] font-medium">{task.label}</span>
                      <span
                        className={cn(
                          'text-[11px]',
                          task.state === 'error'
                            ? 'text-red-300'
                            : 'text-[var(--color-text-secondary)]',
                        )}
                      >
                        {labels[task.state]} · {bytes(task.bytes)} / {bytes(task.totalBytes)}
                      </span>
                    </div>
                    <ProgressBar value={percent(task.bytes, task.totalBytes)} className="mt-2" />
                    <p
                      className="mt-1.5 truncate text-[10px] text-[var(--color-text-tertiary)]"
                      title={task.error ?? task.currentFile}
                    >
                      {task.error ?? task.currentFile ?? '正在获取文件清单'}
                      {task.speedBps > 0 ? ` · ${bytes(task.speedBps)}/s` : ''}
                    </p>
                  </div>
                  {['running', 'queued', 'verifying'].includes(task.state) ? (
                    <IconButton
                      label={`暂停 ${task.label}`}
                      onClick={() => void pauseDownload(task.id)}
                    >
                      <Pause className="size-3.5" />
                    </IconButton>
                  ) : (
                    <IconButton
                      label={`继续 ${task.label}`}
                      disabled={busy === task.targetId}
                      onClick={() => void resume(task)}
                    >
                      <Play className="size-3.5" />
                    </IconButton>
                  )}
                  <IconButton label={`取消 ${task.label}`} onClick={() => void cancel(task)}>
                    <X className="size-3.5" />
                  </IconButton>
                </div>
              ))}
            </div>
          </details>
        </Card>
      ) : null}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <nav
            aria-label="组件分类"
            className="flex max-w-full gap-1 overflow-x-auto border-b border-[var(--color-border-subtle)]"
          >
            {categories.map(({ id, name, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setCategory(id)}
                className={cn(
                  'flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-[12px] transition-colors',
                  category === id
                    ? 'border-accent-400 text-[var(--color-text)]'
                    : 'border-transparent text-[var(--color-text-tertiary)] hover:text-[var(--color-text)]',
                )}
              >
                <Icon className="size-3.5" />
                {name}
              </button>
            ))}
          </nav>
          <label className="flex h-8 w-full items-center gap-2 rounded-[4px] border border-[var(--color-border-subtle)] bg-white/[0.025] px-2.5 sm:w-52">
            <Search className="size-3.5 shrink-0 text-[var(--color-text-tertiary)]" />
            <input
              aria-label="搜索组件"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索名称或来源"
              className="w-full min-w-0 bg-transparent text-[12px] outline-none"
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {category !== 'adapter' ? (
              <select
                aria-label="组件格式"
                value={format}
                onChange={(e) => setFormat(e.target.value)}
                className="model-select"
              >
                <option value="diffusers">Diffusers · 可本地运行</option>
                <option value="comfyui">ComfyUI · 仅下载</option>
                <option value="all">全部格式</option>
              </select>
            ) : null}
            <label className="flex items-center gap-1.5 text-[11px] text-[var(--color-text-secondary)]">
              <input
                type="checkbox"
                checked={installedOnly}
                onChange={(e) => setInstalledOnly(e.target.checked)}
                className="accent-[var(--color-accent-500)]"
              />
              仅已安装
            </label>
          </div>
          <span className="text-[11px] text-[var(--color-text-tertiary)]">
            {list.length} 个组件
          </span>
        </div>
        {format === 'comfyui' && category !== 'adapter' ? (
          <p className="text-[11px] leading-5 text-[var(--color-text-secondary)]">
            供 ComfyUI 使用；单文件和量化组件不能绑定到本地 Diffusers 运行时。
          </p>
        ) : null}
        <MotionPanel transitionKey={`${category}:${format}:${installedOnly}`}>
          {list.length ? (
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {list.map((entry) => {
                const model = entry.value
                const task = downloads.find((t) => t.kind === entry.kind && t.targetId === model.id)
                const working = task && ['queued', 'running', 'verifying'].includes(task.state)
                const component = entry.kind === 'model' ? entry.value : null
                return (
                  <Card key={model.id} className="flex min-w-0 flex-col p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate text-[13px] font-medium" title={model.name}>
                          {model.name}
                        </h3>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <Pill>
                            {component?.provider === 'local'
                              ? '本地引用'
                              : component?.format === 'comfyui'
                              ? 'ComfyUI'
                              : entry.kind === 'adapter'
                                ? entry.value.kind.toUpperCase()
                                : 'Diffusers'}
                          </Pill>
                          {component ? <Pill>{component.precision.toUpperCase()}</Pill> : null}
                          {component?.tags.includes('shared') ? (
                            <span className="text-[10px] text-[var(--color-text-tertiary)]">
                              共享组件
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <span
                        className={cn(
                          'shrink-0 text-[11px]',
                          model.installed ? 'text-accent-400' : 'text-[var(--color-text-tertiary)]',
                        )}
                      >
                        {model.installed
                          ? component?.provider === 'local'
                            ? '已引用'
                            : '已就绪'
                          : working
                            ? labels[task.state]
                            : component?.provider === 'local'
                              ? '源文件不可用'
                            : component?.installState === 'error'
                              ? '需修复'
                              : '未安装'}
                      </span>
                    </div>
                    <p className="mt-3 min-h-10 text-[12px] leading-5 text-[var(--color-text-secondary)]">
                      {model.notes ?? '独立下载并管理此组件。'}
                    </p>
                    <details className="my-2 text-[10px] text-[var(--color-text-tertiary)]">
                      <summary className="cursor-pointer">来源与文件</summary>
                      <p className="mt-1 break-all font-mono">{model.repo}</p>
                      <p className="break-all font-mono">
                        {component?.files?.join(' · ') ?? model.files?.join(' · ')}
                      </p>
                    </details>
                    <div className="mt-auto flex items-center justify-between border-t border-[var(--color-border-subtle)] pt-3">
                      <span className="text-[11px] tabular-nums text-[var(--color-text-tertiary)]">
                        {bytes(model.installed ? model.installedBytes : model.sizeBytes)}{' '}
                        <span className="ml-1.5">{model.license}</span>
                      </span>
                      <div className="flex items-center gap-1">
                        {model.installed ||
                        component?.installState === 'partial' ||
                        component?.installState === 'error' ? (
                          <IconButton label={`删除 ${model.name}`} onClick={() => setRemoving(entry)}>
                            <Trash2 className="size-3.5" />
                          </IconButton>
                        ) : null}
                        {!model.installed && component?.provider !== 'local' ? (
                          <Button
                            tone="secondary"
                            disabled={working || busy === model.id}
                            onClick={() => setPending(entry)}
                          >
                            {working ? (
                              <Spinner className="size-3.5" />
                            ) : (
                              <Download className="size-3.5" />
                            )}
                            {working
                              ? '准备中'
                              : component?.installState === 'error' ||
                                  component?.installState === 'partial'
                                ? '补齐 / 修复'
                                : '下载'}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </Card>
                )
              })}
            </div>
          ) : (
            <EmptyState
              icon={<Package className="size-6" />}
              title="没有匹配的组件"
              description="调整搜索词、格式或已安装筛选。"
              action={
                <Button
                  tone="secondary"
                  onClick={() => {
                    setQuery('')
                    setInstalledOnly(false)
                    setFormat('all')
                  }}
                >
                  清除筛选
                </Button>
              }
            />
          )}
        </MotionPanel>
      </section>

      <Modal
        open={Boolean(pending)}
        onClose={() => setPending(null)}
        title="下载组件"
        description={pending?.value.name}
        width="max-w-md"
        footer={
          <>
            <Button tone="ghost" onClick={() => setPending(null)}>
              取消
            </Button>
            <Button
              tone="primary"
              disabled={busy !== null}
              onClick={() => pending && void start(pending)}
            >
              {busy ? <Spinner className="size-3.5" /> : <Download className="size-3.5" />}开始下载
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-[12px] leading-5 text-[var(--color-text-secondary)]">
          <div className="flex justify-between">
            <span>组件大小</span>
            <span className="tabular-nums text-[var(--color-text)]">
              {bytes(pending?.value.sizeBytes ?? 0)}
            </span>
          </div>
          <p>已缓存的文件会复用；中断后可以继续，完整校验通过后才标记为可用。</p>
          {pending?.kind === 'model' && pending.value.format === 'comfyui' ? (
            <p className="text-amber-300">此文件供 ComfyUI 使用，不能作为 Diffusers 组件绑定。</p>
          ) : null}
        </div>
      </Modal>
      <Modal
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        title="移除本地组件"
        description={removing?.value.name}
        width="max-w-md"
        footer={
          <>
            <Button tone="ghost" onClick={() => setRemoving(null)}>
              取消
            </Button>
            <Button
              tone="danger"
              disabled={busy !== null || users.length > 0}
              onClick={() => void remove()}
            >
              移除组件
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-[12px] leading-5 text-[var(--color-text-secondary)]">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <HardDrive className="size-3.5" />
              {removing?.kind === 'model' && removing.value.provider === 'local'
                ? '外部文件引用'
                : '最多可释放'}
            </span>
            <span>
              {removing?.kind === 'model' && removing.value.provider === 'local'
                ? '原文件不会删除'
                : bytes(removing?.value.installedBytes ?? 0)}
            </span>
          </div>
          <p>
            {removing?.kind === 'model' && removing.value.provider === 'local'
              ? '移除只会取消模型库中的引用，不会删除或修改原始模型文件。'
              : '只清理此组件独占的受管文件；其他组件或外部缓存仍在使用的文件会保留，实际释放容量取决于共享引用。'}
          </p>
          {users.length ? (
            <p className="text-amber-300">
              正在被 {users.map((i) => i.name).join('、')} 使用，请先到实例详情解除绑定。
            </p>
          ) : null}
        </div>
      </Modal>
    </div>
  )
}
