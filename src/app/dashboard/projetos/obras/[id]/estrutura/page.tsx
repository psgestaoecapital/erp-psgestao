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
const btnAdd = { padding: '9px 14px', borderRadius: 8, border: 'none', background: ESP, color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' as const }

type Item = { id: string; parent_id: string | null; nivel: 'bloco' | 'pavimento' | 'unidade'; nome: string; ordem: number }

const LABEL = { bloco: 'Bloco', pavimento: 'Pavimento', unidade: 'Unidade / ambiente' } as const
const PLACE = { bloco: 'Nome do bloco (ex.: Bloco A, Torre 1)', pavimento: 'Nome do pavimento (ex.: Térreo, 1º Pav.)', unidade: 'Nome da unidade (ex.: Apto 101, Loja 2)' } as const
const AJUDA = { bloco: 'projetos.obra_estrutura.bloco', pavimento: 'projetos.obra_estrutura.pavimento', unidade: 'projetos.obra_estrutura.unidade' } as const

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

  const carregar = useCallback(async () => {
    if (!ehUuid(id)) { setLoading(false); setErro('Obra não encontrada. Abra pela lista de obras.'); return }
    setLoading(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_obra_estrutura_listar', { p_obra_id: id })
    setLoading(false)
    const j = data as { ok: boolean; itens?: Item[]; erro?: string } | null
    if (error || !j || !j.ok) { setErro(erroAmigavel(error, j?.erro ?? 'Não foi possível carregar a estrutura da obra.')); return }
    setItens(j.itens ?? [])
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
                      {/* unidades do pavimento */}
                      <div style={{ display: 'grid', gap: 6, paddingLeft: 12, borderLeft: `2px solid ${LINE}` }}>
                        {filhos(p.id).map((u) => (
                          <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 10, color: MUT }}>•</span>
                            {linhaItem(u)}
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
          </div>
        )}
      </div>
    </div>
  )
}
