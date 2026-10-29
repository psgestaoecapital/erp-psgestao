'use client'
// Comercial › Meu painel de vendas (CEO 29/10/2026, com a diretoria comercial da Frioeste).
// BI em cascata e GENÉRICO: lê só a fn_bi_comercial_painel, que trava o escopo no banco pelo vínculo do usuário com o
// código de vendedor do ERP de origem (ATAK hoje; outro ERP = outro tradutor, a tela não muda).
// Vendedor vê só a própria venda; supervisor a equipe dele; diretoria a empresa toda. Mesmo conteúdo do BI apresentado
// (CEO 10:34): leituras, vendas por dia, mix, ranking da equipe, desconto e preço por vendedor, produtos, clientes,
// cidades e logística. Celular e notebook.
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { Lock, ChevronRight } from 'lucide-react'

const C = { esp: '#3D2314', off: '#FAF7F2', gold: '#C8941A', gold2: '#E0B048', bd: '#E7DED3', m: '#6B5D4F', d: '#9C8E80', ok: '#1a8f63', warn: '#b07a12', bad: '#C0392B', bg2: '#F0ECE3', azul: '#2f6f8f', verde: '#3f7d4e' }
const ROTA = '/dashboard/comercial/meu-painel'

type No = { no: string; nome: string; cargo: string; pai: string | null; ordem: string }
type Equipe = { ven: string; nome: string; val: number; kg: number; preco_kg: number | null; desc_pct: number | null; pct_abaixo: number | null; clientes: number; notas: number; ticket: number | null }
type Painel = {
  ok: boolean; erro?: string; mensagem?: string
  periodo: { de: string; ate: string }
  escopo: { raiz: string; no: string; restrito: boolean }
  nos: No[]
  resumo: { val: number; kg: number; preco_kg: number | null; desc_pct: number | null; desconto: number; pct_abaixo: number | null; clientes: number; notas: number; ticket: number | null; produtos: number; vendedores: number }
  conc_top10: number | null
  referencia: { desc_pct: number | null; pct_abaixo: number | null; preco_kg: number | null }
  posicao: { lugar: number; de: number } | null
  dia: { dia: string; val: number; kg: number; notas: number }[]
  divisoes?: { linha: string; val: number; kg: number }[]
  clientes: { cod: string; cliente: string; cidade: string; val: number; kg: number; notas: number; preco_kg: number | null }[]
  cidades?: { cidade: string; val: number; kg: number; clientes: number }[]
  produtos: { cod: string; produto: string; val: number; kg: number; preco_kg: number | null; desc_pct?: number | null; pct_abaixo: number; clientes?: number }[]
  cede_mais: string[]
  equipe: Equipe[]
  logistica?: { cargas: number; kg_carga: number | null; clientes_carga: number | null; notas_sem_carga: number; kg_sem_carga: number }
  cargas?: { carga: string; dia: string; transportador: string; notas: number; clientes: number; cidades: number; kg: number; val: number }[]
}

