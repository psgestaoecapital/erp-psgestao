'use client'

// Cockpit da obra — porta de entrada do menu: escolhe a obra e abre o cockpit dela (1 toque na lista).
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { comPrazo, MSG_CARREGAMENTO_FALHOU } from '@/lib/comPrazo'
import { useCompanyIds } from '@/lib/useCompanyIds'

const ESP = '#3D2314', BG = '#FAF7F2', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)'

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
      try {
        const { data, error } = await comPrazo(
          () => Promise.resolve(supabase.rpc('fn_obras_listar', { p_company_ids: companyIds, p_status: null })),
          { ms: 8000, tentativas: 1, label: 'cockpit_escolher' })
        if (cancel) return
        if (error) setErro(error.message); else setObras((data as Obra[]) ?? [])
      } catch { if (!cancel) setErro(MSG_CARREGAMENTO_FALHOU) } finally { if (!cancel) setLoading(false) }
    })()
    return () => { cancel = true }
  }, [companyIds])

  return (
    <main style={{ background: BG, minHeight: '60vh', padding: '24px 16px', maxWidth: 880, margin: '0 auto' }} data-testid="cockpit-escolher">
      <h1 style={{ color: ESP, fontSize: 22, fontWeight: 600, margin: 0 }}>Cockpit da obra</h1>
      <p style={{ color: MUT, fontSize: 13, margin: '4px 0 16px' }}>Escolha a obra para ver avanço, custo, margem, prazo e pendências do dia.</p>
      {loading && <p style={{ color: MUT }}>Carregando…</p>}
      {erro && <p style={{ color: '#B91C1C' }}>{erro}</p>}
      {!loading && !erro && obras.length === 0 && (
        <p style={{ color: MUT }}>Nenhuma obra ainda. A obra nasce do orçamento aprovado — veja em <Link href="/dashboard/projetos/obras" style={{ color: ESP, textDecoration: 'underline' }}>Obras</Link>.</p>
      )}
      <div style={{ display: 'grid', gap: 10 }}>
        {obras.map((o) => (
          <Link key={o.id} href={`/dashboard/projetos/obras/${o.id}/cockpit?area=hub`} data-testid="cockpit-obra-link"
            style={{ display: 'block', background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: '12px 14px', textDecoration: 'none', color: ESP }}>
            <div style={{ fontWeight: 600 }}>{o.numero} · {o.nome}</div>
            <div style={{ fontSize: 12, color: MUT }}>{o.cliente_nome || 'sem cliente'} · {o.status.replace('_', ' ')} · {o.pct_conclusao}% concluído</div>
          </Link>
        ))}
      </div>
    </main>
  )
}
