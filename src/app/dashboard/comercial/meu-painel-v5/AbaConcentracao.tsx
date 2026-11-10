'use client'
// Comercial › Meu painel › aba "Concentração" (Curva ABC / Pareto) — v5.
// Consome a RPC de servidor fn_bi_comercial_pareto (agregação já pronta no banco, com a MESMA guarda de escopo do BI:
// fn_bi_comercial_scope / com_vendedor_acesso — vendedor vê só a própria venda, líder vê a empresa). Mostra, por
// dimensão escolhida (cliente, produto, cidade, vendedor), quem concentra o faturamento: curva ABC (A = até 80%,
// B = até 95%, C = o resto) com participação e acumulado. Identidade PS (espresso/dourado/off-white), celular e notebook.
// Nada aqui decide escopo: a RPC devolve só o que o usuário pode ver. RD-95 ("?" em todo campo) · RD-98 (erro amigável).
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { erroAmigavel } from '@/lib/erroAmigavel'

const C = { esp: '#3D2314', gold: '#C8941A', bd: '#E7DED3', m: '#6B5D4F', bg2: '#F0ECE3', verde: '#3f7d4e', azul: '#2f6f8f', warn: '#b07a12' }
const ROTA = '/dashboard/comercial/meu-painel'
const nf = (o: Intl.NumberFormatOptions) => new Intl.NumberFormat('pt-BR', o)
const brl = (v: number | null | undefined) => v == null ? '—' : nf({ style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v)
const pct = (v: number | null | undefined, d = 1) => v == null ? '—' : nf({ minimumFractionDigits: d, maximumFractionDigits: d }).format(v) + '%'
const int = (v: number | null | undefined) => v == null ? '—' : nf({ maximumFractionDigits: 0 }).format(v)

type DimKey = 'cliente' | 'produto' | 'cidade' | 'vendedor'
const DIMS: { k: DimKey; rot: string; plural: string }[] = [
  { k: 'cliente', rot: 'Cliente', plural: 'clientes' }, { k: 'produto', rot: 'Produto', plural: 'produtos' },
  { k: 'cidade', rot: 'Cidade', plural: 'cidades' }, { k: 'vendedor', rot: 'Vendedor', plural: 'vendedores' },
]
type ItemPareto = { rotulo: string; valor: number; pct: number; pct_acumulado: number }
type Classe = 'A' | 'B' | 'C'
const classeDe = (acum: number): Classe => acum <= 80 ? 'A' : acum <= 95 ? 'B' : 'C'
const CORES: Record<Classe, string> = { A: C.verde, B: C.azul, C: C.m }
const EXPL: Record<Classe, string> = { A: 'até 80% do faturamento', B: 'de 80% a 95%', C: 'os últimos 5%' }

const card: CSSProperties = { background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 14, padding: 16, minWidth: 0, display: 'grid', gap: 10, alignContent: 'start' }
const th: CSSProperties = { position: 'sticky', top: 0, background: '#fff', textAlign: 'right', fontWeight: 600, color: C.m, padding: '8px 10px', borderBottom: `1px solid ${C.bd}`, whiteSpace: 'nowrap', fontSize: 12, zIndex: 1 }
const td: CSSProperties = { textAlign: 'right', padding: '8px 10px', borderBottom: `1px solid ${C.bg2}`, whiteSpace: 'nowrap', fontSize: 13, fontVariantNumeric: 'tabular-nums' }

export function AbaConcentracao({ empresa, de, ate, vendedorCod }: { empresa: string; de: string; ate: string; vendedorCod: string | null }) {
  const [dim, setDim] = useState<DimKey>('cliente')
  const [itens, setItens] = useState<ItemPareto[] | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    setCarregando(true); setErro(null)
    void Promise.resolve(
      supabase.rpc('fn_bi_comercial_pareto', { p_company_id: empresa, p_dt_ini: de, p_dt_fim: ate, p_dimensao: dim, p_vendedor: vendedorCod }),
    ).then(({ data, error }) => {
      if (!vivo) return
      setCarregando(false)
      if (error) { setErro(erroAmigavel(error)); setItens(null); return }
      const d = data as { ok: boolean; erro?: string; itens?: ItemPareto[] }
      if (!d?.ok) { setErro(d?.erro === 'sem_acesso_comercial' ? 'Você não tem acesso ao comercial desta empresa.' : (d?.erro ?? 'Não foi possível carregar.')); setItens(null); return }
      setItens((d.itens ?? []).map((i) => ({ rotulo: i.rotulo, valor: Number(i.valor), pct: Number(i.pct), pct_acumulado: Number(i.pct_acumulado) })))
    })
    return () => { vivo = false }
  }, [empresa, de, ate, dim, vendedorCod])

  const plural = DIMS.find((d) => d.k === dim)!.plural
  const resumo = useMemo(() => {
    if (!itens || !itens.length) return null
    const total = itens.reduce((s, i) => s + i.valor, 0)
    const bandas: Record<Classe, { n: number; val: number }> = { A: { n: 0, val: 0 }, B: { n: 0, val: 0 }, C: { n: 0, val: 0 } }
    for (const i of itens) { const c = classeDe(i.pct_acumulado); bandas[c].n++; bandas[c].val += i.valor }
    return { total, bandas }
  }, [itens])

  return (
    <section style={{ display: 'grid', gap: 14 }} aria-label="Concentração — Curva ABC">
      <div style={{ ...card, gap: 8 }}>
        <div style={{ fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>Concentração (Curva ABC)<AjudaCampo chave="com.painel.curva" rota={ROTA} /></div>
        <div style={{ fontSize: 12, color: C.m }}>Quem faz o faturamento. A = até 80%, B = até 95%, C = o resto. Escolha olhar por cliente, produto, cidade ou vendedor.</div>
        <label style={{ display: 'grid', gap: 2, fontSize: 12, color: C.m, maxWidth: 260 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Olhar por<AjudaCampo chave="com.painel.curva" rota={ROTA} /></span>
          <select value={dim} onChange={(e) => setDim(e.target.value as DimKey)} aria-label="Dimensão da curva ABC"
            style={{ font: 'inherit', fontSize: 14, padding: '8px 10px', borderRadius: 10, border: `1px solid ${C.bd}`, background: '#fff', color: C.esp }}>
            {DIMS.map((d) => <option key={d.k} value={d.k}>{d.rot}</option>)}
          </select>
        </label>
      </div>

      {carregando && <div style={card}>Carregando…</div>}
      {erro && <div role="alert" style={{ ...card, borderLeft: `5px solid ${C.warn}` }}>Não foi possível carregar a curva ABC: {erro}</div>}
      {!carregando && !erro && itens && itens.length === 0 && (
        <div style={{ ...card, borderLeft: `5px solid ${C.warn}` }}>Sem venda neste recorte para montar a curva ABC. Experimente outro período ou tire o filtro de vendedor.</div>
      )}

      {!carregando && !erro && itens && itens.length > 0 && resumo && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }} aria-label="Bandas da curva ABC">
            {(['A', 'B', 'C'] as Classe[]).map((cl) => (
              <div key={cl} style={{ ...card, gap: 4, borderTop: `4px solid ${CORES[cl]}` }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.m, display: 'flex', alignItems: 'center', gap: 4 }}>Classe {cl}<AjudaCampo chave="com.painel.curva" rota={ROTA} /></div>
                <div style={{ fontSize: 22, fontWeight: 700, color: C.esp }}>{int(resumo.bandas[cl].n)} <span style={{ fontSize: 13, fontWeight: 500, color: C.m }}>{plural}</span></div>
                <div style={{ fontSize: 13, color: C.m }}>{brl(resumo.bandas[cl].val)} · {pct(resumo.total ? 100 * resumo.bandas[cl].val / resumo.total : 0)} · {EXPL[cl]}</div>
              </div>
            ))}
          </div>

          <div style={{ fontSize: 14, color: C.esp, lineHeight: 1.5, padding: '0 2px' }}>
            <b>Leitura:</b> {int(resumo.bandas.A.n)} {plural} (classe A) concentram <b>{pct(resumo.total ? 100 * resumo.bandas.A.val / resumo.total : 0)}</b> do faturamento do período. É neles que uma perda dói mais — e onde negociar rende mais.
          </div>

          <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
            <div style={{ maxHeight: 520, overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ ...th, textAlign: 'left' }}>{DIMS.find((d) => d.k === dim)!.rot}</th>
                    <th style={th}>Faturamento<AjudaCampo chave="com.painel.faturado" rota={ROTA} /></th>
                    <th style={th}>Participação<AjudaCampo chave="com.painel.participacao" rota={ROTA} /></th>
                    <th style={th}>Acumulado<AjudaCampo chave="com.painel.curva" rota={ROTA} /></th>
                    <th style={{ ...th, textAlign: 'center' }}>Classe<AjudaCampo chave="com.painel.curva" rota={ROTA} /></th>
                  </tr>
                </thead>
                <tbody>
                  {itens.map((i, idx) => {
                    const cl = classeDe(i.pct_acumulado)
                    return (
                      <tr key={idx}>
                        <td style={{ ...td, textAlign: 'left', fontWeight: 500, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>{i.rotulo}</td>
                        <td style={td}>{brl(i.valor)}</td>
                        <td style={td}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                            <span style={{ display: 'inline-block', height: 6, width: Math.max(2, Math.min(60, i.pct * 2)), borderRadius: 3, background: C.gold }} />
                            {pct(i.pct, 1)}
                          </div>
                        </td>
                        <td style={td}>{pct(i.pct_acumulado, 1)}</td>
                        <td style={{ ...td, textAlign: 'center' }}>
                          <span style={{ display: 'inline-block', minWidth: 22, padding: '2px 8px', borderRadius: 10, fontWeight: 700, fontSize: 12, color: '#fff', background: CORES[cl] }}>{cl}</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </section>
  )
}

export default AbaConcentracao
