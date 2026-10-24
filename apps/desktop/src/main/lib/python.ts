import { run } from './run'

export async function pythonVersion(path: string): Promise<string | null> {
  const result = await run(path, ['--version'], { timeoutMs: 5000 })
  if (result.code !== 0) return null
  const version = `${result.stdout}${result.stderr}`.match(/Python\s+(\d+\.\d+\.\d+)/)?.[1]
  if (!version) return null
  const [major, minor] = version.split('.').map(Number)
  return major === 3 && minor! >= 10 ? version : null
}
