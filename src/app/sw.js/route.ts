import { NextResponse } from 'next/server'

// Service Worker servido por Route Handler (não mais public/sw.js estático) para
// VERSIONAR o cache pelo hash do build AUTOMATICAMENTE. Acaba com o bump manual
// (ps-shell-v1/v2/v3) e com as "regressões-fantasma pós-deploy" (categoria DRE #575,
// desvincular #578): todo deploy tem um SHA diferente → nome de cache novo → o
// activate purga o antigo → o controllerchange (PwaBootstrap #575) recarrega o cliente
// no bundle novo. Zero bump manual daqui pra frente.
export const dynamic = 'force-dynamic'

const BUILD_ID =
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.VERCEL_DEPLOYMENT_ID ||
  'dev'

function swSource(cacheName: string): string {
  return `/* Service Worker PWA — cache versionado pelo build (${cacheName}).
 * Gerado por src/app/sw.js/route.ts. NAO cacheia Supabase/externos.
 * Assets estaticos cache-first; navegacao network-first com fallback ao cache. */
const CACHE = '${cacheName}'

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
        // So cacheia resposta OK: cachear 404/erro faria o proximo load servir o mesmo 404
        // guardado (chunk sumido pos-deploy nunca se recuperava). FIX-CHUNK-RELOAD.
        if (res.ok) { const c = await caches.open(CACHE); c.put(req, res.clone()) }
        return res
      } catch {
        return (await caches.match(req))
          || (await caches.match('/dashboard/agro/rebanho'))
          || Response.error()
      }
    })())
    return
  }

  // Assets estaticos: NETWORK-FIRST (online sempre pega o bundle novo; offline
  // cai no cache). FIX-DIVIDA-580: o cache-first servia /_next/ ANTIGO pos-deploy
  // ("regressoes-fantasma": categoria DRE, desconciliar, modal Oportunidade). Com
  // network-first o cliente online nunca fica preso num chunk velho; fontes/imagens
  // (imutaveis) tambem revalidam barato via rede e mantem fallback offline.
  if (url.pathname.startsWith('/_next/') || /\\.(?:js|css|woff2?|png|jpg|jpeg|svg|ico|webmanifest)$/.test(url.pathname)) {
    event.respondWith((async () => {
      try {
        const res = await fetch(req)
        // So cacheia resposta OK (mesmo motivo do handler de navegacao): um chunk /_next/ que
        // deu 404 pos-deploy nunca pode ficar guardado, senao o reload cai no mesmo 404.
        if (res.ok) { const c = await caches.open(CACHE); c.put(req, res.clone()) }
        return res
      } catch {
        return (await caches.match(req)) || Response.error()
      }
    })())
  }
})

// #120 Web Push (custo zero): o push e so mais um canal do aviso do sininho. O servidor manda
// {titulo, mensagem, link, tag}; 'tag' agrupa (1 por oportunidade) e substitui o aviso anterior.
self.addEventListener('push', (event) => {
  let d = {}
  try { d = event.data ? event.data.json() : {} } catch { d = { titulo: 'PS Gestão', mensagem: event.data ? event.data.text() : '' } }
  const titulo = d.titulo || 'PS Gestão'
  event.waitUntil(self.registration.showNotification(titulo, {
    body: d.mensagem || '',
    icon: '/apple-touch-icon.png',
    badge: '/favicon-32.png',
    tag: d.tag || undefined,
    renotify: !!d.tag,
    data: { link: d.link || '/dashboard' },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const raw = (event.notification.data && event.notification.data.link) || '/dashboard'
  // So caminhos do proprio app (nunca URL externa vinda do payload).
  const alvo = new URL(raw.startsWith('/') && !raw.startsWith('//') ? raw : '/dashboard', self.location.origin).href
  event.waitUntil((async () => {
    const abas = await clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const c of abas) {
      if (c.url.startsWith(self.location.origin) && 'focus' in c) {
        try { await c.navigate(alvo) } catch { /* segue */ }
        return c.focus()
      }
    }
    return clients.openWindow(alvo)
  })())
})
`
}

export function GET() {
  return new NextResponse(swSource(`ps-shell-${BUILD_ID}`), {
    headers: {
      'Content-Type': 'text/javascript; charset=utf-8',
      // sw.js NUNCA deve ficar cacheado no browser — senão o cliente não vê o build
      // novo. no-cache força revalidação a cada load → pega o SHA novo → SW novo.
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Service-Worker-Allowed': '/',
    },
  })
}
