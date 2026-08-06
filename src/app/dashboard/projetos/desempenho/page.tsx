'use client'

// Hub · Desempenho Comercial por vendedor. Tudo vem de fn_crm_desempenho (RD-38: nada fixo). Gestor vê
// todos + ranking; vendedor vê só o seu (a RPC força o escopo por papel · Pilar 2). Blocos A-E do SPEC.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)', VERDE = '#16A34A', AMBAR = '#B45309', VERM = '#B91C1C', ROXO = '#8B5CF6'
const brl = (v: number) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const pct = (v: number | null) => (v == null ? '—' : `${v}%`)
const iso = (d: Date) => d.toISOString().slice(0, 10)

type Resumo = { oportunidades: number; valor_pipeline: number; propostas: number; ganhas_qtd: number; ganhas_valor: number; perdidas_qtd: number; perdidas_valor: number; ticket_medio: number; comissao: number; conversao_pct: number | null }
type FunilEtapa = { etapa: string; qtd: number; valor: number }
type RankRow = { responsavel_id: string | null; responsavel_nome: string; oportunidades: number; propostas: number; ganhas: number; ganhas_valor: number; ticket: number; comissao: number; conversao_pct: number | null }
type Perda = { motivo: string; qtd: number; valor: number }
type Resp = { gestor: boolean; de: string; ate: string; vendedor: string | null; resumo: Resumo; funil: FunilEtapa[]; ranking: RankRow[] | null; perdas: Perda[]; velocidade_dias: number | null; erro?: string }

