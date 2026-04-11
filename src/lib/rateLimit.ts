/**
 * Rate limiting simples em memória para API Routes.
 * Para produção com múltiplas instâncias, substituir por Redis (Upstash).
 */

interface RateLimitEntry {
  count: number
  resetAt: number
}

const store = new Map<string, RateLimitEntry>()

interface RateLimitOptions {
  windowMs?: number  // janela em ms (padrão: 60s)
  max?: number       // máximo de requisições por janela (padrão: 60)
}

interface RateLimitResult {
  success: boolean
  remaining: number
  resetAt: number
}

export function rateLimit(
  identifier: string,
  { windowMs = 60_000, max = 60 }: RateLimitOptions = {}
): RateLimitResult {
  const now = Date.now()
  const entry = store.get(identifier)

  if (!entry || now > entry.resetAt) {
    store.set(identifier, { count: 1, resetAt: now + windowMs })
    return { success: true, remaining: max - 1, resetAt: now + windowMs }
  }

  entry.count++
  if (entry.count > max) {
    return { success: false, remaining: 0, resetAt: entry.resetAt }
  }

  return { success: true, remaining: max - entry.count, resetAt: entry.resetAt }
}

/** Limpa entradas expiradas (chame periodicamente em cron ou warmup) */
export function cleanupRateLimit() {
  const now = Date.now()
  for (const [key, entry] of store.entries()) {
    if (now > entry.resetAt) store.delete(key)
  }
}
