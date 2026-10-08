'use client'

// Cockpit da obra · entrada pelo menu. Escolhe a obra e abre o cockpit dela (1 obra ativa = abre direto).
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const ESP = '#3D2314', BG = '#FAF7F2', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.6)'

type Obra = { id: string; numero: string; nome: string; cliente_nome: string | null; status: string }

export default function CockpitEntradaPage() {
  const { companyIds } = useCompanyIds()
  const router = useRouter()
  const [obras, setObras] = useState<Obra[] | null>(null)
  const [erro, setErro] = useState('')

  useEffect(() => {
    if (!companyIds?.length) return
    let cancel = false
    ;(async () => {
      const { data, error } = await supabase.rpc('fn_obras_listar', { p_company_ids: companyIds, p_status: null })
      if (cancel) return
      if (error) { setErro('Não foi possível carregar as obras agora. Atualize a página.'); return }
      const lista = ((data as Obra[]) ?? [])
      setObras(lista)
      const ativas = lista.filter((o) => o.status === 'em_andamento')
      if (lista.length === 1 || ativas.length === 1) {
        router.replace(`/dashboard/projetos/obras/${(ativas.length === 1 ? ativas[0] : lista[0]).id}/cockpit?area=hub`)
      }
    })()
    return () => { cancel = true }
  }, [companyIds, router])

  return (
    <main style={{ background: BG, minHeight: '60vh', padding: '24px 24px 48px', maxWidth: 960, margin: '0 auto' }} data-testid="cockpit-entrada">
      <h1 style={{ color: ESP, fontSize: 22, fontWeight: 600, margin: 0 }}>Cockpit da obra</h1>
      <p style={{ color: MUT, fontSize: 14, margin: '6px 0 18px' }}>Escolha a obra para ver avanço, custo, margem, prazo e as pendências do dia.</p>
      {erro && <p role="alert" style={{ color: ESP }}>{erro}</p>}
      {!erro && obras === null && <p style={{ color: MUT }}>Carregando…</p>}
      {obras && obras.length === 0 && (
        <p style={{ color: MUT }}>Ainda não há obra nesta empresa. A obra nasce do orçamento aprovado — comece em <Link href="/dashboard/projetos/propostas" style={{ color: ESP, textDecoration: 'underline' }}>Orçamentos</Link>.</p>
      )}
      <div style={{ display: 'grid', gap: 10 }}>
        {(obras ?? []).map((o) => (
          <Link key={o.id} href={`/dashboard/projetos/obras/${o.id}/cockpit?area=hub`} data-testid="cockpit-obra-link"
            style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: '14px 16px', textDecoration: 'none', color: ESP, display: 'block' }}>
            <div style={{ fontWeight: 600, fontSize: 15 }}>{o.numero} · {o.nome}</div>
            <div style={{ fontSize: 12, color: MUT, marginTop: 2 }}>{o.cliente_nome ?? 'Sem cliente'} · {o.status.replace('_', ' ')}</div>
          </Link>
        ))}
      </div>
    </main>
  )
}
