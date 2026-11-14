'use client'
// Comercial › Meu painel › aba "Ranking" (Ranking de vendedores) — v5.
// Consome a RPC de servidor fn_bi_comercial_ranking_vendedores (agregação pronta no banco, mesma guarda de escopo do BI:
// fn_bi_comercial_scope). É uma visão de LIDERANÇA: só quem vê a empresa toda recebe o ranking; o vendedor recebe um
// aviso amigável (não é erro). Mostra o pódio por faturamento no período, com volume, clientes, R$ por kg e participação.
// Lucro/margem só quando houver custo confiável (a RPC devolve lucro_status) — nada é inventado.
// Identidade PS. RD-95 ("?" em todo indicador) · RD-98 (erro amigável).
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { erroAmigavel } from '@/lib/erroAmigavel'

const C = { esp: '#3D2314', gold: '#C8941A', gold2: '#E0B048', bd: '#E7DED3', m: '#6B5D4F', bg2: '#F0ECE3', verde: '#3f7d4e', azul: '#2f6f8f', warn: '#b07a12' }
const ROTA = '/dashboard/comercial/meu-painel'
const nf = (o: Intl.NumberFormatOptions) => new Intl.NumberFormat('pt-BR', o)
const brl0 = (v: number | null | undefined) => v == null ? '—' : nf({ style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v)
const brl2 = (v: number | null | undefined) => v == null ? '—' : nf({ style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)
const int = (v: number | null | undefined) => v == null ? '—' : nf({ maximumFractionDigits: 0 }).format(v)
const kg0 = (v: number | null | undefined) => v == null ? '—' : nf({ maximumFractionDigits: 0 }).format(v) + ' kg'
const pct = (v: number | null | undefined, d = 1) => v == null ? '—' : nf({ minimumFractionDigits: d, maximumFractionDigits: d }).format(v) + '%'
const cap = (s: string) => (s || '').toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase())

type Linha = { cod_vend_comp: string; vendedor: string; volume_kg: number; faturamento: number; clientes: number; lucro: number | null; margem_pct: number | null }
type Resp = { ok: boolean; erro?: string; ranking?: Linha[]; lucro_status?: string }

const card: CSSProperties = { background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 16, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }
const th: CSSProperties = { position: 'sticky', top: 0, background: '#fff', textAlign: 'right', fontWeight: 600, color: C.m, padding: '8px 10px', borderBottom: `1px solid ${C.bd}`, whiteSpace: 'nowrap', fontSize: 12, zIndex: 1 }
const td: CSSProperties = { textAlign: 'right', padding: '8px 10px', borderBottom: `1px solid ${C.bg2}`, whiteSpace: 'nowrap', fontSize: 13, fontVariantNumeric: 'tabular-nums' }

export function AbaRanking({ empresa, de, ate }: { empresa: string; de: string; ate: string }) {
  const [resp, setResp] = useState<Resp | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [semAcesso, setSemAcesso] = useState(false)

  useEffect(() => {
    let vivo = true
    setCarregando(true); setErro(null); setSemAcesso(false)
    void Promise.resolve(
      supabase.rpc('fn_bi_comercial_ranking_vendedores', { p_company_id: empresa, p_dt_ini: de, p_dt_fim: ate }),
    ).then(({ data, error }) => {
      if (!vivo) return
      setCarregando(false)
      if (error) { setErro(erroAmigavel(error)); setResp(null); return }
      const d = data as Resp
      if (!d?.ok) {
        if (d?.erro === 'sem_acesso_comercial') { setSemAcesso(true); setResp(null); return }
        setErro(d?.erro ?? 'Não foi possível carregar.'); setResp(null); return
      }
      setResp(d)
    })
    return () => { vivo = false }
  }, [empresa, de, ate])

  const linhas = useMemo(() => (resp?.ranking ?? []).slice().sort((a, b) => b.faturamento - a.faturamento), [resp])
  const total = useMemo(() => linhas.reduce((s, l) => s + (l.faturamento || 0), 0), [linhas])
  const maxFat = useMemo(() => Math.max(1, ...linhas.map((l) => l.faturamento || 0)), [linhas])

  return (
    <section style={{ display: 'grid', gap: 14 }} aria-label="Ranking de vendedores">
      <div style={{ ...card, gap: 4 }}>
        <div style={{ fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>Ranking de vendedores<AjudaCampo chave="com.painel.equipe" rota={ROTA} /></div>
        <div style={{ fontSize: 12, color: C.m }}>Pódio por faturamento no período escolhido no topo. Visão de liderança (a empresa toda).</div>
      </div>

      {carregando && <div style={card}>Carregando…</div>}
      {erro && <div role="alert" style={{ ...card, borderLeft: `5px solid ${C.warn}` }}>Não foi possível carregar o ranking: {erro}</div>}
      {semAcesso && (
        <div style={{ ...card, borderLeft: `5px solid ${C.azul}` }}>
          <div style={{ fontSize: 14, color: C.esp }}>O ranking de vendedores é uma visão de liderança. Como vendedor, você vê os seus próprios números nas demais abas (Indicadores, Produtos e Visão geral).</div>
        </div>
      )}

      {!carregando && !erro && !semAcesso && resp && linhas.length === 0 && (
        <div style={card}>Sem venda no período para montar o ranking.</div>
      )}

      {!carregando && !erro && !semAcesso && linhas.length > 0 && (
        <section style={card} aria-label="Pódio de vendedores">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: 'left' }}>#</th>
                  <th style={{ ...th, textAlign: 'left' }}>Vendedor</th>
                  <th style={th}>Faturamento</th>
                  <th style={th}>Participação<AjudaCampo chave="com.painel.participacao" rota={ROTA} /></th>
                  <th style={th}>Clientes<AjudaCampo chave="com.painel.clientes" rota={ROTA} /></th>
                  <th style={th}>Volume<AjudaCampo chave="com.painel.volume" rota={ROTA} /></th>
                  <th style={th}>R$/kg<AjudaCampo chave="com.painel.rpkg" rota={ROTA} /></th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l, i) => {
                  const rpkg = l.volume_kg ? l.faturamento / l.volume_kg : null
                  const part = total ? 100 * l.faturamento / total : 0
                  const medalha = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : String(i + 1)
                  return (
                    <tr key={l.cod_vend_comp}>
                      <td style={{ ...td, textAlign: 'left', fontWeight: 600 }}>{medalha}</td>
                      <td style={{ ...td, textAlign: 'left', whiteSpace: 'normal' }}>
                        {cap(l.vendedor)}
                        {l.vendedor !== l.cod_vend_comp && <div style={{ fontSize: 11, color: C.m }}>cód. {l.cod_vend_comp}</div>}
                      </td>
                      <td style={td}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-end' }}>
                          <span>{brl0(l.faturamento)}</span>
                          <i style={{ display: 'block', width: `${Math.max(4, 100 * l.faturamento / maxFat)}%`, height: 5, borderRadius: 3, background: `linear-gradient(90deg, ${C.gold2}, ${C.gold})` }} />
                        </div>
                      </td>
                      <td style={td}>{pct(part)}</td>
                      <td style={td}>{int(l.clientes)}</td>
                      <td style={td}>{kg0(l.volume_kg)}</td>
                      <td style={td}>{brl2(rpkg)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 12, color: C.m }}>Lucro e margem por vendedor só entram quando houver custo confiável do ERP de origem — não mostramos número estimado.</div>
        </section>
      )}
    </section>
  )
}

export default AbaRanking
