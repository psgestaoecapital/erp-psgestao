'use client'

// HB0 · Cockpit — porta de entrada do menu: escolhe a obra e abre /obras/[id]/cockpit (1 obra = abre direto).
import { useEffect, useState } from 'react'
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
  pausada: { rotulo: 'Pausada', cor: '#4A3A2E', fundo: 'rgba(61,35,20,0.10)' },
  cancelada: { rotulo: 'Cancelada', cor: '#B91C1C', fundo: 'rgba(185,28,28,0.08)' },
}
const situacao = (s: string) => STATUS[s] ?? { rotulo: s, cor: GOLD, fundo: 'rgba(200,148,26,0.12)' }

type ObraLinha = {
  obra_id: string; numero: string; nome: string | null; status: string
  custo_previsto: number | null; receita_prevista: number | null; receita_servico: number | null; receita_material: number | null
  custo_material: number | null; custo_viagens: number | null; custo_mao_obra: number | null; custo_rateio: number | null
  margem_alocada: number | null; margem_realizada: number | null
}
const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const num = (n: number | null | undefined) => Number(n ?? 0)
// Indicadores do cartão — mesma conta do cockpit da obra (receita, custo com mão de obra e rateio, margem, avanço financeiro, alerta de custo).
const indicadores = (o: ObraLinha) => {
  const receita = num(o.receita_servico) + num(o.receita_material)
  const custo = num(o.custo_material) + num(o.custo_viagens) + num(o.custo_mao_obra) + num(o.custo_rateio)
  const margem = num(o.margem_alocada ?? o.margem_realizada)
  const avanco = num(o.receita_prevista) > 0 ? Math.min(100, (num(o.receita_servico) / num(o.receita_prevista)) * 100) : null
  const estouro = num(o.custo_previsto) > 0 && custo > num(o.custo_previsto)
  return { receita, custo, margem, avanco, estouro, margemPct: receita > 0 ? (margem / receita) * 100 : null }
}

export default function CockpitEscolherObraPage() {
  const router = useRouter()
  const { companyIds } = useCompanyIds()
  const [obras, setObras] = useState<ObraLinha[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')
  const [busca, setBusca] = useState('')
  const [filtroStatus, setFiltroStatus] = useState('todos')

  useEffect(() => {
    if (!companyIds?.length) { setLoading(false); return }
    let vivo = true
    ;(async () => {
      try {
        const { data, error } = await comPrazo(
          async () => await supabase.from('v_obra_resultado_alocado').select('*').in('company_id', companyIds).order('numero', { ascending: false }),
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

  const visiveis = obras.filter(o => (filtroStatus === 'todos' || o.status === filtroStatus)
    && `${o.numero} ${o.nome ?? ''}`.toLowerCase().includes(busca.trim().toLowerCase()))

  return (
    <div style={{ background: BG, padding: '20px 24px', color: ESP }} data-testid="cockpit-escolher">
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Cockpit da obra <AjudaCampo chave="projetos.cockpit.escolher_obra" rota={ROTA} /></h1>
      <p style={{ color: MUT, fontSize: 13, margin: '4px 0 16px' }}>Escolha a obra para ver avanço, custo, margem e pendências numa tela só.</p>
      {obras.length > 1 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar por número ou nome da obra" aria-label="Buscar obra" data-testid="cockpit-busca"
            style={{ flex: '1 1 220px', border: `1px solid ${LINE}`, borderRadius: 8, padding: '8px 10px', fontSize: 13, background: '#fff', color: ESP }} />
          <AjudaCampo chave="projetos.cockpit.busca_obra" rota={ROTA} />
          <select value={filtroStatus} onChange={e => setFiltroStatus(e.target.value)} aria-label="Filtrar por situação" data-testid="cockpit-filtro-status"
            style={{ border: `1px solid ${LINE}`, borderRadius: 8, padding: '8px 10px', fontSize: 13, background: '#fff', color: ESP }}>
            <option value="todos">Todas as situações</option>
            {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.rotulo}</option>)}
          </select>
          <AjudaCampo chave="projetos.cockpit.filtro_status" rota={ROTA} />
        </div>
      )}
      {loading && <div style={{ color: MUT }}>Carregando…</div>}
      {erro && <div style={{ background: '#FBEAEA', color: '#B91C1C', borderRadius: 8, padding: '8px 10px', fontSize: 13 }}>{erro}</div>}
      {!loading && !erro && obras.length === 0 && (
        <div style={{ color: MUT, fontSize: 14 }}>Nenhuma obra ainda. Aprove um orçamento para criar a primeira obra em <Link href="/dashboard/projetos/obras?area=hub" style={{ color: ESP, textDecoration: 'underline' }}>Obras</Link>.</div>
      )}
      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))' }}>
        {!loading && obras.length > 0 && visiveis.length === 0 && <div style={{ color: MUT, fontSize: 14 }}>Nenhuma obra encontrada com esse filtro.</div>}
        {visiveis.map(o => { const ind = indicadores(o); return (
          <Link key={o.obra_id} href={`/dashboard/projetos/obras/${o.obra_id}/cockpit?area=hub`} data-testid="cockpit-obra-link"
            style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, padding: '12px 14px', textDecoration: 'none', color: ESP }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{o.numero}</div>
            <div style={{ fontSize: 13, color: '#5C4636', marginTop: 2 }}>{o.nome || 'Sem nome'}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3, color: situacao(o.status).cor, background: situacao(o.status).fundo, borderRadius: 999, padding: '2px 9px' }}>{situacao(o.status).rotulo}</span>
              <AjudaCampo chave="projetos.cockpit.status_obra" rota={ROTA} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 10px', marginTop: 10, fontSize: 12 }} data-testid="cockpit-obra-indicadores">
              <div><span style={{ color: MUT }}>Receita</span><div style={{ fontWeight: 700 }}>{brl(ind.receita)}</div></div>
              <div><span style={{ color: MUT }}>Custo</span><div style={{ fontWeight: 700, color: ind.estouro ? '#B91C1C' : ESP }}>{brl(ind.custo)}</div></div>
              <div><span style={{ color: MUT }}>Margem</span><div style={{ fontWeight: 700, color: ind.margem < 0 ? '#B91C1C' : '#15803D' }}>{brl(ind.margem)}{ind.margemPct != null ? ` · ${ind.margemPct.toFixed(0)}%` : ''}</div></div>
              <div><span style={{ color: MUT }}>Avanço</span><div style={{ fontWeight: 700 }}>{ind.avanco == null ? 'Sem itens' : `${ind.avanco.toFixed(0)}%`}</div></div>
            </div>
            {ind.avanco != null && <div style={{ height: 5, background: LINE, borderRadius: 3, marginTop: 8 }}><div style={{ width: `${ind.avanco}%`, height: 5, background: GOLD, borderRadius: 3 }} /></div>}
            {ind.estouro && <div style={{ marginTop: 8, fontSize: 11, fontWeight: 700, color: '#B91C1C' }}>Custo acima do previsto</div>}
          </Link>
        )})}
      </div>
    </div>
  )
}
