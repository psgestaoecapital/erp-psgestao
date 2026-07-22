'use client'

// Módulo "Custo de Produção" (motor de custo pecuário genérico).
// A fase troca só a UNIDADE de produção (cria=cabeça, recria/engorda/terminação=@).
// Abas: Lançamentos (cadastro + importar do financeiro) · Rateio (memória por UA) ·
// Indicadores (card por lote; sem dado = diz o que falta, RD-51).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useEmpresaSelecionada, usePropriedade } from '@/lib/agro/usePecuaria'

const ESP = '#3D2314'
const BG = '#FAF7F2'
const GOLD = '#C8941A'
const LINE = '#E7DECF'
const ESP60 = 'rgba(61,35,20,0.6)'
const GREEN = '#5C8D3F'

type Aba = 'lancamentos' | 'rateio' | 'indicadores'
type Lote = { id: string; codigo: string; fase: string | null; modo: string | null }
type Lancamento = {
  id: string; lote_id: string | null; tipo_apropriacao: string; categoria: string | null
  descricao: string | null; valor: number; data_competencia: string; meses_diluicao: number
  ciclo_ref: string | null; origem: string
}
type MemoriaLote = { lote_id: string; lote_codigo: string | null; fase: string | null; ua_lote: number; valor_alocado: number; pct_do_total: number }
type RateioResp = { ok: boolean; total_alocado: number; lancamentos_processados: number; animais_afetados: number; memoria: MemoriaLote[] }

const TIPOS = ['direto', 'comum', 'extra'] as const
const CATEGORIAS = ['nutricao', 'sanidade', 'reproducao', 'mao_obra', 'pastagem', 'arrendamento', 'maquinas', 'administrativo', 'outro'] as const

function fmtBRL(n: number | null | undefined): string {
  return Number(n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
function primeiroDiaMes(): string { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01` }
function hoje(): string { return new Date().toISOString().slice(0, 10) }

export default function CustoProducaoPage() {
  const { companyId } = useEmpresaSelecionada()
  const { propriedade } = usePropriedade(companyId)
  const empresaUnica = companyId && !companyId.startsWith('group_') && companyId !== 'consolidado' ? companyId : null

  const [aba, setAba] = useState<Aba>('lancamentos')
  const [lotes, setLotes] = useState<Lote[]>([])
  const [lancs, setLancs] = useState<Lancamento[]>([])
  const [ini, setIni] = useState(primeiroDiaMes())
  const [fim, setFim] = useState(hoje())
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  // form lançamento
  const [fLote, setFLote] = useState<string>('')      // '' = comum
  const [fTipo, setFTipo] = useState<string>('comum')
  const [fCat, setFCat] = useState<string>('nutricao')
  const [fDesc, setFDesc] = useState('')
  const [fValor, setFValor] = useState('')
  const [fComp, setFComp] = useState(hoje())
  const [fDilui, setFDilui] = useState('1')
  const [fCiclo, setFCiclo] = useState('')

  const [rateio, setRateio] = useState<RateioResp | null>(null)
  const [indicadores, setIndicadores] = useState<Record<string, any>>({})

  const loteNome = useCallback((id: string | null) => {
    if (!id) return '— comum (rateável)'
    return lotes.find((l) => l.id === id)?.codigo ?? id.slice(0, 8)
  }, [lotes])

  const carregar = useCallback(async () => {
    if (!empresaUnica) return
    const [lo, la] = await Promise.all([
      supabase.from('erp_pec_lote').select('id,codigo,fase,modo').eq('company_id', empresaUnica).eq('ativo', true).order('codigo'),
      supabase.from('erp_pec_custo_lancamento').select('id,lote_id,tipo_apropriacao,categoria,descricao,valor,data_competencia,meses_diluicao,ciclo_ref,origem').eq('company_id', empresaUnica).order('data_competencia', { ascending: false }).limit(500),
    ])
    setLotes((lo.data ?? []) as Lote[])
    setLancs((la.data ?? []) as Lancamento[])
  }, [empresaUnica])

  useEffect(() => { void carregar() }, [carregar])

  async function salvarLancamento() {
    if (!empresaUnica) return
    const valor = Number(String(fValor).replace(',', '.'))
    if (!valor || valor < 0) { setMsg('Informe um valor válido.'); return }
    setBusy(true); setMsg(null)
    const { error } = await supabase.from('erp_pec_custo_lancamento').insert({
      company_id: empresaUnica,
      propriedade_id: propriedade?.id ?? null,
      lote_id: fTipo === 'comum' ? null : (fLote || null),
      tipo_apropriacao: fTipo,
      categoria: fCat,
      descricao: fDesc || null,
      valor,
      data_competencia: fComp,
      meses_diluicao: Math.max(1, Number(fDilui) || 1),
      ciclo_ref: fCiclo || null,
      origem: 'manual',
    })
    if (error) setMsg('Erro: ' + error.message)
    else { setMsg('Lançamento salvo.'); setFDesc(''); setFValor(''); setFCiclo(''); await carregar() }
    setBusy(false)
  }

  async function importarFinanceiro() {
    if (!empresaUnica) return
    setBusy(true); setMsg(null)
    const { data, error } = await supabase.rpc('fn_pec_custo_importar_do_pagar', { p_company: empresaUnica, p_ini: ini, p_fim: fim })
    if (error) setMsg('Erro ao importar: ' + error.message)
    else { const r = data as any; setMsg(`Importados ${r?.importados ?? 0} lançamento(s) do financeiro (revise o tipo antes de ratear).`); await carregar() }
    setBusy(false)
  }

  async function rodarRateio() {
    if (!empresaUnica) return
    setBusy(true); setMsg(null)
    const { data, error } = await supabase.rpc('fn_pec_custo_ratear', { p_company: empresaUnica, p_ini: ini, p_fim: fim })
    if (error) { setMsg('Erro no rateio: ' + error.message); setRateio(null) }
    else setRateio(data as RateioResp)
    setBusy(false)
  }

  async function carregarIndicadores() {
    if (!empresaUnica) return
    setBusy(true); setMsg(null)
    const entries = await Promise.all(lotes.map(async (l) => {
      const { data } = await supabase.rpc('fn_pec_indicador_custo', { p_company: empresaUnica, p_lote: l.id, p_ini: ini, p_fim: fim })
      return [l.id, data] as const
    }))
    setIndicadores(Object.fromEntries(entries))
    setBusy(false)
  }

  const abaBtn = (a: Aba, label: string) => (
    <button onClick={() => setAba(a)} style={{
      padding: '8px 16px', border: 'none', borderBottom: aba === a ? `2px solid ${GOLD}` : '2px solid transparent',
      background: 'transparent', color: aba === a ? ESP : ESP60, fontWeight: aba === a ? 700 : 500, cursor: 'pointer', fontSize: 14,
    }}>{label}</button>
  )

  if (!empresaUnica) {
    return <div style={{ padding: 24, color: ESP60 }}>Selecione UMA empresa específica para ver o custo de produção.</div>
  }

  return (
    <div style={{ padding: 24, background: BG, minHeight: '100vh', color: ESP }}>
      <div style={{ marginBottom: 4, fontSize: 22, fontWeight: 800 }}>💵 Custo de Produção</div>
      <div style={{ marginBottom: 16, fontSize: 13, color: ESP60 }}>
        Custo ÷ produção da fase. Cria mede por bezerro; recria/engorda/terminação por @. Comum rateado por UA.
      </div>

      <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${LINE}`, marginBottom: 16 }}>
        {abaBtn('lancamentos', 'Lançamentos')}
        {abaBtn('rateio', 'Rateio')}
        {abaBtn('indicadores', 'Indicadores')}
      </div>

      {/* período global (rateio + indicadores) */}
      {(aba === 'rateio' || aba === 'indicadores') && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'end', marginBottom: 16, flexWrap: 'wrap' }}>
          <label style={{ fontSize: 12, color: ESP60 }}>De<br /><input type="date" value={ini} onChange={(e) => setIni(e.target.value)} style={inp} /></label>
          <label style={{ fontSize: 12, color: ESP60 }}>Até<br /><input type="date" value={fim} onChange={(e) => setFim(e.target.value)} style={inp} /></label>
          {aba === 'rateio' && <button onClick={() => void rodarRateio()} disabled={busy} style={btnPri}>{busy ? 'Rodando…' : 'Rodar rateio'}</button>}
          {aba === 'indicadores' && <button onClick={() => void carregarIndicadores()} disabled={busy} style={btnPri}>{busy ? 'Calculando…' : 'Calcular indicadores'}</button>}
        </div>
      )}

      {msg && <div style={{ marginBottom: 12, fontSize: 13, color: msg.startsWith('Erro') ? '#C44536' : GREEN }}>{msg}</div>}

      {/* ── ABA LANÇAMENTOS ── */}
      {aba === 'lancamentos' && (
        <>
          <div style={card}>
            <div style={{ fontWeight: 700, marginBottom: 10 }}>Novo lançamento</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
              <label style={lbl}>Apropriação
                <select value={fTipo} onChange={(e) => setFTipo(e.target.value)} style={inp}>
                  {TIPOS.map((t) => <option key={t} value={t}>{t === 'direto' ? 'Direto (1 lote)' : t === 'comum' ? 'Comum (rateável)' : 'Extra (fora do indicador)'}</option>)}
                </select>
              </label>
              <label style={lbl}>Lote {fTipo === 'comum' && <span style={{ color: ESP60 }}>(n/a)</span>}
                <select value={fLote} onChange={(e) => setFLote(e.target.value)} disabled={fTipo === 'comum'} style={inp}>
                  <option value="">— selecione —</option>
                  {lotes.map((l) => <option key={l.id} value={l.id}>{l.codigo} ({l.fase})</option>)}
                </select>
              </label>
              <label style={lbl}>Categoria
                <select value={fCat} onChange={(e) => setFCat(e.target.value)} style={inp}>
                  {CATEGORIAS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label style={lbl}>Valor (R$)<input value={fValor} onChange={(e) => setFValor(e.target.value)} placeholder="0,00" style={inp} /></label>
              <label style={lbl}>Competência<input type="date" value={fComp} onChange={(e) => setFComp(e.target.value)} style={inp} /></label>
              <label style={lbl}>Diluir (meses)<input value={fDilui} onChange={(e) => setFDilui(e.target.value)} style={inp} /></label>
              <label style={lbl}>Ciclo (opcional)<input value={fCiclo} onChange={(e) => setFCiclo(e.target.value)} placeholder="estacao_monta_2026" style={inp} /></label>
              <label style={lbl}>Descrição<input value={fDesc} onChange={(e) => setFDesc(e.target.value)} style={inp} /></label>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
              <button onClick={() => void salvarLancamento()} disabled={busy} style={btnPri}>Salvar lançamento</button>
              <button onClick={() => void importarFinanceiro()} disabled={busy} style={btnSec} title={`Traz de Contas a Pagar do período ${ini} a ${fim} (centro de custo pecuário)`}>⇩ Importar do financeiro</button>
            </div>
          </div>

          <div style={{ ...card, marginTop: 16 }}>
            <div style={{ fontWeight: 700, marginBottom: 10 }}>Lançamentos ({lancs.length})</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr style={{ color: ESP60, textAlign: 'left' }}>
                  <th style={th}>Competência</th><th style={th}>Apropriação</th><th style={th}>Lote</th><th style={th}>Categoria</th><th style={th}>Descrição</th><th style={{ ...th, textAlign: 'right' }}>Valor</th><th style={th}>Diluição</th><th style={th}>Origem</th>
                </tr></thead>
                <tbody>
                  {lancs.map((l) => (
                    <tr key={l.id} style={{ borderTop: `1px solid ${LINE}` }}>
                      <td style={td}>{l.data_competencia}</td>
                      <td style={td}><span style={{ padding: '1px 6px', borderRadius: 4, fontSize: 11, background: l.tipo_apropriacao === 'extra' ? '#eee' : l.tipo_apropriacao === 'direto' ? '#E8F4DC' : '#FBF3E0' }}>{l.tipo_apropriacao}</span></td>
                      <td style={td}>{loteNome(l.lote_id)}</td>
                      <td style={td}>{l.categoria}</td>
                      <td style={td}>{l.descricao}</td>
                      <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtBRL(l.valor)}</td>
                      <td style={td}>{l.meses_diluicao > 1 ? `${l.meses_diluicao}m` : '—'}</td>
                      <td style={td}>{l.origem}</td>
                    </tr>
                  ))}
                  {lancs.length === 0 && <tr><td style={td} colSpan={8}>Nenhum lançamento ainda.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ── ABA RATEIO ── */}
      {aba === 'rateio' && (
        <div style={card}>
          {!rateio && <div style={{ color: ESP60, fontSize: 13 }}>Escolha o período e rode o rateio. O comum é dividido por UA (unidade animal) — a memória de cálculo aparece aqui.</div>}
          {rateio && (
            <>
              <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 14, fontSize: 13 }}>
                <div><b>{fmtBRL(rateio.total_alocado)}</b><br /><span style={{ color: ESP60 }}>total alocado</span></div>
                <div><b>{rateio.lancamentos_processados}</b><br /><span style={{ color: ESP60 }}>lançamentos</span></div>
                <div><b>{rateio.animais_afetados}</b><br /><span style={{ color: ESP60 }}>animais</span></div>
              </div>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Memória de cálculo (por lote)</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr style={{ color: ESP60, textAlign: 'left' }}>
                  <th style={th}>Lote</th><th style={th}>Fase</th><th style={{ ...th, textAlign: 'right' }}>UA do lote</th><th style={{ ...th, textAlign: 'right' }}>% do total</th><th style={{ ...th, textAlign: 'right' }}>Valor alocado</th>
                </tr></thead>
                <tbody>
                  {(rateio.memoria ?? []).map((m) => (
                    <tr key={m.lote_id} style={{ borderTop: `1px solid ${LINE}` }}>
                      <td style={td}>{m.lote_codigo ?? m.lote_id.slice(0, 8)}</td>
                      <td style={td}>{m.fase}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{Number(m.ua_lote).toFixed(2)}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{Number(m.pct_do_total).toFixed(1)}%</td>
                      <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtBRL(m.valor_alocado)}</td>
                    </tr>
                  ))}
                  {(rateio.memoria ?? []).length === 0 && <tr><td style={td} colSpan={5}>Nada rateado no período (sem lançamentos direto/comum ou sem animais nos lotes).</td></tr>}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}

      {/* ── ABA INDICADORES ── */}
      {aba === 'indicadores' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
          {lotes.length === 0 && <div style={{ color: ESP60 }}>Nenhum lote ativo.</div>}
          {lotes.map((l) => {
            const ind = indicadores[l.id]
            return (
              <div key={l.id} style={card}>
                <div style={{ fontWeight: 700 }}>{l.codigo} <span style={{ color: ESP60, fontWeight: 400, fontSize: 12 }}>· {l.fase}</span></div>
                {!ind && <div style={{ color: ESP60, fontSize: 12, marginTop: 8 }}>Clique em "Calcular indicadores".</div>}
                {ind && ind.indicador === null && (
                  <div style={{ marginTop: 8, fontSize: 12, color: '#9A6A00', background: '#FBF3E0', padding: 8, borderRadius: 6 }}>
                    ⚠️ Sem indicador: {ind.motivo}<br />Custo acumulado: {fmtBRL(ind.custo_total)}
                  </div>
                )}
                {ind && ind.indicador !== null && ind.fase === 'cria' && (
                  <div style={{ marginTop: 8, fontSize: 13 }}>
                    <Kpi label="Custo por bezerro desmamado" val={fmtBRL(ind.custo_por_bezerro)} />
                    <Kpi label="Bezerros desmamados" val={String(ind.bezerros_desmamados)} />
                    <Kpi label="Taxa de desmame" val={ind.taxa_desmame_pct != null ? ind.taxa_desmame_pct + '%' : '—'} />
                    <Kpi label="Custo/matriz.ano" val={ind.custo_matriz_ano != null ? fmtBRL(ind.custo_matriz_ano) : '—'} />
                    <Kpi label="Custo total do período" val={fmtBRL(ind.custo_total)} />
                  </div>
                )}
                {ind && ind.indicador !== null && ind.fase !== 'cria' && (
                  <div style={{ marginTop: 8, fontSize: 13 }}>
                    <Kpi label="Custo por @ produzida" val={ind.custo_por_arroba != null ? fmtBRL(ind.custo_por_arroba) : '—'} />
                    <Kpi label="@ produzidas" val={String(ind.arrobas_produzidas)} />
                    <Kpi label="GMD (kg/dia)" val={ind.gmd_kg_dia != null ? String(ind.gmd_kg_dia) : '—'} />
                    <Kpi label="Custo cabeça.dia" val={ind.custo_cabeca_dia != null ? fmtBRL(ind.custo_cabeca_dia) : '—'} />
                    <Kpi label="Custo total do período" val={fmtBRL(ind.custo_total)} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div style={{ marginTop: 20, fontSize: 11, color: ESP60 }}>{propriedade?.nome ? `Propriedade: ${propriedade.nome}` : ''}</div>
    </div>
  )
}

function Kpi({ label, val }: { label: string; val: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: `1px dashed ${LINE}` }}>
      <span style={{ color: ESP60 }}>{label}</span><b>{val}</b>
    </div>
  )
}

const inp: React.CSSProperties = { display: 'block', width: '100%', padding: '6px 8px', border: `1px solid ${LINE}`, borderRadius: 6, fontSize: 13, marginTop: 3, background: '#fff', color: ESP }
const lbl: React.CSSProperties = { fontSize: 12, color: ESP60 }
const card: React.CSSProperties = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, padding: 16 }
const th: React.CSSProperties = { padding: '6px 8px', fontWeight: 600, whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '6px 8px', verticalAlign: 'top' }
const btnPri: React.CSSProperties = { padding: '8px 14px', background: GOLD, color: '#3D2314', border: 'none', borderRadius: 6, fontWeight: 600, cursor: 'pointer', fontSize: 13 }
const btnSec: React.CSSProperties = { padding: '8px 14px', background: 'transparent', color: ESP, border: `1px solid ${LINE}`, borderRadius: 6, fontWeight: 600, cursor: 'pointer', fontSize: 13 }
