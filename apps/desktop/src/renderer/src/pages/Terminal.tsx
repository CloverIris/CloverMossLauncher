import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { Play, Square, SquareTerminal } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { useApp } from '../store'
import { cn, useToast } from '../components/ui'

const stateLabel = {
  queued: '排队',
  starting: '启动中',
  running: '运行中',
  succeeded: '已完成',
  failed: '失败',
  canceled: '已停止',
}

const stateColor = {
  queued: 'bg-neutral-400',
  starting: 'bg-amber-500',
  running: 'bg-accent-400',
  succeeded: 'bg-accent-500',
  failed: 'bg-red-500',
  canceled: 'bg-neutral-500',
}

export function TerminalPage(): React.JSX.Element {
  const jobs = useApp((state) => state.jobs)
  const activeJobId = useApp((state) => state.activeJobId)
  const logsByJob = useApp((state) => state.jobLogs)
  const setActiveJob = useApp((state) => state.setActiveJob)
  const loadJobLogs = useApp((state) => state.loadJobLogs)
  const sendJobInput = useApp((state) => state.sendJobInput)
  const cancelJob = useApp((state) => state.cancelJob)
  const startJob = useApp((state) => state.startJob)
  const toast = useToast()

  const ordered = useMemo(
    () =>
      jobs.slice().sort((a, b) => {
        const rank = (state: string): number => (state === 'running' || state === 'starting' ? 0 : 1)
        return rank(a.state) - rank(b.state) || b.startedAt.localeCompare(a.startedAt)
      }),
    [jobs],
  )
  const active = ordered.find((job) => job.id === activeJobId) ?? ordered[0] ?? null
  const logs = active ? logsByJob[active.id] ?? [] : []

  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerm | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const writtenRef = useRef(0)
  const activeIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!activeJobId && ordered[0]) setActiveJob(ordered[0].id)
  }, [activeJobId, ordered, setActiveJob])

  useEffect(() => {
    if (active && !logsByJob[active.id]) void loadJobLogs(active.id)
  }, [active?.id, logsByJob, loadJobLogs])

  useEffect(() => {
    if (!hostRef.current) return
    const term = new XTerm({
      convertEol: true,
      cursorBlink: true,
      cursorStyle: 'bar',
      allowTransparency: true,
      fontFamily: '"Cascadia Code", "SF Mono", ui-monospace, Menlo, monospace',
      fontSize: 11.5,
      lineHeight: 1.45,
      scrollback: 5000,
      theme: {
        background: 'rgba(16,18,22,0.52)',
        foreground: '#c7d0de',
        cursor: '#8ab6ff',
        selectionBackground: 'rgba(138,182,255,0.24)',
        black: '#141619',
        brightBlack: '#697384',
        red: '#d96b6b',
        brightRed: '#f0a0a0',
        green: '#8ab6ff',
        brightGreen: '#a9c7ff',
        yellow: '#d9a441',
        brightYellow: '#f3cf8a',
        blue: '#6ea3f5',
        brightBlue: '#8ab6ff',
        magenta: '#b69be8',
        brightMagenta: '#d0bcf5',
        cyan: '#8ecdd8',
        brightCyan: '#b4e3eb',
        white: '#c7d0de',
        brightWhite: '#f1f5fb',
      },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(hostRef.current)
    fit.fit()
    termRef.current = term
    fitRef.current = fit
    const dataSub = term.onData((data) => {
      const current = useApp.getState().activeJobId
      if (!current) return
      const job = useApp.getState().jobs.find((item) => item.id === current)
      if (!job || (job.state !== 'running' && job.state !== 'starting')) return
      void sendJobInput(current, data.replace(/\r/g, ''))
    })
    const observer = new ResizeObserver(() => {
      try {
        fit.fit()
      } catch {
        // container may be hidden during a transition
      }
    })
    observer.observe(hostRef.current)
    return () => {
      dataSub.dispose()
      observer.disconnect()
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [sendJobInput])

  useEffect(() => {
    const term = termRef.current
    if (!term || !active) return
    if (activeIdRef.current !== active.id) {
      activeIdRef.current = active.id
      writtenRef.current = 0
      term.clear()
    }
    if (writtenRef.current > logs.length) {
      term.clear()
      writtenRef.current = 0
    }
    if (writtenRef.current === 0) {
      term.clear()
      term.write(`\x1b[38;2;138;182;255mMossStudio terminal\x1b[0m  ${active.instanceName}\r\n`)
      const subtitle =
        active.kind === 'training'
          ? `training · step ${active.metrics?.step ?? active.progress.current}/${active.progress.total || '—'}${
              active.metrics?.loss !== undefined ? ` · loss ${active.metrics.loss.toFixed(4)}` : ''
            }`
          : `${active.caseName ?? active.mode} · ${active.params.width}×${active.params.height}`
      term.write(`\x1b[38;2;113;123;138m${subtitle}\x1b[0m\r\n\r\n`)
    }
    for (let index = writtenRef.current; index < logs.length; index += 1) {
      const line = logs[index]!
      const text = line.stream === 'stderr' ? `\x1b[38;2;217;107;107m${line.text}\x1b[0m` : line.text
      term.write(`${text}\r\n`)
    }
    writtenRef.current = logs.length
    fitRef.current?.fit()
  }, [active, logs])

  async function restart(job: typeof jobs[number]): Promise<void> {
    if (job.kind === 'training') {
      toast.push('训练任务请在 Kohaku Trainer 中重新启动', 'info')
      return
    }
    if (!job.params.prompt.trim()) {
      toast.push('这条旧任务没有提示词，请在 MossStudio 中重新生成', 'info')
      return
    }
    try {
      const next = await startJob({
        instanceId: job.instanceId,
        caseId: job.caseId,
        caseName: job.caseName,
        workspace: 'clover',
        deviceId: job.deviceId,
        prompt: job.params.prompt,
        negativePrompt: job.params.negativePrompt,
        width: job.params.width,
        height: job.params.height,
        steps: job.params.steps,
        cfg: job.params.cfg,
        seed: job.params.seed,
        profile: job.params.profile,
        mode: 'runner',
      })
      setActiveJob(next.id)
      toast.push('已重新启动', 'success')
    } catch (error) {
      toast.push(error instanceof Error ? error.message : String(error), 'error')
    }
  }

  return (
    <div className="flex h-full min-h-0 bg-transparent">
      <aside className="glass-thin flex w-[260px] shrink-0 flex-col border-r border-[var(--color-border-subtle)]">
        <header className="flex items-center justify-between border-b border-[var(--color-border-subtle)] px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-[11px] font-medium">
            <SquareTerminal className="size-3.5 text-[var(--color-text-tertiary)]" />
            任务
          </div>
          <span className="text-[9.5px] text-[var(--color-text-tertiary)]">{ordered.length}</span>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {ordered.length === 0 ? (
            <p className="px-3 py-8 text-center text-[10.5px] leading-5 text-[var(--color-text-tertiary)]">
              还没有任务。
              <br />
              去 MossStudio 开始生成。
            </p>
          ) : (
            ordered.map((job) => (
              <button
                key={job.id}
                type="button"
                onClick={() => {
                  setActiveJob(job.id)
                  void loadJobLogs(job.id)
                }}
                className={cn(
                  'mb-1 flex w-full items-start gap-2 rounded-[6px] px-2.5 py-2 text-left transition',
                  job.id === active?.id
                    ? 'bg-white/[0.07]'
                    : 'hover:bg-white/[0.04]',
                )}
              >
                <span className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', stateColor[job.state])} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] font-medium text-[var(--color-text)]">
                    {job.caseName ?? job.instanceName}
                  </span>
                  <span className="mt-0.5 block truncate text-[9.5px] text-[var(--color-text-tertiary)]">
                    {job.kind === 'training' ? '训练' : '推理'} · {stateLabel[job.state]} · {job.instanceName}
                  </span>
                </span>
                {(job.state === 'running' || job.state === 'starting') ? (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(event) => {
                      event.stopPropagation()
                      void cancelJob(job.id)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.stopPropagation()
                        void cancelJob(job.id)
                      }
                    }}
                    className="mt-0.5 rounded-[3px] p-1 text-[var(--color-text-tertiary)] hover:bg-red-500/15 hover:text-red-300"
                  >
                    <Square className="size-3" />
                  </span>
                ) : (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(event) => {
                      event.stopPropagation()
                      void restart(job)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.stopPropagation()
                        void restart(job)
                      }
                    }}
                    className="mt-0.5 rounded-[3px] p-1 text-[var(--color-text-tertiary)] hover:bg-white/[0.08] hover:text-accent-300"
                  >
                    <Play className="size-3" />
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-9 shrink-0 items-center justify-between border-b border-[var(--color-border-subtle)] px-3">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-[11px] font-medium">
              {active ? active.caseName ?? active.instanceName : '没有选中任务'}
            </span>
            {active ? (
              <span className="text-[9.5px] text-[var(--color-text-tertiary)]">
                {active.kind === 'training' ? '训练' : '推理'} · {stateLabel[active.state]} · PID {active.pid ?? '—'}
              </span>
            ) : null}
          </div>
          {active && (active.state === 'running' || active.state === 'starting') ? (
            <button
              type="button"
              onClick={() => void cancelJob(active.id)}
              className="rounded-[4px] px-2 py-1 text-[10px] text-red-300 hover:bg-red-500/10"
            >
              停止
            </button>
          ) : null}
        </header>
        <div ref={hostRef} className="min-h-0 flex-1 p-2" />
      </section>
    </div>
  )
}
