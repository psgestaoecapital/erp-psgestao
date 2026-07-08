/* Service Worker PWA Fase A — cache do app shell pra o app ABRIR offline.
 * NAO cacheia a API do Supabase (dado do rebanho vem do IndexedDB, snapshot completo).
 * Estrategia: assets estaticos (_next/JS/CSS/fontes) cache-first; navegacoes
 * network-first com fallback pro cache (ultima versao vista / rota do rebanho). */
// Bump a versão a cada mudança que precise invalidar o cache do shell. O activate
// abaixo apaga TODO cache com nome diferente → força re-fetch limpo pra todos.
// (08/07: v2 destrava usuários presos em bundle velho do PWA #570.)
const CACHE = 'ps-shell-v2'

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  // So mesma origem — nunca cachear Supabase/externos (dado sensivel vem do IndexedDB).
  if (url.origin !== self.location.origin) return

  // Navegacao: network-first, fallback ao cache (ou a rota do rebanho pra abrir offline).
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req)
        const c = await caches.open(CACHE)
        c.put(req, res.clone())
        return res
      } catch {
        return (await caches.match(req))
          || (await caches.match('/dashboard/agro/rebanho'))
          || Response.error()
      }
    })())
    return
  }

  // Assets estaticos: cache-first (offline serve do cache; online popula o cache).
  if (url.pathname.startsWith('/_next/') || /\.(?:js|css|woff2?|png|jpg|jpeg|svg|ico|webmanifest)$/.test(url.pathname)) {
    event.respondWith((async () => {
      const cached = await caches.match(req)
      if (cached) return cached
      try {
        const res = await fetch(req)
        const c = await caches.open(CACHE)
        c.put(req, res.clone())
        return res
      } catch {
        return cached || Response.error()
      }
    })())
  }
})
