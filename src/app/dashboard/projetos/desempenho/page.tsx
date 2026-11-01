'use client'

// Hub · Desempenho Comercial por vendedor. Tudo vem de fn_crm_desempenho (RD-38: nada fixo). Gestor vê
// todos + ranking; vendedor vê só o seu (a RPC força o escopo por papel · Pilar 2). Blocos A-E do SPEC.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)', VERDE = '#16A34A', AMBAR = '#B45309', VERM = '#B91C1C', ROXO = '#8B5CF6'
const brl = (v: number) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const pct = (v: number | null) => (v == null ? '—' : `${v}%`)
const iso = (d: Date) => d.toISOString().slice(0, 10)
const dataBR = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? s.split('-').reverse().join('/') : s)

type Resumo = { oportunidades: number; valor_pipeline: number; propostas: number; ganhas_qtd: number; ganhas_valor: number; perdidas_qtd: number; perdidas_valor: number; ticket_medio: number; comissao: number; conversao_pct: number | null }
type FunilEtapa = { etapa: string; qtd: number; valor: number }
type RankRow = { responsavel_id: string | null; responsavel_nome: string; oportunidades: number; propostas: number; ganhas: number; ganhas_valor: number; ticket: number; comissao: number; conversao_pct: number | null }
type Perda = { motivo: string; qtd: number; valor: number }
type Resp = { gestor: boolean; de: string; ate: string; vendedor: string | null; resumo: Resumo; funil: FunilEtapa[]; ranking: RankRow[] | null; perdas: Perda[]; velocidade_dias: number | null; erro?: string }

const ETAPA_LABEL: Record<string, string> = { prospeccao: 'Prospecção', visita_agendada: 'Visita agendada', visita_feita: 'Visita feita', orcando: 'Orçando', proposta_enviada: 'Proposta', negociacao: 'Negociação', ganho: 'Ganho', perdido: 'Perdido' }
const corConversao = (v: number | null) => (v == null ? MUT : v >= 40 ? VERDE : v >= 20 ? AMBAR : VERM)
const rotConversao = (v: number | null) => (v == null ? '—' : v >= 40 ? 'alta' : v >= 20 ? 'média' : 'baixa')

// Período sem nenhum registro (nem pipeline aberto): a tela parece quebrada se mostrar só zeros (RD-98).
const periodoVazio = (r: Resumo | undefined) => !!r && r.oportunidades === 0 && r.propostas === 0 && r.ganhas_qtd === 0 && r.perdidas_qtd === 0 && r.valor_pipeline === 0

function preset(p: string): { de: string; ate: string } {
  const h = new Date()
  if (p === 'mes') return { de: iso(new Date(h.getFullYear(), h.getMonth(), 1)), ate: iso(new Date(h.getFullYear(), h.getMonth() + 1, 0)) }
  if (p === 'tri') { const q = Math.floor(h.getMonth() / 3) * 3; return { de: iso(new Date(h.getFullYear(), q, 1)), ate: iso(new Date(h.getFullYear(), q + 3, 0)) } }
  return { de: iso(new Date(h.getFullYear(), 0, 1)), ate: iso(new Date(h.getFullYear(), 11, 31)) } // ano
}

