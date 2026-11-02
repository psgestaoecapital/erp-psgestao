'use client'
// BENCHMARK DE MERCADO · RADAR COMPETITIVO (P&M). Sobre agency_concorrente. Escopo por company_id (RD-45).
// Por cliente, mapeia os concorrentes dele (posicionamento, forças/fraquezas, campanhas observadas) e prioriza
// por nível de ameaça. RD-98: CRUD completo + exclusão rastreável (soft-delete + audit_log_global via RPC).
// Tema Espresso (RD-99). "?" RD-95 em todo campo/filtro/indicador/ação. Code: code-desenvolvedor-3
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import AjudaCampo from '@/components/ajuda/AjudaCampo'

const ROTA = '/dashboard/pm/benchmark'

const ESPRESSO = '#3D2314'; const OFFWHITE = '#FAF7F2'; const DOURADO = '#C8941A'
const BORDA = '#E7DED3'; const TEXTM = '#6b5444'; const GREEN = '#1F5A1F'; const RED = '#7A1F1F'

const AMEACA: Record<string, { l: string; cor: string }> = {
  alta: { l: 'Alta', cor: '#F4D6D6' }, media: { l: 'Média', cor: '#FCE9C2' }, baixa: { l: 'Baixa', cor: '#DCEFD7' },
}
const amCfg = (v: string) => AMEACA[v] ?? { l: v, cor: OFFWHITE }
const dataL = (d: string | null) => { if (!d) return '—'; const [y, m, dd] = d.slice(0, 10).split('-'); return `${dd}/${m}/${y}` }

type Concorrente = {
  id: string; cliente_id: string | null; cliente_nome: string | null; nome: string; segmento: string | null;
  site: string | null; nivel_ameaca: string; posicionamento: string | null; forcas: string | null;
  fraquezas: string | null; campanhas_observadas: string | null; ultima_observacao: string | null; observacoes: string | null
}
type ClienteOpt = { id: string; nome: string }
type FormState = {
  id: string | null; cliente_id: string; nome: string; segmento: string; site: string; nivel_ameaca: string;
  posicionamento: string; forcas: string; fraquezas: string; campanhas_observadas: string; ultima_observacao: string; observacoes: string
}
const FORM_VAZIO: FormState = {
  id: null, cliente_id: '', nome: '', segmento: '', site: '', nivel_ameaca: 'media',
  posicionamento: '', forcas: '', fraquezas: '', campanhas_observadas: '', ultima_observacao: '', observacoes: '',
}

export default function BenchmarkPage() {
  const { selInfo, companyIds } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : (companyIds[0] ?? null)
  const [lista, setLista] = useState<Concorrente[]>([])
  const [clientes, setClientes] = useState<ClienteOpt[]>([])
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [toast, setToast] = useState<string | null>(null)
  const [form, setForm] = useState<FormState | null>(null)
  const [fCliente, setFCliente] = useState(''); const [fAmeaca, setFAmeaca] = useState('')

  const carregar = async () => {
    if (!empresa) { setLoading(false); return }
    setLoading(true)
    const [r, cl] = await Promise.all([
      supabase.rpc('fn_agency_concorrente_listar', { p_company_id: empresa, p_cliente_id: null }),
      supabase.from('agency_clientes').select('id, nome').eq('company_id', empresa).is('excluido_em', null).order('nome'),
    ])
    setLista((r.data ?? []) as Concorrente[])
    setClientes((cl.data ?? []) as ClienteOpt[])
    setLoading(false)
  }
  useEffect(() => { void carregar() }, [empresa]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t) }, [toast])

  const filtrada = useMemo(() => lista.filter((c) =>
    (!fCliente || c.cliente_id === fCliente) && (!fAmeaca || c.nivel_ameaca === fAmeaca)
  ), [lista, fCliente, fAmeaca])

  const kpis = useMemo(() => ({
    total: lista.length,
    alta: lista.filter((c) => c.nivel_ameaca === 'alta').length,
    clientes: new Set(lista.filter((c) => c.cliente_id).map((c) => c.cliente_id)).size,
  }), [lista])

  function abrirNovo() { setForm({ ...FORM_VAZIO, ultima_observacao: new Date().toISOString().slice(0, 10) }) }
  function abrirEditar(c: Concorrente) {
    setForm({
      id: c.id, cliente_id: c.cliente_id ?? '', nome: c.nome, segmento: c.segmento ?? '', site: c.site ?? '',
      nivel_ameaca: c.nivel_ameaca, posicionamento: c.posicionamento ?? '', forcas: c.forcas ?? '',
      fraquezas: c.fraquezas ?? '', campanhas_observadas: c.campanhas_observadas ?? '',
      ultima_observacao: c.ultima_observacao ? c.ultima_observacao.slice(0, 10) : '', observacoes: c.observacoes ?? '',
    })
  }
  async function salvar() {
    if (!empresa || !form) return
    if (!form.nome.trim()) { setToast('Informe o nome do concorrente.'); return }
    setBusy(true)
    const payload = {
      id: form.id, cliente_id: form.cliente_id || null, nome: form.nome, segmento: form.segmento, site: form.site,
      nivel_ameaca: form.nivel_ameaca, posicionamento: form.posicionamento, forcas: form.forcas, fraquezas: form.fraquezas,
      campanhas_observadas: form.campanhas_observadas, ultima_observacao: form.ultima_observacao, observacoes: form.observacoes,
    }
    const { data, error } = await supabase.rpc('fn_agency_concorrente_salvar', { p_company_id: empresa, p_payload: payload })
    setBusy(false)
    const j = data as { id?: string } | null
    if (error || !j?.id) { setToast(`Erro: ${error?.message ?? 'não foi possível salvar'}`); return }
    setForm(null); setToast(form.id ? 'Concorrente atualizado.' : 'Concorrente adicionado ao radar.'); void carregar()
  }
  async function excluir(c: Concorrente) {
    const motivo = prompt(`Excluir "${c.nome}" do radar? Informe o motivo (fica registrado na auditoria):`)
    if (motivo === null) return
    setBusy(true)
    const { data, error } = await supabase.rpc('fn_agency_concorrente_excluir', { p_id: c.id, p_motivo: motivo || null })
    setBusy(false)
    const j = data as { ok?: boolean; erro?: string } | null
    if (error || !j?.ok) { setToast(`Erro: ${error?.message ?? j?.erro ?? 'falhou'}`); return }
    setToast('Concorrente excluído (registrado na auditoria).'); void carregar()
  }

  if (!empresa) return <div style={{ padding: 32, color: TEXTM, background: OFFWHITE, minHeight: '100vh' }}>Selecione uma empresa no topo.</div>

  return (
    <div style={{ background: OFFWHITE, minHeight: '100vh', padding: '24px 18px', color: ESPRESSO }}>
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: DOURADO, fontWeight: 700 }}>📡 P&amp;M · Radar competitivo</div>
            <h1 style={{ fontSize: 26, fontWeight: 700, margin: '2px 0 0' }}>Benchmark de Mercado<AjudaCampo chave="pm.benchmark.tela" rota={ROTA} /></h1>
            <p style={{ fontSize: 13, color: TEXTM, margin: '4px 0 0' }}>Monitore os concorrentes de cada cliente e as campanhas que eles rodam — e crie a resposta melhor.</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center' }}><button disabled={busy} onClick={abrirNovo} style={btnPri} data-testid="benchmark-novo">+ Novo concorrente</button><AjudaCampo chave="pm.benchmark.novo" rota={ROTA} /></span>
          </div>
        </header>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px,1fr))', gap: 10, marginBottom: 14 }}>
          <Kpi l="Monitorados" v={String(kpis.total)} chave="pm.benchmark.kpi_total" />
          <Kpi l="Ameaça alta" v={String(kpis.alta)} cor={RED} chave="pm.benchmark.kpi_alta" />
          <Kpi l="Clientes cobertos" v={String(kpis.clientes)} cor={GREEN} chave="pm.benchmark.kpi_clientes" />
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <label style={{ ...lbl, flex: '1 1 160px' }}>
            <span style={lblSpan}>Cliente<AjudaCampo chave="pm.benchmark.filtro_cliente" rota={ROTA} /></span>
            <select value={fCliente} onChange={(e) => setFCliente(e.target.value)} style={inp} data-testid="benchmark-filtro-cliente">
              <option value="">Todos os clientes</option>
              {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </label>
          <label style={{ ...lbl, flex: '1 1 160px' }}>
            <span style={lblSpan}>Nível de ameaça<AjudaCampo chave="pm.benchmark.filtro_ameaca" rota={ROTA} /></span>
            <select value={fAmeaca} onChange={(e) => setFAmeaca(e.target.value)} style={inp} data-testid="benchmark-filtro-ameaca">
              <option value="">Todas</option>
              <option value="alta">Alta</option>
              <option value="media">Média</option>
              <option value="baixa">Baixa</option>
            </select>
          </label>
        </div>

        {loading ? <div style={{ padding: 40, textAlign: 'center', color: TEXTM }}>Carregando…</div>
          : filtrada.length === 0 ? <div style={{ padding: 40, textAlign: 'center', color: TEXTM, background: '#fff', border: `1px dashed ${BORDA}`, borderRadius: 12 }}>{lista.length === 0 ? 'Radar vazio. Use “+ Novo concorrente” para mapear o primeiro concorrente de um cliente.' : 'Nenhum concorrente com esses filtros.'}</div>
          : (
            <div style={{ overflowX: 'auto', border: `1px solid ${BORDA}`, borderRadius: 12, background: '#fff' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 720 }}>
                <thead style={{ background: OFFWHITE }}><tr><Th chave="pm.benchmark.col_nome">Concorrente</Th><Th chave="pm.benchmark.col_cliente">Cliente</Th><Th chave="pm.benchmark.col_segmento">Segmento</Th><Th chave="pm.benchmark.col_ameaca">Ameaça</Th><Th chave="pm.benchmark.col_ultima">Última obs.</Th><Th chave="pm.benchmark.col_acoes">Ações</Th></tr></thead>
                <tbody>
                  {filtrada.map((c) => {
                    const cfg = amCfg(c.nivel_ameaca)
                    return (
                      <tr key={c.id} style={{ borderTop: `1px solid ${BORDA}` }} data-testid={`benchmark-${c.id}`}>
                        <Td>
                          <div style={{ fontWeight: 700 }}>{c.nome}</div>
                          {c.site && <div style={{ fontSize: 11, color: TEXTM }}>{c.site}</div>}
                        </Td>
                        <Td>{c.cliente_nome ?? '—'}</Td>
                        <Td>{c.segmento ?? '—'}</Td>
                        <Td><span style={{ fontSize: 11, fontWeight: 700, background: cfg.cor, padding: '2px 8px', borderRadius: 999 }}>{cfg.l}</span></Td>
                        <Td>{dataL(c.ultima_observacao)}</Td>
                        <Td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center' }}><button disabled={busy} onClick={() => abrirEditar(c)} style={btnGhost} data-testid={`benchmark-editar-${c.id}`}>Editar</button><AjudaCampo chave="pm.benchmark.editar" rota={ROTA} /></span>
                            <span style={{ display: 'inline-flex', alignItems: 'center' }}><button disabled={busy} onClick={() => excluir(c)} style={btnDel} data-testid={`benchmark-excluir-${c.id}`}>Excluir</button><AjudaCampo chave="pm.benchmark.excluir" rota={ROTA} /></span>
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
          Mapeie por cliente quem compete com ele, classifique a ameaça e registre as campanhas observadas. A exclusão é
          rastreável — fica registrado quem excluiu e quando.
        </p>
      </div>

      {form && (
        <div role="dialog" aria-modal="true" style={modalWrap} onClick={() => !busy && setForm(null)}>
          <div style={modalBox} onClick={(e) => e.stopPropagation()} data-testid="benchmark-form">
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 12px' }}>{form.id ? 'Editar concorrente' : 'Novo concorrente no radar'}</h2>
            <label style={lbl}>
              <span style={lblSpan}>Cliente monitorado<AjudaCampo chave="pm.benchmark.cliente" rota={ROTA} /></span>
              <select value={form.cliente_id} onChange={(e) => setForm({ ...form, cliente_id: e.target.value })} style={inp} data-testid="benchmark-f-cliente">
                <option value="">— Sem cliente específico —</option>
                {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </label>
            <label style={lbl}>
              <span style={lblSpan}>Nome do concorrente<AjudaCampo chave="pm.benchmark.nome" rota={ROTA} /></span>
              <input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} style={inp} data-testid="benchmark-f-nome" placeholder="Ex.: Studio Vita Fit" />
            </label>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <label style={{ ...lbl, flex: '1 1 160px' }}>
                <span style={lblSpan}>Segmento<AjudaCampo chave="pm.benchmark.segmento" rota={ROTA} /></span>
                <input value={form.segmento} onChange={(e) => setForm({ ...form, segmento: e.target.value })} style={inp} data-testid="benchmark-f-segmento" />
              </label>
              <label style={{ ...lbl, flex: '1 1 160px' }}>
                <span style={lblSpan}>Nível de ameaça<AjudaCampo chave="pm.benchmark.nivel_ameaca" rota={ROTA} /></span>
                <select value={form.nivel_ameaca} onChange={(e) => setForm({ ...form, nivel_ameaca: e.target.value })} style={inp} data-testid="benchmark-f-ameaca">
                  <option value="baixa">Baixa</option>
                  <option value="media">Média</option>
                  <option value="alta">Alta</option>
                </select>
              </label>
            </div>
            <label style={lbl}>
              <span style={lblSpan}>Site / rede<AjudaCampo chave="pm.benchmark.site" rota={ROTA} /></span>
              <input value={form.site} onChange={(e) => setForm({ ...form, site: e.target.value })} style={inp} data-testid="benchmark-f-site" placeholder="instagram.com/..." />
            </label>
            <label style={lbl}>
              <span style={lblSpan}>Posicionamento<AjudaCampo chave="pm.benchmark.posicionamento" rota={ROTA} /></span>
              <input value={form.posicionamento} onChange={(e) => setForm({ ...form, posicionamento: e.target.value })} style={inp} data-testid="benchmark-f-posicionamento" />
            </label>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <label style={{ ...lbl, flex: '1 1 160px' }}>
                <span style={lblSpan}>Forças<AjudaCampo chave="pm.benchmark.forcas" rota={ROTA} /></span>
                <textarea value={form.forcas} onChange={(e) => setForm({ ...form, forcas: e.target.value })} style={{ ...inp, minHeight: 60 }} data-testid="benchmark-f-forcas" />
              </label>
              <label style={{ ...lbl, flex: '1 1 160px' }}>
                <span style={lblSpan}>Fraquezas<AjudaCampo chave="pm.benchmark.fraquezas" rota={ROTA} /></span>
                <textarea value={form.fraquezas} onChange={(e) => setForm({ ...form, fraquezas: e.target.value })} style={{ ...inp, minHeight: 60 }} data-testid="benchmark-f-fraquezas" />
              </label>
            </div>
            <label style={lbl}>
              <span style={lblSpan}>Campanhas observadas<AjudaCampo chave="pm.benchmark.campanhas_observadas" rota={ROTA} /></span>
              <textarea value={form.campanhas_observadas} onChange={(e) => setForm({ ...form, campanhas_observadas: e.target.value })} style={{ ...inp, minHeight: 60 }} data-testid="benchmark-f-campanhas" placeholder="Ex.: Promo de verão 20% off (out/2026)" />
            </label>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <label style={{ ...lbl, flex: '1 1 160px' }}>
                <span style={lblSpan}>Última observação<AjudaCampo chave="pm.benchmark.ultima_observacao" rota={ROTA} /></span>
                <input type="date" value={form.ultima_observacao} onChange={(e) => setForm({ ...form, ultima_observacao: e.target.value })} style={inp} data-testid="benchmark-f-ultima" />
              </label>
            </div>
            <label style={lbl}>
              <span style={lblSpan}>Observações<AjudaCampo chave="pm.benchmark.observacoes" rota={ROTA} /></span>
              <textarea value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} style={{ ...inp, minHeight: 60 }} data-testid="benchmark-f-observacoes" />
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
              <button disabled={busy} onClick={() => setForm(null)} style={btnGhost}>Cancelar</button>
              <button disabled={busy} onClick={salvar} style={btnPri} data-testid="benchmark-f-salvar">{form.id ? 'Salvar' : 'Adicionar ao radar'}</button>
            </div>
          </div>
        </div>
      )}
      {toast && <div style={toastStyle}>{toast}</div>}
    </div>
  )
}

function Kpi({ l, v, cor, chave }: { l: string; v: string; cor?: string; chave?: string }) {
  return <div style={{ background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 12, padding: '12px 14px' }}>
    <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: TEXTM, fontWeight: 700 }}>{l}{chave && <AjudaCampo chave={chave} rota={ROTA} />}</div>
    <div style={{ fontSize: 22, fontWeight: 700, color: cor ?? ESPRESSO, marginTop: 2 }}>{v}</div>
  </div>
}
function Th({ children, chave }: { children?: React.ReactNode; chave?: string }) { return <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: TEXTM }}>{children}{chave && <AjudaCampo chave={chave} rota={ROTA} />}</th> }
function Td({ children, style }: { children?: React.ReactNode; style?: CSSProperties }) { return <td style={{ padding: '8px 12px', color: ESPRESSO, ...style }}>{children}</td> }
const lbl: CSSProperties = { display: 'block', marginBottom: 10 }
const lblSpan: CSSProperties = { fontSize: 12, fontWeight: 700, color: TEXTM, display: 'inline-flex', alignItems: 'center' }
const btnPri: CSSProperties = { border: 'none', background: DOURADO, color: '#fff', borderRadius: 10, padding: '10px 16px', cursor: 'pointer', fontWeight: 700, minHeight: 42 }
const btnGhost: CSSProperties = { border: `1px solid ${BORDA}`, color: ESPRESSO, background: '#fff', borderRadius: 8, padding: '5px 10px', fontSize: 12, cursor: 'pointer', fontWeight: 600, minHeight: 36 }
const btnDel: CSSProperties = { border: `1px solid ${RED}`, color: RED, background: '#fff', borderRadius: 8, padding: '5px 10px', fontSize: 12, cursor: 'pointer', fontWeight: 600, minHeight: 36 }
const inp: CSSProperties = { width: '100%', border: `1px solid ${BORDA}`, borderRadius: 8, padding: '9px 10px', fontSize: 14, marginTop: 4, boxSizing: 'border-box', minHeight: 40 }
const toastStyle: CSSProperties = { position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: ESPRESSO, color: '#fff', padding: '10px 18px', borderRadius: 999, fontSize: 13, zIndex: 60 }
const modalWrap: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 70 }
const modalBox: CSSProperties = { background: '#fff', borderRadius: 16, padding: 20, width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }
