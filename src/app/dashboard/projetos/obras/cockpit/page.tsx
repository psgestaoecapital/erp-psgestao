'use client'

// Cockpit da obra — porta de entrada pelo menu: escolhe a obra e abre /obras/[id]/cockpit (menu → obra = 2 toques).
// Lê fn_obras_listar por company_id (mesma fonte da lista de Obras). 3 estados: erro / vazio / dados.
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { comPrazo, MSG_CARREGAMENTO_FALHOU } from '@/lib/comPrazo'
import { useCompanyIds } from '@/lib/useCompanyIds'

const ESP = '#3D2314', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)'

type Obra = { id: string; numero: string; nome: string; cliente_nome: string | null; status: string }

export default function CockpitEscolherObra() {
  const { companyIds } = useCompanyIds()
  const [obras, setObras] = useState<Obra[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')

  useEffect(() => {
    if (!companyIds?.length) { setLoading(false); return }
    let cancel = false
    setLoading(true); setErro('')
    ;(async () => {
      try {
        const [{ data, error }] = await comPrazo(() => Promise.all([supabase.rpc('fn_obras_listar', { p_company_ids: companyIds, p_status: null })]), { ms: 8000, tentativas: 1, label: 'projetos_cockpit_escolher' })
        if (cancel) return
        if (error) setErro(error.message)
        else setObras(((data as Obra[]) ?? []).filter(o => o.status !== 'cancelada'))
      } catch { if (!cancel) setErro(MSG_CARREGAMENTO_FALHOU) }
      finally { if (!cancel) setLoading(false) }
    })()
    return () => { cancel = true }
  }, [companyIds])

  return (
    <main data-testid="cockpit-escolher-obra" style={{ maxWidth: 880, margin: '0 auto', padding: '24px 16px', color: ESP }}>
      <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>Cockpit da obra</h1>
      <p style={{ fontSize: 13, color: MUT, margin: '4px 0 16px' }}>Escolha a obra para ver avanço, custo, margem, prazo e pendências do dia.</p>
      {loading && <p style={{ fontSize: 13, color: MUT }}>Carregando obras…</p>}
      {erro && <p role="alert" style={{ fontSize: 13, color: '#B91C1C' }}>{erro}</p>}
      {!loading && !erro && obras.length === 0 && (
        <p style={{ fontSize: 13, color: MUT }}>Nenhuma obra nesta empresa ainda. A obra nasce do orçamento aprovado — veja <Link href="/dashboard/projetos/obras" style={{ color: ESP, textDecoration: 'underline' }}>Obras</Link>.</p>
      )}
      <div style={{ display: 'grid', gap: 8 }}>
        {obras.map(o => (
          <Link key={o.id} href={`/dashboard/projetos/obras/${o.id}/cockpit?area=hub`} data-testid="cockpit-obra-link"
            style={{ display: 'block', padding: '12px 14px', border: `1px solid ${LINE}`, borderRadius: 10, background: '#fff', color: ESP, textDecoration: 'none' }}>
            <span style={{ fontSize: 11, color: MUT }}>{o.numero}</span>
            <span style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>{o.nome}</span>
            {o.cliente_nome && <span style={{ fontSize: 12, color: MUT }}>{o.cliente_nome}</span>}
          </Link>
        ))}
      </div>
    </main>
  )
}
