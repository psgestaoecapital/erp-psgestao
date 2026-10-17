import { timingSafeEqual } from 'node:crypto'

// Segredo do robô (header x-watcher-secret). Aceita WATCHER_SECRET e, durante a
// rotação, WATCHER_SECRET_NOVO (o valor novo do cofre do banco, `screen_watcher_secret`).
function igual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

export function watcherSecretConfigurado(): boolean {
  return !!(process.env.WATCHER_SECRET || process.env.WATCHER_SECRET_NOVO)
}

export function watcherSecretValido(recebido: string | null | undefined): boolean {
  if (!recebido) return false
  return [process.env.WATCHER_SECRET, process.env.WATCHER_SECRET_NOVO].some(
    (esperado) => !!esperado && igual(recebido, esperado),
  )
}