export default function DesempenhoComercialPage() {
  const { companyIds } = useCompanyIds()
  const [periodo, setPeriodo] = useState('mes')
  const [range, setRange] = useState(preset('mes'))
  const [data, setData] = useState<Resp | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')
  // Abertura sem clique (RD-98): se o mês corrente não tem nada fechado, a 1ª carga já escolhe o menor período
  // maior com dado (trimestre → ano → 12 meses) e avisa. Roda uma vez por abertura da tela.
  const autoFeito = useRef(false)
  const seq = useRef(0) // só a última chamada pinta: respostas atrasadas (companyIds muda após o 1º render) não zeram a tela
  const [nota, setNota] = useState('')

  const buscar = useCallback(async (de: string, ate: string) => {
    const { data: d, error } = await supabase.rpc('fn_crm_desempenho', { p_company_ids: companyIds, p_de: de, p_ate: ate, p_vendedor: null })
    return { r: d as Resp | null, error }
  }, [companyIds])

  const carregar = useCallback(async () => {
    if (!companyIds?.length) { setLoading(false); return }
    const meu = ++seq.current
    setLoading(true); setErro('')
    const { r: r0, error } = await buscar(range.de, range.ate)
    if (meu !== seq.current) return
    if (error) { setLoading(false); setErro(error.message); return }
    if (r0?.erro) { setLoading(false); setErro(r0.erro === 'sem_acesso' ? 'Sem acesso.' : r0.erro); return }
    const fechados = (x: Resp | null) => (x?.resumo?.ganhas_qtd ?? 0) + (x?.resumo?.perdidas_qtd ?? 0)
    if (!autoFeito.current && periodo === 'mes') {
      if (fechados(r0) === 0) {
        const h = new Date(), h12 = new Date(h); h12.setFullYear(h.getFullYear() - 1)
        const cands: [string, string, { de: string; ate: string }][] = [
          ['tri', 'o trimestre', preset('tri')], ['ano', 'o ano', preset('ano')], ['custom', 'os últimos 12 meses', { de: iso(h12), ate: iso(h) }],
        ]
        for (const [per, rot, rg] of cands) {
          const { r } = await buscar(rg.de, rg.ate)
          if (meu !== seq.current) return
          if (r && !r.erro && fechados(r) > 0) {
            setNota(`Mostrando ${rot} (${dataBR(rg.de)} a ${dataBR(rg.ate)}) porque o mês atual ainda não tem vendas fechadas.`)
            autoFeito.current = true
            setPeriodo(per); setRange(rg); setData(r); setLoading(false)
            return
          }
        }
      }
    }
    autoFeito.current = true
    setLoading(false)
    setData(r0)
  }, [companyIds, range, periodo, buscar])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])
  const setPreset = (p: string) => { setNota(''); setPeriodo(p); if (p !== 'custom') setRange(preset(p)) }

  const r = data?.resumo
  const maxFunil = useMemo(() => Math.max(1, ...(data?.funil ?? []).map((f) => f.qtd)), [data])
  // período sem nenhum registro → aviso honesto em vez de parede de zeros (RD-98)
  const vazio = periodoVazio(r)

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '24px 18px' }}>
      <div style={{ maxWidth: 1080, margin: '0 auto' }}>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700 }}>Hub · Comercial</div>
        <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 26, fontWeight: 400, color: ESP, margin: '2px 0 12px' }}>
          Desempenho Comercial {data && !data.gestor && <span style={{ fontSize: 13, color: MUT }}>· seus números</span>}
        </h1>

        {/* período */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
          {[['mes', 'Mês'], ['tri', 'Trimestre'], ['ano', 'Ano'], ['custom', 'Personalizado']].map(([v, l]) => (
            <button key={v} onClick={() => setPreset(v)} style={{ padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: `1px solid ${periodo === v ? GOLD : LINE}`, background: periodo === v ? '#FBF4E4' : '#FFF', color: periodo === v ? '#A57A15' : MUT }}>{l}</button>
          ))}
          {periodo === 'custom' && (
            <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input type="date" value={range.de} onChange={(e) => { setRange((x) => ({ ...x, de: e.target.value })) }} style={inp} /><AjudaCampo chave="projetos.desempenho.periodo" />
              <input type="date" value={range.ate} onChange={(e) => { setRange((x) => ({ ...x, ate: e.target.value })) }} style={inp} /><AjudaCampo chave="projetos.desempenho.periodo" />
            </span>
          )}
          {periodo !== 'custom' && <AjudaCampo chave="projetos.desempenho.periodo" />}
        </div>

        {nota && <div data-testid="desempenho-auto-periodo" style={{ padding: '9px 14px', borderRadius: 8, background: '#FBF4E4', border: `1px solid ${GOLD}`, color: ESP, fontSize: 12.5, marginBottom: 12 }}>{nota}</div>}
        {erro && <div style={{ padding: '10px 14px', borderRadius: 8, background: '#FBEAEA', color: VERM, fontSize: 13, marginBottom: 12 }}>{erro}</div>}
        {loading ? <div style={{ padding: 40, textAlign: 'center', color: MUT }}>Carregando…</div> : !data ? (
          <div style={{ padding: 40, textAlign: 'center', color: MUT }}>Selecione uma empresa do Hub.</div>
        ) : (
          <>
            {/* Estado vazio honesto (RD-98): quando não há nenhum registro no período, os KPIs abaixo ficam todos em
                zero. Sem este aviso, a tela parece quebrada. Explica que zero é ausência de dados (não erro) e oferece
                o próximo passo — abrir Oportunidades ou ampliar o período. */}
            {vazio && (
              <div data-testid="desempenho-vazio" style={{ background: '#FBF4E4', border: `1px solid ${GOLD}`, borderRadius: 12, padding: '16px 18px', marginBottom: 16 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: ESP }}>Nenhuma oportunidade neste período</div>
                <div style={{ fontSize: 12.5, color: MUT, marginTop: 4, lineHeight: 1.5 }}>
                  Os indicadores abaixo ficam zerados porque não há oportunidades, propostas ou vendas registradas entre{' '}
                  <b style={{ color: ESP }}>{dataBR(range.de)}</b> e <b style={{ color: ESP }}>{dataBR(range.ate)}</b>. Isso não é um erro da tela — é a ausência de registros no período.
                </div>
                <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <Link href="/dashboard/projetos/oportunidades" style={{ padding: '7px 14px', borderRadius: 8, fontSize: 12.5, fontWeight: 700, background: GOLD, color: '#FFF', textDecoration: 'none' }}>Ver oportunidades</Link>
                  {periodo !== 'ano' && <button onClick={() => setPreset('ano')} style={{ padding: '7px 14px', borderRadius: 8, fontSize: 12.5, fontWeight: 700, border: `1px solid ${GOLD}`, background: '#FFF', color: '#A57A15', cursor: 'pointer' }}>Ampliar para o ano</button>}
                </div>
              </div>
            )}

            {/* Bloco A · cartões */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, marginBottom: 16 }}>
              <Card titulo="Conversão" valor={pct(r!.conversao_pct)} cor={corConversao(r!.conversao_pct)} sub={rotConversao(r!.conversao_pct)} ajuda="projetos.desempenho.conversao" />
              <Card titulo="Ganhas" valor={String(r!.ganhas_qtd)} cor={VERDE} sub={brl(r!.ganhas_valor)} ajuda="projetos.desempenho.ganhas" />
              <Card titulo="Perdidas" valor={String(r!.perdidas_qtd)} cor={VERM} sub={brl(r!.perdidas_valor)} ajuda="projetos.desempenho.perdidas" />
              <Card titulo="Ticket médio" valor={brl(r!.ticket_medio)} cor={ESP} ajuda="projetos.desempenho.ticket_medio" />
              <Card titulo="Comissão gerada" valor={brl(r!.comissao)} cor={GOLD} ajuda="projetos.desempenho.comissao" />
              <Card titulo="Pipeline aberto" valor={brl(r!.valor_pipeline)} cor={ROXO} sub={`${r!.oportunidades} oport. · ${r!.propostas} propostas`} ajuda="projetos.desempenho.pipeline" />
              <Card titulo="Velocidade" valor={data.velocidade_dias != null ? `${data.velocidade_dias} d` : '—'} cor={ESP} sub="média até fechar" ajuda="projetos.desempenho.velocidade" />
            </div>

            {/* Bloco B · funil */}
            <Secao titulo="Funil por fase" ajuda="projetos.desempenho.funil">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {data.funil.map((f) => (
                  <div key={f.etapa} style={{ display: 'grid', gridTemplateColumns: '110px 1fr auto', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 12, color: ESP, fontWeight: 600 }}>{ETAPA_LABEL[f.etapa] ?? f.etapa}</span>
                    <div style={{ background: BG, borderRadius: 6, height: 22, position: 'relative', overflow: 'hidden' }}>
                      <div style={{ width: `${(f.qtd / maxFunil) * 100}%`, height: '100%', background: f.etapa === 'ganho' ? VERDE : f.etapa === 'perdido' ? VERM : GOLD, opacity: 0.85, borderRadius: 6, minWidth: f.qtd > 0 ? 3 : 0 }} />
                    </div>
                    <span style={{ fontSize: 12, color: MUT, whiteSpace: 'nowrap' }}><b style={{ color: ESP }}>{f.qtd}</b> · {brl(f.valor)}</span>
                  </div>
                ))}
              </div>
            </Secao>

            {/* Bloco C · ranking (só gestor) */}
            {data.gestor && data.ranking && (
              <Secao titulo="Ranking de vendedores" ajuda="projetos.desempenho.ranking">
                {/* celular (< md): um cartão por vendedor, sem rolagem lateral (HB0 · correção 9) */}
                <div className="md:hidden" data-testid="desempenho-ranking-cartoes" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {data.ranking.length === 0 ? <div style={{ padding: 12, color: MUT, textAlign: 'center', fontSize: 12.5 }}>Sem dados no período.</div> :
                    data.ranking.map((v, i) => (
                      <div key={v.responsavel_id ?? i} style={{ border: `0.5px solid ${LINE}`, borderRadius: 10, padding: 12 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                          <span style={{ color: ESP, fontWeight: 700, fontSize: 13.5, minWidth: 0, overflowWrap: 'anywhere' }}>{i + 1}. {v.responsavel_nome}</span>
                          <span style={{ color: corConversao(v.conversao_pct), fontWeight: 700, fontSize: 12.5, whiteSpace: 'nowrap' }}>{pct(v.conversao_pct)} · {rotConversao(v.conversao_pct)}</span>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px', marginTop: 8 }}>
                          <Par rot="Valor ganho" val={brl(v.ganhas_valor)} /><Par rot="Comissão" val={brl(v.comissao)} />
                          <Par rot="Ticket" val={brl(v.ticket)} /><Par rot="Oport. · Prop. · Ganhas" val={`${v.oportunidades} · ${v.propostas} · ${v.ganhas}`} />
                        </div>
                      </div>
                    ))}
                </div>
                <div className="hidden md:block" style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', minWidth: 640, borderCollapse: 'collapse', fontSize: 12.5 }}>
                    <thead><tr style={{ color: MUT, textAlign: 'right' }}>
                      <th style={{ position: 'sticky', left: 0, background: '#fff', zIndex: 1, textAlign: 'left', padding: '6px 8px' }}>Vendedor</th>
                      <th style={thR}>Oport.</th><th style={thR}>Propostas</th><th style={thR}>Ganhas</th><th style={thR}>Valor ganho</th><th style={thR}>Conversão</th><th style={thR}>Ticket</th><th style={thR}>Comissão</th>
                    </tr></thead>
                    <tbody>
                      {data.ranking.length === 0 ? <tr><td colSpan={8} style={{ padding: 12, color: MUT, textAlign: 'center' }}>Sem dados no período.</td></tr> :
                        data.ranking.map((v, i) => (
                          <tr key={v.responsavel_id ?? i} style={{ borderTop: `0.5px solid ${LINE}` }}>
                            <td style={{ position: 'sticky', left: 0, background: '#fff', zIndex: 1, padding: '7px 8px', color: ESP, fontWeight: 600, whiteSpace: 'nowrap' }}>{v.responsavel_nome}</td>
                            <td style={tdR}>{v.oportunidades}</td><td style={tdR}>{v.propostas}</td><td style={tdR}>{v.ganhas}</td>
                            <td style={tdR}>{brl(v.ganhas_valor)}</td>
                            <td style={{ ...tdR, color: corConversao(v.conversao_pct), fontWeight: 700 }}>{pct(v.conversao_pct)} {v.conversao_pct != null && <span style={{ fontWeight: 500, fontSize: 11 }}>{rotConversao(v.conversao_pct)}</span>}</td>
                            <td style={tdR}>{brl(v.ticket)}</td><td style={tdR}>{brl(v.comissao)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </Secao>
            )}

            {/* Bloco D · perdas por motivo */}
            <Secao titulo="Por que não fechou (perdas por motivo)" ajuda="projetos.desempenho.perdas">
              {data.perdas.length === 0 ? <div style={{ color: MUT, fontSize: 12.5 }}>Nenhuma perda registrada no período.</div> :
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {data.perdas.map((p) => (
                    <div key={p.motivo} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '6px 0', borderBottom: `0.5px solid ${BG}` }}>
                      <span style={{ color: ESP, textTransform: 'capitalize' }}>{p.motivo}</span>
                      <span style={{ color: MUT }}><b style={{ color: VERM }}>{brl(p.valor)}</b> · {p.qtd}</span>
                    </div>
                  ))}
                </div>}
            </Secao>
          </>
        )}
      </div>
    </div>
  )
}

function Card({ titulo, valor, cor, sub, ajuda }: { titulo: string; valor: string; cor: string; sub?: string; ajuda?: string }) {
  return (
    <div style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.5, color: MUT }}>{titulo}{ajuda && <AjudaCampo chave={ajuda} />}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: cor, marginTop: 2 }}>{valor}</div>
      {sub && <div style={{ fontSize: 11, color: MUT, marginTop: 2 }}>{sub}</div>}
    </div>
  )
}
function Par({ rot, val }: { rot: string; val: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.4, color: MUT }}>{rot}</div>
      <div style={{ fontSize: 13, color: ESP, fontWeight: 600, overflowWrap: 'anywhere' }}>{val}</div>
    </div>
  )
}
function Secao({ titulo, children, ajuda }: { titulo: string; children: React.ReactNode; ajuda?: string }) {
  return (
    <div style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 16, marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700, marginBottom: 10 }}>{titulo}{ajuda && <AjudaCampo chave={ajuda} />}</div>
      {children}
    </div>
  )
}
const inp: React.CSSProperties = { fontSize: 12.5, padding: '6px 9px', border: `1px solid ${LINE}`, borderRadius: 8, background: '#FFF', color: ESP }
const thR: React.CSSProperties = { textAlign: 'right', padding: '6px 8px', fontWeight: 600, whiteSpace: 'nowrap' }
const tdR: React.CSSProperties = { textAlign: 'right', padding: '7px 8px', color: ESP, whiteSpace: 'nowrap' }
