'use client'
// Comercial › Meu painel de vendas (CEO 29/10/2026, com a diretoria comercial da Frioeste).
// BI em cascata e GENÉRICO: lê só a fn_bi_comercial_painel, que trava o escopo no banco pelo vínculo do usuário com o
// código de vendedor do ERP de origem (ATAK hoje; outro ERP = outro tradutor, a tela não muda).
// Vendedor vê só a própria venda; supervisor a equipe dele; diretoria a empresa toda. Mobile-first.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const C = { esp: '#3D2314', off: '#FAF7F2', gold: '#C8941A', gold2: '#E0B048', bd: '#E7DED3', m: '#6B5D4F', d: '#9C8E80', ok: '#1a8f63', warn: '#b07a12', bad: '#C0392B', bg2: '#F0ECE3' }
const ROTA = '/dashboard/comercial/meu-painel'

type No = { no: string; nome: string; cargo: string; pai: string | null; ordem: string }
type Painel = {
  ok: boolean; erro?: string; mensagem?: string
  periodo: { de: string; ate: string }
  escopo: { raiz: string; no: string; restrito: boolean }
  nos: No[]
  resumo: { val: number; kg: number; preco_kg: number | null; desc_pct: number | null; desconto: number; pct_abaixo: number | null; clientes: number; notas: number; ticket: number | null; produtos: number }
  referencia: { desc_pct: number | null; pct_abaixo: number | null; preco_kg: number | null }
  posicao: { lugar: number; de: number } | null
  dia: { dia: string; val: number; kg: number; notas: number }[]
  clientes: { cod: string; cliente: string; cidade: string; val: number; kg: number; notas: number; preco_kg: number | null }[]
  produtos: { cod: string; produto: string; val: number; kg: number; preco_kg: number | null; pct_abaixo: number }[]
  cede_mais: string[]
  equipe: { ven: string; nome: string; val: number; kg: number; desc_pct: number | null; pct_abaixo: number | null; clientes: number }[]
}

