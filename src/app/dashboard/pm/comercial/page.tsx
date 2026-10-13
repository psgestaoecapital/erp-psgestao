'use client'
// HUB COMERCIAL (P&M) · dashboard de entrada do comercial. Lê agency_leads / agency_propostas /
// agency_comissao + erp_contratos (novos contratos da agência no mês), tudo escopado por company_id
// (Pilar 2). Só leitura + atalhos. Reusa o tema Espresso das telas do bloco.
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const ESPRESSO = '#3D2314', OFFWHITE = '#FAF7F2', DOURADO = '#C8941A', BORDA = '#E7DED3', TEXTM = '#6b5444', GREEN = '#1F5A1F'
const brl = (v: number | null | undefined) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const ETAPAS: { v: string; l: string; cor: string }[] = [
  { v: 'novo', l: 'Novo', cor: '#F0E9DE' }, { v: 'atendimento', l: 'Atendimento', cor: '#FFF3D6' },
  { v: 'reuniao_agendada', l: 'Reunião', cor: '#FCE9C2' }, { v: 'entendimento', l: 'Entendimento', cor: '#FAD18A' },
  { v: 'proposta', l: 'Proposta', cor: '#F4B860' }, { v: 'negociacao', l: 'Negociação', cor: '#E8A93A' },
  { v: 'ganho', l: 'Ganho', cor: '#DCEFD7' }, { v: 'perdido', l: 'Perdido', cor: '#F4D6D6' },
]

type Lead = { etapa: string; valor_estimado: number | null }
type Prop = { status: string; valor_final: number | null }
type Com = { status: string; valor_comissao: number | null }
type Ctr = { created_at: string; valor_mensal: number | null }

export default function HubComercialPage() {
  const { selInfo, companyIds } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : (companyIds[0] ?? null)
  const [leads, setLeads] = useState<Lead[]>([])
  const [props, setProps] = useState<Prop[]>([])
  const [coms, setComs] = useState<Com[]>([])
  const [ctrs, setCtrs] = useState<Ctr[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    if (!empresa) { setLoading(false); return }
    let alive = true
    void (async () => {
      setLoading(true); setErro(null)
      const [l, p, c, ct] = await Promise.all([
        supabase.from('agency_leads').select('etapa, valor_estimado').eq('company_id', empresa),
        supabase.from('agency_propostas').select('status, valor_final').eq('company_id', empresa),
        supabase.from('agency_comissao').select('status, valor_comissao').eq('company_id', empresa),
        supabase.from('erp_contratos').select('created_at, valor_mensal').eq('company_id', empresa).eq('tipo', 'agencia_pm'),
      ])
      if (!alive) return
      const err = l.error || p.error || c.error || ct.error
      if (err) { setErro(err.message); setLoading(false); return }
      setLeads((l.data ?? []) as Lead[]); setProps((p.data ?? []) as Prop[])
      setComs((c.data ?? []) as Com[]); setCtrs((ct.data ?? []) as Ctr[]); setLoading(false)
    })()
    return () => { alive = false }
  }, [empresa])

  const m = useMemo(() => {
    const emAberto = leads.filter((x) => !['ganho', 'perdido'].includes(x.etapa))
    const funil = ETAPAS.map((e) => ({ ...e, n: leads.filter((l) => l.etapa === e.v).length }))
    const propAbertas = props.filter((x) => ['rascunho', 'enviada'].includes(x.status))
    const propAprov = props.filter((x) => x.status === 'aprovada')
    const conversao = props.length > 0 ? Math.round((propAprov.length / props.length) * 100) : 0
    const ini = new Date(); ini.setDate(1); ini.setHours(0, 0, 0, 0)
    const novosMes = ctrs.filter((x) => new Date(x.created_at) >= ini)
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
      novosContratosR: novosMes.reduce((s, c) => s + Number(c.valor_mensal ?? 0), 0),
    }
  }, [leads, props, coms, ctrs])

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
              <Card titulo="Pipeline (em aberto)" valor={String(m.pipelineN)} sub={brl(m.pipelineR)} href="/dashboard/pm/leads" />
              <Card titulo="Propostas abertas" valor={String(m.propAbertas)} sub={`${m.propAprov} aprovadas`} href="/dashboard/pm/propostas" />
              <Card titulo="Conversão" valor={`${m.conversao}%`} sub={brl(m.emNegociacao) + ' em negociação'} href="/dashboard/pm/propostas" />
              <Card titulo="Comissão a pagar" valor={brl(m.comAPagar)} sub={brl(m.comPrevista) + ' prevista'} href="/dashboard/pm/comissao" cor={DOURADO} />
              <Card titulo="Novos contratos (mês)" valor={String(m.novosContratos)} sub={brl(m.novosContratosR) + '/mês'} cor={GREEN} />
            </div>

            <div style={{ background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: TEXTM, marginBottom: 10 }}>Funil de leads</div>
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

function Card({ titulo, valor, sub, href, cor }: { titulo: string; valor: string; sub?: string; href?: string; cor?: string }) {
  const inner = (
    <div style={{ background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 12, padding: '14px 16px', height: '100%' }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: TEXTM, fontWeight: 700 }}>{titulo}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: cor ?? ESPRESSO, marginTop: 4 }}>{valor}</div>
      {sub && <div style={{ fontSize: 12, color: TEXTM, marginTop: 2 }}>{sub}</div>}
    </div>
  )
  return href ? <Link href={href} style={{ textDecoration: 'none' }}>{inner}</Link> : inner
}

const btnPri: CSSProperties = { border: 'none', background: DOURADO, color: '#fff', borderRadius: 10, padding: '10px 16px', cursor: 'pointer', fontWeight: 700, minHeight: 42, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }
const btnGhost: CSSProperties = { border: `1px solid ${BORDA}`, background: '#fff', color: ESPRESSO, borderRadius: 10, padding: '10px 16px', cursor: 'pointer', minHeight: 42, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }
