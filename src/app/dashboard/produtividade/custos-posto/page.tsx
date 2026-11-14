'use client'
// Custos do posto (CEO 11/11, custeio por kg · fatia F3) — para cada posto de trabalho você informa os custos mensais
// de utilidades e estrutura (mão de obra, energia por R$ ou kWh×tarifa, água, vapor, frio, ar comprimido, gás,
// manutenção, depreciação, outros) e as horas de operação. É a base do custo por hora do posto e do custo por kg do
// produto final (fatia F6). Genérico para qualquer planta (RD-102). Histórico por vigência: ao salvar, o valor antigo
// é fechado e o novo passa a valer. Casa com o padrão das telas industriais (paleta plana, useCompanyIds, RPC {ok,erro},
// RD-95 "?" em todo campo, RD-98 CRUD).
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { erroAmigavel } from '@/lib/erroAmigavel'

const ROTA = '/dashboard/produtividade/custos-posto'
const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)'
const GREEN = '#166534', GREENBG = '#ECFDF5', RED = '#B42318', REDBG = '#FCEBEB'

const brl = (n: number | null | undefined) => n == null ? '—' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
// aceita "1200", "1200,50" ou "1.200,50"; devolve string decimal com ponto (ou '' quando vazio) para o ::numeric do banco
const toNum = (s: string): string => {
  const t = (s ?? '').trim()
  if (!t) return ''
  return t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t
}
const val = (s: string): number => { const n = Number(toNum(s)); return Number.isFinite(n) ? n : 0 }

type Plant = { id: string; nome_planta: string }
type Posto = { id: string; numero: string; atividade: string | null; setor_nome: string | null }
type Lanc = { id: string; vigencia_inicio: string; vigencia_fim: string | null; atual: boolean; dados: Record<string, number | null> }
type Modo = 'reais' | 'kwh'
type Form = {
  vigencia: string; mao_obra: string; encargos: string; energia_modo: Modo; energia_mes: string; energia_kwh: string
  energia_tarifa: string; agua: string; vapor: string; frio: string; ar: string; gas: string; manutencao: string
  depreciacao: string; outros: string; horas: string
}
const primeiroDiaMes = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01` }
const formVazio = (): Form => ({
  vigencia: primeiroDiaMes(), mao_obra: '', encargos: '', energia_modo: 'reais', energia_mes: '', energia_kwh: '',
  energia_tarifa: '', agua: '', vapor: '', frio: '', ar: '', gas: '', manutencao: '', depreciacao: '', outros: '', horas: '',
})

const inp: React.CSSProperties = { padding: '7px 9px', fontSize: 13, border: `1px solid ${LINE}`, borderRadius: 7, background: '#fff', color: ESP, width: '100%', boxSizing: 'border-box' }
const card: React.CSSProperties = { background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 16 }
const lab: React.CSSProperties = { fontSize: 12, color: MUT, display: 'block' }
const btnGold: React.CSSProperties = { padding: '9px 16px', borderRadius: 8, border: 'none', background: GOLD, color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }
const btnOut: React.CSSProperties = { padding: '8px 14px', borderRadius: 8, border: `1px solid ${LINE}`, background: '#fff', color: ESP, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }

export default function CustosPostoPage() {
  const { selInfo, sel } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && sel ? sel : null

  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [plants, setPlants] = useState<Plant[]>([])
  const [plantId, setPlantId] = useState<string | null>(null)
  const [postos, setPostos] = useState<Posto[]>([])
  const [busca, setBusca] = useState('')
  const [postoSel, setPostoSel] = useState<string | null>(null)
  const [lancs, setLancs] = useState<Lanc[]>([])
  const [form, setForm] = useState<Form>(formVazio())
  const [salvando, setSalvando] = useState(false)

  const flash = (m: string) => { setMsg(m); setErro(null); window.setTimeout(() => setMsg(null), 3500) }
  const flashErr = (m: string) => { setErro(m); window.setTimeout(() => setErro(null), 6000) }
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }))

  // plantas da empresa
  useEffect(() => {
    if (!empresa) { setLoading(false); return }
    void (async () => {
      setLoading(true); setErro(null)
      const { data } = await supabase.from('industrial_plants').select('id, nome_planta').eq('company_id', empresa).eq('is_active', true).order('nome_planta')
      const ps = (data ?? []) as Plant[]
      setPlants(ps); setPlantId(ps[0]?.id ?? null); setLoading(false)
    })()
  }, [empresa])

  // postos da planta
  const carregarPostos = useCallback(async () => {
    if (!empresa || !plantId) { setPostos([]); return }
    const { data, error } = await supabase
      .from('prod_posto')
      .select('id, numero, atividade, setor:prod_setor(nome)')
      .eq('company_id', empresa).eq('plant_id', plantId).eq('ativo', true)
      .order('ordem_linha', { ascending: true }).order('numero', { ascending: true })
    if (error) { flashErr(erroAmigavel(error, 'Não foi possível carregar os postos. Tente de novo.')); return }
    type Row = { id: string; numero: string; atividade: string | null; setor: { nome: string | null } | { nome: string | null }[] | null }
    const list = ((data ?? []) as Row[]).map((r) => ({
      id: r.id, numero: r.numero, atividade: r.atividade,
      setor_nome: Array.isArray(r.setor) ? (r.setor[0]?.nome ?? null) : (r.setor?.nome ?? null),
    }))
    setPostos(list)
  }, [empresa, plantId])
  useEffect(() => { void carregarPostos() }, [carregarPostos])

  // custos do posto selecionado
  const carregarLancs = useCallback(async (postoId: string) => {
    const { data, error } = await supabase.rpc('fn_prod_posto_custo_listar', { p_posto_id: postoId })
    if (error) { flashErr(erroAmigavel(error, 'Não foi possível carregar os custos do posto. Tente de novo.')); return }
    const rows = (data ?? []) as Lanc[]
    setLancs(rows)
    const atual = rows.find((r) => r.atual) ?? rows[0]
    if (atual) {
      const d = atual.dados
      const temKwh = d.energia_kwh_mes != null || d.energia_tarifa_kwh != null
      setForm({
        vigencia: atual.vigencia_inicio, mao_obra: d.mao_obra_mes != null ? String(d.mao_obra_mes) : '',
        encargos: d.encargos_pct != null ? String(d.encargos_pct) : '', energia_modo: temKwh ? 'kwh' : 'reais',
        energia_mes: d.energia_mes != null ? String(d.energia_mes) : '', energia_kwh: d.energia_kwh_mes != null ? String(d.energia_kwh_mes) : '',
        energia_tarifa: d.energia_tarifa_kwh != null ? String(d.energia_tarifa_kwh) : '', agua: d.agua_mes != null ? String(d.agua_mes) : '',
        vapor: d.vapor_mes != null ? String(d.vapor_mes) : '', frio: d.frio_mes != null ? String(d.frio_mes) : '',
        ar: d.ar_comprimido_mes != null ? String(d.ar_comprimido_mes) : '', gas: d.gas_mes != null ? String(d.gas_mes) : '',
        manutencao: d.manutencao_mes != null ? String(d.manutencao_mes) : '', depreciacao: d.depreciacao_mes != null ? String(d.depreciacao_mes) : '',
        outros: d.outros_mes != null ? String(d.outros_mes) : '', horas: d.horas_operacao_mes != null ? String(d.horas_operacao_mes) : '',
      })
    } else setForm(formVazio())
  }, [])

  function selecionar(id: string) { setPostoSel(id); setLancs([]); setForm(formVazio()); void carregarLancs(id) }

  async function salvar() {
    if (!empresa || !postoSel) return
    if (!form.vigencia) { flashErr('Informe o início da vigência (1º dia do mês).'); return }
    const energia = form.energia_modo === 'reais'
      ? { energia_mes: toNum(form.energia_mes), energia_kwh_mes: '', energia_tarifa_kwh: '' }
      : { energia_mes: '', energia_kwh_mes: toNum(form.energia_kwh), energia_tarifa_kwh: toNum(form.energia_tarifa) }
    const dados = {
      posto_id: postoSel, vigencia_inicio: form.vigencia,
      mao_obra_mes: toNum(form.mao_obra), encargos_pct: toNum(form.encargos), ...energia,
      agua_mes: toNum(form.agua), vapor_mes: toNum(form.vapor), frio_mes: toNum(form.frio), ar_comprimido_mes: toNum(form.ar),
      gas_mes: toNum(form.gas), manutencao_mes: toNum(form.manutencao), depreciacao_mes: toNum(form.depreciacao),
      outros_mes: toNum(form.outros), horas_operacao_mes: toNum(form.horas),
    }
    setSalvando(true)
    const { data, error } = await supabase.rpc('fn_prod_posto_custo_salvar', { p_dados: dados })
    setSalvando(false)
    const r = data as { ok?: boolean; erro?: string } | null
    if (error || r?.ok === false) {
      const map: Record<string, string> = { posto_nao_encontrado: 'Posto não encontrado.', sem_acesso: 'Sem acesso a esta empresa.' }
      flashErr(map[r?.erro ?? ''] || erroAmigavel(error, 'Não consegui salvar os custos.')); return
    }
    flash('Custos salvos.'); void carregarLancs(postoSel)
  }

  async function excluir(id: string) {
    if (!window.confirm('Excluir este lançamento de custo? O lançamento anterior volta a valer.')) return
    const { data, error } = await supabase.rpc('fn_prod_posto_custo_excluir', { p_id: id })
    const r = data as { ok?: boolean; erro?: string } | null
    if (error || r?.ok === false) {
      const map: Record<string, string> = { nao_encontrado: 'Lançamento não encontrado.', sem_acesso: 'Sem acesso.' }
      flashErr(map[r?.erro ?? ''] || erroAmigavel(error, 'Não consegui excluir.')); return
    }
    flash('Lançamento excluído.'); if (postoSel) void carregarLancs(postoSel)
  }

  const postosFiltrados = useMemo(() => {
    const t = busca.trim().toLowerCase()
    if (!t) return postos
    return postos.filter((p) => `${p.numero} ${p.atividade ?? ''} ${p.setor_nome ?? ''}`.toLowerCase().includes(t))
  }, [postos, busca])

  const totalMes = useMemo(() => {
    const energia = form.energia_modo === 'reais' ? val(form.energia_mes) : val(form.energia_kwh) * val(form.energia_tarifa)
    const mo = val(form.mao_obra) * (1 + val(form.encargos) / 100)
    return mo + energia + val(form.agua) + val(form.vapor) + val(form.frio) + val(form.ar) + val(form.gas) + val(form.manutencao) + val(form.depreciacao) + val(form.outros)
  }, [form])
  const custoHora = val(form.horas) > 0 ? totalMes / val(form.horas) : null
  const postoAtual = postos.find((p) => p.id === postoSel)
  const lancAtual = lancs.find((l) => l.atual)

  if (!empresa) return <Casca><div style={card}>Selecione uma empresa específica para informar os custos dos postos.</div></Casca>
  if (loading) return <Casca><div style={{ ...card, color: MUT }}>Carregando…</div></Casca>
  if (plants.length === 0) return <Casca><div style={card}>Esta empresa não tem planta industrial cadastrada. Cadastre a planta antes de informar os custos dos postos.</div></Casca>

  return (
    <Casca>
      {msg && <div style={{ background: GREENBG, color: GREEN, padding: '9px 13px', borderRadius: 8, fontSize: 13 }}>{msg}</div>}
      {erro && <div style={{ background: REDBG, color: RED, padding: '9px 13px', borderRadius: 8, fontSize: 13 }}>{erro}</div>}

      {plants.length > 1 && (
        <div style={card}>
          <label style={{ ...lab, maxWidth: 320 }}>Planta <AjudaCampo chave="prod.custos_posto.planta" rota={ROTA} />
            <select style={inp} value={plantId ?? ''} onChange={(e) => { setPlantId(e.target.value); setPostoSel(null) }}>
              {plants.map((p) => <option key={p.id} value={p.id}>{p.nome_planta}</option>)}
            </select>
          </label>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 300px) 1fr', gap: 14, alignItems: 'start' }} className="cp-grid">
        {/* lista de postos (só os da empresa) */}
        <div style={card}>
          <label style={{ ...lab, marginBottom: 8 }}>Posto de trabalho <AjudaCampo chave="prod.custos_posto.posto" rota={ROTA} />
            <input style={{ ...inp, marginTop: 4 }} placeholder="Buscar posto…" value={busca} onChange={(e) => setBusca(e.target.value)} />
          </label>
          <div data-testid="cp-lista" style={{ display: 'grid', gap: 6, maxHeight: 480, overflowY: 'auto', marginTop: 8 }}>
            {postosFiltrados.map((p) => (
              <button key={p.id} data-testid={`cp-posto-${p.numero}`} onClick={() => selecionar(p.id)} style={{
                textAlign: 'left', padding: '9px 11px', borderRadius: 9, cursor: 'pointer',
                border: `1px solid ${postoSel === p.id ? GOLD : LINE}`, background: postoSel === p.id ? '#FBF3DE' : '#fff',
              }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: ESP }}>{p.numero}{p.atividade ? ` · ${p.atividade}` : ''}</div>
                <div style={{ fontSize: 11, color: MUT }}>{p.setor_nome ?? 'sem setor'}</div>
              </button>
            ))}
            {postosFiltrados.length === 0 && (
              <div style={{ fontSize: 12.5, color: MUT, padding: '14px 4px' }}>
                {postos.length === 0 ? 'Nenhum posto nesta planta. Cadastre os postos em ' : 'Nenhum posto encontrado para a busca. '}
                {postos.length === 0 && <Link href="/dashboard/produtividade" style={{ color: GOLD, fontWeight: 700 }}>Produtividade → Postos</Link>}
              </div>
            )}
          </div>
        </div>

        {/* formulário de custos */}
        <div style={{ display: 'grid', gap: 14 }}>
          {!postoSel ? (
            <div style={{ ...card, color: MUT }}>Escolha um posto na lista para informar os custos mensais dele.</div>
          ) : (
            <>
              <div style={card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: ESP }}>{postoAtual?.numero}{postoAtual?.atividade ? ` · ${postoAtual.atividade}` : ''}</div>
                  <div style={{ fontSize: 12.5, color: MUT }}>Custo do posto <AjudaCampo chave="prod.custos_posto.total" rota={ROTA} /></div>
                </div>
                <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 10 }}>
                  <div><div style={{ fontSize: 11, color: MUT }}>Total no mês</div><div style={{ fontSize: 22, fontWeight: 800, color: GOLD, fontVariantNumeric: 'tabular-nums' }}>{brl(totalMes)}</div></div>
                  <div><div style={{ fontSize: 11, color: MUT }}>Custo por hora</div><div style={{ fontSize: 22, fontWeight: 800, color: ESP, fontVariantNumeric: 'tabular-nums' }}>{custoHora == null ? 'informe as horas' : `${brl(custoHora)}/h`}</div></div>
                </div>
              </div>

              <div style={card}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
                  <label style={lab}>Início da vigência <AjudaCampo chave="prod.custos_posto.vigencia" rota={ROTA} />
                    <input type="date" style={inp} value={form.vigencia} onChange={(e) => set({ vigencia: e.target.value })} data-testid="cp-vigencia" />
                  </label>
                  <label style={lab}>Mão de obra (R$/mês) <AjudaCampo chave="prod.custos_posto.mao_obra" rota={ROTA} />
                    <input style={inp} inputMode="decimal" value={form.mao_obra} onChange={(e) => set({ mao_obra: e.target.value })} data-testid="cp-mao-obra" />
                  </label>
                  <label style={lab}>Encargos (%) <AjudaCampo chave="prod.custos_posto.encargos" rota={ROTA} />
                    <input style={inp} inputMode="decimal" value={form.encargos} onChange={(e) => set({ encargos: e.target.value })} />
                  </label>
                  <label style={lab}>Energia — como informar <AjudaCampo chave="prod.custos_posto.energia_modo" rota={ROTA} />
                    <select style={inp} value={form.energia_modo} onChange={(e) => set({ energia_modo: e.target.value as Modo })}>
                      <option value="reais">Em reais por mês</option>
                      <option value="kwh">Por kWh × tarifa</option>
                    </select>
                  </label>
                  {form.energia_modo === 'reais' ? (
                    <label style={lab}>Energia (R$/mês) <AjudaCampo chave="prod.custos_posto.energia_mes" rota={ROTA} />
                      <input style={inp} inputMode="decimal" value={form.energia_mes} onChange={(e) => set({ energia_mes: e.target.value })} data-testid="cp-energia" />
                    </label>
                  ) : (
                    <>
                      <label style={lab}>Energia (kWh/mês) <AjudaCampo chave="prod.custos_posto.energia_kwh" rota={ROTA} />
                        <input style={inp} inputMode="decimal" value={form.energia_kwh} onChange={(e) => set({ energia_kwh: e.target.value })} />
                      </label>
                      <label style={lab}>Tarifa (R$/kWh) <AjudaCampo chave="prod.custos_posto.energia_tarifa" rota={ROTA} />
                        <input style={inp} inputMode="decimal" value={form.energia_tarifa} onChange={(e) => set({ energia_tarifa: e.target.value })} />
                      </label>
                    </>
                  )}
                  <label style={lab}>Água (R$/mês) <AjudaCampo chave="prod.custos_posto.agua" rota={ROTA} />
                    <input style={inp} inputMode="decimal" value={form.agua} onChange={(e) => set({ agua: e.target.value })} />
                  </label>
                  <label style={lab}>Vapor (R$/mês) <AjudaCampo chave="prod.custos_posto.vapor" rota={ROTA} />
                    <input style={inp} inputMode="decimal" value={form.vapor} onChange={(e) => set({ vapor: e.target.value })} />
                  </label>
                  <label style={lab}>Frio / refrigeração (R$/mês) <AjudaCampo chave="prod.custos_posto.frio" rota={ROTA} />
                    <input style={inp} inputMode="decimal" value={form.frio} onChange={(e) => set({ frio: e.target.value })} />
                  </label>
                  <label style={lab}>Ar comprimido (R$/mês) <AjudaCampo chave="prod.custos_posto.ar" rota={ROTA} />
                    <input style={inp} inputMode="decimal" value={form.ar} onChange={(e) => set({ ar: e.target.value })} />
                  </label>
                  <label style={lab}>Gás (R$/mês) <AjudaCampo chave="prod.custos_posto.gas" rota={ROTA} />
                    <input style={inp} inputMode="decimal" value={form.gas} onChange={(e) => set({ gas: e.target.value })} data-testid="cp-gas" />
                  </label>
                  <label style={lab}>Manutenção (R$/mês) <AjudaCampo chave="prod.custos_posto.manutencao" rota={ROTA} />
                    <input style={inp} inputMode="decimal" value={form.manutencao} onChange={(e) => set({ manutencao: e.target.value })} data-testid="cp-manutencao" />
                  </label>
                  <label style={lab}>Depreciação (R$/mês) <AjudaCampo chave="prod.custos_posto.depreciacao" rota={ROTA} />
                    <input style={inp} inputMode="decimal" value={form.depreciacao} onChange={(e) => set({ depreciacao: e.target.value })} data-testid="cp-depreciacao" />
                  </label>
                  <label style={lab}>Outros (R$/mês) <AjudaCampo chave="prod.custos_posto.outros" rota={ROTA} />
                    <input style={inp} inputMode="decimal" value={form.outros} onChange={(e) => set({ outros: e.target.value })} />
                  </label>
                  <label style={lab}>Horas de operação (h/mês) <AjudaCampo chave="prod.custos_posto.horas" rota={ROTA} />
                    <input style={inp} inputMode="decimal" value={form.horas} onChange={(e) => set({ horas: e.target.value })} data-testid="cp-horas" />
                  </label>
                </div>
                <div style={{ display: 'flex', gap: 10, marginTop: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button style={{ ...btnGold, opacity: salvando ? 0.6 : 1 }} disabled={salvando} onClick={() => void salvar()} data-testid="cp-salvar">
                    {salvando ? 'Salvando…' : 'Salvar custos'}
                  </button>
                  <span style={{ fontSize: 11.5, color: MUT }}>Salvar com uma nova vigência mantém o valor antigo no histórico. <AjudaCampo chave="prod.custos_posto.salvar" rota={ROTA} /></span>
                </div>
              </div>

              {/* histórico de vigências (RD-98: incluir acima, editar ao selecionar, excluir aqui) */}
              <div style={card}>
                <div style={{ fontSize: 13, fontWeight: 700, color: ESP, marginBottom: 10 }}>Histórico de custos deste posto</div>
                {lancs.length === 0 ? (
                  <div style={{ fontSize: 12.5, color: MUT }}>Ainda não há custos lançados para este posto. Preencha acima e clique em “Salvar custos”.</div>
                ) : (
                  <div className="cp-hist-wrap" style={{ overflowX: 'auto', border: `0.5px solid ${LINE}`, borderRadius: 10 }}>
                    <table className="cp-hist-table" style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
                      <thead style={{ background: BG }}>
                        <tr>
                          <th style={th}>Vigência</th>
                          <th style={{ ...th, textAlign: 'right' }}>Mão de obra</th>
                          <th style={{ ...th, textAlign: 'right' }}>Energia</th>
                          <th style={{ ...th, textAlign: 'right' }}>Horas/mês</th>
                          <th style={{ ...th, textAlign: 'right' }}>Excluir <AjudaCampo chave="prod.custos_posto.excluir" rota={ROTA} /></th>
                        </tr>
                      </thead>
                      <tbody>
                        {lancs.map((l) => {
                          const d = l.dados
                          const en = d.energia_mes ?? (((d.energia_kwh_mes ?? 0) * (d.energia_tarifa_kwh ?? 0)) || null)
                          return (
                            <tr key={l.id} className="cp-hist-row" style={l.atual ? { background: '#FCFaf4' } : undefined}>
                              <td style={td} data-label="Vigência">{fmtComp(l.vigencia_inicio)}{l.atual && <span style={{ fontSize: 10, color: GREEN, marginLeft: 6, fontWeight: 700 }}>atual</span>}{l.vigencia_fim && <span style={{ fontSize: 10, color: MUT, marginLeft: 6 }}>até {fmtComp(l.vigencia_fim)}</span>}</td>
                              <td style={{ ...td, textAlign: 'right' }} data-label="Mão de obra">{brl(d.mao_obra_mes)}</td>
                              <td style={{ ...td, textAlign: 'right' }} data-label="Energia">{brl(en)}</td>
                              <td style={{ ...td, textAlign: 'right' }} data-label="Horas/mês">{d.horas_operacao_mes ?? '—'}</td>
                              <td style={{ ...td, textAlign: 'right' }} data-label="Excluir">
                                <button style={{ ...btnOut, padding: '4px 10px', fontSize: 11, color: RED, borderColor: '#E7C9C4' }} onClick={() => void excluir(l.id)} data-testid={`cp-excluir-${l.id}`}>Excluir</button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {lancAtual && <div style={{ fontSize: 11, color: MUT, marginTop: 8 }}>Para alterar o custo vigente, edite os campos acima e salve — o valor atual fica no histórico.</div>}
              </div>
            </>
          )}
        </div>
      </div>

      <style>{`
        @media (max-width: 720px){
          .cp-grid{ grid-template-columns: 1fr !important; }
          /* histórico vira cartões no celular: cada lançamento empilha e a ação Excluir fica no fluxo vertical,
             sempre visível (sem rolagem horizontal) — RD-96 mobile 390px */
          .cp-hist-wrap{ overflow-x: visible !important; border: none !important; border-radius: 0 !important; }
          .cp-hist-table{ min-width: 0 !important; }
          .cp-hist-table thead{ display: none; }
          .cp-hist-table, .cp-hist-table tbody, .cp-hist-row, .cp-hist-table tbody td{ display: block; width: 100%; box-sizing: border-box; }
          .cp-hist-row{ border: 0.5px solid ${LINE}; border-radius: 10px; margin-bottom: 10px; padding: 2px 12px 8px; }
          .cp-hist-table tbody td{ text-align: left !important; border-top: none !important; display: flex !important; justify-content: space-between; align-items: center; gap: 12px; padding: 8px 0; }
          .cp-hist-table tbody td::before{ content: attr(data-label); font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: ${MUT}; }
          .cp-hist-table tbody td[data-label="Excluir"]{ display: block !important; padding-top: 10px; }
          .cp-hist-table tbody td[data-label="Excluir"]::before{ display: none; }
          .cp-hist-table tbody td[data-label="Excluir"] button{ width: 100%; padding: 11px !important; font-size: 13px !important; }
        }
      `}</style>
    </Casca>
  )
}

const th: React.CSSProperties = { padding: '9px 10px', textAlign: 'left', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: MUT, whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '7px 10px', fontSize: 13, color: ESP, borderTop: `0.5px solid ${LINE}`, verticalAlign: 'middle' }
const fmtComp = (d: string | null) => { if (!d) return '—'; const [y, m] = d.slice(0, 7).split('-'); return `${m}/${y}` }

function Casca({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '24px clamp(14px, 4vw, 40px)' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto', display: 'grid', gap: 14 }}>
        <header>
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: GOLD, margin: 0 }}>Indústria · Custos</p>
          <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 28, fontWeight: 400, color: ESP, margin: '4px 0 0' }}>Custos do posto</h1>
          <p style={{ fontSize: 12.5, color: MUT, margin: '6px 0 0', lineHeight: 1.5 }}>Os custos mensais de cada posto (mão de obra, energia, água, vapor, frio, ar, gás, manutenção, depreciação, outros) e as horas de operação — a base do custo por hora e do custo por kg do produto final.</p>
          {/* Sub-navegação das telas de Produtividade: esta (Custos do posto) é drill-down de Postos. */}
          <nav aria-label="Seções de Produtividade" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            <Link href="/dashboard/produtividade" style={{ fontSize: 13, fontWeight: 600, color: MUT, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 999, padding: '5px 12px', textDecoration: 'none' }}>Cadastro de postos</Link>
            <Link href="/dashboard/produtividade/indicadores" style={{ fontSize: 13, fontWeight: 600, color: MUT, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 999, padding: '5px 12px', textDecoration: 'none' }}>Indicadores</Link>
            <span aria-current="page" style={{ fontSize: 13, fontWeight: 700, color: ESP, background: '#FBF3DE', border: `1px solid ${GOLD}`, borderRadius: 999, padding: '5px 12px' }}>Custos do posto</span>
            <Link href="/dashboard/produtividade/rateio" data-testid="link-rateio-admin" style={{ fontSize: 13, fontWeight: 600, color: MUT, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 999, padding: '5px 12px', textDecoration: 'none' }}>Rateio administrativo</Link>
          </nav>

        </header>
        {children}
      </div>
    </div>
  )
}
