import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { run } from '../lib/run'

export interface SystemCudaStatus {
  supported: boolean
  gpu: string
  cublasLt: string[]
  flavours: Array<'cu12' | 'cu13'>
  preferredFlavour?: 'cu12' | 'cu13'
  error?: string
}

function windowsCudaRoots(): string[] {
  const roots: string[] = []
  if (process.env['CUDA_PATH']) roots.push(process.env['CUDA_PATH'])
  const base = process.env['ProgramFiles'] ? join(process.env['ProgramFiles'], 'NVIDIA GPU Computing Toolkit', 'CUDA') : ''
  if (process.env['SystemRoot']) roots.push(join(process.env['SystemRoot'], 'System32'))
  if (base) {
    try {
      for (const entry of readdirSync(base, { withFileTypes: true })) {
        if (entry.isDirectory() && /^v?1[23]\./i.test(entry.name)) roots.push(join(base, entry.name))
      }
    } catch { /* no CUDA toolkit */ }
  }
  return roots
}

export async function detectSystemCuda(): Promise<SystemCudaStatus> {
  if (process.platform === 'darwin') {
    return { supported: false, gpu: '', cublasLt: [], flavours: [], error: 'macOS 没有 NVIDIA CUDA / cuBLASLt' }
  }
  const gpu = await run('nvidia-smi', ['--query-gpu=name,driver_version', '--format=csv,noheader'], { timeoutMs: 6000 })
  const libs: string[] = []
  if (process.platform === 'win32') {
    for (const root of windowsCudaRoots()) {
      const bin = join(root, 'bin')
      try {
        for (const name of readdirSync(bin)) if (/^cublasLt64_\d+\.dll$/i.test(name)) libs.push(join(bin, name))
      } catch { /* ignore */ }
    }
    for (const part of (process.env['PATH'] ?? '').split(';')) {
      try {
        for (const name of readdirSync(part)) if (/^cublasLt64_\d+\.dll$/i.test(name)) libs.push(join(part, name))
      } catch { /* ignore */ }
    }
  } else {
    const ld = await run('ldconfig', ['-p'], { timeoutMs: 6000 })
    for (const line of ld.stdout.split('\n')) {
      if (/libcublasLt\.so\.(12|13)\b/.test(line)) libs.push(line.trim())
    }
    if (!libs.length) {
      const find = await run('find', ['/usr/local/cuda', '/usr/lib', '/lib', '/opt/cuda/lib64', '/opt/cuda/targets', '-name', 'libcublasLt.so.*'], { timeoutMs: 6000 })
      for (const line of find.stdout.split('\n')) if (line.trim()) libs.push(line.trim())
    }
  }
  const flavours: Array<'cu12' | 'cu13'> = []
  if (libs.some((path) => /(?:so\.12|64_12\.dll|cuda-12|v12\.)/i.test(path))) flavours.push('cu12')
  if (libs.some((path) => /(?:so\.13|64_13\.dll|cuda-13|v13\.)/i.test(path))) flavours.push('cu13')
  return {
    supported: gpu.code === 0 && libs.length > 0,
    gpu: gpu.stdout.trim(),
    cublasLt: [...new Set(libs)].slice(0, 8),
    flavours,
    preferredFlavour: flavours.includes('cu13') ? 'cu13' : flavours.includes('cu12') ? 'cu12' : undefined,
    error: gpu.code !== 0 ? '未检测到 NVIDIA GPU / nvidia-smi' : libs.length ? undefined : '系统未找到 libcublasLt',
  }
}
