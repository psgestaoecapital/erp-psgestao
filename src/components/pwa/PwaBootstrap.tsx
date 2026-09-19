'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { limparTudo } from '@/lib/agro/rebanhoOffline'
import { APP_URL, canonicalHostname } from '@/lib/appUrl'
import { haFormSujo } from '@/lib/formSujo'

// Registra o service worker (app abre offline) e, no LOGOUT, apaga o snapshot offline do rebanho
// (LGPD: nenhum dado de fazenda fica no aparelho). Também gerencia a atualização de versão do PWA.
// Renderiza (quando há versão nova) um aviso discreto; fora isso é invisível. Montado uma vez no layout.
export default function PwaBootstrap() {
  const [novaVersao, setNovaVersao] = useState(false)

  useEffect(() => {
    // GUARDA DE HOST canônico (RD-38): deployments de preview/hash da Vercel são IMUTÁVEIS e servem o
    // build velho pra sempre — o usuário fica "preso na versão antiga" mesmo logado, e o SW network-first
    // não conserta (a origem está congelada). Se carregou de um *.vercel.app que NÃO é o canônico,
    // redireciona pro canônico preservando path+query+hash. Não age em localhost nem domínio próprio.
    try {
      const host = window.location.hostname
      const bypass = window.localStorage.getItem('ps_allow_preview') === '1'
      if (!bypass && host.endsWith('.vercel.app') && host !== canonicalHostname()) {
        window.location.replace(`${APP_URL}${window.location.pathname}${window.location.search}${window.location.hash}`)
        return // host congelado: não registra SW nem assina auth aqui — vamos sair dele
      }
    } catch { /* a guarda nunca pode derrubar o boot */ }

    let controllerHandler: (() => void) | null = null
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => { /* SW é opcional — não quebra o app */ })

      // #61 (sistêmico): ANTES esta troca de controller (novo deploy → skipWaiting+clientsClaim no sw.js)
      // dava window.location.reload() SEMPRE — recarregando TODAS as abas de todos os usuários a cada
      // deploy (~15 em 18/09), perdendo qualquer formulário aberto. Agora só recarrega sozinho quando é
      // seguro (aba OCULTA e nenhum formulário sujo); caso contrário mostra um aviso "Nova versão" e deixa
      // o usuário recarregar quando quiser. O rascunho do #61 (localStorage+IndexedDB) é a 2ª proteção.
      // Havia um controller ANTES desta troca? No 1º acesso de uma sessão nova (sem SW ainda), o
      // primeiro controllerchange é só o SW assumindo o controle inicial — NÃO é "versão nova", então
      // não mostra aviso nem recarrega. Só tratamos troca quando já existia um controller antes.
      const hadController = !!navigator.serviceWorker.controller
      let recarregando = false
      controllerHandler = () => {
        if (recarregando) return
        if (!hadController) return   // controle inicial da sessão — nada a avisar
        try {
          if (document.visibilityState === 'hidden' && !haFormSujo()) {
            recarregando = true
            window.location.reload()
            return
          }
        } catch { /* qualquer erro → cai no aviso, nunca recarrega por baixo do formulário */ }
        setNovaVersao(true)
      }
      navigator.serviceWorker.addEventListener('controllerchange', controllerHandler)

      // Se já existe um SW novo esperando (waiting) com um controller ativo, avisa (não recarrega sozinho).
      navigator.serviceWorker.getRegistration()
        .then((reg) => { if (reg?.waiting && navigator.serviceWorker.controller) setNovaVersao(true) })
        .catch(() => { /* sem registro ainda */ })
    }

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') void limparTudo()
    })
    return () => {
      sub.subscription.unsubscribe()
      if (controllerHandler && 'serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('controllerchange', controllerHandler)
      }
    }
  }, [])

  if (!novaVersao) return null
  return (
    <div
      role="status"
      style={{
        position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: 16, zIndex: 3000,
        display: 'flex', alignItems: 'center', gap: 12, maxWidth: 'calc(100vw - 32px)',
        background: '#3D2314', color: '#FAF7F2', padding: '10px 14px', borderRadius: 12,
        boxShadow: '0 8px 24px rgba(0,0,0,0.25)', fontSize: 13,
      }}
    >
      <span>Nova versão disponível.</span>
      <button
        type="button"
        onClick={() => { try { window.location.reload() } catch { /* noop */ } }}
        style={{ background: '#C8941A', color: '#3D2314', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
      >
        Atualizar
      </button>
      <button
        type="button"
        onClick={() => setNovaVersao(false)}
        aria-label="Dispensar"
        style={{ background: 'transparent', color: '#FAF7F2', border: 'none', fontSize: 18, lineHeight: 1, cursor: 'pointer', padding: '0 2px' }}
      >
        ×
      </button>
    </div>
  )
}
