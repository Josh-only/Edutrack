import { useEffect, useState } from 'react'
import { getNotifications, markNotificationRead } from '../services/academic'
import type { InAppNotification } from '../services/academic'

export default function NotificationCenter() {
  const [items, setItems] = useState<InAppNotification[]>([])
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void getNotifications().then((result) => {
      if (active) setItems(result)
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Unable to load notifications.')
    })
    return () => { active = false }
  }, [])

  async function markRead(item: InAppNotification) {
    if (item.readAt) return
    setError('')
    try {
      await markNotificationRead(item.id)
      setItems((current) => current.map((notification) =>
        notification.id === item.id ? { ...notification, readAt: new Date().toISOString() } : notification,
      ))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update the notification.')
    }
  }

  const unreadCount = items.filter((item) => !item.readAt).length
  return (
    <div className="notification-center">
      <button
        type="button"
        className="notification-toggle"
        aria-expanded={open}
        aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}
        onClick={() => setOpen((value) => !value)}
      >
        Notifications{unreadCount > 0 && <span className="notification-count">{unreadCount}</span>}
      </button>
      {open && (
        <section className="notification-popover" aria-label="Recent notifications">
          <h2>Notifications</h2>
          {error && <p className="inline-error" role="alert">{error}</p>}
          {items.length === 0 ? <p className="muted">You’re all caught up.</p> : items.map((item) => (
            <button
              type="button"
              className={`notification-item${item.readAt ? '' : ' notification-item--unread'}`}
              key={item.id}
              onClick={() => { void markRead(item) }}
            >
              <span>{item.message}</span>
              <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time>
            </button>
          ))}
        </section>
      )}
    </div>
  )
}