const nf = (o: Intl.NumberFormatOptions) => new Intl.NumberFormat('pt-BR', o)
const brl = (v: number | null | undefined) => v == null ? '—' : nf({ style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v)
const brl2 = (v: number | null | undefined) => v == null ? '—' : nf({ style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)
const brlc = (v: number | null | undefined) => v == null ? '—' : Math.abs(v) >= 10000 ? 'R$ ' + nf({ notation: 'compact', maximumFractionDigits: 1 }).format(v) : brl(v)
const pct = (v: number | null | undefined, d = 1) => v == null ? '—' : nf({ minimumFractionDigits: d, maximumFractionDigits: d }).format(v) + '%'
const ton = (kg: number) => nf({ maximumFractionDigits: 1 }).format(kg / 1000) + ' t'
const int = (v: number) => nf({ maximumFractionDigits: 0 }).format(v)
const dataBR = (s: string) => { const [a, m, d] = String(s).slice(0, 10).split('-'); return `${d}/${m}/${a}` }
const iso = (d: Date) => d.toISOString().slice(0, 10)

const PERIODOS = [
  { k: '7', rot: '7 dias' }, { k: '30', rot: '30 dias' }, { k: 'mes', rot: 'Este mês' }, { k: '90', rot: '90 dias' },
] as const

export default function MeuPainelVendas() {
  const { companyIds, selInfo } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : null
  const [no, setNo] = useState<string | null>(null)
  const [per, setPer] = useState<string>('30')
  const [p, setP] = useState<Painel | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

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

  const nomeNo = p?.nos.find((n) => n.no === p.escopo.no)?.nome ?? '—'
  const ehVendedor = !!p?.posicao
  const maxDia = Math.max(1, ...(p?.dia ?? []).map((d) => d.val))
  const r = p?.resumo; const ref = p?.referencia
  const alerta = r && ref && r.pct_abaixo != null && ref.pct_abaixo != null && r.pct_abaixo > ref.pct_abaixo + 10

  const card: React.CSSProperties = { background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 14, padding: 14, minWidth: 0 }
  const kpi = (rot: string, chave: string, valor: string, sub: string, cor?: string) => (
    <div style={card}>
      <div style={{ fontSize: 12, color: C.m, display: 'flex', alignItems: 'center', gap: 4 }}>{rot}<AjudaCampo chave={chave} rota={ROTA} /></div>
      <div style={{ fontFamily: 'Georgia, serif', fontSize: 26, lineHeight: 1.2, color: cor ?? C.esp, fontVariantNumeric: 'tabular-nums' }}>{valor}</div>
      <div style={{ fontSize: 12, color: C.m }}>{sub}</div>
    </div>
  )
  const linha = (a: string, b: string, k: string, cor?: string) => (
    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13, padding: '8px 0', borderBottom: `1px solid ${C.bg2}` }}>
      <span style={{ minWidth: 0 }}>{a}</span><span style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', color: cor }}>{b}</span>
    </div>
  )

  return (
    <div style={{ background: C.off, minHeight: '100%', color: C.esp, padding: 'clamp(12px, 3vw, 24px)' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', display: 'grid', gap: 14 }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div style={{ fontSize: 12, color: C.m }}>Comercial · Meu painel de vendas</div>
            <h1 style={{ margin: 0, fontSize: 'clamp(20px, 4vw, 28px)', fontFamily: 'Georgia, serif', fontWeight: 400 }}>{p?.ok ? nomeNo : 'Meu painel de vendas'}</h1>
            {p?.ok && p.escopo.restrito && <div style={{ fontSize: 12, color: C.m }}>🔒 Você vê somente os seus dados{p.nos.length > 1 ? ' e os da sua equipe' : ''}.</div>}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {p?.ok && p.nos.length > 1 && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.m }}>Visão<AjudaCampo chave="com.painel.visao" rota={ROTA} />
                <select value={p.escopo.no} onChange={(e) => setNo(e.target.value)} aria-label="Visão"
                  style={{ font: 'inherit', fontSize: 14, padding: '8px 10px', borderRadius: 10, border: `1px solid ${C.bd}`, background: '#fff', color: C.esp, maxWidth: '70vw' }}>
                  {p.nos.map((n) => <option key={n.no} value={n.no}>{'  '.repeat(n.no === 'empresa' ? 0 : Math.max(0, String(n.ordem).length - 1))}{n.nome}</option>)}
                </select>
              </label>
            )}
            <div role="group" aria-label="Período" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              {PERIODOS.map((x) => (
                <button key={x.k} type="button" onClick={() => setPer(x.k)} aria-pressed={per === x.k}
                  style={{ font: 'inherit', fontSize: 13, padding: '7px 12px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${per === x.k ? C.esp : C.bd}`, background: per === x.k ? C.esp : '#fff', color: per === x.k ? '#fff' : C.esp }}>{x.rot}</button>
              ))}
              <AjudaCampo chave="com.painel.periodo" rota={ROTA} />
            </div>
          </div>
        </header>

        {!empresa && <div style={card}>Escolha uma empresa no topo para ver o painel.</div>}
        {erro && <div role="alert" style={{ ...card, borderColor: C.bad, color: C.bad }}>Não foi possível carregar: {erro}</div>}
        {p && !p.ok && <div style={{ ...card, borderLeft: `5px solid ${C.warn}` }}>{p.mensagem}</div>}
        {carregando && !p && <div style={card}>Carregando…</div>}

        {p?.ok && r && (
          <>
            <div style={{ fontSize: 12, color: C.m }}>Notas de venda de {dataBR(p.periodo.de)} a {dataBR(p.periodo.ate)}{carregando ? ' · atualizando…' : ''}</div>
            <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))', gap: 10 }}>
              {kpi('Faturado', 'com.painel.faturado', brlc(r.val), `${int(r.notas)} notas · ticket ${brl(r.ticket)}`)}
              {kpi('Volume', 'com.painel.volume', ton(r.kg), `${int(r.clientes)} clientes atendidos`)}
              {kpi('Preço médio da carne', 'com.painel.preco', brl2(r.preco_kg), ref?.preco_kg != null && !(p.escopo.no === 'empresa') ? `empresa ${brl2(ref.preco_kg)} por kg` : 'por kg')}
              {kpi('Desconto sobre a tabela', 'com.painel.desconto', pct(r.desc_pct, 2), `${brl(r.desconto)} · ${pct(r.pct_abaixo)} dos itens`, r.desc_pct != null && ref?.desc_pct != null && r.desc_pct > ref.desc_pct ? C.bad : C.esp)}
            </section>

            <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: 10 }}>
              {ehVendedor && p.posicao && (
                <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{ fontFamily: 'Georgia, serif', fontSize: 40, color: C.gold }}>{p.posicao.lugar}º</div>
                  <div><b>em faturamento</b><AjudaCampo chave="com.painel.posicao" rota={ROTA} /><div style={{ fontSize: 12, color: C.m }}>entre {p.posicao.de} vendedores, sem ver os números dos colegas</div></div>
                </div>
              )}
              {alerta && (
                <div style={{ ...card, background: '#fff4e0', borderColor: '#ecd39a', borderLeft: `5px solid ${C.bad}`, fontSize: 14 }}>
                  <b>Atenção ao preço:</b> {pct(r.pct_abaixo)} dos itens saíram abaixo da tabela (média da empresa: {pct(ref?.pct_abaixo)}). Foram {brl(r.desconto)} de desconto no período.
                  {p.cede_mais.length > 0 && <> Onde mais cede: {p.cede_mais.join(', ').toLowerCase()}.</>}
                </div>
              )}
              <div style={card}>
                <div style={{ fontWeight: 600 }}>Desconto: {p.escopo.no === 'empresa' ? 'empresa' : 'esta visão × empresa'}<AjudaCampo chave="com.painel.desconto" rota={ROTA} /></div>
                <div style={{ position: 'relative', height: 10, background: C.bg2, borderRadius: 6, margin: '12px 0 8px' }}>
                  <i style={{ position: 'absolute', inset: '0 auto 0 0', borderRadius: 6, width: `${Math.min(100, (r.desc_pct ?? 0) * 33)}%`, background: (r.desc_pct ?? 0) > (ref?.desc_pct ?? 99) ? C.bad : C.gold }} />
                  {ref?.desc_pct != null && <u style={{ position: 'absolute', top: -4, bottom: -4, width: 2, background: C.esp, left: `${Math.min(100, ref.desc_pct * 33)}%` }} />}
                </div>
                {linha('Esta visão', pct(r.desc_pct, 2), 'a')}
                {linha('Empresa (traço)', pct(ref?.desc_pct, 2), 'b')}
              </div>
            </section>

            <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: 10 }}>
              <div style={card}>
                <div style={{ fontWeight: 600 }}>Vendas por dia</div>
                <div style={{ fontSize: 12, color: C.m }}>Valor faturado</div>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 130, paddingTop: 8, overflowX: 'auto' }}>
                  {p.dia.length === 0 && <span style={{ fontSize: 13, color: C.m }}>Sem venda no período.</span>}
                  {p.dia.map((d) => (
                    <div key={d.dia} title={`${dataBR(d.dia)} · ${brl(d.val)} · ${int(d.kg)} kg · ${d.notas} notas`} style={{ flex: '1 0 18px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, fontSize: 10, color: C.m }}>
                      <i style={{ display: 'block', width: '100%', height: Math.max(3, 100 * d.val / maxDia), background: `linear-gradient(180deg, ${C.gold2}, ${C.gold})`, borderRadius: '4px 4px 0 0' }} />
                      <span>{dataBR(d.dia).slice(0, 5)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div style={card}>
                <div style={{ fontWeight: 600 }}>Maiores clientes</div>
                {p.clientes.map((c) => linha(`${c.cliente} · ${c.cidade}`, brl(c.val), c.cod))}
              </div>
              <div style={card}>
                <div style={{ fontWeight: 600 }}>Produtos</div>
                {p.produtos.map((x) => linha(`${x.cod} ${x.produto}`, `${brl(x.val)}${x.preco_kg != null ? ' · ' + brl2(x.preco_kg) + '/kg' : ''}`, x.cod, x.pct_abaixo >= 99 ? C.bad : undefined))}
              </div>
              <div style={card}>
                <div style={{ fontWeight: 600 }}>Meta do mês<AjudaCampo chave="com.painel.meta" rota={ROTA} /></div>
                <div style={{ fontSize: 13, color: C.m }}>Aparece aqui quando a meta for cadastrada no ERP de origem.</div>
              </div>
            </section>

            {!ehVendedor && p.equipe.length > 0 && (
              <section style={card}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>Equipe — toque num vendedor para abrir a visão dele</div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
                    <thead><tr style={{ color: C.m, textAlign: 'right' }}><th style={{ textAlign: 'left', padding: 6 }}>Vendedor</th><th style={{ padding: 6 }}>Faturado</th><th style={{ padding: 6 }}>Volume</th><th style={{ padding: 6 }}>Desconto</th><th style={{ padding: 6 }}>Itens abaixo</th><th style={{ padding: 6 }}>Clientes</th></tr></thead>
                    <tbody>
                      {p.equipe.map((e) => {
                        const abre = p.nos.some((n) => n.no === e.ven)
                        return (
                          <tr key={e.ven} onClick={abre ? () => setNo(e.ven) : undefined} style={{ cursor: abre ? 'pointer' : 'default', borderTop: `1px solid ${C.bg2}`, textAlign: 'right' }}>
                            <td style={{ textAlign: 'left', padding: 6, color: abre ? C.gold : C.esp, fontWeight: 600 }}>{e.nome}</td>
                            <td style={{ padding: 6 }}>{brl(e.val)}</td><td style={{ padding: 6 }}>{ton(e.kg)}</td>
                            <td style={{ padding: 6, color: (e.desc_pct ?? 0) >= 2 ? C.bad : undefined }}>{pct(e.desc_pct, 2)}</td>
                            <td style={{ padding: 6, color: (e.pct_abaixo ?? 0) >= 70 ? C.bad : undefined }}>{pct(e.pct_abaixo)}</td>
                            <td style={{ padding: 6 }}>{int(e.clientes)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}
