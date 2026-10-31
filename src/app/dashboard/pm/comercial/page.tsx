'use client'
// HUB COMERCIAL (P&M) · dashboard de entrada do comercial. Lê agency_leads / agency_propostas /
// agency_comissao + agency_contratos (novos contratos da agência no mês), tudo escopado por company_id
// (Pilar 2). Só leitura + atalhos. Reusa o tema Espresso das telas do bloco.
// FONTE: "Novos contratos (mês)" lê agency_contratos (tabela nativa P&M). Antes lia erp_contratos
// (tipo='agencia_pm'), que o fluxo da agência nunca popula → card ficava zerado (falso-zero, RD-98 p1).
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ESPRESSO = '#3D2314', OFFWHITE = '#FAF7F2', DOURADO = '#C8941A', BORDA = '#E7DED3', TEXTM = '#6b5444', GREEN = '#1F5A1F'
const brl = (v: number | null | undefined) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

// O funil é CONFIGURÁVEL por empresa (funil_etapa) — a mesma fonte do quadro de Leads
// (fn_funil_etapas_listar). A lista fixa antiga ('novo', 'atendimento', 'reuniao_agendada'…)
// não batia com as chaves reais ('novo_atendimento', 'reuniao'…), então o maior estágio do
// funil aparecia zerado. Carregamos as etapas reais; o fallback abaixo usa as chaves canônicas.
const TIPO_FUNIL = 'leads'
type Etapa = { chave: string; rotulo: string; ordem: number; cor: string | null; tipo_etapa: string }
const ETAPAS_FALLBACK: Etapa[] = [
  { chave: 'novo_atendimento', rotulo: 'Novo atendimento', ordem: 10, cor: '#F0E9DE', tipo_etapa: 'normal' },
  { chave: 'reuniao', rotulo: 'Reunião', ordem: 20, cor: '#FCE9C2', tipo_etapa: 'normal' },
  { chave: 'proposta', rotulo: 'Proposta', ordem: 30, cor: '#F4B860', tipo_etapa: 'normal' },
  { chave: 'negociacao', rotulo: 'Negociação', ordem: 40, cor: '#E8A93A', tipo_etapa: 'normal' },
  { chave: 'ganho', rotulo: 'Ganho', ordem: 50, cor: '#DCEFD7', tipo_etapa: 'ganho' },
  { chave: 'perdido', rotulo: 'Perdido', ordem: 60, cor: '#F4D6D6', tipo_etapa: 'perda' },
]

type Lead = { etapa: string; valor_estimado: number | null }
type Prop = { status: string; valor_final: number | null }
type Com = { status: string; valor_comissao: number | null }
type Ctr = { data_inicio: string | null; tipo: string | null; fee_mensal: number | null; valor_projeto: number | null }

