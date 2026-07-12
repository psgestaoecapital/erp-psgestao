'use client'

// OFICINA-TEMPARIO-v1 · PASSO 1
// /dashboard/oficina/tempario · catálogo de serviços da oficina (tempo-padrão).
// O TEMPO é a estrela. O mecânico escolhe o serviço, o tempo/preço vêm prontos.
// Custo homem-hora automático (de GE), matriz de margem e IA chegam nos passos 2..7.
// Padrão premium (card da OS é a referência) · CRUD completo · paleta PS.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

export const dynamic = 'force-dynamic'

const C = {
  espresso: '#3D2314', espressoM: '#6B5D4F', espressoL: '#9C8E80',
  bg: '#FAF7F2', white: '#FFFFFF', cream: '#F0ECE3', border: '#E0D8CC',
  gold: '#C8941A', goldBg: '#FDF7E8',
  green: '#16A34A', greenBg: '#ECFDF5',
  amber: '#C8941A', amberBg: '#FFF8E1',
  red: '#DC2626', redBg: '#FEE2E2',
  blue: '#2563EB', blueBg: '#EFF6FF',
}

const CATEGORIAS = ['mecanica','eletrica','suspensao','motor','freios','transmissao','arrefecimento','outros'] as const
const CAT_LABEL: Record<string, string> = {
  mecanica: 'Mecânica', eletrica: 'Elétrica', suspensao: 'Suspensão', motor: 'Motor',
  freios: 'Freios', transmissao: 'Transmissão', arrefecimento: 'Arrefecimento', outros: 'Outros',
}

const ORIGEM: Record<string, { emoji: string; label: string }> = {
  manual:       { emoji: '👤', label: 'Manual' },
  ia_sugerido:  { emoji: '🤖', label: 'IA sugeriu' },
  ia_aprendido: { emoji: '🧠', label: 'IA aprendeu' },
  importado:    { emoji: '📋', label: 'Importado' },
}

interface Servico {
  id: string
  company_id: string
  nome: string
  categoria: string | null
  tempo_padrao_h: number
  origem_tempo: string
  execucoes_conta: number | null
  ativo: boolean
}

interface Parametros {
  company_id: string
  horas_produtivas_mes: number
  margem_alvo_mao_obra_pct: number
  margem_alvo_peca_pct: number
  custo_hora_manual: number | null
}

interface DetalheCusto { categoria: string; rotulo: string; valor: number; pct?: number }
interface CustoHora {
  ok?: boolean
  custo_hora: number | null
  custo_hora_calculado?: number | null
  origem?: string
  periodo?: string
  total_custos_fixos?: number
  horas_consideradas?: number
  horas_produtivas_mes?: number
  detalhe?: DetalheCusto[]
  alerta?: string | null
}

const fmtBRL = (v: number | null | undefined) =>
  v == null ? '—' : 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtH = (h: number | null | undefined) => {
  if (h == null) return '—'
  const n = Number(h)
  if (!n) return '0h'
  const horas = Math.floor(n)
  const min = Math.round((n - horas) * 60)
  return min ? `${horas}h${String(min).padStart(2, '0')}` : `${horas}h`
}

const inp: React.CSSProperties = {
  width: '100%', minHeight: 44, padding: '10px 12px',
  border: `1px solid ${C.border}`, borderRadius: 8,
  fontSize: 14, color: C.espresso, background: C.white, outline: 'none',
}
const lbl: React.CSSProperties = { display: 'block', fontSize: 11, color: C.espressoM, fontWeight: 600, marginBottom: 4 }

export default function TemparioPage() {
  const { sel } = useCompanyIds()
  const [servicos, setServicos] = useState<Servico[]>([])
  const [params, setParams] = useState<Parametros | null>(null)
  const [loading, setLoading] = useState(true)
  const [busca, setBusca] = useState('')
  const [filtroCat, setFiltroCat] = useState<string>('todas')
  const [erro, setErro] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)
  const [editando, setEditando] = useState<Servico | 'novo' | null>(null)
  const [excluir, setExcluir] = useState<Servico | null>(null)
  const [paramsAberto, setParamsAberto] = useState(false)
  const [custo, setCusto] = useState<CustoHora | null>(null)
  const [detalheAberto, setDetalheAberto] = useState(false)
  const [recalculando, setRecalculando] = useState(false)

  const companyIdAtiva = useMemo<string | null>(() => {
    if (!sel || sel === 'consolidado' || sel.startsWith('group_')) return null
    return sel
  }, [sel])

  const flash = useCallback((m: string) => {
    setOkMsg(m); window.setTimeout(() => setOkMsg((x) => (x === m ? null : x)), 3500)
  }, [])

  const carregar = useCallback(async () => {
    if (!companyIdAtiva) { setServicos([]); setParams(null); setLoading(false); return }
    setLoading(true)
    const [{ data: srv, error: e1 }, { data: par }] = await Promise.all([
      supabase.from('erp_oficina_servicos')
        .select('id, company_id, nome, categoria, tempo_padrao_h, origem_tempo, execucoes_conta, ativo')
        .eq('company_id', companyIdAtiva).eq('excluida', false)
        .order('categoria', { ascending: true }).order('nome', { ascending: true }).limit(500),
      supabase.from('erp_oficina_parametros')
        .select('company_id, horas_produtivas_mes, margem_alvo_mao_obra_pct, margem_alvo_peca_pct, custo_hora_manual')
        .eq('company_id', companyIdAtiva).maybeSingle(),
    ])
    if (e1) setErro(e1.message)
    setServicos(((srv ?? []) as Servico[]).filter((s) => s.company_id === companyIdAtiva))
    setParams((par as Parametros) ?? {
      company_id: companyIdAtiva, horas_produtivas_mes: 160,
      margem_alvo_mao_obra_pct: 30, margem_alvo_peca_pct: 40, custo_hora_manual: null,
    })
    // PASSO 2 · custo homem-hora automático dos custos reais de GE
    const { data: ch } = await supabase.rpc('fn_oficina_custo_hora', { p_company_id: companyIdAtiva })
    setCusto((ch as CustoHora) ?? null)
    setLoading(false)
  }, [companyIdAtiva])

  useEffect(() => { void carregar() }, [carregar])

  async function recalcularCusto() {
    if (!companyIdAtiva) return
    setRecalculando(true)
    const { data: ch } = await supabase.rpc('fn_oficina_custo_hora', { p_company_id: companyIdAtiva })
    setCusto((ch as CustoHora) ?? null)
    setRecalculando(false)
    flash('Custo/hora recalculado')
  }

  // custo/hora: PASSO 2 — calculado de GE (com override manual respeitado na RPC).
  const custoHora = custo?.custo_hora ?? null
  const precoDe = (s: Servico) => {
    if (custoHora == null || !params) return null
    return s.tempo_padrao_h * custoHora * (1 + params.margem_alvo_mao_obra_pct / 100)
  }

  const filtrados = useMemo(() => {
    let r = servicos
    if (filtroCat !== 'todas') r = r.filter((s) => (s.categoria ?? 'outros') === filtroCat)
    if (busca.trim()) {
      const b = busca.toLowerCase()
      r = r.filter((s) => s.nome.toLowerCase().includes(b) || (s.categoria ?? '').toLowerCase().includes(b))
    }
    return r
  }, [servicos, filtroCat, busca])

  async function excluirServico(motivo: string) {
    if (!excluir) return
    const { error } = await supabase.from('erp_oficina_servicos')
      .update({ excluida: true, excluida_em: new Date().toISOString(), excluida_motivo: motivo || null })
      .eq('id', excluir.id).eq('company_id', excluir.company_id)
    if (error) { setErro(error.message); return }
    setExcluir(null)
    flash(`Serviço "${excluir.nome}" EXCLUÍDO`)
    void carregar()
  }

  return (
    <div style={{ minHeight: '100vh', background: C.bg, padding: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: C.espresso, display: 'flex', alignItems: 'center', gap: 8 }}>
            ⏱️ Tempário
            <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: C.goldBg, color: C.gold, fontWeight: 700, letterSpacing: 0.5 }}>oficina-v1</span>
          </div>
          <div style={{ fontSize: 11, color: C.espressoL }}>Escolha o serviço, o tempo já vem pronto. Sem fazer conta.</div>
        </div>
        {companyIdAtiva && (
          <button
            onClick={() => { setErro(null); setEditando('novo') }}
            style={{ minHeight: 44, padding: '10px 18px', borderRadius: 8, background: C.gold, color: C.white, border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
          >
            + Novo serviço
          </button>
        )}
      </div>

      {erro && <div style={{ background: C.redBg, color: C.red, padding: '10px 12px', borderRadius: 8, marginBottom: 10, fontSize: 12, fontWeight: 600 }} onClick={() => setErro(null)}>❌ {erro}</div>}
      {okMsg && <div style={{ background: C.greenBg, color: C.green, padding: '10px 12px', borderRadius: 8, marginBottom: 10, fontSize: 12, fontWeight: 600 }} onClick={() => setOkMsg(null)}>✓ {okMsg}</div>}

      {!companyIdAtiva ? (
        <div style={{ textAlign: 'center', padding: 40, color: C.espressoL, fontSize: 13, background: C.white, borderRadius: 10, border: `1px solid ${C.border}` }}>
          Selecione uma empresa específica no menu superior. O tempário é por empresa.
        </div>
      ) : (
        <>
          {/* CARD · Custo da sua oficina (PASSO 2 — calculado dos custos reais de GE) */}
          <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: 16, marginBottom: 14, boxShadow: '0 1px 2px rgba(61,35,20,0.04)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.espressoM, textTransform: 'uppercase', letterSpacing: 1 }}>💰 Custo da sua oficina</div>

                {custoHora != null ? (
                  <>
                    {/* ESTRELA — o valor */}
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 34, fontWeight: 800, color: C.gold, lineHeight: 1 }}>
                        {fmtBRL(custoHora)}
                      </span>
                      <span style={{ fontSize: 15, fontWeight: 700, color: C.gold }}>/h</span>
                    </div>
                    <div style={{ fontSize: 11.5, color: C.espressoM, marginTop: 4 }}>
                      custo homem-hora · {custo?.origem === 'manual' ? 'definido manualmente' : 'calculado dos seus custos reais'}
                    </div>
                    {custo?.origem === 'manual' && custo?.custo_hora_calculado != null && (
                      <div style={{ fontSize: 11.5, color: C.amber, marginTop: 4 }}>
                        Você definiu {fmtBRL(custoHora)}/h. O calculado dos seus custos é {fmtBRL(custo.custo_hora_calculado)}/h.
                      </div>
                    )}
                    {custo?.alerta && (
                      <div style={{ fontSize: 11.5, color: C.amber, marginTop: 4 }}>⚠️ {custo.alerta}</div>
                    )}

                    {/* TRANSPARÊNCIA — expansível */}
                    {custo?.detalhe && custo.detalhe.length > 0 && (
                      <div style={{ marginTop: 8 }}>
                        <button
                          onClick={() => setDetalheAberto((v) => !v)}
                          style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', color: C.espressoM, fontSize: 12, fontWeight: 600 }}
                        >
                          {detalheAberto ? '▾' : '▸'} De onde vem esse número
                        </button>
                        {detalheAberto && (
                          <div style={{ marginTop: 8, background: C.bg, borderRadius: 8, padding: 12, maxWidth: 440 }}>
                            {custo.detalhe.map((d) => (
                              <div key={d.categoria} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, color: C.espresso, padding: '3px 0' }}>
                                <span>{d.rotulo}</span>
                                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtBRL(d.valor)} <span style={{ color: C.espressoL }}>({d.pct ?? 0}%)</span></span>
                              </div>
                            ))}
                            <div style={{ borderTop: `1px solid ${C.border}`, margin: '6px 0', paddingTop: 6, display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700, color: C.espresso }}>
                              <span>Total · {custo.periodo}</span>
                              <span>{fmtBRL(custo.total_custos_fixos ?? 0)}</span>
                            </div>
                            <div style={{ fontSize: 12, color: C.espressoM }}>
                              ÷ {custo.horas_consideradas}h produtivas = <strong style={{ color: C.gold }}>{fmtBRL(custoHora)}/h</strong>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    <div style={{ fontSize: 12, color: C.espresso, marginTop: 8 }}>
                      Margem alvo: <strong>mão de obra {params?.margem_alvo_mao_obra_pct ?? 30}%</strong> · <strong>peça {params?.margem_alvo_peca_pct ?? 40}%</strong>
                      {'  ·  '}<strong>{params?.horas_produtivas_mes ?? 160}h</strong>/mês
                    </div>
                  </>
                ) : (
                  /* ESTADO VAZIO — sem custos lançados em GE */
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 13, color: C.espressoM, lineHeight: 1.5, maxWidth: 460 }}>
                      {custo?.alerta ?? 'Ainda não dá pra calcular seu custo/hora — não há despesas lançadas no período.'}
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                      <a href="/dashboard/financeiro" style={{ minHeight: 38, padding: '9px 14px', borderRadius: 8, background: C.gold, color: C.white, fontSize: 12, fontWeight: 700, textDecoration: 'none' }}>
                        Ir para Financeiro (GE)
                      </a>
                      <button onClick={() => setParamsAberto(true)} style={{ minHeight: 38, padding: '9px 14px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.white, color: C.espresso, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                        Informar manual
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button
                  onClick={() => void recalcularCusto()}
                  disabled={recalculando}
                  title="Recalcular (após lançar despesas em GE)"
                  style={{ height: 34, width: 38, borderRadius: 8, border: `1px solid ${C.border}`, background: C.white, color: C.espressoM, fontSize: 14, cursor: 'pointer' }}
                >
                  {recalculando ? '…' : '🔄'}
                </button>
                <button
                  onClick={() => setParamsAberto(true)}
                  style={{ height: 34, padding: '0 12px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.white, color: C.espressoM, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                >
                  Editar
                </button>
              </div>
            </div>
          </div>

          {/* Busca + filtro de categoria */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar serviço por nome ou categoria…" style={inp} />
            <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
              <FiltroChip label="Todas" ativo={filtroCat === 'todas'} onClick={() => setFiltroCat('todas')} />
              {CATEGORIAS.map((c) => <FiltroChip key={c} label={CAT_LABEL[c]} ativo={filtroCat === c} onClick={() => setFiltroCat(c)} />)}
            </div>
          </div>

          {/* Lista */}
          {loading ? (
            <div style={{ textAlign: 'center', padding: 40, color: C.espressoL, fontSize: 13 }}>Carregando…</div>
          ) : filtrados.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: C.espressoL, fontSize: 13, background: C.white, borderRadius: 10, border: `1px solid ${C.border}` }}>
              {servicos.length === 0 ? 'Nenhum serviço no tempário ainda. Clique em + Novo serviço.' : 'Nenhum serviço com esses filtros.'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {filtrados.map((s) => {
                const o = ORIGEM[s.origem_tempo] ?? ORIGEM.manual
                const preco = precoDe(s)
                return (
                  <div key={s.id} style={{ position: 'relative', background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: '16px 88px 16px 16px', boxShadow: '0 1px 2px rgba(61,35,20,0.04)' }}>
                    {/* ESTRELA: o tempo manda */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 20, fontWeight: 800, color: C.espresso, background: C.cream, borderRadius: 7, padding: '4px 11px', lineHeight: 1.1 }}>
                        {fmtH(s.tempo_padrao_h)}
                      </span>
                      <span style={{ fontSize: 15, fontWeight: 700, color: C.espresso }}>{s.nome}</span>
                    </div>
                    {/* categoria + origem */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 7, flexWrap: 'wrap', fontSize: 12, color: C.espressoM }}>
                      {s.categoria && <span>{CAT_LABEL[s.categoria] ?? s.categoria}</span>}
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: C.cream, borderRadius: 999, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>
                        {o.emoji} {o.label}{s.origem_tempo === 'ia_aprendido' && s.execucoes_conta ? ` (${s.execucoes_conta}×)` : ''}
                      </span>
                    </div>
                    {/* preço / custo — meta discreto */}
                    <div style={{ marginTop: 7, fontSize: 11, color: C.espressoL }}>
                      {preco != null
                        ? <><strong style={{ color: C.green, fontSize: 13 }}>{fmtBRL(preco)}</strong> · custo/h {fmtBRL(custoHora)}</>
                        : <span>preço calculado quando o custo/hora estiver definido</span>}
                    </div>
                    {/* ações discretas */}
                    <div style={{ position: 'absolute', top: 12, right: 12, display: 'flex', gap: 6 }}>
                      <button onClick={() => { setErro(null); setEditando(s) }} title="Editar serviço"
                        style={{ height: 30, padding: '0 9px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.white, color: C.espressoM, fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        ✏️ <span>Editar</span>
                      </button>
                      <button onClick={() => setExcluir(s)} title="Excluir serviço"
                        style={{ width: 32, height: 30, borderRadius: 8, border: `1px solid ${C.border}`, background: C.white, color: C.red, fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                        🗑️
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {editando && companyIdAtiva && (
        <ModalServico
          companyId={companyIdAtiva}
          servico={editando === 'novo' ? null : editando}
          onClose={() => setEditando(null)}
          onSalvo={(msg) => { setEditando(null); flash(msg); void carregar() }}
          onErro={setErro}
        />
      )}

      {excluir && (
        <ConfirmExcluir
          nome={excluir.nome}
          onClose={() => setExcluir(null)}
          onConfirm={(motivo) => void excluirServico(motivo)}
        />
      )}

      {paramsAberto && params && companyIdAtiva && (
        <ModalParametros
          companyId={companyIdAtiva}
          params={params}
          onClose={() => setParamsAberto(false)}
          onSalvo={() => { setParamsAberto(false); flash('Parâmetros salvos'); void carregar() }}
          onErro={setErro}
        />
      )}
    </div>
  )
}

function FiltroChip({ label, ativo, onClick }: { label: string; ativo: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      minHeight: 36, padding: '6px 12px', borderRadius: 999,
      border: `1px solid ${ativo ? C.gold : C.border}`,
      background: ativo ? C.goldBg : C.white, color: ativo ? C.gold : C.espressoM,
      fontSize: 11, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
    }}>{label}</button>
  )
}

// ─────────────────────────────────────────────────────────────
// Modal criar/editar serviço
// ─────────────────────────────────────────────────────────────
function ModalServico({
  companyId, servico, onClose, onSalvo, onErro,
}: {
  companyId: string
  servico: Servico | null
  onClose: () => void
  onSalvo: (msg: string) => void
  onErro: (m: string) => void
}) {
  const [nome, setNome] = useState(servico?.nome ?? '')
  const [categoria, setCategoria] = useState(servico?.categoria ?? 'mecanica')
  const [tempoStr, setTempoStr] = useState(servico ? String(servico.tempo_padrao_h) : '')
  const [salvando, setSalvando] = useState(false)
  const [erroLocal, setErroLocal] = useState<string | null>(null)

  async function salvar() {
    setErroLocal(null)
    if (!nome.trim()) { setErroLocal('Nome do serviço é obrigatório.'); return }
    const tempo = Number((tempoStr || '0').replace(',', '.'))
    if (!(tempo >= 0)) { setErroLocal('Tempo inválido.'); return }
    setSalvando(true)
    const { data: { user } } = await supabase.auth.getUser()
    let error
    if (servico) {
      ({ error } = await supabase.from('erp_oficina_servicos')
        .update({ nome: nome.trim(), categoria, tempo_padrao_h: tempo, alterado_em: new Date().toISOString(), alterado_por: user?.id ?? null })
        .eq('id', servico.id).eq('company_id', companyId))
    } else {
      ({ error } = await supabase.from('erp_oficina_servicos')
        .insert({ company_id: companyId, nome: nome.trim(), categoria, tempo_padrao_h: tempo, origem_tempo: 'manual', criado_por: user?.id ?? null }))
    }
    setSalvando(false)
    if (error) { setErroLocal('Erro: ' + error.message); onErro(error.message); return }
    onSalvo(servico ? `Serviço "${nome.trim()}" ALTERADO` : `Serviço "${nome.trim()}" CRIADO`)
  }

  return (
    <Overlay onClose={onClose}>
      <div style={{ fontSize: 16, fontWeight: 700, color: C.espresso, marginBottom: 12 }}>{servico ? 'Editar serviço' : 'Novo serviço'}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label style={lbl}>Serviço *</label>
          <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Troca de pastilhas dianteiras" style={inp} autoFocus />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px', gap: 10 }}>
          <div>
            <label style={lbl}>Categoria</label>
            <select value={categoria} onChange={(e) => setCategoria(e.target.value)} style={{ ...inp, cursor: 'pointer' }}>
              {CATEGORIAS.map((c) => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Tempo (h)</label>
            <input value={tempoStr} onChange={(e) => setTempoStr(e.target.value)} inputMode="decimal" placeholder="1,5" style={{ ...inp, fontFamily: 'ui-monospace, Menlo, monospace', fontWeight: 700 }} />
          </div>
        </div>
        <div style={{ fontSize: 11, color: C.espressoL }}>Tempo em hora centesimal: 1,5 = 1h30. A sugestão automática por IA chega num próximo passo.</div>
        {erroLocal && <div style={{ background: C.redBg, color: C.red, padding: '10px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600 }}>❌ {erroLocal}</div>}
        <button onClick={salvar} disabled={salvando || !nome.trim()} style={{
          minHeight: 48, padding: '12px 18px', borderRadius: 10,
          background: salvando || !nome.trim() ? C.cream : C.gold,
          color: salvando || !nome.trim() ? C.espressoL : C.white,
          border: 'none', fontSize: 14, fontWeight: 700, cursor: salvando || !nome.trim() ? 'not-allowed' : 'pointer',
        }}>{salvando ? 'Salvando…' : servico ? 'Salvar' : 'Criar serviço'}</button>
      </div>
    </Overlay>
  )
}

// ─────────────────────────────────────────────────────────────
// Modal parâmetros
// ─────────────────────────────────────────────────────────────
function ModalParametros({
  companyId, params, onClose, onSalvo, onErro,
}: {
  companyId: string
  params: Parametros
  onClose: () => void
  onSalvo: () => void
  onErro: (m: string) => void
}) {
  const [horas, setHoras] = useState(String(params.horas_produtivas_mes))
  const [mMo, setMMo] = useState(String(params.margem_alvo_mao_obra_pct))
  const [mPeca, setMPeca] = useState(String(params.margem_alvo_peca_pct))
  const [custoManual, setCustoManual] = useState(params.custo_hora_manual != null ? String(params.custo_hora_manual) : '')
  const [salvando, setSalvando] = useState(false)

  async function salvar() {
    setSalvando(true)
    const num = (s: string) => { const n = Number((s || '').replace(',', '.')); return Number.isFinite(n) ? n : null }
    const { error } = await supabase.from('erp_oficina_parametros').upsert({
      company_id: companyId,
      horas_produtivas_mes: num(horas) ?? 160,
      margem_alvo_mao_obra_pct: num(mMo) ?? 30,
      margem_alvo_peca_pct: num(mPeca) ?? 40,
      custo_hora_manual: custoManual.trim() ? num(custoManual) : null,
      alterado_em: new Date().toISOString(),
    }, { onConflict: 'company_id' })
    setSalvando(false)
    if (error) { onErro(error.message); return }
    onSalvo()
  }

  return (
    <Overlay onClose={onClose}>
      <div style={{ fontSize: 16, fontWeight: 700, color: C.espresso, marginBottom: 12 }}>Parâmetros da oficina</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label style={lbl}>Custo homem-hora manual (R$) — opcional</label>
          <input value={custoManual} onChange={(e) => setCustoManual(e.target.value)} inputMode="decimal" placeholder="deixe vazio p/ cálculo automático (próximo passo)" style={inp} />
          <div style={{ fontSize: 11, color: C.espressoL, marginTop: 4 }}>No próximo passo o sistema calcula isso automático dos custos reais de GE.</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div><label style={lbl}>Margem mão de obra (%)</label><input value={mMo} onChange={(e) => setMMo(e.target.value)} inputMode="decimal" style={inp} /></div>
          <div><label style={lbl}>Margem peça (%)</label><input value={mPeca} onChange={(e) => setMPeca(e.target.value)} inputMode="decimal" style={inp} /></div>
        </div>
        <div><label style={lbl}>Horas produtivas / mês</label><input value={horas} onChange={(e) => setHoras(e.target.value)} inputMode="decimal" style={inp} /></div>
        <button onClick={salvar} disabled={salvando} style={{
          minHeight: 48, padding: '12px 18px', borderRadius: 10, background: salvando ? C.cream : C.gold,
          color: salvando ? C.espressoL : C.white, border: 'none', fontSize: 14, fontWeight: 700, cursor: salvando ? 'not-allowed' : 'pointer',
        }}>{salvando ? 'Salvando…' : 'Salvar parâmetros'}</button>
      </div>
    </Overlay>
  )
}

// ─────────────────────────────────────────────────────────────
// Modal confirmar exclusão (soft delete)
// ─────────────────────────────────────────────────────────────
function ConfirmExcluir({ nome, onClose, onConfirm }: { nome: string; onClose: () => void; onConfirm: (motivo: string) => void }) {
  const [motivo, setMotivo] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <Overlay onClose={onClose} maxWidth={440}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 26 }}>🗑️</span>
        <div style={{ fontSize: 17, fontWeight: 800, color: C.espresso }}>Excluir “{nome}”?</div>
      </div>
      <div style={{ fontSize: 13, color: C.espressoM, marginBottom: 12, lineHeight: 1.5 }}>
        O serviço sai do tempário. <strong style={{ color: C.espresso }}>Não dá pra desfazer.</strong> O registro é preservado (soft-delete).
      </div>
      <label style={{ display: 'block', marginBottom: 14 }}>
        <span style={lbl}>Motivo (opcional)</span>
        <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: serviço duplicado" style={{ ...inp, minHeight: 56, resize: 'vertical' }} autoFocus />
      </label>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onClose} disabled={busy} style={{ minHeight: 44, padding: '10px 16px', borderRadius: 10, border: `1px solid ${C.border}`, background: C.white, color: C.espressoM, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Voltar</button>
        <button onClick={() => { setBusy(true); onConfirm(motivo.trim()) }} disabled={busy} style={{ minHeight: 44, padding: '10px 18px', borderRadius: 10, border: 'none', background: C.red, color: C.white, fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>
          {busy ? 'Excluindo…' : 'Excluir serviço'}
        </button>
      </div>
    </Overlay>
  )
}

function Overlay({ children, onClose, maxWidth = 540 }: { children: React.ReactNode; onClose: () => void; maxWidth?: number }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 220, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 12, overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.white, borderRadius: 14, width: '100%', maxWidth, padding: 18, marginTop: 24, marginBottom: 24, border: `1px solid ${C.border}`, boxShadow: '0 20px 60px rgba(61,35,20,0.28)' }}>
        {children}
      </div>
    </div>
  )
}
