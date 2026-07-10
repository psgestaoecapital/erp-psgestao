'use client'

import { useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { limparTudo } from '@/lib/agro/rebanhoOffline'
import { APP_URL, canonicalHostname } from '@/lib/appUrl'

// Registra o service worker (app abre offline) e, no LOGOUT, apaga o snapshot
// offline do rebanho (LGPD: nenhum dado de fazenda fica no aparelho). Componente
// invisivel, montado uma vez no layout raiz.
export default function PwaBootstrap() {
  useEffect(() => {
    // GUARDA DE HOST canônico (RD-38): deployments de preview/hash da Vercel são
    // IMUTÁVEIS e servem o build velho pra sempre — o usuário fica "preso na versão
    // antiga" mesmo logado, e o SW network-first não conserta (a origem está congelada).
    // Se o app carregou de um host *.vercel.app que NÃO é o canônico, redireciona pro
    // canônico preservando path+query+hash. NÃO age em localhost nem domínio próprio;
    // dev pode furar com localStorage ps_allow_preview='1'.
    try {
      const host = window.location.hostname
      const bypass = window.localStorage.getItem('ps_allow_preview') === '1'
      if (!bypass && host.endsWith('.vercel.app') && host !== canonicalHostname()) {
        window.location.replace(`${APP_URL}${window.location.pathname}${window.location.search}${window.location.hash}`)
        return // host congelado: não registra SW nem assina auth aqui — vamos sair dele
      }
    } catch { /* a guarda nunca pode derrubar o boot */ }

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
