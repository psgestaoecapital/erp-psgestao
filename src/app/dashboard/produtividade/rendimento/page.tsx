'use client'
// Rendimentos (padrão × real) — CEO 11/12, custeio por kg · fatia F5 (RD-102). Por produto de ORIGEM, cada saída
// (corte, osso, sebo, aparas) com o rendimento PADRÃO % (prod_estrutura, editado na raia do Mapa) comparado com o
// REAL % do período (produção apontada: apontamento próprio, importação por planilha ou conector). Mostra a
// diferença em kg e em R$ (preço de referência) e avisa quando as saídas de uma origem não somam ~100%. Genérico
// para qualquer indústria/planta. Segue o padrão das telas industriais (paleta plana, useCompanyIds, RPC {ok,erro},
// RD-95 "?" em todo campo/indicador, mobile 390px). Não edita o padrão aqui — o padrão vive no Mapa (Entra/Sai).
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { erroAmigavel } from '@/lib/erroAmigavel'

const ROTA = '/dashboard/produtividade/rendimento'
const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)'
const GREEN = '#166534', GREENBG = '#ECFDF5', RED = '#B42318', REDBG = '#FCEBEB', AMBER = '#92400E', AMBERBG = '#FEF6E7'
const Aj = ({ k }: { k: string }) => <AjudaCampo chave={k} rota={ROTA} />

const brl = (n: number | null | undefined) => n == null ? '—' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const kg = (n: number | null | undefined) => n == null ? '—' : `${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} kg`
const pct = (n: number | null | undefined) => n == null ? '—' : `${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`
const pp = (n: number | null | undefined) => n == null ? '—' : `${n > 0 ? '+' : ''}${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} p.p.`
const primeiroDiaMes = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01` }
const hoje = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const rotuloTipo = (t: string) => t === 'principal' ? 'Principal' : t === 'coproduto' ? 'Coproduto' : t === 'subproduto' ? 'Subproduto' : t

type Plant = { id: string; nome_planta: string }
type Saida = {
  produto_id: string; codigo: string | null; nome: string | null; tipo_saida: string
  padrao_pct: number | null; esperado_kg: number | null; real_kg: number | null; real_pct: number | null
  diff_pct: number | null; diff_kg: number | null; preco_ref: number | null; diff_rs: number | null
}
type Origem = {
  origem_produto_id: string; origem_codigo: string | null; origem_nome: string | null; origem_kg: number | null
  tem_real: boolean; soma_padrao_pct: number | null; soma_real_pct: number | null; soma_fora_100: boolean; saidas: Saida[]
}

const card: React.CSSProperties = { background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 16 }
const inp: React.CSSProperties = { padding: '7px 9px', fontSize: 13, border: `1px solid ${LINE}`, borderRadius: 7, background: '#fff', color: ESP }
const lab: React.CSSProperties = { fontSize: 12, color: MUT, display: 'block', marginBottom: 3 }
const th: React.CSSProperties = { textAlign: 'right', fontSize: 11.5, color: MUT, fontWeight: 600, padding: '6px 8px', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { textAlign: 'right', fontSize: 13, color: ESP, padding: '7px 8px', borderTop: `0.5px solid ${LINE}`, whiteSpace: 'nowrap' }

export default function RendimentoPage() {
  const { selInfo, sel } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && sel ? sel : null

  const [loading, setLoading] = useState(true)
  const [carregandoDados, setCarregandoDados] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [plants, setPlants] = useState<Plant[]>([])
  const [plantId, setPlantId] = useState<string | null>(null)
  const [ini, setIni] = useState<string>(primeiroDiaMes())
  const [fim, setFim] = useState<string>(hoje())
  const [origens, setOrigens] = useState<Origem[] | null>(null)

  // plantas da empresa
  useEffect(() => {
    if (!empresa) { setLoading(false); return }
    void (async () => {
      setLoading(true); setErro(null)
      const { data, error } = await supabase.from('industrial_plants').select('id, nome_planta').eq('company_id', empresa).eq('is_active', true).order('nome_planta')
      if (error) { setErro(erroAmigavel(error, 'Não foi possível carregar as plantas.')); setLoading(false); return }
      const ps = (data ?? []) as Plant[]
      setPlants(ps); setPlantId((p) => p ?? ps[0]?.id ?? null); setLoading(false)
    })()
  }, [empresa])

  const carregar = useCallback(async () => {
    if (!empresa || !plantId) { setOrigens(null); return }
    setCarregandoDados(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_prod_rendimento_comparativo', {
      p_company_id: empresa, p_plant_id: plantId, p_data_ini: ini, p_data_fim: fim,
    })
    setCarregandoDados(false)
    if (error) { setErro(erroAmigavel(error, 'Não foi possível carregar o rendimento. Tente de novo.')); setOrigens(null); return }
    const r = (data ?? {}) as { ok?: boolean; erro?: string; origens?: Origem[] }
    if (!r.ok) { setErro(r.erro === 'periodo_invalido' ? 'Período inválido: a data final não pode ser anterior à inicial.' : 'Não foi possível carregar o rendimento.'); setOrigens(null); return }
    setOrigens(r.origens ?? [])
  }, [empresa, plantId, ini, fim])

  useEffect(() => { void carregar() }, [carregar])

  const totalRs = useMemo(() => {
    if (!origens) return null
    let achou = false, soma = 0
    for (const o of origens) for (const s of o.saidas) if (s.diff_rs != null) { achou = true; soma += s.diff_rs }
    return achou ? soma : null
  }, [origens])

  if (!empresa) return <div style={{ padding: 40, color: MUT, background: BG, minHeight: '100vh' }}>Selecione uma empresa para ver o rendimento.</div>
  if (loading) return <div style={{ padding: 40, color: MUT, background: BG, minHeight: '100vh' }}>Carregando…</div>

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '20px 16px 60px' }}>
      <div style={{ maxWidth: 1040, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: ESP, margin: 0 }}>Rendimentos</h1>
            <div style={{ fontSize: 13, color: MUT, marginTop: 2 }}>Rendimento padrão × real por produto de origem, no período.</div>
          </div>
          <Link href="/dashboard/produtividade/mapa" style={{ fontSize: 12.5, color: ESP, textDecoration: 'none', border: `1px solid ${LINE}`, borderRadius: 8, padding: '7px 12px', background: '#fff' }}>Editar padrão no Mapa →</Link>
        </div>

        {/* Filtros */}
        <div style={{ ...card, marginTop: 14, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ minWidth: 200 }}><span style={lab}>Planta <Aj k="prod.rendimento.planta" /></span>
            <select value={plantId ?? ''} onChange={(e) => setPlantId(e.target.value || null)} style={{ ...inp, width: '100%' }}>
              {plants.length === 0 && <option value="">Nenhuma planta</option>}
              {plants.map((p) => <option key={p.id} value={p.id}>{p.nome_planta}</option>)}
            </select>
          </label>
          <label><span style={lab}>De <Aj k="prod.rendimento.periodo" /></span>
            <input type="date" value={ini} max={fim} onChange={(e) => setIni(e.target.value)} style={inp} />
          </label>
          <label><span style={lab}>Até</span>
            <input type="date" value={fim} min={ini} onChange={(e) => setFim(e.target.value)} style={inp} />
          </label>
          {totalRs != null && (
            <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
              <div style={{ fontSize: 12, color: MUT }}>Impacto total no período <Aj k="prod.rendimento.diff_rs" /></div>
              <div style={{ fontSize: 18, fontWeight: 800, color: totalRs >= 0 ? GREEN : RED }}>{totalRs >= 0 ? '+' : ''}{brl(totalRs)}</div>
            </div>
          )}
        </div>

        {erro && <div style={{ ...card, marginTop: 14, background: REDBG, borderColor: '#F3C7C2', color: RED }}>{erro}</div>}

        {carregandoDados && <div style={{ color: MUT, marginTop: 16, fontSize: 13 }}>Carregando rendimento…</div>}

        {/* Vazio: sem estrutura cadastrada */}
        {!carregandoDados && origens && origens.length === 0 && (
          <div style={{ ...card, marginTop: 14, textAlign: 'center', padding: '34px 16px' }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: ESP }}>Nenhuma estrutura de rendimento cadastrada nesta planta</div>
            <div style={{ fontSize: 13, color: MUT, margin: '8px auto 16px', maxWidth: 460 }}>O rendimento padrão (o que entra e o que sai de cada origem) é montado na raia do Mapa do fluxo. Cadastre lá e volte para comparar com o real.</div>
            <Link href="/dashboard/produtividade/mapa" style={{ display: 'inline-block', background: GOLD, color: '#fff', fontWeight: 700, fontSize: 13, padding: '9px 16px', borderRadius: 8, textDecoration: 'none' }}>Abrir o Mapa do fluxo</Link>
          </div>
        )}

        {/* Cards por origem */}
        {!carregandoDados && origens && origens.map((o) => (
          <div key={o.origem_produto_id} style={{ ...card, marginTop: 14, padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '13px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, borderBottom: `0.5px solid ${LINE}` }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 800, color: ESP }}>
                  {o.origem_codigo ? `${o.origem_codigo} · ` : ''}{o.origem_nome ?? 'Origem'} <Aj k="prod.rendimento.origem" />
                </div>
                <div style={{ fontSize: 12.5, color: MUT, marginTop: 2 }}>
                  {o.tem_real ? <>Processado no período: <b style={{ color: ESP }}>{kg(o.origem_kg)}</b> <Aj k="prod.rendimento.origem_kg" /></> : <>Sem produção apontada no período para esta origem <Aj k="prod.rendimento.origem_kg" /></>}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 11.5, color: MUT }}>Soma das saídas (padrão) <Aj k="prod.rendimento.soma" /></div>
                <div style={{ fontSize: 15, fontWeight: 800, color: o.soma_fora_100 ? AMBER : GREEN }}>{pct(o.soma_padrao_pct)}</div>
              </div>
            </div>

            {o.soma_fora_100 && (
              <div style={{ background: AMBERBG, color: AMBER, fontSize: 12.5, padding: '8px 16px', borderBottom: `0.5px solid ${LINE}` }}>
                As saídas desta origem somam {pct(o.soma_padrao_pct)} (o ideal é perto de 100%). {o.soma_padrao_pct != null && o.soma_padrao_pct < 97 ? 'Pode haver saídas faltando no cadastro do Mapa.' : 'A soma passou de 100% — revise os rendimentos.'}
              </div>
            )}

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
                <thead>
                  <tr style={{ background: '#FBF8F3' }}>
                    <th style={{ ...th, textAlign: 'left' }}>Saída</th>
                    <th style={th}>Tipo <Aj k="prod.rendimento.tipo_saida" /></th>
                    <th style={th}>Padrão <Aj k="prod.rendimento.padrao_pct" /></th>
                    <th style={th}>Real <Aj k="prod.rendimento.real_pct" /></th>
                    <th style={th}>Dif. <Aj k="prod.rendimento.diff_pct" /></th>
                    <th style={th}>Dif. kg <Aj k="prod.rendimento.diff_kg" /></th>
                    <th style={th}>Dif. R$ <Aj k="prod.rendimento.diff_rs" /></th>
                  </tr>
                </thead>
                <tbody>
                  {o.saidas.map((s) => {
                    const neg = s.diff_kg != null && s.diff_kg < 0
                    const pos = s.diff_kg != null && s.diff_kg > 0
                    return (
                      <tr key={s.produto_id}>
                        <td style={{ ...td, textAlign: 'left' }}>{s.codigo ? `${s.codigo} · ` : ''}{s.nome ?? 'Saída'}</td>
                        <td style={td}>{rotuloTipo(s.tipo_saida)}</td>
                        <td style={td}>{pct(s.padrao_pct)}</td>
                        <td style={td}>{o.tem_real ? pct(s.real_pct) : '—'}</td>
                        <td style={{ ...td, color: !o.tem_real || s.diff_pct == null ? MUT : neg ? RED : pos ? GREEN : ESP }}>{o.tem_real ? pp(s.diff_pct) : '—'}</td>
                        <td style={{ ...td, color: !o.tem_real || s.diff_kg == null ? MUT : neg ? RED : pos ? GREEN : ESP }}>{o.tem_real && s.diff_kg != null ? `${s.diff_kg > 0 ? '+' : ''}${kg(s.diff_kg)}` : '—'}</td>
                        <td style={{ ...td, fontWeight: 600, color: !o.tem_real || s.diff_rs == null ? MUT : neg ? RED : pos ? GREEN : ESP }}>{o.tem_real && s.diff_rs != null ? `${s.diff_rs > 0 ? '+' : ''}${brl(s.diff_rs)}` : (s.preco_ref == null && o.tem_real ? 'sem preço' : '—')}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {!o.tem_real && (
              <div style={{ fontSize: 12.5, color: MUT, padding: '10px 16px', borderTop: `0.5px solid ${LINE}` }}>
                Sem produção apontada no período — a comparação com o real aparece quando houver apontamento, importação por planilha ou conector de produção. O padrão acima continua valendo como referência.
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
