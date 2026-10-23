import { AlertTriangle, CheckCircle2, Download, FolderOpen, GitBranch, Layers, RefreshCw, ScanSearch, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Ipc } from '@shared/channels'
import type { AiProviderInfo } from '@shared/ai'
import type { GbcRunResult } from '@shared/gbc'
import type { BranchInfo, CommitInfo, GbcVersion } from '@shared/types'
import { call } from '../lib/api'
import { Button, Field, Input, Modal, Select, Spinner, useToast } from './ui'

interface Props {
  open: boolean
  initialTab?: 'run' | 'manage'
  onClose: () => void
  onImport: (result: GbcRunResult) => void
}

export function GbcImportModal({ open, initialTab = 'run', onClose, onImport }: Props): React.JSX.Element {
  const toast = useToast()
  const [status, setStatus] = useState<{ available: boolean; error?: string; checks?: Array<{ id: string; label: string; ok: boolean; detail: string }>; version?: string; python?: string; venv?: string } | null>(null)
  const [providers, setProviders] = useState<AiProviderInfo[]>([])
  const [providerId, setProviderId] = useState('')
  const [folder, setFolder] = useState('')
  const [detector, setDetector] = useState<'owlv2' | 'sam3'>('owlv2')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<GbcRunResult | null>(null)
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
    setTab(initialTab)
    void call<GbcVersion[]>(Ipc.gbcVersions).then((list) => { setVersions(list); setVersionId((current) => current || list[0]?.id || '') }).catch(() => undefined)
    void call<AiProviderInfo[]>(Ipc.aiProvidersList).then((list) => {
      const usable = list.filter((item) => item.hasKey && (item.kind === 'openai' || item.kind === 'anthropic'))
      setProviders(usable)
      setProviderId((current) => current || usable[0]?.id || '')
    }).catch(() => undefined)
  }, [open, initialTab])

  async function refreshStatus(): Promise<void> {
    try {
      const next = await call<typeof status>(Ipc.gbcStatus, { versionId: versionId || undefined })
      setStatus(next)
    } catch { setStatus({ available: false, error: '无法检测 GBC 状态', checks: [] }) }
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
      const result = await call<{ ok: boolean; output: string; status: typeof status }>(Ipc.gbcInstallEnv, { versionId })
      setEnvOutput(result.output)
      setStatus(result.status)
      toast.push('GBC 环境安装完成', 'success')
    } catch (error) { toast.push(error instanceof Error ? error.message : String(error), 'error') } finally { setManageBusy(null) }
  }

  async function pickFolder(): Promise<void> {
    const path = await call<string | null>(Ipc.pickDialog, { kind: 'folder', title: '选择 GBC 图片目录' })
    if (path) setFolder(path)
  }

  async function runGbc(): Promise<void> {
    if (!folder.trim() || !providerId) {
      toast.push('先选择图片目录和可用的 VLM Provider', 'error')
      return
    }
    setBusy(true)
    setResult(null)
    try {
      const next = await call<GbcRunResult>(Ipc.gbcRun, { folder: folder.trim(), providerId, detector, versionId: versionId || undefined })
      setResult(next)
      toast.push(`GBC 完成：${next.graphCount} 张图，${next.vertices.length} 个区域`, 'success')
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
    } catch (error) { toast.push(error instanceof Error ? error.message : String(error), 'error') } finally { setManageBusy(null) }
  }
  async function loadCommits(name: string): Promise<void> {
    setBranch(name)
    setManageBusy('commits')
    try {
      const rows = await call<CommitInfo[]>(Ipc.gbcCommits, { branch: name, limit: 80 })
      setCommits(rows)
      setCommit(rows[0]?.sha ?? '')
    } catch (error) { toast.push(error instanceof Error ? error.message : String(error), 'error') } finally { setManageBusy(null) }
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
    } catch (error) { toast.push(error instanceof Error ? error.message : String(error), 'error') } finally { setManageBusy(null) }
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
    } catch (error) { toast.push(error instanceof Error ? error.message : String(error), 'error') } finally { setManageBusy(null) }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="GBC 图像解析"
      description="KohakuGBC 把图片拆成带 bbox、父子描述和关系的图；导入后会变成可编辑的画布区域。"
      width="max-w-4xl"
      footer={
        tab !== 'run' ? <Button tone="secondary" onClick={onClose}>关闭</Button> : <>
          <Button tone="ghost" onClick={onClose}>关闭</Button>
          {result ? (
            <Button tone="primary" onClick={() => { onImport(result); onClose() }}>导入 {result.vertices.length} 个区域</Button>
          ) : (
            <Button tone="primary" onClick={() => void runGbc()} disabled={busy || !status?.available}>
              {busy ? <Spinner className="size-3.5" /> : <ScanSearch className="size-3.5" />}
              {busy ? 'GBC 运行中…' : '开始解析'}
            </Button>
          )}
        </>
      }
    >
      <div className="flex shrink-0 gap-1 border-b border-[var(--color-border-subtle)] px-4 pt-2">
        <button type="button" onClick={() => setTab('run')} className={`border-b-2 px-3 py-2 text-[11px] ${tab === 'run' ? 'border-accent-400 text-[var(--color-text)]' : 'border-transparent text-[var(--color-text-tertiary)]'}`}>解析图片</button>
        <button type="button" onClick={() => setTab('manage')} className={`border-b-2 px-3 py-2 text-[11px] ${tab === 'manage' ? 'border-accent-400 text-[var(--color-text)]' : 'border-transparent text-[var(--color-text-tertiary)]'}`}>GBC 版本</button>
        <button type="button" onClick={() => setTab('env')} className={`border-b-2 px-3 py-2 text-[11px] ${tab === 'env' ? 'border-accent-400 text-[var(--color-text)]' : 'border-transparent text-[var(--color-text-tertiary)]'}`}>环境检测</button>
      </div>
      {tab === 'manage' ? (
        <div className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-border-subtle)] bg-white/[0.025] p-3">
            <div><div className="flex items-center gap-1.5 text-[11.5px] font-medium"><GitBranch className="size-3.5" />KohakuGBC 版本仓库</div><p className="mt-1 text-[9.5px] text-[var(--color-text-tertiary)]">使用内嵌 Git 克隆上游，按 commit 创建独立工作目录。</p></div>
            <Button tone="secondary" onClick={() => void pullBranches()} disabled={manageBusy !== null}>{manageBusy === 'branches' ? <Spinner className="size-3.5" /> : <RefreshCw className="size-3.5" />}拉取/更新</Button>
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
                <Button tone="ghost" onClick={() => setVersionId(version.id)}>用于解析</Button>
                <button type="button" className="text-[var(--color-text-tertiary)] hover:text-red-300" onClick={() => void removeVersion(version)} disabled={manageBusy !== null}><Trash2 className="size-3.5" /></button>
              </div>
            ))}
            {versions.length === 0 ? <p className="py-6 text-center text-[10px] text-[var(--color-text-tertiary)]">还没有 GBC 版本；先拉取上游并创建。</p> : null}
          </div>
        </div>
      ) : tab === 'env' ? (
        <div className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-border-subtle)] bg-white/[0.025] p-3">
            <div><div className="text-[11.5px] font-medium">GBC 运行环境</div><p className="mt-0.5 text-[9.5px] text-[var(--color-text-tertiary)]">检查内嵌 Git 版本、Python、torch/transformers/kohakugbc 和 CUDA。</p></div>
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
      ) : (
      <div className="space-y-3 p-4">
        {!status?.available ? (
          <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2 text-[10.5px] leading-5 text-amber-200">
            {status?.error ?? '正在检查 gbc…'}
            <div className="mt-1 font-mono text-[9.5px]">pip install "kohakugbc[torch]"</div>
          </div>
        ) : (
          <div className="text-[9.5px] text-emerald-300">gbc 可用；首次运行会下载 OWLv2/EmbeddingGemma 模型。</div>
        )}
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Field label="图片目录">
            <Input value={folder} onChange={(event) => setFolder(event.target.value)} placeholder="/path/to/images" />
          </Field>
          <Button tone="secondary" className="mt-5" onClick={() => void pickFolder()}>
            <FolderOpen className="size-3.5" /> 选择
          </Button>
        </div>
        {versions.length ? <Field label="GBC 版本"><Select value={versionId} onChange={(event) => setVersionId(event.target.value)}><option value="">外部 gbc / PATH</option>{versions.map((version) => <option key={version.id} value={version.id}>{version.name} · {version.shortCommit}</option>)}</Select></Field> : null}
        <div className="grid grid-cols-2 gap-3">
          <Field label="VLM Provider">
            <Select value={providerId} onChange={(event) => setProviderId(event.target.value)}>
              {providers.length === 0 ? <option value="">先配置 OpenAI/Anthropic Provider</option> : null}
              {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name} · {provider.model}</option>)}
            </Select>
          </Field>
          <Field label="Detector">
            <Select value={detector} onChange={(event) => setDetector(event.target.value as 'owlv2' | 'sam3')}>
              <option value="owlv2">OWLv2（默认）</option>
              <option value="sam3">SAM 3（插图）</option>
            </Select>
          </Field>
        </div>
        {result ? (
          <div className="rounded-lg border border-accent-500/25 bg-accent-500/[0.05] p-3">
            <div className="text-[11px] font-medium">解析完成</div>
            <div className="mt-1 text-[10px] leading-5 text-[var(--color-text-secondary)]">
              {result.graphCount} 张图 · {result.vertexCount} 个 vertex · {result.vertices.length} 个可导入区域
            </div>
            {result.summary ? <p className="mt-1 line-clamp-2 text-[9.5px] text-[var(--color-text-tertiary)]">{result.summary}</p> : null}
            <div className="mt-2 max-h-28 space-y-0.5 overflow-y-auto">
              {result.vertices.slice(0, 20).map((vertex, index) => (
                <div key={vertex.vertex_id ?? index} className="truncate text-[9px] text-[var(--color-text-tertiary)]">
                  {index + 1}. {vertex.label} · {vertex.descs?.[0]?.text ?? '无描述'}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-[9.5px] leading-4 text-[var(--color-text-tertiary)]">
            解析会把每张图的实体 bbox、父子关系描述和构图区域写入结果；导入画布后可继续手动编辑提示词。
            真实速度取决于 GPU/API，30 张图在 4090 + 本地 Qwen3.5 4B 的参考值约 43 秒。
          </p>
        )}
      </div>
      )}
    </Modal>
  )
}
