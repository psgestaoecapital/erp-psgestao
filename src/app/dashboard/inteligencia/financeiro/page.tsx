'use client'
// Indústria › Inteligência › BI Financeiro da Diretoria (Spec BIs da Indústria, 25/11/2026).
// VISÃO GERENCIAL dos títulos a receber e a pagar do ERP de origem — NÃO é o DRE contábil (o oficial é o da Gestão
// Empresarial). A tela lê só a porta fn_bi_financeiro_painel (tradutor por ERP e classificação ficam no banco).
// Regime: emissão (competência) × caixa, as duas visões no gráfico mensal. Impostos = classificação parametrizável,
// em PROPOSTA até o contador validar. Restrito à direção (a porta decide). Celular e notebook.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { Lock, Info } from 'lucide-react'
import { brlc, fraseResumo, leituras, mesRot, pct, situacaoInadimplencia, situacaoMargem, varp, type PainelFin } from './leitura'

const C = { esp: '#3D2314', off: '#FAF7F2', gold: '#C8941A', gold2: '#E0B048', bd: '#E7DED3', m: '#6B5D4F', ok: '#1a8f63', warn: '#b07a12', bad: '#C0392B', bg2: '#F0ECE3', azul: '#2f6f8f', verde: '#3f7d4e' }
const ROTA = '/dashboard/inteligencia/financeiro'
const SIT: Record<string, string> = { ok: C.ok, atencao: C.warn, ruim: C.bad }

const nf = (o: Intl.NumberFormatOptions) => new Intl.NumberFormat('pt-BR', o)
const brl = (v: number | null | undefined) => v == null ? '—' : nf({ style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v)
const int = (v: number | null | undefined) => v == null ? '—' : nf({ maximumFractionDigits: 0 }).format(v)
const iso = (d: Date) => d.toISOString().slice(0, 10)
const dataBR = (s: string) => { const [a, m, d] = String(s).slice(0, 10).split('-'); return `${d}/${m}/${a}` }
const cap = (s: string) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase())
const dataHora = (s: string | null) => { if (!s) return '—'; const d = new Date(s); return isNaN(d.getTime()) ? '—' : `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` }

const PERIODOS = [
  { k: 'ano', rot: 'Ano atual' }, { k: 'mes', rot: 'Mês atual' }, { k: 'mes_ant', rot: 'Mês anterior' }, { k: '90', rot: '90 dias' }, { k: '365', rot: '12 meses' },
] as const
const REGIMES = [{ k: 'competencia', rot: 'Por emissão' }, { k: 'caixa', rot: 'Por caixa' }] as const

function intervalo(k: string): { de: string; ate: string } {
  const h = new Date(); const ate = iso(h)
  if (k === 'mes') return { de: iso(new Date(h.getFullYear(), h.getMonth(), 1)), ate }
  if (k === 'mes_ant') return { de: iso(new Date(h.getFullYear(), h.getMonth() - 1, 1)), ate: iso(new Date(h.getFullYear(), h.getMonth(), 0)) }
  if (k === '90' || k === '365') { const d = new Date(h); d.setDate(d.getDate() - (Number(k) - 1)); return { de: iso(d), ate } }
  return { de: iso(new Date(h.getFullYear(), 0, 1)), ate }
}

const card: CSSProperties = { background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 14, padding: 16, minWidth: 0, display: 'grid', gap: 10, alignContent: 'start' }
const th: CSSProperties = { position: 'sticky', top: 0, background: '#fff', textAlign: 'right', fontWeight: 600, color: C.m, padding: '8px 10px', borderBottom: `1px solid ${C.bd}`, whiteSpace: 'nowrap', fontSize: 12 }
const td: CSSProperties = { textAlign: 'right', padding: '7px 10px', borderBottom: `1px solid ${C.bg2}`, whiteSpace: 'nowrap', fontSize: 13, fontVariantNumeric: 'tabular-nums' }
const tdL: CSSProperties = { ...td, textAlign: 'left', whiteSpace: 'normal', maxWidth: 280 }
const grade = (min: number): CSSProperties => ({ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${min}px), 1fr))`, gap: 12, alignItems: 'start' })
const pill = (on: boolean): CSSProperties => ({ font: 'inherit', fontSize: 13, padding: '7px 12px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${on ? C.esp : C.bd}`, background: on ? C.esp : '#fff', color: on ? '#fff' : C.esp })

function Titulo({ t, nota, ajuda }: { t: string; nota?: ReactNode; ajuda: string }) {
  return (
    <div>
      <div style={{ fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>{t}<AjudaCampo chave={ajuda} rota={ROTA} /></div>
      {nota && <div style={{ fontSize: 12, color: C.m }}>{nota}</div>}
    </div>
  )
}
function Vazio({ texto }: { texto: string }) {
  return <div style={{ fontSize: 13, color: C.m }}>{texto}</div>
}
function BarrasH({ dados, cor, fmt }: { dados: { rot: string; v: number; sub?: string }[]; cor: string; fmt: (v: number) => string }) {
  const max = Math.max(1e-9, ...dados.map((d) => Math.abs(d.v)))
  if (!dados.length) return <Vazio texto="Sem movimento no período." />
  return (
    <div style={{ display: 'grid', gap: 7 }}>
      {dados.map((d, i) => (
        <div key={d.rot + i} title={d.sub ?? d.rot} style={{ display: 'grid', gridTemplateColumns: 'minmax(110px, 40%) 1fr auto', gap: 8, alignItems: 'center', fontSize: 12 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.rot}</span>
          <span style={{ position: 'relative', height: 14, background: C.bg2, borderRadius: 4 }}>
            <b style={{ position: 'absolute', inset: '0 auto 0 0', width: `${Math.max(1, 100 * Math.abs(d.v) / max)}%`, background: cor, borderRadius: 4 }} />
          </span>
          <span style={{ fontVariantNumeric: 'tabular-nums', color: C.m, minWidth: 76, textAlign: 'right' }}>{fmt(d.v)}</span>
        </div>
      ))}
    </div>
  )
}
// Receita × despesa por mês (barras lado a lado) com o resultado escrito embaixo de cada mês.
function MesesChart({ meses, regime, onPick }: { meses: PainelFin['meses']; regime: string; onPick: (t: string) => void }) {
  const cx = regime === 'caixa'
  const rows = meses.map((m) => ({ mes: m.mes, r: cx ? m.receita_caixa : m.receita_emissao, d: cx ? m.despesa_caixa : m.despesa_emissao, res: cx ? m.resultado_caixa : m.resultado_emissao, m }))
  const max = Math.max(1, ...rows.flatMap((x) => [x.r, x.d]))
  if (!rows.length) return <Vazio texto="Sem meses no período." />
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, overflowX: 'auto', paddingTop: 8 }}>
      {rows.map((x) => (
        <button key={x.mes} type="button" onClick={() => onPick(`${mesRot(x.mes)} · emissão: receita ${brlc(x.m.receita_emissao)}, despesa ${brlc(x.m.despesa_emissao)}, resultado ${brlc(x.m.resultado_emissao)} · caixa: recebido ${brlc(x.m.receita_caixa)}, pago ${brlc(x.m.despesa_caixa)}, resultado ${brlc(x.m.resultado_caixa)}`)}
          style={{ flex: '1 0 44px', display: 'grid', justifyItems: 'center', gap: 4, background: 'none', border: 0, padding: 0, cursor: 'pointer', font: 'inherit', color: C.m, fontSize: 10 }}>
          <span style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 150 }}>
            <i style={{ display: 'block', width: 14, height: Math.max(2, 150 * x.r / max), background: C.verde, borderRadius: '4px 4px 0 0' }} />
            <i style={{ display: 'block', width: 14, height: Math.max(2, 150 * x.d / max), background: C.gold2, borderRadius: '4px 4px 0 0' }} />
          </span>
          <span>{mesRot(x.mes)}</span>
          <span style={{ color: x.res >= 0 ? C.ok : C.bad, fontWeight: 600 }}>{brlc(x.res)}</span>
        </button>
      ))}
    </div>
  )
}