const ETAPA_LABEL: Record<string, string> = { prospeccao: 'Prospecção', visita_feita: 'Visita', proposta_enviada: 'Proposta', negociacao: 'Negociação', ganho: 'Ganho', perdido: 'Perdido' }
const corConversao = (v: number | null) => (v == null ? MUT : v >= 40 ? VERDE : v >= 20 ? AMBAR : VERM)
const rotConversao = (v: number | null) => (v == null ? '—' : v >= 40 ? 'alta' : v >= 20 ? 'média' : 'baixa')

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

  const carregar = useCallback(async () => {
    if (!companyIds?.length) { setLoading(false); return }
    setLoading(true); setErro('')
    const { data: d, error } = await supabase.rpc('fn_crm_desempenho', {
      p_company_ids: companyIds, p_de: range.de, p_ate: range.ate, p_vendedor: null,
    })
    setLoading(false)
    if (error) { setErro(error.message); return }
    const r = d as Resp
    if (r?.erro) { setErro(r.erro === 'sem_acesso' ? 'Sem acesso.' : r.erro); return }
    setData(r)
  }, [companyIds, range])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])
  const setPreset = (p: string) => { setPeriodo(p); if (p !== 'custom') setRange(preset(p)) }

  const r = data?.resumo
  const maxFunil = useMemo(() => Math.max(1, ...(data?.funil ?? []).map((f) => f.qtd)), [data])

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
            <>
              <input type="date" value={range.de} onChange={(e) => setRange((x) => ({ ...x, de: e.target.value }))} style={inp} />
              <input type="date" value={range.ate} onChange={(e) => setRange((x) => ({ ...x, ate: e.target.value }))} style={inp} />
            </>
          )}
        </div>

        {erro && <div style={{ padding: '10px 14px', borderRadius: 8, background: '#FBEAEA', color: VERM, fontSize: 13, marginBottom: 12 }}>{erro}</div>}
        {loading ? <div style={{ padding: 40, textAlign: 'center', color: MUT }}>Carregando…</div> : !data ? (
          <div style={{ padding: 40, textAlign: 'center', color: MUT }}>Selecione uma empresa do Hub.</div>
        ) : (
          <>
            {/* Bloco A · cartões */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, marginBottom: 16 }}>
              <Card titulo="Conversão" valor={pct(r!.conversao_pct)} cor={corConversao(r!.conversao_pct)} sub={`🎯 ${rotConversao(r!.conversao_pct)}`} />
              <Card titulo="Ganhas" valor={String(r!.ganhas_qtd)} cor={VERDE} sub={brl(r!.ganhas_valor)} />
              <Card titulo="Perdidas" valor={String(r!.perdidas_qtd)} cor={VERM} sub={brl(r!.perdidas_valor)} />
              <Card titulo="Ticket médio" valor={brl(r!.ticket_medio)} cor={ESP} />
              <Card titulo="Comissão gerada" valor={brl(r!.comissao)} cor={GOLD} />
              <Card titulo="Pipeline aberto" valor={brl(r!.valor_pipeline)} cor={ROXO} sub={`${r!.oportunidades} oport. · ${r!.propostas} propostas`} />
              <Card titulo="Velocidade" valor={data.velocidade_dias != null ? `${data.velocidade_dias} d` : '—'} cor={ESP} sub="média até fechar" />
            </div>

            {/* Bloco B · funil */}
            <Secao titulo="Funil por fase">
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
              <Secao titulo="Ranking de vendedores">
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                    <thead><tr style={{ color: MUT, textAlign: 'right' }}>
                      <th style={{ textAlign: 'left', padding: '6px 8px' }}>Vendedor</th>
                      <th style={thR}>Oport.</th><th style={thR}>Propostas</th><th style={thR}>Ganhas</th><th style={thR}>Valor ganho</th><th style={thR}>Conversão</th><th style={thR}>Ticket</th><th style={thR}>Comissão</th>
                    </tr></thead>
                    <tbody>
                      {data.ranking.length === 0 ? <tr><td colSpan={8} style={{ padding: 12, color: MUT, textAlign: 'center' }}>Sem dados no período.</td></tr> :
                        data.ranking.map((v, i) => (
                          <tr key={v.responsavel_id ?? i} style={{ borderTop: `0.5px solid ${LINE}` }}>
                            <td style={{ padding: '7px 8px', color: ESP, fontWeight: 600 }}>{v.responsavel_nome}</td>
                            <td style={tdR}>{v.oportunidades}</td><td style={tdR}>{v.propostas}</td><td style={tdR}>{v.ganhas}</td>
                            <td style={tdR}>{brl(v.ganhas_valor)}</td>
                            <td style={{ ...tdR, color: corConversao(v.conversao_pct), fontWeight: 700 }}>{pct(v.conversao_pct)} {v.conversao_pct != null && (v.conversao_pct >= 40 ? '🟢' : v.conversao_pct >= 20 ? '🟡' : '🔴')}</td>
                            <td style={tdR}>{brl(v.ticket)}</td><td style={tdR}>{brl(v.comissao)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </Secao>
            )}

            {/* Bloco D · perdas por motivo */}
            <Secao titulo="Por que não fechou (perdas por motivo)">
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

function Card({ titulo, valor, cor, sub }: { titulo: string; valor: string; cor: string; sub?: string }) {
  return (
    <div style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 14 }}>
      <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.5, color: MUT }}>{titulo}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: cor, marginTop: 2 }}>{valor}</div>
      {sub && <div style={{ fontSize: 11, color: MUT, marginTop: 2 }}>{sub}</div>}
    </div>
  )
}
function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 16, marginBottom: 14 }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700, marginBottom: 10 }}>{titulo}</div>
      {children}
    </div>
  )
}
const inp: React.CSSProperties = { fontSize: 12.5, padding: '6px 9px', border: `1px solid ${LINE}`, borderRadius: 8, background: '#FFF', color: ESP }
const thR: React.CSSProperties = { textAlign: 'right', padding: '6px 8px', fontWeight: 600, whiteSpace: 'nowrap' }
const tdR: React.CSSProperties = { textAlign: 'right', padding: '7px 8px', color: ESP, whiteSpace: 'nowrap' }
