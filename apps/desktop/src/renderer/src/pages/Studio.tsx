import {
  ArrowRight,
  Box,
  Copy,
  Eraser,
  ImagePlus,
  Layers,
  Sparkles,
  SquareDashedMousePointer,
  Type,
  UserRound,
  X,
  Save,
  Eye,
  EyeOff,
  Lock,
  Unlock,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { GalleryItem, InstanceInfo, JobRecord, ProjectDocument, ProjectSummary } from '@shared/types'
import type { BackendInfo } from '@shared/backend'
import { electronStudioClient } from '../lib/studioClient'
import { openWindow } from '../lib/windows'
import { cloverUrl } from '../lib/clover'
import {
  clampBox,
  compileLayout,
  createDraft,
  exampleDraft,
  type CompileResult,
  type LayoutDraft,
  type LayoutLabel,
} from '../lib/layout'
import { useApp } from '../store'
import { Button, Card, IconButton, Input, Modal, Pill, Segmented, Select, Textarea, cn, useToast } from '../components/ui'
import { PromptSegmentsModal } from '../components/PromptSegmentsModal'

const SIZE_PRESETS: Array<[string, number, number]> = [
  ['512²', 512, 512],
  ['768²', 768, 768],
  ['1024²', 1024, 1024],
  ['1024×768', 1024, 768],
  ['768×1024', 768, 1024],
]

const LABEL_META: Record<LayoutLabel, { name: string; color: string; icon: React.ReactNode }> = {
  object: { name: '物体', color: 'accent', icon: <Box className="size-3" /> },
  character: { name: '人物', color: 'sky', icon: <UserRound className="size-3" /> },
  text: { name: '文字', color: 'amber', icon: <Type className="size-3" /> },
}

type DragState =
  | { kind: 'move' | 'resize'; id: string; startX: number; startY: number; origin: [number, number, number, number] }
  | null

function draftFromProject(project: ProjectDocument): LayoutDraft {
  return {
    width: project.width,
    height: project.height,
    summary: project.summary,
    items: project.layers.map((layer) => ({
      id: layer.id,
      label: layer.kind,
      caption: layer.caption,
      text: layer.text,
      bbox: layer.bbox,
      visible: layer.visible,
      locked: layer.locked,
      opacity: layer.opacity,
    })),
  }
}

function projectSnapshot(input: {
  name: string
  draft: LayoutDraft
  prompt: string
  negative: string
  seed: number
  steps: number
  cfg: number
  instanceId: string
  backgroundPath?: string
  seriesId: string
  page: number
}): string {
  return JSON.stringify(input)
}

export function StudioPage(): React.JSX.Element {
  const toast = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedInstanceId = searchParams.get('instanceId')
  const storedPrompt = useApp((state) => state.studioPrompt)
  const studioInstanceId = useApp((state) => state.studioInstanceId)
  const storedDraft = useApp((state) => state.studioDraft)
  const background = useApp((state) => state.studioBackground)
  const setStudioPrompt = useApp((state) => state.setStudioPrompt)
  const setStudioDraft = useApp((state) => state.setStudioDraft)
  const setStudioBackground = useApp((state) => state.setStudioBackground)

  useEffect(() => {
    if (background) return
    try {
      const raw = localStorage.getItem('clover.studioBackground')
      if (!raw) return
      const item = JSON.parse(raw) as GalleryItem
      setStudioBackground(item)
      localStorage.removeItem('clover.studioBackground')
    } catch {
      // ignore
    }
  }, [background, setStudioBackground])
  const instances = useApp((state) => state.instances)
  const env = useApp((state) => state.env)

  const [prompt, setPrompt] = useState(storedPrompt)
  const [negative, setNegative] = useState('nsfw, worst quality, bad anatomy, watermark, jpeg artifact')
  const [draft, setDraft] = useState<LayoutDraft>(storedDraft ?? exampleDraft())
  const [tool, setTool] = useState<'select' | 'draw'>('draw')
  const [label, setLabel] = useState<LayoutLabel>('object')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [drawing, setDrawing] = useState<{ start: [number, number]; current: [number, number] } | null>(null)
  const [drag, setDrag] = useState<DragState>(null)
  const [compiled, setCompiled] = useState<CompileResult | null>(null)
  const [jsonOpen, setJsonOpen] = useState(false)
  const [segmentsOpen, setSegmentsOpen] = useState(false)
  const [steps, setSteps] = useState(env?.recommendation.steps ?? 8)
  const [cfg, setCfg] = useState(env?.recommendation.profile === 'dmd8' ? 1 : 3)
  const [seed, setSeed] = useState(42)
  const [selectedInstanceId, setInstanceId] = useState(studioInstanceId ?? '')
  const instanceId = instances.find((item) => item.id === selectedInstanceId)?.id ?? instances[0]?.id ?? ''
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [projectId, setProjectId] = useState<string | null>(null)
  const [projectName, setProjectName] = useState('未命名 Project')
  const [seriesId, setSeriesId] = useState('')
  const [page, setPage] = useState(1)
  const [projectSaving, setProjectSaving] = useState(false)
  const [backend, setBackend] = useState<BackendInfo | null>(null)
  const lastSaved = useRef('')
  const skipAutosave = useRef(false)
  const snapshot = useMemo(
    () => projectSnapshot({ name: projectName, draft, prompt, negative, seed, steps, cfg, instanceId, backgroundPath: background?.path, seriesId, page }),
    [projectName, draft, prompt, negative, seed, steps, cfg, instanceId, background?.path, seriesId, page],
  )
  const canvasRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (storedPrompt) setPrompt(storedPrompt)
  }, [storedPrompt])

  useEffect(() => {
    if (studioInstanceId) setInstanceId(studioInstanceId)
  }, [studioInstanceId])

  useEffect(() => {
    if (!requestedInstanceId || !instances.some((item) => item.id === requestedInstanceId)) return
    setInstanceId(requestedInstanceId)
    // Consume the request so reopening this window with the same instance applies it again.
    setSearchParams((params) => {
      const next = new URLSearchParams(params)
      next.delete('instanceId')
      return next
    }, { replace: true })
  }, [requestedInstanceId, instances, setSearchParams])

  useEffect(() => {
    if (storedDraft) setDraft(storedDraft)
  }, [storedDraft])

  useEffect(() => {
    void electronStudioClient.listProjects().then(setProjects).catch(() => undefined)
    void electronStudioClient.backendInfo().then(setBackend).catch(() => setBackend(null))
  }, [])

  useEffect(() => {
    if (!projectId || snapshot === lastSaved.current || skipAutosave.current) return
    const timer = setTimeout(() => {
      void saveProjectNow(true)
    }, 1200)
    return () => clearTimeout(timer)
  }, [projectId, snapshot])

  const selected = draft.items.find((item) => item.id === selectedId) ?? null
  const seriesProjects = seriesId
    ? projects.filter((item) => item.seriesId === seriesId).sort((a, b) => (a.page ?? 1) - (b.page ?? 1))
    : []
  const nextSeriesPage = seriesProjects.find((item) => (item.page ?? 1) === page + 1)
  const previousSeriesPage = seriesProjects.find((item) => (item.page ?? 1) === page - 1)

  function toDraftPoint(event: React.PointerEvent): [number, number] {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return [0, 0]
    return [
      Math.round(((event.clientX - rect.left) / rect.width) * draft.width),
      Math.round(((event.clientY - rect.top) / rect.height) * draft.height),
    ]
  }

  function handlePointerDown(event: React.PointerEvent): void {
    if (event.button !== 0) return
    const target = event.target as HTMLElement
    if (target.closest('textarea, input, select, button')) return
    const resizeId = target.dataset.resizeId
    const boxId = target.closest<HTMLElement>('[data-box-id]')?.dataset.boxId
    canvasRef.current?.setPointerCapture(event.pointerId)
    const [x, y] = toDraftPoint(event)

    if (resizeId) {
      const item = draft.items.find((entry) => entry.id === resizeId)
      if (item) {
        setSelectedId(item.id)
        if (item.locked) return
        setDrag({ kind: 'resize', id: item.id, startX: x, startY: y, origin: [...item.bbox] })
      }
      return
    }
    if (boxId) {
      const item = draft.items.find((entry) => entry.id === boxId)
      if (item) {
        setSelectedId(item.id)
        if (item.locked) return
        setDrag({ kind: 'move', id: item.id, startX: x, startY: y, origin: [...item.bbox] })
      }
      return
    }
    setSelectedId(null)
    if (tool === 'draw') {
      const point: [number, number] = [x, y]
      setDrawing({ start: point, current: point })
    }
  }

  function updateItem(id: string, bbox: [number, number, number, number]): void {
    setDraft((previous) => ({
      ...previous,
      items: previous.items.map((item) => (item.id === id ? { ...item, bbox } : item)),
    }))
  }

  function handlePointerMove(event: React.PointerEvent): void {
    if (!drawing && !drag) return
    const [x, y] = toDraftPoint(event)
    if (drawing) {
      setDrawing({ start: drawing.start, current: [x, y] })
      return
    }
    if (drag) {
      const dx = x - drag.startX
      const dy = y - drag.startY
      const [x1, y1, x2, y2] = drag.origin
      if (drag.kind === 'move') {
        const width = x2 - x1
        const height = y2 - y1
        const left = Math.max(0, Math.min(draft.width - width, x1 + dx))
        const top = Math.max(0, Math.min(draft.height - height, y1 + dy))
        updateItem(drag.id, [left, top, left + width, top + height])
      } else {
        updateItem(drag.id, [
          x1,
          y1,
          Math.max(x1 + 8, Math.min(draft.width, x2 + dx)),
          Math.max(y1 + 8, Math.min(draft.height, y2 + dy)),
        ])
      }
    }
  }

  function handlePointerUp(): void {
    if (drawing) {
      const [x1, y1] = drawing.start
      const [x2, y2] = drawing.current
      const box = clampBox([Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)], draft.width, draft.height)
      if (box[2] - box[0] >= 12 && box[3] - box[1] >= 12) {
        const item = {
          id: crypto.randomUUID(),
          label,
          caption: '',
          text: label === 'text' ? '' : undefined,
          bbox: box,
        }
        setDraft((previous) => ({ ...previous, items: [...previous.items, item] }))
        setSelectedId(item.id)
        setTool('select')
      }
      setDrawing(null)
    }
    setDrag(null)
  }

  function changeSize(width: number, height: number): void {
    setDraft((previous) => ({
      ...previous,
      width,
      height,
      items: previous.items.map((item) => ({ ...item, bbox: clampBox(item.bbox, width, height) })),
    }))
  }

  function setItem(id: string, patch: Partial<LayoutDraft['items'][number]>): void {
    setDraft((previous) => ({
      ...previous,
      items: previous.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    }))
  }

  function removeItem(id: string): void {
    setDraft((previous) => ({ ...previous, items: previous.items.filter((item) => item.id !== id) }))
    if (selectedId === id) setSelectedId(null)
  }

  function compile(): void {
    const result = compileLayout(draft)
    if (!result.ok) {
      toast.push(result.errors[0] ?? '布局不完整', 'error')
      return
    }
    setCompiled(result)
    setJsonOpen(true)
  }

  function insertPrompt(): void {
    if (!compiled || !compiled.ok) return
    const next = prompt.trim() ? `${prompt.trim()}\n\n${compiled.prompt}` : compiled.prompt
    setPrompt(next)
    setStudioPrompt(next)
    setJsonOpen(false)
    toast.push('布局 Prompt 已插入', 'success')
  }

  async function saveProjectNow(auto = false): Promise<void> {
    if (projectSaving) return
    setProjectSaving(true)
    try {
      const saved = await electronStudioClient.saveProject({
        id: projectId ?? undefined,
        name: projectName.trim() || '未命名 Project',
        width: draft.width,
        height: draft.height,
        summary: draft.summary,
        layers: draft.items.map((item) => ({
          id: item.id,
          kind: item.label,
          caption: item.caption,
          text: item.text,
          bbox: item.bbox,
          visible: item.visible !== false,
          locked: item.locked === true,
          opacity: item.opacity ?? 1,
        })),
        prompt,
        negative,
        seed,
        steps,
        cfg,
        instanceId: instanceId || undefined,
        backgroundPath: background?.path,
        seriesId: seriesId || undefined,
        page,
      })
      setProjectId(saved.id)
      setProjectName(saved.name)
      lastSaved.current = projectSnapshot({
        name: saved.name, draft, prompt, negative, seed, steps, cfg, instanceId,
        backgroundPath: background?.path, seriesId, page,
      })
      setProjects(await electronStudioClient.listProjects())
      if (!auto) toast.push('Project 已保存', 'success')
    } catch (error) {
      toast.push(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setProjectSaving(false)
    }
  }

  async function openProject(id: string): Promise<void> {
    try {
      const project = await electronStudioClient.getProject(id)
      if (!project) return
      const nextDraft = draftFromProject(project)
      skipAutosave.current = true
      setProjectId(project.id)
      setProjectName(project.name)
      setSeriesId(project.seriesId ?? '')
      setPage(project.page ?? 1)
      setPrompt(project.prompt)
      setStudioPrompt(project.prompt)
      setNegative(project.negative)
      setDraft(nextDraft)
      setStudioDraft(nextDraft)
      setSeed(project.seed)
      setSteps(project.steps)
      setCfg(project.cfg)
      setInstanceId(project.instanceId ?? instances[0]?.id ?? '')
      if (project.backgroundPath) {
        const path = project.backgroundPath
        setStudioBackground({ id: `project-bg-${project.id}`, path, name: path.split('/').pop() ?? 'background', dir: path.slice(0, Math.max(0, path.lastIndexOf('/'))), root: '', size: 0, mtime: 0, ext: path.split('.').pop() ?? '' })
      } else {
        setStudioBackground(null)
      }
      lastSaved.current = projectSnapshot({
        name: project.name, draft: nextDraft, prompt: project.prompt, negative: project.negative,
        seed: project.seed, steps: project.steps, cfg: project.cfg, instanceId: project.instanceId ?? '',
        backgroundPath: project.backgroundPath, seriesId: project.seriesId ?? '', page: project.page ?? 1,
      })
      setTimeout(() => { skipAutosave.current = false }, 600)
      toast.push('Project 已打开', 'success')
    } catch (error) {
      toast.push(error instanceof Error ? error.message : String(error), 'error')
    }
  }

  function newProject(): void {
    setProjectId(null)
    setProjectName('未命名 Project')
    setSeriesId('')
    setPage(1)
    setPrompt('')
    setStudioPrompt('')
    const draft = createDraft(1024, 1024)
    setDraft(draft)
    setStudioDraft(draft)
    setSelectedId(null)
    lastSaved.current = ''
  }

  async function newPage(): Promise<void> {
    const nextSeries = seriesId || `series-${crypto.randomUUID().slice(0, 8)}`
    setProjectSaving(true)
    try {
      const saved = await electronStudioClient.saveProject({
        name: `${projectName.replace(/ · 第\d+页$/, '')} · 第${page + 1}页`,
        width: draft.width,
        height: draft.height,
        summary: draft.summary,
        layers: draft.items.map((item) => ({
          id: item.id,
          kind: item.label,
          caption: item.caption,
          text: item.text,
          bbox: item.bbox,
          visible: item.visible !== false,
          locked: item.locked === true,
          opacity: item.opacity ?? 1,
        })),
        prompt, negative, seed, steps, cfg, instanceId: instanceId || undefined,
        backgroundPath: background?.path,
        seriesId: nextSeries,
        page: page + 1,
      })
      setProjects(await electronStudioClient.listProjects())
      await openProject(saved.id)
      toast.push(`已创建系列第 ${saved.page ?? page + 1} 页`, 'success')
    } catch (error) {
      toast.push(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setProjectSaving(false)
    }
  }

  async function generate(): Promise<void> {
    if (!instanceId) {
      toast.push('先选择一个实例', 'error')
      return
    }
    if (!prompt.trim()) {
      toast.push('先写提示词或插入布局 Prompt', 'error')
      return
    }
    let info = backend
    if (!info?.ready) {
      info = await electronStudioClient.backendInfo().catch(() => null)
      setBackend(info)
    }
    if (!info?.ready || !info.url || !info.token) {
      toast.push(info?.error ?? 'Clover 后端尚未就绪；请稍后重试', 'error')
      return
    }
    try {
      const response = await fetch(`${info.url}/api/jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${info.token}` },
        body: JSON.stringify({
          instanceId,
          prompt,
          negativePrompt: negative,
          width: draft.width,
          height: draft.height,
          steps,
          cfg,
          seed,
          profile: steps <= 8 ? 'dmd8' : 'base',
          mode: 'runner',
        }),
      })
      const body = (await response.json()) as JobRecord | { error?: string }
      if (!response.ok || 'error' in body) {
        const raw = 'error' in body ? body.error : undefined
        const message = typeof raw === 'string' ? raw : raw?.message ?? `后端返回 ${response.status}`
        throw new Error(message)
      }
      toast.push('已提交到 Clover 后端，正在终端运行', 'success')
      openWindow('terminal')
    } catch (error) {
      toast.push(error instanceof Error ? error.message : String(error), 'error')
    }
  }

  return (
    <div className="space-y-4 pb-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">MossStudio</h1>
          <p className="mt-1 text-[12px] text-[var(--color-text-secondary)]">
            写提示词、框选布局，再编译成 MOSS 的 layout JSON。独立 HTTP/WS 后端已接：开始生成会提交到共享 Supervisor/终端；Project 自动保存。
          </p>
        </div>
        <div className="flex items-center gap-2">
          {env ? <Pill tone="blue">{env.recommendation.width}² · {env.recommendation.steps} 步</Pill> : null}
          <Pill tone={backend?.ready ? 'accent' : 'amber'}>{backend?.ready ? 'Clover 后端就绪' : '后端启动中'}</Pill>
          <Button tone="primary" onClick={() => void generate()}>
            <span className="inline-flex items-center gap-1.5">
              开始生成 <ArrowRight className="size-3.5" />
            </span>
          </Button>
        </div>
      </header>

      <Card className="flex flex-wrap items-center gap-2 p-2.5">
        <span className="px-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-tertiary)]">Project</span>
        <Select
          value={projectId ?? ''}
          onChange={(event) => { if (event.target.value) void openProject(event.target.value) }}
          className="min-w-[180px]"
        >
          <option value="">未打开</option>
          {projects.map((item) => <option key={item.id} value={item.id}>{item.name}{item.page ? ` · 第${item.page}页` : ''}</option>)}
        </Select>
        <Input
          value={projectName}
          onChange={(event) => setProjectName(event.target.value)}
          placeholder="Project 名称"
          className="min-w-[160px] flex-1"
        />
        <Input
          value={seriesId}
          onChange={(event) => setSeriesId(event.target.value)}
          placeholder="系列 ID（可选）"
          className="w-[130px]"
        />
        <span className="text-[9.5px] text-[var(--color-text-tertiary)]">第 {page} 页</span>
        <Button
          tone="ghost"
          onClick={() => { if (previousSeriesPage) void openProject(previousSeriesPage.id) }}
          disabled={!previousSeriesPage}
        >
          上一页
        </Button>
        <Button
          tone="ghost"
          onClick={() => { if (nextSeriesPage) void openProject(nextSeriesPage.id); else void newPage() }}
        >
          {nextSeriesPage ? '下一页' : '+ 新页'}
        </Button>
        <Button tone="ghost" onClick={newProject}>新建</Button>
        <Button tone="secondary" onClick={() => void saveProjectNow()} disabled={projectSaving}>
          <span className="inline-flex items-center gap-1.5">{projectSaving ? null : <Save className="size-3" />}保存</span>
        </Button>
        <span className="text-[9px] text-[var(--color-text-tertiary)]">{projectId ? '自动保存已开启' : '保存后开启自动保存'}</span>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-[13px] font-semibold">提示词</h2>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setSegmentsOpen(true)} className="text-[9.5px] text-accent-300 hover:underline">分段</button>
                <span className="text-[10px] text-[var(--color-text-tertiary)]">{prompt.length} 字符</span>
              </div>
            </div>
            <Textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="描述画面、文字、风格与布局。也可以粘贴编译后的 layout JSON。"
              className="mt-2.5 h-40 w-full resize-none leading-5"
            />
            <label className="mt-3 block text-[10.5px] text-[var(--color-text-tertiary)]">负面提示词</label>
            <Input
              value={negative}
              onChange={(event) => setNegative(event.target.value)}
              className="mt-1 w-full"
            />
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-[13px] font-semibold">布局总览</h2>
              <Pill tone="neutral">abs · xyxy</Pill>
            </div>
            <label className="mt-2 block space-y-1">
              <span className="text-[10px] text-[var(--color-text-tertiary)]">整体描述（summary.caption）</span>
              <Textarea
                value={draft.summary.caption}
                onChange={(event) =>
                  setDraft((previous) => ({
                    ...previous,
                    summary: { ...previous.summary, caption: event.target.value },
                  }))
                }
                placeholder="一句话描述整张图的场景、风格与构图。"
                className="h-20 w-full resize-none"
              />
            </label>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="space-y-1">
                <span className="text-[10px] text-[var(--color-text-tertiary)]">meta（逗号分隔）</span>
                <Input
                  value={draft.summary.meta.join(', ')}
                  onChange={(event) =>
                    setDraft((previous) => ({
                      ...previous,
                      summary: {
                        ...previous.summary,
                        meta: event.target.value
                          .split(',')
                          .map((value) => value.trim())
                          .filter(Boolean),
                      },
                    }))
                  }
                  placeholder="poster, typography"
                  className="w-full"
                />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] text-[var(--color-text-tertiary)]">canvas</span>
                <Select
                  value={draft.summary.canvas}
                  onChange={(event) =>
                    setDraft((previous) => ({
                      ...previous,
                      summary: {
                        ...previous.summary,
                        canvas: event.target.value as LayoutDraft['summary']['canvas'],
                      },
                    }))
                  }
                  className="w-full"
                >
                  <option value="single">single</option>
                  <option value="multi_panel">multi_panel</option>
                  <option value="collage">collage</option>
                </Select>
              </label>
            </div>
            <Button tone="primary" className="mt-3" onClick={compile}>
              <span className="inline-flex items-center gap-1.5">
                <SquareDashedMousePointer className="size-3.5" /> 编译布局 Prompt
              </span>
            </Button>
            <p className="mt-2 text-[9.5px] leading-4 text-[var(--color-text-tertiary)]">
              编译会按官方规则转换为中心原点 + yxyx，并校验画布、区域与文字；失败时会指出具体区域。
            </p>
          </Card>

          <Card className="p-4">
            <h2 className="text-[13px] font-semibold">画布与采样</h2>
            <div className="mt-3 flex flex-wrap gap-1">
              {SIZE_PRESETS.map(([name, width, height]) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => changeSize(width, height)}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-[10.5px] transition',
                    draft.width === width && draft.height === height
                      ? 'border-accent-500/40 bg-accent-500/12 text-accent-700 dark:text-accent-200'
                      : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-accent-400/40',
                  )}
                >
                  {name}
                </button>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="space-y-1">
                <span className="text-[10px] text-[var(--color-text-tertiary)]">宽度（16 倍数）</span>
                <Input
                  type="number"
                  min={256}
                  max={2048}
                  step={16}
                  value={draft.width}
                  onChange={(event) => changeSize(Number(event.target.value) || draft.width, draft.height)}
                  className="w-full"
                />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] text-[var(--color-text-tertiary)]">高度（16 倍数）</span>
                <Input
                  type="number"
                  min={256}
                  max={2048}
                  step={16}
                  value={draft.height}
                  onChange={(event) => changeSize(draft.width, Number(event.target.value) || draft.height)}
                  className="w-full"
                />
              </label>
            </div>
            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10.5px] text-[var(--color-text-secondary)]">步数</span>
                <Segmented
                  label="采样步数"
                  value={String(steps)}
                  onChange={(value) => setSteps(Number(value))}
                  options={[
                    { value: '8', label: '8 DMD' },
                    { value: '20', label: '20' },
                    { value: '50', label: '50' },
                  ]}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1">
                  <span className="text-[10px] text-[var(--color-text-tertiary)]">CFG</span>
                  <Input
                    type="number"
                    min={0}
                    max={20}
                    step={0.5}
                    value={cfg}
                    onChange={(event) => setCfg(Number(event.target.value))}
                    className="w-full"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] text-[var(--color-text-tertiary)]">Seed</span>
                  <Input
                    type="number"
                    value={seed}
                    onChange={(event) => setSeed(Number(event.target.value))}
                    className="w-full"
                  />
                </label>
              </div>
              <label className="block space-y-1">
                <span className="text-[10px] text-[var(--color-text-tertiary)]">实例</span>
                <Select
                  value={instanceId}
                  onChange={(event) => setInstanceId(event.target.value)}
                  className="w-full"
                >
                  {instances.length === 0 ? <option value="">尚未创建实例</option> : null}
                  {instances.map((instance: InstanceInfo) => (
                    <option key={instance.id} value={instance.id}>
                      {instance.name} · {instance.runtimeState === 'ready' ? '就绪' : '未装依赖'}
                    </option>
                  ))}
                </Select>
              </label>
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border-subtle)] px-4 py-2.5">
              <div className="flex items-center gap-2">
                <Layers className="size-3.5 text-accent-500" />
                <span className="text-[12.5px] font-medium">布局画布</span>
                <span className="text-[10px] text-[var(--color-text-tertiary)]">
                  {draft.width} × {draft.height} · {draft.items.length} 个区域
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <Segmented
                  label="画布工具"
                  value={tool}
                  onChange={(value) => setTool(value as 'select' | 'draw')}
                  options={[
                    { value: 'select', label: '选择' },
                    { value: 'draw', label: '画框' },
                  ]}
                />
                <Segmented
                  value={label}
                  onChange={(value) => setLabel(value as LayoutLabel)}
                  options={[
                    { value: 'object', label: '物体' },
                    { value: 'character', label: '人物' },
                    { value: 'text', label: '文字' },
                  ]}
                />
                <IconButton label="示例布局" onClick={() => { setDraft(exampleDraft()); setSelectedId(null) }}>
                  <Sparkles className="size-3.5" />
                </IconButton>
                <IconButton label="清空画布" onClick={() => { setDraft(createDraft(draft.width, draft.height)); setSelectedId(null) }}>
                  <Eraser className="size-3.5" />
                </IconButton>
                {background ? (
                  <IconButton label="清除底图" onClick={() => setStudioBackground(null)}>
                    <X className="size-3.5" />
                  </IconButton>
                ) : null}
              </div>
            </div>

            <div className="p-3">
              <div
                ref={canvasRef}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                className={cn(
                  'relative mx-auto select-none overflow-hidden rounded-[5px] border border-[var(--color-border)]',
                  tool === 'draw' ? 'cursor-crosshair' : 'cursor-default',
                )}
                style={{
                  aspectRatio: `${draft.width} / ${draft.height}`,
                  width: `min(100%, calc((100vh - 260px) * ${draft.width / draft.height}))`,
                }}
              >
                {background ? (
                  <img
                    src={cloverUrl(background.path)}
                    alt={background.name}
                    className="absolute inset-0 size-full object-contain"
                    draggable={false}
                  />
                ) : (
                  <div className="absolute inset-0 bg-[linear-gradient(45deg,rgba(148,163,184,0.10)_25%,transparent_25%,transparent_75%,rgba(148,163,184,0.10)_75%),linear-gradient(45deg,rgba(148,163,184,0.10)_25%,transparent_25%,transparent_75%,rgba(148,163,184,0.10)_75%)] bg-[length:24px_24px] bg-[position:0_0,12px_12px]" />
                )}
                <div className="absolute inset-0 bg-gradient-to-br from-accent-500/[0.03] to-transparent" />

                {draft.items.filter((item) => item.visible !== false).map((item, index) => {
                  const [x1, y1, x2, y2] = item.bbox
                  const isSelected = item.id === selectedId
                  const meta = LABEL_META[item.label]
                  return (
                    <div
                      key={item.id}
                      data-box-id={item.id}
                      className={cn(
                        'absolute cursor-move rounded-[4px] border-2 transition-colors',
                        isSelected
                          ? 'border-accent-400 bg-accent-400/15'
                          : 'border-sky-400/80 bg-sky-400/10 hover:border-accent-400',
                      )}
                      style={{
                        left: `${(x1 / draft.width) * 100}%`,
                        top: `${(y1 / draft.height) * 100}%`,
                        width: `${((x2 - x1) / draft.width) * 100}%`,
                        height: `${((y2 - y1) / draft.height) * 100}%`,
                        opacity: item.opacity ?? 1,
                      }}
                    >
                      <span data-box-id={item.id} className="absolute -top-5 left-0 inline-flex max-w-full cursor-move items-center gap-1 truncate rounded bg-accent-600 px-1.5 py-0.5 text-[9px] font-medium text-white">
                        {index + 1} · {meta.name}
                      </span>
                      <div className="absolute inset-0 flex flex-col gap-1 p-1.5 pt-2">
                        <textarea
                          value={item.caption}
                          onPointerDown={(event) => { event.stopPropagation(); setSelectedId(item.id) }}
                          onChange={(event) => setItem(item.id, { caption: event.target.value })}
                          placeholder="在框内写区域提示词…"
                          className="min-h-0 flex-1 resize-none rounded border-0 bg-transparent p-0 text-[10px] leading-[15px] text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-tertiary)]/60"
                          style={{ cursor: 'text' }}
                        />
                        {item.label === 'text' ? (
                          <input
                            value={item.text ?? ''}
                            onPointerDown={(event) => { event.stopPropagation(); setSelectedId(item.id) }}
                            onChange={(event) => setItem(item.id, { text: event.target.value })}
                            placeholder="图中文字"
                            className="shrink-0 rounded border-0 bg-amber-500/15 px-1 py-0.5 text-[9px] text-amber-200 outline-none placeholder:text-amber-200/50"
                          />
                        ) : null}
                      </div>
                      {isSelected ? (
                        <span
                          data-resize-id={item.id}
                          className="absolute -bottom-1.5 -right-1.5 size-3 cursor-nwse-resize rounded-full border-2 border-white bg-accent-500 shadow"
                        />
                      ) : null}
                    </div>
                  )
                })}

                {drawing ? (
                  <div
                    className="pointer-events-none absolute rounded-[4px] border-2 border-dashed border-accent-400 bg-accent-400/15"
                    style={{
                      left: `${(Math.min(drawing.start[0], drawing.current[0]) / draft.width) * 100}%`,
                      top: `${(Math.min(drawing.start[1], drawing.current[1]) / draft.height) * 100}%`,
                      width: `${(Math.abs(drawing.current[0] - drawing.start[0]) / draft.width) * 100}%`,
                      height: `${(Math.abs(drawing.current[1] - drawing.start[1]) / draft.height) * 100}%`,
                    }}
                  />
                ) : null}
              </div>
              <p className="mt-2 text-[10px] text-[var(--color-text-tertiary)]">
                拖拽空白处画框；点击框选中，拖动移动，右下角圆点缩放。文字区域需要填写显示内容。
              </p>
            </div>
          </Card>

          <Card className="flex h-[248px] flex-col overflow-hidden p-0">
            <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-border-subtle)] px-3 py-2">
              <div className="flex items-center gap-2">
                <h2 className="text-[13px] font-semibold">区域</h2>
                <span className="text-[9.5px] text-[var(--color-text-tertiary)]">{draft.items.length} 个 · 横向标签</span>
              </div>
              <Button tone="ghost" onClick={() => { setTool('draw'); setSelectedId(null) }}>
                <span className="inline-flex items-center gap-1.5"><SquareDashedMousePointer className="size-3.5" /> 画新框</span>
              </Button>
            </div>

            <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-[var(--color-border-subtle)] px-2 py-1.5">
              {draft.items.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className={cn(
                    'flex max-w-[160px] shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[9.5px] transition',
                    item.id === selectedId
                      ? 'border-accent-500/50 bg-accent-500/12 text-accent-200'
                      : 'border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:border-accent-400/40',
                  )}
                  title={item.caption || `区域 ${index + 1}`}
                >
                  <span className="font-mono text-[8.5px] text-[var(--color-text-tertiary)]">{index + 1}</span>
                  <span className="truncate">{item.caption || LABEL_META[item.label].name}</span>
                  {item.visible === false ? <EyeOff className="size-2.5 shrink-0" /> : null}
                  {item.locked ? <Lock className="size-2.5 shrink-0" /> : null}
                </button>
              ))}
              {draft.items.length === 0 ? <span className="px-2 py-1 text-[9.5px] text-[var(--color-text-tertiary)]">用“画新框”在画布上拖出一个矩形</span> : null}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {selected ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Select
                      value={selected.label}
                      onChange={(event) => setItem(selected.id, { label: event.target.value as LayoutLabel })}
                      className="w-[86px]"
                    >
                      <option value="object">物体</option>
                      <option value="character">人物</option>
                      <option value="text">文字</option>
                    </Select>
                    <button type="button" onClick={() => setItem(selected.id, { visible: selected.visible === false })} className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text)]" title={selected.visible === false ? '显示区域' : '隐藏区域'}>
                      {selected.visible === false ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                    </button>
                    <button type="button" onClick={() => setItem(selected.id, { locked: !selected.locked })} className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text)]" title={selected.locked ? '解锁区域' : '锁定区域'}>
                      {selected.locked ? <Lock className="size-3.5" /> : <Unlock className="size-3.5" />}
                    </button>
                    <span className="font-mono text-[9px] text-[var(--color-text-tertiary)]">{selected.bbox.map((value) => Math.round(value)).join(', ')}</span>
                    <div className="ml-auto flex items-center gap-2">
                      <span className="text-[9px] text-[var(--color-text-tertiary)]">不透明度</span>
                      <input type="range" min={0.1} max={1} step={0.05} value={selected.opacity ?? 1} onChange={(event) => setItem(selected.id, { opacity: Number(event.target.value) })} className="h-1 w-24 accent-[var(--color-accent)]" />
                      <span className="w-8 text-right text-[9px] text-[var(--color-text-tertiary)]">{Math.round((selected.opacity ?? 1) * 100)}%</span>
                      <button type="button" onClick={() => removeItem(selected.id)} className="text-[var(--color-text-tertiary)] hover:text-red-400"><X className="size-3.5" /></button>
                    </div>
                  </div>
                  <Textarea
                    value={selected.caption}
                    onChange={(event) => setItem(selected.id, { caption: event.target.value })}
                    placeholder="详细描述这个区域的外观、材质、动作…（画布框内也可直接编辑）"
                    className="h-[58px] w-full resize-none"
                  />
                  {selected.label === 'text' ? (
                    <Input
                      value={selected.text ?? ''}
                      onChange={(event) => setItem(selected.id, { text: event.target.value })}
                      placeholder="要渲染的文字"
                      className="w-full border-amber-500/30 bg-amber-500/[0.05] focus:border-amber-500"
                    />
                  ) : null}
                </div>
              ) : (
                <div className="flex h-full items-center justify-center text-center text-[10.5px] text-[var(--color-text-tertiary)]">
                  点上方区域标签，或直接在画布框内编辑；切换区域不会拉长页面。
                </div>
              )}
            </div>
          </Card>

        </div>
      </div>

      <Modal
        open={jsonOpen}
        onClose={() => setJsonOpen(false)}
        title="编译后的布局 Prompt"
        description="模型需要的 abs_centralized + yxyx 格式，可直接粘贴到 Prompt 输入框。"
        width="max-w-3xl"
        footer={
          <>
            <Button tone="ghost" onClick={() => setJsonOpen(false)}>
              取消
            </Button>
            <Button
              tone="secondary"
              onClick={() => {
                if (!compiled) return
                void navigator.clipboard.writeText(compiled.prompt)
                toast.push('已复制 JSON', 'success')
              }}
            >
              <span className="inline-flex items-center gap-1.5">
                <Copy className="size-3.5" /> 复制
              </span>
            </Button>
            <Button tone="primary" onClick={insertPrompt}>
              插入到 Prompt
            </Button>
          </>
        }
      >
        <pre className="max-h-[46vh] overflow-auto rounded-[6px] bg-white/55 p-3 font-mono text-[10.5px] leading-5 dark:bg-black/30">
          {compiled?.preview ?? ''}
        </pre>
        {compiled?.errors.length ? (
          <div className="mt-2 text-[11px] text-red-500">{compiled.errors.join('；')}</div>
        ) : null}
      </Modal>

      <PromptSegmentsModal
        open={segmentsOpen}
        value={prompt}
        onClose={() => setSegmentsOpen(false)}
        onApply={(next) => {
          setPrompt(next)
          setStudioPrompt(next)
        }}
      />
    </div>
  )
}
