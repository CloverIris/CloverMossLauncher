import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { paths } from '../lib/paths'

/**
 * Inference no longer uses official-repo instances, Python runtimes or the
 * MOSS git mirror. Keep one archived copy for manual recovery instead of
 * silently running against stale state.
 */
export function archiveLegacyInferenceData(): { archived: boolean; archive?: string } {
  const marker = join(paths.root(), '.legacy-inference-archived')
  if (existsSync(marker)) return { archived: false }
  const items = [
    ['instances', paths.instances()],
    ['runtimes', paths.runtimes()],
    ['git', paths.git()],
  ] as const
  const present = items.filter(([, path]) => existsSync(path))
  if (present.length) {
    const archive = join(paths.root(), `legacy-inference-${new Date().toISOString().slice(0, 10)}`)
    mkdirSync(archive, { recursive: true })
    for (const [name, path] of present) {
      renameSync(path, join(archive, name))
    }
    writeFileSync(join(archive, 'README.txt'), 'Archived by MossStudio after switching inference to MossInfer. Trainer data is stored under trainer/ and is not included.\n', 'utf8')
    writeFileSync(marker, JSON.stringify({ archivedAt: new Date().toISOString(), archive }, null, 2), 'utf8')
    return { archived: true, archive }
  }
  writeFileSync(marker, JSON.stringify({ archivedAt: new Date().toISOString() }, null, 2), 'utf8')
  return { archived: false }
}
