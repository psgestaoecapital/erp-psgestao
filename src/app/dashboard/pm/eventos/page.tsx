'use client'
// P&M · Eventos & Produções (CEO 31/10). Lista + CRUD completo (incluir/editar/excluir rastreável) sobre
// agency_eventos, por company_id (RD-45). Escrita só pelas RPCs fn_pm_evento_salvar/_excluir (guarda de empresa,
// audit_log_global, soft-delete). "?" em todo campo/indicador/ação (RD-95). Orçamento previsto aqui; o realizado
// virá do financeiro da GE (erp_pagar) numa próxima PR. Tema Espresso.
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import AjudaCampo from '@/components/ajuda/AjudaCampo'

const ROTA = '/dashboard/pm/eventos'
const ESPRESSO = '#3D2314'; const OFFWHITE = '#FAF7F2'; const DOURADO = '#C8941A'
const BORDA = '#E7DED3'; const TEXTM = '#6b5444'; const GREEN = '#1F5A1F'; const RED = '#7A1F1F'
const brl = (v: number | null | undefined) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dataBR = (d: string | null) => (d ? d.split('-').reverse().join('/') : '—')

const STATUS: { v: string; l: string; cor: string }[] = [
  { v: 'planejado', l: 'Planejado', cor: '#FFF3D6' }, { v: 'confirmado', l: 'Confirmado', cor: '#FCE9C2' },
  { v: 'realizado', l: 'Realizado', cor: '#DCEFD7' }, { v: 'cancelado', l: 'Cancelado', cor: '#F4D6D6' },
]
const stCfg = (v: string) => STATUS.find((s) => s.v === v) ?? { v, l: v, cor: OFFWHITE }

type Evento = { id: string; cliente_id: string | null; nome: string; tipo: string | null; data_inicio: string | null; data_fim: string | null; local: string | null; status: string; orcamento_previsto: number | null; responsavel_id: string | null; observacoes: string | null }
type Cli = { id: string; nome: string }
type Pessoa = { id: string; nome: string }
type FormState = { id: string | null; nome: string; cliente_id: string; tipo: string; data_inicio: string; data_fim: string; local: string; status: string; orcamento_previsto: string; responsavel_id: string; observacoes: string }
const FORM_VAZIO: FormState = { id: null, nome: '', cliente_id: '', tipo: '', data_inicio: '', data_fim: '', local: '', status: 'planejado', orcamento_previsto: '', responsavel_id: '', observacoes: '' }

