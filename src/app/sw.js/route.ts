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

  // Assets estaticos: NETWORK-FIRST (online sempre pega o bundle novo; offline
  // cai no cache). FIX-DIVIDA-580: o cache-first servia /_next/ ANTIGO pos-deploy
  // ("regressoes-fantasma": categoria DRE, desconciliar, modal Oportunidade). Com
  // network-first o cliente online nunca fica preso num chunk velho; fontes/imagens
  // (imutaveis) tambem revalidam barato via rede e mantem fallback offline.
  if (url.pathname.startsWith('/_next/') || /\\.(?:js|css|woff2?|png|jpg|jpeg|svg|ico|webmanifest)$/.test(url.pathname)) {
    event.respondWith((async () => {
      try {
        const res = await fetch(req)
        const c = await caches.open(CACHE)
        c.put(req, res.clone())
        return res
      } catch {
        return (await caches.match(req)) || Response.error()
      }
    })())
  }
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
