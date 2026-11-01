'use client'
// Hub · Gestão de Obras · aba Materiais (HBF-1.1 · slice 3).
// A requisição NASCE do item de escopo da obra (projetos_obra_item) e gera, em 1 passo, uma
// solicitação de compra na GE (fn_obra_requisicao_criar REUSA fn_compras_solicitacao_salvar).
// A tela lista as requisições (fn_obra_requisicao_listar), mostra o status da solicitação na GE,
// linka para Compras e exclui o VÍNCULO de forma rastreável (fn_obra_requisicao_excluir).
// Fronteira [→GE]: a compra/estoque continuam da GE — aqui só nasce o pedido e fica o vínculo.
import { use, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { erroAmigavel } from '@/lib/erroAmigavel'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ROTA = '/dashboard/projetos/obras/[id]/materiais'
const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DED3', MUT = 'rgba(61,35,20,0.55)', VERDE = '#16A34A', VERM = '#B91C1C'

type Req = { id: string; solicitacao_id: string; numero: number | null; titulo: string | null; status: string | null; qtd_itens: number; urgente: boolean; criado_em: string }
type ItemEscopo = { id: string; descricao: string; unidade: string | null; quantidade_contratada: number | null }

const fmtData = (s: string) => new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
const corStatus = (s: string | null): string => {
  const v = (s ?? '').toLowerCase()
  if (v.includes('aprov') || v.includes('conclu') || v.includes('receb')) return VERDE
  if (v.includes('cancel') || v.includes('reprov')) return VERM
  if (v.includes('rascunho')) return MUT
  return GOLD
}

export default function MateriaisObraPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [reqs, setReqs] = useState<Req[]>([])
  const [itens, setItens] = useState<ItemEscopo[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [abrirForm, setAbrirForm] = useState(false)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [justificativa, setJustificativa] = useState('')

  const carregar = useCallback(async () => {
    setLoading(true); setErro(null)
    const [r, i] = await Promise.all([
      supabase.rpc('fn_obra_requisicao_listar', { p_obra_id: id }),
      supabase.from('projetos_obra_item').select('id, descricao, unidade, quantidade_contratada')
        .eq('obra_id', id).is('excluido_em', null).order('ordem', { ascending: true, nullsFirst: false }).order('criado_em'),
    ])
    if (r.error) { setErro(erroAmigavel(r.error)); setLoading(false); return }
    setReqs((r.data ?? []) as Req[])
    const its = ((i.data ?? []) as ItemEscopo[]).filter((x) => (x.descricao ?? '').trim() !== '')
    setItens(its)
    setLoading(false)
  }, [id])
  // eslint-disable-next-line react-hooks/set-state-in-effect -- carrega quando a obra muda
  useEffect(() => { void carregar() }, [carregar])

  const todosMarcados = itens.length > 0 && sel.size === itens.length
  const toggle = (iid: string) => setSel((s) => { const n = new Set(s); if (n.has(iid)) n.delete(iid); else n.add(iid); return n })
  const toggleTodos = () => setSel(todosMarcados ? new Set() : new Set(itens.map((x) => x.id)))

  const gerar = async () => {
    if (!sel.size) { setErro('Marque ao menos um item de escopo para requisitar.'); return }
    setBusy(true); setErro(null); setMsg(null)
    try {
      const { data, error } = await supabase.rpc('fn_obra_requisicao_criar', {
        p_obra_id: id, p_obra_item_ids: [...sel], p_justificativa: justificativa.trim() || null,
      })
      if (error) { setErro(erroAmigavel(error)); return }
      const j = data as { ok?: boolean; erro?: string; qtd_itens?: number }
      if (!j?.ok) { setErro(j?.erro ?? 'Não foi possível gerar a requisição.'); return }
      setMsg(`Requisição gerada com ${j.qtd_itens} item(ns) — acompanhe o status abaixo ou abra em Compras.`)
      setAbrirForm(false); setSel(new Set()); setJustificativa('')
      await carregar()
    } finally { setBusy(false) }
  }

  const excluir = async (r: Req) => {
    const motivo = window.prompt(`Excluir o vínculo da requisição ${r.numero ? `#${r.numero}` : ''}? A solicitação na GE NÃO é apagada. Informe o motivo (fica registrado):`)?.trim()
    if (!motivo) return
    setBusy(true); setErro(null); setMsg(null)
    try {
      const { data, error } = await supabase.rpc('fn_obra_requisicao_excluir', { p_id: r.id, p_motivo: motivo })
      if (error) { setErro(erroAmigavel(error)); return }
      const j = data as { ok?: boolean; erro?: string }
      if (!j?.ok) { setErro(j?.erro ?? 'Falha ao excluir a requisição.'); return }
      setMsg('Vínculo da requisição removido (rastreável).')
      await carregar()
    } finally { setBusy(false) }
  }

  const kpis = useMemo(() => ({ reqs: reqs.length, itens: itens.length }), [reqs, itens])

  return (
    <div style={{ minHeight: '100vh', background: BG, color: ESP, padding: 16 }} data-testid="obra-materiais-page">
      <div style={{ maxWidth: 920, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <Link href={`/dashboard/projetos/obras/${id}/cockpit?area=hub`} style={{ fontSize: 12, color: GOLD, fontWeight: 700, textDecoration: 'none' }}>← Cockpit da obra</Link>
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 700, display: 'flex', alignItems: 'center', margin: '2px 0 2px' }}>
          Materiais da obra<AjudaCampo chave="projetos.obra_materiais.tela" rota={ROTA} />
        </h1>
        <p style={{ fontSize: 13, color: MUT, marginTop: 0 }}>Requisite material a partir do escopo em 1 passo. A compra segue no setor de Compras (GE).</p>

        {erro && <div style={{ background: '#F7E1E1', color: '#791F1F', borderRadius: 10, padding: '10px 14px', fontSize: 13, margin: '10px 0' }} onClick={() => setErro(null)}>{erro}</div>}
        {msg && <div style={{ background: '#E6F4EA', color: '#1E5631', borderRadius: 10, padding: '10px 14px', fontSize: 13, margin: '10px 0' }} onClick={() => setMsg(null)}>{msg}</div>}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, margin: '12px 0' }}>
          <div style={card}>
            <div style={kpiLbl}>Requisições<AjudaCampo chave="projetos.obra_materiais.kpi_requisicoes" rota={ROTA} /></div>
            <div style={kpiVal}>{kpis.reqs}</div>
          </div>
          <div style={card}>
            <div style={kpiLbl}>Itens de escopo<AjudaCampo chave="projetos.obra_materiais.kpi_itens_escopo" rota={ROTA} /></div>
            <div style={kpiVal}>{kpis.itens}</div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginBottom: 10 }}>
          <button type="button" onClick={() => { setAbrirForm((v) => !v); setErro(null) }} disabled={busy || !itens.length} data-testid="mat-requisitar" style={btnPri}>
            {abrirForm ? 'Fechar' : 'Requisitar material'}
          </button>
          <AjudaCampo chave="projetos.obra_materiais.requisitar" rota={ROTA} />
          {!itens.length && !loading && <span style={{ fontSize: 12, color: MUT, marginLeft: 8 }}>Esta obra ainda não tem itens de escopo com descrição.</span>}
        </div>

        {abrirForm && (
          <div style={{ ...card, marginBottom: 14 }} data-testid="mat-form">
            <div style={{ display: 'flex', alignItems: 'center', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input type="checkbox" checked={todosMarcados} onChange={toggleTodos} data-testid="mat-sel-todos" />
                Selecionar todos
              </label>
              <AjudaCampo chave="projetos.obra_materiais.selecionar_todos" rota={ROTA} />
              <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', fontSize: 12, color: MUT }}>itens de escopo<AjudaCampo chave="projetos.obra_materiais.selecionar_itens" rota={ROTA} /></span>
            </div>
            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 10px', maxHeight: 260, overflowY: 'auto' }}>
              {itens.map((it) => (
                <li key={it.id} style={{ borderTop: `1px solid ${LINE}`, padding: '7px 2px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                    <input type="checkbox" checked={sel.has(it.id)} onChange={() => toggle(it.id)} data-testid={`mat-item-${it.id}`} />
                    <span style={{ flex: 1 }}>{it.descricao}</span>
                    <span style={{ color: MUT, fontSize: 12 }}>{Number(it.quantidade_contratada ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} {it.unidade ?? ''}</span>
                  </label>
                </li>
              ))}
            </ul>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 2, marginBottom: 10 }}>
              <label style={{ flex: 1, fontSize: 12, color: MUT }}>
                <span style={{ display: 'inline-flex', alignItems: 'center' }}>Justificativa (opcional)<AjudaCampo chave="projetos.obra_materiais.justificativa" rota={ROTA} /></span>
                <textarea value={justificativa} onChange={(e) => setJustificativa(e.target.value)} rows={2} data-testid="mat-justificativa"
                  placeholder="Ex.: material para iniciar o piso na próxima semana"
                  style={{ width: '100%', border: `1px solid ${LINE}`, borderRadius: 8, padding: '8px 10px', fontSize: 13, color: ESP, background: '#fff', marginTop: 4 }} />
              </label>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <button type="button" onClick={() => void gerar()} disabled={busy || !sel.size} data-testid="mat-gerar" style={btnPri}>Gerar requisição</button>
              <AjudaCampo chave="projetos.obra_materiais.gerar" rota={ROTA} />
              <span style={{ fontSize: 12, color: MUT, marginLeft: 8 }}>{sel.size} item(ns) marcado(s)</span>
            </div>
          </div>
        )}

        {loading ? <div style={{ padding: 30, textAlign: 'center', color: MUT }}>Carregando…</div>
          : reqs.length === 0 ? (
            <div style={{ ...card, textAlign: 'center', color: MUT, borderStyle: 'dashed' }} data-testid="mat-vazio">
              <span style={{ display: 'inline-flex', alignItems: 'center' }}>Nenhuma requisição ainda.<AjudaCampo chave="projetos.obra_materiais.vazio" rota={ROTA} /></span>
              <div style={{ fontSize: 12, marginTop: 4 }}>Toque em “Requisitar material” para criar a primeira.</div>
            </div>
          ) : (
            <div style={{ overflowX: 'auto', border: `1px solid ${LINE}`, borderRadius: 12, background: '#fff' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 620 }}>
                <thead>
                  <tr style={{ background: '#FBF6EF' }}>
                    <Th>Nº<AjudaCampo chave="projetos.obra_materiais.col_numero" rota={ROTA} /></Th>
                    <Th>Título<AjudaCampo chave="projetos.obra_materiais.col_titulo" rota={ROTA} /></Th>
                    <Th>Status<AjudaCampo chave="projetos.obra_materiais.col_status" rota={ROTA} /></Th>
                    <Th>Itens<AjudaCampo chave="projetos.obra_materiais.col_itens" rota={ROTA} /></Th>
                    <Th>Criada em<AjudaCampo chave="projetos.obra_materiais.col_criada" rota={ROTA} /></Th>
                    <Th>Ações<AjudaCampo chave="projetos.obra_materiais.excluir" rota={ROTA} /></Th>
                  </tr>
                </thead>
                <tbody>
                  {reqs.map((r) => (
                    <tr key={r.id} style={{ borderTop: `1px solid ${LINE}` }} data-testid="mat-req-row">
                      <Td>{r.numero ? `#${r.numero}` : '—'}{r.urgente && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: VERM, background: '#F7E1E1', borderRadius: 999, padding: '2px 7px' }}>urgente</span>}</Td>
                      <Td>{r.titulo ?? '—'}</Td>
                      <Td><span style={{ fontSize: 11, fontWeight: 700, color: corStatus(r.status), background: '#FAEEDA', borderRadius: 999, padding: '2px 9px' }}>{r.status ?? '—'}</span></Td>
                      <Td>{r.qtd_itens}</Td>
                      <Td style={{ color: MUT }}>{fmtData(r.criado_em)}</Td>
                      <Td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                          <Link href="/dashboard/compras/solicitacoes" style={{ color: GOLD, fontWeight: 600, textDecoration: 'none', fontSize: 12 }} data-testid="mat-ver-ge">Ver em Compras</Link>
                          <AjudaCampo chave="projetos.obra_materiais.ver_ge" rota={ROTA} />
                          <button type="button" onClick={() => void excluir(r)} disabled={busy} data-testid={`mat-excluir-${r.id}`} style={btnDel}>Excluir</button>
                        </span>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>
    </div>
  )
}

function Th({ children }: { children?: React.ReactNode }) {
  return <th style={{ textAlign: 'left', padding: '9px 12px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: MUT, whiteSpace: 'nowrap' }}><span style={{ display: 'inline-flex', alignItems: 'center' }}>{children}</span></th>
}
function Td({ children, style }: { children?: React.ReactNode; style?: React.CSSProperties }) {
  return <td style={{ padding: '9px 12px', color: ESP, ...style }}>{children}</td>
}

const card: React.CSSProperties = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: '12px 14px' }
const kpiLbl: React.CSSProperties = { fontSize: 11, color: MUT, fontWeight: 700, display: 'flex', alignItems: 'center' }
const kpiVal: React.CSSProperties = { fontSize: 24, fontWeight: 700, color: ESP, marginTop: 2 }
const btnPri: React.CSSProperties = { border: 'none', background: GOLD, color: '#fff', borderRadius: 10, padding: '9px 16px', cursor: 'pointer', fontWeight: 700, fontSize: 13, minHeight: 40 }
const btnDel: React.CSSProperties = { border: `1px solid ${LINE}`, color: '#7A1F1F', background: '#fff', borderRadius: 8, padding: '5px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }
