const KEY = 'mossstudio:training-host'

export function getSelectedTrainingHost(): string {
  try { return localStorage.getItem(KEY) || 'local' } catch { return 'local' }
}

export function setSelectedTrainingHost(id: string): void {
  try { localStorage.setItem(KEY, id || 'local') } catch { /* private mode */ }
}

export const TRAINING_HOST_EVENT = 'mossstudio:training-host-changed'

export function announceTrainingHost(id: string): void {
  setSelectedTrainingHost(id)
  window.dispatchEvent(new CustomEvent(TRAINING_HOST_EVENT, { detail: id }))
}
