'use client'

// HB0 · Cockpit — porta de entrada do menu: escolhe a obra e abre /obras/[id]/cockpit (1 obra = abre direto).
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { comPrazo, MSG_CARREGAMENTO_FALHOU } from '@/lib/comPrazo'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)'

const ROTA = '/dashboard/projetos/cockpit'
// Cada situação tem cor e fundo próprios (pílula) — leitura imediata, sem tudo em dourado. Mesmo padrão da OS de obra.
const STATUS: Record<string, { rotulo: string; cor: string; fundo: string }> = {
  em_andamento: { rotulo: 'Em andamento', cor: '#92400E', fundo: 'rgba(200,148,26,0.18)' },
  concluida: { rotulo: 'Concluída', cor: '#15803D', fundo: 'rgba(21,128,61,0.12)' },
  pausada: { rotulo: 'Pausada', cor: '#6B5B4D', fundo: 'rgba(61,35,20,0.07)' },
  cancelada: { rotulo: 'Cancelada', cor: '#B91C1C', fundo: 'rgba(185,28,28,0.08)' },
}
const situacao = (s: string) => STATUS[s] ?? { rotulo: s, cor: GOLD, fundo: 'rgba(200,148,26,0.12)' }

type ObraLinha = {
  obra_id: string; numero: string; nome: string | null; status: string
  custo_previsto: number | null; receita_prevista: number | null; margem_realizada: number | null
}
const brl = (v: number | null | undefined) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }))
// Margem prevista = (receita − custo) / receita; sem receita prevista não há margem a mostrar.
const margemPct = (o: ObraLinha) => (o.receita_prevista && Number(o.receita_prevista) > 0 ? ((Number(o.receita_prevista) - Number(o.custo_previsto ?? 0)) / Number(o.receita_prevista)) * 100 : null)

export default function CockpitEscolherObraPage() {
  const router = useRouter()
  const { companyIds } = useCompanyIds()
  const [obras, setObras] = useState<ObraLinha[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')
  const [busca, setBusca] = useState('')
  const [filtroStatus, setFiltroStatus] = useState('todas')

  useEffect(() => {
    if (!companyIds?.length) { setLoading(false); return }
    let vivo = true
    ;(async () => {
      try {
        const { data, error } = await comPrazo(
          async () => await supabase.from('v_obra_resultado').select('obra_id,numero,nome,status,custo_previsto,receita_prevista,margem_realizada').in('company_id', companyIds).order('numero', { ascending: false }),
          { ms: 8000, tentativas: 1, label: 'cockpit-obras' },
        )
        if (!vivo) return
        if (error) { setErro(error.message); return }
        const lista = (data ?? []) as ObraLinha[]
        if (lista.length === 1) { router.replace(`/dashboard/projetos/obras/${lista[0].obra_id}/cockpit?area=hub`); return }
        setObras(lista)
      } catch { if (vivo) setErro(MSG_CARREGAMENTO_FALHOU) } finally { if (vivo) setLoading(false) }
    })()
    return () => { vivo = false }
  }, [companyIds, router])

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return obras.filter(o => (filtroStatus === 'todas' || o.status === filtroStatus) && (!q || `${o.numero} ${o.nome ?? ''}`.toLowerCase().includes(q)))
  }, [obras, busca, filtroStatus])
  const porSituacao = useMemo(() => obras.reduce<Record<string, number>>((a, o) => { a[o.status] = (a[o.status] ?? 0) + 1; return a }, {}), [obras])

  return (
    <div style={{ background: BG, padding: '20px 24px', color: ESP }} data-testid="cockpit-escolher">
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Cockpit da obra <AjudaCampo chave="projetos.cockpit.escolher_obra" rota={ROTA} /></h1>
      <p style={{ color: MUT, fontSize: 13, margin: '4px 0 16px' }}>Escolha a obra para ver avanço, custo, margem e pendências numa tela só.</p>
      {loading && <div style={{ color: MUT }}>Carregando…</div>}
      {erro && <div style={{ background: '#FBEAEA', color: '#B91C1C', borderRadius: 8, padding: '8px 10px', fontSize: 13 }}>{erro}</div>}
      {!loading && !erro && obras.length === 0 && (
        <div style={{ color: MUT, fontSize: 14 }}>Nenhuma obra ainda. Aprove um orçamento para criar a primeira obra em <Link href="/dashboard/projetos/obras?area=hub" style={{ color: ESP, textDecoration: 'underline' }}>Obras</Link>.</div>
      )}
      {obras.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 12 }}>
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar obra por número ou nome" aria-label="Buscar obra" data-testid="cockpit-busca"
            style={{ flex: '1 1 220px', border: `1px solid ${LINE}`, borderRadius: 8, padding: '8px 10px', fontSize: 14, background: '#fff', color: ESP }} />
          <AjudaCampo chave="projetos.cockpit.busca_obra" rota={ROTA} />
          <select value={filtroStatus} onChange={e => setFiltroStatus(e.target.value)} aria-label="Filtrar por situação" data-testid="cockpit-filtro-status"
            style={{ border: `1px solid ${LINE}`, borderRadius: 8, padding: '8px 10px', fontSize: 14, background: '#fff', color: ESP }}>
            <option value="todas">Todas as situações ({obras.length})</option>
            {Object.keys(porSituacao).map(k => <option key={k} value={k}>{situacao(k).rotulo} ({porSituacao[k]})</option>)}
          </select>
          <AjudaCampo chave="projetos.cockpit.filtro_situacao" rota={ROTA} />
        </div>
      )}
      {obras.length > 0 && visiveis.length === 0 && <div style={{ color: MUT, fontSize: 14 }}>Nenhuma obra para esse filtro.</div>}
      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))' }}>
        {visiveis.map(o => (
          <Link key={o.obra_id} href={`/dashboard/projetos/obras/${o.obra_id}/cockpit?area=hub`} data-testid="cockpit-obra-link"
            style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, padding: '12px 14px', textDecoration: 'none', color: ESP }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{o.numero}</div>
            <div style={{ fontSize: 13, color: MUT, marginTop: 2 }}>{o.nome || 'Sem nome'}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 10, fontSize: 12 }}>
              <div><div style={{ color: MUT }}>Custo previsto <AjudaCampo chave="projetos.cockpit.card_custo" rota={ROTA} /></div><b>{brl(o.custo_previsto)}</b></div>
              <div><div style={{ color: MUT }}>Receita prevista <AjudaCampo chave="projetos.cockpit.card_receita" rota={ROTA} /></div><b>{brl(o.receita_prevista)}</b></div>
              <div style={{ gridColumn: '1 / -1' }}><div style={{ color: MUT }}>Margem <AjudaCampo chave="projetos.cockpit.card_margem" rota={ROTA} /></div>
                <b style={{ color: (margemPct(o) ?? 0) < 0 ? '#B91C1C' : '#15803D' }}>{margemPct(o) == null ? 'Sem receita prevista' : `${margemPct(o)!.toFixed(1).replace('.', ',')}%`}</b></div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3, color: situacao(o.status).cor, background: situacao(o.status).fundo, borderRadius: 999, padding: '2px 9px' }}>{situacao(o.status).rotulo}</span>
              <AjudaCampo chave="projetos.cockpit.status_obra" rota={ROTA} />
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
