import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { ProjectDocument, ProjectSummary } from '@shared/types'
import { paths } from '../lib/paths'

function projectsRoot(): string {
  return join(paths.root(), 'projects')
}

function projectDir(id: string): string {
  return join(projectsRoot(), id)
}

function projectFile(id: string): string {
  return join(projectDir(id), 'project.json')
}

function readProject(id: string): ProjectDocument | null {
  try {
    const raw = JSON.parse(readFileSync(projectFile(id), 'utf8')) as ProjectDocument
    return raw && raw.schemaVersion === 1 ? raw : null
  } catch {
    return null
  }
}

function writeProject(project: ProjectDocument): void {
  mkdirSync(join(projectDir(project.id), 'assets'), { recursive: true })
  writeFileSync(projectFile(project.id), JSON.stringify(project, null, 2), 'utf8')
}

function summary(project: ProjectDocument): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    width: project.width,
    height: project.height,
    layerCount: project.layers.length,
    seriesId: project.seriesId,
    page: project.page,
    updatedAt: project.updatedAt,
  }
}

export function listProjects(): ProjectSummary[] {
  try {
    return readdirSync(projectsRoot(), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => readProject(entry.name))
      .filter((project): project is ProjectDocument => Boolean(project))
      .map(summary)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  } catch {
    return []
  }
}

export function getProject(id: string): ProjectDocument | null {
  return readProject(id)
}

export interface SaveProjectInput {
  id?: string
  name: string
  width: number
  height: number
  summary: ProjectDocument['summary']
  layers: ProjectDocument['layers']
  prompt: string
  negative: string
  seed: number
  steps: number
  cfg: number
  instanceId?: string
  backgroundPath?: string
  seriesId?: string
  page?: number
}

export function saveProject(input: SaveProjectInput): ProjectDocument {
  const existing = input.id ? readProject(input.id) : null
  const now = new Date().toISOString()
  const id = existing?.id ?? `project-${randomUUID().slice(0, 8)}`
  let backgroundPath = input.backgroundPath
  if (backgroundPath && existsSync(backgroundPath)) {
    const assets = join(projectDir(id), 'assets')
    mkdirSync(assets, { recursive: true })
    const target = join(assets, basename(backgroundPath))
    if (backgroundPath !== target && !existsSync(target)) copyFileSync(backgroundPath, target)
    backgroundPath = target
  }
  const project: ProjectDocument = {
    schemaVersion: 1,
    id,
    name: input.name.trim() || '未命名 Project',
    width: input.width,
    height: input.height,
    summary: input.summary,
    layers: input.layers,
    prompt: input.prompt,
    negative: input.negative,
    seed: input.seed,
    steps: input.steps,
    cfg: input.cfg,
    instanceId: input.instanceId,
    backgroundPath,
    seriesId: input.seriesId?.trim() || existing?.seriesId || undefined,
    page: input.page ?? existing?.page ?? 1,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  writeProject(project)
  return project
}

export function deleteProject(id: string): void {
  if (!existsSync(projectDir(id))) return
  rmSync(projectDir(id), { recursive: true, force: true })
}
