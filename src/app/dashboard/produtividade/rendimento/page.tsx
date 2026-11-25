'use client'
// Rendimento por ORIGEM e por CORTE, calculado pelo MIX de entrada (decisão do CEO 25/11 · tela 60). O rendimento
// padrão é PRÓPRIO de cada par origem→corte (ex.: bola 283 → coxão mole X%, bola 284 → coxão mole Y%). O esperado de
// cada corte é a soma ponderada das origens que de fato entraram (fn_prod_rendimento_mix); o real é UM número só (nunca
// o corte em dobro). Mostra a matriz Origem × corte (padrão % editável no lugar), o comparativo esperado × real por
// corte com a fonte do dado, a eficiência por dia e a sugestão de padrão pelo histórico (regressão). Genérico para
// qualquer indústria/planta. RD-95 "?" em todo campo/coluna/ação; RD-100 "sistema vinculado", nunca o fornecedor.
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer, CartesianGrid } from 'recharts'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { CelulaEditavel } from '@/components/produtividade/CelulaEditavel'
import { erroAmigavel } from '@/lib/erroAmigavel'
import { parseNumBR } from '@/lib/num'

const ROTA = '/dashboard/produtividade/rendimento'
const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)'
const GREEN = '#166534', RED = '#B42318', REDBG = '#FCEBEB', AMBER = '#92400E', AMBERBG = '#FEF6E7'
const Aj = ({ k }: { k: string }) => <AjudaCampo chave={k} rota={ROTA} />

const brl = (n: number | null | undefined) => n == null ? '—' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const kg = (n: number | null | undefined) => n == null ? '—' : `${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} kg`
const pct = (n: number | null | undefined) => n == null ? '—' : `${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`
const primeiroDiaMes = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01` }
const hoje = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const rotuloFonte = (f: string | null) => f === 'sistema_vinculado' ? 'sistema vinculado' : f === 'apontamento' ? 'apontamento' : '—'

type Plant = { id: string; nome_planta: string }
type Fluxo = { id: string; nome: string }
type OrigemCell = { origem_produto_id: string; origem_codigo: string | null; origem_nome: string | null; estrutura_id: string; kg_entrada: number | null; padrao_pct: number | null; esperado_kg: number | null; fonte_entrada: string | null }
type Corte = { corte_produto_id: string; codigo: string | null; nome: string | null; preco_ref: number | null; esperado_kg: number | null; real_kg: number | null; fonte: string | null; eficiencia_pct: number | null; dif_kg: number | null; dif_rs: number | null; status: string; origens: OrigemCell[] }
type OrigemAgg = { origem_produto_id: string; codigo: string | null; nome: string | null; kg_entrada: number | null; fonte: string | null; soma_padrao_pct: number | null; soma_fora: boolean; real_total_saida: number | null }
type SeriePt = { dia: string; esperado_kg: number | null; real_kg: number | null; eficiencia_pct: number | null }
type MixResp = { ok?: boolean; erro?: string; cortes?: Corte[]; origens?: OrigemAgg[]; serie?: SeriePt[] | null }

type SugOrigem = { origem_produto_id: string; origem_codigo: string | null; origem_nome: string | null; corte_codigo: string | null; corte_nome: string | null; dias: number; pct_atual: number | null; resultado: string; pct_sugerido: number | null; r2: number | null }
type SugCorte = { corte_produto_id: string; corte_codigo: string | null; corte_nome: string | null; n_origens: number; status: string; origens: SugOrigem[] }

const card: React.CSSProperties = { background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 16 }
const inp: React.CSSProperties = { padding: '7px 9px', fontSize: 13, border: `1px solid ${LINE}`, borderRadius: 7, background: '#fff', color: ESP }
const lab: React.CSSProperties = { fontSize: 12, color: MUT, display: 'block', marginBottom: 3 }
const th: React.CSSProperties = { textAlign: 'right', fontSize: 11.5, color: MUT, fontWeight: 600, padding: '7px 9px', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { textAlign: 'right', fontSize: 13, color: ESP, padding: '8px 9px', borderTop: `0.5px solid ${LINE}`, whiteSpace: 'nowrap' }

export default function RendimentoPage() {
  const { selInfo, sel } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && sel ? sel : null

  const [loading, setLoading] = useState(true)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [plants, setPlants] = useState<Plant[]>([])
  const [plantId, setPlantId] = useState<string | null>(null)
  const [fluxos, setFluxos] = useState<Fluxo[]>([])
  const [fluxoId, setFluxoId] = useState<string>('')
  const [ini, setIni] = useState<string>(primeiroDiaMes())
  const [fim, setFim] = useState<string>(hoje())
  const [data, setData] = useState<MixResp | null>(null)
  const [sugAberto, setSugAberto] = useState(false)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!empresa) { setLoading(false); return }
    void (async () => {
      setLoading(true); setErro(null)
      const { data: ps, error } = await supabase.from('industrial_plants').select('id, nome_planta').eq('company_id', empresa).eq('is_active', true).order('nome_planta')
      if (error) { setErro(erroAmigavel(error, 'Não foi possível carregar as plantas.')); setLoading(false); return }
      const lst = (ps ?? []) as Plant[]
      setPlants(lst); setPlantId((p) => p ?? lst[0]?.id ?? null); setLoading(false)
    })()
  }, [empresa])

  // raias (fluxos) da planta
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!empresa || !plantId) { setFluxos([]); return }
    void (async () => {
      const { data: fs } = await supabase.from('prod_fluxo').select('id, nome').eq('company_id', empresa).eq('plant_id', plantId).eq('ativo', true).is('deleted_at', null).order('ordem')
      setFluxos((fs ?? []) as Fluxo[])
    })()
  }, [empresa, plantId])

  const carregar = useCallback(async () => {
    if (!empresa || !plantId) { setData(null); return }
    setCarregando(true); setErro(null)
    const { data: r, error } = await supabase.rpc('fn_prod_rendimento_mix', {
      p_company_id: empresa, p_plant_id: plantId, p_data_ini: ini, p_data_fim: fim, p_fluxo_id: fluxoId || null, p_por_dia: true,
    })
    setCarregando(false)
    if (error) { setErro(erroAmigavel(error, 'Não foi possível carregar o rendimento. Tente de novo.')); setData(null); return }
    const resp = (r ?? {}) as MixResp
    if (!resp.ok) {
      setErro(resp.erro === 'periodo_maximo' ? 'O período não pode passar de 120 dias.' : resp.erro === 'periodo_invalido' ? 'Período inválido: a data final não pode ser anterior à inicial.' : 'Não foi possível carregar o rendimento.')
      setData(null); return
    }
    setData(resp)
  }, [empresa, plantId, ini, fim, fluxoId])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  async function salvarCelula(estruturaId: string, texto: string): Promise<string | null> {
    if (!empresa || !plantId) return 'Selecione empresa e planta.'
    const t = texto.trim()
    const n = t === '' ? null : parseNumBR(t)
    if (t !== '' && (n == null || n <= 0 || n > 100)) return 'Informe um percentual entre 0 e 100 (ex.: 28,5) ou deixe em branco.'
    const { data: r, error } = await supabase.rpc('fn_prod_estrutura_pct', { p_company_id: empresa, p_plant_id: plantId, p_id: estruturaId, p_rendimento_pct: n, p_fonte_padrao: null })
    if (error) return erroAmigavel(error, 'Não consegui salvar o padrão. Tente de novo.')
    if (!(r as { ok?: boolean })?.ok) return 'Não consegui salvar o padrão. Tente de novo.'
    await carregar(); return null
  }

  const cortes = data?.cortes ?? []
  const origens = data?.origens ?? []
  const serie = (data?.serie ?? []).map((s) => ({ ...s, dlabel: s.dia.slice(8, 10) + '/' + s.dia.slice(5, 7) }))
  const temAlgumReal = cortes.some((c) => c.real_kg != null)

  const totalRs = useMemo(() => {
    let achou = false, soma = 0
    for (const c of (data?.cortes ?? [])) if (c.dif_rs != null) { achou = true; soma += c.dif_rs }
    return achou ? soma : null
  }, [data])

  // célula (origem × corte) → { estrutura_id, padrao_pct }
  const celula = useCallback((origemId: string, corte: Corte): OrigemCell | undefined => corte.origens.find((o) => o.origem_produto_id === origemId), [])

  if (!empresa) return <div style={{ padding: 40, color: MUT, background: BG, minHeight: '100vh' }}>Selecione uma empresa para ver o rendimento.</div>
  if (loading) return <div style={{ padding: 40, color: MUT, background: BG, minHeight: '100vh' }}>Carregando…</div>

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '20px 16px 60px' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700 }}>Indústria · Produtividade</div>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: ESP, margin: '2px 0 0' }}>Rendimento por origem e por corte</h1>
            <div style={{ fontSize: 13, color: MUT, marginTop: 2 }}>O esperado de cada corte sai do mix de entrada que de fato aconteceu; o real é um número só.</div>
          </div>
          <Link href="/dashboard/produtividade/mapa" style={{ fontSize: 12.5, color: ESP, textDecoration: 'none', border: `1px solid ${LINE}`, borderRadius: 8, padding: '7px 12px', background: '#fff' }}>Adicionar origens/cortes no Mapa →</Link>
        </div>

        {/* Filtros */}
        <div style={{ ...card, marginTop: 14, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label data-ajuda="prod.rendimento.planta" style={{ minWidth: 190 }}><span style={lab}>Planta <Aj k="prod.rendimento.planta" /></span>
            <select value={plantId ?? ''} onChange={(e) => setPlantId(e.target.value || null)} style={{ ...inp, width: '100%' }} data-testid="rend-planta">
              {plants.length === 0 && <option value="">Nenhuma planta</option>}
              {plants.map((p) => <option key={p.id} value={p.id}>{p.nome_planta}</option>)}
            </select>
          </label>
          <label data-ajuda="prod.rendimento.raia" style={{ minWidth: 170 }}><span style={lab}>Raia (fluxo) <Aj k="prod.rendimento.raia" /></span>
            <select value={fluxoId} onChange={(e) => setFluxoId(e.target.value)} style={{ ...inp, width: '100%' }} data-testid="rend-raia">
              <option value="">Todas as raias</option>
              {fluxos.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
            </select>
          </label>
          <label data-ajuda="prod.rendimento.periodo"><span style={lab}>De <Aj k="prod.rendimento.periodo" /></span>
            <input type="date" value={ini} max={fim} onChange={(e) => setIni(e.target.value)} style={inp} data-testid="rend-de" />
          </label>
          <label data-ajuda="prod.rendimento.periodo"><span style={lab}>Até</span>
            <input type="date" value={fim} min={ini} onChange={(e) => setFim(e.target.value)} style={inp} data-testid="rend-ate" />
          </label>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <button type="button" onClick={() => setSugAberto(true)} data-testid="rend-sugerir" style={{ background: GOLD, color: '#fff', fontWeight: 700, fontSize: 12.5, padding: '8px 13px', borderRadius: 8, border: 'none', cursor: 'pointer' }}>Sugerir pelo histórico</button>
            <Aj k="prod.rendimento.sugerir" />
          </span>
          {totalRs != null && (
            <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
              <div style={{ fontSize: 12, color: MUT }}>Impacto total no período <Aj k="prod.rendimento.diff_rs" /></div>
              <div style={{ fontSize: 18, fontWeight: 800, color: totalRs >= 0 ? GREEN : RED }}>{totalRs >= 0 ? '+' : ''}{brl(totalRs)}</div>
            </div>
          )}
        </div>

        {erro && <div style={{ ...card, marginTop: 14, background: REDBG, borderColor: '#F3C7C2', color: RED }}>{erro}</div>}
        {carregando && <div style={{ color: MUT, marginTop: 16, fontSize: 13 }}>Carregando rendimento…</div>}

        {!carregando && data && cortes.length === 0 && origens.length === 0 && (
          <div style={{ ...card, marginTop: 14, textAlign: 'center', padding: '34px 16px' }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: ESP }}>Nenhuma origem e corte cadastrados nesta planta</div>
            <div style={{ fontSize: 13, color: MUT, margin: '8px auto 16px', maxWidth: 480 }}>Monte as ligações origem→corte na raia do Mapa do fluxo, ou use “Sugerir pelo histórico” para partir do que o sistema vinculado já registrou.</div>
            <Link href="/dashboard/produtividade/mapa" style={{ display: 'inline-block', background: GOLD, color: '#fff', fontWeight: 700, fontSize: 13, padding: '9px 16px', borderRadius: 8, textDecoration: 'none' }}>Abrir o Mapa do fluxo</Link>
          </div>
        )}

        {!carregando && data && (cortes.length > 0 || origens.length > 0) && (
          <>
            {/* Matriz Origem × corte (padrão % editável) */}
            <div style={{ ...card, marginTop: 14, padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '12px 16px', borderBottom: `0.5px solid ${LINE}`, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 15, fontWeight: 800, color: ESP }}>Origem × corte — padrão (%)</span><Aj k="prod.rendimento.matriz" />
                <span style={{ fontSize: 12, color: MUT, marginLeft: 8 }}>clique numa célula para ajustar o padrão</span>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', minWidth: 640 }}>
                  <thead>
                    <tr style={{ background: '#FBF8F3' }}>
                      <th style={{ ...th, textAlign: 'left', position: 'sticky', left: 0, background: '#FBF8F3' }}>Origem \ Corte <Aj k="prod.rendimento.matriz_celula" /></th>
                      {cortes.map((c) => <th key={c.corte_produto_id} style={th}>{c.codigo ? `${c.codigo}` : ''}<div style={{ fontWeight: 400, color: MUT, maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.nome}</div></th>)}
                      <th style={th}>Soma <Aj k="prod.rendimento.soma" /></th>
                    </tr>
                  </thead>
                  <tbody>
                    {origens.map((o) => (
                      <tr key={o.origem_produto_id}>
                        <td style={{ ...td, textAlign: 'left', position: 'sticky', left: 0, background: '#fff', fontWeight: 600 }}>
                          {o.codigo ? `${o.codigo} · ` : ''}{o.nome ?? 'Origem'}
                          <div style={{ fontWeight: 400, fontSize: 11.5, color: MUT }}>entrada {kg(o.kg_entrada)}{o.fonte ? ` · ${rotuloFonte(o.fonte)}` : ''}</div>
                        </td>
                        {cortes.map((c) => {
                          const cel = celula(o.origem_produto_id, c)
                          return (
                            <td key={c.corte_produto_id} style={{ ...td, textAlign: 'center' }} data-ajuda="prod.rendimento.matriz_celula">
                              {cel ? (
                                <CelulaEditavel testid={`rend-cel-${o.codigo}-${c.codigo}`} tipo="numero" valor={cel.padrao_pct != null ? String(cel.padrao_pct) : ''} vazio="— definir"
                                  rotuloValor={(v) => `${v}%`} onSalvar={(v) => salvarCelula(cel.estrutura_id, v)} largura={70} />
                              ) : <span style={{ color: MUT }}>—</span>}
                            </td>
                          )
                        })}
                        <td style={{ ...td, fontWeight: 700, color: o.soma_fora ? AMBER : GREEN }}>{pct(o.soma_padrao_pct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {origens.some((o) => o.soma_fora) && (
                <div style={{ background: AMBERBG, color: AMBER, fontSize: 12.5, padding: '8px 16px', borderTop: `0.5px solid ${LINE}` }}>
                  Uma ou mais origens têm a soma dos cortes fora de 97–103%. Revise os padrões ou cadastre as saídas que faltam no Mapa.
                </div>
              )}
            </div>

            {/* Esperado × real por corte */}
            <div style={{ ...card, marginTop: 14, padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '12px 16px', borderBottom: `0.5px solid ${LINE}`, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 15, fontWeight: 800, color: ESP }}>Esperado × real por corte</span><Aj k="prod.rendimento.esperado_kg" />
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
                  <thead>
                    <tr style={{ background: '#FBF8F3' }}>
                      <th style={{ ...th, textAlign: 'left' }}>Corte</th>
                      <th style={th}>Esperado <Aj k="prod.rendimento.esperado_kg" /></th>
                      <th style={th}>Real <Aj k="prod.rendimento.real_kg" /></th>
                      <th style={th}>Eficiência <Aj k="prod.rendimento.eficiencia" /></th>
                      <th style={th}>Dif. kg <Aj k="prod.rendimento.diff_kg" /></th>
                      <th style={th}>Dif. R$ <Aj k="prod.rendimento.diff_rs" /></th>
                      <th style={th}>Fonte <Aj k="prod.rendimento.fonte" /></th>
                    </tr>
                  </thead>
                  <tbody>
                    {cortes.map((c) => {
                      const neg = c.dif_kg != null && c.dif_kg < 0, pos = c.dif_kg != null && c.dif_kg > 0
                      return (
                        <tr key={c.corte_produto_id}>
                          <td style={{ ...td, textAlign: 'left' }}>
                            {c.codigo ? `${c.codigo} · ` : ''}{c.nome ?? 'Corte'}
                            {c.status === 'sem_padrao' && <span style={{ marginLeft: 6, fontSize: 11, color: AMBER, background: AMBERBG, padding: '1px 6px', borderRadius: 10 }}>sem padrão</span>}
                          </td>
                          <td style={td}>{kg(c.esperado_kg)}</td>
                          <td style={td}>{kg(c.real_kg)}</td>
                          <td style={{ ...td, fontWeight: 600, color: c.eficiencia_pct == null ? MUT : c.eficiencia_pct >= 100 ? GREEN : RED }}>{pct(c.eficiencia_pct)}</td>
                          <td style={{ ...td, color: c.dif_kg == null ? MUT : neg ? RED : pos ? GREEN : ESP }}>{c.dif_kg != null ? `${c.dif_kg > 0 ? '+' : ''}${kg(c.dif_kg)}` : '—'}</td>
                          <td style={{ ...td, fontWeight: 600, color: c.dif_rs == null ? MUT : neg ? RED : pos ? GREEN : ESP }}>{c.dif_rs != null ? `${c.dif_rs > 0 ? '+' : ''}${brl(c.dif_rs)}` : (c.preco_ref == null ? 'sem preço' : '—')}</td>
                          <td style={{ ...td, color: MUT, fontSize: 12 }}>{rotuloFonte(c.fonte)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {!temAlgumReal && (
                <div style={{ fontSize: 12.5, color: MUT, padding: '10px 16px', borderTop: `0.5px solid ${LINE}` }}>
                  Sem produção no período — a comparação com o real aparece quando houver dado do sistema vinculado ou apontamento. Os padrões acima continuam valendo como referência.
                </div>
              )}
            </div>

            {/* Eficiência por dia */}
            {serie.length > 0 && (
              <div style={{ ...card, marginTop: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <span style={{ fontSize: 15, fontWeight: 800, color: ESP }}>Eficiência por dia</span><Aj k="prod.rendimento.grafico_dia" />
                </div>
                <div style={{ width: '100%', height: 240 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={serie} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke={LINE} strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="dlabel" tick={{ fontSize: 11, fill: MUT }} />
                      <YAxis tick={{ fontSize: 11, fill: MUT }} unit="%" width={48} />
                      <Tooltip formatter={(value) => pct(Number(value))} labelStyle={{ color: ESP }} />
                      <ReferenceLine y={100} stroke={GREEN} strokeDasharray="4 4" />
                      <Line type="monotone" dataKey="eficiencia_pct" name="Eficiência" stroke={GOLD} strokeWidth={2} dot={{ r: 2 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {sugAberto && empresa && plantId && (
        <SugerirModal companyId={empresa} plantId={plantId} cortes={cortes} onFechar={() => setSugAberto(false)} onAplicou={() => { void carregar() }} />
      )}
    </div>
  )
}

// ─────────── Sugerir pelo histórico ───────────
function SugerirModal({ companyId, plantId, cortes, onFechar, onAplicou }: {
  companyId: string; plantId: string; cortes: Corte[]; onFechar: () => void; onAplicou: () => void
}) {
  const [dias, setDias] = useState(60)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [cs, setCs] = useState<SugCorte[]>([])
  const [aplicando, setAplicando] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  // (origem,corte) → estrutura_id, pela matriz já carregada
  const estruturaDe = useCallback((origemId: string, corteId: string): string | undefined => {
    const c = cortes.find((x) => x.corte_produto_id === corteId)
    return c?.origens.find((o) => o.origem_produto_id === origemId)?.estrutura_id
  }, [cortes])

  const carregar = useCallback(async () => {
    setCarregando(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_prod_rendimento_sugerir', { p_company_id: companyId, p_plant_id: plantId, p_dias: dias })
    setCarregando(false)
    if (error) { setErro(erroAmigavel(error, 'Não foi possível calcular as sugestões.')); return }
    const r = (data ?? {}) as { ok?: boolean; cortes?: SugCorte[] }
    if (!r.ok) { setErro('Não foi possível calcular as sugestões.'); return }
    setCs(r.cortes ?? [])
  }, [companyId, plantId, dias])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  async function aprovar(s: SugOrigem, corteId: string, valorTexto: string) {
    const estruturaId = estruturaDe(s.origem_produto_id, corteId)
    if (!estruturaId) { setErro('Essa ligação ainda não existe no cadastro — crie origem→corte no Mapa antes de aprovar.'); return }
    const n = parseNumBR(valorTexto.trim())
    if (n == null || n <= 0 || n > 100) { setErro('Informe um percentual entre 0 e 100.'); return }
    setAplicando(estruturaId); setErro(null); setMsg(null)
    const { data, error } = await supabase.rpc('fn_prod_estrutura_pct', { p_company_id: companyId, p_plant_id: plantId, p_id: estruturaId, p_rendimento_pct: n, p_fonte_padrao: 'historico_aprovado' })
    setAplicando(null)
    if (error) { setErro(erroAmigavel(error, 'Não consegui aprovar. Tente de novo.')); return }
    if (!(data as { ok?: boolean })?.ok) { setErro('Não consegui aprovar. Tente de novo.'); return }
    setMsg(`Padrão de ${s.origem_codigo} → ${s.corte_codigo} atualizado para ${n.toLocaleString('pt-BR')}%.`)
    onAplicou()
  }

  return (
    <div onClick={onFechar} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 80, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '28px 16px', overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, padding: 18, width: 'min(760px,100%)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: ESP, display: 'inline-flex', alignItems: 'center', gap: 5 }}>Sugerir padrão pelo histórico<Aj k="prod.rendimento.sugerir" /></div>
          <button onClick={onFechar} style={{ border: 'none', background: 'none', color: MUT, cursor: 'pointer', fontSize: 22, lineHeight: 1 }}>×</button>
        </div>
        <div style={{ fontSize: 12.5, color: MUT, margin: '2px 0 12px' }}>A partir do que o sistema vinculado registrou, o sistema estima o rendimento de cada origem (regressão). Reveja a confiança (R²) e aprove ou ajuste.</div>
        <label data-ajuda="prod.rendimento.sugerir" style={{ fontSize: 12, color: MUT, display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
          Dias de histórico<Aj k="prod.rendimento.sugerir" />
          <select value={dias} onChange={(e) => setDias(Number(e.target.value))} style={{ ...inp, width: 'auto' }} data-testid="sug-dias">
            {[30, 45, 60, 90, 120].map((d) => <option key={d} value={d}>{d} dias</option>)}
          </select>
        </label>
        {msg && <div style={{ background: '#ECFDF5', color: GREEN, padding: '8px 11px', borderRadius: 7, fontSize: 12.5, marginBottom: 10 }}>{msg}</div>}
        {erro && <div style={{ background: REDBG, color: RED, padding: '8px 11px', borderRadius: 7, fontSize: 12.5, marginBottom: 10 }}>{erro}</div>}
        {carregando ? <div style={{ color: MUT, fontSize: 13, padding: 10 }}>Calculando sugestões…</div>
          : cs.length === 0 ? <div style={{ color: MUT, fontSize: 13, padding: 10 }}>Nenhum corte com ligação cadastrada. Crie origem→corte no Mapa primeiro.</div>
          : cs.map((c) => (
            <div key={c.corte_produto_id} style={{ border: `0.5px solid ${LINE}`, borderRadius: 10, marginBottom: 10, overflow: 'hidden' }}>
              <div style={{ background: '#FBF8F3', padding: '8px 12px', fontWeight: 700, fontSize: 13.5, color: ESP }}>
                {c.corte_codigo ? `${c.corte_codigo} · ` : ''}{c.corte_nome}
                {c.status === 'muitas_origens' && <span style={{ marginLeft: 8, fontSize: 11.5, color: MUT, fontWeight: 400 }}>3+ origens — sem sugestão automática (ajuste no Mapa)</span>}
              </div>
              {c.origens.length > 0 && (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr style={{ color: MUT }}>
                    <th style={{ ...th, textAlign: 'left' }}>Origem</th><th style={th}>Atual</th><th style={th}>Sugerido</th>
                    <th style={th}>R² <Aj k="prod.rendimento.sugerir_r2" /></th><th style={th}>Dias</th><th style={{ ...th, textAlign: 'center' }}>Aprovar <Aj k="prod.rendimento.aprovar" /></th>
                  </tr></thead>
                  <tbody>
                    {c.origens.map((s) => <LinhaSug key={s.origem_produto_id} s={s} corteId={c.corte_produto_id} aplicando={aplicando} onAprovar={aprovar} />)}
                  </tbody>
                </table>
              )}
            </div>
          ))}
      </div>
    </div>
  )
}

function LinhaSug({ s, corteId, aplicando, onAprovar }: { s: SugOrigem; corteId: string; aplicando: string | null; onAprovar: (s: SugOrigem, corteId: string, v: string) => void }) {
  const confiavel = s.resultado === 'ok' && s.pct_sugerido != null
  const [valor, setValor] = useState(s.pct_sugerido != null ? String(s.pct_sugerido).replace('.', ',') : '')
  const motivo = s.resultado === 'colinear' ? 'origens muito parecidas — dado insuficiente'
    : s.resultado === 'nao_confiavel' ? 'resultado fora do esperado — reveja no Mapa'
    : s.resultado === 'sem_dados' ? 'poucos dias com entrada e saída' : null
  return (
    <tr>
      <td style={{ ...td, textAlign: 'left' }}>{s.origem_codigo ? `${s.origem_codigo} · ` : ''}{s.origem_nome}</td>
      <td style={td}>{s.pct_atual != null ? pct(s.pct_atual) : '—'}</td>
      <td style={td}>{confiavel ? pct(s.pct_sugerido) : <span style={{ color: MUT, fontSize: 12 }}>{motivo}</span>}</td>
      <td style={{ ...td, color: s.r2 != null && s.r2 >= 0.7 ? GREEN : AMBER }}>{s.r2 != null ? s.r2.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : '—'}</td>
      <td style={td}>{s.dias}</td>
      <td style={{ ...td, textAlign: 'center' }}>
        {confiavel ? (
          <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }} data-ajuda="prod.rendimento.aprovar">
            <input value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" style={{ ...inp, width: 64, padding: '4px 6px', textAlign: 'right' }} data-testid={`sug-valor-${s.origem_codigo}`} />
            <button type="button" disabled={!!aplicando} onClick={() => onAprovar(s, corteId, valor)} data-testid={`sug-aprovar-${s.origem_codigo}`}
              style={{ background: GOLD, color: '#fff', border: 'none', borderRadius: 7, padding: '5px 10px', fontSize: 12, fontWeight: 700, cursor: aplicando ? 'default' : 'pointer' }}>Aprovar</button>
          </span>
        ) : <span style={{ color: MUT, fontSize: 12 }}>—</span>}
      </td>
    </tr>
  )
}
