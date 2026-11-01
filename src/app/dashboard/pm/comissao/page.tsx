'use client'
// COMISSÃO (P&M · Financeiro). Sobre agency_comissao. Fechamento por competência. Escopo por
// company_id (RD-45). Elo erp_pagar (lancamento_id) fica wired — post só após régua RD-53. Tema Espresso.
// RD-98 (auditoria 31/10): CRUD completo (incluir/editar lançamento) + exclusão rastreável (soft-delete).
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import AjudaCampo from '@/components/ajuda/AjudaCampo'

const ROTA = '/dashboard/pm/comissao'

const ESPRESSO = '#3D2314'; const OFFWHITE = '#FAF7F2'; const DOURADO = '#C8941A'
const BORDA = '#E7DED3'; const TEXTM = '#6b5444'; const GREEN = '#1F5A1F'; const RED = '#7A1F1F'
const brl = (v: number | null | undefined) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const STATUS: Record<string, { l: string; cor: string }> = {
  prevista: { l: 'Prevista', cor: '#FFF3D6' }, a_pagar: { l: 'A pagar', cor: '#FCE9C2' },
  paga: { l: 'Paga', cor: '#DCEFD7' }, cancelada: { l: 'Cancelada', cor: '#F4D6D6' },
}
const stCfg = (v: string) => STATUS[v] ?? { l: v, cor: OFFWHITE }
const compL = (d: string | null) => { if (!d) return '—'; const [y, m] = d.slice(0, 7).split('-'); return `${m}/${y}` }
// competência <input type=month> usa 'YYYY-MM'; o banco guarda uma date (1º dia do mês)
const toMonth = (d: string | null) => (d ? d.slice(0, 7) : '')
const fromMonth = (m: string) => (m ? `${m}-01` : null)

type Comissao = { id: string; job_id: string | null; vendedor_id: string | null; base_valor: number | null; percentual: number | null; valor_comissao: number | null; competencia: string | null; status: string; lancamento_id: string | null }
type JobOpt = { id: string; titulo: string }
type Pessoa = { id: string; nome: string }
type FormState = { id: string | null; vendedor_id: string; job_id: string; base_valor: string; percentual: string; competencia: string }

const FORM_VAZIO: FormState = { id: null, vendedor_id: '', job_id: '', base_valor: '', percentual: '', competencia: '' }

export default function ComissaoPage() {
  const { selInfo, companyIds } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : (companyIds[0] ?? null)
  const [comissoes, setComissoes] = useState<Comissao[]>([]); const [jobs, setJobs] = useState<JobOpt[]>([])
  const [vendedores, setVendedores] = useState<Pessoa[]>([])
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [toast, setToast] = useState<string | null>(null)
  const [form, setForm] = useState<FormState | null>(null)

  const carregar = async () => {
    if (!empresa) { setLoading(false); return }
    setLoading(true)
    const [c, j, u] = await Promise.all([
      // exclusão rastreável (RD-98): não mostra comissão soft-deleted (deleted_em)
      supabase.from('agency_comissao').select('*').eq('company_id', empresa).is('deleted_em', null).order('competencia', { ascending: false }),
      supabase.from('agency_jobs').select('id, titulo').eq('company_id', empresa).is('excluido_em', null),
      supabase.rpc('fn_usuarios_da_empresa', { p_company_id: empresa }),
    ])
    setComissoes((c.data ?? []) as Comissao[]); setJobs((j.data ?? []) as JobOpt[])
    setVendedores(((u.data ?? []) as { id: string; full_name: string | null; email: string }[]).map((x) => ({ id: x.id, nome: x.full_name ?? x.email })))
    setLoading(false)
  }
  useEffect(() => { void carregar() }, [empresa]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t) }, [toast])
  const jobTit = (id: string | null) => jobs.find((x) => x.id === id)?.titulo ?? '—'
  const vendNome = (id: string | null) => vendedores.find((x) => x.id === id)?.nome ?? '—'

  const kpis = useMemo(() => ({
    prevista: comissoes.filter((c) => c.status === 'prevista').reduce((s, c) => s + Number(c.valor_comissao ?? 0), 0),
    aPagar: comissoes.filter((c) => c.status === 'a_pagar').reduce((s, c) => s + Number(c.valor_comissao ?? 0), 0),
    paga: comissoes.filter((c) => c.status === 'paga').reduce((s, c) => s + Number(c.valor_comissao ?? 0), 0),
  }), [comissoes])

  const valorPrevia = useMemo(() => {
    if (!form) return 0
    const b = Number(form.base_valor.replace(',', '.')) || 0; const p = Number(form.percentual.replace(',', '.')) || 0
    return Math.round(b * p) / 100
  }, [form])

  async function fechar() {
    if (!empresa) return
    const prevs = comissoes.filter((c) => c.status === 'prevista')
    if (prevs.length === 0) { setToast('Nenhuma comissão prevista pra fechar.'); return }
    if (!confirm(`Fechar ${prevs.length} comissão(ões) prevista(s)? Cada uma vira conta a pagar (erp_pagar).`)) return
    setBusy(true)
    for (const c of prevs) { await supabase.rpc('fn_agency_comissao_aprovar', { p_comissao_id: c.id }) }
    setBusy(false); setToast(`${prevs.length} comissão(ões) → A PAGAR (lançadas no financeiro).`); void carregar()
  }
  async function aprovar(c: Comissao) {
    if (!confirm('Aprovar esta comissão? Ela vira uma conta a pagar no financeiro (erp_pagar).')) return
    setBusy(true)
    const { data, error } = await supabase.rpc('fn_agency_comissao_aprovar', { p_comissao_id: c.id })
    setBusy(false)
    const j = data as { ok?: boolean; erro?: string } | null
    if (error || !j?.ok) { setToast(`Erro: ${error?.message ?? j?.erro ?? 'falhou'}`); return }
    setToast('Comissão APROVADA → a pagar (lançada no financeiro).'); void carregar()
  }
  async function marcarPaga(c: Comissao) {
    if (!confirm('Marcar esta comissão como PAGA? Fica registrado quem marcou e quando.')) return
    setBusy(true)
    const { data, error } = await supabase.rpc('fn_agency_comissao_marcar_paga', { p_comissao_id: c.id })
    setBusy(false)
    const j = data as { ok?: boolean; erro?: string } | null
    if (error || !j?.ok) { setToast(`Erro: ${error?.message ?? j?.erro ?? 'falhou'}`); return }
    setToast('Comissão marcada como PAGA.'); void carregar()
  }

  function abrirNovo() { setForm({ ...FORM_VAZIO, competencia: toMonth(new Date().toISOString()) }) }
  function abrirEditar(c: Comissao) {
    setForm({ id: c.id, vendedor_id: c.vendedor_id ?? '', job_id: c.job_id ?? '', base_valor: String(c.base_valor ?? ''), percentual: String(c.percentual ?? ''), competencia: toMonth(c.competencia) })
  }
  async function salvar() {
    if (!empresa || !form) return
    if (!form.vendedor_id) { setToast('Escolha o vendedor.'); return }
    if (!form.competencia) { setToast('Informe a competência.'); return }
    const base = Number(form.base_valor.replace(',', '.')); const pct = Number(form.percentual.replace(',', '.'))
    if (!(base >= 0) || !(pct >= 0)) { setToast('Base e percentual não podem ser negativos.'); return }
    setBusy(true)
    const args = {
      p_vendedor_id: form.vendedor_id, p_base_valor: base, p_percentual: pct,
      p_competencia: fromMonth(form.competencia), p_job_id: form.job_id || null,
    }
    const { data, error } = form.id
      ? await supabase.rpc('fn_agency_comissao_editar', { p_id: form.id, ...args })
      : await supabase.rpc('fn_agency_comissao_criar', { p_company_id: empresa, ...args })
    setBusy(false)
    const j = data as { ok?: boolean; erro?: string } | null
    if (error || !j?.ok) { setToast(`Erro: ${error?.message ?? j?.erro ?? 'falhou'}`); return }
    setForm(null); setToast(form.id ? 'Comissão atualizada.' : 'Comissão lançada (prevista).'); void carregar()
  }
  async function excluir(c: Comissao) {
    const motivo = prompt('Motivo da exclusão desta comissão (fica registrado na auditoria):')
    if (motivo === null) return
    setBusy(true)
    const { data, error } = await supabase.rpc('fn_agency_comissao_excluir', { p_id: c.id, p_motivo: motivo || null })
    setBusy(false)
    const j = data as { ok?: boolean; erro?: string } | null
    if (error || !j?.ok) { setToast(`Erro: ${error?.message ?? j?.erro ?? 'falhou'}`); return }
    setToast('Comissão excluída (registrada na auditoria).'); void carregar()
  }

  if (!empresa) return <div style={{ padding: 32, color: TEXTM, background: OFFWHITE, minHeight: '100vh' }}>Selecione uma empresa no topo.</div>

  return (
    <div style={{ background: OFFWHITE, minHeight: '100vh', padding: '24px 18px', color: ESPRESSO }}>
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: DOURADO, fontWeight: 700 }}>💰 P&amp;M · Financeiro</div>
            <h1 style={{ fontSize: 26, fontWeight: 700, margin: '2px 0 0' }}>Comissão<AjudaCampo chave="pm.comissao.tela" rota={ROTA} /></h1>
            <p style={{ fontSize: 13, color: TEXTM, margin: '4px 0 0' }}>Por vendedor/competência. Aprovar lança no contas a pagar (erp_pagar).</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center' }}><button disabled={busy} onClick={abrirNovo} style={btnPri} data-testid="comissao-novo">+ Novo lançamento</button><AjudaCampo chave="pm.comissao.acao_novo" rota={ROTA} /></span>
            <span style={{ display: 'inline-flex', alignItems: 'center' }}><button disabled={busy} onClick={fechar} style={btnSec}>Fechar previstas</button><AjudaCampo chave="pm.comissao.acao_fechar_previstas" rota={ROTA} /></span>
          </div>
        </header>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px,1fr))', gap: 10, marginBottom: 14 }}>
          <Kpi l="Prevista" v={brl(kpis.prevista)} chave="pm.comissao.kpi_prevista" />
          <Kpi l="A pagar" v={brl(kpis.aPagar)} cor={DOURADO} chave="pm.comissao.kpi_a_pagar" />
          <Kpi l="Paga" v={brl(kpis.paga)} cor={GREEN} chave="pm.comissao.kpi_paga" />
        </div>

        {loading ? <div style={{ padding: 40, textAlign: 'center', color: TEXTM }}>Carregando…</div>
          : comissoes.length === 0 ? <div style={{ padding: 40, textAlign: 'center', color: TEXTM, background: '#fff', border: `1px dashed ${BORDA}`, borderRadius: 12 }}>Sem comissões no período. Use “+ Novo lançamento” para registrar a primeira.</div>
          : (
            <div style={{ overflowX: 'auto', border: `1px solid ${BORDA}`, borderRadius: 12, background: '#fff' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 720 }}>
                <thead style={{ background: OFFWHITE }}><tr><Th chave="pm.comissao.col_competencia">Competência</Th><Th chave="pm.comissao.col_job">Job</Th><Th chave="pm.comissao.col_vendedor">Vendedor</Th><Th chave="pm.comissao.col_base">Base</Th><Th chave="pm.comissao.col_percentual">%</Th><Th chave="pm.comissao.col_comissao">Comissão</Th><Th chave="pm.comissao.col_status">Status</Th><Th chave="pm.comissao.col_acoes">Ações</Th></tr></thead>
                <tbody>
                  {comissoes.map((c) => {
                    const cfg = stCfg(c.status)
                    const editavel = c.status === 'prevista'
                    return (
                      <tr key={c.id} style={{ borderTop: `1px solid ${BORDA}` }} data-testid={`comissao-${c.id}`}>
                        <Td>{compL(c.competencia)}</Td>
                        <Td>{jobTit(c.job_id)}</Td>
                        <Td>{vendNome(c.vendedor_id)}</Td>
                        <Td>{brl(Number(c.base_valor ?? 0))}</Td>
                        <Td>{Number(c.percentual ?? 0)}%</Td>
                        <Td style={{ fontWeight: 700 }}>{brl(Number(c.valor_comissao ?? 0))}</Td>
                        <Td><span style={{ fontSize: 11, fontWeight: 700, background: cfg.cor, padding: '2px 8px', borderRadius: 999 }}>{cfg.l}</span></Td>
                        <Td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                            {c.status === 'prevista' && <span style={{ display: 'inline-flex', alignItems: 'center' }}><button disabled={busy} onClick={() => aprovar(c)} style={btnOk}>Aprovar → a pagar</button><AjudaCampo chave="pm.comissao.acao_aprovar" rota={ROTA} /></span>}
                            {c.status === 'a_pagar' && <span style={{ display: 'inline-flex', alignItems: 'center' }}><button disabled={busy} onClick={() => marcarPaga(c)} style={btnOk}>Marcar paga</button><AjudaCampo chave="pm.comissao.acao_marcar_paga" rota={ROTA} /></span>}
                            {editavel && <span style={{ display: 'inline-flex', alignItems: 'center' }}><button disabled={busy} onClick={() => abrirEditar(c)} style={btnGhost} data-testid={`comissao-editar-${c.id}`}>Editar</button><AjudaCampo chave="pm.comissao.acao_editar" rota={ROTA} /></span>}
                            {editavel && <span style={{ display: 'inline-flex', alignItems: 'center' }}><button disabled={busy} onClick={() => excluir(c)} style={btnDel} data-testid={`comissao-excluir-${c.id}`}>Excluir</button><AjudaCampo chave="pm.comissao.acao_excluir" rota={ROTA} /></span>}
                          </div>
                        </Td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        <p style={{ fontSize: 11, color: TEXTM, marginTop: 14, fontStyle: 'italic' }}>
          Aprovar uma comissão a lança direto no <strong>contas a pagar</strong> da empresa (erp_pagar). Depois é só pagar no financeiro.
          Só comissão <strong>prevista</strong> pode ser editada ou excluída — a pagar/paga exige acerto no financeiro.
        </p>
      </div>

      {form && (
        <div role="dialog" aria-modal="true" style={modalWrap} onClick={() => !busy && setForm(null)}>
          <div style={modalBox} onClick={(e) => e.stopPropagation()} data-testid="comissao-form">
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 12px' }}>{form.id ? 'Editar comissão' : 'Novo lançamento de comissão'}</h2>
            <Campo label="Vendedor" chave="pm.comissao.campo_vendedor">
              <select value={form.vendedor_id} onChange={(e) => setForm({ ...form, vendedor_id: e.target.value })} style={inp} data-testid="comissao-f-vendedor">
                <option value="">Selecione…</option>
                {vendedores.map((v) => <option key={v.id} value={v.id}>{v.nome}</option>)}
              </select>
            </Campo>
            <Campo label="Job (opcional)" chave="pm.comissao.campo_job">
              <select value={form.job_id} onChange={(e) => setForm({ ...form, job_id: e.target.value })} style={inp} data-testid="comissao-f-job">
                <option value="">— Avulsa (sem job) —</option>
                {jobs.map((j) => <option key={j.id} value={j.id}>{j.titulo}</option>)}
              </select>
            </Campo>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Campo label="Base (R$)" chave="pm.comissao.campo_base" flex>
                <input type="number" min="0" step="0.01" value={form.base_valor} onChange={(e) => setForm({ ...form, base_valor: e.target.value })} style={inp} data-testid="comissao-f-base" />
              </Campo>
              <Campo label="Percentual (%)" chave="pm.comissao.campo_percentual" flex>
                <input type="number" min="0" step="0.01" value={form.percentual} onChange={(e) => setForm({ ...form, percentual: e.target.value })} style={inp} data-testid="comissao-f-percentual" />
              </Campo>
            </div>
            <Campo label="Competência" chave="pm.comissao.campo_competencia">
              <input type="month" value={form.competencia} onChange={(e) => setForm({ ...form, competencia: e.target.value })} style={inp} data-testid="comissao-f-competencia" />
            </Campo>
            <div style={{ fontSize: 13, color: TEXTM, margin: '6px 0 12px' }}>Comissão calculada: <strong style={{ color: ESPRESSO }} data-testid="comissao-f-previa">{brl(valorPrevia)}</strong></div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button disabled={busy} onClick={() => setForm(null)} style={btnGhost}>Cancelar</button>
              <button disabled={busy} onClick={salvar} style={btnPri} data-testid="comissao-f-salvar">{form.id ? 'Salvar' : 'Lançar comissão'}</button>
            </div>
          </div>
        </div>
      )}
      {toast && <div style={toastStyle}>{toast}</div>}
    </div>
  )
}

function Campo({ label, chave, children, flex }: { label: string; chave: string; children: React.ReactNode; flex?: boolean }) {
  return <label style={{ display: 'block', marginBottom: 10, flex: flex ? '1 1 140px' : undefined }}>
    <span style={{ fontSize: 12, fontWeight: 700, color: TEXTM, display: 'inline-flex', alignItems: 'center' }}>{label}<AjudaCampo chave={chave} rota={ROTA} /></span>
    {children}
  </label>
}
function Kpi({ l, v, cor, chave }: { l: string; v: string; cor?: string; chave?: string }) {
  return <div style={{ background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 12, padding: '12px 14px' }}>
    <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: TEXTM, fontWeight: 700 }}>{l}{chave && <AjudaCampo chave={chave} rota={ROTA} />}</div>
    <div style={{ fontSize: 22, fontWeight: 700, color: cor ?? ESPRESSO, marginTop: 2 }}>{v}</div>
  </div>
}
function Th({ children, chave }: { children?: React.ReactNode; chave?: string }) { return <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: TEXTM }}>{children}{chave && <AjudaCampo chave={chave} rota={ROTA} />}</th> }
function Td({ children, style }: { children?: React.ReactNode; style?: CSSProperties }) { return <td style={{ padding: '8px 12px', color: ESPRESSO, ...style }}>{children}</td> }
const btnPri: CSSProperties = { border: 'none', background: DOURADO, color: '#fff', borderRadius: 10, padding: '10px 16px', cursor: 'pointer', fontWeight: 700, minHeight: 42 }
const btnSec: CSSProperties = { border: `1px solid ${ESPRESSO}`, background: '#fff', color: ESPRESSO, borderRadius: 10, padding: '10px 16px', cursor: 'pointer', fontWeight: 700, minHeight: 42 }
const btnOk: CSSProperties = { border: `1px solid ${GREEN}`, color: GREEN, background: '#fff', borderRadius: 8, padding: '5px 10px', fontSize: 12, cursor: 'pointer', fontWeight: 600, minHeight: 36 }
const btnGhost: CSSProperties = { border: `1px solid ${BORDA}`, color: ESPRESSO, background: '#fff', borderRadius: 8, padding: '5px 10px', fontSize: 12, cursor: 'pointer', fontWeight: 600, minHeight: 36 }
const btnDel: CSSProperties = { border: `1px solid ${RED}`, color: RED, background: '#fff', borderRadius: 8, padding: '5px 10px', fontSize: 12, cursor: 'pointer', fontWeight: 600, minHeight: 36 }
const inp: CSSProperties = { width: '100%', border: `1px solid ${BORDA}`, borderRadius: 8, padding: '9px 10px', fontSize: 14, marginTop: 4, boxSizing: 'border-box', minHeight: 40 }
const toastStyle: CSSProperties = { position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: ESPRESSO, color: '#fff', padding: '10px 18px', borderRadius: 999, fontSize: 13, zIndex: 60 }
const modalWrap: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 70 }
const modalBox: CSSProperties = { background: '#fff', borderRadius: 16, padding: 20, width: '100%', maxWidth: 460, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }
