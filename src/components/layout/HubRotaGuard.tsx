'use client'

// Guarda de rota do Hub (Onda M0 · CEO 21/11) — defesa em profundidade sobre o filtro do menu lateral
// (module_catalog.ramos_aplicaveis && ramos_da_empresa). Se o TIPO da empresa (modo) não inclui a tela do
// Hub aberta, em vez de 404 mostra uma tela amigável com "Voltar ao painel do Hub". O isolamento PRIMÁRIO é
// o filtro do menu no servidor (fn_modulos_sidebar_por_area) + a RLS das tabelas; esta guarda só evita o
// acesso por URL direta a uma tela que o tipo da empresa não usa.
// - Em consolidado/grupo (sem empresa única) nada é gateado.
// - Falha transitória da RPC: fail-open (não trava a tela).
// - PS admin vendo uma empresa: fn_hub_rota_permitida usa ramos_da_empresa(company_id), então o admin vê o
//   MESMO menu do cliente (suporte enxerga igual) — sem bypass.

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const PAINEL_HUB = '/dashboard/projetos'

export default function HubRotaGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || ''
  const { sel } = useCompanyIds()
  const router = useRouter()
  // Começa em 'checando' (CEO 21/11): enquanto a guarda não confirma, mostramos um carregando curto em vez
  // dos filhos — assim a tela bloqueada nunca "pisca" por um instante antes do aviso quando se chega por URL.
  const [estado, setEstado] = useState<'checando' | 'ok' | 'bloqueado'>('checando')

  useEffect(() => {
    let cancelado = false
    const empresa = sel && sel !== 'consolidado' && !sel.startsWith('group_') ? sel : null
    // Sem empresa única (consolidado/grupo) nada é gateado — libera sem flash de carregando.
    if (!empresa) { setEstado('ok'); return }
    // A cada rota a checar, volta a 'checando' para não exibir a tela anterior enquanto a guarda responde.
    setEstado('checando')
    supabase
      .rpc('fn_hub_rota_permitida', { p_company_id: empresa, p_rota: pathname })
      .then(({ data, error }) => {
        if (cancelado) return
        // falha transitória: não trava a tela — o filtro do menu no servidor + a RLS são o primário (fail-open)
        if (error) { setEstado('ok'); return }
        setEstado(data === false ? 'bloqueado' : 'ok')
      })
    return () => { cancelado = true }
  }, [pathname, sel])

  if (estado === 'checando') {
    return (
      <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#FAF7F2' }}>
        <div style={{ textAlign: 'center' }} aria-live="polite" aria-busy="true">
          <div
            style={{ width: 28, height: 28, margin: '0 auto 12px', borderRadius: '50%', border: '3px solid rgba(200,148,26,0.25)', borderTopColor: '#C8941A', animation: 'hubguard-spin 0.8s linear infinite' }}
          />
          <p style={{ fontSize: 13, color: 'rgba(61,35,20,0.55)', margin: 0 }}>Carregando…</p>
          <style>{'@keyframes hubguard-spin{to{transform:rotate(360deg)}}'}</style>
        </div>
      </div>
    )
  }

  if (estado === 'bloqueado') {
    return (
      <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#FAF7F2' }}>
        <div style={{ textAlign: 'center', maxWidth: 460 }}>
          <p style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 22, color: '#3D2314', margin: '0 0 8px' }}>
            Esta tela não faz parte do Hub para o tipo da sua empresa
          </p>
          <p style={{ fontSize: 14, color: 'rgba(61,35,20,0.6)', margin: '0 0 20px' }}>
            Você pode mudar o tipo da sua empresa em Configurações do Hub, se quiser liberar mais telas.
          </p>
          <button
            type="button"
            onClick={() => router.replace(PAINEL_HUB)}
            style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 15, color: '#fff', background: '#C8941A', border: 'none', borderRadius: 12, padding: '10px 22px', cursor: 'pointer' }}
          >
            Voltar ao painel do Hub
          </button>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
