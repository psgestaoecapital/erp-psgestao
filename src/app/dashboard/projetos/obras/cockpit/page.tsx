'use client'

// Hub · Cockpit da obra — porta de entrada pelo menu: escolhe a obra e abre o cockpit (uma só obra abre direto).
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { fmtR } from '@/lib/psgc-tokens'
import { supabase } from '@/lib/supabase'
import { comPrazo, MSG_CARREGAMENTO_FALHOU } from '@/lib/comPrazo'
import { useCompanyIds } from '@/lib/useCompanyIds'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)', VERM = '#B91C1C'

type Obra = { id: string; numero: string; nome: string; cliente_nome: string | null; status: string; valor_previsto: number; pct_conclusao: number }

export default function CockpitEscolhaPage() {
  const router = useRouter()
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
          () => supabase.rpc('fn_obras_listar', { p_company_ids: companyIds, p_status: null }),
          { ms: 8000, tentativas: 1, label: 'projetos_obras_cockpit' })
        if (cancel) return
        if (error) { setErro(error.message); return }
        const lista = (data as Obra[]) ?? []
        const ativas = lista.filter((o) => o.status === 'em_andamento')
        if (lista.length === 1 || ativas.length === 1) {
          router.replace(`/dashboard/projetos/obras/${(ativas[0] ?? lista[0]).id}/cockpit?area=hub`)
          return
        }
        setObras(lista)
      } catch {
        if (!cancel) setErro(MSG_CARREGAMENTO_FALHOU)
      } finally {
        if (!cancel) setLoading(false)
      }
    })()
    return () => { cancel = true }
  }, [companyIds, router])

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '24px 18px' }}>
      <div style={{ maxWidth: 820, margin: '0 auto' }}>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700 }}>Hub · Construção</div>
        <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 26, fontWeight: 400, color: ESP, margin: '2px 0 14px' }}>Cockpit da obra</h1>
        {erro ? (
          <div data-testid="cockpit-erro" style={{ padding: 12, borderRadius: 8, background: '#FBEAEA', color: VERM, fontSize: 13 }}>Não deu para carregar as obras: {erro}</div>
        ) : loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: MUT }}>Carregando…</div>
        ) : obras.length === 0 ? (
          <div style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 24, color: MUT, fontSize: 13 }}>
            Nenhuma obra ainda. A obra nasce quando um orçamento é aprovado.{' '}
            <Link href="/dashboard/projetos/propostas" style={{ color: ESP, fontWeight: 700 }}>Ir para Orçamentos</Link>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ fontSize: 13, color: MUT }}>Escolha a obra:</div>
            {obras.map((o) => (
              <Link key={o.id} href={`/dashboard/projetos/obras/${o.id}/cockpit?area=hub`} data-testid="cockpit-obra"
                style={{ display: 'block', background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 12, textDecoration: 'none', color: ESP }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: GOLD, fontFamily: 'monospace' }}>{o.numero}</span>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>{fmtR(o.valor_previsto)}</span>
                </div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{o.nome}</div>
                <div style={{ fontSize: 11.5, color: MUT }}>{o.cliente_nome || 'Cliente não informado'} · {o.pct_conclusao}% concluído</div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
