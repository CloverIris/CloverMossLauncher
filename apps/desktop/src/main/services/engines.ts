import { existsSync } from 'node:fs'
import { resolveServerPath, probeMossInfer } from './mossInfer'
import { getSettings } from './settings'
import { getTrainingHost } from './trainingHosts'
import { remoteEngineStatus } from './remoteEngine'

export interface LocalEngineInfo {
  available: boolean
  path: string | null
  version?: string
  error?: string
}

export function localEngineInfo(): LocalEngineInfo {
  const path = resolveServerPath(getSettings())
  if (!path) return { available: false, path: null, error: '未找到 moss-server；请下载引擎或设置路径' }
  return { available: existsSync(path), path }
}

export async function probeLocalEngine(): Promise<Record<string, unknown>> {
  const path = resolveServerPath(getSettings())
  if (!path || !existsSync(path)) throw new Error('未找到 moss-server')
  return probeMossInfer(path)
}

export async function remoteEngineInfo(hostId: string): Promise<{ available: boolean; path: string; error?: string }> {
  const host = getTrainingHost(getSettings(), hostId)
  if (!host) throw new Error('主机不存在')
  if (host.kind !== 'ssh') throw new Error('不是 SSH 主机')
  return remoteEngineStatus(host)
}
