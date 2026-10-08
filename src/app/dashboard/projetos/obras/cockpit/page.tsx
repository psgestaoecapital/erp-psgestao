'use client'

// Cockpit da obra — entrada pelo menu: escolha a obra e abra o cockpit (2 toques a partir do menu).
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { comPrazo, MSG_CARREGAMENTO_FALHOU } from '@/lib/comPrazo'
import { useCompanyIds } from '@/lib/useCompanyIds'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)'

type Obra = { id: string; numero: string; nome: string; cliente_nome: string | null; status: string; pct_conclusao: number }

export default function EscolherCockpitPage() {
  const { companyIds } = useCompanyIds()
  const [obras, setObras] = useState<Obra[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')

  const carregar = useCallback(async () => {
    if (!companyIds?.length) { setLoading(false); return }
    setLoading(true); setErro('')
    try {
      const { data, error } = await comPrazo(
        async () => await supabase.rpc('fn_obras_listar', { p_company_ids: companyIds, p_status: null }),
        { ms: 8000, tentativas: 1, label: 'cockpit_escolher_obra' },
      )
      if (error) { setErro(error.message); return }
      setObras((data as Obra[]) ?? [])
    } catch { setErro(MSG_CARREGAMENTO_FALHOU) } finally { setLoading(false) }
  }, [companyIds])
  useEffect(() => { carregar() }, [carregar])

  return (
    <main data-testid="cockpit-escolher" style={{ background: BG, minHeight: '100vh', padding: '20px 16px', color: ESP }}>
      <h1 style={{ fontSize: 22, fontWeight: 600, margin: '0 0 4px' }}>Cockpit da obra</h1>
      <p style={{ fontSize: 13, color: MUT, margin: '0 0 16px' }}>Escolha a obra: avanço, custo, margem, prazo e pendências do dia.</p>
      {loading && <p style={{ fontSize: 13, color: MUT }}>Carregando obras…</p>}
      {erro && <p role="alert" style={{ fontSize: 13, color: '#B91C1C' }}>{erro} <button onClick={carregar} style={{ textDecoration: 'underline', background: 'none', border: 0, cursor: 'pointer' }}>Tentar de novo</button></p>}
      {!loading && !erro && obras.length === 0 && (
        <p style={{ fontSize: 13, color: MUT }}>Nenhuma obra ainda. A obra nasce do orçamento aprovado — <Link href="/dashboard/projetos/propostas" style={{ color: GOLD, fontWeight: 600 }}>ir para Orçamentos</Link>.</p>
      )}
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8, maxWidth: 720 }}>
        {obras.map(o => (
          <li key={o.id}>
            <Link href={`/dashboard/projetos/obras/${o.id}/cockpit?area=hub`} data-testid="cockpit-obra-link"
              style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '12px 14px', border: `1px solid ${LINE}`, borderRadius: 10, background: '#fff', color: ESP, textDecoration: 'none' }}>
              <span><b>{o.numero}</b> · {o.nome}<br /><span style={{ fontSize: 12, color: MUT }}>{o.cliente_nome || 'sem cliente'} · {o.status.replace('_', ' ')}</span></span>
              <span style={{ fontSize: 12, fontWeight: 700, color: GOLD, whiteSpace: 'nowrap' }}>{o.pct_conclusao}% · Abrir →</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  )
}
