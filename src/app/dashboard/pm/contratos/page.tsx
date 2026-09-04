'use client'
// CONTRATOS (P&M). O contrato oficial vive na GE (erp_contratos); agency_contratos estende via
// erp_contrato_id e o fee é LIDO da GE (fonte única). Escopo (agency_contrato_itens) amarrado à
// produção: contratado × realizado POR serviço, POR período (mês civil / trimestre / projeto).
// Conta CRIADO (compromisso); "Entregues" (publicado) é coluna extra. Avisa, não bloqueia. Tema Espresso.
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { mensagemDeResultado, estiloBordaInput } from '@/components/ui/feedback/contratoSalvar'

const ESPRESSO = '#3D2314'; const OFFWHITE = '#FAF7F2'; const DOURADO = '#C8941A'
const BORDA = '#E7DED3'; const TEXTM = '#6b5444'; const GREEN = '#1F5A1F'; const RED = '#7A1F1F'; const AMBER = '#8A5A08'
const brl = (v: number | null | undefined) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const inp: CSSProperties = { padding: '8px 10px', fontSize: 13, border: `1px solid ${BORDA}`, borderRadius: 8, background: '#fff', color: ESPRESSO, outline: 'none' }
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const PERIODICIDADES = ['mensal', 'trimestral', 'projeto']

const STATUS: Record<string, { l: string; cor: string }> = {
  rascunho: { l: 'Rascunho', cor: '#F0E9DE' }, ativo: { l: 'Ativo', cor: '#DCEFD7' },
  suspenso: { l: 'Suspenso', cor: '#FFF3D6' }, encerrado: { l: 'Encerrado', cor: '#F4D6D6' },
}
const stCfg = (v: string) => STATUS[v] ?? { l: v, cor: OFFWHITE }
const SIT: Record<string, { ico: string; cor: string; l: (s: number | null) => string }> = {
  em_dia: { ico: '🟢', cor: GREEN, l: () => 'em dia' },
  a_menos: { ico: '🟡', cor: AMBER, l: (s) => `faltam ${s}` },
  a_mais: { ico: '🔴', cor: RED, l: (s) => `${Math.abs(s ?? 0)} além do contrato` },
  sem_limite: { ico: '⬜', cor: TEXTM, l: () => 'sem limite contratado' },
}

type Contrato = {
  contrato_id: string; cliente_nome: string; tipo: string; fee_mensal: number | null; ge_valor_mensal: number | null
  erp_contrato_id: string | null; tem_contrato_ge: boolean; status: string; data_inicio: string | null
  itens_total: number; itens_a_mais: number; escopo_status: string
}
type Servico = { id: string; nome: string; unidade: string | null; periodicidade: string | null }
type GeContrato = { id: string; numero: string | null; cliente_nome: string | null; valor_atual: number | null }
type RealItem = {
  item_id: string; servico_id: string | null; tipo_servico: string; servico_nome: string
  quantidade_contratada: number | null; unidade: string | null; periodicidade: string | null; sem_limite: boolean
  criados: number; entregues: number; saldo: number | null; situacao: string
}
type RealState = { loading: boolean; itens: RealItem[]; jobs_sem_servico: { tipo: string; qtd: number }[]; ref: string; erro?: string }

export default function ContratosPage() {
  const { selInfo, companyIds } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : (companyIds[0] ?? null)
  const [contratos, setContratos] = useState<Contrato[]>([])
  const [servicos, setServicos] = useState<Servico[]>([])
  const [geContratos, setGeContratos] = useState<GeContrato[]>([])
  const [expand, setExpand] = useState<Record<string, RealState>>({})
  const [loading, setLoading] = useState(true); const [toast, setToast] = useState<string | null>(null)
  const [editEscopo, setEditEscopo] = useState<Contrato | null>(null)
  const [vincular, setVincular] = useState<Contrato | null>(null)

  const carregar = async () => {
    if (!empresa) { setLoading(false); return }
    setLoading(true)
    const [c, sv, ge] = await Promise.all([
      supabase.rpc('fn_agency_contrato_listar', { p_company_id: empresa }),
      supabase.from('agency_servico').select('id, nome, unidade, periodicidade').eq('company_id', empresa).eq('ativo', true).order('ordem'),
      supabase.from('erp_contratos').select('id, numero, cliente_nome, valor_atual').eq('company_id', empresa).order('data_inicio', { ascending: false }),
    ])
    setContratos((c.data ?? []) as Contrato[])
    setServicos((sv.data ?? []) as Servico[])
    setGeContratos((ge.data ?? []) as GeContrato[])
    setExpand({}); setLoading(false)
  }
  useEffect(() => { void carregar() }, [empresa]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t) }, [toast])

  const ymNow = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01` }

  async function carregarRealizado(id: string, ref: string) {
    setExpand((m) => ({ ...m, [id]: { ...(m[id] ?? { itens: [], jobs_sem_servico: [] }), loading: true, ref } }))
    const { data, error } = await supabase.rpc('fn_agency_contrato_realizado', { p_contrato_id: id, p_periodo_ref: ref })
    const j = data as { ok?: boolean; erro?: string; itens?: RealItem[]; jobs_sem_servico?: { tipo: string; qtd: number }[] } | null
    if (error || !j?.ok) { setExpand((m) => ({ ...m, [id]: { loading: false, itens: [], jobs_sem_servico: [], ref, erro: error?.message ?? j?.erro ?? 'falhou' } })); return }
    setExpand((m) => ({ ...m, [id]: { loading: false, itens: j.itens ?? [], jobs_sem_servico: j.jobs_sem_servico ?? [], ref } }))
  }
  function toggle(id: string) {
    if (expand[id]) { setExpand((m) => { const n = { ...m }; delete n[id]; return n }); return }
    void carregarRealizado(id, ymNow())
  }
  function mudarMes(id: string, delta: number) {
    const cur = expand[id]?.ref ?? ymNow(); const [y, mo] = cur.split('-').map(Number)
    const d = new Date(y, mo - 1 + delta, 1); void carregarRealizado(id, `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`)
  }
  const rotuloMes = (ref: string) => { const [y, mo] = ref.split('-').map(Number); return `${MESES[mo - 1]}/${y}` }

  async function mudarStatus(c: Contrato, status: string) {
    await supabase.from('agency_contratos').update({ status, atualizado_em: new Date().toISOString() }).eq('id', c.contrato_id)
    setToast(`Contrato ALTERADO para ${stCfg(status).l}.`); void carregar()
  }

  const kpis = useMemo(() => ({
    ativos: contratos.filter((c) => c.status === 'ativo').length,
    mrr: contratos.filter((c) => c.status === 'ativo' && c.tipo === 'recorrente').reduce((s, c) => s + Number((c.tem_contrato_ge ? c.ge_valor_mensal : c.fee_mensal) ?? 0), 0),
    semGe: contratos.filter((c) => !c.tem_contrato_ge).length,
  }), [contratos])

  if (!empresa) return <div style={{ padding: 32, color: TEXTM, background: OFFWHITE, minHeight: '100vh' }}>Selecione uma empresa no topo.</div>

  return (
    <div style={{ background: OFFWHITE, minHeight: '100vh', padding: '24px 18px', color: ESPRESSO }}>
      <div style={{ maxWidth: 1050, margin: '0 auto' }}>
        <header style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: DOURADO, fontWeight: 700 }}>💰 P&amp;M · Contratos</div>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: '2px 0 0' }}>Contratos</h1>
          <p style={{ fontSize: 13, color: TEXTM, margin: '4px 0 0' }}>O contrato oficial vive na Gestão Empresarial. Aqui você amarra o escopo à produção: contratado × realizado por serviço e por mês.</p>
        </header>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px,1fr))', gap: 10, marginBottom: 14 }}>
          <Kpi l="Contratos ativos" v={String(kpis.ativos)} />
          <Kpi l="MRR (fee da GE)" v={brl(kpis.mrr)} cor={DOURADO} />
          {kpis.semGe > 0 && <Kpi l="Sem contrato na GE" v={String(kpis.semGe)} cor={RED} />}
        </div>

        {loading ? <div style={{ padding: 40, textAlign: 'center', color: TEXTM }}>Carregando…</div>
          : contratos.length === 0 ? <div style={{ padding: 40, textAlign: 'center', color: TEXTM, background: '#fff', border: `1px dashed ${BORDA}`, borderRadius: 12 }}>Nenhum contrato de agência ainda.</div>
          : (
            <div style={{ display: 'grid', gap: 8 }}>
              {contratos.map((c) => {
                const exp = expand[c.contrato_id]
                const feeMostrar = c.tem_contrato_ge ? c.ge_valor_mensal : c.fee_mensal
                return (
                  <div key={c.contrato_id} style={{ background: '#fff', border: `1px solid ${c.itens_a_mais > 0 ? RED : BORDA}`, borderRadius: 12, padding: '12px 14px' }}>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                      <div style={{ flex: 1, minWidth: 180 }}>
                        <div style={{ fontWeight: 700 }}>{c.cliente_nome} <span style={{ color: TEXTM, fontWeight: 400 }}>· {c.tipo === 'recorrente' ? 'recorrente' : 'projeto'}</span></div>
                        <div style={{ fontSize: 12, color: TEXTM, marginTop: 2 }}>
                          {c.tipo === 'recorrente' ? `${brl(Number(feeMostrar ?? 0))}/mês` : brl(Number(c.ge_valor_mensal ?? c.fee_mensal ?? 0))}
                          {c.data_inicio ? ` · desde ${c.data_inicio}` : ''}
                        </div>
                        {!c.tem_contrato_ge && (
                          <button onClick={() => setVincular(c)} style={{ marginTop: 4, fontSize: 11, color: RED, background: '#F9E4E4', border: `1px solid ${RED}`, borderRadius: 8, padding: '3px 8px', cursor: 'pointer', fontWeight: 600 }}>
                            ⚠️ sem contrato na GE — não gera faturamento · vincular
                          </button>
                        )}
                      </div>
                      <button onClick={() => toggle(c.contrato_id)}
                        style={{ fontSize: 11, fontWeight: 700, color: c.escopo_status === 'sem_escopo' ? TEXTM : (c.itens_a_mais > 0 ? RED : GREEN), background: c.escopo_status === 'sem_escopo' ? '#F0E9DE' : (c.itens_a_mais > 0 ? '#F9E4E4' : '#DCEFD7'), border: `1px solid ${c.escopo_status === 'sem_escopo' ? BORDA : (c.itens_a_mais > 0 ? RED : GREEN)}`, borderRadius: 999, padding: '3px 10px', cursor: 'pointer' }}>
                        {exp ? '▾ ' : '▸ '}{c.escopo_status === 'sem_escopo' ? 'escopo não cadastrado' : c.itens_a_mais > 0 ? `${c.itens_a_mais} item(ns) a mais neste mês` : `escopo · ${c.itens_total} ${c.itens_total === 1 ? 'item' : 'itens'}`}
                      </button>
                      <button onClick={() => setEditEscopo(c)} style={btnSec}>Editar escopo</button>
                      <span style={{ fontSize: 11, fontWeight: 700, color: ESPRESSO, background: stCfg(c.status).cor, padding: '3px 10px', borderRadius: 999 }}>{stCfg(c.status).l}</span>
                      {c.status === 'ativo' ? <button onClick={() => mudarStatus(c, 'suspenso')} style={btnSec}>Suspender</button>
                        : c.status === 'suspenso' ? <button onClick={() => mudarStatus(c, 'ativo')} style={btnOk}>Reativar</button>
                        : c.status === 'rascunho' ? <button onClick={() => mudarStatus(c, 'ativo')} style={btnOk}>Ativar</button> : null}
                    </div>

                    {exp && (
                      <div style={{ marginTop: 10, borderTop: `1px solid ${BORDA}`, paddingTop: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                          <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.4, color: TEXTM, fontWeight: 700 }}>Contratado × realizado</div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
                            <button onClick={() => mudarMes(c.contrato_id, -1)} style={arrow}>◀</button>
                            <span style={{ fontSize: 12, fontWeight: 700, minWidth: 74, textAlign: 'center' }}>{rotuloMes(exp.ref)}</span>
                            <button onClick={() => mudarMes(c.contrato_id, 1)} style={arrow}>▶</button>
                          </div>
                        </div>
                        {exp.loading ? <div style={{ fontSize: 12, color: TEXTM }}>Carregando…</div>
                          : exp.erro ? <div style={{ fontSize: 12, color: RED }}>Erro: {exp.erro}</div>
                          : exp.itens.length === 0 ? <div style={{ fontSize: 12, color: TEXTM }}>Escopo não cadastrado. Clique em <b>Editar escopo</b> para cadastrar os itens do contrato.</div>
                          : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 70px 70px 130px', gap: 8, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.3, color: TEXTM, fontWeight: 700, padding: '2px 0' }}>
                                <span>serviço</span><span style={{ textAlign: 'right' }}>contratado</span><span style={{ textAlign: 'right' }}>criados</span><span style={{ textAlign: 'right' }}>entregues</span><span style={{ textAlign: 'right' }}>situação</span>
                              </div>
                              {exp.itens.map((it) => {
                                const s = SIT[it.situacao] ?? SIT.sem_limite
                                return (
                                  <div key={it.item_id} style={{ display: 'grid', gridTemplateColumns: '1fr 90px 70px 70px 130px', gap: 8, fontSize: 12.5, alignItems: 'center', borderTop: `1px solid ${OFFWHITE}`, padding: '5px 0' }}>
                                    <span>{s.ico} {it.servico_nome}{it.servico_id ? '' : ' ⚠️'}<span style={{ color: TEXTM, fontSize: 10.5 }}>{it.periodicidade ? ` · ${it.periodicidade}` : ''}</span></span>
                                    <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: TEXTM }}>{it.sem_limite ? '—' : `${it.quantidade_contratada}${it.unidade ? ' ' + it.unidade : ''}`}</span>
                                    <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{it.criados}</span>
                                    <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: TEXTM }}>{it.entregues}</span>
                                    <span style={{ textAlign: 'right', color: s.cor, fontWeight: 700, fontSize: 11.5 }}>{s.l(it.saldo)}</span>
                                  </div>
                                )
                              })}
                              {exp.jobs_sem_servico.length > 0 && (
                                <div style={{ fontSize: 11, color: AMBER, marginTop: 6, background: '#FFF6E5', border: `1px solid ${AMBER}44`, borderRadius: 8, padding: '6px 8px' }}>
                                  ⚠️ jobs sem serviço vinculado (não contam no escopo): {exp.jobs_sem_servico.map((n) => `${n.qtd} ${n.tipo}`).join(' · ')}. Vincule o serviço no job para entrar no controle.
                                </div>
                              )}
                            </div>
                          )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        <p style={{ fontSize: 11, color: TEXTM, marginTop: 14, fontStyle: 'italic' }}>Conta o job CRIADO (compromisso contra o contrato); "Entregues" = publicado. Passar do contrato avisa, não bloqueia.</p>
      </div>

      {editEscopo && <EscopoModal contrato={editEscopo} servicos={servicos} onClose={() => setEditEscopo(null)} onChanged={() => { void carregar() }} onToast={setToast} />}
      {vincular && <VincularModal contrato={vincular} geContratos={geContratos} onClose={() => setVincular(null)} onDone={() => { setVincular(null); setToast('Contrato vinculado à GE.'); void carregar() }} onToast={setToast} />}
      {toast && <div style={toastStyle}>{toast}</div>}
    </div>
  )
}

// ── Editor de escopo (de-para com o catálogo) ────────────────────────────────
function EscopoModal({ contrato, servicos, onClose, onChanged, onToast }: { contrato: Contrato; servicos: Servico[]; onClose: () => void; onChanged: () => void; onToast: (m: string) => void }) {
  const [itens, setItens] = useState<RealItem[]>([])
  const [loading, setLoading] = useState(true)
  const [novo, setNovo] = useState({ servico_id: '', tipo_servico: '', quantidade_contratada: '', unidade: '', periodicidade: 'mensal' })
  const [erro, setErro] = useState<string | null>(null); const [campo, setCampo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    setLoading(true)
    const { data } = await supabase.rpc('fn_agency_contrato_realizado', { p_contrato_id: contrato.contrato_id, p_periodo_ref: new Date().toISOString().slice(0, 8) + '01' })
    const j = data as { itens?: RealItem[] } | null
    setItens(j?.itens ?? []); setLoading(false)
  }
  useEffect(() => { void load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function pickServico(id: string) {
    const sv = servicos.find((s) => s.id === id)
    setNovo((n) => ({ ...n, servico_id: id, tipo_servico: sv?.nome ?? n.tipo_servico, unidade: sv?.unidade ?? n.unidade, periodicidade: sv?.periodicidade ?? n.periodicidade }))
  }
  async function salvar() {
    setErro(null); setCampo(null)
    if (!novo.tipo_servico.trim()) { setErro('Escolha ou nomeie o serviço.'); setCampo('tipo_servico'); return }
    setBusy(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { data, error } = await supabase.rpc('fn_agency_contrato_item_salvar', { p_contrato_id: contrato.contrato_id, p_item: novo, p_user: user?.id ?? null })
    setBusy(false)
    const r = data as { ok?: boolean; erro?: string; campo?: string } | null
    if (error || !r?.ok) { if (error && !r) { onToast('Não foi possível salvar agora.'); return } setErro(mensagemDeResultado(r)); setCampo(r?.campo ?? null); return }
    setNovo({ servico_id: '', tipo_servico: '', quantidade_contratada: '', unidade: '', periodicidade: 'mensal' }); onToast('Item ALTERADO.'); void load(); onChanged()
  }
  async function excluir(item_id: string) {
    const { data: { user } } = await supabase.auth.getUser()
    const { data } = await supabase.rpc('fn_agency_contrato_item_excluir', { p_item_id: item_id, p_user: user?.id ?? null })
    if ((data as { ok?: boolean } | null)?.ok) { onToast('Item EXCLUÍDO.'); void load(); onChanged() }
  }

  return (
    <Modal titulo={`Escopo — ${contrato.cliente_nome}`} onClose={onClose}>
      <div style={{ fontSize: 12, color: TEXTM, marginBottom: 8 }}>Cada item casa com um serviço do catálogo (de-para). Sem quantidade = <b>sem limite contratado</b> (não gera alerta).</div>
      {loading ? <div style={{ fontSize: 12, color: TEXTM }}>Carregando…</div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
          {itens.length === 0 && <div style={{ fontSize: 12, color: TEXTM, fontStyle: 'italic' }}>Nenhum item ainda.</div>}
          {itens.map((it) => (
            <div key={it.item_id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, borderTop: `1px solid ${OFFWHITE}`, padding: '5px 0' }}>
              <span style={{ flex: 1 }}>{it.servico_id ? '🔗' : '⚠️'} {it.servico_nome} <span style={{ color: TEXTM }}>· {it.sem_limite ? 'sem limite' : `${it.quantidade_contratada}${it.unidade ? ' ' + it.unidade : ''}`}{it.periodicidade ? ` · ${it.periodicidade}` : ''}</span></span>
              <button onClick={() => void excluir(it.item_id)} style={{ border: 'none', background: 'none', color: RED, cursor: 'pointer', fontSize: 12 }}>excluir</button>
            </div>
          ))}
        </div>
      )}
      <div style={{ borderTop: `1px solid ${BORDA}`, paddingTop: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: TEXTM, marginBottom: 6 }}>Adicionar item</div>
        {erro && <div style={{ background: '#F9E4E4', color: RED, padding: '6px 10px', borderRadius: 7, fontSize: 12, marginBottom: 8 }}>{erro}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <select value={novo.servico_id} onChange={(e) => pickServico(e.target.value)} style={{ ...inp, gridColumn: '1 / -1' }}>
            <option value="">— serviço do catálogo (de-para) —</option>
            {servicos.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
          </select>
          <input value={novo.tipo_servico} onChange={(e) => setNovo({ ...novo, tipo_servico: e.target.value })} placeholder="nome do item (do contrato) *" style={{ ...inp, gridColumn: '1 / -1', ...estiloBordaInput(campo === 'tipo_servico' ? 'x' : null) }} />
          <input value={novo.quantidade_contratada} onChange={(e) => setNovo({ ...novo, quantidade_contratada: e.target.value })} placeholder="quantidade (vazio = sem limite)" inputMode="numeric" style={{ ...inp, ...estiloBordaInput(campo === 'quantidade_contratada' ? 'x' : null) }} />
          <input value={novo.unidade} onChange={(e) => setNovo({ ...novo, unidade: e.target.value })} placeholder="unidade (post, vídeo…)" style={inp} />
          <select value={novo.periodicidade} onChange={(e) => setNovo({ ...novo, periodicidade: e.target.value })} style={{ ...inp, gridColumn: '1 / -1' }}>
            {PERIODICIDADES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
          <button disabled={busy || !novo.tipo_servico.trim()} onClick={() => void salvar()} style={{ ...btnOk, background: busy || !novo.tipo_servico.trim() ? '#ccc' : DOURADO, color: '#fff', border: 'none', fontWeight: 700 }}>{busy ? 'Salvando…' : '+ Adicionar item'}</button>
        </div>
      </div>
    </Modal>
  )
}

// ── Vincular ao contrato oficial da GE ───────────────────────────────────────
function VincularModal({ contrato, geContratos, onClose, onDone, onToast }: { contrato: Contrato; geContratos: GeContrato[]; onClose: () => void; onDone: () => void; onToast: (m: string) => void }) {
  const [sel, setSel] = useState(''); const [busy, setBusy] = useState(false); const [erro, setErro] = useState<string | null>(null)
  async function vincular() {
    if (!sel) { setErro('Escolha o contrato da GE.'); return }
    setBusy(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { data, error } = await supabase.rpc('fn_agency_contrato_vincular_erp', { p_agency_contrato_id: contrato.contrato_id, p_erp_contrato_id: sel, p_user: user?.id ?? null })
    setBusy(false)
    const r = data as { ok?: boolean; erro?: string } | null
    if (error || !r?.ok) { setErro(r?.erro === 'contrato_ge_ja_vinculado' ? 'Este contrato da GE já está vinculado a outro contrato de agência.' : mensagemDeResultado(r)); return }
    onDone()
  }
  return (
    <Modal titulo="Vincular ao contrato da GE" onClose={onClose}>
      <div style={{ fontSize: 12, color: TEXTM, marginBottom: 10 }}>O contrato oficial (com o PDF, a vigência e o faturamento) vive na Gestão Empresarial. Vincule para o fee vir de lá — uma fonte só.</div>
      {erro && <div style={{ background: '#F9E4E4', color: RED, padding: '6px 10px', borderRadius: 7, fontSize: 12, marginBottom: 8 }}>{erro}</div>}
      {geContratos.length === 0 ? (
        <div style={{ fontSize: 12.5, color: AMBER, background: '#FFF6E5', borderRadius: 8, padding: '10px 12px' }}>Não há contrato da GE para esta empresa ainda. Crie o contrato na Gestão Empresarial primeiro — é ele que carrega o PDF e o faturamento.</div>
      ) : (
        <>
          <select value={sel} onChange={(e) => setSel(e.target.value)} style={{ ...inp, width: '100%' }}>
            <option value="">— contrato da GE —</option>
            {geContratos.map((g) => <option key={g.id} value={g.id}>{g.numero ? `${g.numero} · ` : ''}{g.cliente_nome ?? '—'}{g.valor_atual ? ` · ${brl(g.valor_atual)}/mês` : ''}</option>)}
          </select>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
            <button onClick={onClose} style={btnSec}>Cancelar</button>
            <button disabled={busy || !sel} onClick={() => void vincular()} style={{ ...btnOk, background: busy || !sel ? '#ccc' : DOURADO, color: '#fff', border: 'none' }}>{busy ? 'Vinculando…' : 'Vincular'}</button>
          </div>
        </>
      )}
    </Modal>
  )
}

function Modal({ titulo, children, onClose }: { titulo: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, padding: 18, width: 'min(560px,100%)', maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>{titulo}</div>
        {children}
      </div>
    </div>
  )
}
function Kpi({ l, v, cor }: { l: string; v: string; cor?: string }) {
  return <div style={{ background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 12, padding: '12px 14px' }}>
    <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: TEXTM, fontWeight: 700 }}>{l}</div>
    <div style={{ fontSize: 22, fontWeight: 700, color: cor ?? ESPRESSO, marginTop: 2 }}>{v}</div>
  </div>
}
const btnSec: CSSProperties = { border: `1px solid ${BORDA}`, color: ESPRESSO, background: '#fff', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer', minHeight: 40 }
const btnOk: CSSProperties = { border: `1px solid ${GREEN}`, color: GREEN, background: '#fff', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer', fontWeight: 600, minHeight: 40 }
const arrow: CSSProperties = { border: `1px solid ${BORDA}`, background: '#fff', color: ESPRESSO, borderRadius: 6, padding: '2px 8px', cursor: 'pointer', fontSize: 11 }
const toastStyle: CSSProperties = { position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: ESPRESSO, color: '#fff', padding: '10px 18px', borderRadius: 999, fontSize: 13, zIndex: 90 }