export default function HubComercialPage() {
  const { selInfo, companyIds } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : (companyIds[0] ?? null)
  const [leads, setLeads] = useState<Lead[]>([])
  const [props, setProps] = useState<Prop[]>([])
  const [coms, setComs] = useState<Com[]>([])
  const [ctrs, setCtrs] = useState<Ctr[]>([])
  const [etapas, setEtapas] = useState<Etapa[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    if (!empresa) { setLoading(false); return }
    let alive = true
    void (async () => {
      setLoading(true); setErro(null)
      const [l, p, c, ct, fe] = await Promise.all([
        supabase.from('agency_leads').select('etapa, valor_estimado').eq('company_id', empresa),
        supabase.from('agency_propostas').select('status, valor_final').eq('company_id', empresa),
        supabase.from('agency_comissao').select('status, valor_comissao').eq('company_id', empresa),
        supabase.from('agency_contratos').select('data_inicio, tipo, fee_mensal, valor_projeto').eq('company_id', empresa).eq('status', 'ativo'),
        supabase.rpc('fn_funil_etapas_listar', { p_company_id: empresa, p_tipo_funil: TIPO_FUNIL }),
      ])
      if (!alive) return
      const err = l.error || p.error || c.error || ct.error
      if (err) { setErro(err.message); setLoading(false); return }
      setLeads((l.data ?? []) as Lead[]); setProps((p.data ?? []) as Prop[])
      setComs((c.data ?? []) as Com[]); setCtrs((ct.data ?? []) as Ctr[])
      // Funil é enriquecimento: se não carregar, o fallback canônico cobre (não derruba a tela).
      setEtapas(((fe.data ?? []) as Etapa[]).slice().sort((a, b) => a.ordem - b.ordem))
      setLoading(false)
    })()
    return () => { alive = false }
  }, [empresa])

  const m = useMemo(() => {
    const et = etapas.length ? etapas : ETAPAS_FALLBACK
    const fechadas = new Set(et.filter((e) => e.tipo_etapa !== 'normal').map((e) => e.chave))
    const emAberto = leads.filter((x) => !fechadas.has(x.etapa))
    const funil = et.map((e) => ({ v: e.chave, l: e.rotulo, cor: e.cor ?? OFFWHITE, n: leads.filter((l) => l.etapa === e.chave).length }))
    const propAbertas = props.filter((x) => ['rascunho', 'enviada'].includes(x.status))
    const propAprov = props.filter((x) => x.status === 'aprovada')
    const conversao = props.length > 0 ? Math.round((propAprov.length / props.length) * 100) : 0
    // "Novos no mês" = contratos cujo início (data_inicio) cai no mês corrente. Compara por ano-mês
    // (prefixo YYYY-MM) para não sofrer com fuso na virada do dia 1.
    const now = new Date(); const curYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const valorContrato = (c: Ctr) => Number((c.tipo === 'projeto' ? c.valor_projeto : c.fee_mensal) ?? 0)
    const novosMes = ctrs.filter((x) => (x.data_inicio ?? '').slice(0, 7) === curYM)
    return {
      pipelineN: emAberto.length,
      pipelineR: emAberto.reduce((s, l) => s + Number(l.valor_estimado ?? 0), 0),
      funil,
      propAbertas: propAbertas.length,
      propAprov: propAprov.length,
      emNegociacao: propAbertas.reduce((s, p) => s + Number(p.valor_final ?? 0), 0),
      conversao,
      comPrevista: coms.filter((c) => c.status === 'prevista').reduce((s, c) => s + Number(c.valor_comissao ?? 0), 0),
      comAPagar: coms.filter((c) => c.status === 'a_pagar').reduce((s, c) => s + Number(c.valor_comissao ?? 0), 0),
      novosContratos: novosMes.length,
      novosContratosR: novosMes.reduce((s, c) => s + valorContrato(c), 0),
    }
  }, [leads, props, coms, ctrs, etapas])

  if (!empresa) return <div style={{ padding: 32, color: TEXTM, background: OFFWHITE, minHeight: '100vh' }}>Selecione uma empresa no topo.</div>

  return (
    <div style={{ background: OFFWHITE, minHeight: '100vh', padding: '24px 18px', color: ESPRESSO }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: DOURADO, fontWeight: 700 }}>🎯 P&amp;M · Comercial</div>
            <h1 style={{ fontSize: 26, fontWeight: 700, margin: '2px 0 0' }}>Hub Comercial</h1>
            <p style={{ fontSize: 13, color: TEXTM, margin: '4px 0 0' }}>Pipeline, propostas, comissão e novos contratos — num lugar só.</p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link href="/dashboard/pm/leads" style={btnGhost}>+ Novo lead</Link>
            <Link href="/dashboard/pm/propostas" style={btnPri}>+ Nova proposta</Link>
          </div>
        </header>

        {erro && <div style={{ background: '#F7E4E4', color: '#7A1F1F', padding: '10px 14px', borderRadius: 10, marginBottom: 12, fontSize: 13 }}>{erro}</div>}
        {loading ? <div style={{ padding: 40, textAlign: 'center', color: TEXTM }}>Carregando…</div> : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px,1fr))', gap: 10, marginBottom: 14 }}>
              <Card titulo="Pipeline (em aberto)" valor={String(m.pipelineN)} sub={brl(m.pipelineR)} href="/dashboard/pm/leads" ajuda="pm.comercial.kpi_pipeline" />
              <Card titulo="Propostas abertas" valor={String(m.propAbertas)} sub={`${m.propAprov} aprovadas`} href="/dashboard/pm/propostas" ajuda="pm.comercial.kpi_propostas" />
              <Card titulo="Conversão" valor={`${m.conversao}%`} sub={brl(m.emNegociacao) + ' em negociação'} href="/dashboard/pm/propostas" ajuda="pm.comercial.kpi_conversao" />
              <Card titulo="Comissão a pagar" valor={brl(m.comAPagar)} sub={brl(m.comPrevista) + ' prevista'} href="/dashboard/pm/comissao" cor={DOURADO} ajuda="pm.comercial.kpi_comissao" />
              <Card titulo="Novos contratos (mês)" valor={String(m.novosContratos)} sub={brl(m.novosContratosR) + '/mês'} cor={GREEN} ajuda="pm.comercial.kpi_contratos" />
            </div>

            <div style={{ background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: TEXTM, marginBottom: 10, display: 'inline-flex', alignItems: 'center' }}>Funil de leads<AjudaCampo chave="pm.comercial.funil" /></div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {m.funil.map((e) => (
                  <div key={e.v} style={{ flex: '1 1 90px', minWidth: 90, background: e.cor, borderRadius: 10, padding: '10px 12px', textAlign: 'center' }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: ESPRESSO }}>{e.n}</div>
                    <div style={{ fontSize: 11, color: ESPRESSO, marginTop: 2 }}>{e.l}</div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Card({ titulo, valor, sub, href, cor, ajuda }: { titulo: string; valor: string; sub?: string; href?: string; cor?: string; ajuda?: string }) {
  // O "?" (RD-95) fica FORA do <Link> (botão dentro de <a> é aninhamento inválido); o valor/subtítulo seguem clicáveis.
  const corpoClicavel = (
    <>
      <div style={{ fontSize: 24, fontWeight: 700, color: cor ?? ESPRESSO, marginTop: 4 }}>{valor}</div>
      {sub && <div style={{ fontSize: 12, color: TEXTM, marginTop: 2 }}>{sub}</div>}
    </>
  )
  return (
    <div style={{ background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 12, padding: '14px 16px', height: '100%' }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: TEXTM, fontWeight: 700, display: 'inline-flex', alignItems: 'center' }}>{titulo}{ajuda && <AjudaCampo chave={ajuda} />}</div>
      {href ? <Link href={href} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>{corpoClicavel}</Link> : corpoClicavel}
    </div>
  )
}

const btnPri: CSSProperties = { border: 'none', background: DOURADO, color: '#fff', borderRadius: 10, padding: '10px 16px', cursor: 'pointer', fontWeight: 700, minHeight: 42, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }
const btnGhost: CSSProperties = { border: `1px solid ${BORDA}`, background: '#fff', color: ESPRESSO, borderRadius: 10, padding: '10px 16px', cursor: 'pointer', minHeight: 42, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }
