'use client'
// Comercial › Meu painel › aba "Produtos" — v5 (server-proven).
// Consome a RPC de servidor fn_bi_comercial_produtos (agregação pronta no banco, guarda por empresa). Lista cada produto
// com faturamento, participação, volume (kg), R$ por kg e a situação na análise (carne / despojo / a classificar). Os
// números saem do banco (RD-38), não do cálculo do navegador. A aba "Cortes" segue com a análise fina de preço/desconto.
// Identidade PS. RD-95 ("?" em todo indicador) · RD-98 (erro amigável).
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { erroAmigavel } from '@/lib/erroAmigavel'

const C = { esp: '#3D2314', gold: '#C8941A', gold2: '#E0B048', bd: '#E7DED3', m: '#6B5D4F', bg2: '#F0ECE3', verde: '#3f7d4e', azul: '#2f6f8f', warn: '#b07a12', d: '#9C8E80' }
const ROTA = '/dashboard/comercial/meu-painel'
const nf = (o: Intl.NumberFormatOptions) => new Intl.NumberFormat('pt-BR', o)
const brl0 = (v: number | null | undefined) => v == null ? '—' : nf({ style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v)
const brl2 = (v: number | null | undefined) => v == null ? '—' : nf({ style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)
const int = (v: number | null | undefined) => v == null ? '—' : nf({ maximumFractionDigits: 0 }).format(v)
const kg0 = (v: number | null | undefined) => v == null ? '—' : nf({ maximumFractionDigits: 0 }).format(v) + ' kg'
const pct = (v: number | null | undefined, d = 1) => v == null ? '—' : nf({ minimumFractionDigits: d, maximumFractionDigits: d }).format(v) + '%'
const cap = (s: string) => (s || '').toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase())

type Prod = { cod_produto: string; desc_produto: string; status: string; kg: number; valor_total: number }
type Resp = { ok: boolean; erro?: string; produtos?: Prod[] }

const STATUS: Record<string, { rot: string; cor: string }> = {
  entra: { rot: 'Na análise', cor: C.verde },
  fora: { rot: 'Despojo (fora)', cor: C.d },
  despojo: { rot: 'Despojo (fora)', cor: C.d },
  a_classificar: { rot: 'A classificar', cor: C.warn },
}

const card: CSSProperties = { background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 16, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }
const th: CSSProperties = { position: 'sticky', top: 0, background: '#fff', textAlign: 'right', fontWeight: 600, color: C.m, padding: '8px 10px', borderBottom: `1px solid ${C.bd}`, whiteSpace: 'nowrap', fontSize: 12, zIndex: 1 }
const td: CSSProperties = { textAlign: 'right', padding: '8px 10px', borderBottom: `1px solid ${C.bg2}`, whiteSpace: 'nowrap', fontSize: 13, fontVariantNumeric: 'tabular-nums' }

export function AbaProdutos({ empresa, de, ate }: { empresa: string; de: string; ate: string }) {
  const [resp, setResp] = useState<Resp | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    setCarregando(true); setErro(null)
    void Promise.resolve(
      supabase.rpc('fn_bi_comercial_produtos', { p_company_id: empresa, p_de: de, p_ate: ate }),
    ).then(({ data, error }) => {
      if (!vivo) return
      setCarregando(false)
      if (error) { setErro(erroAmigavel(error)); setResp(null); return }
      const d = data as Resp
      if (!d?.ok) { setErro(d?.erro === 'sem_acesso' ? 'Você não tem acesso a esta empresa.' : (d?.erro ?? 'Não foi possível carregar.')); setResp(null); return }
      setResp(d)
    })
    return () => { vivo = false }
  }, [empresa, de, ate])

  const linhas = useMemo(() => (resp?.produtos ?? []).slice().sort((a, b) => b.valor_total - a.valor_total), [resp])
  const total = useMemo(() => linhas.reduce((s, l) => s + (l.valor_total || 0), 0), [linhas])
  const maxFat = useMemo(() => Math.max(1, ...linhas.map((l) => l.valor_total || 0)), [linhas])
  const top = linhas[0]

  return (
    <section style={{ display: 'grid', gap: 14 }} aria-label="Produtos do período">
      <div style={{ ...card, gap: 4 }}>
        <div style={{ fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>Produtos<AjudaCampo chave="com.painel.produtos" rota={ROTA} /></div>
        <div style={{ fontSize: 12, color: C.m }}>
          Faturamento por produto no período, direto do banco (RD-38).
          {top ? <> O que mais fatura é <b>{cap(top.desc_produto)}</b>.</> : null} A situação na análise (carne/despojo) é a marcada na engrenagem. A aba <b>Cortes</b> abre a análise de preço e desconto.
        </div>
      </div>

      {carregando && <div style={card}>Carregando…</div>}
      {erro && <div role="alert" style={{ ...card, borderLeft: `5px solid ${C.warn}` }}>Não foi possível carregar os produtos: {erro}</div>}

      {!carregando && !erro && resp && linhas.length === 0 && (
        <div style={card}>Sem venda de produtos no período.</div>
      )}

      {!carregando && !erro && linhas.length > 0 && (
        <section style={card} aria-label="Produtos">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: 'left' }}>Produto</th>
                  <th style={{ ...th, textAlign: 'left' }}>Situação<AjudaCampo chave="com.painel.analise" rota={ROTA} /></th>
                  <th style={th}>Faturamento<AjudaCampo chave="com.painel.faturado" rota={ROTA} /></th>
                  <th style={th}>Participação<AjudaCampo chave="com.painel.participacao" rota={ROTA} /></th>
                  <th style={th}>Volume<AjudaCampo chave="com.painel.volume" rota={ROTA} /></th>
                  <th style={th}>R$/kg<AjudaCampo chave="com.painel.rpkg" rota={ROTA} /></th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => {
                  const rpkg = l.kg ? l.valor_total / l.kg : null
                  const part = total ? 100 * l.valor_total / total : 0
                  const st = STATUS[l.status] ?? { rot: l.status, cor: C.m }
                  return (
                    <tr key={l.cod_produto}>
                      <td style={{ ...td, textAlign: 'left', whiteSpace: 'normal' }}>
                        {cap(l.desc_produto)}
                        <div style={{ fontSize: 11, color: C.m }}>cód. {l.cod_produto}</div>
                      </td>
                      <td style={{ ...td, textAlign: 'left' }}>
                        <span style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 999, fontSize: 11, color: '#fff', background: st.cor }}>{st.rot}</span>
                      </td>
                      <td style={td}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-end' }}>
                          <span>{brl0(l.valor_total)}</span>
                          <i style={{ display: 'block', width: `${Math.max(4, 100 * l.valor_total / maxFat)}%`, height: 5, borderRadius: 3, background: `linear-gradient(90deg, ${C.gold2}, ${C.gold})` }} />
                        </div>
                      </td>
                      <td style={td}>{pct(part)}</td>
                      <td style={td}>{kg0(l.kg)}</td>
                      <td style={td}>{brl2(rpkg)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 12, color: C.m }}>{int(linhas.length)} produtos no período · faturamento total {brl0(total)}. Sem margem: o custo do ERP de origem vem zerado — não inventamos número.</div>
        </section>
      )}
    </section>
  )
}

export default AbaProdutos
