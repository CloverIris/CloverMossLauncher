import {
  ArrowRight,
  Box,
  GripVertical,
  Hand,
  Images,
  Plus,
  Copy,
  Eraser,
  ImagePlus,
  Layers,
  Sparkles,
  ScanSearch,
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
import { Ipc } from '@shared/channels'
import { call } from '../lib/api'
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
import { GbcImportModal } from '../components/GbcImportModal'
import type { GbcRunResult } from '@shared/gbc'

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

type PanelId = 'prompt' | 'sampler' | 'summary' | 'layers' | 'gallery'
type DockId = 'left' | 'right' | 'float'
const DEFAULT_DOCKS: Record<DockId, PanelId[]> = {
  left: ['prompt', 'sampler', 'gallery'],
  right: ['layers', 'summary'],
  float: [],
}

function DockPanel({
  id,
  title,
  dock,
  onDock,
  children,
}: {
  id: PanelId
  title: string
  dock: DockId
  onDock: (id: PanelId, dock: DockId) => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section
      className="flex min-h-0 flex-col overflow-hidden rounded-[6px] border border-[var(--color-border-subtle)] bg-[var(--color-surface)]/85 shadow-sm backdrop-blur-sm"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        const source = event.dataTransfer.getData('text/moss-panel') as PanelId
        if (source) onDock(source, dock)
      }}
    >
      <div
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData('text/moss-panel', id)
          event.dataTransfer.effectAllowed = 'move'
        }}
        className="flex h-7 shrink-0 cursor-grab items-center gap-1.5 border-b border-[var(--color-border-subtle)] px-2 text-[10px] font-medium text-[var(--color-text-secondary)] active:cursor-grabbing"
      >
        <GripVertical className="size-3 text-[var(--color-text-tertiary)]" />
        {title}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </section>
  )
}

function MiniGallery(): React.JSX.Element {
  const setStudioBackground = useApp((state) => state.setStudioBackground)
  const [items, setItems] = useState<GalleryItem[]>([])
  useEffect(() => {
    void call<{ items: GalleryItem[] }>(Ipc.galleryList, { limit: 8 }).then((page) => setItems(page.items ?? [])).catch(() => undefined)
  }, [])
  return (
    <div className="p-2">
      <div className="grid grid-cols-4 gap-1">
        {items.map((item) => (
          <button
            key={item.path}
            type="button"
            title={item.name}
            onClick={() => setStudioBackground(item)}
            className="aspect-square overflow-hidden rounded border border-white/10 bg-black/20 hover:border-accent-400"
          >
            <img src={cloverUrl(item.path)} alt={item.name} className="size-full object-cover" loading="lazy" />
          </button>
        ))}
        {items.length === 0 ? <span className="col-span-4 py-4 text-center text-[9px] text-[var(--color-text-tertiary)]">画廊为空</span> : null}
      </div>
    </div>
  )
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
  const [tool, setTool] = useState<'select' | 'draw' | 'pan'>('draw')
  const [label, setLabel] = useState<LayoutLabel>('object')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [drawing, setDrawing] = useState<{ start: [number, number]; current: [number, number] } | null>(null)
  const [drag, setDrag] = useState<DragState>(null)
  const [compiled, setCompiled] = useState<CompileResult | null>(null)
  const [jsonOpen, setJsonOpen] = useState(false)
  const [segmentsOpen, setSegmentsOpen] = useState(false)
  const [gbcOpen, setGbcOpen] = useState(false)
  const [docks, setDocks] = useState(DEFAULT_DOCKS)
  const [tabOrder, setTabOrder] = useState<string[]>([])
  const [dragTab, setDragTab] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const panRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)
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
    endPan()
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

  function importGbc(result: GbcRunResult): void {
    const items = result.vertices.flatMap((vertex) => {
      if (!vertex.bbox) return []
      const caption = vertex.descs?.find((desc) => desc.text)?.text?.trim() ?? ''
      const label: LayoutLabel = /\b(girl|boy|woman|man|person|character)\b/i.test(caption) ? 'character' : 'object'
      const bbox = clampBox([
        Math.round(vertex.bbox.left * draft.width),
        Math.round(vertex.bbox.top * draft.height),
        Math.round(vertex.bbox.right * draft.width),
        Math.round(vertex.bbox.bottom * draft.height),
      ], draft.width, draft.height)
      return [{
        id: crypto.randomUUID(),
        label,
        caption: caption || 'GBC 区域',
        bbox,
        visible: true,
        locked: false,
        opacity: 1,
      }]
    })
    setDraft((previous) => ({
      ...previous,
      summary: { ...previous.summary, caption: previous.summary.caption || result.summary },
      items: [...previous.items, ...items],
    }))
    toast.push(`已导入 ${items.length} 个 GBC 区域`, 'success')
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

  const orderedProjects = [
    ...tabOrder.map((id) => projects.find((item) => item.id === id)).filter(Boolean),
    ...projects.filter((item) => !tabOrder.includes(item.id)),
  ] as ProjectSummary[]
  useEffect(() => {
    setTabOrder((previous) => [...previous.filter((id) => projects.some((item) => item.id === id)), ...projects.map((item) => item.id).filter((id) => !previous.includes(id))])
  }, [projects])
  function movePanel(id: PanelId, dock: DockId): void {
    setDocks((previous) => {
      const next: Record<DockId, PanelId[]> = { left: previous.left.filter((item) => item !== id), right: previous.right.filter((item) => item !== id), float: previous.float.filter((item) => item !== id) }
      next[dock] = [...next[dock], id]
      return next
    })
  }
  function pickUpPan(event: React.PointerEvent<HTMLDivElement>): void {
    if (tool !== 'pan') return
    panRef.current = { x: event.clientX, y: event.clientY, ox: pan.x, oy: pan.y }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  function movePan(event: React.PointerEvent<HTMLDivElement>): void {
    if (!panRef.current) return
    setPan({ x: panRef.current.ox + event.clientX - panRef.current.x, y: panRef.current.oy + event.clientY - panRef.current.y })
  }
  function endPan(): void { panRef.current = null }
  function renderPanel(id: PanelId): React.JSX.Element {
    if (id === 'prompt') return (
      <div className="space-y-2 p-3">
        <div className="flex items-center justify-between">
          <span className="text-[9px] text-[var(--color-text-tertiary)]">{prompt.length} 字符</span>
          <button type="button" onClick={() => setSegmentsOpen(true)} className="text-[9px] text-accent-300 hover:underline">分段 / 确认</button>
        </div>
        <Textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="描述画面、文字、风格与布局。" className="h-36 w-full resize-none leading-5" />
        <label className="block text-[9.5px] text-[var(--color-text-tertiary)]">负面提示词</label>
        <Input value={negative} onChange={(event) => setNegative(event.target.value)} className="w-full" />
      </div>
    )
    if (id === 'sampler') return (
      <div className="space-y-2.5 p-3">
        <div className="flex flex-wrap gap-1">
          {SIZE_PRESETS.map(([name, width, height]) => (
            <button key={name} type="button" onClick={() => changeSize(width, height)} className={cn('rounded-full border px-2 py-0.5 text-[9px]', draft.width === width && draft.height === height ? 'border-accent-500/40 bg-accent-500/12 text-accent-200' : 'border-[var(--color-border)] text-[var(--color-text-secondary)]')}>{name}</button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1"><span className="text-[9px] text-[var(--color-text-tertiary)]">宽度</span><Input type="number" min={256} max={2048} step={16} value={draft.width} onChange={(event) => changeSize(Number(event.target.value) || draft.width, draft.height)} /></label>
          <label className="space-y-1"><span className="text-[9px] text-[var(--color-text-tertiary)]">高度</span><Input type="number" min={256} max={2048} step={16} value={draft.height} onChange={(event) => changeSize(draft.width, Number(event.target.value) || draft.height)} /></label>
        </div>
        <div className="flex items-center justify-between"><span className="text-[9.5px]">步数</span><Segmented label="采样步数" value={String(steps)} onChange={(value) => setSteps(Number(value))} options={[{ value: '8', label: '8 DMD' }, { value: '20', label: '20' }, { value: '50', label: '50' }]} /></div>
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1"><span className="text-[9px] text-[var(--color-text-tertiary)]">CFG</span><Input type="number" min={0} max={20} step={0.5} value={cfg} onChange={(event) => setCfg(Number(event.target.value))} /></label>
          <label className="space-y-1"><span className="text-[9px] text-[var(--color-text-tertiary)]">Seed</span><Input type="number" value={seed} onChange={(event) => setSeed(Number(event.target.value))} /></label>
        </div>
        <label className="block space-y-1"><span className="text-[9px] text-[var(--color-text-tertiary)]">实例</span><Select value={instanceId} onChange={(event) => setInstanceId(event.target.value)} className="w-full">{instances.length === 0 ? <option value="">尚未创建实例</option> : null}{instances.map((instance: InstanceInfo) => <option key={instance.id} value={instance.id}>{instance.name} · {instance.runtimeState === 'ready' ? '就绪' : '未装依赖'}</option>)}</Select></label>
      </div>
    )
    if (id === 'summary') return (
      <div className="space-y-2 p-3">
        <label className="space-y-1"><span className="text-[9px] text-[var(--color-text-tertiary)]">整体描述</span><Textarea value={draft.summary.caption} onChange={(event) => setDraft((previous) => ({ ...previous, summary: { ...previous.summary, caption: event.target.value } }))} placeholder="一句话描述整张图。" className="h-16 w-full resize-none" /></label>
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1"><span className="text-[9px] text-[var(--color-text-tertiary)]">meta</span><Input value={draft.summary.meta.join(', ')} onChange={(event) => setDraft((previous) => ({ ...previous, summary: { ...previous.summary, meta: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) } }))} className="w-full" /></label>
          <label className="space-y-1"><span className="text-[9px] text-[var(--color-text-tertiary)]">canvas</span><Select value={draft.summary.canvas} onChange={(event) => setDraft((previous) => ({ ...previous, summary: { ...previous.summary, canvas: event.target.value as LayoutDraft['summary']['canvas'] } }))} className="w-full"><option value="single">single</option><option value="multi_panel">multi_panel</option><option value="collage">collage</option></Select></label>
        </div>
        <Button tone="secondary" className="w-full" onClick={compile}><SquareDashedMousePointer className="size-3.5" /> 编译布局 Prompt</Button>
      </div>
    )
    if (id === 'gallery') return <MiniGallery />
    return (
      <div className="flex h-full flex-col">
        <div className="flex gap-1 overflow-x-auto border-b border-[var(--color-border-subtle)] p-1.5">
          {draft.items.map((item, index) => <button key={item.id} type="button" onClick={() => setSelectedId(item.id)} className={cn('flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[9px]', item.id === selectedId ? 'border-accent-500/50 bg-accent-500/12 text-accent-200' : 'border-[var(--color-border-subtle)]')}>{index + 1}<span className="max-w-[80px] truncate">{item.caption || LABEL_META[item.label].name}</span></button>)}
          <Button tone="ghost" onClick={() => { setTool('draw'); setSelectedId(null) }}><Plus className="size-3" />框</Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {selected ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <Select value={selected.label} onChange={(event) => setItem(selected.id, { label: event.target.value as LayoutLabel })} className="w-[76px]"><option value="object">物体</option><option value="character">人物</option><option value="text">文字</option></Select>
                <button type="button" onClick={() => setItem(selected.id, { visible: selected.visible === false })} title="显示/隐藏">{selected.visible === false ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}</button>
                <button type="button" onClick={() => setItem(selected.id, { locked: !selected.locked })} title="锁定">{selected.locked ? <Lock className="size-3.5" /> : <Unlock className="size-3.5" />}</button>
                <span className="font-mono text-[8.5px] text-[var(--color-text-tertiary)]">{selected.bbox.map((value) => Math.round(value)).join(',')}</span>
                <button type="button" onClick={() => removeItem(selected.id)} className="ml-auto text-[var(--color-text-tertiary)] hover:text-red-400"><X className="size-3.5" /></button>
              </div>
              <Textarea value={selected.caption} onChange={(event) => setItem(selected.id, { caption: event.target.value })} placeholder="区域提示词" className="h-20 w-full resize-none" />
              {selected.label === 'text' ? <Input value={selected.text ?? ''} onChange={(event) => setItem(selected.id, { text: event.target.value })} placeholder="图中文字" className="w-full border-amber-500/30" /> : null}
              <label className="flex items-center gap-2 text-[9px] text-[var(--color-text-tertiary)]">不透明度<input type="range" min={0.1} max={1} step={0.05} value={selected.opacity ?? 1} onChange={(event) => setItem(selected.id, { opacity: Number(event.target.value) })} className="flex-1 accent-[var(--color-accent)]" /></label>
            </div>
          ) : <div className="flex h-full items-center justify-center text-center text-[9.5px] text-[var(--color-text-tertiary)]">选中画布区域后在这里编辑图层</div>}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-[calc(100vh-96px)] min-h-[620px] flex-col gap-2 overflow-hidden pb-2">
      <div className="flex shrink-0 items-center gap-2 rounded-[6px] border border-[var(--color-border-subtle)] bg-[var(--color-surface)]/80 px-2 py-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {orderedProjects.map((item) => {
            const current = item.id === projectId
            const status = current && projectSaving ? '保存中' : current ? '已保存' : '已保存'
            return (
              <button
                key={item.id}
                type="button"
                draggable
                onDragStart={() => setDragTab(item.id)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  if (!dragTab || dragTab === item.id) return
                  setTabOrder((previous) => {
                    const next = previous.filter((id) => id !== dragTab)
                    const at = next.indexOf(item.id)
                    next.splice(at < 0 ? next.length : at, 0, dragTab)
                    return next
                  })
                  setDragTab(null)
                }}
                onClick={() => { if (!current) void openProject(item.id) }}
                className={cn(
                  'flex h-7 max-w-[210px] shrink-0 items-center gap-1.5 rounded-t-[5px] border-b-2 px-2.5 text-[10.5px] transition',
                  current ? 'border-accent-400 bg-white/[0.07] text-[var(--color-text)]' : 'border-transparent text-[var(--color-text-secondary)] hover:bg-white/[0.04]',
                )}
                title={item.name}
              >
                <span className="truncate">{item.name || '未命名画布'}</span>
                <span className={cn('shrink-0 text-[8px]', status === '保存中' ? 'text-amber-300' : 'text-[var(--color-text-tertiary)]')}>{status}</span>
              </button>
            )
          })}
          {!projectId ? (
            <div className="flex h-7 shrink-0 items-center gap-1.5 rounded-t-[5px] border-b-2 border-accent-400 bg-white/[0.07] px-2.5 text-[10.5px]">
              <span className="max-w-[180px] truncate">{projectName.trim() || '未命名画布'}</span>
              <span className="text-[8px] text-amber-300">未保存</span>
            </div>
          ) : null}
          {orderedProjects.length === 0 && projectId ? <span className="px-2 text-[9.5px] text-[var(--color-text-tertiary)]">还没有画布</span> : null}
        </div>
        <Button tone="secondary" onClick={newProject}><Plus className="size-3.5" /> 新建画布</Button>
        {env ? <Pill tone="blue">{env.recommendation.width}² · {env.recommendation.steps} 步</Pill> : null}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[300px_minmax(0,1fr)_300px] gap-2">
        <aside
          className="flex min-h-0 flex-col gap-2 overflow-y-auto pr-0.5"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => { const id = event.dataTransfer.getData('text/moss-panel') as PanelId; if (id) movePanel(id, 'left') }}
        >
          {docks.left.map((id) => (
            <DockPanel key={id} id={id} dock="left" onDock={movePanel} title={{ prompt: '提示词', sampler: '生成参数', gallery: '图库', summary: '布局总览', layers: '图层' }[id]}>
              {renderPanel(id)}
            </DockPanel>
          ))}
          {docks.left.length === 0 ? <div className="rounded border border-dashed p-4 text-center text-[9.5px] text-[var(--color-text-tertiary)]">把面板拖到这里</div> : null}
        </aside>

        <section className="relative flex min-h-0 flex-col overflow-hidden rounded-[6px] border border-[var(--color-border-subtle)] bg-[var(--color-surface)]/60">
          <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-[var(--color-border-subtle)] px-2 py-1.5">
            <Segmented label="画布工具" value={tool} onChange={(value) => setTool(value as 'select' | 'draw' | 'pan')} options={[{ value: 'select', label: '选择' }, { value: 'draw', label: '画框' }, { value: 'pan', label: '手型' }]} />
            <Segmented value={label} onChange={(value) => setLabel(value as LayoutLabel)} options={[{ value: 'object', label: '物体' }, { value: 'character', label: '人物' }, { value: 'text', label: '文字' }]} />
            <IconButton label="GBC 图像解析" onClick={() => setGbcOpen(true)}><ScanSearch className="size-3.5" /></IconButton>
            <IconButton label="示例布局" onClick={() => { setDraft(exampleDraft()); setSelectedId(null) }}><Sparkles className="size-3.5" /></IconButton>
            <IconButton label="清空画布" onClick={() => { setDraft(createDraft(draft.width, draft.height)); setSelectedId(null) }}><Eraser className="size-3.5" /></IconButton>
            {background ? <IconButton label="清除底图" onClick={() => setStudioBackground(null)}><X className="size-3.5" /></IconButton> : null}
            <div className="ml-auto flex items-center gap-1.5">
              <Pill tone={backend?.ready ? 'accent' : 'amber'}>{backend?.ready ? '后端就绪' : '后端启动中'}</Pill>
              <Button tone="primary" onClick={() => void generate()}><span className="inline-flex items-center gap-1.5">开始生成 <ArrowRight className="size-3.5" /></span></Button>
            </div>
          </div>

          <div
            className="relative min-h-0 flex-1 overflow-hidden bg-[#121419]"
            onWheel={(event) => { event.preventDefault(); setZoom((value) => Math.min(2.5, Math.max(0.3, value - event.deltaY * 0.001))) }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => { const id = event.dataTransfer.getData('text/moss-panel') as PanelId; if (id) movePanel(id, 'float') }}
          >
            <div className="absolute inset-0 flex items-center justify-center p-4">
              <div style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }} className="relative w-full max-w-[820px]">
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
              </div>
            </div>
            <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/45 px-2.5 py-1 text-[8.5px] text-white/55">
              {Math.round(zoom * 100)}% · 滚轮缩放 · 手型/中键拖动
            </div>
            {docks.float.length > 0 ? (
              <div className="absolute right-2 top-2 z-20 flex max-h-[82%] w-[290px] flex-col gap-2 overflow-y-auto">
                {docks.float.map((id) => (
                  <DockPanel key={id} id={id} dock="float" onDock={movePanel} title={{ prompt: '提示词', sampler: '生成参数', gallery: '图库', summary: '布局总览', layers: '图层' }[id]}>
                    {renderPanel(id)}
                  </DockPanel>
                ))}
              </div>
            ) : null}
          </div>
        </section>

        <aside
          className="flex min-h-0 flex-col gap-2 overflow-y-auto pl-0.5"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => { const id = event.dataTransfer.getData('text/moss-panel') as PanelId; if (id) movePanel(id, 'right') }}
        >
          {docks.right.map((id) => (
            <DockPanel key={id} id={id} dock="right" onDock={movePanel} title={{ prompt: '提示词', sampler: '生成参数', gallery: '图库', summary: '布局总览', layers: '图层' }[id]}>
              {renderPanel(id)}
            </DockPanel>
          ))}
          {docks.right.length === 0 ? <div className="rounded border border-dashed p-4 text-center text-[9.5px] text-[var(--color-text-tertiary)]">把面板拖到这里</div> : null}
        </aside>
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

      <GbcImportModal
        open={gbcOpen}
        onClose={() => setGbcOpen(false)}
        onImport={importGbc}
      />

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
