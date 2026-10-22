import { FolderOpen, ScanSearch } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Ipc } from '@shared/channels'
import type { AiProviderInfo } from '@shared/ai'
import type { GbcRunResult } from '@shared/gbc'
import { call } from '../lib/api'
import { Button, Field, Input, Modal, Select, Spinner, useToast } from './ui'

interface Props {
  open: boolean
  onClose: () => void
  onImport: (result: GbcRunResult) => void
}

export function GbcImportModal({ open, onClose, onImport }: Props): React.JSX.Element {
  const toast = useToast()
  const [status, setStatus] = useState<{ available: boolean; error?: string } | null>(null)
  const [providers, setProviders] = useState<AiProviderInfo[]>([])
  const [providerId, setProviderId] = useState('')
  const [folder, setFolder] = useState('')
  const [detector, setDetector] = useState<'owlv2' | 'sam3'>('owlv2')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<GbcRunResult | null>(null)

  useEffect(() => {
    if (!open) return
    setResult(null)
    void call<{ available: boolean; error?: string }>(Ipc.gbcStatus).then(setStatus).catch(() => setStatus({ available: false, error: '无法检测 gbc' }))
    void call<AiProviderInfo[]>(Ipc.aiProvidersList).then((list) => {
      const usable = list.filter((item) => item.hasKey && (item.kind === 'openai' || item.kind === 'anthropic'))
      setProviders(usable)
      setProviderId((current) => current || usable[0]?.id || '')
    }).catch(() => undefined)
  }, [open])

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
      const next = await call<GbcRunResult>(Ipc.gbcRun, { folder: folder.trim(), providerId, detector })
      setResult(next)
      toast.push(`GBC 完成：${next.graphCount} 张图，${next.vertices.length} 个区域`, 'success')
    } catch (error) {
      toast.push(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="GBC 图像解析"
      description="KohakuGBC 把图片拆成带 bbox、父子描述和关系的图；导入后会变成可编辑的画布区域。"
      width="max-w-2xl"
      footer={
        <>
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
    </Modal>
  )
}
