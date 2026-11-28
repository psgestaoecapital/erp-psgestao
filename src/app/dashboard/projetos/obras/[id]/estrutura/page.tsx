'use client'
// Hub · Gestão de Obras · Estrutura física da obra (blueprint vivo tela 314).
// Árvore de 3 níveis: Bloco → Pavimento → Unidade/ambiente. Leitura/gravação guardadas por empresa
// (fn_obra_estrutura_listar / _salvar / _excluir). Aberta pelo cockpit da obra.
import { use, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { ehUuid, erroAmigavel } from '@/lib/erroAmigavel'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ROTA = '/dashboard/projetos/obras/[id]/estrutura'
const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DED3', MUT = 'rgba(61,35,20,0.55)', VERM = '#B91C1C'
const campo = { flex: 1, minWidth: 0, padding: '9px 11px', borderRadius: 8, border: `1px solid ${LINE}`, fontSize: 14, background: '#fff', color: ESP, boxSizing: 'border-box' as const }
const campoNum = { width: '100%', padding: '8px 10px', borderRadius: 8, border: `1px solid ${LINE}`, fontSize: 14, background: '#fff', color: ESP, boxSizing: 'border-box' as const }
const lbl = { display: 'grid', gap: 3, fontSize: 12, color: MUT, fontWeight: 600 } as const
const btnAdd = { padding: '9px 14px', borderRadius: 8, border: 'none', background: ESP, color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' as const }

type Item = { id: string; parent_id: string | null; nivel: 'bloco' | 'pavimento' | 'unidade'; nome: string; ordem: number }
type Area = { area_privativa_m2: number | null; area_comum_m2: number | null; vagas_simples: number | null; vagas_duplas: number | null }
type AreaRow = Area & { id: string }
type Totais = { area_privativa_m2: number; area_comum_m2: number; area_total_m2: number; vagas_simples: number; vagas_duplas: number; vagas_total: number }
const AREA_VAZIA: Area = { area_privativa_m2: null, area_comum_m2: null, vagas_simples: null, vagas_duplas: null }

const LABEL = { bloco: 'Bloco', pavimento: 'Pavimento', unidade: 'Unidade / ambiente' } as const
const PLACE = { bloco: 'Nome do bloco (ex.: Bloco A, Torre 1)', pavimento: 'Nome do pavimento (ex.: Térreo, 1º Pav.)', unidade: 'Nome da unidade (ex.: Apto 101, Loja 2)' } as const
const AJUDA = { bloco: 'projetos.obra_estrutura.bloco', pavimento: 'projetos.obra_estrutura.pavimento', unidade: 'projetos.obra_estrutura.unidade' } as const
const AJUDA_AREA = { priv: 'projetos.obra_estrutura.area_privativa', comum: 'projetos.obra_estrutura.area_comum', vs: 'projetos.obra_estrutura.vagas_simples', vd: 'projetos.obra_estrutura.vagas_duplas' } as const

const fmt = (n: number) => (n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const toNum = (s: string): number | null => { const t = s.trim().replace(',', '.'); if (t === '') return null; const n = Number(t); return Number.isFinite(n) ? n : null }
function Kpi({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div style={{ background: '#FBF8F2', border: `1px solid ${LINE}`, borderRadius: 8, padding: '8px 10px' }}>
      <div style={{ fontSize: 11, color: MUT, marginBottom: 2 }}>{rotulo}</div>
      <div style={{ fontSize: 15, color: ESP, fontWeight: 700 }}>{valor}</div>
    </div>
  )
}

export default function EstruturaObraPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [itens, setItens] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // rascunho do campo "adicionar" por nível e por pai (chave: `${nivel}:${parentId||'raiz'}`)
  const [novo, setNovo] = useState<Record<string, string>>({})
  // edição inline (id → nome em edição)
  const [editId, setEditId] = useState<string | null>(null)
  const [editNome, setEditNome] = useState('')
  // quadro de áreas: áreas por nó + totais da obra + editor inline
  const [areas, setAreas] = useState<Record<string, Area>>({})
  const [totais, setTotais] = useState<Totais | null>(null)
  const [areaEditId, setAreaEditId] = useState<string | null>(null)
  const [areaDraft, setAreaDraft] = useState<Area>(AREA_VAZIA)

  const carregar = useCallback(async () => {
    if (!ehUuid(id)) { setLoading(false); setErro('Obra não encontrada. Abra pela lista de obras.'); return }
    setLoading(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_obra_estrutura_listar', { p_obra_id: id })
    setLoading(false)
    const j = data as { ok: boolean; itens?: Item[]; erro?: string } | null
    if (error || !j || !j.ok) { setErro(erroAmigavel(error, j?.erro ?? 'Não foi possível carregar a estrutura da obra.')); return }
    setItens(j.itens ?? [])
    const { data: ad } = await supabase.rpc('fn_obra_estrutura_area_listar', { p_obra_id: id })
    const aj = ad as { ok: boolean; areas?: AreaRow[]; totais?: Totais } | null
    if (aj && aj.ok) {
      const map: Record<string, Area> = {}
      for (const a of aj.areas ?? []) map[a.id] = { area_privativa_m2: a.area_privativa_m2, area_comum_m2: a.area_comum_m2, vagas_simples: a.vagas_simples, vagas_duplas: a.vagas_duplas }
      setAreas(map); setTotais(aj.totais ?? null)
    }
  }, [id])
  useEffect(() => { void carregar() }, [carregar]) // eslint-disable-line react-hooks/set-state-in-effect

  const blocos = useMemo(() => itens.filter((i) => i.nivel === 'bloco'), [itens])
  const filhos = useCallback((pid: string) => itens.filter((i) => i.parent_id === pid), [itens])

  const adicionar = async (nivel: Item['nivel'], parentId: string | null) => {
    const k = `${nivel}:${parentId ?? 'raiz'}`
    const nome = (novo[k] ?? '').trim()
    if (!nome) return
    setBusy(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_obra_estrutura_salvar', {
      p_obra_id: id, p_id: null, p_parent_id: parentId, p_nivel: nivel, p_nome: nome, p_ordem: 0,
    })
    setBusy(false)
    const j = data as { ok: boolean; erro?: string } | null
    if (error || !j || !j.ok) { setErro(erroAmigavel(error, j?.erro ?? 'Não foi possível salvar.')); return }
    setNovo((s) => ({ ...s, [k]: '' }))
    await carregar()
  }

  const salvarEdicao = async (it: Item) => {
    const nome = editNome.trim()
    if (!nome || nome === it.nome) { setEditId(null); return }
    setBusy(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_obra_estrutura_salvar', {
      p_obra_id: id, p_id: it.id, p_parent_id: it.parent_id, p_nivel: it.nivel, p_nome: nome, p_ordem: it.ordem,
    })
    setBusy(false)
    const j = data as { ok: boolean; erro?: string } | null
    if (error || !j || !j.ok) { setErro(erroAmigavel(error, j?.erro ?? 'Não foi possível editar.')); return }
    setEditId(null)
    await carregar()
  }

  const excluir = async (it: Item) => {
    const temFilhos = itens.some((x) => x.parent_id === it.id)
    const aviso = temFilhos ? `Excluir "${it.nome}" remove também o que está dentro dele. Continuar?` : `Excluir "${it.nome}"?`
    if (!window.confirm(aviso)) return
    setBusy(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_obra_estrutura_excluir', { p_id: it.id, p_motivo: null })
    setBusy(false)
    const j = data as { ok: boolean; erro?: string } | null
    if (error || !j || !j.ok) { setErro(erroAmigavel(error, j?.erro ?? 'Não foi possível excluir.')); return }
    await carregar()
  }

  const salvarAreas = async (nodeId: string) => {
    setBusy(true); setErro(null)
    const d = areaDraft
    const { data, error } = await supabase.rpc('fn_obra_estrutura_area_salvar', {
      p_id: nodeId,
      p_area_privativa_m2: d.area_privativa_m2, p_area_comum_m2: d.area_comum_m2,
      p_vagas_simples: d.vagas_simples, p_vagas_duplas: d.vagas_duplas,
    })
    setBusy(false)
    const j = data as { ok: boolean; erro?: string } | null
    if (error || !j || !j.ok) { setErro(erroAmigavel(error, j?.erro ?? 'Não foi possível salvar as áreas.')); return }
    setAreaEditId(null)
    await carregar()
  }

  const resumoArea = (a?: Area) => {
    if (!a) return null
    const parts: string[] = []
    if (a.area_privativa_m2 != null) parts.push(`Priv. ${fmt(a.area_privativa_m2)} m²`)
    if (a.area_comum_m2 != null) parts.push(`Comum ${fmt(a.area_comum_m2)} m²`)
    const vg = (a.vagas_simples ?? 0) + (a.vagas_duplas ?? 0)
    if (vg > 0) parts.push(`${vg} vaga${vg > 1 ? 's' : ''}`)
    return parts.length ? parts.join(' · ') : null
  }

  // Áreas (m²) e vagas por pavimento/unidade — compõem o Quadro de áreas da obra (tela 314).
  const areaLinha = (it: Item) => {
    const a = areas[it.id]
    const resumo = resumoArea(a)
    if (areaEditId === it.id) {
      return (
        <div data-testid="estrutura-area-editor" style={{ display: 'grid', gap: 8, background: '#FBF8F2', border: `1px solid ${LINE}`, borderRadius: 8, padding: 10 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: GOLD, fontWeight: 700 }}>Áreas (m²) e vagas</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
            <label style={lbl}><span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Área privativa (m²) <AjudaCampo chave={AJUDA_AREA.priv} rota={ROTA} /></span>
              <input type="number" step="0.01" min="0" data-testid="area-privativa" style={campoNum} value={areaDraft.area_privativa_m2 ?? ''} onChange={(e) => setAreaDraft((s) => ({ ...s, area_privativa_m2: toNum(e.target.value) }))} /></label>
            <label style={lbl}><span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Área comum (m²) <AjudaCampo chave={AJUDA_AREA.comum} rota={ROTA} /></span>
              <input type="number" step="0.01" min="0" data-testid="area-comum" style={campoNum} value={areaDraft.area_comum_m2 ?? ''} onChange={(e) => setAreaDraft((s) => ({ ...s, area_comum_m2: toNum(e.target.value) }))} /></label>
            <label style={lbl}><span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Vagas simples <AjudaCampo chave={AJUDA_AREA.vs} rota={ROTA} /></span>
              <input type="number" step="1" min="0" data-testid="vagas-simples" style={campoNum} value={areaDraft.vagas_simples ?? ''} onChange={(e) => setAreaDraft((s) => ({ ...s, vagas_simples: toNum(e.target.value) }))} /></label>
            <label style={lbl}><span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Vagas duplas <AjudaCampo chave={AJUDA_AREA.vd} rota={ROTA} /></span>
              <input type="number" step="1" min="0" data-testid="vagas-duplas" style={campoNum} value={areaDraft.vagas_duplas ?? ''} onChange={(e) => setAreaDraft((s) => ({ ...s, vagas_duplas: toNum(e.target.value) }))} /></label>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button data-testid="estrutura-area-salvar" disabled={busy} onClick={() => void salvarAreas(it.id)} style={btnAdd}>Salvar áreas</button>
            <button onClick={() => setAreaEditId(null)} style={{ ...btnAdd, background: 'transparent', color: MUT }}>Cancelar</button>
          </div>
        </div>
      )
    }
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {resumo && <span data-testid="estrutura-area-resumo" style={{ fontSize: 12, color: MUT }}>{resumo}</span>}
        <button data-testid="estrutura-area-abrir" onClick={() => { setAreaEditId(it.id); setAreaDraft(a ?? AREA_VAZIA) }}
          style={{ border: 'none', background: 'transparent', color: GOLD, fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: 0 }}>{resumo ? 'Editar áreas' : '+ Áreas'}</button>
      </div>
    )
  }

  const linhaItem = (it: Item) => (
    <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {editId === it.id ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
          <input autoFocus style={campo} value={editNome} onChange={(e) => setEditNome(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void salvarEdicao(it); if (e.key === 'Escape') setEditId(null) }} />
          <AjudaCampo chave={AJUDA[it.nivel]} rota={ROTA} />
          <button data-testid="estrutura-salvar-edicao" disabled={busy} onClick={() => void salvarEdicao(it)} style={btnAdd}>Salvar</button>
          <button onClick={() => setEditId(null)} style={{ ...btnAdd, background: 'transparent', color: MUT }}>Cancelar</button>
        </div>
      ) : (
        <>
          <span style={{ flex: 1, fontSize: 14, color: ESP }}>{it.nome}</span>
          <button data-testid="estrutura-editar" onClick={() => { setEditId(it.id); setEditNome(it.nome) }}
            style={{ border: 'none', background: 'transparent', color: GOLD, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Editar</button>
          <button data-testid="estrutura-excluir" disabled={busy} onClick={() => void excluir(it)}
            style={{ border: 'none', background: 'transparent', color: VERM, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Excluir</button>
          <AjudaCampo chave="projetos.obra_estrutura.excluir" rota={ROTA} />
        </>
      )}
    </div>
  )

  const addLinha = (nivel: Item['nivel'], parentId: string | null) => {
    const k = `${nivel}:${parentId ?? 'raiz'}`
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input data-testid={`estrutura-novo-${nivel}`} style={campo} placeholder={PLACE[nivel]} value={novo[k] ?? ''}
          onChange={(e) => setNovo((s) => ({ ...s, [k]: e.target.value }))}
          onKeyDown={(e) => { if (e.key === 'Enter') void adicionar(nivel, parentId) }} />
        <button data-testid={`estrutura-add-${nivel}`} disabled={busy} onClick={() => void adicionar(nivel, parentId)} style={btnAdd}>+ {LABEL[nivel]}</button>
        <AjudaCampo chave="projetos.obra_estrutura.adicionar" rota={ROTA} />
        <AjudaCampo chave={AJUDA[nivel]} rota={ROTA} />
      </div>
    )
  }

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '20px 16px' }}>
      <div style={{ maxWidth: 680, margin: '0 auto' }} data-testid="hub-obra-estrutura">
        <Link href={`/dashboard/projetos/obras/${id}/cockpit?area=hub`} style={{ fontSize: 12, color: GOLD, textDecoration: 'none', fontWeight: 600 }}>← Cockpit da obra</Link>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700, marginTop: 8 }}>Hub · Obra</div>
        <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 24, fontWeight: 400, color: ESP, margin: '2px 0 4px' }}>Estrutura da obra</h1>
        <div style={{ fontSize: 13, color: MUT, marginBottom: 14 }}>Blocos, pavimentos e unidades/ambientes — a base para apontar avanço e serviços por local.</div>

        {erro && <div role="alert" data-testid="estrutura-erro" style={{ background: '#FBEAEA', color: VERM, borderRadius: 8, padding: 10, fontSize: 13, marginBottom: 12 }}>{erro}</div>}

        {loading ? <div style={{ padding: 40, textAlign: 'center', color: MUT }}>Carregando…</div> : (
          <div style={{ display: 'grid', gap: 14 }}>
            {blocos.length === 0 && (
              <div data-testid="estrutura-vazia" style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 18, textAlign: 'center' }}>
                <div style={{ fontSize: 14, color: ESP, fontWeight: 600, marginBottom: 4 }}>Nenhum bloco ainda</div>
                <div style={{ fontSize: 13, color: MUT }}>Comece adicionando o primeiro bloco (ou uma única torre, se a obra não tem divisão). Depois crie os pavimentos e as unidades dentro dele.</div>
              </div>
            )}

            {blocos.map((b) => (
              <div key={b.id} style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 16, display: 'grid', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderBottom: `1px solid ${LINE}`, paddingBottom: 10 }}>
                  <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: GOLD, fontWeight: 700 }}>Bloco</span>
                  {linhaItem(b)}
                </div>
                {/* pavimentos do bloco */}
                <div style={{ display: 'grid', gap: 10, paddingLeft: 12, borderLeft: `2px solid ${LINE}` }}>
                  {filhos(b.id).map((p) => (
                    <div key={p.id} style={{ display: 'grid', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4, color: MUT, fontWeight: 700 }}>Pav.</span>
                        {linhaItem(p)}
                      </div>
                      <div style={{ paddingLeft: 18 }}>{areaLinha(p)}</div>
                      {/* unidades do pavimento */}
                      <div style={{ display: 'grid', gap: 6, paddingLeft: 12, borderLeft: `2px solid ${LINE}` }}>
                        {filhos(p.id).map((u) => (
                          <div key={u.id} style={{ display: 'grid', gap: 4 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontSize: 10, color: MUT }}>•</span>
                              {linhaItem(u)}
                            </div>
                            <div style={{ paddingLeft: 18 }}>{areaLinha(u)}</div>
                          </div>
                        ))}
                        {addLinha('unidade', p.id)}
                      </div>
                    </div>
                  ))}
                  {addLinha('pavimento', b.id)}
                </div>
              </div>
            ))}

            {/* adicionar bloco (nível raiz) */}
            <div style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 16 }}>
              {addLinha('bloco', null)}
            </div>

            {/* Quadro de áreas da obra (tela 314): totais das áreas e vagas informadas na estrutura */}
            {totais && (totais.area_total_m2 > 0 || totais.vagas_total > 0) && (
              <div data-testid="estrutura-quadro-areas" style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 16 }}>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: GOLD, fontWeight: 700, marginBottom: 8 }}>Quadro de áreas da obra</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                  <Kpi rotulo="Área privativa" valor={`${fmt(totais.area_privativa_m2)} m²`} />
                  <Kpi rotulo="Área comum" valor={`${fmt(totais.area_comum_m2)} m²`} />
                  <Kpi rotulo="Área total" valor={`${fmt(totais.area_total_m2)} m²`} />
                  <Kpi rotulo="Vagas simples" valor={String(totais.vagas_simples)} />
                  <Kpi rotulo="Vagas duplas" valor={String(totais.vagas_duplas)} />
                  <Kpi rotulo="Vagas (total)" valor={String(totais.vagas_total)} />
                </div>
                <div style={{ fontSize: 11, color: MUT, marginTop: 8 }}>Soma das áreas e vagas informadas nos pavimentos e unidades da estrutura.</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
