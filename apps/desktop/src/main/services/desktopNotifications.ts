import { Notification } from 'electron'
import { getSettings } from './settings'
import { openWindow } from '../windows'

export interface LocalNotificationInput {
  title: string
  body: string
  /** Window to focus when the notification is clicked. */
  windowKind?: 'launcher' | 'terminal'
  route?: string
}

export function localNotificationsSupported(): boolean {
  return Notification.isSupported()
}

/**
 * OS-level notification. This is separate from the renderer's in-app
 * notification list; the setting is checked here so background/main-process
 * events (job completion, update discovery) obey the same switch.
 */
export function pushLocalNotification(input: LocalNotificationInput): boolean {
  if (!getSettings().desktopNotifications) return false
  if (!Notification.isSupported()) return false
  try {
    const notification = new Notification({
      title: input.title,
      body: input.body,
      silent: false,
    })
    notification.on('click', () => {
      const win = openWindow(input.windowKind ?? 'launcher', input.route)
      win.show()
      win.focus()
    })
    notification.show()
    return true
  } catch {
    return false
  }
}

export function pushTestNotification(): boolean {
  return pushLocalNotification({
    title: 'MossStudio 通知测试',
    body: '本地系统通知已启用。任务完成或失败时会在这里提醒。',
    windowKind: 'launcher',
    route: '/settings',
  })
}
