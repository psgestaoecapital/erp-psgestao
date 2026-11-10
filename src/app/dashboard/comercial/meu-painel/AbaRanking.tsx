'use client'
// Comercial › Meu painel › aba "Ranking" (classificação de vendedores) — v5.
// Consome a RPC de servidor fn_bi_comercial_ranking_vendedores (agregação pronta no banco, com a MESMA guarda de escopo
// do BI: fn_bi_comercial_scope). Só o líder enxerga a equipe inteira — o vendedor recebe sem_acesso (não vê os colegas),
// e a tela explica isso em linguagem do usuário em vez de mostrar erro cru. Ordena por faturamento, volume ou clientes,
// nos dois sentidos, e mostra a participação de cada vendedor no faturamento do período. Identidade PS. RD-95 · RD-98.
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
const kgf = (v: number | null | undefined) => v == null ? '—' : nf({ maximumFractionDigits: 0 }).format(v) + ' kg'

type Linha = { cod_vend_comp: string; vendedor: string; volume_kg: number; faturamento: number; clientes: number }
type OrdKey = 'faturamento' | 'volume_kg' | 'clientes'
const ORDENS: { k: OrdKey; rot: string }[] = [
  { k: 'faturamento', rot: 'Faturamento' }, { k: 'volume_kg', rot: 'Volume (kg)' }, { k: 'clientes', rot: 'Clientes' },
]

const card: CSSProperties = { background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 14, padding: 16, minWidth: 0, display: 'grid', gap: 10, alignContent: 'start' }
const th: CSSProperties = { position: 'sticky', top: 0, background: '#fff', textAlign: 'right', fontWeight: 600, color: C.m, padding: '8px 10px', borderBottom: `1px solid ${C.bd}`, whiteSpace: 'nowrap', fontSize: 12, zIndex: 1 }
const td: CSSProperties = { textAlign: 'right', padding: '8px 10px', borderBottom: `1px solid ${C.bg2}`, whiteSpace: 'nowrap', fontSize: 13, fontVariantNumeric: 'tabular-nums' }

export function AbaRanking({ empresa, de, ate }: { empresa: string; de: string; ate: string }) {
  const [linhas, setLinhas] = useState<Linha[] | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [semEquipe, setSemEquipe] = useState(false)
  const [ord, setOrd] = useState<OrdKey>('faturamento')
  const [desc, setDesc] = useState(true)

  useEffect(() => {
    let vivo = true
    setCarregando(true); setErro(null); setSemEquipe(false)
    void Promise.resolve(
      supabase.rpc('fn_bi_comercial_ranking_vendedores', { p_company_id: empresa, p_dt_ini: de, p_dt_fim: ate }),
    ).then(({ data, error }) => {
      if (!vivo) return
      setCarregando(false)
      if (error) { setErro(erroAmigavel(error)); setLinhas(null); return }
      const d = data as { ok: boolean; erro?: string; ranking?: Linha[] }
      if (!d?.ok) {
        // O vendedor comum não vê a equipe — não é erro, é escopo. Explica em vez de mostrar erro cru.
        if (d?.erro === 'sem_acesso_comercial') { setSemEquipe(true); setLinhas(null); return }
        setErro(d?.erro ?? 'Não foi possível carregar.'); setLinhas(null); return
      }
      setLinhas((d.ranking ?? []).map((l) => ({
        cod_vend_comp: String(l.cod_vend_comp), vendedor: l.vendedor, volume_kg: Number(l.volume_kg),
        faturamento: Number(l.faturamento), clientes: Number(l.clientes),
      })))
    })
    return () => { vivo = false }
  }, [empresa, de, ate])

  const { ordenadas, total } = useMemo(() => {
    if (!linhas) return { ordenadas: [] as Linha[], total: 0 }
    const t = linhas.reduce((s, l) => s + l.faturamento, 0)
    const ordenadas = [...linhas].sort((a, b) => (desc ? b[ord] - a[ord] : a[ord] - b[ord]))
    return { ordenadas, total: t }
  }, [linhas, ord, desc])

  return (
    <section style={{ display: 'grid', gap: 14 }} aria-label="Ranking de vendedores">
      <div style={{ ...card, gap: 8 }}>
        <div style={{ fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>Ranking de vendedores<AjudaCampo chave="com.painel.equipe" rota={ROTA} /></div>
        <div style={{ fontSize: 12, color: C.m }}>Classificação da equipe no período. Ordene por faturamento, volume ou número de clientes e clique para inverter.</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
          <label style={{ display: 'grid', gap: 2, fontSize: 12, color: C.m, maxWidth: 220 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Ordenar por<AjudaCampo chave="com.painel.posicao" rota={ROTA} /></span>
            <select value={ord} onChange={(e) => setOrd(e.target.value as OrdKey)} aria-label="Critério de ordenação do ranking"
              style={{ font: 'inherit', fontSize: 14, padding: '8px 10px', borderRadius: 10, border: `1px solid ${C.bd}`, background: '#fff', color: C.esp }}>
              {ORDENS.map((o) => <option key={o.k} value={o.k}>{o.rot}</option>)}
            </select>
          </label>
          <button type="button" onClick={() => setDesc((v) => !v)} aria-pressed={desc} aria-label="Inverter a ordem"
            style={{ font: 'inherit', fontSize: 13, padding: '8px 12px', borderRadius: 10, cursor: 'pointer', border: `1px solid ${C.bd}`, background: '#fff', color: C.esp }}>
            {desc ? 'Maior → menor' : 'Menor → maior'}
          </button>
        </div>
      </div>

      {carregando && <div style={card}>Carregando…</div>}
      {erro && <div role="alert" style={{ ...card, borderLeft: `5px solid ${C.warn}` }}>Não foi possível carregar o ranking: {erro}</div>}
      {semEquipe && (
        <div style={{ ...card, borderLeft: `5px solid ${C.azul}` }}>
          Esta aba mostra a equipe inteira e aparece para quem lidera o comercial. No seu acesso de vendedor, use as abas do seu próprio desempenho (Visão geral, Clientes, Produtos).
        </div>
      )}
      {!carregando && !erro && !semEquipe && linhas && linhas.length === 0 && (
        <div style={{ ...card, borderLeft: `5px solid ${C.warn}` }}>Sem venda neste recorte para montar o ranking. Experimente outro período.</div>
      )}

      {!carregando && !erro && !semEquipe && ordenadas.length > 0 && (
        <>
          <div style={{ fontSize: 14, color: C.esp, lineHeight: 1.5, padding: '0 2px' }}>
            <b>Leitura:</b> {ordenadas[0].vendedor} lidera com <b>{brl(ordenadas[0].faturamento)}</b>
            {total > 0 && <> ({pct(100 * ordenadas[0].faturamento / total)} do faturamento do período)</>}. São {int(linhas.length)} vendedores com venda no recorte.
          </div>

          <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
            <div style={{ maxHeight: 560, overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ ...th, textAlign: 'center', width: 44 }}>#</th>
                    <th style={{ ...th, textAlign: 'left' }}>Vendedor<AjudaCampo chave="com.painel.equipe" rota={ROTA} /></th>
                    <th style={th}>Faturamento<AjudaCampo chave="com.painel.faturado" rota={ROTA} /></th>
                    <th style={th}>Participação<AjudaCampo chave="com.painel.participacao" rota={ROTA} /></th>
                    <th style={th}>Volume<AjudaCampo chave="com.painel.volume" rota={ROTA} /></th>
                    <th style={th}>Clientes<AjudaCampo chave="com.painel.clientes" rota={ROTA} /></th>
                  </tr>
                </thead>
                <tbody>
                  {ordenadas.map((l, idx) => (
                    <tr key={l.cod_vend_comp}>
                      <td style={{ ...td, textAlign: 'center', color: C.m }}>{idx + 1}</td>
                      <td style={{ ...td, textAlign: 'left', fontWeight: 500, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.vendedor}</td>
                      <td style={td}>{brl(l.faturamento)}</td>
                      <td style={td}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                          <span style={{ display: 'inline-block', height: 6, width: Math.max(2, Math.min(60, total ? 120 * l.faturamento / total : 0)), borderRadius: 3, background: C.gold }} />
                          {pct(total ? 100 * l.faturamento / total : 0, 1)}
                        </div>
                      </td>
                      <td style={td}>{kgf(l.volume_kg)}</td>
                      <td style={td}>{int(l.clientes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </section>
  )
}

export default AbaRanking
