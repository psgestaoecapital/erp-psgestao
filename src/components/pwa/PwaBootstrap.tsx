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
    }
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') void limparTudo()
    })
    return () => { sub.subscription.unsubscribe() }
  }, [])
  return null
}