export default function EventosPage() {
  const { selInfo, companyIds } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : (companyIds[0] ?? null)
  const [eventos, setEventos] = useState<Evento[]>([]); const [clientes, setClientes] = useState<Cli[]>([]); const [pessoas, setPessoas] = useState<Pessoa[]>([])
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [toast, setToast] = useState<string | null>(null)
  const [form, setForm] = useState<FormState | null>(null)
  const [fCliente, setFCliente] = useState(''); const [fStatus, setFStatus] = useState(''); const [fDe, setFDe] = useState(''); const [fAte, setFAte] = useState('')

  const carregar = async () => {
    if (!empresa) { setLoading(false); return }
    setLoading(true)
    const [e, c, u] = await Promise.all([
      supabase.from('agency_eventos').select('*').eq('company_id', empresa).is('excluido_em', null).order('data_inicio', { ascending: false, nullsFirst: false }),
      supabase.from('erp_clientes').select('id, nome_fantasia, razao_social').eq('company_id', empresa).eq('ativo', true),
      supabase.rpc('fn_usuarios_da_empresa', { p_company_id: empresa }),
    ])
    setEventos((e.data ?? []) as Evento[])
    setClientes(((c.data ?? []) as { id: string; nome_fantasia: string | null; razao_social: string | null }[]).map((x) => ({ id: x.id, nome: x.nome_fantasia || x.razao_social || 'cliente' })))
    setPessoas(((u.data ?? []) as { id: string; full_name: string | null; email: string }[]).map((x) => ({ id: x.id, nome: x.full_name ?? x.email })))
    setLoading(false)
  }
  useEffect(() => { void carregar() }, [empresa]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t) }, [toast])
  const nomeCli = (id: string | null) => clientes.find((x) => x.id === id)?.nome ?? '—'
  const nomePessoa = (id: string | null) => pessoas.find((x) => x.id === id)?.nome ?? '—'

  const filtrados = useMemo(() => eventos.filter((e) =>
    (!fCliente || e.cliente_id === fCliente) && (!fStatus || e.status === fStatus) &&
    (!fDe || (e.data_inicio ?? '') >= fDe) && (!fAte || (e.data_inicio ?? '') <= fAte)
  ), [eventos, fCliente, fStatus, fDe, fAte])

  const hoje = new Date().toISOString().slice(0, 10)
  const kpis = useMemo(() => ({
    total: filtrados.length,
    proximos: filtrados.filter((e) => ['planejado', 'confirmado'].includes(e.status) && (e.data_inicio ?? '') >= hoje).length,
    orcamento: filtrados.reduce((s, e) => s + Number(e.orcamento_previsto ?? 0), 0),
  }), [filtrados, hoje])

  function abrirNovo() { setForm({ ...FORM_VAZIO }) }
  function abrirEditar(e: Evento) {
    setForm({ id: e.id, nome: e.nome, cliente_id: e.cliente_id ?? '', tipo: e.tipo ?? '', data_inicio: e.data_inicio ?? '', data_fim: e.data_fim ?? '', local: e.local ?? '', status: e.status, orcamento_previsto: e.orcamento_previsto != null ? String(e.orcamento_previsto) : '', responsavel_id: e.responsavel_id ?? '', observacoes: e.observacoes ?? '' })
  }
  async function salvar() {
    if (!empresa || !form) return
    if (!form.nome.trim()) { setToast('Informe o nome do evento.'); return }
    setBusy(true)
    const dados = {
      nome: form.nome.trim(), cliente_id: form.cliente_id || null, tipo: form.tipo || null,
      data_inicio: form.data_inicio || null, data_fim: form.data_fim || null, local: form.local || null,
      status: form.status, orcamento_previsto: form.orcamento_previsto.replace(',', '.') || null,
      responsavel_id: form.responsavel_id || null, observacoes: form.observacoes || null,
    }
    const { data, error } = await supabase.rpc('fn_pm_evento_salvar', { p_company_id: empresa, p_id: form.id, p_dados: dados })
    setBusy(false)
    const j = data as { ok?: boolean; erro?: string } | null
    if (error || !j?.ok) { setToast(`Erro: ${error?.message ?? j?.erro ?? 'falhou'}`); return }
    setForm(null); setToast(form.id ? 'Evento atualizado.' : 'Evento criado.'); void carregar()
  }
  async function excluir(e: Evento) {
    const motivo = prompt(`Excluir o evento "${e.nome}"? Informe o motivo (fica na auditoria):`)
    if (motivo === null) return
    setBusy(true)
    const { data, error } = await supabase.rpc('fn_pm_evento_excluir', { p_id: e.id, p_motivo: motivo || null })
    setBusy(false)
    const j = data as { ok?: boolean; erro?: string } | null
    if (error || !j?.ok) { setToast(`Erro: ${error?.message ?? j?.erro ?? 'falhou'}`); return }
    setToast('Evento excluído (registrado na auditoria).'); void carregar()
  }

  if (!empresa) return <div style={{ padding: 32, color: TEXTM, background: OFFWHITE, minHeight: '100vh' }}>Selecione uma empresa no topo.</div>

  return (
    <div style={{ background: OFFWHITE, minHeight: '100vh', padding: '24px 18px', color: ESPRESSO }}>
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: DOURADO, fontWeight: 700 }}>🎬 P&amp;M · Produção</div>
            <h1 style={{ fontSize: 26, fontWeight: 700, margin: '2px 0 0' }}>Eventos &amp; Produções<AjudaCampo chave="pm.eventos.tela" rota={ROTA} /></h1>
            <p style={{ fontSize: 13, color: TEXTM, margin: '4px 0 0' }}>A agenda das produções da agência: datas, local, cliente, status e orçamento.</p>
          </div>
          <span style={{ display: 'inline-flex', alignItems: 'center' }}><button disabled={busy} onClick={abrirNovo} style={btnPri} data-testid="evento-novo">+ Novo evento</button><AjudaCampo chave="pm.eventos.acao_novo" rota={ROTA} /></span>
        </header>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px,1fr))', gap: 10, marginBottom: 12 }}>
          <Kpi l="Eventos" v={String(kpis.total)} chave="pm.eventos.kpi_total" />
          <Kpi l="Próximos" v={String(kpis.proximos)} cor={DOURADO} chave="pm.eventos.kpi_proximos" />
          <Kpi l="Orçamento previsto" v={brl(kpis.orcamento)} chave="pm.eventos.kpi_orcamento" />
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12, background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 12, padding: 10 }}>
          <Filtro label="Cliente" chave="pm.eventos.filtro_cliente">
            <select value={fCliente} onChange={(e) => setFCliente(e.target.value)} style={inp} data-testid="evento-filtro-cliente">
              <option value="">Todos</option>{clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </Filtro>
          <Filtro label="Status" chave="pm.eventos.filtro_status">
            <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} style={inp} data-testid="evento-filtro-status">
              <option value="">Todos</option>{STATUS.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
            </select>
          </Filtro>
          <Filtro label="De" chave="pm.eventos.filtro_status"><input type="date" value={fDe} onChange={(e) => setFDe(e.target.value)} style={inp} data-testid="evento-filtro-de" /></Filtro>
          <Filtro label="Até" chave="pm.eventos.filtro_status"><input type="date" value={fAte} onChange={(e) => setFAte(e.target.value)} style={inp} data-testid="evento-filtro-ate" /></Filtro>
        </div>

        {loading ? <div style={{ padding: 40, textAlign: 'center', color: TEXTM }}>Carregando…</div>
          : filtrados.length === 0 ? <div style={{ padding: 40, textAlign: 'center', color: TEXTM, background: '#fff', border: `1px dashed ${BORDA}`, borderRadius: 12 }}>Nenhum evento no filtro. Use “+ Novo evento” para cadastrar.</div>
          : (
            <div style={{ overflowX: 'auto', border: `1px solid ${BORDA}`, borderRadius: 12, background: '#fff' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 760 }}>
                <thead style={{ background: OFFWHITE }}><tr><Th chave="pm.eventos.campo_nome">Evento</Th><Th chave="pm.eventos.campo_cliente">Cliente</Th><Th chave="pm.eventos.campo_data_inicio">Início</Th><Th chave="pm.eventos.campo_local">Local</Th><Th chave="pm.eventos.campo_orcamento">Orçamento</Th><Th chave="pm.eventos.campo_status">Status</Th><Th chave="pm.eventos.col_acoes">Ações</Th></tr></thead>
                <tbody>
                  {filtrados.map((e) => {
                    const cfg = stCfg(e.status)
                    return (
                      <tr key={e.id} style={{ borderTop: `1px solid ${BORDA}` }} data-testid={`evento-${e.id}`}>
                        <Td><b>{e.nome}</b>{e.tipo && <span style={{ color: TEXTM, fontSize: 12 }}> · {e.tipo}</span>}</Td>
                        <Td>{nomeCli(e.cliente_id)}</Td>
                        <Td>{dataBR(e.data_inicio)}{e.data_fim && e.data_fim !== e.data_inicio ? `–${dataBR(e.data_fim)}` : ''}</Td>
                        <Td style={{ color: TEXTM }}>{e.local ?? '—'}</Td>
                        <Td>{brl(Number(e.orcamento_previsto ?? 0))}</Td>
                        <Td><span style={{ fontSize: 11, fontWeight: 700, background: cfg.cor, padding: '2px 8px', borderRadius: 999 }}>{cfg.l}</span></Td>
                        <Td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center' }}><button disabled={busy} onClick={() => abrirEditar(e)} style={btnGhost} data-testid={`evento-editar-${e.id}`}>Editar</button><AjudaCampo chave="pm.eventos.acao_editar" rota={ROTA} /></span>
                            <span style={{ display: 'inline-flex', alignItems: 'center' }}><button disabled={busy} onClick={() => excluir(e)} style={btnDel} data-testid={`evento-excluir-${e.id}`}>Excluir</button><AjudaCampo chave="pm.eventos.acao_excluir" rota={ROTA} /></span>
                          </div>
                        </Td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
      </div>

      {form && (
        <div role="dialog" aria-modal="true" style={modalWrap} onClick={() => !busy && setForm(null)}>
          <div style={modalBox} onClick={(ev) => ev.stopPropagation()} data-testid="evento-form">
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 12px' }}>{form.id ? 'Editar evento' : 'Novo evento'}</h2>
            <Campo label="Nome" chave="pm.eventos.campo_nome"><input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} style={inp} data-testid="evento-f-nome" /></Campo>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Campo label="Cliente" chave="pm.eventos.campo_cliente" flex>
                <select value={form.cliente_id} onChange={(e) => setForm({ ...form, cliente_id: e.target.value })} style={inp} data-testid="evento-f-cliente">
                  <option value="">— sem cliente —</option>{clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </Campo>
              <Campo label="Tipo" chave="pm.eventos.campo_tipo" flex><input value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })} placeholder="gravação, ativação…" style={inp} data-testid="evento-f-tipo" /></Campo>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Campo label="Início" chave="pm.eventos.campo_data_inicio" flex><input type="date" value={form.data_inicio} onChange={(e) => setForm({ ...form, data_inicio: e.target.value })} style={inp} data-testid="evento-f-inicio" /></Campo>
              <Campo label="Término" chave="pm.eventos.campo_data_fim" flex><input type="date" value={form.data_fim} onChange={(e) => setForm({ ...form, data_fim: e.target.value })} style={inp} data-testid="evento-f-fim" /></Campo>
            </div>
            <Campo label="Local" chave="pm.eventos.campo_local"><input value={form.local} onChange={(e) => setForm({ ...form, local: e.target.value })} style={inp} data-testid="evento-f-local" /></Campo>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Campo label="Status" chave="pm.eventos.campo_status" flex>
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} style={inp} data-testid="evento-f-status">
                  {STATUS.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
                </select>
              </Campo>
              <Campo label="Orçamento previsto (R$)" chave="pm.eventos.campo_orcamento" flex><input type="number" min="0" step="0.01" value={form.orcamento_previsto} onChange={(e) => setForm({ ...form, orcamento_previsto: e.target.value })} style={inp} data-testid="evento-f-orcamento" /></Campo>
            </div>
            <Campo label="Responsável" chave="pm.eventos.campo_responsavel">
              <select value={form.responsavel_id} onChange={(e) => setForm({ ...form, responsavel_id: e.target.value })} style={inp} data-testid="evento-f-responsavel">
                <option value="">— a definir —</option>{pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
            </Campo>
            <Campo label="Observações" chave="pm.eventos.campo_observacoes"><textarea rows={3} value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} style={{ ...inp, resize: 'vertical' }} data-testid="evento-f-observacoes" /></Campo>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
              <button disabled={busy} onClick={() => setForm(null)} style={btnGhost}>Cancelar</button>
              <button disabled={busy} onClick={salvar} style={btnPri} data-testid="evento-f-salvar">{form.id ? 'Salvar' : 'Criar evento'}</button>
            </div>
          </div>
        </div>
      )}
      {toast && <div style={toastStyle}>{toast}</div>}
    </div>
  )
}

function Campo({ label, chave, children, flex }: { label: string; chave: string; children: React.ReactNode; flex?: boolean }) {
  return <label style={{ display: 'block', marginBottom: 10, flex: flex ? '1 1 150px' : undefined }}>
    <span style={{ fontSize: 12, fontWeight: 700, color: TEXTM, display: 'inline-flex', alignItems: 'center' }}>{label}<AjudaCampo chave={chave} rota={ROTA} /></span>
    {children}
  </label>
}
function Filtro({ label, chave, children }: { label: string; chave: string; children: React.ReactNode }) {
  return <label style={{ display: 'block', flex: '1 1 140px' }}>
    <span style={{ fontSize: 11, fontWeight: 700, color: TEXTM, display: 'inline-flex', alignItems: 'center' }}>{label}<AjudaCampo chave={chave} rota={ROTA} /></span>
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
const btnGhost: CSSProperties = { border: `1px solid ${BORDA}`, color: ESPRESSO, background: '#fff', borderRadius: 8, padding: '5px 10px', fontSize: 12, cursor: 'pointer', fontWeight: 600, minHeight: 36 }
const btnDel: CSSProperties = { border: `1px solid ${RED}`, color: RED, background: '#fff', borderRadius: 8, padding: '5px 10px', fontSize: 12, cursor: 'pointer', fontWeight: 600, minHeight: 36 }
const inp: CSSProperties = { width: '100%', border: `1px solid ${BORDA}`, borderRadius: 8, padding: '9px 10px', fontSize: 14, marginTop: 4, boxSizing: 'border-box', minHeight: 40 }
const toastStyle: CSSProperties = { position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: ESPRESSO, color: '#fff', padding: '10px 18px', borderRadius: 999, fontSize: 13, zIndex: 60 }
const modalWrap: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 70 }
const modalBox: CSSProperties = { background: '#fff', borderRadius: 16, padding: 20, width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }
