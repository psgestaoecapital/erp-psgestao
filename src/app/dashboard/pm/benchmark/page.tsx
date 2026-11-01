'use client'
// P&M · Benchmark de Mercado (CEO/auditor 01/11). Lista + CRUD completo (incluir/editar/excluir rastreável) sobre
// agency_benchmark, por company_id (RD-45). Escrita só pelas RPCs fn_pm_benchmark_salvar/_excluir (guarda de empresa,
// audit_log_global, soft-delete). Dado REAL cadastrado pelo usuário — referências de mercado, não mockup (RD-98 p1).
// "?" em todo campo/filtro/indicador/ação (RD-95). Tema Espresso.
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import AjudaCampo from '@/components/ajuda/AjudaCampo'

const ROTA = '/dashboard/pm/benchmark'
const ESPRESSO = '#3D2314'; const OFFWHITE = '#FAF7F2'; const DOURADO = '#C8941A'
const BORDA = '#E7DED3'; const TEXTM = '#6b5444'; const RED = '#7A1F1F'

const UNIDADES = ['R$', '%', 'R$/h', 'R$/mês', 'R$/m²', 'x', 'pts']
const num = (v: number) => (v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
// mostra o valor com a sua unidade de forma legível: "R$ 6.000" · "R$/h 180" · "35%" · "2 x"
const valorFmt = (v: number, u: string) => {
  if (u === '%') return `${num(v)}%`
  if (u.startsWith('R$')) return `${u} ${num(v)}`
  return `${num(v)} ${u}`
}

type Bench = { id: string; indicador: string; segmento: string | null; servico: string | null; unidade: string; valor_referencia: number; periodo: string | null; fonte: string | null; observacoes: string | null }
type FormState = { id: string | null; indicador: string; segmento: string; servico: string; unidade: string; valor_referencia: string; periodo: string; fonte: string; observacoes: string }
const FORM_VAZIO: FormState = { id: null, indicador: '', segmento: '', servico: '', unidade: 'R$', valor_referencia: '', periodo: '', fonte: '', observacoes: '' }

export default function BenchmarkPage() {
  const { selInfo, companyIds } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : (companyIds[0] ?? null)
  const [itens, setItens] = useState<Bench[]>([])
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [toast, setToast] = useState<string | null>(null)
  const [form, setForm] = useState<FormState | null>(null)
  const [fSegmento, setFSegmento] = useState(''); const [busca, setBusca] = useState('')

  const carregar = async () => {
    if (!empresa) { setLoading(false); return }
    setLoading(true)
    const { data } = await supabase.from('agency_benchmark').select('*').eq('company_id', empresa).is('excluido_em', null).order('indicador', { ascending: true })
    setItens((data ?? []) as Bench[])
    setLoading(false)
  }
  useEffect(() => { void carregar() }, [empresa]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t) }, [toast])

  const segmentos = useMemo(() => Array.from(new Set(itens.map((b) => b.segmento).filter(Boolean))) as string[], [itens])
  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return itens.filter((b) =>
      (!fSegmento || b.segmento === fSegmento) &&
      (!q || [b.indicador, b.servico, b.fonte].some((x) => (x ?? '').toLowerCase().includes(q)))
    )
  }, [itens, fSegmento, busca])

  const kpis = useMemo(() => ({
    total: filtrados.length,
    segmentos: new Set(filtrados.map((b) => b.segmento).filter(Boolean)).size,
    indicadores: new Set(filtrados.map((b) => b.indicador)).size,
  }), [filtrados])

  function abrirNovo() { setForm({ ...FORM_VAZIO }) }
  function abrirEditar(b: Bench) {
    setForm({ id: b.id, indicador: b.indicador, segmento: b.segmento ?? '', servico: b.servico ?? '', unidade: b.unidade || 'R$', valor_referencia: String(b.valor_referencia), periodo: b.periodo ?? '', fonte: b.fonte ?? '', observacoes: b.observacoes ?? '' })
  }
  async function salvar() {
    if (!empresa || !form) return
    if (!form.indicador.trim()) { setToast('Informe o indicador.'); return }
    if (form.valor_referencia.trim() === '') { setToast('Informe o valor de referência.'); return }
    setBusy(true)
    const dados = {
      indicador: form.indicador.trim(), segmento: form.segmento || null, servico: form.servico || null,
      unidade: form.unidade || 'R$', valor_referencia: form.valor_referencia.replace(',', '.'),
      periodo: form.periodo || null, fonte: form.fonte || null, observacoes: form.observacoes || null,
    }
    const { data, error } = await supabase.rpc('fn_pm_benchmark_salvar', { p_company_id: empresa, p_id: form.id, p_dados: dados })
    setBusy(false)
    const j = data as { ok?: boolean; erro?: string } | null
    if (error || !j?.ok) { setToast(`Erro: ${error?.message ?? j?.erro ?? 'falhou'}`); return }
    setForm(null); setToast(form.id ? 'Referência atualizada.' : 'Referência criada.'); void carregar()
  }
  async function excluir(b: Bench) {
    const motivo = prompt(`Excluir a referência "${b.indicador}"? Informe o motivo (fica na auditoria):`)
    if (motivo === null) return
    setBusy(true)
    const { data, error } = await supabase.rpc('fn_pm_benchmark_excluir', { p_id: b.id, p_motivo: motivo || null })
    setBusy(false)
    const j = data as { ok?: boolean; erro?: string } | null
    if (error || !j?.ok) { setToast(`Erro: ${error?.message ?? j?.erro ?? 'falhou'}`); return }
    setToast('Referência excluída (registrada na auditoria).'); void carregar()
  }

  if (!empresa) return <div style={{ padding: 32, color: TEXTM, background: OFFWHITE, minHeight: '100vh' }}>Selecione uma empresa no topo.</div>

  return (
    <div style={{ background: OFFWHITE, minHeight: '100vh', padding: '24px 18px', color: ESPRESSO }}>
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: DOURADO, fontWeight: 700 }}>📊 P&amp;M · Mercado</div>
            <h1 style={{ fontSize: 26, fontWeight: 700, margin: '2px 0 0' }}>Benchmark de Mercado<AjudaCampo chave="pm.benchmark.tela" rota={ROTA} /></h1>
            <p style={{ fontSize: 13, color: TEXTM, margin: '4px 0 0' }}>Referências de mercado (fee médio, valor/hora, margem alvo…) por segmento e serviço, para comparar com os seus números.</p>
          </div>
          <span style={{ display: 'inline-flex', alignItems: 'center' }}><button disabled={busy} onClick={abrirNovo} style={btnPri} data-testid="benchmark-novo">+ Nova referência</button><AjudaCampo chave="pm.benchmark.acao_novo" rota={ROTA} /></span>
        </header>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px,1fr))', gap: 10, marginBottom: 12 }}>
          <Kpi l="Referências" v={String(kpis.total)} chave="pm.benchmark.kpi_total" />
          <Kpi l="Segmentos" v={String(kpis.segmentos)} cor={DOURADO} chave="pm.benchmark.kpi_segmentos" />
          <Kpi l="Indicadores" v={String(kpis.indicadores)} chave="pm.benchmark.kpi_indicadores" />
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12, background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 12, padding: 10 }}>
          <label style={filtroWrap}>
            <span style={filtroLabel}>Segmento<AjudaCampo chave="pm.benchmark.filtro_segmento" rota={ROTA} /></span>
            <select value={fSegmento} onChange={(e) => setFSegmento(e.target.value)} style={inp} data-testid="benchmark-filtro-segmento">
              <option value="">Todos</option>{segmentos.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label style={filtroWrap}>
            <span style={filtroLabel}>Buscar<AjudaCampo chave="pm.benchmark.filtro_busca" rota={ROTA} /></span>
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="indicador, serviço, fonte…" style={inp} data-testid="benchmark-busca" />
          </label>
        </div>

        {loading ? <div style={{ padding: 40, textAlign: 'center', color: TEXTM }}>Carregando…</div>
          : filtrados.length === 0 ? <div style={{ padding: 40, textAlign: 'center', color: TEXTM, background: '#fff', border: `1px dashed ${BORDA}`, borderRadius: 12 }}>Nenhuma referência no filtro. Use “+ Nova referência” para cadastrar.</div>
          : (
            <div style={{ overflowX: 'auto', border: `1px solid ${BORDA}`, borderRadius: 12, background: '#fff' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 760 }}>
                <thead style={{ background: OFFWHITE }}><tr><Th chave="pm.benchmark.campo_indicador">Indicador</Th><Th chave="pm.benchmark.campo_segmento">Segmento</Th><Th chave="pm.benchmark.campo_servico">Serviço</Th><Th chave="pm.benchmark.campo_valor">Valor</Th><Th chave="pm.benchmark.campo_periodo">Período</Th><Th chave="pm.benchmark.campo_fonte">Fonte</Th><Th chave="pm.benchmark.col_acoes">Ações</Th></tr></thead>
                <tbody>
                  {filtrados.map((b) => (
                    <tr key={b.id} style={{ borderTop: `1px solid ${BORDA}` }} data-testid={`benchmark-${b.id}`}>
                      <Td><b>{b.indicador}</b></Td>
                      <Td style={{ color: TEXTM }}>{b.segmento ?? '—'}</Td>
                      <Td style={{ color: TEXTM }}>{b.servico ?? '—'}</Td>
                      <Td style={{ fontWeight: 700 }}>{valorFmt(Number(b.valor_referencia), b.unidade)}</Td>
                      <Td style={{ color: TEXTM }}>{b.periodo ?? '—'}</Td>
                      <Td style={{ color: TEXTM }}>{b.fonte ?? '—'}</Td>
                      <Td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center' }}><button disabled={busy} onClick={() => abrirEditar(b)} style={btnGhost} data-testid={`benchmark-editar-${b.id}`}>Editar</button><AjudaCampo chave="pm.benchmark.acao_editar" rota={ROTA} /></span>
                          <span style={{ display: 'inline-flex', alignItems: 'center' }}><button disabled={busy} onClick={() => excluir(b)} style={btnDel} data-testid={`benchmark-excluir-${b.id}`}>Excluir</button><AjudaCampo chave="pm.benchmark.acao_excluir" rota={ROTA} /></span>
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>

      {form && (
        <div role="dialog" aria-modal="true" style={modalWrap} onClick={() => !busy && setForm(null)}>
          <div style={modalBox} onClick={(ev) => ev.stopPropagation()} data-testid="benchmark-form">
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 12px' }}>{form.id ? 'Editar referência' : 'Nova referência'}</h2>
            <label style={campoWrap}>
              <span style={campoLabel}>Indicador<AjudaCampo chave="pm.benchmark.campo_indicador" rota={ROTA} /></span>
              <input value={form.indicador} onChange={(e) => setForm({ ...form, indicador: e.target.value })} placeholder="Fee mensal médio, Valor da hora…" style={inp} data-testid="benchmark-f-indicador" />
            </label>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <label style={campoWrapFlex}>
                <span style={campoLabel}>Segmento<AjudaCampo chave="pm.benchmark.campo_segmento" rota={ROTA} /></span>
                <input value={form.segmento} onChange={(e) => setForm({ ...form, segmento: e.target.value })} placeholder="Varejo, Indústria…" style={inp} data-testid="benchmark-f-segmento" />
              </label>
              <label style={campoWrapFlex}>
                <span style={campoLabel}>Serviço<AjudaCampo chave="pm.benchmark.campo_servico" rota={ROTA} /></span>
                <input value={form.servico} onChange={(e) => setForm({ ...form, servico: e.target.value })} placeholder="Social media…" style={inp} data-testid="benchmark-f-servico" />
              </label>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <label style={campoWrapFlex}>
                <span style={campoLabel}>Unidade<AjudaCampo chave="pm.benchmark.campo_unidade" rota={ROTA} /></span>
                <select value={form.unidade} onChange={(e) => setForm({ ...form, unidade: e.target.value })} style={inp} data-testid="benchmark-f-unidade">
                  {UNIDADES.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </label>
              <label style={campoWrapFlex}>
                <span style={campoLabel}>Valor de referência<AjudaCampo chave="pm.benchmark.campo_valor" rota={ROTA} /></span>
                <input type="number" step="0.01" value={form.valor_referencia} onChange={(e) => setForm({ ...form, valor_referencia: e.target.value })} style={inp} data-testid="benchmark-f-valor" />
              </label>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <label style={campoWrapFlex}>
                <span style={campoLabel}>Período<AjudaCampo chave="pm.benchmark.campo_periodo" rota={ROTA} /></span>
                <input value={form.periodo} onChange={(e) => setForm({ ...form, periodo: e.target.value })} placeholder="2026" style={inp} data-testid="benchmark-f-periodo" />
              </label>
              <label style={campoWrapFlex}>
                <span style={campoLabel}>Fonte<AjudaCampo chave="pm.benchmark.campo_fonte" rota={ROTA} /></span>
                <input value={form.fonte} onChange={(e) => setForm({ ...form, fonte: e.target.value })} placeholder="Pesquisa setorial…" style={inp} data-testid="benchmark-f-fonte" />
              </label>
            </div>
            <label style={campoWrap}>
              <span style={campoLabel}>Observações<AjudaCampo chave="pm.benchmark.campo_observacoes" rota={ROTA} /></span>
              <textarea rows={3} value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} style={{ ...inp, resize: 'vertical' }} data-testid="benchmark-f-observacoes" />
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
              <button disabled={busy} onClick={() => setForm(null)} style={btnGhost}>Cancelar</button>
              <button disabled={busy} onClick={salvar} style={btnPri} data-testid="benchmark-f-salvar">{form.id ? 'Salvar' : 'Criar referência'}</button>
            </div>
          </div>
        </div>
      )}
      {toast && <div style={toastStyle}>{toast}</div>}
    </div>
  )
}

const campoWrap: CSSProperties = { display: 'block', marginBottom: 10 }
const campoWrapFlex: CSSProperties = { display: 'block', marginBottom: 10, flex: '1 1 150px' }
const campoLabel: CSSProperties = { fontSize: 12, fontWeight: 700, color: TEXTM, display: 'inline-flex', alignItems: 'center' }
const filtroWrap: CSSProperties = { display: 'block', flex: '1 1 160px' }
const filtroLabel: CSSProperties = { fontSize: 11, fontWeight: 700, color: TEXTM, display: 'inline-flex', alignItems: 'center' }
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
