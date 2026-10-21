import { app, dialog, nativeTheme, protocol } from 'electron'
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runModelManagementTests } from './modelManagement.test'
import { runModelManagementUi } from './modelManagementUi.test'
import { ensureDirs, paths } from './lib/paths'
import { getBackendInfo, getWebAccessInfo, startBackend, stopBackend } from './services/backend'
import { listProviders, removeProvider, saveProvider } from './services/ai'
import type { JobRecord } from '@shared/types'
import { compareSemver, findInstaller, parseReleaseMarkdown } from '@shared/release'
import { downloadUpdate } from './services/updateDownload'
import { localNotificationsSupported, pushTestNotification } from './services/desktopNotifications'
import { checkBareMirror } from './services/gitHealth'
import WebSocket from 'ws'
import { ensureMirror, listBranches, listCommits } from './services/git'
import { createInstance, deleteInstance, listInstances, updateInstance } from './services/instances'
import { installDeps, readRuntime, resolveTorchIndex, writeRemoteRuntime } from './services/runtimes'
import { cancelJob, getJob, getJobLogs, onJobCompleted, startJob, startTrainingJob } from './services/supervisor'
import { createTrainerVersion, listTrainerVersions, startTrainerRun } from './services/trainers'
import { listLaunchRows, removeLaunchRow, upsertLaunchRow } from './services/launchQueue'
import { listCases, removeCase, saveCase } from './services/cases'
import { deleteProject, getProject, listProjects, saveProject } from './services/projects'
import { listTrainerBranches, listTrainerCommits } from './services/trainerGit'
import { listManagedHosts, listTrainingHosts, removeTrainingHost, saveTrainingHost, testManagedHost, testTrainingHost, updateTrainingHostVersions } from './services/trainingHosts'
import {
  remoteBranches,
  remoteCommits,
  remoteCreateVersion,
  remoteDoctor,
  remoteInstallRuntime,
  remoteRemoveVersion,
  remoteVersions,
} from './services/remoteTrainer'
import { run } from './lib/run'
import { matchRule, parseTqdm } from './services/parsers'
import { registerIpc } from './ipc'
import { scanEnvironment } from './services/env'
import { getSettings, updateSettings } from './services/settings'
import { collectTrainerArtifact } from './services/trainerArtifacts'
import { checkUpdates } from './services/updates'
import { downloadCustomModel, getCatalog, listDownloads } from './services/models'
import { registerGalleryProtocol } from './services/gallery'
import { createAppWindow, getWindow, openWindow } from './windows'

const isDev = !app.isPackaged
const smoke = process.argv.includes('--smoke')
const screenshot = process.argv.includes('--screenshot')
const scenario = process.argv.find((arg) => arg.startsWith('--scenario='))?.split('=')[1]

if (isDev) {
  // Keep dev data inside the checkout: easier to inspect, reset and sandbox-friendly.
  app.setPath('userData', join(app.getAppPath(), '..', '..', '.dev-data'))
}
if (scenario?.startsWith('model-management')) app.setPath('userData', join(tmpdir(), `clover-model-management-${process.pid}`))
app.setName('MossStudio')
if (process.platform === 'win32') app.setAppUserModelId('com.mossstudio.app')
nativeTheme.themeSource = 'dark'

protocol.registerSchemesAsPrivileged([
  { scheme: 'clover', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
])

const noSandbox = process.env['CLOVER_NO_SANDBOX'] === '1' || smoke || screenshot || Boolean(scenario)
if (noSandbox) {
  // The harness/CI sandbox cannot initialize Chromium's zygote sandbox. End-user builds keep it on.
  app.commandLine.appendSwitch('no-sandbox')
}
if (smoke || screenshot) {
  // Headless captures do not need GPU; keeping it off also avoids Chromium GPU-process noise.
  app.disableHardwareAcceleration()
}

async function runSmoke(): Promise<void> {
  const settings = getSettings()
  const started = Date.now()
  const [env, updates, catalog] = await Promise.all([
    scanEnvironment(settings),
    checkUpdates(settings),
    getCatalog(settings),
  ])
  console.log(
    JSON.stringify(
      {
        smoke: true,
        elapsedMs: Date.now() - started,
        platform: process.platform,
        arch: process.arch,
        gpu: env.gpu,
        pythons: env.pythons.map((python) => `${python.version} (${python.source})`),
        checks: env.checks.map((check) => `${check.id}:${check.status}`),
        recommendation: env.recommendation,
        network: env.network.selected,
        updates: {
          source: updates.manifestSource,
          current: updates.currentVersion,
          latest: updates.latestVersion,
          announcements: updates.announcements.length,
          error: updates.error,
        },
        catalog: {
          source: catalog.source,
          models: catalog.models.length,
          adapters: catalog.adapters.length,
        },
      },
      null,
      2,
    ),
  )
  app.exit(0)
}

app.whenReady().then(async () => {
  ensureDirs(getSettings().modelsRoot)
  onJobCompleted((job) => {
    if (job.kind === 'training' && job.state === 'succeeded') void collectTrainerArtifact(job)
  })
  registerGalleryProtocol()
  registerIpc()
  if (scenario === 'model-management') {
    try { await runModelManagementTests(); app.exit(0) }
    catch (error) { console.error(error); app.exit(1) }
    return
  }
  await startBackend()
  if (scenario === 'model-management-ui') {
    try { await runModelManagementUi(); app.exit(0) }
    catch (error) { console.error(error); app.exit(1) }
    return
  }

  if (smoke) {
    await runSmoke().catch((error) => {
      console.error(error)
      app.exit(1)
    })
    return
  }

  if (scenario === 'mirror-health') {
    const base = join(app.getPath('temp'), `clover-mirror-health-${process.pid}`)
    try {
      mkdirSync(base, { recursive: true })
      const src = join(base, 'src')
      const good = join(base, 'good.git')
      const empty = join(base, 'empty.git')
      mkdirSync(src, { recursive: true })
      writeFileSync(join(src, 'a.txt'), 'a')
      await run('git', ['init', src])
      await run('git', ['-C', src, 'config', 'user.email', 'test@example.com'])
      await run('git', ['-C', src, 'config', 'user.name', 'Test'])
      await run('git', ['-C', src, 'add', 'a.txt'])
      await run('git', ['-C', src, 'commit', '-m', 'init'])
      await run('git', ['clone', '--bare', src, good])
      await run('git', ['init', '--bare', empty])

      const emptyHealth = await checkBareMirror(empty)
      const goodHealth = await checkBareMirror(good)
      writeFileSync(join(good, 'HEAD'), 'ref: refs/heads/.invalid\n')
      const invalidHeadButBranchHealth = await checkBareMirror(good)
      rmSync(join(good, 'refs', 'heads'), { recursive: true, force: true })
      rmSync(join(good, 'packed-refs'), { force: true })
      const brokenHealth = await checkBareMirror(good)

      const source = `file://${src}`
      await ensureMirror(getSettings(), source)
      const branches = await listBranches(source)
      let missingSourceError = ''
      try {
        await listBranches(`https://example.invalid/nonexistent-${process.pid}.git`)
      } catch (error) {
        missingSourceError = error instanceof Error ? error.message : String(error)
      }

      const sourceMirror = paths.mirrorForSource(source)
      const result = {
        scenario: 'mirror-health',
        emptyHealthy: emptyHealth.healthy,
        goodHealthy: goodHealth.healthy,
        invalidHeadButBranchHealthy: invalidHeadButBranchHealth.healthy,
        brokenHealthy: brokenHealth.healthy,
        customSourceBranches: branches.map((branch) => branch.name),
        customMirrorDistinct: sourceMirror !== paths.mirror(),
        customMirrorExists: existsSync(sourceMirror),
        missingSourceError: missingSourceError.slice(0, 120),
      }
      console.log(JSON.stringify(result, null, 2))
      app.exit(
        !emptyHealth.healthy &&
          goodHealth.healthy &&
          invalidHeadButBranchHealth.healthy &&
          !brokenHealth.healthy &&
          branches.some((branch) => branch.name === 'main') &&
          sourceMirror !== paths.mirror() &&
          existsSync(sourceMirror) &&
          Boolean(missingSourceError)
          ? 0
          : 1,
      )
    } catch (error) {
      console.error(error)
      app.exit(1)
    } finally {
      rmSync(base, { recursive: true, force: true })
      rmSync(paths.mirrorForSource(`file://${join(base, 'src')}`), { recursive: true, force: true })
    }
    return
  }

  if (scenario === 'notification-test') {
    const supported = localNotificationsSupported()
    const shown = supported ? pushTestNotification() : false
    console.log(JSON.stringify({ scenario: 'notification-test', supported, shown }, null, 2))
    setTimeout(() => app.exit(shown ? 0 : 1), 1200)
    return
  }

  if (scenario === 'model-catalog-fp16') {
    try {
      const catalog = await getCatalog(getSettings(), true)
      const entries = catalog.models.filter((model) => model.id.includes('fp16-fixed'))
      console.log(
        JSON.stringify(
          {
            scenario: 'model-catalog-fp16',
            models: catalog.models.length,
            entries: entries.map((model) => ({
              id: model.id,
              role: model.role,
              precision: model.precision,
              sizeBytes: model.sizeBytes,
              files: model.files,
              installed: model.installed,
            })),
          },
          null,
          2,
        ),
      )
      app.exit(
        entries.length === 4 &&
          entries.every((entry) => entry.role === 'dit' && entry.precision === 'fp16' && entry.files?.length === 1)
          ? 0
          : 1,
      )
    } catch (error) {
      console.error(error)
      app.exit(1)
    }
    return
  }

  if (scenario === 'release-parse') {
    const machine = {
      schema_version: 2,
      app: {
        name: 'MossStudio',
        channel: 'stable',
        version: '0.2.0',
        min_supported: '0.1.0',
        published_at: '2026-10-20T00:00:00Z',
        notes_url: 'https://example.com/release',
      },
      home: {
        chapter: '万象初绘',
        title: '一念落纸上，万象入画来。',
        subtitle: '开始今天的创作。',
      },
      installers: [
        {
          platform: 'darwin',
          arch: 'arm64',
          kind: 'dmg',
          url: 'https://example.com/MossStudio-0.2.0.dmg',
          sha256: 'a'.repeat(64),
          size_bytes: 1234,
        },
      ],
      catalog: {
        updated_at: '2026-10-20T00:00:00Z',
        models_url: 'https://example.com/models.json',
        models_sha256: 'b'.repeat(64),
      },
      announcements: [
        {
          id: 'test',
          level: 'info',
          title: 'test announcement',
          body_markdown: 'hello',
        },
      ],
    }
    const markdown = `# MossStudio 0.2.0\n\nRelease notes.\n\n\`\`\`json clover-release\n${JSON.stringify(machine, null, 2)}\n\`\`\``
    try {
      const parsed = parseReleaseMarkdown(markdown)
      const legacyMachine = Object.fromEntries(
        Object.entries(machine).filter(([key]) => key !== 'home'),
      )
      const legacy = parseReleaseMarkdown(
        `# MossStudio 0.2.0\n\n\`\`\`json clover-release\n${JSON.stringify(legacyMachine, null, 2)}\n\`\`\``,
      )
      const installer = findInstaller(parsed.document.installers, 'darwin', 'arm64')
      const result = {
        scenario: 'release-parse',
        version: parsed.document.app.version,
        homeTitle: parsed.document.home?.title ?? null,
        legacyHomeAbsent: legacy.document.home === undefined,
        body: parsed.body,
        installer: installer?.kind ?? null,
        newer: compareSemver(parsed.document.app.version, '0.1.0'),
        betaPrerelease: compareSemver('0.2.0-beta.1', '0.2.0'),
        equal: compareSemver('0.2.0', '0.2.0'),
      }
      console.log(JSON.stringify(result, null, 2))
      app.exit(
        result.version === '0.2.0' &&
          result.homeTitle === '一念落纸上，万象入画来。' &&
          result.legacyHomeAbsent &&
          result.installer === 'dmg' &&
          result.newer === 1 &&
          result.betaPrerelease === -1 &&
          result.equal === 0 &&
          result.body.includes('Release notes')
          ? 0
          : 1,
      )
    } catch (error) {
      console.error(error)
      app.exit(1)
    }
    return
  }

  if (scenario === 'update-download') {
    const payload = Buffer.from('fake installer payload for clover update test')
    const sha256 = createHash('sha256').update(payload).digest('hex')
    const server = createServer((_req, res) => {
      res.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': payload.length,
      })
      res.end(payload)
    })
    try {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('test server did not bind a port')
      process.env['CLOVER_UPDATE_TEST'] = '1'
      const state = await downloadUpdate('9.9.9', {
        platform: 'darwin',
        arch: 'arm64',
        kind: 'dmg',
        url: `http://127.0.0.1:${address.port}/fake.dmg`,
        sha256,
        size_bytes: payload.length,
      })
      const downloaded = state.path && existsSync(state.path) ? readFileSync(state.path) : null
      const digest = downloaded ? createHash('sha256').update(downloaded).digest('hex') : null
      console.log(
        JSON.stringify(
          {
            scenario: 'update-download',
            phase: state.phase,
            bytes: state.bytes,
            path: state.path,
            digestMatches: digest === sha256,
          },
          null,
          2,
        ),
      )
      server.close()
      rmSync(join(app.getPath('userData'), 'downloads', 'updates', '9.9.9'), {
        recursive: true,
        force: true,
      })
      app.exit(state.phase === 'ready' && digest === sha256 ? 0 : 1)
    } catch (error) {
      console.error(error)
      server.close()
      app.exit(1)
    }
    return
  }

  if (scenario === 'remote-instance') {
    try {
      const root = join(app.getPath('userData'), 'remote-instance-test')
      rmSync(root, { recursive: true, force: true })
      mkdirSync(join(root, 'instances', 'git'), { recursive: true })
      mkdirSync(join(root, 'models'), { recursive: true })
      const source = join(app.getPath('userData'), 'git', 'moss-image.git')
      const mirror = join(root, 'instances', 'git', 'moss-image.git')
      const clone = await run('git', ['clone', '--bare', source, mirror], { timeoutMs: 60_000 })
      if (clone.code !== 0) throw new Error(clone.stderr || 'clone mirror failed')
      const head = await run('git', ['-C', mirror, 'rev-parse', 'main'], { timeoutMs: 10_000 })
      const commit = head.stdout.trim()
      if (!commit) throw new Error('main rev-parse failed')
      const fakeBin = join(root, 'bin')
      mkdirSync(fakeBin, { recursive: true })
      const fakeGpu = join(fakeBin, 'nvidia-smi')
      writeFileSync(fakeGpu, '#!/bin/bash\necho "Fake Remote RTX, 24576"\n', 'utf8')
      chmodSync(fakeGpu, 0o755)
      const fake = join(root, 'fake-ssh.sh')
      writeFileSync(
        fake,
        `#!/bin/bash\nexport PATH="${fakeBin}:$PATH"\nfor last; do :; done\nexec bash -lc "$last"\n`,
        'utf8',
      )
      chmodSync(fake, 0o755)
      process.env['CLOVER_SSH_BIN'] = fake
      process.env['UV_CACHE_DIR'] = join(app.getPath('userData'), 'cache', 'uv')
      process.env['PIP_CACHE_DIR'] = join(app.getPath('userData'), 'cache', 'pip')
      const host = saveTrainingHost({
        name: 'Fake Remote Instance',
        host: 'fake.local',
        user: 'tester',
        trainerRoot: root,
        instanceRoot: join(root, 'instances'),
        modelsRoot: join(root, 'models'),
      })
      const instance = await createInstance(
        { branch: 'main', commit, name: 'remote-smoke', runtimeMode: 'isolated', hostId: host.id },
        getSettings(),
      )
      const testedHost = await testManagedHost(getSettings(), host.id)
      const remoteRoot = instance.placement.kind === 'ssh' ? instance.placement.root : ''
      const previous = await run('git', ['-C', mirror, 'rev-parse', 'HEAD~1'], { timeoutMs: 10_000 })
      const previousSha = previous.stdout.trim()
      const switched =
        previous.code === 0 && previousSha
          ? await updateInstance(instance.id, previousSha, getSettings())
          : instance
      const remoteHead = await run('git', ['-C', remoteRoot, 'rev-parse', 'HEAD'], { timeoutMs: 10_000 })
      const switchedOk = !previousSha || (switched.commit === previousSha && remoteHead.stdout.trim() === previousSha)
      console.log(
        JSON.stringify(
          {
            scenario: 'remote-instance',
            placement: instance.placement,
            runtimeState: instance.runtimeState,
            path: instance.path,
            remoteRootExists: remoteRoot ? existsSync(remoteRoot) : false,
            remoteGitExists: remoteRoot ? existsSync(join(remoteRoot, '.git')) : false,
            remoteVenvExists: remoteRoot ? existsSync(join(remoteRoot, '.venv', 'bin', 'python3')) : false,
            hostStatus: testedHost.status,
            devices: testedHost.devices.map((device) => device.name),
            switchedTo: switched.commit,
            remoteHead: remoteHead.stdout.trim(),
            switchedOk,
          },
          null,
          2,
        ),
      )
      const ok =
        instance.placement.kind === 'ssh' &&
        instance.runtimeState === 'created' &&
        existsSync(join(remoteRoot, '.git')) &&
        existsSync(join(remoteRoot, '.venv', 'bin', 'python3')) &&
        switchedOk
      let deleted = false
      if (process.env['CLOVER_KEEP_TEST_DATA'] !== '1') {
        await deleteInstance(instance.id, true, getSettings())
        deleted = !existsSync(remoteRoot) && !existsSync(paths.instance(instance.id))
        removeTrainingHost(host.id)
        rmSync(root, { recursive: true, force: true })
      } else {
        console.log(JSON.stringify({ keptInstanceId: instance.id, keptHostId: host.id, keptRoot: root }, null, 2))
      }
      console.log(JSON.stringify({ scenario: 'remote-instance-delete', deleted }, null, 2))
      app.exit(ok && (process.env['CLOVER_KEEP_TEST_DATA'] === '1' || deleted) ? 0 : 1)
    } catch (error) {
      console.error(error)
      app.exit(1)
    }
    return
  }

  if (scenario === 'device-manager') {
    try {
      const root = join(app.getPath('userData'), 'device-manager-test')
      const fakeBin = join(root, 'bin')
      mkdirSync(fakeBin, { recursive: true })
      const fakeGpu = join(fakeBin, 'nvidia-smi')
      writeFileSync(fakeGpu, '#!/bin/bash\necho "Fake RTX, 24576"\n', 'utf8')
      chmodSync(fakeGpu, 0o755)
      const fakeSsh = join(root, 'fake-ssh.sh')
      writeFileSync(
        fakeSsh,
        `#!/bin/bash\nexport PATH="${fakeBin}:$PATH"\nfor last; do :; done\nexec bash -lc "$last"\n`,
        'utf8',
      )
      chmodSync(fakeSsh, 0o755)
      mkdirSync(join(root, 'instances'), { recursive: true })
      mkdirSync(join(root, 'models'), { recursive: true })
      process.env['CLOVER_SSH_BIN'] = fakeSsh
      const host = saveTrainingHost({
        name: 'Fake Device Manager',
        host: 'fake.local',
        user: 'tester',
        trainerRoot: root,
        instanceRoot: join(root, 'instances'),
        modelsRoot: join(root, 'models'),
      })
      const tested = await testManagedHost(getSettings(), host.id)
      const local = listManagedHosts(getSettings()).find((item) => item.kind === 'local')
      console.log(
        JSON.stringify(
          {
            scenario: 'device-manager',
            status: tested.status,
            devices: tested.devices.map((device) => ({ id: device.id, name: device.name, kind: device.kind })),
            instanceRoot: tested.instanceRoot,
            localDevices: local?.devices.map((device) => ({ name: device.name, kind: device.kind })),
          },
          null,
          2,
        ),
      )
      removeTrainingHost(host.id)
      rmSync(root, { recursive: true, force: true })
      app.exit(
        tested.status === 'ok' &&
          tested.devices.length === 1 &&
          tested.instanceRoot?.endsWith('/instances') &&
          Boolean(local?.devices.length)
          ? 0
          : 1,
      )
    } catch (error) {
      console.error(error)
      app.exit(1)
    }
    return
  }

  if (scenario === 'create') {
    const settings = getSettings()
    try {
      await ensureMirror(settings)
      const branches = await listBranches()
      const commits = await listCommits(branches[0]?.name ?? 'main', 5)
      if (!commits[0]) throw new Error('没有提交')
      const instance = await createInstance(
        { branch: branches[0]?.name ?? 'main', commit: commits[0].sha, runtimeMode: 'shared' },
        settings,
      )
      console.log(JSON.stringify({ scenario: 'create', branches, instance }, null, 2))
      app.exit(0)
    } catch (error) {
      console.error(error)
      app.exit(1)
    }
    return
  }

  if (scenario === 'install') {
    const settings = getSettings()
    try {
      const [instance] = await listInstances()
      if (!instance) throw new Error('没有实例，先运行 --scenario=create')
      const runtime = await installDeps(instance.runtimeId, settings, (line) => console.log(line), instance.path)
      console.log(JSON.stringify({ scenario: 'install', runtime }, null, 2))
      app.exit(0)
    } catch (error) {
      console.error(error)
      app.exit(1)
    }
    return
  }

  if (scenario === 'second') {
    const settings = getSettings()
    try {
      await ensureMirror(settings)
      const commits = await listCommits('main', 6)
      const first = (await listInstances())[0]
      const older = commits.find((commit) => commit.sha !== first?.commit) ?? commits[1]
      if (!older) throw new Error('提交不足')
      const instance = await createInstance(
        { branch: 'main', commit: older.sha, runtimeMode: 'shared' },
        settings,
      )
      console.log(
        JSON.stringify(
          {
            scenario: 'second',
            existingRuntime: first?.runtimeId,
            newRuntime: instance.runtimeId,
            shared: first?.runtimeId === instance.runtimeId,
            instance,
          },
          null,
          2,
        ),
      )
      app.exit(0)
    } catch (error) {
      console.error(error)
      app.exit(1)
    }
    return
  }

  if (scenario === 'job') {
    try {
      const [instance] = await listInstances()
      if (!instance) throw new Error('没有实例，先运行 --scenario=create')
      const job = await startJob({
        instanceId: instance.id,
        prompt: 'A quiet blue morning, simulated job for MossStudio M4',
        negativePrompt: '',
        width: 512,
        height: 512,
        steps: 4,
        cfg: 1,
        seed: 42,
        profile: 'dmd8',
        mode: 'simulate',
      })
      const deadline = Date.now() + 60_000
      let current = job
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 400))
        current = (await getJob(job.id)) ?? current
        if (current.state === 'succeeded' || current.state === 'failed' || current.state === 'canceled') break
      }
      const logs = await getJobLogs(job.id)
      console.log(
        JSON.stringify(
          {
            scenario: 'job',
            state: current.state,
            stage: current.stage,
            progress: current.progress,
            outputs: current.outputs,
            error: current.error,
            logLines: logs.length,
          },
          null,
          2,
        ),
      )
      app.exit(current.state === 'succeeded' ? 0 : 1)
    } catch (error) {
      console.error(error)
      app.exit(1)
    }
    return
  }

  if (scenario === 'parser') {
    console.log(
      JSON.stringify(
        {
          tqdm: parseTqdm(' 45%|████▌     | 9/20 [00:12<00:15,  1.37s/it]'),
          oom: matchRule('CUDA out of memory. Tried to allocate 2.00 GiB')?.id ?? null,
          module: matchRule("ModuleNotFoundError: No module named 'xformers'")?.id ?? null,
        },
        null,
        2,
      ),
    )
    app.exit(0)
    return
  }

  if (scenario === 'job-cancel') {
    try {
      const [instance] = await listInstances()
      if (!instance) throw new Error('没有实例')
      const job = await startJob({
        instanceId: instance.id,
        prompt: 'cancel test',
        width: 512,
        height: 512,
        steps: 20,
        cfg: 1,
        seed: 1,
        profile: 'dmd8',
        mode: 'simulate',
      })
      await new Promise((resolve) => setTimeout(resolve, 700))
      await cancelJob(job.id)
      const deadline = Date.now() + 20_000
      let current = job
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 200))
        current = (await getJob(job.id)) ?? current
        if (current.state !== 'running' && current.state !== 'starting') break
      }
      console.log(JSON.stringify({ scenario: 'job-cancel', state: current.state, error: current.error }, null, 2))
      app.exit(0)
    } catch (error) {
      console.error(error)
      app.exit(1)
    }
    return
  }

  if (scenario === 'job-real') {
    try {
      const [instance] = await listInstances()
      if (!instance) throw new Error('没有实例')
      await startJob({
        instanceId: instance.id,
        prompt: 'A model-missing preflight check',
        width: 512,
        height: 512,
        steps: 8,
        cfg: 1,
        seed: 1,
        profile: 'dmd8',
        mode: 'runner',
      })
      console.log(JSON.stringify({ scenario: 'job-real', unexpected: true }))
      app.exit(1)
    } catch (error) {
      console.log(
        JSON.stringify(
          { scenario: 'job-real', expected: true, message: error instanceof Error ? error.message : String(error) },
          null,
          2,
        ),
      )
      app.exit(0)
    }
    return
  }

  if (scenario === 'download-test') {
    try {
      const task = await downloadCustomModel('hf-internal-testing/tiny-random-gpt2', getSettings())
      const deadline = Date.now() + 180_000
      let current = task
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 500))
        current = listDownloads().find((item) => item.id === task.id) ?? current
        if (current.state === 'done' || current.state === 'error') break
      }
      console.log(JSON.stringify(current, null, 2))
      app.exit(current.state === 'done' ? 0 : 1)
    } catch (error) {
      console.error(error)
      app.exit(1)
    }
    return
  }

  if (scenario === 'trainer-remote-env') {
    try {
      const root = join(app.getPath('userData'), 'remote-trainer-env')
      rmSync(root, { recursive: true, force: true })
      mkdirSync(join(root, 'git'), { recursive: true })
      const fakeBin = join(app.getPath('userData'), 'fake-bin-env')
      mkdirSync(fakeBin, { recursive: true })
      const uv = join(fakeBin, 'uv')
      writeFileSync(uv, `#!/bin/bash
if [ "$1" = "venv" ]; then
  R="$2"; mkdir -p "$R/bin"
  printf '#!/bin/bash\necho Python 3.12\n' > "$R/bin/python"
  printf '#!/bin/bash\nexit 0\n' > "$R/bin/kohakumoss-config"
  printf '#!/bin/bash\nexit 0\n' > "$R/bin/kogine"
  printf '#!/bin/bash\necho doctor-ok\n' > "$R/bin/kohakumoss-doctor"
  chmod +x "$R/bin/"*
  exit 0
fi
exit 0
`, 'utf8')
      chmodSync(uv, 0o755)
      const localMirror = join(app.getPath('userData'), 'trainer', 'git', 'kohaku-trainer.git')
      cpSync(localMirror, join(root, 'git', 'kohaku-trainer.git'), { recursive: true })
      await run('git', ['-C', join(root, 'git', 'kohaku-trainer.git'), 'remote', 'set-url', 'origin', localMirror])
      const fake = join(app.getPath('userData'), 'fake-ssh-env.sh')
      writeFileSync(fake, `#!/bin/bash\nexport PATH="${fakeBin}:$PATH"\nfor last; do :; done\nlast="$(printf '%s' "$last" | sed 's/^bash -lc /bash -c /')"\nexec bash -c "$last"\n`, 'utf8')
      chmodSync(fake, 0o755)
      process.env['CLOVER_SSH_BIN'] = fake
      const host = saveTrainingHost({ name: 'Fake Env', host: 'fake.local', user: 'tester', port: 22, trainerRoot: root })
      const branches = await remoteBranches(getSettings(), host.id)
      const branch = branches.find((item) => item.isDefault)?.name ?? 'main'
      const commits = await remoteCommits(getSettings(), host.id, branch, 3)
      if (!commits[0]) throw new Error('no commit')
      const version = await remoteCreateVersion(getSettings(), host.id, { branch, commit: commits[0].sha })
      const runtime = await remoteInstallRuntime(getSettings(), version)
      const checked = await remoteDoctor(getSettings(), { ...version, runtimeId: runtime.id, runtimeState: 'ready' })
      console.log(JSON.stringify({ scenario: 'trainer-remote-env', runtime: runtime.state, doctor: checked.ok, output: checked.output }, null, 2))
      await remoteRemoveVersion(getSettings(), version)
      removeTrainingHost(host.id)
      app.exit(runtime.state === 'ready' && checked.ok ? 0 : 1)
    } catch (error) {
      console.error(error)
      app.exit(1)
    }
    return
  }

  if (scenario === 'backend-renderer') {
    const backend = getBackendInfo()
    if (!backend.ready || !backend.url || !backend.token) {
      app.exit(1)
      return
    }
    const win = createAppWindow('launcher', false)
    await new Promise<void>((resolve) => win.webContents.once('did-finish-load', () => resolve()))
    const result = await win.webContents.executeJavaScript(`fetch(${JSON.stringify(`${backend.url}/api/jobs`)}, { headers: { authorization: 'Bearer ${backend.token}' } }).then(async (res) => ({ status: res.status, count: (await res.json()).length })).catch((error) => ({ error: String(error) }))`)
    const [instance] = await listInstances()
    let jobState: string | null = null
    if (instance && result?.status === 200) {
      const created = await win.webContents.executeJavaScript(`fetch(${JSON.stringify(`${backend.url}/api/jobs`)}, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ${backend.token}' }, body: ${JSON.stringify(JSON.stringify({ instanceId: instance.id, prompt: 'renderer backend test', negativePrompt: '', width: 512, height: 512, steps: 2, cfg: 1, seed: 42, profile: 'base', mode: 'simulate' }))} }).then((res) => res.json()).catch((error) => ({ error: String(error) }))`)
      if (created?.id) {
        const deadline = Date.now() + 20_000
        while (Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 200))
          const current = await getJob(created.id)
          jobState = current?.state ?? null
          if (jobState && jobState !== 'running' && jobState !== 'starting') break
        }
      }
    }
    console.log(JSON.stringify({ scenario: 'backend-renderer', result, jobState }, null, 2))
    app.exit(result?.status === 200 && (!instance || jobState === 'succeeded') ? 0 : 1)
    return
  }

  if (scenario === 'backend-job') {
    const backend = getBackendInfo()
    const [instance] = await listInstances()
    if (!backend.ready || !backend.token || !instance) {
      console.error({ backend, instance: instance?.id })
      app.exit(1)
      return
    }
    const response = await fetch(`${backend.url}/api/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${backend.token}` },
      body: JSON.stringify({
        instanceId: instance.id, prompt: 'backend simulate', negativePrompt: '', width: 512, height: 512,
        steps: 2, cfg: 1, seed: 42, profile: 'base', mode: 'simulate',
      }),
    })
    const job = (await response.json()) as JobRecord
    let current = job
    const deadline = Date.now() + 20_000
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 200))
      const info = await fetch(`${backend.url}/api/jobs/${job.id}`, { headers: { authorization: `Bearer ${backend.token}` } }).then((r) => r.json() as Promise<JobRecord>)
      current = info
      if (info.state !== 'running' && info.state !== 'starting') break
    }
    console.log(JSON.stringify({ scenario: 'backend-job', state: current.state, id: current.id, error: current.error }, null, 2))
    app.exit(current.state === 'succeeded' ? 0 : 1)
    return
  }

  if (scenario === 'web-access') {
    const access = getWebAccessInfo()
    const remote = access.urls.find((url) => !url.includes('127.0.0.1')) ?? null
    const page = access.ready ? await fetch(remote ?? access.urls[0]!).then(async (res) => {
      const html = await res.text()
      const asset = html.match(/src="([^"]+\.js)"/)?.[1]
      const assetStatus = asset ? await fetch(new URL(asset, remote ?? access.urls[0]!).toString()).then((r) => r.status).catch(() => 0) : 0
      return { status: res.status, html: html.includes('MossStudio'), assetStatus }
    }).catch(() => null) : null
    console.log(JSON.stringify({ scenario: 'web-access', ready: access.ready, urls: access.urls.length, remote: Boolean(remote), page }, null, 2))
    app.exit(access.ready && remote && page?.status === 200 && page.html ? 0 : 1)
    return
  }

  if (scenario === 'ai-provider') {
    const saved = saveProvider({ name: 'Scenario', kind: 'openai', baseUrl: 'https://example.com/v1', model: 'test-model', apiKey: 'secret-key' })
    const listed = listProviders().find((provider) => provider.id === saved.id)
    removeProvider(saved.id)
    const after = listProviders().some((provider) => provider.id === saved.id)
    console.log(JSON.stringify({ scenario: 'ai-provider', saved: { id: saved.id, hasKey: saved.hasKey }, listed: { hasKey: listed?.hasKey, leaked: Boolean((listed as unknown as { apiKey?: string })?.apiKey) }, after }, null, 2))
    app.exit(saved.hasKey && listed?.hasKey && !after ? 0 : 1)
    return
  }

  if (scenario === 'torch-index') {
    const settings = getSettings()
    const auto = await resolveTorchIndex(settings)
    const cpu = await resolveTorchIndex({ ...settings, torchBackend: 'cpu', torchIndex: null })
    let cuda: string | null = null
    let cudaError = ''
    try {
      cuda = await resolveTorchIndex({ ...settings, torchBackend: 'cuda', torchIndex: null })
    } catch (error) {
      cudaError = error instanceof Error ? error.message : String(error)
    }
    console.log(JSON.stringify({ scenario: 'torch-index', platform: process.platform, auto, cpu, cuda: cuda ? 'https://download.pytorch.org/whl/cu128' : null, cudaError: cudaError.slice(0, 80) }, null, 2))
    app.exit(process.platform === 'darwin' ? (auto === null && cpu?.includes('/cpu') && Boolean(cudaError) ? 0 : 1) : (Boolean(auto) && Boolean(cpu) && Boolean(cuda) ? 0 : 1))
    return
  }

  if (scenario === 'backend-http') {
    const backend = getBackendInfo()
    if (!backend.ready || !backend.url || !backend.token) {
      console.error(backend)
      app.exit(1)
      return
    }
    const health = await fetch(`${backend.url}/health`).then((res) => res.json())
    const unauthorized = await fetch(`${backend.url}/api/jobs`).then((res) => res.status)
    const jobs = await fetch(`${backend.url}/api/jobs`, { headers: { authorization: `Bearer ${backend.token}` } }).then((res) => res.json())
    const studio = (await fetch(`${backend.url}/api/studio/bootstrap`, { headers: { authorization: `Bearer ${backend.token}` } }).then((res) => res.json())) as { projects?: unknown[]; instances?: unknown[]; models?: { models?: unknown[] }; gallery?: { items?: Array<{ path?: string }> } }
    const models = (await fetch(`${backend.url}/api/models`, { headers: { authorization: `Bearer ${backend.token}` } }).then((res) => res.json())) as { models?: unknown[] }
    const web = await fetch(`${backend.url}/`).then(async (res) => ({ status: res.status, html: (await res.text()).includes('MossStudio') }))
    const galleryPath = studio.gallery?.items?.[0]?.path
    const galleryFile = galleryPath
      ? await fetch(`${backend.url}/api/gallery/file?path=${encodeURIComponent(galleryPath)}&token=${backend.token}`).then((res) => ({ status: res.status, type: res.headers.get('content-type') })).catch(() => null)
      : null
    const hello = await new Promise<unknown>((resolve, reject) => {
      const ws = new WebSocket(`${backend.url!.replace('http', 'ws')}/ws?token=${backend.token}`)
      const timer = setTimeout(() => { ws.close(); reject(new Error('ws timeout')) }, 5000)
      ws.once('message', (data) => { clearTimeout(timer); ws.close(); resolve(JSON.parse(String(data))) })
      ws.once('error', reject)
    })
    console.log(JSON.stringify({ scenario: 'backend-http', health, unauthorized, jobs: Array.isArray(jobs) ? jobs.length : null, web, galleryFile, studio: { projects: Array.isArray(studio.projects) ? studio.projects.length : null, instances: Array.isArray(studio.instances) ? studio.instances.length : null, models: Array.isArray(studio.models?.models) ? studio.models.models.length : null }, models: Array.isArray(models?.models) ? models.models.length : null, hello }, null, 2))
    app.exit(0)
    return
  }

  if (scenario === 'project-save') {
    const saved = saveProject({
      name: 'Scenario Project',
      width: 1024,
      height: 1024,
      summary: { caption: 'test', meta: ['test'], canvas: 'single' },
      layers: [{ id: 'layer-1', kind: 'object', caption: 'test region', bbox: [10, 20, 300, 400], visible: true, locked: false, opacity: 1 }],
      prompt: 'test prompt',
      negative: '',
      seed: 42,
      steps: 8,
      cfg: 1,
    })
    const loaded = getProject(saved.id)
    const count = listProjects().filter((item) => item.id === saved.id).length
    deleteProject(saved.id)
    console.log(JSON.stringify({ scenario: 'project-save', id: saved.id, loaded: loaded?.name, layers: loaded?.layers.length, listed: count }, null, 2))
    app.exit(loaded && count === 1 ? 0 : 1)
    return
  }

  if (scenario === 'project-series') {
    const base = {
      width: 1024,
      height: 1024,
      summary: { caption: 'series', meta: ['test'], canvas: 'single' as const },
      layers: [],
      prompt: 'page prompt',
      negative: '',
      seed: 42,
      steps: 8,
      cfg: 1,
      seriesId: `series-test-${Date.now()}`,
    }
    const first = saveProject({ ...base, name: 'Page 1', page: 1 })
    const second = saveProject({ ...base, name: 'Page 2', page: 2 })
    const summaries = listProjects().filter((item) => item.seriesId === base.seriesId).sort((a, b) => (a.page ?? 1) - (b.page ?? 1))
    const loaded = getProject(second.id)
    deleteProject(first.id)
    deleteProject(second.id)
    console.log(JSON.stringify({ scenario: 'project-series', pages: summaries.map((item) => item.page), secondPage: loaded?.page, series: loaded?.seriesId === base.seriesId }, null, 2))
    app.exit(summaries.length === 2 && summaries[0]?.page === 1 && summaries[1]?.page === 2 && loaded?.page === 2 ? 0 : 1)
    return
  }

  if (scenario === 'queue-persist') {
    const row = {
      id: `queue-test-${Date.now()}`,
      caseName: 'Queue Test',
      instanceId: 'moss-main-9d799c1',
      instanceName: 'moss-main-9d799c1',
      workspace: 'clover' as const,
      deviceId: 'mps',
      profile: 'base' as const,
      state: 'queued' as const,
      queuedAt: new Date().toISOString(),
    }
    upsertLaunchRow(row)
    const saved = listLaunchRows().find((item) => item.id === row.id)
    removeLaunchRow(row.id)
    console.log(JSON.stringify({ scenario: 'queue-persist', saved: Boolean(saved), state: saved?.state, remaining: listLaunchRows().filter((item) => item.id === row.id).length }, null, 2))
    app.exit(saved ? 0 : 1)
    return
  }

  if (scenario === 'trainer-remote-artifact') {
    try {
      const root = join(app.getPath('userData'), 'remote-trainer-artifact')
      rmSync(root, { recursive: true, force: true })
      mkdirSync(join(root, 'git'), { recursive: true })
      const fakeBin = join(app.getPath('userData'), 'fake-bin')
      mkdirSync(fakeBin, { recursive: true })
      writeFileSync(join(fakeBin, 'nvidia-smi'), '#!/bin/bash\necho "Fake GPU, 24576 MiB"\n', 'utf8')
      chmodSync(join(fakeBin, 'nvidia-smi'), 0o755)
      const localMirror = join(app.getPath('userData'), 'trainer', 'git', 'kohaku-trainer.git')
      cpSync(localMirror, join(root, 'git', 'kohaku-trainer.git'), { recursive: true })
      await run('git', ['-C', join(root, 'git', 'kohaku-trainer.git'), 'remote', 'set-url', 'origin', localMirror])
      const fakeSsh = join(app.getPath('userData'), 'fake-ssh-artifact.sh')
      writeFileSync(fakeSsh, `#!/bin/bash\nexport PATH="${fakeBin}:$PATH"\nfor last; do :; done\nexec bash -lc "$last"\n`, 'utf8')
      chmodSync(fakeSsh, 0o755)
      const fakeScp = join(app.getPath('userData'), 'fake-scp-artifact.sh')
      writeFileSync(fakeScp, '#!/bin/bash\nfor last; do :; done\nsrc="${@: -2:1}"\ndst="$last"\nsrc="${src#*:}"\ncp "$src" "$dst"\n', 'utf8')
      chmodSync(fakeScp, 0o755)
      process.env['CLOVER_SSH_BIN'] = fakeSsh
      process.env['CLOVER_SCP_BIN'] = fakeScp
      const host = saveTrainingHost({ name: 'Fake GPU', host: 'fake.local', user: 'tester', port: 22, trainerRoot: root })
      const branches = await remoteBranches(getSettings(), host.id)
      const branch = branches.find((item) => item.isDefault)?.name ?? 'main'
      const commits = await remoteCommits(getSettings(), host.id, branch, 3)
      if (!commits[0]) throw new Error('no commit')
      const version = await remoteCreateVersion(getSettings(), host.id, { branch, commit: commits[0].sha })
      const bin = join(root, 'runtimes', 'fake-runtime', 'bin')
      mkdirSync(bin, { recursive: true })
      writeFileSync(join(bin, 'kogine'), '#!/bin/bash\necho "step 5 loss=0.1"\n', 'utf8')
      chmodSync(join(bin, 'kogine'), 0o755)
      writeFileSync(join(bin, 'kohakumoss-config'), '#!/bin/bash\nexit 0\n', 'utf8')
      chmodSync(join(bin, 'kohakumoss-config'), 0o755)
      const withRuntime = { ...version, runtimeId: 'fake-runtime', runtimeState: 'ready' as const }
      updateTrainingHostVersions(getSettings(), host.id, [withRuntime])
      mkdirSync(join(version.path, 'exports'), { recursive: true })
      writeFileSync(join(version.path, 'exports', 'artifact-test.safetensors'), 'fake-adapter', 'utf8')
      mkdirSync(join(version.path, 'runs', 'moss', 'artifact-test', 'checkpoints', 'step_00000005'), { recursive: true })
      writeFileSync(join(version.path, 'runs', 'moss', 'artifact-test', 'checkpoints', 'step_00000005', 'trainable.safetensors'), 'fake', 'utf8')
      const job = await startTrainerRun(getSettings(), {
        versionId: version.id, action: 'export', runName: 'artifact-test',
        weights: '/remote/weights', dataset: '/remote/data', algo: 'lora', steps: 5,
        lr: '1e-4', dim: '32', alpha: '32', batch: '1', resolution: 1024, overrides: '',
      })
      let current = job
      const deadline = Date.now() + 20_000
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 200))
        current = (await getJob(job.id)) ?? current
        if (current.state !== 'running' && current.state !== 'starting') break
      }
      await new Promise((resolve) => setTimeout(resolve, 2000))
      const catalog = await getCatalog(getSettings(), true)
      const registered = catalog.adapters.find((item) => item.id === 'trained-artifact-test')
      console.log(JSON.stringify({ scenario: 'trainer-remote-artifact', state: current.state, error: current.error, logs: (await getJobLogs(job.id)).slice(-12), registered: Boolean(registered), provider: registered?.provider, installed: registered?.installed }, null, 2))
      await remoteRemoveVersion(getSettings(), withRuntime)
      removeTrainingHost(host.id)
      const adapterDir = join(getSettings().modelsRoot ?? join(app.getPath('userData'), 'models'), 'adapters')
      rmSync(join(adapterDir, 'trained-artifact-test'), { recursive: true, force: true })
      try {
        const index = JSON.parse(readFileSync(join(adapterDir, 'index.json'), 'utf8')) as { adapters: Array<{ id: string }> }
        index.adapters = index.adapters.filter((item) => item.id !== 'trained-artifact-test')
        writeFileSync(join(adapterDir, 'index.json'), JSON.stringify(index, null, 2), 'utf8')
      } catch {
        // no local index
      }
      app.exit(current.state === 'succeeded' && registered ? 0 : 1)
    } catch (error) {
      console.error(error)
      app.exit(1)
    }
    return
  }

  if (scenario === 'trainer-remote-job') {
    try {
      const root = join(app.getPath('userData'), 'remote-trainer-job')
      rmSync(root, { recursive: true, force: true })
      mkdirSync(join(root, 'git'), { recursive: true })
      const fakeBin = join(app.getPath('userData'), 'fake-bin')
      mkdirSync(fakeBin, { recursive: true })
      const nvidia = join(fakeBin, 'nvidia-smi')
      writeFileSync(nvidia, '#!/bin/bash\necho "Fake GPU, 24576 MiB"\n', 'utf8')
      chmodSync(nvidia, 0o755)
      const localMirror = join(app.getPath('userData'), 'trainer', 'git', 'kohaku-trainer.git')
      const remoteMirror = join(root, 'git', 'kohaku-trainer.git')
      cpSync(localMirror, remoteMirror, { recursive: true })
      await run('git', ['-C', remoteMirror, 'remote', 'set-url', 'origin', localMirror])
      const fake = join(app.getPath('userData'), 'fake-ssh-job.sh')
      writeFileSync(fake, `#!/bin/bash\nexport PATH="${fakeBin}:$PATH"\nfor last; do :; done\nlast="$(printf '%s' "$last" | sed 's/^bash -lc /bash -c /')"\nexec bash -c "$last"\n`, 'utf8')
      chmodSync(fake, 0o755)
      process.env['CLOVER_SSH_BIN'] = fake
      const host = saveTrainingHost({
        name: 'Fake GPU',
        host: 'fake.local',
        user: 'tester',
        port: 22,
        trainerRoot: root,
      })
      const branches = await remoteBranches(getSettings(), host.id)
      const branch = branches.find((item) => item.isDefault)?.name ?? 'main'
      const commits = await remoteCommits(getSettings(), host.id, branch, 3)
      if (!commits[0]) throw new Error('远端没有提交')
      const version = await remoteCreateVersion(getSettings(), host.id, { branch, commit: commits[0].sha })
      const bin = join(root, 'runtimes', 'fake-runtime', 'bin')
      mkdirSync(bin, { recursive: true })
      const config = join(bin, 'kohakumoss-config')
      writeFileSync(config, '#!/bin/bash\nexit 0\n', 'utf8')
      chmodSync(config, 0o755)
      const kogine = join(bin, 'kogine')
      writeFileSync(kogine, '#!/bin/bash\nfor i in 1 2 3 4 5; do echo "step $i loss=0.$((6-i)) lr=1e-4"; sleep 0.1; done\n', 'utf8')
      chmodSync(kogine, 0o755)
      const withRuntime = { ...version, runtimeId: 'fake-runtime', runtimeState: 'ready' as const }
      updateTrainingHostVersions(getSettings(), host.id, [withRuntime])
      const job = await startTrainerRun(getSettings(), {
        versionId: version.id,
        action: 'train',
        runName: 'remote-test',
        weights: '/remote/weights',
        dataset: '/remote/data',
        algo: 'lora',
        steps: 5,
        lr: '1e-4',
        dim: '32',
        alpha: '32',
        batch: '1',
        resolution: 1024,
        overrides: '',
      })
      const deadline = Date.now() + 20_000
      let current = job
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 200))
        current = (await getJob(job.id)) ?? current
        if (current.state !== 'running' && current.state !== 'starting') break
      }
      console.log(JSON.stringify({ scenario: 'trainer-remote-job', state: current.state, hostId: current.hostId, metrics: current.metrics, progress: current.progress }, null, 2))
      await remoteRemoveVersion(getSettings(), withRuntime)
      removeTrainingHost(host.id)
      app.exit(current.state === 'succeeded' ? 0 : 1)
    } catch (error) {
      console.error(error)
      app.exit(1)
    }
    return
  }

  if (scenario === 'trainer-remote-local') {
    try {
      const root = join(app.getPath('userData'), 'remote-trainer-test')
      rmSync(root, { recursive: true, force: true })
      mkdirSync(join(root, 'git'), { recursive: true })
      const localMirror = join(app.getPath('userData'), 'trainer', 'git', 'kohaku-trainer.git')
      const remoteMirror = join(root, 'git', 'kohaku-trainer.git')
      cpSync(localMirror, remoteMirror, { recursive: true })
      await run('git', ['-C', remoteMirror, 'remote', 'set-url', 'origin', localMirror])
      const fake = join(app.getPath('userData'), 'fake-ssh.sh')
      writeFileSync(fake, '#!/bin/bash\nfor last; do :; done\nexec bash -lc "$last"\n', 'utf8')
      chmodSync(fake, 0o755)
      process.env['CLOVER_SSH_BIN'] = fake
      const host = saveTrainingHost({
        name: 'Fake Linux',
        host: 'fake.local',
        user: 'tester',
        port: 22,
        trainerRoot: root,
      })
      const branches = await remoteBranches(getSettings(), host.id)
      const branch = branches.find((item) => item.isDefault)?.name ?? branches[0]?.name ?? 'main'
      const commits = await remoteCommits(getSettings(), host.id, branch, 3)
      if (!commits[0]) throw new Error('远端没有提交')
      const version = await remoteCreateVersion(getSettings(), host.id, { branch, commit: commits[0].sha })
      const versions = remoteVersions(getSettings(), host.id)
      await remoteRemoveVersion(getSettings(), version)
      removeTrainingHost(host.id)
      console.log(JSON.stringify({ scenario: 'trainer-remote-local', branches: branches.length, commits: commits.length, version: version.id, versions: versions.length }, null, 2))
      app.exit(0)
    } catch (error) {
      console.error(error)
      app.exit(1)
    }
    return
  }

  if (scenario === 'trainer-host-probe') {
    try {
      const fake = join(app.getPath('userData'), 'fake-ssh.sh')
      writeFileSync(fake, '#!/bin/bash\nfor last; do :; done\nexec bash -lc "$last"\n', 'utf8')
      chmodSync(fake, 0o755)
      process.env['CLOVER_SSH_BIN'] = fake
      const host = saveTrainingHost({
        name: 'Fake Linux',
        host: 'fake.local',
        user: 'tester',
        port: 22,
        trainerRoot: join(app.getPath('userData'), 'trainer'),
      })
      const checked = await testTrainingHost(getSettings(), host.id)
      console.log(JSON.stringify({ scenario: 'trainer-host-probe', status: checked.status, remote: checked.remote, error: checked.error }, null, 2))
      removeTrainingHost(host.id)
      app.exit(checked.status === 'ok' ? 0 : 1)
    } catch (error) {
      console.error(error)
      app.exit(1)
    }
    return
  }

  if (scenario === 'trainer-host') {
    const host = saveTrainingHost({
      name: 'Test 4090',
      host: '192.0.2.10',
      user: 'trainer',
      port: 22,
      trainerRoot: '~/MossStudioTrainer',
    })
    const before = listTrainingHosts(getSettings())
    removeTrainingHost(host.id)
    const after = listTrainingHosts(getSettings())
    console.log(JSON.stringify({ scenario: 'trainer-host', saved: host, before: before.length, after: after.length }, null, 2))
    app.exit(0)
    return
  }

  if (scenario === 'trainer-job') {
    try {
      const version = (await listTrainerVersions(getSettings()))[0]
      const job = await startTrainingJob({
        versionId: version?.id ?? 'sim-trainer',
        name: 'Kohaku 训练（模拟）',
        cwd: process.cwd(),
        command: process.platform === 'win32' ? 'python' : 'python3',
        args: [
          '-u',
          '-c',
          'import time\nfor i in range(1,6):\n print(f"step {i} loss={0.5/i:.4f} lr=1e-4", flush=True)\n time.sleep(0.15)',
        ],
        totalSteps: 5,
      })
      const deadline = Date.now() + 20_000
      let current = job
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 200))
        current = (await getJob(job.id)) ?? current
        if (current.state !== 'running' && current.state !== 'starting') break
      }
      console.log(JSON.stringify({ scenario: 'trainer-job', state: current.state, metrics: current.metrics, progress: current.progress, logLines: (await getJobLogs(job.id)).length }, null, 2))
      app.exit(current.state === 'succeeded' ? 0 : 1)
    } catch (error) {
      console.error(error)
      app.exit(1)
    }
    return
  }

  if (scenario === 'trainer-deploy') {
    try {
      const settings = getSettings()
      const branches = await listTrainerBranches(settings)
      const branch = branches.find((item) => item.isDefault)?.name ?? branches[0]?.name ?? 'main'
      const commits = await listTrainerCommits(settings, branch, 3)
      if (!commits[0]) throw new Error('训练器没有提交')
      const version = await createTrainerVersion(settings, { branch, commit: commits[0].sha })
      const versions = await listTrainerVersions(settings)
      console.log(JSON.stringify({ scenario: 'trainer-deploy', branch, commits: commits.length, version, versions: versions.length }, null, 2))
      app.exit(0)
    } catch (error) {
      console.error(error)
      app.exit(1)
    }
    return
  }

  if (scenario === 'windows') {
    const launcher = createAppWindow('launcher', false)
    await new Promise<void>((resolve) => launcher.webContents.once('did-finish-load', () => resolve()))
    await new Promise((resolve) => setTimeout(resolve, 1200))
    await launcher.webContents.executeJavaScript("window.clover.invoke('window:open', { kind: 'creator' })")
    await new Promise((resolve) => setTimeout(resolve, 1500))
    const creator = Boolean(getWindow('creator'))
    await launcher.webContents.executeJavaScript("window.clover.invoke('window:open', { kind: 'terminal' })")
    await new Promise((resolve) => setTimeout(resolve, 1500))
    const terminal = Boolean(getWindow('terminal'))
    console.log(JSON.stringify({ scenario: 'windows', creator, terminal }, null, 2))
    app.exit(creator && terminal ? 0 : 1)
    return
  }

  if (scenario === 'update-dialog') {
    const file = join(app.getPath('userData'), 'update-test-release.md')
    const machine = {
      schema_version: 2,
      app: {
        name: 'MossStudio',
        channel: 'stable',
        version: '9.9.9',
        min_supported: '0.1.0',
        published_at: new Date().toISOString(),
        notes_url: 'https://github.com/CloverIris/MossStudio/releases',
      },
      installers: [
        {
          platform: 'darwin',
          arch: 'arm64',
          kind: 'dmg',
          url: 'https://example.com/MossStudio-9.9.9-arm64.dmg',
          sha256: 'c'.repeat(64),
          size_bytes: 123456789,
        },
      ],
      announcements: [],
    }
    writeFileSync(
      file,
      `# MossStudio 9.9.9\n\n这是更新弹窗的预览数据，不会下载真实安装包。\n\n## 本次更新\n\n- 聚合 GitHub Release 发布源\n- 公告、模型表与版本文档\n\n\`\`\`json clover-release\n${JSON.stringify(machine, null, 2)}\n\`\`\``,
      'utf8',
    )
    process.env['CLOVER_RELEASE_FILE'] = file
    updateSettings({ autoCheckUpdates: true, dismissedUpdateVersion: null })
    const win = createAppWindow('launcher', false)
    await new Promise<void>((resolve) => win.webContents.once('did-finish-load', () => resolve()))
    await new Promise((resolve) => setTimeout(resolve, 4500))
    await win.webContents.executeJavaScript(
      "[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '本次跳过')?.click()",
    )
    await new Promise((resolve) => setTimeout(resolve, 900))
    const image = await win.webContents.capturePage()
    writeFileSync(join(app.getPath('userData'), 'screenshot-update.png'), image.toPNG())
    console.log('update dialog screenshot written')
    app.exit(0)
    return
  }

  if (screenshot) {
    const launcher = createAppWindow('launcher', false)
    await new Promise<void>((resolve) => launcher.webContents.once('did-finish-load', () => resolve()))
    await new Promise((resolve) => setTimeout(resolve, 4500))
    const oobe = await launcher.webContents.capturePage()
    writeFileSync(join(app.getPath('userData'), 'screenshot-oobe.png'), oobe.toPNG())
    await launcher.webContents.executeJavaScript(
      "[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '本次跳过')?.click()",
    )
    await new Promise((resolve) => setTimeout(resolve, 700))
    const home = await launcher.webContents.capturePage()
    writeFileSync(join(app.getPath('userData'), 'screenshot-home.png'), home.toPNG())
    await launcher.webContents.executeJavaScript(
      "[...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === '隐藏通知')?.click()",
    )
    await new Promise((resolve) => setTimeout(resolve, 500))
    const cleanHome = await launcher.webContents.capturePage()
    writeFileSync(join(app.getPath('userData'), 'screenshot-home-clean.png'), cleanHome.toPNG())
    await new Promise((resolve) => setTimeout(resolve, 400))
    await launcher.webContents.executeJavaScript(
      "[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '启动')?.click()",
    )
    await new Promise((resolve) => setTimeout(resolve, 1600))
    const launch = await launcher.webContents.capturePage()
    writeFileSync(join(app.getPath('userData'), 'screenshot-launch.png'), launch.toPNG())

    const routes: Array<[string, string]> = [
      ['/instances', 'instances'],
      ['/instances/moss-main-9d799c1', 'instance-detail'],
      ['/diagnostics', 'diagnostics'],
      ['/gallery', 'gallery-launcher'],
      ['/training', 'training'],
      ['/models', 'models'],
      ['/settings', 'settings'],
    ]
    for (const [route, name] of routes) {
      await launcher.webContents.executeJavaScript(`location.hash = '#${route}'`)
      await new Promise((resolve) => setTimeout(resolve, route === '/training' ? 2800 : 900))
      const image = await launcher.webContents.capturePage()
      writeFileSync(join(app.getPath('userData'), `screenshot-${name}.png`), image.toPNG())
    }

    const creator = createAppWindow('creator', false)
    await new Promise<void>((resolve) => creator.webContents.once('did-finish-load', () => resolve()))
    await new Promise((resolve) => setTimeout(resolve, 2200))
    const studio = await creator.webContents.capturePage()
    writeFileSync(join(app.getPath('userData'), 'screenshot-studio.png'), studio.toPNG())
    await creator.webContents.executeJavaScript("location.hash = '#/gallery'")
    await new Promise((resolve) => setTimeout(resolve, 1000))
    const gallery = await creator.webContents.capturePage()
    writeFileSync(join(app.getPath('userData'), 'screenshot-gallery.png'), gallery.toPNG())

    const terminal = createAppWindow('terminal', false)
    await new Promise<void>((resolve) => terminal.webContents.once('did-finish-load', () => resolve()))
    await new Promise((resolve) => setTimeout(resolve, 5000))
    const terminalShot = await terminal.webContents.capturePage()
    writeFileSync(join(app.getPath('userData'), 'screenshot-terminal.png'), terminalShot.toPNG())

    const trainer = createAppWindow('trainer', false)
    await new Promise<void>((resolve) => trainer.webContents.once('did-finish-load', () => resolve()))
    await new Promise((resolve) => setTimeout(resolve, 3000))
    const trainerShot = await trainer.webContents.capturePage()
    writeFileSync(join(app.getPath('userData'), 'screenshot-trainer.png'), trainerShot.toPNG())

    const devices = createAppWindow('devices', false)
    await new Promise<void>((resolve) => devices.webContents.once('did-finish-load', () => resolve()))
    await new Promise((resolve) => setTimeout(resolve, 2800))
    await devices.webContents.executeJavaScript(
      "[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Fake Remote Instance') && b.textContent.includes('1 设备'))?.click()",
    )
    await new Promise((resolve) => setTimeout(resolve, 600))
    const devicesShot = await devices.webContents.capturePage()
    writeFileSync(join(app.getPath('userData'), 'screenshot-devices.png'), devicesShot.toPNG())

    console.log('screenshots written to', app.getPath('userData'))
    app.exit(0)
    return
  }

  createAppWindow('launcher')
  app.on('activate', () => {
    openWindow('launcher')
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  stopBackend()
})
