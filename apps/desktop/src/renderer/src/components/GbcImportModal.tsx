import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FolderOpen,
  GitBranch,
  ImagePlus,
  Layers,
  RefreshCw,
  ScanSearch,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Ipc } from '@shared/channels'
import type { AiProviderInfo } from '@shared/ai'
import type { GbcImageResult, GbcRunResult } from '@shared/gbc'
import type { BranchInfo, CommitInfo, GbcVersion } from '@shared/types'
import { call } from '../lib/api'
import { cloverUrl } from '../lib/clover'
import { Button, Field, Input, Modal, Select, Spinner, useToast } from './ui'

interface Props {
  open: boolean
  initialTab?: 'run' | 'manage'
  onClose: () => void
  onImport: (result: GbcRunResult, image?: GbcImageResult) => void
}

interface GbcStatusView {
  available: boolean
  error?: string
  checks?: Array<{ id: string; label: string; ok: boolean; detail: string }>
  version?: string
  python?: string
  venv?: string
}

export function GbcImportModal({ open, initialTab = 'run', onClose, onImport }: Props): React.JSX.Element {
  const toast = useToast()
  const [status, setStatus] = useState<GbcStatusView | null>(null)
  const [providers, setProviders] = useState<AiProviderInfo[]>([])
  const [providerId, setProviderId] = useState('')
  const [inputMode, setInputMode] = useState<'folder' | 'files'>('folder')
  const [folder, setFolder] = useState('')
  const [files, setFiles] = useState<string[]>([])
  const [detector, setDetector] = useState<'owlv2' | 'sam3'>('owlv2')
  const [sidecarJson, setSidecarJson] = useState(false)
  const [sidecarTxt, setSidecarTxt] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<GbcRunResult | null>(null)
  const [selectedKey, setSelectedKey] = useState('')
  const [envOutput, setEnvOutput] = useState('')
  const [tab, setTab] = useState<'run' | 'manage' | 'env'>('run')
  const [versions, setVersions] = useState<GbcVersion[]>([])
  const [versionId, setVersionId] = useState('')
  const [branches, setBranches] = useState<BranchInfo[]>([])
  const [commits, setCommits] = useState<CommitInfo[]>([])
  const [branch, setBranch] = useState('main')
  const [commit, setCommit] = useState('')
  const [manageBusy, setManageBusy] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setResult(null)
    setSelectedKey('')
    setTab(initialTab)
    void call<GbcVersion[]>(Ipc.gbcVersions)
      .then((list) => {
        setVersions(list)
        setVersionId((current) => current || list[0]?.id || '')
      })
      .catch(() => undefined)
    void call<AiProviderInfo[]>(Ipc.aiProvidersList)
      .then((list) => {
        const usable = list.filter((item) => item.hasKey && (item.kind === 'openai' || item.kind === 'anthropic'))
        setProviders(usable)
        setProviderId((current) => current || usable[0]?.id || '')
      })
      .catch(() => undefined)
  }, [open, initialTab])

  async function refreshStatus(): Promise<void> {
    try {
      const next = await call<GbcStatusView>(Ipc.gbcStatus, { versionId: versionId || undefined })
      setStatus(next)
    } catch {
      setStatus({ available: false, error: '无法检测 GBC 状态', checks: [] })
    }
  }

  useEffect(() => {
    if (!open || tab === 'manage') return
    void refreshStatus()
  }, [open, tab, versionId])

  async function installEnvironment(): Promise<void> {
    if (!versionId) return
    setManageBusy('env')
    setEnvOutput('')
    try {
      const next = await call<{ ok: boolean; output: string; status: GbcStatusView }>(Ipc.gbcInstallEnv, { versionId })
      setEnvOutput(next.output)
      setStatus(next.status)
      toast.push('GBC 环境安装完成', 'success')
    } catch (error) {
      toast.push(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setManageBusy(null)
    }
  }

  async function pickFolder(): Promise<void> {
    const path = await call<string | null>(Ipc.pickDialog, { kind: 'folder', title: '选择 GBC 图片目录' })
    if (path) {
      setFolder(path)
      setInputMode('folder')
    }
  }

  async function pickFiles(): Promise<void> {
    const paths = await call<string[]>(Ipc.pickImages, { title: '选择 GBC 图片（可多选）' })
    if (!paths.length) return
    setFiles((current) => [...new Set([...current, ...paths])])
    setInputMode('files')
  }

  async function runGbc(): Promise<void> {
    if (!providerId) {
      toast.push('先配置可用的 VLM Provider', 'error')
      return
    }
    if (inputMode === 'folder' && !folder.trim()) {
      toast.push('先选择图片目录', 'error')
      return
    }
    if (inputMode === 'files' && !files.length) {
      toast.push('先选择至少一张图片', 'error')
      return
    }
    setBusy(true)
    setResult(null)
    try {
      const next = await call<GbcRunResult>(Ipc.gbcRun, {
        ...(inputMode === 'folder' ? { folder: folder.trim() } : { files }),
        providerId,
        detector,
        versionId: versionId || undefined,
        sidecarJson,
        sidecarTxt,
      })
      setResult(next)
      setSelectedKey(next.images[0]?.key ?? '')
      toast.push(`GBC 完成：${next.images.length} 张图${next.sidecarFiles?.length ? `，写入 ${next.sidecarFiles.length} 个结果文件` : ''}`, 'success')
    } catch (error) {
      toast.push(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function pullBranches(): Promise<void> {
    setManageBusy('branches')
    try {
      const list = await call<BranchInfo[]>(Ipc.gbcBranches)
      setBranches(list)
      const name = list.find((item) => item.isDefault)?.name ?? list[0]?.name ?? 'main'
      setBranch(name)
      const rows = await call<CommitInfo[]>(Ipc.gbcCommits, { branch: name, limit: 80 })
      setCommits(rows)
      setCommit(rows[0]?.sha ?? '')
    } catch (error) {
      toast.push(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setManageBusy(null)
    }
  }

  async function loadCommits(name: string): Promise<void> {
    setBranch(name)
    setManageBusy('commits')
    try {
      const rows = await call<CommitInfo[]>(Ipc.gbcCommits, { branch: name, limit: 80 })
      setCommits(rows)
      setCommit(rows[0]?.sha ?? '')
    } catch (error) {
      toast.push(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setManageBusy(null)
    }
  }

  async function createVersion(): Promise<void> {
    if (!commit) return
    setManageBusy('create')
    try {
      const version = await call<GbcVersion>(Ipc.gbcVersionCreate, { branch, commit })
      const list = await call<GbcVersion[]>(Ipc.gbcVersions)
      setVersions(list)
      setVersionId(version.id)
      toast.push(`GBC 版本已创建：${version.name}`, 'success')
    } catch (error) {
      toast.push(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setManageBusy(null)
    }
  }

  async function removeVersion(version: GbcVersion): Promise<void> {
    if (!window.confirm(`删除 GBC 版本？\n${version.name}`)) return
    setManageBusy(version.id)
    try {
      await call(Ipc.gbcVersionRemove, { id: version.id })
      const list = await call<GbcVersion[]>(Ipc.gbcVersions)
      setVersions(list)
      if (versionId === version.id) setVersionId(list[0]?.id ?? '')
      toast.push('GBC 版本已删除', 'success')
    } catch (error) {
      toast.push(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setManageBusy(null)
    }
  }

  const selected = result?.images.find((image) => image.key === selectedKey) ?? result?.images[0] ?? null
  const selectedResult = result && selected
    ? { ...result, vertices: selected.vertices, summary: selected.summary }
    : null

  async function copyResult(): Promise<void> {
    if (!selected) return
    const text = JSON.stringify({ image: selected.path, key: selected.key, summary: selected.summary, graph: selected.graph }, null, 2)
    try {
      await navigator.clipboard.writeText(text)
      toast.push('已复制当前图片的 GBC 结果', 'success')
    } catch {
      toast.push('复制失败，请检查剪贴板权限', 'error')
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="GBC 图像解析"
      description="GBC 是执行层：解析图片为 bbox/描述图；结果先进入暂存区，再按需写入画布。"
      width="max-w-5xl"
      footer={
        tab !== 'run' ? (
          <Button tone="secondary" onClick={onClose}>关闭</Button>
        ) : result ? (
          <>
            <Button tone="ghost" onClick={onClose}>关闭</Button>
            <Button tone="secondary" onClick={() => void copyResult()}>复制当前结果</Button>
            <Button tone="primary" disabled={!selectedResult} onClick={() => { if (selectedResult) { onImport(selectedResult, selected ?? undefined); onClose() } }}>
              写入画布（{selected?.vertices.length ?? 0} 区域）
            </Button>
          </>
        ) : (
          <>
            <Button tone="ghost" onClick={onClose}>关闭</Button>
            <Button tone="primary" onClick={() => void runGbc()} disabled={busy || !status?.available}>
              {busy ? <Spinner className="size-3.5" /> : <ScanSearch className="size-3.5" />}
              {busy ? 'GBC 运行中…' : '开始解析'}
            </Button>
          </>
        )
      }
    >
      <div className="flex shrink-0 gap-1 border-b border-[var(--color-border-subtle)] px-4 pt-2">
        {([['run', '解析与结果'], ['manage', 'GBC 版本'], ['env', '环境检测']] as const).map(([key, label]) => (
          <button key={key} type="button" onClick={() => setTab(key)} className={`border-b-2 px-3 py-2 text-[11px] ${tab === key ? 'border-accent-400 text-[var(--color-text)]' : 'border-transparent text-[var(--color-text-tertiary)]'}`}>{label}</button>
        ))}
      </div>

      {tab === 'manage' ? (
        <div className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-border-subtle)] bg-white/[0.025] p-3">
            <div>
              <div className="flex items-center gap-1.5 text-[11.5px] font-medium"><GitBranch className="size-3.5" />KohakuGBC 版本仓库</div>
              <p className="mt-1 text-[9.5px] text-[var(--color-text-tertiary)]">内嵌 Git 克隆上游；按 commit 创建独立版本目录，不依赖系统 git。</p>
            </div>
            <Button tone="secondary" onClick={() => void pullBranches()} disabled={manageBusy !== null}>
              {manageBusy === 'branches' ? <Spinner className="size-3.5" /> : <RefreshCw className="size-3.5" />}拉取/更新
            </Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="分支"><Select value={branch} onChange={(event) => void loadCommits(event.target.value)}>{branches.length === 0 ? <option value="main">先拉取仓库</option> : null}{branches.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</Select></Field>
            <Field label="提交"><Select value={commit} onChange={(event) => setCommit(event.target.value)}>{commits.length === 0 ? <option value="">先拉取仓库</option> : null}{commits.map((item) => <option key={item.sha} value={item.sha}>{item.short} · {item.subject.slice(0, 42)}</option>)}</Select></Field>
          </div>
          <Button tone="primary" onClick={() => void createVersion()} disabled={!commit || manageBusy !== null}>{manageBusy === 'create' ? <Spinner className="size-3.5" /> : <Download className="size-3.5" />}创建版本</Button>
          <div className="space-y-1.5">
            {versions.map((version) => (
              <div key={version.id} className="flex items-center gap-2 rounded-lg border border-[var(--color-border-subtle)] px-3 py-2">
                <Layers className="size-3.5 shrink-0 text-accent-300" />
                <div className="min-w-0 flex-1"><div className="truncate text-[10.5px] font-medium">{version.name}</div><div className="truncate font-mono text-[8.5px] text-[var(--color-text-tertiary)]">{version.shortCommit} · {version.path}</div></div>
                <Button tone="ghost" onClick={() => { setVersionId(version.id); setTab('run') }}>用于解析</Button>
                <button type="button" className="text-[var(--color-text-tertiary)] hover:text-red-300" onClick={() => void removeVersion(version)} disabled={manageBusy !== null}><Trash2 className="size-3.5" /></button>
              </div>
            ))}
            {versions.length === 0 ? <p className="py-6 text-center text-[10px] text-[var(--color-text-tertiary)]">还没有 GBC 版本；先拉取上游并创建。</p> : null}
          </div>
        </div>
      ) : tab === 'env' ? (
        <div className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-border-subtle)] bg-white/[0.025] p-3">
            <div><div className="text-[11.5px] font-medium">GBC 运行环境</div><p className="mt-0.5 text-[9.5px] text-[var(--color-text-tertiary)]">逐项检查版本、gbc、Python、torch/transformers/kohakugbc 和 CUDA。</p></div>
            <Button tone="primary" onClick={() => void installEnvironment()} disabled={manageBusy !== null || !versionId}>{manageBusy === 'env' ? <Spinner className="size-3.5" /> : <Download className="size-3.5" />}安装/修复环境</Button>
          </div>
          {!versionId ? <p className="text-[10px] text-amber-300">先在“GBC 版本”里创建或选择一个版本。</p> : null}
          <div className="space-y-1.5">
            {(status?.checks ?? []).map((check) => (
              <div key={check.id} className="flex items-start gap-2 rounded border border-[var(--color-border-subtle)] px-2.5 py-2">
                {check.ok ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-400" /> : <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-400" />}
                <div className="min-w-0"><div className="text-[10px] font-medium">{check.label}</div><div className="mt-0.5 break-all font-mono text-[8.5px] text-[var(--color-text-tertiary)]">{check.detail}</div></div>
              </div>
            ))}
            {!status?.checks?.length ? <p className="py-4 text-center text-[10px] text-[var(--color-text-tertiary)]">正在检查环境…</p> : null}
          </div>
          {envOutput ? <pre className="max-h-48 overflow-auto rounded bg-black/30 p-2 font-mono text-[8.5px] text-[var(--color-text-secondary)]">{envOutput}</pre> : null}
        </div>
      ) : result ? (
        <div className="grid min-h-[420px] grid-cols-1 md:grid-cols-[230px_1fr]">
          <div className="border-b border-[var(--color-border-subtle)] md:border-b-0 md:border-r">
            <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] px-3 py-2 text-[10px] text-[var(--color-text-tertiary)]">
              <span>解析结果</span><span>{result.images.length} 张</span>
            </div>
            <div className="max-h-[430px] overflow-y-auto p-1.5">
              {result.images.map((image) => (
                <button key={image.key} type="button" onClick={() => setSelectedKey(image.key)} className={`mb-1 w-full rounded border px-2 py-2 text-left ${selected?.key === image.key ? 'border-accent-500/40 bg-accent-500/10' : 'border-transparent hover:bg-white/[0.04]'}`}>
                  <div className="truncate text-[10.5px] font-medium">{image.name}</div>
                  <div className="mt-0.5 text-[8.5px] text-[var(--color-text-tertiary)]">{image.vertices.length} 个区域 · {image.key}</div>
                </button>
              ))}
            </div>
          </div>
          <div className="min-w-0 p-3">
            {selected ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div><div className="text-[12px] font-medium">{selected.name}</div><div className="mt-0.5 break-all font-mono text-[8.5px] text-[var(--color-text-tertiary)]">{selected.path}</div></div>
                  <Button tone="ghost" onClick={() => setResult(null)}>重新解析</Button>
                </div>
                <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_220px]">
                  <div className="relative overflow-hidden rounded border border-[var(--color-border-subtle)] bg-black/25">
                    <img src={cloverUrl(selected.path)} alt={selected.name} className="block max-h-[300px] w-full object-contain" />
                    <div className="pointer-events-none absolute inset-0">
                      {selected.vertices.filter((vertex) => vertex.bbox).map((vertex, index) => {
                        const box = vertex.bbox!
                        return <div key={vertex.vertex_id ?? index} className="absolute border border-accent-300/80" style={{ left: `${box.left * 100}%`, top: `${box.top * 100}%`, width: `${(box.right - box.left) * 100}%`, height: `${(box.bottom - box.top) * 100}%` }} title={vertex.descs?.[0]?.text ?? vertex.label} />
                      })}
                    </div>
                  </div>
                  <div className="max-h-[300px] overflow-y-auto rounded border border-[var(--color-border-subtle)] p-2">
                    {selected.vertices.map((vertex, index) => (
                      <div key={vertex.vertex_id ?? index} className="border-b border-[var(--color-border-subtle)] py-1.5 last:border-0">
                        <div className="text-[9px] font-medium text-accent-300">{index + 1}. {vertex.label ?? 'object'}</div>
                        <div className="mt-0.5 text-[9px] leading-4 text-[var(--color-text-secondary)]">{vertex.descs?.[0]?.text ?? '无描述'}</div>
                      </div>
                    ))}
                  </div>
                </div>
                {selected.summary ? <p className="mt-2 line-clamp-3 text-[9.5px] leading-4 text-[var(--color-text-tertiary)]">{selected.summary}</p> : null}
              </>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="space-y-3 p-4">
          {!status?.available ? (
            <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2 text-[10.5px] leading-5 text-amber-200">
              {status?.error ?? '正在检查 gbc…'}
              <button type="button" className="ml-2 underline" onClick={() => setTab('env')}>去环境检测/安装</button>
            </div>
          ) : <div className="text-[9.5px] text-emerald-300">GBC 可用；首次运行可能下载 OWLv2/EmbeddingGemma 模型。</div>}

          <div className="flex gap-1">
            <button type="button" onClick={() => setInputMode('folder')} className={`rounded px-2.5 py-1 text-[10px] ${inputMode === 'folder' ? 'bg-accent-500/15 text-accent-200' : 'text-[var(--color-text-tertiary)]'}`}>图片目录</button>
            <button type="button" onClick={() => setInputMode('files')} className={`rounded px-2.5 py-1 text-[10px] ${inputMode === 'files' ? 'bg-accent-500/15 text-accent-200' : 'text-[var(--color-text-tertiary)]'}`}>单图 / 多图</button>
          </div>

          {inputMode === 'folder' ? (
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <Field label="图片目录"><Input value={folder} onChange={(event) => setFolder(event.target.value)} placeholder="/path/to/images" /></Field>
              <Button tone="secondary" className="mt-5" onClick={() => void pickFolder()}><FolderOpen className="size-3.5" /> 选择目录</Button>
            </div>
          ) : (
            <div className="rounded-lg border border-[var(--color-border-subtle)] p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-[var(--color-text-secondary)]">已选 {files.length} 张图片</span>
                <Button tone="secondary" onClick={() => void pickFiles()}><ImagePlus className="size-3.5" /> 添加图片</Button>
              </div>
              <div className="mt-2 max-h-32 space-y-1 overflow-y-auto">
                {files.map((path) => <div key={path} className="flex items-center gap-2 rounded bg-white/[0.03] px-2 py-1 text-[9px]"><span className="min-w-0 flex-1 truncate font-mono">{path}</span><button type="button" onClick={() => setFiles((current) => current.filter((item) => item !== path))}><X className="size-3" /></button></div>)}
                {files.length === 0 ? <p className="py-4 text-center text-[9.5px] text-[var(--color-text-tertiary)]">选择单张或批量图片</p> : null}
              </div>
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="GBC 版本"><Select value={versionId} onChange={(event) => setVersionId(event.target.value)}><option value="">外部 gbc / PATH</option>{versions.map((version) => <option key={version.id} value={version.id}>{version.name} · {version.shortCommit}</option>)}</Select></Field>
            <Field label="Detector"><Select value={detector} onChange={(event) => setDetector(event.target.value as 'owlv2' | 'sam3')}><option value="owlv2">OWLv2（默认）</option><option value="sam3">SAM 3（插图）</option></Select></Field>
            <Field label="VLM Provider"><Select value={providerId} onChange={(event) => setProviderId(event.target.value)}>{providers.length === 0 ? <option value="">先配置 OpenAI/Anthropic Provider</option> : null}{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name} · {provider.model}</option>)}</Select></Field>
          </div>

          <div className="rounded-lg border border-[var(--color-border-subtle)] p-2.5">
            <div className="text-[10px] font-medium">同目录输出</div>
            <div className="mt-1 flex flex-wrap gap-4 text-[9.5px] text-[var(--color-text-secondary)]">
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={sidecarJson} onChange={(event) => setSidecarJson(event.target.checked)} className="accent-[var(--color-accent)]" /> image.gbcout.json</label>
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={sidecarTxt} onChange={(event) => setSidecarTxt(event.target.checked)} className="accent-[var(--color-accent)]" /> image.gbcout.txt</label>
            </div>
            <p className="mt-1 text-[8.5px] text-[var(--color-text-tertiary)]">默认关闭；开启后在原图旁写出完整 graph / 可读摘要，不修改原图。</p>
          </div>

          <p className="text-[9px] text-[var(--color-text-tertiary)]">解析结果先进入结果暂存区，不会直接改动画布。可逐张查看、复制，再写入画布。</p>
        </div>
      )}
    </Modal>
  )
}
