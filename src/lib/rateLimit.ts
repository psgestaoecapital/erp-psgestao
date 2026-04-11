const store = new Map<string, { count: number; resetAt: number }>()

export function rateLimit(id: string, windowMs = 60_000, max = 60) {
  const now = Date.now()
  const entry = store.get(id)
  if (!entry || now > entry.resetAt) {
    store.set(id, { count: 1, resetAt: now + windowMs })
    return { success: true, remaining: max - 1 }
  }
  entry.count++
  if (entry.count > max) return { success: false, remaining: 0 }
  return { success: true, remaining: max - entry.count }
}
