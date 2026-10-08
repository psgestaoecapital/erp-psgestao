'use client'

// Cockpit da obra — porta de entrada do menu: escolhe a obra e abre o cockpit dela (2 toques: menu → obra).
// Uma só obra em andamento abre direto. Lista via fn_obras_listar por company_id (mesma RPC da tela Obras).
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { comPrazo, MSG_CARREGAMENTO_FALHOU } from '@/lib/comPrazo'
import { useCompanyIds } from '@/lib/useCompanyIds'

const ESP = '#3D2314', BG = '#FAF7F2', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)'

type Obra = { id: string; numero: string; nome: string; cliente_nome: string | null; status: string; pct_conclusao: number }

export default function CockpitEntradaPage() {
  const router = useRouter()
  const { companyIds } = useCompanyIds()
  const [obras, setObras] = useState<Obra[] | null>(null)
  const [erro, setErro] = useState('')

  useEffect(() => {
    if (!companyIds?.length) return
    let cancel = false
    ;(async () => {
      try {
        const { data, error } = await comPrazo(
          () => supabase.rpc('fn_obras_listar', { p_company_ids: companyIds, p_status: null }),
          { ms: 8000, tentativas: 1, label: 'cockpit_entrada' },
        )
        if (cancel) return
        if (error) { setErro(error.message); return }
        const lista = ((data as Obra[]) ?? []).filter((o) => o.status !== 'cancelada')
        const ativas = lista.filter((o) => o.status === 'em_andamento')
        if (ativas.length === 1) { router.replace(`/dashboard/projetos/obras/${ativas[0].id}/cockpit?area=hub`); return }
        setObras(lista)
      } catch {
        if (!cancel) setErro(MSG_CARREGAMENTO_FALHOU)
      }
    })()
    return () => { cancel = true }
  }, [companyIds, router])

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '24px 18px' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }} data-testid="cockpit-entrada">
        <h1 style={{ fontSize: 24, fontWeight: 600, color: ESP, margin: 0 }}>Cockpit da obra</h1>
        <p style={{ fontSize: 14, color: MUT, margin: '6px 0 18px' }}>Escolha a obra para ver avanço, custo, margem, prazo e pendências do dia.</p>
        {erro && <div role="alert" style={{ color: '#B91C1C', fontSize: 13 }}>{erro}</div>}
        {!erro && obras === null && <div style={{ color: MUT, fontSize: 13 }}>Carregando…</div>}
        {obras && obras.length === 0 && (
          <div style={{ fontSize: 14, color: ESP }}>
            Ainda não há obras. A obra nasce do orçamento aprovado — <Link href="/dashboard/projetos/propostas" style={{ textDecoration: 'underline' }}>abrir Orçamentos</Link>.
          </div>
        )}
        <div style={{ display: 'grid', gap: 10 }}>
          {(obras ?? []).map((o) => (
            <Link key={o.id} href={`/dashboard/projetos/obras/${o.id}/cockpit?area=hub`} data-testid="cockpit-obra-item"
              style={{ display: 'block', padding: '14px 16px', borderRadius: 12, border: `1px solid ${LINE}`, background: '#fff', color: ESP, textDecoration: 'none' }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>{o.numero} · {o.nome}</div>
              <div style={{ fontSize: 12, color: MUT, marginTop: 2 }}>{o.cliente_nome || 'sem cliente'} · {o.pct_conclusao}% concluído</div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
