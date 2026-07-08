'use client'

import { useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { limparTudo } from '@/lib/agro/rebanhoOffline'

// Registra o service worker (app abre offline) e, no LOGOUT, apaga o snapshot
// offline do rebanho (LGPD: nenhum dado de fazenda fica no aparelho). Componente
// invisivel, montado uma vez no layout raiz.
export default function PwaBootstrap() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => { /* SW e' opcional — nao quebra o app */ })
      // Auto-atualizacao: quando um SW novo assume o controle (novo deploy → skipWaiting
      // + clientsClaim no sw.js), recarrega UMA vez pra servir a versao nova. Sem isso o
      // usuario ficava preso em bundle velho ate fechar/abrir o app (dívida PWA #570).
      let recarregando = false
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (recarregando) return
        recarregando = true
        window.location.reload()
      })
    }
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') void limparTudo()
    })
    return () => { sub.subscription.unsubscribe() }
  }, [])
  return null
}
