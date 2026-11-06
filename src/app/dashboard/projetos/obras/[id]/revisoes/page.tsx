'use client'

// Hub · Gestão de Obras · Revisões de escopo (Blueprint §16 H2 · HBF-5.3) — aba REVISÕES.
// Esta fatia (slice de LEITURA): lista as revisões de escopo da obra — cabeçalho (origem, motivo,
// situação, valor anterior × novo, variação) e os itens de cada revisão (quantidade e preço
// anterior × novo). Consome só a RPC já publicada e guardada fn_obra_revisao_listar (#3935, leitura
// por company_id). NÃO cria nem altera dado: a ABERTURA de uma nova revisão (mudança contratual,
// com piso do medido) é fatia SEPARADA e sensível — não entra aqui.
// RD-95: "?" em todo filtro / indicador / coluna / ação. RD-96/RD-100: linguagem e layout próprios.

import { use, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { erroAmigavel } from '@/lib/erroAmigavel'

const ROTA = '/dashboard/projetos/obras/[id]/revisoes'
const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = 'rgba(61,35,20,0.18)', MUT = 'rgba(61,35,20,0.55)', VERM = '#A32D2D', VERDE = '#2E7D32'

// A camada de dados pode chegar à produção depois desta tela; enquanto não chegar, PostgREST
// responde "relation/function does not exist". RD-98: degrada para aviso de "recurso sendo liberado".
function recursoEmLiberacao(e: unknown): boolean {
  const err = (e && typeof e === 'object' ? e : {}) as { code?: unknown; message?: unknown }
  const code = typeof err.code === 'string' ? err.code : ''
  const msg = typeof err.message === 'string' ? err.message.toLowerCase() : ''
  if (['42P01', 'PGRST202', 'PGRST205'].includes(code)) return true
  return /does not exist|not found|schema cache/.test(msg)
}

const brl = (n: number | null | undefined) =>
  (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const num = (n: number | null | undefined) =>
  (Number(n) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 4 })
const fmtDataHora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'

const ORIGEM_LABEL: Record<string, string> = {
  interno: 'Interna',
  cliente: 'Do cliente',
  contratante: 'Da contratante',
  da_contratante: 'Da contratante',
}

const STATUS_LABEL: Record<string, { l: string; cor: string }> = {
  rascunho: { l: 'Rascunho', cor: MUT },
  solicitada: { l: 'Solicitada', cor: GOLD },
  aprovada: { l: 'Aprovada', cor: VERDE },
  recusada: { l: 'Recusada', cor: VERM },
  cancelada: { l: 'Cancelada', cor: VERM },
  encerrado_por_supressao: { l: 'Encerrada por supressão', cor: ESP },
}

type Obra = { id: string; nome: string | null; company_id: string }
type RevisaoItem = {
  id: string; obra_item_id: string | null; descricao: string | null; unidade: string | null
  quantidade_anterior: number | null; quantidade_nova: number | null
  preco_unitario_anterior: number | null; preco_unitario_novo: number | null
  quantidade_medida_na_revisao: number | null; motivo: string | null
}
type Revisao = {
  id: string; sequencial: number; origem: string | null; motivo: string | null; status: string
  valor_anterior: number | null; valor_novo: number | null; delta: number | null
  solicitado_em: string | null; aprovado_em: string | null; observacoes: string | null; criado_em: string | null
  itens: RevisaoItem[]
}

export default function RevisoesObraPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [obra, setObra] = useState<Obra | null>(null)
  const [revisoes, setRevisoes] = useState<Revisao[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [emLiberacao, setEmLiberacao] = useState(false)
  const [filtro, setFiltro] = useState<'todos' | 'abertas' | 'aprovadas' | 'encerradas'>('todos')
  const [expandido, setExpandido] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setCarregando(true); setErro(null); setEmLiberacao(false)
    const { data: o, error: eo } = await supabase
      .from('projetos_obras').select('id, nome, company_id').eq('id', id).maybeSingle()
    if (eo) { setCarregando(false); setErro(erroAmigavel(eo, 'Não foi possível abrir a obra. Tente de novo.')); return }
    if (!o) { setCarregando(false); setObra(null); return }
    setObra(o as Obra)

    const { data, error } = await supabase.rpc('fn_obra_revisao_listar', { p_obra_id: id })
    setCarregando(false)
    if (error) {
      if (recursoEmLiberacao(error)) { setEmLiberacao(true); return }
      setErro(erroAmigavel(error, 'Não foi possível carregar as revisões. Tente de novo.')); return
    }
    const r = (data ?? {}) as { ok?: boolean; erro?: string; revisoes?: Revisao[] }
    if (r.ok === false) { setErro(r.erro ?? 'Não foi possível carregar as revisões.'); return }
    setRevisoes(r.revisoes ?? [])
  }, [id])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  const revisoesFiltradas = useMemo(() => revisoes.filter((r) => {
    if (filtro === 'todos') return true
    if (filtro === 'abertas') return ['rascunho', 'solicitada'].includes(r.status)
    if (filtro === 'aprovadas') return r.status === 'aprovada'
    if (filtro === 'encerradas') return ['recusada', 'cancelada', 'encerrado_por_supressao'].includes(r.status)
    return true
  }), [revisoes, filtro])

  // Resumo: quantas revisões e a variação ACUMULADA do valor contratado (só as aprovadas movem o contrato).
  const resumo = useMemo(() => {
    const aprovadas = revisoes.filter((r) => r.status === 'aprovada')
    const deltaAprovado = aprovadas.reduce((s, r) => s + (Number(r.delta) || 0), 0)
    return { total: revisoes.length, aprovadas: aprovadas.length, deltaAprovado }
  }, [revisoes])

  const card: React.CSSProperties = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: 18 }
  const lbl: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: ESP, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }
  const inp: React.CSSProperties = { border: `1px solid ${LINE}`, borderRadius: 8, padding: '8px 10px', fontSize: 13, color: ESP, background: BG }
  const btn = (bg: string, fg = '#fff'): React.CSSProperties => ({ background: bg, color: fg, border: 'none', borderRadius: 9, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' })

  return (
    <div style={{ minHeight: '100vh', background: BG, padding: '20px 16px 80px' }}>
      <div style={{ maxWidth: 1040, margin: '0 auto' }}>
        <Link href={`/dashboard/projetos/obras/${id}/cockpit?area=hub`} style={{ fontSize: 12, color: GOLD, textDecoration: 'none', fontWeight: 600 }}>← Cockpit da obra</Link>

        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: ESP, margin: 0 }}>Revisões de escopo</h1>
          {obra?.nome && <span style={{ fontSize: 14, color: MUT }}>{obra.nome}</span>}
        </div>
        <p style={{ fontSize: 13, color: MUT, marginTop: 4, maxWidth: 680 }}>
          Cada vez que o escopo da obra muda — acréscimo, supressão ou reajuste de preço — a mudança fica registrada aqui como uma revisão, com o valor antes e depois e o que motivou. Só as revisões aprovadas mudam o valor contratado.
        </p>

        {erro && <div style={{ ...card, borderColor: VERM, color: VERM, marginTop: 14, fontSize: 13 }}>{erro}</div>}

        {emLiberacao ? (
          <div style={{ ...card, marginTop: 16, color: MUT, fontSize: 13 }}>Recurso de revisões de escopo sendo liberado para esta empresa. Atualize em instantes.</div>
        ) : carregando ? (
          <div style={{ ...card, marginTop: 16, color: MUT, fontSize: 13 }}>Carregando…</div>
        ) : !obra ? (
          <div style={{ ...card, marginTop: 16, color: MUT, fontSize: 13 }}>Obra não encontrada ou sem acesso.</div>
        ) : (
          <>
            {/* Indicador: resumo das revisões */}
            <div style={{ ...card, marginTop: 16, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: MUT }}>Revisões registradas</span>
              <AjudaCampo chave="projetos.revisao.resumo" rota={ROTA} />
              <strong style={{ color: ESP, fontSize: 18 }}>{resumo.total}</strong>
              <span style={{ fontSize: 12, color: MUT }}>({resumo.aprovadas} aprovada{resumo.aprovadas === 1 ? '' : 's'})</span>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 13, color: MUT }}>Variação aprovada no contrato</span>
              <strong style={{ color: resumo.deltaAprovado > 0 ? VERDE : resumo.deltaAprovado < 0 ? VERM : ESP, fontSize: 16 }}>
                {resumo.deltaAprovado > 0 ? '+' : ''}{brl(resumo.deltaAprovado)}
              </strong>
            </div>

            {/* Filtro por situação */}
            <div style={{ display: 'flex', gap: 10, marginTop: 16, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ flex: 1 }} />
              <label style={lbl}>
                Mostrar <AjudaCampo chave="projetos.revisao.filtro_status" rota={ROTA} />
                <select value={filtro} onChange={(e) => setFiltro(e.target.value as typeof filtro)} style={{ ...inp, width: 'auto' }} data-testid="rev-filtro">
                  <option value="todos">Todas</option>
                  <option value="abertas">Em aberto</option>
                  <option value="aprovadas">Aprovadas</option>
                  <option value="encerradas">Encerradas</option>
                </select>
              </label>
            </div>

            {/* Lista de revisões */}
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {revisoesFiltradas.length === 0 ? (
                <div style={{ ...card, color: MUT, fontSize: 13 }}>
                  {revisoes.length === 0 ? 'Nenhuma revisão de escopo registrada nesta obra ainda. Quando o escopo mudar, a revisão aparece aqui com o valor antes e depois.' : 'Nenhuma revisão no filtro selecionado.'}
                </div>
              ) : revisoesFiltradas.map((r) => {
                const st = STATUS_LABEL[r.status] ?? { l: r.status, cor: MUT }
                const aberto = expandido === r.id
                const delta = Number(r.delta) || 0
                return (
                  <div key={r.id} style={card} data-testid={`rev-row-${r.id}`}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                      <strong style={{ color: ESP, fontSize: 15 }}>
                        Revisão nº {r.sequencial} <AjudaCampo chave="projetos.revisao.sequencial" rota={ROTA} />
                      </strong>
                      <span style={{ fontSize: 12, color: MUT }}>
                        {ORIGEM_LABEL[r.origem ?? ''] ?? r.origem ?? '—'} <AjudaCampo chave="projetos.revisao.origem" rota={ROTA} />
                      </span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: st.cor, border: `1px solid ${st.cor}`, borderRadius: 999, padding: '2px 10px' }}>
                        {st.l}
                      </span>
                      <AjudaCampo chave="projetos.revisao.status" rota={ROTA} />
                      <span style={{ flex: 1 }} />
                      <span style={{ fontSize: 12, color: MUT }}>Solicitada em {fmtDataHora(r.solicitado_em ?? r.criado_em)} <AjudaCampo chave="projetos.revisao.solicitada_em" rota={ROTA} /></span>
                    </div>

                    {r.motivo && (
                      <p style={{ fontSize: 13, color: ESP, margin: '8px 0 0' }}>
                        <span style={{ color: MUT }}>Motivo: <AjudaCampo chave="projetos.revisao.motivo" rota={ROTA} /></span> {r.motivo}
                      </p>
                    )}

                    {/* Valores anterior × novo × variação */}
                    <div style={{ display: 'flex', gap: 24, marginTop: 12, flexWrap: 'wrap', fontSize: 13 }}>
                      <div>
                        <div style={{ fontSize: 11, color: MUT }}>Valor anterior <AjudaCampo chave="projetos.revisao.valor_anterior" rota={ROTA} /></div>
                        <strong style={{ color: ESP }}>{brl(r.valor_anterior)}</strong>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: MUT }}>Valor novo <AjudaCampo chave="projetos.revisao.valor_novo" rota={ROTA} /></div>
                        <strong style={{ color: ESP }}>{brl(r.valor_novo)}</strong>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: MUT }}>Variação <AjudaCampo chave="projetos.revisao.delta" rota={ROTA} /></div>
                        <strong style={{ color: delta > 0 ? VERDE : delta < 0 ? VERM : ESP }}>
                          {delta > 0 ? '+' : ''}{brl(delta)}
                        </strong>
                      </div>
                    </div>

                    {r.observacoes && <p style={{ fontSize: 13, color: MUT, margin: '10px 0 0' }}>{r.observacoes}</p>}

                    <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                      <button onClick={() => setExpandido(aberto ? null : r.id)} style={{ ...btn('transparent', GOLD), padding: '6px 10px', border: `1px solid ${LINE}` }} data-testid={`rev-itens-${r.id}`}>
                        {aberto ? 'Ocultar itens' : `Ver itens (${r.itens.length})`}
                      </button>
                      <AjudaCampo chave="projetos.revisao.itens" rota={ROTA} />
                    </div>

                    {aberto && (
                      <div style={{ marginTop: 12, overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                          <thead>
                            <tr style={{ color: MUT, textAlign: 'left' }}>
                              <th style={{ padding: '6px 8px' }}>Item</th>
                              <th style={{ padding: '6px 8px', textAlign: 'right' }}>Qtd. anterior</th>
                              <th style={{ padding: '6px 8px', textAlign: 'right' }}>Qtd. nova</th>
                              <th style={{ padding: '6px 8px', textAlign: 'right' }}>Preço ant.</th>
                              <th style={{ padding: '6px 8px', textAlign: 'right' }}>Preço novo</th>
                            </tr>
                          </thead>
                          <tbody>
                            {r.itens.length === 0 ? (
                              <tr><td colSpan={5} style={{ padding: '6px 8px', color: MUT }}>Sem itens detalhados nesta revisão.</td></tr>
                            ) : r.itens.map((it, idx) => (
                              <tr key={it.id ?? idx} style={{ borderTop: `1px solid ${LINE}` }}>
                                <td style={{ padding: '6px 8px', color: ESP }}>
                                  {it.descricao || '—'}{it.unidade ? <span style={{ color: MUT }}> ({it.unidade})</span> : null}
                                  {it.motivo ? <div style={{ fontSize: 11, color: MUT }}>{it.motivo}</div> : null}
                                </td>
                                <td style={{ padding: '6px 8px', textAlign: 'right', color: MUT }}>{num(it.quantidade_anterior)}</td>
                                <td style={{ padding: '6px 8px', textAlign: 'right', color: ESP }}>{num(it.quantidade_nova)}</td>
                                <td style={{ padding: '6px 8px', textAlign: 'right', color: MUT }}>{brl(it.preco_unitario_anterior)}</td>
                                <td style={{ padding: '6px 8px', textAlign: 'right', color: ESP }}>{brl(it.preco_unitario_novo)}</td>
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