export default function BiFinanceiro() {
  const { companyIds, selInfo } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : null
  const [per, setPer] = useState<string>('ano')
  const [regime, setRegime] = useState<'competencia' | 'caixa'>('competencia')
  const [p, setP] = useState<PainelFin | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [dica, setDica] = useState<string | null>(null)
  const iv = useMemo(() => intervalo(per), [per])

  // Só a última requisição vale; AbortError do refresh de sessão re-tenta (mesmo padrão do BI da Planta).
  const seq = useRef(0)
  const carregar = useCallback(async () => {
    if (!empresa) return
    const minha = ++seq.current
    setCarregando(true); setErro(null)
    const args = { p_company_id: empresa, p_dt_ini: iv.de, p_dt_fim: iv.ate, p_regime: regime }
    const abortou = (e: unknown) => { const m = e as { name?: string; message?: string } | null; return m?.name === 'AbortError' || /AbortError|Lock broken/i.test(m?.message ?? '') }
    let res: { data: unknown; error: { message: string; name?: string } | null } | null = null
    for (let t = 0; t < 3; t++) {
      try { res = await supabase.rpc('fn_bi_financeiro_painel', args) } catch (e) { if (!abortou(e)) { res = { data: null, error: { message: e instanceof Error ? e.message : 'Falha ao carregar' } }; break }; res = null }
      if (res && !(res.error && abortou(res.error))) break
      await new Promise((ok) => setTimeout(ok, 400 * (t + 1)))
    }
    if (minha !== seq.current) return
    setCarregando(false)
    if (!res || (res.error && abortou(res.error))) return
    if (res.error) { setErro('Não foi possível carregar o painel. Tente novamente.'); setP(null); return }
    setP(res.data as PainelFin)
  }, [empresa, iv, regime])
  useEffect(() => { void carregar() }, [carregar])

  const ok = p?.ok ? p : null
  const r = ok?.resumo, a = ok?.anterior, ab = ok?.aberto
  const ls = useMemo(() => ok ? leituras(ok) : [], [ok])
  const sMargem = situacaoMargem(r?.margem_pct), sInad = situacaoInadimplencia(ab?.inadimplencia_pct)
  const vReceita = a && r && a.receita > 0.5 * r.receita ? varp(r.receita, a.receita) : null
  const vDespesa = a && r && a.despesa > 0.5 * r.despesa ? varp(r.despesa, a.despesa) : null
  const semMov = ok && r && r.titulos_receber === 0 && r.titulos_pagar === 0

  const kpi = (rot: string, chave: string, valor: string, sub: ReactNode, cor?: string) => (
    <div style={{ ...card, gap: 2 }}>
      <div style={{ fontSize: 12, color: C.m, display: 'flex', alignItems: 'center', gap: 4 }}>{rot}<AjudaCampo chave={chave} rota={ROTA} /></div>
      <div style={{ fontFamily: 'Georgia, serif', fontSize: 'clamp(22px, 2.4vw, 30px)', lineHeight: 1.15, color: cor ?? C.esp, fontVariantNumeric: 'tabular-nums' }}>{valor}</div>
      <div style={{ fontSize: 12, color: C.m }}>{sub}</div>
    </div>
  )

  return (
    <div style={{ background: C.off, minHeight: '100%', color: C.esp, padding: 'clamp(12px, 2.5vw, 28px)' }}>
      <div style={{ maxWidth: 1400, margin: '0 auto', display: 'grid', gap: 18 }}>
        <header style={{ display: 'grid', gap: 6 }}>
          <div style={{ fontSize: 12, color: C.m }}>Indústria · Inteligência · Financeiro</div>
          <h1 style={{ margin: 0, fontSize: 'clamp(24px, 3.4vw, 34px)', fontFamily: 'Georgia, serif', fontWeight: 400 }}>BI Financeiro da Diretoria</h1>
          {ok && r && <p style={{ margin: 0, fontSize: 15, color: C.m, maxWidth: '86ch' }}>{fraseResumo(ok)}</p>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', fontSize: 12, color: C.m }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: C.bg2, borderRadius: 999, padding: '3px 10px', color: C.esp }}>
              <Info size={13} strokeWidth={1.5} /> Visão gerencial dos títulos — não é o DRE contábil (o oficial é o da Gestão Empresarial)
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Lock size={13} strokeWidth={1.5} /> Restrito à direção</span>
          </div>
        </header>

        <div style={{ ...card, display: 'flex', flexWrap: 'wrap', gap: '10px 22px', alignItems: 'end' }}>
          <div style={{ display: 'grid', gap: 2 }}>
            <span style={{ fontSize: 12, color: C.m, display: 'flex', alignItems: 'center', gap: 4 }}>Visão<AjudaCampo chave="fin.bi.regime" rota={ROTA} /></span>
            <div role="group" aria-label="Visão" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {REGIMES.map((x) => <button key={x.k} type="button" onClick={() => setRegime(x.k)} aria-pressed={regime === x.k} style={pill(regime === x.k)}>{x.rot}</button>)}
            </div>
          </div>
          <div style={{ display: 'grid', gap: 2 }}>
            <span style={{ fontSize: 12, color: C.m, display: 'flex', alignItems: 'center', gap: 4 }}>Período<AjudaCampo chave="fin.bi.periodo" rota={ROTA} /></span>
            <div role="group" aria-label="Período" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {PERIODOS.map((x) => <button key={x.k} type="button" onClick={() => setPer(x.k)} aria-pressed={per === x.k} style={pill(per === x.k)}>{x.rot}</button>)}
            </div>
          </div>
          <span style={{ fontSize: 12, color: C.m }}>{dataBR(iv.de)} a {dataBR(iv.ate)}{carregando && ' · atualizando…'}</span>
        </div>

        {!empresa && <div style={card}>Escolha uma empresa no topo para ver o painel.</div>}
        {erro && <div role="alert" style={{ ...card, borderColor: C.bad, color: C.bad }}>{erro}</div>}
        {p && !p.ok && <div style={{ ...card, borderLeft: `5px solid ${C.warn}` }}>{p.mensagem}</div>}
        {carregando && !p && <div style={card}>Carregando…</div>}
        {semMov && (
          <div style={{ ...card, borderLeft: `5px solid ${C.warn}` }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Sem títulos neste período</div>
            <div style={{ fontSize: 14, color: C.m }}>O ERP de origem não tem títulos emitidos ou baixados entre {dataBR(iv.de)} e {dataBR(iv.ate)}. O aberto e o fluxo abaixo continuam valendo para hoje.</div>
            <div><button type="button" onClick={() => setPer('365')} style={pill(true)}>Ver 12 meses</button></div>
          </div>
        )}

        {ok && r && a && ab && (
          <>
            <section style={grade(180)} aria-label="Indicadores">
              {kpi('Receita', 'fin.bi.receita', brlc(r.receita), <>{int(r.titulos_receber)} títulos{vReceita != null && <> · {vReceita >= 0 ? '+' : ''}{pct(vReceita)} sobre o anterior</>}</>)}
              {kpi('Despesa', 'fin.bi.despesa', brlc(r.despesa), <>{int(r.titulos_pagar)} títulos{vDespesa != null && <> · {vDespesa >= 0 ? '+' : ''}{pct(vDespesa)} sobre o anterior</>}</>)}
              {kpi('Resultado gerencial', 'fin.bi.resultado', brlc(r.resultado), <>margem {pct(r.margem_pct)} · {sMargem === 'ok' ? 'saudável' : sMargem === 'atencao' ? 'apertada' : sMargem === 'ruim' ? 'negativa' : '—'}</>, sMargem ? SIT[sMargem] : undefined)}
              {kpi('Impostos (nos títulos)', 'fin.bi.impostos', brlc(r.impostos), <>{pct(ok.impostos.pct_despesa, 2)} da despesa · regra {ok.impostos.status === 'validada' ? 'validada' : 'em proposta'}</>)}
              {kpi('A receber em aberto', 'fin.bi.receber_aberto', brlc(ab.receber.saldo), <>vencido {brlc(ab.receber.vencido)} · {int(ab.receber.titulos)} títulos</>)}
              {kpi('A pagar em aberto', 'fin.bi.pagar_aberto', brlc(ab.pagar.saldo), <>vencido {brlc(ab.pagar.vencido)} · {int(ab.pagar.titulos)} títulos</>)}
              {kpi('Inadimplência', 'fin.bi.inadimplencia', pct(ab.inadimplencia_pct), <>{pct(ab.inadimplencia_30_pct)} há mais de 30 dias · {int(ab.receber.clientes_vencidos)} clientes</>, sInad ? SIT[sInad] : undefined)}
            </section>

            {ls.length > 0 && (
              <section style={{ ...card, borderLeft: `5px solid ${C.gold}` }} aria-label="Leituras para a decisão">
                <Titulo t="Leituras para a decisão" ajuda="fin.bi.leitura" />
                <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6, fontSize: 14 }}>{ls.map((t, i) => <li key={i}>{t}</li>)}</ul>
              </section>
            )}

            <section style={card} aria-label="Receita e despesa por mês">
              <Titulo t="Receita × despesa por mês" ajuda="fin.bi.meses"
                nota={<>Verde = {regime === 'caixa' ? 'recebido' : 'receita emitida'} · dourado = {regime === 'caixa' ? 'pago' : 'despesa emitida'} · número = resultado. Toque num mês para ver as duas visões.</>} />
              <MesesChart meses={ok.meses} regime={regime} onPick={setDica} />
              {dica && <div role="status" style={{ fontSize: 12, color: C.esp, background: C.bg2, borderRadius: 8, padding: '6px 10px' }}>{dica}</div>}
              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                  <thead><tr><th style={{ ...th, textAlign: 'left' }}>Mês</th><th style={th}>Receita (emissão)</th><th style={th}>Despesa (emissão)</th><th style={th}>Resultado (emissão)</th><th style={th}>Recebido</th><th style={th}>Pago</th><th style={th}>Resultado (caixa)</th></tr></thead>
                  <tbody>
                    {ok.meses.map((m) => (
                      <tr key={m.mes}>
                        <td style={{ ...td, textAlign: 'left' }}>{mesRot(m.mes)}</td>
                        <td style={td}>{brl(m.receita_emissao)}</td><td style={td}>{brl(m.despesa_emissao)}</td>
                        <td style={{ ...td, color: m.resultado_emissao >= 0 ? C.ok : C.bad, fontWeight: regime === 'competencia' ? 700 : 400 }}>{brl(m.resultado_emissao)}</td>
                        <td style={td}>{brl(m.receita_caixa)}</td><td style={td}>{brl(m.despesa_caixa)}</td>
                        <td style={{ ...td, color: m.resultado_caixa >= 0 ? C.ok : C.bad, fontWeight: regime === 'caixa' ? 700 : 400 }}>{brl(m.resultado_caixa)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section style={grade(420)} aria-label="Em aberto">
              <div style={card}>
                <Titulo t="Aging do aberto (hoje)" ajuda="fin.bi.aging" nota={`Posição em ${dataBR(ab.data_base)}, contada do vencimento.`} />
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                    <thead><tr><th style={{ ...th, textAlign: 'left' }}>Faixa</th><th style={th}>A receber</th><th style={th}>Títulos</th><th style={th}>A pagar</th><th style={th}>Títulos</th></tr></thead>
                    <tbody>
                      {ok.aging.map((f) => (
                        <tr key={f.ordem}>
                          <td style={{ ...td, textAlign: 'left', color: f.ordem >= 3 ? C.bad : f.ordem === 2 ? C.warn : C.esp }}>{f.faixa}</td>
                          <td style={td}>{brl(f.receber)}</td><td style={td}>{int(f.receber_n)}</td><td style={td}>{brl(f.pagar)}</td><td style={td}>{int(f.pagar_n)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {(ab.adiantamentos.clientes !== 0 || ab.adiantamentos.fornecedores !== 0) && (
                  <div style={{ fontSize: 12, color: C.m }}>Fora do aberto: adiantamentos de clientes {brlc(ab.adiantamentos.clientes)} e a fornecedores {brlc(ab.adiantamentos.fornecedores)}.</div>
                )}
              </div>
              <div style={card}>
                <Titulo t="Maiores devedores (vencido)" ajuda="fin.bi.devedores" />
                {ok.devedores.length === 0 ? <Vazio texto="Nenhum título a receber vencido." /> : (
                  <div style={{ overflowX: 'auto', maxHeight: 360 }}>
                    <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                      <thead><tr><th style={{ ...th, textAlign: 'left' }}>Cliente</th><th style={th}>Vencido</th><th style={th}>Títulos</th><th style={th}>Maior atraso</th></tr></thead>
                      <tbody>{ok.devedores.map((d, i) => <tr key={i}><td style={tdL}>{cap(d.cliente)}</td><td style={td}>{brl(d.vencido)}</td><td style={td}>{int(d.titulos)}</td><td style={{ ...td, color: d.maior_atraso > 90 ? C.bad : C.esp }}>{int(d.maior_atraso)} dias</td></tr>)}</tbody>
                    </table>
                  </div>
                )}
              </div>
            </section>

            <section style={card} aria-label="Fluxo projetado">
              <Titulo t="Fluxo projetado pelos vencimentos" ajuda="fin.bi.fluxo"
                nota={<>Títulos em aberto por semana de vencimento. Vencidos à parte: entram {brlc(ok.fluxo.vencidos.entradas)}, saem {brlc(ok.fluxo.vencidos.saidas)}. Não inclui saldo bancário.</>} />
              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                  <thead><tr><th style={{ ...th, textAlign: 'left' }}>Semana de</th><th style={th}>Entradas</th><th style={th}>Saídas</th><th style={th}>Líquido</th><th style={th}>Acumulado</th></tr></thead>
                  <tbody>
                    {ok.fluxo.semanas.map((w) => (
                      <tr key={w.semana}>
                        <td style={{ ...td, textAlign: 'left' }}>{dataBR(w.semana)}</td><td style={td}>{brl(w.entradas)}</td><td style={td}>{brl(w.saidas)}</td>
                        <td style={{ ...td, color: w.liquido >= 0 ? C.ok : C.bad }}>{brl(w.liquido)}</td><td style={{ ...td, fontWeight: 600 }}>{brl(w.acumulado)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {(ok.fluxo.depois.entradas !== 0 || ok.fluxo.depois.saidas !== 0) && <div style={{ fontSize: 12, color: C.m }}>Depois de 13 semanas: entram {brlc(ok.fluxo.depois.entradas)}, saem {brlc(ok.fluxo.depois.saidas)}.</div>}
            </section>

            <section style={grade(420)} aria-label="Despesa">
              <div style={card}>
                <Titulo t="Despesa por natureza" ajuda="fin.bi.natureza" nota="Pela classificação do documento do título (editável, em proposta)." />
                <BarrasH cor={C.gold} fmt={(v) => brlc(v)} dados={ok.despesa_natureza.map((x) => ({ rot: x.natureza, v: x.valor, sub: `${x.natureza}: ${brl(x.valor)} · ${pct(x.pct)} · ${int(x.titulos)} títulos` }))} />
              </div>
              <div style={card}>
                <Titulo t="Despesa por forma de pagamento" ajuda="fin.bi.forma" />
                <BarrasH cor={C.azul} fmt={(v) => brlc(v)} dados={ok.despesa_forma.map((x) => ({ rot: x.forma, v: x.valor, sub: `${x.forma}: ${brl(x.valor)} · ${pct(x.pct)}` }))} />
              </div>
            </section>

            <section style={card} aria-label="Impostos">
              <Titulo t="Impostos destacados" ajuda="fin.bi.impostos"
                nota={<>Subconjunto da despesa, pela classificação dos títulos a pagar. {ok.impostos.status !== 'validada' && <b style={{ color: C.warn }}>Regra em proposta: aguarda validação do contador.</b>}</>} />
              <div style={grade(300)}>
                <div style={{ display: 'grid', gap: 6 }}>
                  <div style={{ fontFamily: 'Georgia, serif', fontSize: 26 }}>{brl(ok.impostos.total)} <span style={{ fontSize: 13, color: C.m }}>({pct(ok.impostos.pct_despesa, 2)} da despesa)</span></div>
                  <BarrasH cor={C.bad} fmt={(v) => brl(v)} dados={ok.impostos.por_tipo.map((x) => ({ rot: x.tipo, v: x.valor }))} />
                  {ok.impostos.credores.length > 0 && <div style={{ fontSize: 12, color: C.m }}>Credores: {ok.impostos.credores.map((x) => `${cap(x.credor)} (${brl(x.valor)})`).join(' · ')}</div>}
                </div>
                <div style={{ fontSize: 12, color: C.m, display: 'grid', gap: 4 }}>
                  <b style={{ color: C.esp }}>Regras usadas</b>
                  {ok.impostos.regras.map((x, i) => <span key={i}>{x.tipo}: {x.campo === 'documento' ? 'documento' : 'credor'} = <code>{x.padrao}</code> ({x.status}{x.de === 'empresa' ? ', da empresa' : ''})</span>)}
                  <span>Tributos pagos fora dos títulos a pagar (ICMS, PIS/COFINS, folha) não aparecem aqui.</span>
                </div>
              </div>
            </section>

            <section style={grade(460)} aria-label="Rankings">
              <div style={card}>
                <Titulo t="Receita por cliente (15 maiores)" ajuda="fin.bi.clientes" nota={`Os 10 maiores somam ${pct(ok.concentracao.top10_clientes_pct)} da receita.`} />
                <div style={{ overflowX: 'auto', maxHeight: 420 }}>
                  <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                    <thead><tr><th style={{ ...th, textAlign: 'left' }}>Cliente</th><th style={th}>Receita</th><th style={th}>%</th><th style={th}>Títulos</th></tr></thead>
                    <tbody>{ok.receita_cliente.map((x, i) => <tr key={i}><td style={tdL}>{cap(x.cliente)}</td><td style={td}>{brl(x.valor)}</td><td style={td}>{pct(x.pct)}</td><td style={td}>{int(x.titulos)}</td></tr>)}</tbody>
                  </table>
                </div>
              </div>
              <div style={card}>
                <Titulo t="Despesa por fornecedor (15 maiores)" ajuda="fin.bi.fornecedores" nota={`Os 10 maiores somam ${pct(ok.concentracao.top10_fornecedores_pct)} da despesa.`} />
                <div style={{ overflowX: 'auto', maxHeight: 420 }}>
                  <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                    <thead><tr><th style={{ ...th, textAlign: 'left' }}>Fornecedor</th><th style={{ ...th, textAlign: 'left' }}>Natureza</th><th style={th}>Despesa</th><th style={th}>%</th></tr></thead>
                    <tbody>{ok.despesa_fornecedor.map((x, i) => <tr key={i}><td style={tdL}>{cap(x.fornecedor)}</td><td style={{ ...tdL, color: C.m, fontSize: 12 }}>{x.natureza}</td><td style={td}>{brl(x.valor)}</td><td style={td}>{pct(x.pct)}</td></tr>)}</tbody>
                  </table>
                </div>
              </div>
              <div style={card}>
                <Titulo t="Receita por grupo econômico" ajuda="fin.bi.grupos" />
                {ok.receita_grupo.length === 0
                  ? <Vazio texto={`Nenhum cliente com grupo econômico cadastrado no ERP de origem (${pct(ok.concentracao.receita_com_grupo_pct)} da receita). Cadastre os grupos no ERP para ver este quadro.`} />
                  : <BarrasH cor={C.verde} fmt={(v) => brlc(v)} dados={ok.receita_grupo.map((x) => ({ rot: x.grupo, v: x.valor, sub: `${x.grupo}: ${brl(x.valor)} · ${int(x.clientes)} clientes · ${pct(x.pct)}` }))} />}
              </div>
            </section>

            <footer style={{ ...card, fontSize: 12, color: C.m, gap: 4 }}>
              <Titulo t="Origem e frescor do dado" ajuda="fin.bi.qualidade" />
              <span>Títulos a receber e a pagar importados do ERP de origem · última importação {dataHora(ok.qualidade.ultima_importacao)} · {int(ok.qualidade.titulos)} títulos desde {ok.qualidade.primeira_emissao ? dataBR(ok.qualidade.primeira_emissao) : '—'}.</span>
              <span>Fora do resultado: {int(ok.qualidade.cancelados)} títulos cancelados ({brlc(ok.qualidade.cancelados_valor)}) e adiantamentos do período (clientes {brlc(ok.fora_resultado.adiant_clientes)}, fornecedores {brlc(ok.fora_resultado.adiant_fornecedores)}).</span>
              <span>{ok.aviso}</span>
            </footer>
          </>
        )}
      </div>
    </div>
  )
}
