'use client'

// Hub · Cockpit da obra (entrada do menu): escolhe a obra e abre o cockpit dela. Dados de fn_obras_listar por empresa.
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { comPrazo, MSG_CARREGAMENTO_FALHOU } from '@/lib/comPrazo'
import { useCompanyIds } from '@/lib/useCompanyIds'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)'

type Obra = { id: string; numero: string; nome: string; cliente_nome: string | null; status: string; pct_conclusao: number }

export default function CockpitEscolherObra() {
  const { companyIds } = useCompanyIds()
  const [obras, setObras] = useState<Obra[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')

  useEffect(() => {
    if (!companyIds?.length) { setLoading(false); return }
    let cancel = false
    ;(async () => {
      setLoading(true); setErro('')
      try {
        const [{ data, error }] = await comPrazo(() => Promise.all([supabase.rpc('fn_obras_listar', { p_company_ids: companyIds, p_status: null })]), { ms: 8000, tentativas: 1, label: 'cockpit_escolher_obra' })
        if (cancel) return
        if (error) setErro(error.message); else setObras((data as Obra[]) ?? [])
      } catch {
        if (!cancel) setErro(MSG_CARREGAMENTO_FALHOU)
      } finally {
        if (!cancel) setLoading(false)
      }
    })()
    return () => { cancel = true }
  }, [companyIds])

  return (
    <div data-testid="hub-cockpit-escolher" style={{ background: BG, minHeight: '100vh', padding: '24px 18px' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700 }}>Hub · Construção</div>
        <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 26, fontWeight: 400, color: ESP, margin: '2px 0 14px' }}>Cockpit da obra</h1>
        <p style={{ fontSize: 13, color: MUT, margin: '0 0 16px' }}>Escolha a obra para ver avanço, custo, margem, prazo e as pendências do dia.</p>
        {loading && <p style={{ color: MUT }}>Carregando…</p>}
        {erro && <p role="alert" style={{ color: '#B91C1C' }}>{erro}</p>}
        {!loading && !erro && obras.length === 0 && (
          <p style={{ color: MUT }}>Nenhuma obra ainda. A obra nasce do orçamento aprovado — <Link href="/dashboard/projetos/propostas" style={{ color: ESP, fontWeight: 700 }}>ir para Orçamentos</Link>.</p>
        )}
        <div style={{ display: 'grid', gap: 8 }}>
          {obras.map((o) => (
            <Link key={o.id} href={`/dashboard/projetos/obras/${o.id}/cockpit?area=hub`} data-testid="cockpit-obra-item"
              style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '12px 14px', border: `1px solid ${LINE}`, borderRadius: 10, background: '#fff', color: ESP, textDecoration: 'none' }}>
              <span><strong>{o.numero}</strong> · {o.nome}{o.cliente_nome ? ` — ${o.cliente_nome}` : ''}</span>
              <span style={{ fontSize: 12, color: MUT, whiteSpace: 'nowrap' }}>{o.status.replace('_', ' ')} · {Math.round(Number(o.pct_conclusao) || 0)}%</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
