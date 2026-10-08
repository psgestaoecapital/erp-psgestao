'use client'

// Cockpit da obra — porta de entrada do menu: escolhe a obra (1 toque) e abre o cockpit dela.
// Com uma só obra em andamento, abre direto.
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const ESP = '#3D2314', BG = '#FAF7F2', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)'
type Obra = { id: string; numero: string; nome: string; cliente_nome: string | null; status: string; pct_conclusao: number }

export default function CockpitSeletorPage() {
  const { companyIds } = useCompanyIds()
  const router = useRouter()
  const [obras, setObras] = useState<Obra[] | null>(null)
  const [erro, setErro] = useState('')

  useEffect(() => {
    if (!companyIds?.length) return
    let cancel = false
    void (async () => {
      const { data, error } = await supabase.rpc('fn_obras_listar', { p_company_ids: companyIds, p_status: null })
      if (cancel) return
      if (error) { setErro(error.message); return }
      const l = (data ?? []) as Obra[]
      const ativas = l.filter((o) => o.status === 'em_andamento')
      if (ativas.length === 1) { router.replace(`/dashboard/projetos/obras/${ativas[0].id}/cockpit?area=hub`); return }
      setObras(l)
    })()
    return () => { cancel = true }
  }, [companyIds, router])

  return (
    <main style={{ background: BG, minHeight: '60vh', padding: '24px 20px', maxWidth: 880, margin: '0 auto', color: ESP }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, margin: '0 0 6px' }}>Cockpit da obra</h1>
      <p style={{ color: MUT, margin: '0 0 20px', fontSize: 14 }}>Escolha a obra para ver avanço, custo, margem, prazo e pendências do dia.</p>
      {erro && <p role="alert" style={{ color: '#B91C1C' }}>Não foi possível carregar as obras: {erro}</p>}
      {!erro && obras === null && <p style={{ color: MUT }}>Carregando…</p>}
      {obras?.length === 0 && (
        <p style={{ color: MUT }}>Nenhuma obra ainda. A obra nasce do orçamento aprovado — <Link href="/dashboard/projetos/propostas" style={{ color: ESP, textDecoration: 'underline' }}>ir para Orçamentos</Link>.</p>
      )}
      <div style={{ display: 'grid', gap: 10 }}>
        {obras?.map((o) => (
          <Link key={o.id} href={`/dashboard/projetos/obras/${o.id}/cockpit?area=hub`} data-testid="cockpit-escolher-obra"
            style={{ display: 'block', padding: '14px 16px', border: `1px solid ${LINE}`, borderRadius: 10, background: '#fff', textDecoration: 'none', color: ESP }}>
            <strong style={{ fontSize: 15 }}>{o.numero} · {o.nome}</strong>
            <span style={{ display: 'block', fontSize: 12, color: MUT, marginTop: 2 }}>{o.cliente_nome ?? 'Sem cliente'} · {Math.round(o.pct_conclusao ?? 0)}% concluída</span>
          </Link>
        ))}
      </div>
    </main>
  )
}
