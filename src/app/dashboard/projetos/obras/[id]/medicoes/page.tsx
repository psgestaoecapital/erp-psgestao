'use client'

// Hub · Gestão de Obras · Medições ao cliente (H4 · HBF-5.2/5.5) — aba MEDIÇÕES.
// Esta fatia: criar / listar / aprovar / excluir (rastreável) medições da obra sobre a camada de
// dados publicada (#3818: projetos_obra_medicao + _item, RPCs fn_obra_medicao_criar/_listar/
// _aprovar/_excluir). Chama só RPCs já publicadas e guardadas (fn__guarda_empresa / auth.uid()).
// A PONTE financeira (medição aprovada -> erp_receber na GE) é fatia SEPARADA e sensível — NÃO entra
// aqui: aprovar só trava o acumulado no contratado e soma a quantidade medida do item (sem financeiro).
// RD-95: "?" em todo campo / filtro / indicador / ação. RD-96/RD-100: linguagem e layout próprios.

import { use, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { erroAmigavel } from '@/lib/erroAmigavel'

const ROTA = '/dashboard/projetos/obras/[id]/medicoes'
const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = 'rgba(61,35,20,0.18)', MUT = 'rgba(61,35,20,0.55)', VERM = '#A32D2D', VERDE = '#2E7D32'

// A camada de dados pode chegar à produção depois desta tela; enquanto não chegar, PostgREST
// responde "relation does not exist". RD-98: degrada para aviso de "recurso sendo liberado".
function recursoEmLiberacao(e: unknown): boolean {
  const err = (e && typeof e === 'object' ? e : {}) as { code?: unknown; message?: unknown }
  const code = typeof err.code === 'string' ? err.code : ''
  const msg = typeof err.message === 'string' ? err.message.toLowerCase() : ''
  if (['42P01', 'PGRST202', 'PGRST205'].includes(code)) return true
  return /does not exist|not found|schema cache/.test(msg)
}

const brl = (n: number | null | undefined) =>
  (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtData = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'

const STATUS_LABEL: Record<string, { l: string; cor: string }> = {
  rascunho: { l: 'Rascunho', cor: MUT },
  aprovada: { l: 'Aprovada', cor: VERDE },
}

type Obra = { id: string; nome: string | null; company_id: string }
type ItemEscopo = {
  id: string; descricao: string | null; unidade: string | null
  quantidade_contratada: number | null; preco_unitario: number | null; valor_contratado: number | null; ordem: number | null
}
type MedicaoItem = {
  obra_item_id: string; descricao: string | null
  percentual: number | null; quantidade: number | null; valor: number | null; valor_contratado: number | null
}
type Medicao = {
  id: string; numero: number; tipo: string; competencia: string | null; status: string
  valor_total: number | null; observacoes: string | null; aprovada_em: string | null; criado_em: string | null
  itens: MedicaoItem[]
}

export default function MedicoesObraPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [obra, setObra] = useState<Obra | null>(null)
  const [medicoes, setMedicoes] = useState<Medicao[]>([])
  const [itens, setItens] = useState<ItemEscopo[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [emLiberacao, setEmLiberacao] = useState(false)
  const [filtro, setFiltro] = useState<'todas' | 'rascunho' | 'aprovada'>('todas')
  const [expandida, setExpandida] = useState<string | null>(null)

  // Formulário de nova medição / edição de rascunho (RD-98 p2). editId != null → editando.
  const [abrirForm, setAbrirForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [editNumero, setEditNumero] = useState<number | null>(null)
  const [tipo, setTipo] = useState<'percentual' | 'quantidade'>('percentual')
  const [competencia, setCompetencia] = useState<string>(() => new Date().toISOString().slice(0, 10))
  const [observacoes, setObservacoes] = useState('')
  const [linhas, setLinhas] = useState<Record<string, string>>({})
  const [salvando, setSalvando] = useState(false)

  function fecharForm() { setAbrirForm(false); setEditId(null); setEditNumero(null); setLinhas({}); setObservacoes('') }
  function novaMedicao() {
    if (abrirForm && !editId) { fecharForm(); return }
    setEditId(null); setEditNumero(null); setLinhas({}); setObservacoes(''); setTipo('percentual')
    setCompetencia(new Date().toISOString().slice(0, 10)); setErro(null); setAbrirForm(true)
  }
  // RD-98 p2 · abre o formulário pré-preenchido com um rascunho (só rascunho pode ser editado).
  function abrirEditar(med: Medicao) {
    setErro(null)
    setEditId(med.id); setEditNumero(med.numero)
    setTipo(med.tipo === 'quantidade' ? 'quantidade' : 'percentual')
    setCompetencia((med.competencia ?? new Date().toISOString()).slice(0, 10))
    setObservacoes(med.observacoes ?? '')
    const pre: Record<string, string> = {}
    for (const it of med.itens) {
      const v = med.tipo === 'percentual' ? it.percentual : it.quantidade
      if (v != null && Number(v) !== 0) pre[it.obra_item_id] = String(v)
    }
    setLinhas(pre); setAbrirForm(true)
  }

  const carregar = useCallback(async () => {
    setCarregando(true); setErro(null); setEmLiberacao(false)
    const { data: o, error: eo } = await supabase
      .from('projetos_obras').select('id, nome, company_id').eq('id', id).maybeSingle()
    if (eo) { setCarregando(false); setErro(erroAmigavel(eo, 'Não foi possível abrir a obra. Tente de novo.')); return }
    if (!o) { setCarregando(false); setObra(null); return }
    setObra(o as Obra)

    const { data: its } = await supabase
      .from('projetos_obra_item')
      .select('id, descricao, unidade, quantidade_contratada, preco_unitario, valor_contratado, ordem')
      .eq('obra_id', id).is('excluido_em', null).order('ordem', { ascending: true, nullsFirst: false })
    setItens((its as ItemEscopo[]) ?? [])

    const { data, error } = await supabase.rpc('fn_obra_medicao_listar', { p_obra_id: id })
    setCarregando(false)
    if (error) {
      if (recursoEmLiberacao(error)) { setEmLiberacao(true); return }
      setErro(erroAmigavel(error, 'Não foi possível carregar as medições. Tente de novo.')); return
    }
    const r = (data ?? {}) as { ok?: boolean; erro?: string; medicoes?: Medicao[] }
    if (r.ok === false) { setErro(r.erro ?? 'Não foi possível carregar as medições.'); return }
    setMedicoes(r.medicoes ?? [])
  }, [id])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  // Acumulado já APROVADO por item de escopo — usado para mostrar o saldo e evitar passar do contratado.
  const acumPorItem = useMemo(() => {
    const m: Record<string, number> = {}
    for (const med of medicoes) {
      if (med.status !== 'aprovada') continue
      for (const it of med.itens) m[it.obra_item_id] = (m[it.obra_item_id] ?? 0) + (Number(it.valor) || 0)
    }
    return m
  }, [medicoes])

  const previaValor = useMemo(() => {
    let total = 0
    for (const it of itens) {
      const raw = (linhas[it.id] ?? '').replace(',', '.').trim()
      if (!raw) continue
      const n = Number(raw)
      if (!isFinite(n) || n === 0) continue
      const contr = Number(it.valor_contratado) || (Number(it.preco_unitario) || 0) * (Number(it.quantidade_contratada) || 0)
      total += tipo === 'percentual' ? (n / 100) * contr : n * (Number(it.preco_unitario) || 0)
    }
    return total
  }, [linhas, itens, tipo])

  const medicoesFiltradas = medicoes.filter((m) => filtro === 'todas' || m.status === filtro)

  async function salvar() {
    if (!obra) return
    const payload = itens
      .map((it) => {
        const raw = (linhas[it.id] ?? '').replace(',', '.').trim()
        if (!raw) return null
        const n = Number(raw)
        if (!isFinite(n) || n === 0) return null
        return tipo === 'percentual'
          ? { obra_item_id: it.id, percentual: n }
          : { obra_item_id: it.id, quantidade: n }
      })
      .filter(Boolean)
    if (payload.length === 0) { setErro('Informe ao menos uma linha de medição (percentual ou quantidade > 0).'); return }
    setSalvando(true); setErro(null)
    const { data, error } = editId
      ? await supabase.rpc('fn_obra_medicao_editar', {
          p_medicao_id: editId, p_tipo: tipo, p_competencia: competencia, p_itens: payload, p_observacoes: observacoes || null,
        })
      : await supabase.rpc('fn_obra_medicao_criar', {
          p_obra_id: id, p_tipo: tipo, p_competencia: competencia, p_itens: payload, p_observacoes: observacoes || null,
        })
    setSalvando(false)
    const acao = editId ? 'salvar a medição' : 'criar a medição'
    if (error) { setErro(erroAmigavel(error, `Não foi possível ${acao}.`)); return }
    const r = (data ?? {}) as { ok?: boolean; erro?: string }
    if (r.ok === false) { setErro(r.erro ?? `Não foi possível ${acao}.`); return }
    fecharForm()
    await carregar()
  }

  async function aprovar(med: Medicao) {
    if (!confirm(`Aprovar a medição nº ${med.numero} (${brl(med.valor_total)})? Ela trava o acumulado no contratado e soma a quantidade medida do escopo.`)) return
    setErro(null)
    const { data, error } = await supabase.rpc('fn_obra_medicao_aprovar', { p_medicao_id: med.id })
    if (error) { setErro(erroAmigavel(error, 'Não foi possível aprovar a medição.')); return }
    const r = (data ?? {}) as { ok?: boolean; erro?: string }
    if (r.ok === false) { setErro(r.erro ?? 'Não foi possível aprovar a medição.'); return }
    await carregar()
  }

  async function excluir(med: Medicao) {
    const motivo = prompt(`Excluir a medição nº ${med.numero}? Fica registrado quem excluiu e o motivo (a medição não some do histórico). Motivo:`)
    if (motivo === null) return
    setErro(null)
    const { data, error } = await supabase.rpc('fn_obra_medicao_excluir', { p_medicao_id: med.id, p_motivo: motivo || null })
    if (error) { setErro(erroAmigavel(error, 'Não foi possível excluir a medição.')); return }
    const r = (data ?? {}) as { ok?: boolean; erro?: string }
    if (r.ok === false) { setErro(r.erro ?? 'Não foi possível excluir a medição.'); return }
    await carregar()
  }

  const card: React.CSSProperties = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: 18 }
  const lbl: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: ESP, display: 'flex', alignItems: 'center', gap: 4 }
  const inp: React.CSSProperties = { border: `1px solid ${LINE}`, borderRadius: 8, padding: '8px 10px', fontSize: 13, color: ESP, background: BG, width: '100%' }
  const btn = (bg: string, fg = '#fff'): React.CSSProperties => ({ background: bg, color: fg, border: 'none', borderRadius: 9, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' })

  return (
    <div style={{ minHeight: '100vh', background: BG, padding: '20px 16px 80px' }}>
      <div style={{ maxWidth: 1040, margin: '0 auto' }}>
        <Link href={`/dashboard/projetos/obras/${id}/cockpit?area=hub`} style={{ fontSize: 12, color: GOLD, textDecoration: 'none', fontWeight: 600 }}>← Cockpit da obra</Link>

        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: ESP, margin: 0 }}>Medições</h1>
          {obra?.nome && <span style={{ fontSize: 14, color: MUT }}>{obra.nome}</span>}
        </div>
        <p style={{ fontSize: 13, color: MUT, marginTop: 4, maxWidth: 680 }}>
          Quanto do escopo contratado já foi executado e pode ser faturado. Cada medição soma por item, trava no contratado quando aprovada e fica no histórico (exclusão rastreável).
        </p>

        {erro && <div style={{ ...card, borderColor: VERM, color: VERM, marginTop: 14, fontSize: 13 }}>{erro}</div>}

        {emLiberacao ? (
          <div style={{ ...card, marginTop: 16, color: MUT, fontSize: 13 }}>Recurso de medições sendo liberado para esta empresa. Atualize em instantes.</div>
        ) : carregando ? (
          <div style={{ ...card, marginTop: 16, color: MUT, fontSize: 13 }}>Carregando…</div>
        ) : !obra ? (
          <div style={{ ...card, marginTop: 16, color: MUT, fontSize: 13 }}>Obra não encontrada ou sem acesso.</div>
        ) : (
          <>
            {/* Barra de ações + filtro */}
            <div style={{ display: 'flex', gap: 10, marginTop: 16, alignItems: 'center', flexWrap: 'wrap' }}>
              <button onClick={() => novaMedicao()} style={btn(GOLD, ESP)} data-testid="med-nova">
                {abrirForm && !editId ? 'Fechar' : '+ Nova medição'}
              </button>
              <AjudaCampo chave="projetos.medicao.criar" rota={ROTA} />
              <span style={{ flex: 1 }} />
              <label style={{ ...lbl, fontWeight: 600 }}>
                Mostrar <AjudaCampo chave="projetos.medicao.filtro_status" rota={ROTA} />
              </label>
              <select value={filtro} onChange={(e) => setFiltro(e.target.value as typeof filtro)} style={{ ...inp, width: 'auto' }} data-testid="med-filtro">
                <option value="todas">Todas</option>
                <option value="rascunho">Rascunho</option>
                <option value="aprovada">Aprovada</option>
              </select>
            </div>

            {/* Formulário de nova medição */}
            {abrirForm && (
              <div style={{ ...card, marginTop: 12 }} data-testid="med-form">
                {editId && <div style={{ fontSize: 14, fontWeight: 800, color: ESP, marginBottom: 10 }}>Editar rascunho — Medição nº {editNumero}</div>}
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 180 }} data-ajuda="projetos.medicao.tipo">
                    <div style={lbl}>Medir por <AjudaCampo chave="projetos.medicao.tipo" rota={ROTA} /></div>
                    <select value={tipo} onChange={(e) => { setTipo(e.target.value as typeof tipo); setLinhas({}) }} style={{ ...inp, marginTop: 4 }} data-testid="med-tipo">
                      <option value="percentual">% do contratado</option>
                      <option value="quantidade">Quantidade executada</option>
                    </select>
                  </div>
                  <div style={{ minWidth: 180 }} data-ajuda="projetos.medicao.competencia">
                    <div style={lbl}>Competência <AjudaCampo chave="projetos.medicao.competencia" rota={ROTA} /></div>
                    <input type="date" value={competencia} onChange={(e) => setCompetencia(e.target.value)} style={{ ...inp, marginTop: 4 }} data-testid="med-competencia" />
                  </div>
                </div>

                <div style={{ ...lbl, marginTop: 14 }}>Linhas da medição <AjudaCampo chave="projetos.medicao.linhas" rota={ROTA} /></div>
                {itens.length === 0 ? (
                  <p style={{ fontSize: 13, color: MUT, marginTop: 6 }}>Esta obra ainda não tem itens de escopo contratado. Cadastre o contrato/escopo da obra antes de medir.</p>
                ) : (
                  <div style={{ marginTop: 6, overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }} data-ajuda="projetos.medicao.linhas">
                      <thead>
                        <tr style={{ color: MUT, textAlign: 'left' }}>
                          <th style={{ padding: '6px 8px' }}>Item</th>
                          <th style={{ padding: '6px 8px', textAlign: 'right' }}>Contratado</th>
                          <th style={{ padding: '6px 8px', textAlign: 'right' }}>Já aprovado</th>
                          <th style={{ padding: '6px 8px', textAlign: 'right', width: 150 }}>{tipo === 'percentual' ? '% desta medição' : 'Qtd. desta medição'}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {itens.map((it) => {
                          const contr = Number(it.valor_contratado) || (Number(it.preco_unitario) || 0) * (Number(it.quantidade_contratada) || 0)
                          const acum = acumPorItem[it.id] ?? 0
                          return (
                            <tr key={it.id} style={{ borderTop: `1px solid ${LINE}` }}>
                              <td style={{ padding: '6px 8px', color: ESP }}>{it.descricao || '—'}{it.unidade ? <span style={{ color: MUT }}> ({it.unidade})</span> : null}</td>
                              <td style={{ padding: '6px 8px', textAlign: 'right', color: ESP }}>{brl(contr)}</td>
                              <td style={{ padding: '6px 8px', textAlign: 'right', color: MUT }}>{brl(acum)}</td>
                              <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                                <input
                                  inputMode="decimal"
                                  value={linhas[it.id] ?? ''}
                                  onChange={(e) => setLinhas((p) => ({ ...p, [it.id]: e.target.value }))}
                                  placeholder={tipo === 'percentual' ? '0' : '0'}
                                  style={{ ...inp, textAlign: 'right' }}
                                  data-testid={`med-linha-${it.id}`}
                                />
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                <div data-ajuda="projetos.medicao.observacoes">
                  <div style={{ ...lbl, marginTop: 14 }}>Observações <AjudaCampo chave="projetos.medicao.observacoes" rota={ROTA} /></div>
                  <textarea value={observacoes} onChange={(e) => setObservacoes(e.target.value)} rows={2} style={{ ...inp, marginTop: 4, resize: 'vertical' }} placeholder="Opcional — ex.: medição referente à etapa de fundação concluída." data-testid="med-obs" />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 13, color: ESP }}>
                    <span style={{ color: MUT }}>Valor desta medição </span>
                    <AjudaCampo chave="projetos.medicao.valor_total" rota={ROTA} />
                    <strong style={{ marginLeft: 6 }}>{brl(previaValor)}</strong>
                  </div>
                  <span style={{ flex: 1 }} />
                  {editId && (
                    <button onClick={() => fecharForm()} disabled={salvando} style={{ ...btn('transparent', ESP), border: `1px solid ${LINE}` }} data-testid="med-cancelar-edicao">
                      Cancelar
                    </button>
                  )}
                  <button onClick={() => void salvar()} disabled={salvando || itens.length === 0} style={{ ...btn(ESP), opacity: salvando || itens.length === 0 ? 0.6 : 1 }} data-testid="med-salvar">
                    {salvando ? 'Salvando…' : editId ? 'Salvar alterações' : 'Lançar medição'}
                  </button>
                </div>
              </div>
            )}

            {/* Lista de medições */}
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {medicoesFiltradas.length === 0 ? (
                <div style={{ ...card, color: MUT, fontSize: 13 }}>
                  {medicoes.length === 0 ? 'Nenhuma medição lançada nesta obra ainda. Use “+ Nova medição” para registrar quanto do escopo já foi executado.' : 'Nenhuma medição no filtro selecionado.'}
                </div>
              ) : medicoesFiltradas.map((med) => {
                const st = STATUS_LABEL[med.status] ?? { l: med.status, cor: MUT }
                const aberta = expandida === med.id
                return (
                  <div key={med.id} style={card} data-testid={`med-row-${med.numero}`}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                      <strong style={{ color: ESP, fontSize: 15 }}>Medição nº {med.numero}</strong>
                      <span style={{ fontSize: 12, fontWeight: 700, color: st.cor, border: `1px solid ${st.cor}`, borderRadius: 999, padding: '2px 10px' }}>{st.l}</span>
                      <span style={{ fontSize: 12, color: MUT }}>Competência {fmtData(med.competencia)}</span>
                      <span style={{ fontSize: 12, color: MUT }}>{med.tipo === 'percentual' ? 'Por %' : 'Por quantidade'}</span>
                      <span style={{ flex: 1 }} />
                      <strong style={{ color: ESP, fontSize: 15 }}>{brl(med.valor_total)}</strong>
                    </div>
                    {med.observacoes && <p style={{ fontSize: 13, color: MUT, margin: '8px 0 0' }}>{med.observacoes}</p>}

                    <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                      <button onClick={() => setExpandida(aberta ? null : med.id)} style={{ ...btn('transparent', GOLD), padding: '6px 10px', border: `1px solid ${LINE}` }}>
                        {aberta ? 'Ocultar itens' : `Ver itens (${med.itens.length})`}
                      </button>
                      {med.status === 'rascunho' && (
                        <>
                          <button onClick={() => abrirEditar(med)} style={{ ...btn('transparent', ESP), padding: '6px 10px', border: `1px solid ${LINE}` }} data-testid={`med-editar-${med.numero}`}>Editar</button>
                          <AjudaCampo chave="projetos.medicao.editar" rota={ROTA} />
                          <button onClick={() => void aprovar(med)} style={btn(VERDE)} data-testid={`med-aprovar-${med.numero}`}>Aprovar</button>
                          <AjudaCampo chave="projetos.medicao.aprovar" rota={ROTA} />
                        </>
                      )}
                      <span style={{ flex: 1 }} />
                      <button onClick={() => void excluir(med)} style={{ ...btn('transparent', VERM), padding: '6px 10px', border: `1px solid ${VERM}` }} data-testid={`med-excluir-${med.numero}`}>Excluir</button>
                      <AjudaCampo chave="projetos.medicao.excluir" rota={ROTA} />
                    </div>

                    {aberta && (
                      <div style={{ marginTop: 12, overflowX: 'auto' }}>
                        <div style={{ ...lbl, marginBottom: 4 }}>Acumulado × contratado <AjudaCampo chave="projetos.medicao.acumulado" rota={ROTA} /></div>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                          <thead>
                            <tr style={{ color: MUT, textAlign: 'left' }}>
                              <th style={{ padding: '6px 8px' }}>Item</th>
                              <th style={{ padding: '6px 8px', textAlign: 'right' }}>{med.tipo === 'percentual' ? '%' : 'Qtd.'}</th>
                              <th style={{ padding: '6px 8px', textAlign: 'right' }}>Valor</th>
                              <th style={{ padding: '6px 8px', textAlign: 'right' }}>Contratado</th>
                            </tr>
                          </thead>
                          <tbody>
                            {med.itens.map((it) => (
                              <tr key={it.obra_item_id} style={{ borderTop: `1px solid ${LINE}` }}>
                                <td style={{ padding: '6px 8px', color: ESP }}>{it.descricao || '—'}</td>
                                <td style={{ padding: '6px 8px', textAlign: 'right', color: ESP }}>{med.tipo === 'percentual' ? `${Number(it.percentual) || 0}%` : (Number(it.quantidade) || 0)}</td>
                                <td style={{ padding: '6px 8px', textAlign: 'right', color: ESP }}>{brl(it.valor)}</td>
                                <td style={{ padding: '6px 8px', textAlign: 'right', color: MUT }}>{brl(it.valor_contratado)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
