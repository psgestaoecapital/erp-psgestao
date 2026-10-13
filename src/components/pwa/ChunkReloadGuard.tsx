'use client'

import { useEffect } from 'react'

// Rede de seguranca GLOBAL para ChunkLoadError pos-deploy (dívida "usuario preso em build
// antigo"). Uma aba aberta durante um deploy segue com o bundle velho em memoria; uma navegacao
// client-side chama import() de um chunk cujo hash o deploy novo nao tem -> 404 -> ChunkLoadError.
// Sem captura global (so /dashboard/projetos tinha error boundary), a shell/menu congela em
// "Carregando menu...". Aqui capturamos o erro em window 'error' + 'unhandledrejection' e
// recarregamos UMA vez para pegar o HTML+chunks novos.
//
// Guarda anti-loop por BUILD_ID + timestamp (decisao do CEO): se o reload ja aconteceu NESTE
// build e o erro persiste (o chunk sumiu de vez), NAO insiste — nada de recarregar de hora em
// hora. O build-id e o mesmo do service worker (VERCEL_GIT_COMMIT_SHA), entao muda a cada deploy:
// um deploy novo libera um novo reload; o mesmo build quebrado, nao. sessionStorage (por aba) —
// duas abas recarregam cada uma a sua vez; fechar a aba zera (reabrir ja pega o build novo).
//
// ESCOPO (PR minima): so o reload silencioso de recuperacao. O aviso "nova versao disponivel —
// recarregar" e a atualizacao de aba parada (reg.update) ficam para a PR 2 — reload nao pedido no
// meio de um formulario longo perde o que a pessoa digitou, entao la vira aviso, nao reload.

const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID || 'dev'
const KEY = 'ps_chunk_reload'
const BURST_MS = 10_000 // nao dobra o reload num estouro de erros do mesmo import em segundos

const RE_CHUNK = /ChunkLoadError|Loading chunk [\w./-]+ failed|Failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed/i

function ehChunkError(nome: string | undefined, msg: string | undefined): boolean {
  if (nome === 'ChunkLoadError') return true
  return !!msg && RE_CHUNK.test(msg)
}

export default function ChunkReloadGuard() {
  useEffect(() => {
    function jaTentouNesteBuild(): boolean {
      try {
        const raw = sessionStorage.getItem(KEY)
        if (!raw) return false
        const g = JSON.parse(raw) as { build?: string; ts?: number }
        // build-id: ja recarregamos neste build -> chunk sumiu de vez, nao insiste (nunca de novo).
        if (g.build === BUILD_ID) return true
        // burst: mesmo em build diferente, nao dispara dois reloads em segundos.
        if (typeof g.ts === 'number' && Date.now() - g.ts < BURST_MS) return true
        return false
      } catch { return false }
    }
    function recarregarUmaVez() {
      if (jaTentouNesteBuild()) return
      try { sessionStorage.setItem(KEY, JSON.stringify({ build: BUILD_ID, ts: Date.now() })) } catch { /* storage bloqueado: segue pro reload mesmo assim */ }
      window.location.reload()
    }
    function onError(e: ErrorEvent) {
      const err = e?.error as { name?: string } | undefined
      if (ehChunkError(err?.name, e?.message)) recarregarUmaVez()
    }
    function onRejection(e: PromiseRejectionEvent) {
      const r = e?.reason as { name?: string; message?: string } | string | undefined
      if (typeof r === 'string') { if (ehChunkError(undefined, r)) recarregarUmaVez(); return }
      if (ehChunkError(r?.name, r?.message)) recarregarUmaVez()
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])
  return null
}
