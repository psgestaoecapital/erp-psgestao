'use client'
import { useEffect, useState, type CSSProperties, type DragEvent } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { labelUsuario } from '@/lib/usuarioLabel'

type UsuarioOpt = { id: string; email: string | null; full_name?: string | null }
type Fechada = {
  id: string; titulo: string; cliente_id: string | null; valor: number
  data_fechamento: string | null; motivo_perda: string | null; orcamento_id: string | null
  responsavel: string | null; obra: string | null
}

// Etapas operacionais (V1): mostradas como colunas do Kanban.
// 'ganho'/'perdido' nao entram aqui — sao resumo lateral (ja vem em fn_crm_pipeline.resumo).
const ETAPAS_OPS: { v: string; l: string; bg: string; fg: string }[] = [
  { v: 'prospeccao',       l: 'Prospecção',       bg: '#F0E9DE', fg: '#6b5444' },
  { v: 'visita_agendada',  l: 'Visita Agendada',  bg: '#FFF3D6', fg: '#7A5A0F' },
  { v: 'visita_feita',     l: 'Visita Feita',     bg: '#E7DED3', fg: '#3D2314' },
  { v: 'orcando',          l: 'Orçando',          bg: '#FCE9C2', fg: '#7A5A0F' },
  { v: 'proposta_enviada', l: 'Proposta Enviada', bg: '#FAD18A', fg: '#5A3D08' },
  { v: 'negociacao',       l: 'Negociação',       bg: '#F4B860', fg: '#3D2314' },
]
const ETAPAS_DESTINOS = [
  ...ETAPAS_OPS,
  { v: 'ganho',   l: 'Ganho',   bg: '#DCEFD7', fg: '#1F5A1F' },
  { v: 'perdido', l: 'Perdido', bg: '#F4D6D6', fg: '#7A1F1F' },
]
const labelEtapa = (v: string) => ETAPAS_DESTINOS.find((e) => e.v === v)?.l ?? v

const ESPRESSO = '#3D2314'
const OFFWHITE = '#FAF7F2'
const DOURADO  = '#C8941A'
const BORDA    = '#E7DED3'
const TEXTM    = '#6b5444'

const brl = (n: number | null | undefined) =>
  (n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

type Card = {
  id: string
  titulo: string
  cliente: string | null
  valor_estimado: number | null
  probabilidade: number | null
  responsavel_id: string | null
  ordem: number | null
  data_prevista: string | null
}
type Etapa = {
  etapa: string
  qtd: number
  valor_total: number
  cards: Card[]
}
type Pipeline = {
  etapas: Etapa[] | null
}

interface Props {
  companyId: string
  usuarios: UsuarioOpt[]   // FIX 3 · p/ exibir o responsável por nome (via responsavel_id)
  refreshKey: number
  onMoved: (msg: string) => void
  onError: (msg: string) => void
  // Filtros herdados da antiga visão Lista (agora únicos, no topo da página).
  filtroEtapa: string
  filtroResp: string
  busca: string
  onCount: (n: number) => void
  // Ações por card (a página resolve o Row completo por id: abre modal / exclui).
  onEdit: (id: string) => void
  onExcluir: (id: string) => void
  excluindoId?: string | null
}

export default function OportunidadesKanban({
  companyId, usuarios, refreshKey, onMoved, onError,
  filtroEtapa, filtroResp, busca, onCount, onEdit, onExcluir, excluindoId,
}: Props) {
  const router = useRouter()
  // FIX 3 · responsável exibido pelo NOME do usuário (via responsavel_id), não pelo texto legado.
  const nomeResp = (id: string | null): string | null => {
    if (!id) return null
    const u = usuarios.find((x) => x.id === id)
    return u ? labelUsuario(u, usuarios) : null
  }
  const [pipe, setPipe] = useState<Pipeline | null>(null)
  const [loading, setLoading] = useState(true)
  const [dragId, setDragId] = useState<string | null>(null)
  const [hoverEtapa, setHoverEtapa] = useState<string | null>(null)
  const [movendoId, setMovendoId] = useState<string | null>(null)
  // resumo lateral ganho/perdido (a RPC nao traz; consultamos direto)
  const [ganhos, setGanhos] = useState<{ qtd: number; total: number }>({ qtd: 0, total: 0 })
  const [perdidos, setPerdidos] = useState<{ qtd: number; total: number }>({ qtd: 0, total: 0 })
  // FIX (Angélica): clicar em Ganhas/Perdidas → lista das fechadas (cliente + orçamento).
  const [fechadas, setFechadas] = useState<null | { etapa: 'ganho' | 'perdido'; loading: boolean; itens: Fechada[] }>(null)
  const [nomesCliente, setNomesCliente] = useState<Record<string, string>>({})

  async function abrirFechadas(etapa: 'ganho' | 'perdido') {
    setFechadas({ etapa, loading: true, itens: [] })
    const { data } = await supabase.rpc('fn_crm_oportunidades_fechadas', { p_company_id: companyId, p_etapa: etapa })
    const j = data as { ok?: boolean; itens?: Fechada[] } | null
    const itens = j?.ok ? (j.itens ?? []) : []
    setFechadas({ etapa, loading: false, itens })
    const ids = [...new Set(itens.map((i) => i.cliente_id).filter(Boolean))] as string[]
    if (ids.length) {
      const { data: cs } = await supabase.from('erp_clientes').select('id, razao_social, nome_fantasia').in('id', ids)
      const map: Record<string, string> = {}
      for (const c of (cs ?? []) as { id: string; razao_social: string | null; nome_fantasia: string | null }[])
        map[c.id] = c.razao_social || c.nome_fantasia || ''
      setNomesCliente((prev) => ({ ...prev, ...map }))
    }
  }
  // FIX B · modal de motivo da perda (obrigatório)
  const [perda, setPerda] = useState<{ cardId: string; etapaAtual: string | null } | null>(null)
  const [perdaMotivo, setPerdaMotivo] = useState('')
  const [perdaObs, setPerdaObs] = useState('')

  async function confirmarPerda() {
    if (!perda || !perdaMotivo) return
    const motivo = perdaObs.trim() ? `${perdaMotivo} — ${perdaObs.trim()}` : perdaMotivo
    const p = perda
    setPerda(null)
    await aplicarMove(p.cardId, 'perdido', p.etapaAtual, motivo)
  }

  async function carregar() {
    setLoading(true)
    const [p, gp] = await Promise.all([
      supabase.rpc('fn_crm_pipeline', { p_company_id: companyId }),
      supabase
        .from('erp_crm_oportunidade')
        .select('etapa, valor_estimado')
        .eq('company_id', companyId)
        .in('etapa', ['ganho', 'perdido']),
    ])
    setPipe((p.data ?? { etapas: [] }) as Pipeline)
    const rows = (gp.data ?? []) as Array<{ etapa: string; valor_estimado: number | null }>
    const g = rows.filter((r) => r.etapa === 'ganho')
    const pd = rows.filter((r) => r.etapa === 'perdido')
    setGanhos({ qtd: g.length, total: g.reduce((s, r) => s + Number(r.valor_estimado ?? 0), 0) })
    setPerdidos({ qtd: pd.length, total: pd.reduce((s, r) => s + Number(r.valor_estimado ?? 0), 0) })
    setLoading(false)
  }

  useEffect(() => { carregar() }, [companyId, refreshKey]) // eslint-disable-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect

  const termo = busca.trim().toLowerCase()
  const cardVisivel = (c: Card): boolean => {
    if (filtroResp !== 'todos' && c.responsavel_id !== filtroResp) return false
    if (termo && !`${c.titulo} ${c.cliente ?? ''}`.toLowerCase().includes(termo)) return false
    return true
  }
  const cardsPorEtapa = (etapa: string): Card[] =>
    (pipe?.etapas?.find((e) => e.etapa === etapa)?.cards ?? []).filter(cardVisivel)

  // Filtro de etapa vira "foco": mostra só a coluna escolhida (equivalência com o filtro da lista).
  const colunasVisiveis = ETAPAS_OPS.filter((e) => filtroEtapa === 'todas' || e.v === filtroEtapa)

  const totalEtapa = (etapa: string): { qtd: number; valor: number } => {
    const cards = cardsPorEtapa(etapa)
    return { qtd: cards.length, valor: cards.reduce((s, c) => s + Number(c.valor_estimado ?? 0), 0) }
  }

  // Contador "N oportunidade(s)" herdado da lista → reporta ao topo da página.
  useEffect(() => {
    let n = 0
    for (const et of colunasVisiveis) n += cardsPorEtapa(et.v).length
    onCount(n)
  }, [pipe, filtroEtapa, filtroResp, busca]) // eslint-disable-line react-hooks/exhaustive-deps

  async function moverPara(cardId: string, novaEtapa: string, etapaAtual: string | null) {
    if (etapaAtual === novaEtapa) return
    // Perdido EXIGE motivo (FIX B) — abre o modal com a lista; a baixa só ocorre ao confirmar.
    if (novaEtapa === 'perdido') { setPerda({ cardId, etapaAtual }); setPerdaMotivo(''); setPerdaObs(''); return }
    await aplicarMove(cardId, novaEtapa, etapaAtual, null)
  }

  async function aplicarMove(cardId: string, novaEtapa: string, etapaAtual: string | null, motivo: string | null) {
    // Otimista: tira o card da etapa antiga e poe na nova.
    setMovendoId(cardId)
    setPipe((prev) => {
      if (!prev?.etapas) return prev
      const etapas = prev.etapas.map((e) => ({ ...e, cards: [...e.cards] }))
      let card: Card | null = null
      for (const e of etapas) {
        const idx = e.cards.findIndex((c) => c.id === cardId)
        if (idx >= 0) {
          card = e.cards[idx]
          e.cards.splice(idx, 1)
          e.qtd = Math.max(0, e.qtd - 1)
          e.valor_total = Math.max(0, e.valor_total - Number(card.valor_estimado ?? 0))
        }
      }
      if (card) {
        const destino = etapas.find((e) => e.etapa === novaEtapa)
        if (destino) {
          destino.cards.unshift(card)
          destino.qtd += 1
          destino.valor_total += Number(card.valor_estimado ?? 0)
        }
        // ganho/perdido somam no resumo lateral — atualiza local
        if (novaEtapa === 'ganho') setGanhos((g) => ({ qtd: g.qtd + 1, total: g.total + Number(card!.valor_estimado ?? 0) }))
        if (novaEtapa === 'perdido') setPerdidos((p) => ({ qtd: p.qtd + 1, total: p.total + Number(card!.valor_estimado ?? 0) }))
      }
      return { etapas }
    })

    const { data, error } = await supabase.rpc('fn_crm_mover_etapa', {
      p_id: cardId, p_etapa: novaEtapa, p_motivo_perda: motivo,
    })
    setMovendoId(null)
    if (error) {
      onError(`Erro ao mover: ${error.message}`)
      carregar() // sincroniza com a verdade
      return
    }
    const r = data as { ok?: boolean; erro?: string } | null
    if (r && r.ok === false) {
      onError(`Erro ao mover: ${r.erro ?? 'falha'}`)
      carregar()
      return
    }
    onMoved(`Oportunidade movida para ${labelEtapa(novaEtapa)}.`)
    // Refetch leve (resumo lateral + KPIs consistentes)
    carregar()
  }

  function onDragStart(e: DragEvent<HTMLDivElement>, cardId: string) {
    e.dataTransfer.setData('text/plain', cardId)
    e.dataTransfer.effectAllowed = 'move'
    setDragId(cardId)
  }
  function onDragOver(e: DragEvent<HTMLDivElement>, etapa: string) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (hoverEtapa !== etapa) setHoverEtapa(etapa)
  }
  function onDragLeave(etapa: string) {
    if (hoverEtapa === etapa) setHoverEtapa(null)
  }
  function onDrop(e: DragEvent<HTMLDivElement>, etapa: string) {
    e.preventDefault()
    const cardId = e.dataTransfer.getData('text/plain') || dragId
    setDragId(null)
    setHoverEtapa(null)
    if (!cardId) return
    // descobre etapa atual
    let etapaAtual: string | null = null
    for (const col of (pipe?.etapas ?? [])) {
      if (col.cards.some((c) => c.id === cardId)) { etapaAtual = col.etapa; break }
    }
    moverPara(cardId, etapa, etapaAtual)
  }
  function onDragEnd() {
    setDragId(null)
    setHoverEtapa(null)
  }

  return (
    <div>
      {/* Resumo lateral ganho/perdido (V1 — colunas terminais como tiles) */}
      <div className="flex gap-2 mb-3 flex-wrap">
        <ResumoTile titulo="Ganhas" qtd={ganhos.qtd} valor={ganhos.total} variante="ganho" onClick={() => void abrirFechadas('ganho')} />
        <ResumoTile titulo="Perdidas" qtd={perdidos.qtd} valor={perdidos.total} variante="perdido" onClick={() => void abrirFechadas('perdido')} />
        {loading && <span className="text-xs opacity-60 self-center">Carregando…</span>}
      </div>

      {/* Board com scroll horizontal mobile-first */}
      <div style={boardWrap}>
        <div style={board}>
          {colunasVisiveis.map((et) => {
            const cards = cardsPorEtapa(et.v)
            const tot = totalEtapa(et.v)
            const hover = hoverEtapa === et.v
            return (
              <div
                key={et.v}
                style={{ ...col, ...(hover ? colHover : {}) }}
                onDragOver={(e) => onDragOver(e, et.v)}
                onDragLeave={() => onDragLeave(et.v)}
                onDrop={(e) => onDrop(e, et.v)}
              >
                <div style={colHead}>
                  <span style={{ ...etapaChip, background: et.bg, color: et.fg }}>{et.l}</span>
                  <span style={{ fontSize: 11, color: TEXTM }}>{tot.qtd}</span>
                </div>
                <div style={colSubHead}>
                  <span>{brl(tot.valor)}</span>
                </div>
                <div style={colList}>
                  {cards.length === 0 ? (
                    <div style={emptyHint}>—</div>
                  ) : cards.map((c) => (
                    <div
                      key={c.id}
                      draggable
                      onDragStart={(e) => onDragStart(e, c.id)}
                      onDragEnd={onDragEnd}
                      onClick={() => router.push(`/dashboard/projetos/oportunidades/${c.id}`)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          router.push(`/dashboard/projetos/oportunidades/${c.id}`)
                        }
                      }}
                      style={{
                        ...cardSt,
                        opacity: movendoId === c.id ? 0.55 : (dragId === c.id ? 0.6 : 1),
                        cursor: movendoId === c.id ? 'wait' : 'grab',
                      }}
                    >
                      <div style={{ fontWeight: 600, color: ESPRESSO, fontSize: 13, lineHeight: 1.2 }}>{c.titulo}</div>
                      {c.cliente && <div style={{ fontSize: 12, color: TEXTM, marginTop: 2 }}>{c.cliente}</div>}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, gap: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: DOURADO }}>{brl(c.valor_estimado)}</span>
                        {c.probabilidade != null && (
                          <span style={probBadge}>{c.probabilidade}%</span>
                        )}
                      </div>
                      {nomeResp(c.responsavel_id) && (
                        <div style={{ fontSize: 11, color: TEXTM, marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span aria-hidden>👤</span>{nomeResp(c.responsavel_id)}
                        </div>
                      )}
                      {/* Fallback touch: select de etapa */}
                      <div style={{ marginTop: 6 }} onClick={(e) => e.stopPropagation()}>
                        <select
                          value={et.v}
                          onChange={(e) => moverPara(c.id, e.target.value, et.v)}
                          aria-label="Mover para outra etapa"
                          style={moverSel}
                          disabled={movendoId === c.id}
                        >
                          {ETAPAS_DESTINOS.map((d) => (
                            <option key={d.v} value={d.v}>
                              {d.v === et.v ? `· ${d.l} (atual)` : `↳ ${d.l}`}
                            </option>
                          ))}
                        </select>
                      </div>
                      {/* Ações herdadas da lista: Editar · Orçamento/ficha · Excluir */}
                      <div style={cardActions} onClick={(e) => e.stopPropagation()}>
                        <button style={cardActBtn} onClick={() => onEdit(c.id)} title="Editar" aria-label="Editar">✏️</button>
                        <button style={cardActBtn} onClick={() => router.push(`/dashboard/projetos/oportunidades/${c.id}`)} title="Orçamento / ficha" aria-label="Orçamento">📄</button>
                        <button
                          style={{ ...cardActBtn, color: '#9A1F1F' }}
                          onClick={() => onExcluir(c.id)}
                          disabled={excluindoId === c.id}
                          title="Excluir" aria-label="Excluir"
                        >🗑️</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {perda && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60 }} onClick={() => setPerda(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, padding: 20, width: '92%', maxWidth: 400, border: `1px solid ${BORDA}` }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: ESPRESSO, marginBottom: 4 }}>Por que perdeu?</div>
            <div style={{ fontSize: 12, color: TEXTM, marginBottom: 12 }}>Escolha o motivo — obrigatório para marcar como Perdido.</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
              {['preço', 'prazo', 'concorrente', 'desistência', 'sem retorno', 'outro'].map((m) => (
                <button key={m} onClick={() => setPerdaMotivo(m)} style={{ padding: '6px 12px', borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize', border: `1px solid ${perdaMotivo === m ? '#7A1F1F' : BORDA}`, background: perdaMotivo === m ? '#F4D6D6' : '#fff', color: perdaMotivo === m ? '#7A1F1F' : TEXTM }}>{m}</button>
              ))}
            </div>
            <textarea value={perdaObs} onChange={(e) => setPerdaObs(e.target.value)} placeholder="Observação (opcional)" rows={2}
              style={{ width: '100%', border: `1px solid ${BORDA}`, borderRadius: 8, padding: '8px 10px', fontSize: 12.5, color: ESPRESSO, boxSizing: 'border-box', resize: 'vertical' }} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button onClick={() => setPerda(null)} style={{ ...cardActBtn, padding: '7px 14px' }}>Cancelar</button>
              <button onClick={() => { void confirmarPerda() }} disabled={!perdaMotivo}
                style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: perdaMotivo ? '#7A1F1F' : '#ccc', color: '#fff', fontSize: 12.5, fontWeight: 700, cursor: perdaMotivo ? 'pointer' : 'not-allowed' }}>
                Marcar como Perdido
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FIX (Angélica): lista de Ganhas/Perdidas — cliente + valor + orçamento */}
      {fechadas && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 16 }} onClick={() => setFechadas(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 560, maxHeight: '86vh', display: 'flex', flexDirection: 'column', border: `1px solid ${BORDA}` }}>
            <div style={{ padding: '16px 18px', borderBottom: `1px solid ${BORDA}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
              <h3 style={{ margin: 0, fontFamily: 'Fraunces, Georgia, serif', fontWeight: 400, color: ESPRESSO }}>
                Oportunidades {fechadas.etapa === 'ganho' ? 'Ganhas' : 'Perdidas'} ({fechadas.itens.length})
              </h3>
              <button onClick={() => setFechadas(null)} style={{ ...cardActBtn, padding: '4px 10px' }}>Fechar</button>
            </div>
            <div style={{ padding: 14, overflowY: 'auto' }}>
              {fechadas.loading ? (
                <div style={{ padding: 20, textAlign: 'center', color: TEXTM, fontSize: 13 }}>Carregando…</div>
              ) : fechadas.itens.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: TEXTM, fontSize: 13 }}>
                  Nenhuma oportunidade {fechadas.etapa === 'ganho' ? 'ganha' : 'perdida'} ainda.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {fechadas.itens.map((it) => {
                    const nome = (it.cliente_id && nomesCliente[it.cliente_id]) || null
                    return (
                      <div key={it.id} style={{ border: `1px solid ${BORDA}`, borderRadius: 10, padding: 12, background: OFFWHITE }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 700, color: ESPRESSO, fontSize: 13.5 }}>{nome ?? it.titulo}</div>
                            {nome && it.titulo && <div style={{ fontSize: 12, color: TEXTM }}>{it.titulo}</div>}
                            {it.obra && <div style={{ fontSize: 11, color: TEXTM, marginTop: 2 }}>{it.obra}</div>}
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: 14, fontWeight: 700, color: DOURADO }}>{brl(it.valor)}</div>
                            {it.data_fechamento && <div style={{ fontSize: 11, color: TEXTM }}>{it.data_fechamento.slice(0, 10).split('-').reverse().join('/')}</div>}
                          </div>
                        </div>
                        {fechadas.etapa === 'perdido' && it.motivo_perda && (
                          <div style={{ marginTop: 6, fontSize: 12, color: '#7A1F1F' }}>Motivo: <b>{it.motivo_perda}</b></div>
                        )}
                        <div style={{ marginTop: 8 }}>
                          {it.orcamento_id ? (
                            <button onClick={() => router.push(`/dashboard/orcamentos?id=${it.orcamento_id}`)}
                              style={{ ...cardActBtn, padding: '5px 12px', fontSize: 12 }}>Ver orçamento →</button>
                          ) : (
                            <span style={{ fontSize: 11.5, color: TEXTM, fontStyle: 'italic' }}>sem orçamento vinculado</span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ResumoTile({
  titulo, qtd, valor, variante, onClick,
}: { titulo: string; qtd: number; valor: number; variante: 'ganho' | 'perdido'; onClick?: () => void }) {
  const bg = variante === 'ganho' ? '#DCEFD7' : '#F4D6D6'
  const fg = variante === 'ganho' ? '#1F5A1F' : '#7A1F1F'
  return (
    <button type="button" onClick={onClick} title={`Ver ${titulo.toLowerCase()}`}
      style={{ ...tileSt, background: bg, color: fg, cursor: onClick ? 'pointer' : 'default' }}>
      <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>{titulo}</span>
      <span style={{ fontSize: 13, fontWeight: 700 }}>{qtd}</span>
      <span style={{ fontSize: 11, opacity: 0.85 }}>{brl(valor)}</span>
      {onClick && qtd > 0 && <span style={{ fontSize: 11, opacity: 0.7 }}>›</span>}
    </button>
  )
}

const tileSt: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  borderRadius: 999, padding: '4px 12px', border: `1px solid ${BORDA}`,
}
const boardWrap: CSSProperties = {
  overflowX: 'auto',
  paddingBottom: 8,
  WebkitOverflowScrolling: 'touch',
  scrollSnapType: 'x mandatory', // mobile: cada coluna "encaixa" ao rolar
}
const board: CSSProperties = {
  // Desktop: colunas flex ocupam a largura toda e cabem SEM scroll horizontal.
  // Mobile/estreito: minWidth por coluna força overflow → boardWrap rola (com snap).
  display: 'flex', gap: 10, alignItems: 'stretch', width: '100%',
}
const col: CSSProperties = {
  flex: '1 1 0', minWidth: 190,
  scrollSnapAlign: 'start',
  background: OFFWHITE,
  border: `1px solid ${BORDA}`,
  borderRadius: 12,
  padding: 8,
  display: 'flex', flexDirection: 'column', gap: 6,
  height: 'calc(100vh - 250px)', // altura igual, ocupa a viewport (scroll interno por coluna)
}
const colHover: CSSProperties = {
  background: '#F3E9D8',
  borderColor: DOURADO,
}
const colHead: CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
}
const colSubHead: CSSProperties = {
  fontSize: 11, color: TEXTM, paddingBottom: 4, borderBottom: `1px dashed ${BORDA}`,
}
const colList: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 6, overflowY: 'auto', flex: 1,
}
const etapaChip: CSSProperties = {
  fontSize: 11, padding: '2px 8px', borderRadius: 999, fontWeight: 600,
}
const cardSt: CSSProperties = {
  background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 8,
  padding: 8, userSelect: 'none', transition: 'opacity .15s',
}
const cardActions: CSSProperties = {
  display: 'flex', gap: 4, marginTop: 6, justifyContent: 'flex-end',
}
const cardActBtn: CSSProperties = {
  border: `1px solid ${BORDA}`, background: '#fff', borderRadius: 6,
  padding: '2px 7px', fontSize: 12, lineHeight: 1.1, cursor: 'pointer', minHeight: 26,
}
const probBadge: CSSProperties = {
  fontSize: 10, fontWeight: 600, color: TEXTM,
  background: '#FAF7F2', padding: '2px 8px', borderRadius: 999, border: `1px solid ${BORDA}`,
}
const emptyHint: CSSProperties = {
  textAlign: 'center', color: TEXTM, fontSize: 12, opacity: 0.6, padding: '12px 0',
}
const moverSel: CSSProperties = {
  width: '100%', border: `1px solid ${BORDA}`, borderRadius: 6,
  padding: '4px 6px', fontSize: 11, color: ESPRESSO, background: '#fff',
  colorScheme: 'light' as CSSProperties['colorScheme'],
}
