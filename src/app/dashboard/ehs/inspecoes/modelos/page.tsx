// src/app/dashboard/ehs/inspecoes/modelos/page.tsx
// PS EHS · EHS-7 / M10 — Inspeções: Modelos de checklist (fatia 1)
// O técnico monta uma vez o checklist (perguntas com peso e item crítico); a execução de campo reusa estes modelos.
// Backend: ehs_inspecao_modelo + ehs_inspecao_item (RLS por empresa via get_user_company_ids). Soft delete (ativo=false).

'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ROTA_AJUDA = '/dashboard/ehs/inspecoes/modelos'

const C = {
  espresso: '#3D2314',
  offwhite: '#FAF7F2',
  gold: '#C8941A',
  beigeLt: '#f5f0e8',
  borderLt: '#ece3d2',
  ink: '#1a1a1a',
  muted: 'rgba(61, 35, 20, 0.55)',
  red: '#dc2626',
  redBg: '#fce8e8',
}

const CATEGORIAS: { valor: string; rotulo: string }[] = [
  { valor: 'epi', rotulo: 'EPI' },
  { valor: 'ordem_limpeza', rotulo: 'Ordem e limpeza' },
  { valor: 'seguranca', rotulo: 'Segurança' },
  { valor: 'maquinas', rotulo: 'Máquinas' },
  { valor: 'geral', rotulo: 'Geral' },
]
const rotuloCategoria = (v: string) => CATEGORIAS.find((c) => c.valor === v)?.rotulo || v

type Item = { id?: string; pergunta: string; peso: number; critico: boolean; ordem: number }
type Modelo = {
  id: string
  company_id: string
  nome: string
  categoria: string
  nr_referencia: string | null
  descricao: string | null
  ativo: boolean
  n_itens?: number
}

export default function ModelosInspecaoPage() {
  const { companyIds, companies } = useCompanyIds()
  const companyIdsKey = useMemo(() => [...(companyIds ?? [])].sort().join(','), [companyIds])
  const multiEmpresa = (companyIds?.length ?? 0) > 1
  const [companyAlvo, setCompanyAlvo] = useState<string>('')

  useEffect(() => {
    if (!companyAlvo && companyIds && companyIds.length > 0) setCompanyAlvo(companyIds[0])
  }, [companyIds, companyAlvo])

  const empresaPorId = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of companies) m.set(c.id, c.nome_fantasia || c.razao_social || 'Empresa')
    return m
  }, [companies])

  const [modelos, setModelos] = useState<Modelo[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [showNovo, setShowNovo] = useState(false)
  const [editando, setEditando] = useState<Modelo | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true)
    setErro(null)
    try {
      const ids = companyIdsKey ? companyIdsKey.split(',').filter(Boolean) : []
      if (ids.length === 0) { setModelos([]); return }
      const { data, error } = await supabase
        .from('ehs_inspecao_modelo')
        .select('id, company_id, nome, categoria, nr_referencia, descricao, ativo, ehs_inspecao_item(count)')
        .eq('ativo', true)
        .in('company_id', ids)
        .order('nome', { ascending: true })
      if (error) throw error
      const linhas = (data || []).map((m: any) => ({
        ...m,
        n_itens: Array.isArray(m.ehs_inspecao_item) ? (m.ehs_inspecao_item[0]?.count ?? 0) : 0,
      })) as Modelo[]
      setModelos(linhas)
    } catch (e: any) {
      setErro(e?.message || 'Falha ao carregar os modelos de inspeção')
    } finally {
      setLoading(false)
    }
  }, [companyIdsKey])

  useEffect(() => { carregar() }, [carregar])

  const filtrados = useMemo(() => {
    const q = busca.toLowerCase().trim()
    return modelos.filter((m) => (q ? `${m.nome} ${m.nr_referencia || ''}`.toLowerCase().includes(q) : true))
  }, [modelos, busca])

  async function desativar(m: Modelo) {
    const motivo = prompt(`Desativar o modelo "${m.nome}"? As inspeções já feitas com ele são preservadas.\nInforme o motivo (fica registrado):`)
    if (motivo === null) return
    if (!motivo.trim()) { alert('Informe o motivo para desativar.'); return }
    try {
      const { error } = await supabase
        .from('ehs_inspecao_modelo')
        .update({ ativo: false, descricao: ((m.descricao ? m.descricao + ' ' : '') + `[desativado: ${motivo.trim()}]`).slice(0, 2000), atualizado_em: new Date().toISOString() })
        .eq('id', m.id)
      if (error) throw error
      carregar()
    } catch (e: any) {
      alert(e?.message || 'Falha ao desativar')
    }
  }

  return (
    <div style={{ backgroundColor: C.offwhite, minHeight: '100vh', color: C.ink }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 16px' }}>
        <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
          <div>
            <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.5, textTransform: 'uppercase', opacity: 0.5, margin: 0 }}>EHS · Inspeções</p>
            <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 30, fontWeight: 400, margin: '4px 0 6px' }}>Modelos de inspeção</h1>
            <p style={{ margin: 0, fontSize: 14, color: C.muted, maxWidth: 560 }}>
              Monte o checklist uma vez — perguntas com peso e itens críticos — e reutilize em cada inspeção de campo.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Link href="/dashboard/ehs" style={{ padding: '10px 14px', borderRadius: 8, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>← Voltar</Link>
            <span style={{ display: 'inline-flex', alignItems: 'center' }}>
              <button onClick={() => setShowNovo(true)} disabled={!companyAlvo}
                style={{ padding: '10px 14px', borderRadius: 8, border: 'none', backgroundColor: C.espresso, color: 'white', fontSize: 13, fontWeight: 600, cursor: companyAlvo ? 'pointer' : 'not-allowed', opacity: companyAlvo ? 1 : 0.5 }}>
                + Novo modelo
              </button>
              <AjudaCampo chave="ehs.insp_modelo.novo" rota={ROTA_AJUDA} />
            </span>
          </div>
        </header>

        {erro && <div style={{ backgroundColor: C.redBg, color: C.red, padding: '12px 16px', borderRadius: 8, marginBottom: 16, fontSize: 14 }}>{erro}</div>}

        {multiEmpresa && (
          <section style={{ backgroundColor: 'white', borderRadius: 12, padding: 16, marginBottom: 16, boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)' }}>
            <label style={labelInline}>
              Empresa-alvo para criar modelos
              <AjudaCampo chave="ehs.insp_modelo.empresa" rota={ROTA_AJUDA} />
            </label>
            <select value={companyAlvo} onChange={(e) => setCompanyAlvo(e.target.value)}
              style={{ padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.borderLt}`, fontSize: 13, backgroundColor: 'white', minWidth: 240, marginTop: 6 }}>
              {(companyIds || []).map((id) => (<option key={id} value={id}>{empresaPorId.get(id) || id}</option>))}
            </select>
          </section>
        )}

        <section style={{ backgroundColor: 'white', borderRadius: 12, padding: 16, boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)', marginBottom: 16 }}>
          <label style={labelInline}>
            Buscar
            <AjudaCampo chave="ehs.insp_modelo.busca" rota={ROTA_AJUDA} />
          </label>
          <input type="text" placeholder="Buscar modelo por nome ou norma…" value={busca} onChange={(e) => setBusca(e.target.value)}
            style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: `1px solid ${C.borderLt}`, fontSize: 13, backgroundColor: C.offwhite, marginTop: 6 }} />
        </section>

        <section style={{ backgroundColor: 'white', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ backgroundColor: C.beigeLt }}>
                  <Th><span style={thLabel}>Modelo<AjudaCampo chave="ehs.insp_modelo.col_nome" rota={ROTA_AJUDA} /></span></Th>
                  <Th><span style={thLabel}>Categoria<AjudaCampo chave="ehs.insp_modelo.col_categoria" rota={ROTA_AJUDA} /></span></Th>
                  <Th><span style={thLabel}>Perguntas<AjudaCampo chave="ehs.insp_modelo.col_itens" rota={ROTA_AJUDA} /></span></Th>
                  <Th><span style={thLabel}>Ações<AjudaCampo chave="ehs.insp_modelo.col_acoes" rota={ROTA_AJUDA} /></span></Th>
                </tr>
              </thead>
              <tbody>
                {loading && (<tr><td colSpan={4} style={{ padding: 24, textAlign: 'center', color: C.muted }}>Carregando…</td></tr>)}
                {!loading && filtrados.length === 0 && (
                  <tr><td colSpan={4} style={{ padding: 28, textAlign: 'center', color: C.muted }}>
                    Nenhum modelo de inspeção ainda. Clique em <strong>+ Novo modelo</strong> para criar o primeiro checklist.
                  </td></tr>
                )}
                {filtrados.map((m, i) => (
                  <tr key={m.id} style={{ borderTop: i === 0 ? 'none' : `1px solid ${C.borderLt}` }}>
                    <Td>
                      <span style={{ fontWeight: 600, color: C.espresso }}>{m.nome}</span>
                      {m.nr_referencia && <span style={{ marginLeft: 8, padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, backgroundColor: C.gold + '22', color: C.gold }}>{m.nr_referencia}</span>}
                      {m.descricao && <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{m.descricao}</div>}
                    </Td>
                    <Td>{rotuloCategoria(m.categoria)}</Td>
                    <Td>{m.n_itens ?? 0}</Td>
                    <Td>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <button onClick={() => setEditando(m)} style={btnMini}>Editar</button>
                        {i === 0 && <AjudaCampo chave="ehs.insp_modelo.editar" rota={ROTA_AJUDA} />}
                        <button onClick={() => desativar(m)} style={{ ...btnMini, color: C.red, border: `1px solid ${C.red}30` }}>Desativar</button>
                        {i === 0 && <AjudaCampo chave="ehs.insp_modelo.desativar" rota={ROTA_AJUDA} />}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {showNovo && companyAlvo && (
        <ModeloFormModal companyId={companyAlvo} onClose={() => setShowNovo(false)} onSaved={() => { setShowNovo(false); carregar() }} />
      )}
      {editando && (
        <ModeloFormModal companyId={editando.company_id} modelo={editando} onClose={() => setEditando(null)} onSaved={() => { setEditando(null); carregar() }} />
      )}
    </div>
  )
}

function ModeloFormModal({ companyId, modelo, onClose, onSaved }: { companyId: string; modelo?: Modelo; onClose: () => void; onSaved: () => void }) {
  const [nome, setNome] = useState(modelo?.nome || '')
  const [categoria, setCategoria] = useState(modelo?.categoria || 'geral')
  const [nrRef, setNrRef] = useState(modelo?.nr_referencia || '')
  const [descricao, setDescricao] = useState(modelo?.descricao || '')
  const [itens, setItens] = useState<Item[]>([])
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    async function carregarItens() {
      if (!modelo?.id) { setItens([{ pergunta: '', peso: 1, critico: false, ordem: 1 }]); return }
      const { data } = await supabase
        .from('ehs_inspecao_item')
        .select('id, pergunta, peso, critico, ordem')
        .eq('modelo_id', modelo.id)
        .eq('ativo', true)
        .order('ordem', { ascending: true })
      if (!vivo) return
      const arr = (data || []) as Item[]
      setItens(arr.length ? arr : [{ pergunta: '', peso: 1, critico: false, ordem: 1 }])
    }
    carregarItens()
    return () => { vivo = false }
  }, [modelo?.id])

  function setItem(idx: number, patch: Partial<Item>) {
    setItens((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)))
  }
  function addItem() { setItens((prev) => [...prev, { pergunta: '', peso: 1, critico: false, ordem: prev.length + 1 }]) }
  function removeItem(idx: number) { setItens((prev) => prev.filter((_, i) => i !== idx)) }

  async function salvar() {
    if (!nome.trim()) { setErro('O nome do modelo é obrigatório'); return }
    const perguntas = itens.map((it) => ({ ...it, pergunta: it.pergunta.trim() })).filter((it) => it.pergunta)
    if (perguntas.length === 0) { setErro('Inclua ao menos uma pergunta no checklist'); return }
    setSalvando(true)
    setErro(null)
    try {
      let modeloId = modelo?.id
      if (modeloId) {
        const { error } = await supabase.from('ehs_inspecao_modelo')
          .update({ nome: nome.trim(), categoria, nr_referencia: nrRef.trim() || null, descricao: descricao.trim() || null, atualizado_em: new Date().toISOString() })
          .eq('id', modeloId)
        if (error) throw error
        // substitui os itens (modelo pequeno; company-scoped)
        const { error: delErr } = await supabase.from('ehs_inspecao_item').delete().eq('modelo_id', modeloId)
        if (delErr) throw delErr
      } else {
        const { data, error } = await supabase.from('ehs_inspecao_modelo')
          .insert({ company_id: companyId, nome: nome.trim(), categoria, nr_referencia: nrRef.trim() || null, descricao: descricao.trim() || null })
          .select('id').single()
        if (error) throw error
        modeloId = data!.id
      }
      const payload = perguntas.map((it, i) => ({ company_id: companyId, modelo_id: modeloId, ordem: i + 1, pergunta: it.pergunta, peso: it.peso, critico: it.critico }))
      const { error: insErr } = await supabase.from('ehs_inspecao_item').insert(payload)
      if (insErr) throw insErr
      onSaved()
    } catch (e: any) {
      setErro(e?.message || 'Falha ao salvar o modelo')
      setSalvando(false)
    }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 12 }}>
      <div onClick={(e: any) => e.stopPropagation()} style={{ background: 'white', borderRadius: 12, padding: 22, width: 'min(560px, 96vw)', maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 20, fontWeight: 400, margin: '0 0 12px' }}>{modelo?.id ? 'Editar modelo de inspeção' : 'Novo modelo de inspeção'}</h3>
        {erro && <div style={{ backgroundColor: C.redBg, color: C.red, padding: '8px 10px', borderRadius: 6, marginBottom: 10, fontSize: 12 }}>{erro}</div>}

        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Nome *<AjudaCampo chave="ehs.insp_modelo.nome" rota={ROTA_AJUDA} /></label>
          <input value={nome} onChange={(e) => setNome(e.target.value)} style={inputStyle()} placeholder="Ex: Inspeção de EPI no posto" autoFocus />
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <div style={{ flex: '1 1 180px' }}>
            <label style={labelStyle}>Categoria<AjudaCampo chave="ehs.insp_modelo.categoria" rota={ROTA_AJUDA} /></label>
            <select value={categoria} onChange={(e) => setCategoria(e.target.value)} style={inputStyle()}>
              {CATEGORIAS.map((c) => (<option key={c.valor} value={c.valor}>{c.rotulo}</option>))}
            </select>
          </div>
          <div style={{ flex: '1 1 180px' }}>
            <label style={labelStyle}>Norma de referência<AjudaCampo chave="ehs.insp_modelo.nr_referencia" rota={ROTA_AJUDA} /></label>
            <input value={nrRef} onChange={(e) => setNrRef(e.target.value)} style={inputStyle()} placeholder="Ex: NR-06 (opcional)" />
          </div>
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>Descrição<AjudaCampo chave="ehs.insp_modelo.descricao" rota={ROTA_AJUDA} /></label>
          <textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} style={{ ...inputStyle(), minHeight: 50 }} placeholder="Quando e onde usar este checklist (opcional)" />
        </div>

        <div style={{ borderTop: `1px solid ${C.borderLt}`, paddingTop: 12, marginBottom: 8 }}>
          <label style={labelStyle}>Perguntas do checklist<AjudaCampo chave="ehs.insp_modelo.itens" rota={ROTA_AJUDA} /></label>
          {itens.map((it, idx) => (
            <div key={idx} style={{ border: `1px solid ${C.borderLt}`, borderRadius: 8, padding: 10, marginBottom: 8, background: C.offwhite }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: C.muted, marginTop: 8 }}>{idx + 1}.</span>
                <div style={{ flex: 1 }}>
                  <label style={labelMini}>Pergunta{idx === 0 && <AjudaCampo chave="ehs.insp_modelo.item_pergunta" rota={ROTA_AJUDA} />}</label>
                  <input value={it.pergunta} onChange={(e) => setItem(idx, { pergunta: e.target.value })} style={inputStyle()} placeholder="Ex: O trabalhador está usando o protetor auricular?" />
                  <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <label style={labelMini}>Peso{idx === 0 && <AjudaCampo chave="ehs.insp_modelo.item_peso" rota={ROTA_AJUDA} />}</label>
                      <select value={it.peso} onChange={(e) => setItem(idx, { peso: Number(e.target.value) })} style={{ ...inputStyle(), width: 64, padding: '6px 8px' }}>
                        {[1, 2, 3, 4, 5].map((p) => (<option key={p} value={p}>{p}</option>))}
                      </select>
                    </span>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: C.espresso, cursor: 'pointer' }}>
                      <input type="checkbox" checked={it.critico} onChange={(e) => setItem(idx, { critico: e.target.checked })} />
                      Item crítico
                      {idx === 0 && <AjudaCampo chave="ehs.insp_modelo.item_critico" rota={ROTA_AJUDA} />}
                    </label>
                    <button type="button" onClick={() => removeItem(idx)} style={{ ...btnMini, color: C.red, border: `1px solid ${C.red}30`, marginLeft: 'auto' }}>Remover</button>
                  </div>
                </div>
              </div>
            </div>
          ))}
          <button type="button" onClick={addItem} style={{ ...btnMini, borderStyle: 'dashed' }}>+ Adicionar pergunta</button>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <button onClick={onClose} disabled={salvando} style={{ padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Cancelar</button>
          <button onClick={salvar} disabled={salvando || !nome.trim()} style={{ padding: '8px 12px', borderRadius: 8, border: 'none', backgroundColor: C.espresso, color: 'white', fontSize: 12, fontWeight: 600, cursor: !salvando && nome.trim() ? 'pointer' : 'not-allowed', opacity: !salvando && nome.trim() ? 1 : 0.6 }}>
            {salvando ? 'Salvando…' : (modelo?.id ? 'Salvar' : 'Criar modelo')}
          </button>
        </div>
      </div>
    </div>
  )
}

const thLabel: React.CSSProperties = { display: 'inline-flex', alignItems: 'center' }
const labelInline: React.CSSProperties = { display: 'flex', alignItems: 'center', fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5 }
const labelStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }
const labelMini: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', fontSize: 10.5, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }
const btnMini: React.CSSProperties = { padding: '4px 10px', borderRadius: 6, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 11, fontWeight: 600, cursor: 'pointer' }

function inputStyle() {
  return { width: '100%', padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.borderLt}`, fontSize: 14, background: C.offwhite, color: C.ink, boxSizing: 'border-box' } as React.CSSProperties
}
function Th({ children }: { children: any }) {
  return (<th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(61, 35, 20, 0.65)' }}>{children}</th>)
}
function Td({ children }: { children: any }) {
  return (<td style={{ padding: '10px 16px', verticalAlign: 'top' }}>{children}</td>)
}
