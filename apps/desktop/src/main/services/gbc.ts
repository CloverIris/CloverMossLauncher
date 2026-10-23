import { existsSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { GbcGraph, GbcRunInput, GbcRunResult, GbcVertex } from '@shared/gbc'
import { paths } from '../lib/paths'
import { firstLine, run, tail } from '../lib/run'
import { getProviderSecret } from './ai'
import { listGbcVersions } from './gbcGit'
import { getSettings } from './settings'

function detectorModel(detector: GbcRunInput['detector']): string {
  return detector === 'sam3' ? 'facebook/sam3' : 'google/owlv2-base-patch16-ensemble'
}

export interface GbcCheck {
  id: string
  label: string
  ok: boolean
  detail: string
}

export interface GbcStatus {
  available: boolean
  version?: string
  error?: string
  python?: string
  venv?: string
  checks: GbcCheck[]
  versionId?: string
}

function versionBinary(version: { path: string }): string {
  return process.platform === 'win32' ? join(version.path, '.venv', 'Scripts', 'gbc.exe') : join(version.path, '.venv', 'bin', 'gbc')
}
function versionPython(version: { path: string }): string {
  return process.platform === 'win32' ? join(version.path, '.venv', 'Scripts', 'python.exe') : join(version.path, '.venv', 'bin', 'python')
}

export async function gbcStatus(versionId?: string): Promise<GbcStatus> {
  const settings = getSettings()
  const version = versionId ? (await listGbcVersions(settings)).find((item) => item.id === versionId) : null
  const bundled = version ? versionBinary(version) : ''
  const venvPython = version ? versionPython(version) : ''
  const external = process.env['CLOVER_GBC_BIN'] || 'gbc'
  const binary = bundled && existsSync(bundled) ? bundled : external
  const checks: GbcCheck[] = []
  const add = (id: string, label: string, ok: boolean, detail: string): void => { checks.push({ id, label, ok, detail }) }

  add('clone', 'GBC 版本/代码', Boolean(version) || Boolean(process.env['CLOVER_GBC_BIN']), version ? version.path : '未选择克隆版本')
  const help = await run(binary, ['--help'], { timeoutMs: 8000 })
  add('binary', 'gbc 可执行文件', help.code === 0, help.code === 0 ? firstLine(help.stdout).slice(0, 160) : (help.stderr || help.stdout).trim().slice(-300) || `exit ${help.code}`)
  const python = venvPython && existsSync(venvPython) ? venvPython : settings.pythonPath || 'python3'
  const py = await run(python, ['--version'], { timeoutMs: 8000 })
  add('python', 'Python 环境', py.code === 0, (py.stdout || py.stderr).trim() || '未找到 Python')
  const imports = await run(python, ['-c', 'import torch, transformers, kohakugbc; print("torch", torch.__version__); print("transformers", transformers.__version__)'], { timeoutMs: 15_000 })
  add('deps', 'torch / transformers / kohakugbc', imports.code === 0, imports.code === 0 ? imports.stdout.trim().slice(-500) : (imports.stderr || imports.stdout).trim().slice(-500) || '依赖导入失败')
  const gpu = await run('nvidia-smi', ['-L'], { timeoutMs: 5000 })
  add('gpu', 'NVIDIA CUDA', gpu.code === 0, gpu.code === 0 ? firstLine(gpu.stdout) : '未检测到 NVIDIA（GBC 会回退 CPU，较慢）')

  return {
    available: help.code === 0 && imports.code === 0,
    version: version ? `${version.name} · ${version.shortCommit}` : firstLine(help.stdout).slice(0, 120) || undefined,
    error: help.code === 0 && imports.code === 0 ? undefined : 'GBC 尚未安装完整环境；请查看下方检查项并安装环境。',
    python,
    venv: version ? join(version.path, '.venv') : undefined,
    checks,
    versionId: version?.id,
  }
}

export async function installGbcEnv(versionId: string): Promise<{ ok: boolean; output: string; status: GbcStatus }> {
  const settings = getSettings()
  const version = (await listGbcVersions(settings)).find((item) => item.id === versionId)
  if (!version) throw new Error('GBC 版本不存在')
  const base = settings.pythonPath || (process.platform === 'win32' ? 'python' : 'python3')
  const venv = join(version.path, '.venv')
  const py = versionPython(version)
  const lines: string[] = []
  const runStep = async (command: string, args: string[], timeoutMs: number): Promise<void> => {
    const result = await run(command, args, { cwd: version.path, timeoutMs })
    lines.push(`$ ${command} ${args.join(' ')}`)
    if (result.stdout) lines.push(result.stdout.trim())
    if (result.stderr) lines.push(result.stderr.trim())
    if (result.code !== 0) throw new Error(`安装步骤失败：${tail(result.stderr || result.stdout, 30)}`)
  }
  if (!existsSync(py)) await runStep(base, ['-m', 'venv', venv], 180_000)
  await runStep(py, ['-m', 'pip', 'install', '--upgrade', 'pip'], 300_000)
  const local = await run(py, ['-c', 'import pathlib; print(pathlib.Path("pyproject.toml").exists())'], { cwd: version.path, timeoutMs: 5000 })
  if (local.stdout.trim() === 'True') await runStep(py, ['-m', 'pip', 'install', '-e', '.[torch]'], 30 * 60_000)
  else await runStep(py, ['-m', 'pip', 'install', 'kohakugbc[torch]'], 30 * 60_000)
  return { ok: true, output: lines.join('\n').slice(-12000), status: await gbcStatus(versionId) }
}

function configFor(input: GbcRunInput, provider: { kind: string; baseUrl: string; model: string }, out: string, keyEnv: string, device: string): string {
  const protocol = provider.kind === 'anthropic' ? 'anthropic' : 'openai'
  const dtype = device === 'cpu' ? 'float32' : 'float16'
  const source = JSON.stringify(input.folder)
  const outJson = JSON.stringify(out)
  return `# generated by MossStudio GBC bridge
engines = {
    "vlm": {
        "entry": "api",
        "protocol": ${JSON.stringify(protocol)},
        "flavour": "vllm",
        "model": ${JSON.stringify(provider.model)},
        "endpoints": [{"base_url": ${JSON.stringify(provider.baseUrl)}, "api_key_env": ${JSON.stringify(keyEnv)}, "max_inflight": 16}],
        "timeout_s": 180,
    },
    "detect": {"entry": "torch", "model": ${JSON.stringify(detectorModel(input.detector))}, "dtype": ${JSON.stringify(dtype)}, "devices": [${JSON.stringify(device)}], "max_batch": 4},
    "embed": {"entry": "torch", "devices": [${JSON.stringify(device)}], "max_batch": 16},
    "cpu": {"entry": "python", "workers": 4},
}
machine = {"vlm_waiting": 16, "report": ${JSON.stringify(join(out, 'report'))}}
source = {"kind": "folder", "path": ${source}}
sink = {"kind": "graphs", "path": ${JSON.stringify(join(out, 'graphs.jsonl'))}}
`
}

export async function runGbc(input: GbcRunInput): Promise<GbcRunResult> {
  if (!input.folder.trim() || !existsSync(input.folder)) throw new Error('GBC 图片目录不存在')
  const provider = getProviderSecret(input.providerId)
  if (!provider) throw new Error('请先在 Agent 设置中配置一个 AI Provider')
  if (!provider.apiKey) throw new Error('GBC 的 API Provider 需要 API Key')
  const gpu = (await run('nvidia-smi', ['-L'], { timeoutMs: 5000 })).code === 0
  const device = gpu ? 'cuda:0' : 'cpu'
  const id = `gbc-${randomUUID().slice(0, 8)}`
  const out = join(paths.root(), 'gbc', id)
  await mkdir(out, { recursive: true })
  const keyEnv = 'MOSSTUDIO_GBC_API_KEY'
  const configPath = join(out, 'machine.py')
  await writeFile(configPath, configFor(input, provider, out, keyEnv, device), 'utf8')
  const version = input.versionId ? (await listGbcVersions(getSettings())).find((item) => item.id === input.versionId) : null
  const bundled = version ? versionBinary(version) : ''
  const command = bundled && existsSync(bundled) ? bundled : process.env['CLOVER_GBC_BIN'] || 'gbc'
  const result = await run(command, ['run', configPath], {
    cwd: version?.path ?? out,
    env: { [keyEnv]: provider.apiKey, PYTHONUNBUFFERED: '1' },
    timeoutMs: 30 * 60_000,
  })
  const graphsFile = join(out, 'graphs.jsonl')
  if (result.code !== 0 || !existsSync(graphsFile)) {
    throw new Error(`GBC 运行失败：${tail(result.stderr || result.stdout, 20) || `exit ${result.code}`}`)
  }
  const lines = readFileSync(graphsFile, 'utf8').split('\n').filter(Boolean)
  if (!lines.length) throw new Error('GBC 没有输出 graph')
  const graphs = lines.map((line) => JSON.parse(line) as GbcGraph)
  const graph = graphs[0]
  const vertices = (graph?.vertices ?? []).filter((vertex) => vertex.label !== 'image')
  const image = graph?.vertices?.find((vertex) => vertex.label === 'image')
  const summary = image?.descs?.[0]?.text ?? ''
  return {
    id,
    outputDir: out,
    graphCount: graphs.length,
    vertexCount: graph?.vertices?.length ?? 0,
    summary,
    vertices: vertices.map((vertex) => ({
      ...vertex,
      bbox: vertex.bbox ? {
        left: vertex.bbox.left,
        top: vertex.bbox.top,
        right: vertex.bbox.right,
        bottom: vertex.bbox.bottom,
        confidence: vertex.bbox.confidence ?? null,
      } : undefined,
    })),
  }
}