const nf = (o: Intl.NumberFormatOptions) => new Intl.NumberFormat('pt-BR', o)
const brl = (v: number | null | undefined) => v == null ? '—' : nf({ style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v)
const brl2 = (v: number | null | undefined) => v == null ? '—' : nf({ style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)
const brlc = (v: number | null | undefined) => v == null ? '—' : Math.abs(v) >= 10000 ? 'R$ ' + nf({ notation: 'compact', maximumFractionDigits: 1 }).format(v) : brl(v)
const pct = (v: number | null | undefined, d = 1) => v == null ? '—' : nf({ minimumFractionDigits: d, maximumFractionDigits: d }).format(v) + '%'
const ton = (kg: number | null | undefined) => kg == null ? '—' : nf({ maximumFractionDigits: 1 }).format(kg / 1000) + ' t'
const int = (v: number | null | undefined) => v == null ? '—' : nf({ maximumFractionDigits: 0 }).format(v)
const dataBR = (s: string) => { const [a, m, d] = String(s).slice(0, 10).split('-'); return `${d}/${m}/${a}` }
const iso = (d: Date) => d.toISOString().slice(0, 10)
const cap = (s: string) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase())

const PERIODOS = [{ k: '7', rot: '7 dias' }, { k: '30', rot: '30 dias' }, { k: 'mes', rot: 'Este mês' }, { k: '90', rot: '90 dias' }] as const

const card: CSSProperties = { background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 14, padding: 16, minWidth: 0, display: 'grid', gap: 8, alignContent: 'start' }
const th: CSSProperties = { position: 'sticky', top: 0, background: '#fff', textAlign: 'right', fontWeight: 600, color: C.m, padding: '8px 10px', borderBottom: `1px solid ${C.bd}`, whiteSpace: 'nowrap', fontSize: 12 }
const td: CSSProperties = { textAlign: 'right', padding: '8px 10px', borderBottom: `1px solid ${C.bg2}`, whiteSpace: 'nowrap', fontSize: 13, fontVariantNumeric: 'tabular-nums' }

function Titulo({ t, nota, ajuda }: { t: string; nota?: string; ajuda?: string }) {
  return (
    <div>
      <div style={{ fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>{t}{ajuda && <AjudaCampo chave={ajuda} rota={ROTA} />}</div>
      {nota && <div style={{ fontSize: 12, color: C.m }}>{nota}</div>}
    </div>
  )
}
function Chip({ v, a, b, d = 1 }: { v: number | null | undefined; a: number; b: number; d?: number }) {
  const n = v ?? 0
  const cor = n >= b ? C.bad : n >= a ? C.warn : C.ok
  return <span style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 999, border: `1px solid ${cor}`, color: cor, fontSize: 12 }}>{pct(v, d)}</span>
}
function BarraCelula({ v, max, txt, cor }: { v: number; max: number; txt: string; cor: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(48px, 1fr) auto', gap: 8, alignItems: 'center' }}>
      <i style={{ display: 'block', height: 8, borderRadius: 4, background: C.bg2 }}><b style={{ display: 'block', height: '100%', borderRadius: 4, width: `${max > 0 ? Math.max(2, 100 * v / max) : 0}%`, background: cor }} /></i>
      <span>{txt}</span>
    </div>
  )
}
function BarrasH({ dados, cor, fmt, ref }: { dados: { rot: string; v: number; destaque?: boolean }[]; cor: string; fmt: (v: number) => string; ref?: number | null }) {
  const max = Math.max(1e-9, ...dados.map((d) => d.v), ref ?? 0)
  return (
    <div style={{ display: 'grid', gap: 7 }}>
      {dados.length === 0 && <span style={{ fontSize: 13, color: C.m }}>Sem dado no período.</span>}
      {dados.map((d) => (
        <div key={d.rot} style={{ display: 'grid', gridTemplateColumns: 'minmax(90px, 38%) 1fr auto', gap: 8, alignItems: 'center', fontSize: 12 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.rot}>{d.rot}</span>
          <span style={{ position: 'relative', height: 14, background: C.bg2, borderRadius: 4 }}>
            <b style={{ position: 'absolute', inset: '0 auto 0 0', width: `${Math.max(1, 100 * d.v / max)}%`, background: d.destaque ? C.bad : cor, borderRadius: 4 }} />
            {ref != null && ref > 0 && <u style={{ position: 'absolute', top: -3, bottom: -3, width: 2, left: `${100 * ref / max}%`, background: C.esp }} />}
          </span>
          <span style={{ fontVariantNumeric: 'tabular-nums', color: C.m, minWidth: 64, textAlign: 'right' }}>{fmt(d.v)}</span>
        </div>
      ))}
    </div>
  )
}

export default function MeuPainelVendas() {
  const { companyIds, selInfo } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : null
  const [no, setNo] = useState<string | null>(null)
  const [per, setPer] = useState<string>('30')
  const [p, setP] = useState<Painel | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [dica, setDica] = useState<string | null>(null)

  const intervalo = useMemo(() => {
    const hoje = new Date(); const ate = iso(hoje)
    if (per === 'mes') return { de: iso(new Date(hoje.getFullYear(), hoje.getMonth(), 1)), ate }
    const d = new Date(hoje); d.setDate(d.getDate() - (Number(per) - 1)); return { de: iso(d), ate }
  }, [per])

  const carregar = useCallback(async () => {
    if (!empresa) return
    setCarregando(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_bi_comercial_painel', { p_company_id: empresa, p_no: no, p_de: intervalo.de, p_ate: intervalo.ate })
    setCarregando(false)
    if (error) { setErro(error.message); setP(null); return }
    setP(data as Painel)
  }, [empresa, no, intervalo])
  useEffect(() => { void carregar() }, [carregar])

  const nos = p?.nos ?? []
  const nomeNo = nos.find((n) => n.no === p?.escopo.no)?.nome ?? '—'
  const trilha = useMemo(() => {
    if (!p) return [] as No[]
    const por = new Map(nos.map((n) => [n.no, n]))
    const cam: No[] = []; let n = por.get(p.escopo.no)
    while (n && cam.length < 10) { cam.unshift(n); n = n.pai ? por.get(n.pai) : undefined }
    return cam
  }, [p, nos])
  const ehVendedor = !!p?.posicao
  const r = p?.resumo; const ref = p?.referencia
  const equipe = p?.equipe ?? []
  const maxEq = Math.max(1, ...equipe.map((e) => e.val))
  const maiorDesc = [...equipe].filter((e) => e.val > 5000).sort((a, b) => (b.desc_pct ?? 0) - (a.desc_pct ?? 0))[0]
  const maxDia = Math.max(1, ...(p?.dia ?? []).map((d) => d.val))
  const totDiv = (p?.divisoes ?? []).reduce((s, d) => s + d.val, 0) || 1
  const maxProd = Math.max(1, ...(p?.produtos ?? []).map((x) => x.val))
  const maxCli = Math.max(1, ...(p?.clientes ?? []).map((x) => x.val))
  const abre = (ven: string) => nos.some((n) => n.no === ven) && ven !== p?.escopo.no

  const kpi = (rot: string, chave: string, valor: string, sub: ReactNode, cor?: string) => (
    <div style={{ ...card, gap: 2 }}>
      <div style={{ fontSize: 12, color: C.m, display: 'flex', alignItems: 'center', gap: 4 }}>{rot}<AjudaCampo chave={chave} rota={ROTA} /></div>
      <div style={{ fontFamily: 'Georgia, serif', fontSize: 'clamp(22px, 2.4vw, 30px)', lineHeight: 1.15, color: cor ?? C.esp, fontVariantNumeric: 'tabular-nums' }}>{valor}</div>
      <div style={{ fontSize: 12, color: C.m }}>{sub}</div>
    </div>
  )
  const grade = (min: number): CSSProperties => ({ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${min}px), 1fr))`, gap: 12, alignItems: 'start' })

  return (
    <div style={{ background: C.off, minHeight: '100%', color: C.esp, padding: 'clamp(12px, 2.5vw, 28px)' }}>
      <div style={{ maxWidth: 1400, margin: '0 auto', display: 'grid', gap: 18 }}>
        <header style={{ display: 'grid', gap: 6 }}>
          <div style={{ fontSize: 12, color: C.m }}>Comercial · Meu painel de vendas</div>
          <h1 style={{ margin: 0, fontSize: 'clamp(24px, 3.4vw, 34px)', fontFamily: 'Georgia, serif', fontWeight: 400 }}>{p?.ok ? nomeNo : 'Meu painel de vendas'}</h1>
          {p?.ok && r && (
            <p style={{ margin: 0, fontSize: 15, color: C.m, maxWidth: '80ch' }}>
              De <b style={{ color: C.esp }}>{dataBR(p.periodo.de)}</b> a <b style={{ color: C.esp }}>{dataBR(p.periodo.ate)}</b>: faturou <b style={{ color: C.esp }}>{brl(r.val)}</b> em <b style={{ color: C.esp }}>{ton(r.kg)}</b>.{' '}
              <b style={{ color: C.esp }}>{pct(r.pct_abaixo)}</b> dos itens saíram abaixo do preço de tabela, somando <b style={{ color: C.esp }}>{brl(r.desconto)}</b> de desconto.
            </p>
          )}
          {p?.ok && p.escopo.restrito && <div style={{ fontSize: 12, color: C.m, display: 'flex', alignItems: 'center', gap: 4 }}><Lock size={13} strokeWidth={1.5} /> Você vê somente os seus dados{nos.length > 1 ? ' e os da sua equipe' : ''}.</div>}
        </header>

        <div style={{ ...card, display: 'flex', flexWrap: 'wrap', gap: '10px 16px', alignItems: 'center' }}>
          {p?.ok && nos.length > 1 && (
            <label style={{ display: 'grid', gap: 2, fontSize: 12, color: C.m }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Visão (cascata da equipe)<AjudaCampo chave="com.painel.visao" rota={ROTA} /></span>
              <select value={p.escopo.no} onChange={(e) => setNo(e.target.value)} aria-label="Visão"
                style={{ font: 'inherit', fontSize: 14, padding: '8px 10px', borderRadius: 10, border: `1px solid ${C.bd}`, background: '#fff', color: C.esp, minWidth: 220, maxWidth: '80vw' }}>
                {nos.map((n) => <option key={n.no} value={n.no}>{'  '.repeat(n.no === 'empresa' ? 0 : Math.max(0, String(n.ordem).length))}{n.nome}</option>)}
              </select>
            </label>
          )}
          <div style={{ display: 'grid', gap: 2 }}>
            <span style={{ fontSize: 12, color: C.m, display: 'flex', alignItems: 'center', gap: 4 }}>Período<AjudaCampo chave="com.painel.periodo" rota={ROTA} /></span>
            <div role="group" aria-label="Período" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {PERIODOS.map((x) => (
                <button key={x.k} type="button" onClick={() => setPer(x.k)} aria-pressed={per === x.k}
                  style={{ font: 'inherit', fontSize: 13, padding: '7px 12px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${per === x.k ? C.esp : C.bd}`, background: per === x.k ? C.esp : '#fff', color: per === x.k ? '#fff' : C.esp }}>{x.rot}</button>
              ))}
            </div>
          </div>
          {trilha.length > 1 && (
            <nav aria-label="Trilha da visão" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4, fontSize: 12 }}>
              {trilha.map((n, i) => (
                <span key={n.no} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {i > 0 && <ChevronRight size={12} strokeWidth={1.5} />}
                  <button type="button" onClick={() => setNo(n.no)} aria-current={n.no === p?.escopo.no}
                    style={{ font: 'inherit', fontSize: 12, borderRadius: 999, padding: '3px 10px', cursor: 'pointer', border: `1px solid ${n.no === p?.escopo.no ? C.esp : C.bd}`, background: n.no === p?.escopo.no ? C.esp : '#fff', color: n.no === p?.escopo.no ? '#fff' : C.esp }}>{n.nome}</button>
                </span>
              ))}
            </nav>
          )}
          {carregando && <span style={{ fontSize: 12, color: C.m }}>atualizando…</span>}
        </div>

        {!empresa && <div style={card}>Escolha uma empresa no topo para ver o painel.</div>}
        {erro && <div role="alert" style={{ ...card, borderColor: C.bad, color: C.bad }}>Não foi possível carregar: {erro}</div>}
        {p && !p.ok && <div style={{ ...card, borderLeft: `5px solid ${C.warn}` }}>{p.mensagem}</div>}
        {carregando && !p && <div style={card}>Carregando…</div>}

        {p?.ok && r && (
          <>
            <section style={grade(170)} aria-label="Indicadores">
              {kpi('Faturamento líquido', 'com.painel.faturado', brlc(r.val), <>ticket médio {brl(r.ticket)} por nota</>)}
              {kpi('Volume vendido', 'com.painel.volume', ton(r.kg), <>{int(r.notas)} notas fiscais</>)}
              {kpi('Preço médio da carne', 'com.painel.preco', brl2(r.preco_kg), p.escopo.no !== 'empresa' && ref?.preco_kg != null ? <>por kg · empresa {brl2(ref.preco_kg)}</> : 'por kg, sem couro e despojos')}
              {kpi('Desconto sobre a tabela', 'com.painel.desconto', pct(r.desc_pct, 2), <>{brl(r.desconto)} abaixo da lista</>, p.escopo.no !== 'empresa' && (r.desc_pct ?? 0) > (ref?.desc_pct ?? 99) ? C.bad : undefined)}
              {kpi('Clientes atendidos', 'com.painel.clientes', int(r.clientes), <>10 maiores = {pct(p.conc_top10)} do faturamento</>)}
              {ehVendedor && p.posicao
                ? kpi('Posição na equipe', 'com.painel.posicao', `${p.posicao.lugar}º`, <>em faturamento, entre {p.posicao.de} vendedores</>, C.gold)
                : kpi('Itens abaixo da tabela', 'com.painel.desconto', pct(r.pct_abaixo), <>{int(r.produtos)} produtos vendidos</>, (r.pct_abaixo ?? 0) >= 50 ? C.bad : undefined)}
            </section>

            <section style={{ ...card, borderLeft: `5px solid ${C.gold}` }} aria-label="Leituras para a decisão">
              <Titulo t="Leituras para a decisão" ajuda="com.painel.leituras" />
              <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6, fontSize: 14 }}>
                <li><b>Preço:</b> {pct(r.pct_abaixo)} dos itens foram vendidos abaixo da tabela{ref?.pct_abaixo != null && p.escopo.no !== 'empresa' ? <> (empresa: {pct(ref.pct_abaixo)})</> : null}. O desconto médio é {pct(r.desc_pct, 2)}, mas frequente: {brl(r.desconto)} no período.</li>
                {!ehVendedor && maiorDesc && <li><b>Quem mais concede desconto:</b> {maiorDesc.nome}, com {pct(maiorDesc.desc_pct, 2)} e {pct(maiorDesc.pct_abaixo)} dos itens abaixo da tabela.</li>}
                {p.cede_mais.length > 0 && <li><b>Onde mais se cede preço:</b> {p.cede_mais.map(cap).join(', ')} — todos os itens abaixo da tabela.</li>}
                <li><b>Concentração:</b> os 10 maiores clientes somam {pct(p.conc_top10)} do faturamento desta visão.</li>
                {p.produtos[0] && <li><b>Produto que mais fatura:</b> {cap(p.produtos[0].produto)} ({brl(p.produtos[0].val)}, {brl2(p.produtos[0].preco_kg)}/kg).</li>}
                <li><b>Metas:</b> o ERP de origem ainda não tem cota cadastrada. Com a meta, o painel mostra realizado × meta.<AjudaCampo chave="com.painel.meta" rota={ROTA} /></li>
              </ul>
            </section>

            <section style={grade(380)} aria-label="Vendas">
              <div style={card}>
                <Titulo t="Faturamento por dia" nota="Notas de venda, valor líquido. Toque numa barra para ver volume e notas." />
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 190, paddingTop: 18, overflowX: 'auto' }}>
                  {p.dia.length === 0 && <span style={{ fontSize: 13, color: C.m }}>Sem venda no período.</span>}
                  {p.dia.map((d) => (
                    <button key={d.dia} type="button" onClick={() => setDica(`${dataBR(d.dia)} · ${brl(d.val)} · ${int(d.kg)} kg · ${d.notas} notas`)}
                      title={`${dataBR(d.dia)} · ${brl(d.val)} · ${int(d.kg)} kg · ${d.notas} notas`}
                      style={{ flex: '1 0 26px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, fontSize: 10, color: C.m, background: 'none', border: 0, padding: 0, cursor: 'pointer', font: 'inherit' }}>
                      <span style={{ fontSize: 10, color: C.esp }}>{brlc(d.val).replace('R$ ', '')}</span>
                      <i style={{ display: 'block', width: '100%', height: Math.max(3, 140 * d.val / maxDia), background: `linear-gradient(180deg, ${C.gold2}, ${C.gold})`, borderRadius: '5px 5px 0 0' }} />
                      <span>{dataBR(d.dia).slice(0, 5)}</span>
                    </button>
                  ))}
                </div>
                {dica && <div role="status" style={{ fontSize: 12, color: C.esp, background: C.bg2, borderRadius: 8, padding: '6px 10px' }}>{dica}</div>}
              </div>
              <div style={card}>
                <Titulo t="Mix por linha de produto" nota="Participação de cada linha no faturamento." />
                <BarrasH cor={C.azul} fmt={(v) => pct(v)} dados={(p.divisoes ?? []).map((d) => ({ rot: cap(d.linha), v: 100 * d.val / totDiv }))} />
              </div>
            </section>

            {!ehVendedor && equipe.length > 0 && (
              <section style={{ display: 'grid', gap: 12 }} aria-label="Equipe comercial">
                <div style={card}>
                  <Titulo t="Ranking da equipe" nota="Toque num vendedor para abrir a visão dele. Desconto = quanto o preço praticado ficou abaixo da tabela." ajuda="com.painel.equipe" />
                  <div style={{ overflow: 'auto', maxHeight: 480 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead><tr><th style={{ ...th, textAlign: 'left' }}>Vendedor</th><th style={th}>Faturamento</th><th style={th}>Volume (kg)</th><th style={th}>R$/kg carne</th><th style={th}>Desconto</th><th style={th}>Itens abaixo da tabela</th><th style={th}>Clientes</th><th style={th}>Notas</th><th style={th}>Ticket médio</th></tr></thead>
                      <tbody>
                        {equipe.map((e) => (
                          <tr key={e.ven} onClick={abre(e.ven) ? () => setNo(e.ven) : undefined} style={{ cursor: abre(e.ven) ? 'pointer' : 'default' }}>
                            <td style={{ ...td, textAlign: 'left', fontWeight: 600, color: abre(e.ven) ? C.gold : C.esp }}>{e.nome}</td>
                            <td style={td}><BarraCelula v={e.val} max={maxEq} txt={brl(e.val)} cor={C.gold} /></td>
                            <td style={td}>{int(e.kg)}</td><td style={td}>{brl2(e.preco_kg)}</td>
                            <td style={td}><Chip v={e.desc_pct} a={1} b={2} d={2} /></td><td style={td}><Chip v={e.pct_abaixo} a={40} b={70} /></td>
                            <td style={td}>{int(e.clientes)}</td><td style={td}>{int(e.notas)}</td><td style={td}>{brl(e.ticket)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div style={grade(380)}>
                  <div style={card}>
                    <Titulo t="Desconto sobre a tabela, por vendedor" nota="Em vermelho, acima de 2%." />
                    <BarrasH cor={C.gold} fmt={(v) => pct(v, 2)} dados={equipe.filter((e) => e.val > 5000).sort((a, b) => (b.desc_pct ?? 0) - (a.desc_pct ?? 0)).map((e) => ({ rot: e.nome, v: Math.max(0, e.desc_pct ?? 0), destaque: (e.desc_pct ?? 0) >= 2 }))} />
                  </div>
                  <div style={card}>
                    <Titulo t="Preço médio da carne, por vendedor" nota="R$ por kg. O traço é a média desta visão." />
                    <BarrasH cor={C.verde} fmt={(v) => brl2(v)} ref={r.preco_kg} dados={equipe.filter((e) => e.preco_kg != null && e.kg > 500).sort((a, b) => (b.preco_kg ?? 0) - (a.preco_kg ?? 0)).map((e) => ({ rot: e.nome, v: e.preco_kg ?? 0 }))} />
                  </div>
                </div>
              </section>
            )}

            <section style={card} aria-label="Produtos">
              <Titulo t={`Os ${p.produtos.length} produtos que mais faturam`} nota="Preço por kg, desconto e quantos itens saíram abaixo da tabela." />
              <div style={{ overflow: 'auto', maxHeight: 520 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={{ ...th, textAlign: 'left' }}>Produto</th><th style={th}>Faturamento</th><th style={th}>Volume (kg)</th><th style={th}>R$/kg</th><th style={th}>Desconto</th><th style={th}>Itens abaixo da tabela</th><th style={th}>Clientes</th></tr></thead>
                  <tbody>
                    {p.produtos.map((x) => (
                      <tr key={x.cod}>
                        <td style={{ ...td, textAlign: 'left', whiteSpace: 'normal', minWidth: 180 }}>{x.cod} · {cap(x.produto)}</td>
                        <td style={td}><BarraCelula v={x.val} max={maxProd} txt={brl(x.val)} cor={C.azul} /></td>
                        <td style={td}>{int(x.kg)}</td><td style={td}>{brl2(x.preco_kg)}</td>
                        <td style={td}>{x.desc_pct != null ? <Chip v={x.desc_pct} a={1} b={2} d={2} /> : '—'}</td><td style={td}><Chip v={x.pct_abaixo} a={40} b={70} /></td>
                        <td style={td}>{int(x.clientes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section style={grade(420)} aria-label="Clientes e praças">
              <div style={card}>
                <Titulo t="Maiores clientes" nota="Cada loja aparece pelo seu código no ERP de origem." />
                <div style={{ overflow: 'auto', maxHeight: 520 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr><th style={{ ...th, textAlign: 'left' }}>Cliente</th><th style={th}>Faturamento</th><th style={th}>Volume (kg)</th><th style={th}>R$/kg</th><th style={th}>Notas</th></tr></thead>
                    <tbody>
                      {p.clientes.map((c) => (
                        <tr key={c.cod}>
                          <td style={{ ...td, textAlign: 'left', whiteSpace: 'normal', minWidth: 180 }}>{cap(c.cliente)}<div style={{ fontSize: 11, color: C.m }}>{c.cidade}</div></td>
                          <td style={td}><BarraCelula v={c.val} max={maxCli} txt={brl(c.val)} cor={C.verde} /></td>
                          <td style={td}>{int(c.kg)}</td><td style={td}>{brl2(c.preco_kg)}</td><td style={td}>{int(c.notas)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div style={card}>
                <Titulo t="Faturamento por cidade" nota="As praças que mais compram nesta visão." />
                <BarrasH cor={C.verde} fmt={(v) => brlc(v)} dados={(p.cidades ?? []).map((c) => ({ rot: c.cidade, v: c.val }))} />
              </div>
            </section>

            {p.logistica && (
              <section style={{ display: 'grid', gap: 12 }} aria-label="Logística de saída">
                <div style={{ fontSize: 17, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>Logística de saída<AjudaCampo chave="com.painel.logistica" rota={ROTA} /></div>
                <div style={grade(170)}>
                  {kpi('Cargas montadas', 'com.painel.logistica', int(p.logistica.cargas), 'no período')}
                  {kpi('Peso médio por carga', 'com.painel.logistica', `${int(p.logistica.kg_carga)} kg`, 'peso líquido vendido')}
                  {kpi('Clientes por carga', 'com.painel.logistica', nf({ maximumFractionDigits: 1 }).format(p.logistica.clientes_carga ?? 0), 'entregas em média')}
                  {kpi('Notas sem carga', 'com.painel.logistica', int(p.logistica.notas_sem_carga), <>{int(p.logistica.kg_sem_carga)} kg retirados ou sem romaneio</>)}
                </div>
                <div style={card}>
                  <Titulo t="Cargas do período" nota="Cada carga com notas, clientes, cidades, peso e valor. Na visão de um vendedor, só a parte dele." />
                  <div style={{ overflow: 'auto', maxHeight: 480 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead><tr><th style={{ ...th, textAlign: 'left' }}>Data</th><th style={th}>Carga</th><th style={{ ...th, textAlign: 'left' }}>Transportador</th><th style={th}>Notas</th><th style={th}>Clientes</th><th style={th}>Cidades</th><th style={th}>Peso (kg)</th><th style={th}>Valor</th></tr></thead>
                      <tbody>
                        {(p.cargas ?? []).map((c) => (
                          <tr key={c.carga}>
                            <td style={{ ...td, textAlign: 'left' }}>{dataBR(c.dia)}</td><td style={td}>{c.carga}</td>
                            <td style={{ ...td, textAlign: 'left', whiteSpace: 'normal', minWidth: 160 }}>{cap(c.transportador)}</td>
                            <td style={td}>{int(c.notas)}</td><td style={td}>{int(c.clientes)}</td><td style={td}>{int(c.cidades)}</td><td style={td}>{int(c.kg)}</td><td style={td}>{brl(c.val)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}
