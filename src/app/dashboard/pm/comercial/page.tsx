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

type Lead = { id: string; nome: string | null; empresa: string | null; etapa: string; valor_estimado: number | null; criado_em: string | null }
type Prop = { id: string; numero: string | null; titulo: string | null; status: string; valor_final: number | null; created_at: string | null }
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
        // RD-98 pilar 1 (falso-dado): ignora registros soft-deletados. Sem o filtro, KPIs/funil contavam
        // leads/propostas excluídos (ex.: 3270 leads com só 8 vivos, 910 propostas com só 3 vivas na DEMO).
        supabase.from('agency_leads').select('id, nome, empresa, etapa, valor_estimado, criado_em').eq('company_id', empresa).is('deleted_at', null).order('criado_em', { ascending: false }),
        supabase.from('agency_propostas').select('id, numero, titulo, status, valor_final, created_at').eq('company_id', empresa).is('deleted_at', null).order('created_at', { ascending: false }),
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
    const propRecusadas = props.filter((x) => x.status === 'recusada')
    // Taxa de conversão = win-rate entre as propostas DECIDIDAS (aprovada + recusada). Antes o denominador era TODAS as
    // propostas (incluindo rascunho/enviada ainda em aberto), o que fazia a taxa cair artificialmente e ficar 0% quando
    // nada ainda tinha sido aprovado (falso-zero, RD-98 p1). Sem nenhuma proposta decidida → null (mostra "—", não 0%).
    const decididas = propAprov.length + propRecusadas.length
    const conversao = decididas > 0 ? Math.round((propAprov.length / decididas) * 100) : null
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
      decididas,
      comPrevista: coms.filter((c) => c.status === 'prevista').reduce((s, c) => s + Number(c.valor_comissao ?? 0), 0),
      comAPagar: coms.filter((c) => c.status === 'a_pagar').reduce((s, c) => s + Number(c.valor_comissao ?? 0), 0),
      novosContratos: novosMes.length,
      novosContratosR: novosMes.reduce((s, c) => s + valorContrato(c), 0),
    }
  }, [leads, props, coms, ctrs, etapas])

  const etapaRotulo = useMemo(() => {
    const et = etapas.length ? etapas : ETAPAS_FALLBACK
    const mapa = new Map(et.map((e) => [e.chave, e.rotulo]))
    return (chave: string) => mapa.get(chave) ?? chave
  }, [etapas])
  const recentLeads = useMemo(() => leads.slice(0, 8), [leads])
  const recentProps = useMemo(() => props.slice(0, 8), [props])

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
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {/* "?" (RD-95) fica FORA do <Link> (botão dentro de <a> é aninhamento inválido). */}
            <span style={{ display: 'inline-flex', alignItems: 'center' }}><Link href="/dashboard/pm/leads" style={btnGhost}>+ Novo lead</Link><AjudaCampo chave="pm.comercial.btn_novo_lead" /></span>
            <span style={{ display: 'inline-flex', alignItems: 'center' }}><Link href="/dashboard/pm/propostas" style={btnPri}>+ Nova proposta</Link><AjudaCampo chave="pm.comercial.btn_nova_proposta" /></span>
          </div>
        </header>

        {erro && <div style={{ background: '#F7E4E4', color: '#7A1F1F', padding: '10px 14px', borderRadius: 10, marginBottom: 12, fontSize: 13 }}>{erro}</div>}
        {loading ? <div style={{ padding: 40, textAlign: 'center', color: TEXTM }}>Carregando…</div> : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px,1fr))', gap: 10, marginBottom: 14 }}>
              <Card titulo="Pipeline (em aberto)" valor={String(m.pipelineN)} sub={brl(m.pipelineR)} href="/dashboard/pm/leads" ajuda="pm.comercial.kpi_pipeline" />
              <Card titulo="Propostas abertas" valor={String(m.propAbertas)} sub={`${m.propAprov} aprovadas`} href="/dashboard/pm/propostas" ajuda="pm.comercial.kpi_propostas" />
              <Card titulo="Conversão" valor={m.conversao == null ? '—' : `${m.conversao}%`} sub={m.conversao == null ? 'sem propostas decididas' : `${m.propAprov} de ${m.decididas} decididas`} href="/dashboard/pm/propostas" ajuda="pm.comercial.kpi_conversao" />
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

            {/* Corpo: antes a tela terminava no funil (vazia abaixo). Agora lista os leads e as propostas recentes,
                com atalho para editar na tela própria (lead no quadro; proposta direto no editor via ?proposta=). */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px,1fr))', gap: 12, marginTop: 14 }}>
              <Painel titulo="Leads recentes" ajuda="pm.comercial.kpi_pipeline" verTodos="/dashboard/pm/leads" verLabel="Abrir quadro de leads →">
                {recentLeads.length === 0 ? <Vazio>Nenhum lead ainda. Use “+ Novo lead”.</Vazio> : (
                  <table style={tbl}>
                    <thead><tr><Th>Lead</Th><Th>Etapa</Th><Th style={{ textAlign: 'right' }}>Valor estimado</Th><Th /></tr></thead>
                    <tbody>
                      {recentLeads.map((l) => (
                        <tr key={l.id} style={linha} data-testid={`comercial-lead-${l.id}`}>
                          <Td><b>{l.nome || 'Sem nome'}</b>{l.empresa && <span style={{ color: TEXTM }}> · {l.empresa}</span>}</Td>
                          <Td style={{ color: TEXTM }}>{etapaRotulo(l.etapa)}</Td>
                          <Td style={{ textAlign: 'right' }}>{l.valor_estimado != null ? brl(l.valor_estimado) : '—'}</Td>
                          <Td style={{ textAlign: 'right' }}><Link href="/dashboard/pm/leads" style={acao}>Editar</Link></Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Painel>

              <Painel titulo="Propostas recentes" ajuda="pm.comercial.kpi_propostas" verTodos="/dashboard/pm/propostas" verLabel="Abrir propostas →">
                {recentProps.length === 0 ? <Vazio>Nenhuma proposta ainda. Use “+ Nova proposta”.</Vazio> : (
                  <table style={tbl}>
                    <thead><tr><Th>Proposta</Th><Th>Status</Th><Th style={{ textAlign: 'right' }}>Valor</Th><Th /></tr></thead>
                    <tbody>
                      {recentProps.map((p) => (
                        <tr key={p.id} style={linha} data-testid={`comercial-proposta-${p.id}`}>
                          <Td><b>{p.titulo || (p.numero ? `Proposta ${p.numero}` : 'Sem título')}</b></Td>
                          <Td><span style={{ ...badge, ...statusCor(p.status) }}>{STATUS_LABEL[p.status] ?? p.status}</span></Td>
                          <Td style={{ textAlign: 'right' }}>{p.valor_final != null ? brl(p.valor_final) : '—'}</Td>
                          <Td style={{ textAlign: 'right' }}><Link href={`/dashboard/pm/propostas?proposta=${p.id}`} style={acao}>Editar</Link></Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Painel>
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

function Painel({ titulo, ajuda, verTodos, verLabel, children }: { titulo: string; ajuda: string; verTodos: string; verLabel: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 12, padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: TEXTM, display: 'inline-flex', alignItems: 'center' }}>{titulo}<AjudaCampo chave={ajuda} /></div>
        <Link href={verTodos} style={{ fontSize: 12, fontWeight: 700, color: ESPRESSO, textDecoration: 'underline' }}>{verLabel}</Link>
      </div>
      <div style={{ overflowX: 'auto' }}>{children}</div>
    </div>
  )
}
function Vazio({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: '20px 8px', textAlign: 'center', color: TEXTM, fontSize: 13, border: `1px dashed ${BORDA}`, borderRadius: 10 }}>{children}</div>
}
function Th({ children, style }: { children?: React.ReactNode; style?: CSSProperties }) { return <th style={{ textAlign: 'left', padding: '6px 10px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: TEXTM, ...style }}>{children}</th> }
function Td({ children, style }: { children?: React.ReactNode; style?: CSSProperties }) { return <td style={{ padding: '7px 10px', color: ESPRESSO, fontSize: 13, ...style }}>{children}</td> }

const STATUS_LABEL: Record<string, string> = { rascunho: 'Rascunho', enviada: 'Enviada', aprovada: 'Aprovada', recusada: 'Recusada', cancelada: 'Cancelada' }
function statusCor(s: string): CSSProperties {
  if (s === 'aprovada') return { background: '#DCEFD7', color: '#1F5A1F' }
  if (s === 'recusada' || s === 'cancelada') return { background: '#F4D6D6', color: '#7A1F1F' }
  if (s === 'enviada') return { background: '#FCE9C2', color: '#7A5A0F' }
  return { background: '#F0E9DE', color: TEXTM }
}
const tbl: CSSProperties = { width: '100%', borderCollapse: 'collapse', minWidth: 300 }
const linha: CSSProperties = { borderTop: `1px solid ${BORDA}` }
const acao: CSSProperties = { fontSize: 12, fontWeight: 700, color: ESPRESSO, textDecoration: 'underline' }
const badge: CSSProperties = { display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700 }

const btnPri: CSSProperties = { border: 'none', background: DOURADO, color: '#fff', borderRadius: 10, padding: '10px 16px', cursor: 'pointer', fontWeight: 700, minHeight: 42, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }
const btnGhost: CSSProperties = { border: `1px solid ${BORDA}`, background: '#fff', color: ESPRESSO, borderRadius: 10, padding: '10px 16px', cursor: 'pointer', minHeight: 42, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }
