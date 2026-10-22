import { Ipc } from '@shared/channels'
import { call } from './api'

/** Legacy names are UI intents now; only Studio and Trainer are real OS windows. */
export type WindowKind = 'studio' | 'trainer' | 'launcher' | 'creator' | 'terminal' | 'devices'

export interface WindowIntent {
  target: 'studio' | 'management' | 'terminal'
  route?: string
}

export function openWindow(kind: WindowKind, route?: string): void {
  if (kind === 'trainer') {
    void call(Ipc.windowOpen, { kind: 'trainer', route })
    return
  }
  if (window.clover.windowKind === 'trainer') {
    void call(Ipc.windowOpen, { kind: 'studio', route: route ?? '/studio' })
    return
  }
  const intent: WindowIntent =
    kind === 'terminal'
      ? { target: 'terminal' }
      : kind === 'creator'
        ? { target: 'studio', route: route ?? '/studio' }
        : kind === 'launcher'
          ? { target: 'management', route: route ?? '/settings' }
          : kind === 'devices'
            ? { target: 'management', route: '/devices' }
            : { target: 'studio', route: '/studio' }
  window.dispatchEvent(new CustomEvent<WindowIntent>('mossstudio:window-intent', { detail: intent }))
}
