'use client'

// SPEC ANEXO-1/ANEXO-2 · componente ÚNICO de anexos COM DESCRIÇÃO. Um componente, DOIS modos
// (RD-52 — sem 2º componente), três telas (proposta · oportunidade · visita).
//  · vinculoId preenchido  → modo NORMAL: persiste na hora (fn_crm_anexo_adicionar).
//  · vinculoId nulo        → modo STAGING (ANEXO-2): upload real p/ {company}/tmp/{sessao}/, segura os
//    metadados no estado (selo ⏳ aguardando), e o pai confirma no CRIAR via a ref (confirmar/limpar).
// Bucket crm-anexos (privado, 50MB, policy FOR ALL com SELECT). Excluir salvo = soft-delete (RD-30).
// Nunca mostra erro cru de storage/RLS — mensagem em linguagem de usuário.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'

const ESP = '#3D2314', GOLD = '#C8941A', LINE = '#E7DED3', MUT = '#6b5444', VERM = '#B91C1C'
const MAX = 50 * 1024 * 1024

export type VinculoTipo = 'proposta' | 'oportunidade' | 'visita' | 'nfe'
// handle que o pai (tela de nova proposta) usa para confirmar/limpar o staging no CRIAR/Cancelar
export type AnexosCardHandle = {
  temPendentes: () => boolean
  confirmar: (vinculoId: string) => Promise<{ confirmados: number; erros: { nome: string; erro: string }[] }>
  limpar: () => Promise<void>
}
type Anexo = {
  id: string; tipo: string; categoria: string | null; descricao: string | null; ordem: number
  nome_arquivo: string | null; storage_path: string | null; mime_type: string | null
  tamanho_bytes: number | null; url: string | null; enviado_em: string
}
// item em espera (ainda não preso à proposta). path = caminho em .../tmp/{sessao}/ (arquivo) ou null (link)
type Staging = {
  key: string; tipo: 'arquivo' | 'link'; categoria: string; descricao: string | null
  nome: string | null; path: string | null; mime: string | null; tamanho: number | null; url: string | null
}

function fmtTam(b: number | null): string {
  if (!b) return ''
  if (b < 1024) return `${b} B`
  if (b < 1048576) return `${(b / 1024).toFixed(0)} KB`
  return `${(b / 1048576).toFixed(1)} MB`
}
function categoriaDe(nome: string, mime: string): string {
  const ext = (nome.split('.').pop() || '').toLowerCase()
  if (['dwg', 'dxf'].includes(ext)) return 'planta'
  if (mime.startsWith('image/')) return 'foto'
  if (mime.startsWith('video/')) return 'video'
  if (mime === 'application/pdf' || ext === 'pdf') return 'documento'
  if (['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(ext)) return 'documento'
  return 'outro'
}
function icone(tipo: string, categoria: string | null): string {
  if (tipo === 'link') return '🔗'
  switch (categoria) {
    case 'foto': return '🖼️'
    case 'video': return '🎬'
    case 'planta': return '📐'
    case 'documento': return '📄'
    default: return '📎'
  }
}
function novaChave(): string {
  try { return crypto.randomUUID() } catch { return `${Date.now()}_${Math.random().toString(36).slice(2)}` }
}

type Props = { companyId: string; vinculoTipo: VinculoTipo; vinculoId: string | null }

const AnexosCard = forwardRef<AnexosCardHandle, Props>(function AnexosCard({ companyId, vinculoTipo, vinculoId }, ref) {
  const [anexos, setAnexos] = useState<Anexo[]>([])          // modo normal (proposta salva)
  const [staging, setStaging] = useState<Staging[]>([])      // modo staging (proposta nova)
  const [prog, setProg] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkDesc, setLinkDesc] = useState('')
  const [drag, setDrag] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const sessao = useRef<string>(novaChave())                 // pasta tmp desta sessão de edição

  const modoStaging = !vinculoId

  const carregar = useCallback(async () => {
    if (!vinculoId) { setAnexos([]); return }
    const { data } = await supabase.rpc('fn_crm_anexos_listar', { p_vinculo_tipo: vinculoTipo, p_vinculo_id: vinculoId })
    const r = data as { ok?: boolean; anexos?: Anexo[] } | null
    setAnexos(r?.anexos ?? [])
  }, [vinculoTipo, vinculoId])
  useEffect(() => { void carregar() }, [carregar])

  // ── upload: modo normal persiste na hora; modo staging sobe p/ tmp/ e segura no estado ──────────
  async function enviar(files: FileList | File[]) {
    setErro(null)
    const arr = Array.from(files)
    let ok = 0
    for (let i = 0; i < arr.length; i++) {
      const f = arr[i]
      if (f.size > MAX) { setErro(`"${f.name}" tem mais de 50 MB. Reduza ou envie como link.`); continue }
      setProg(`Enviando ${i + 1}/${arr.length}: ${f.name}…`)
      try {
        const safe = f.name.replace(/[^a-zA-Z0-9._-]/g, '_')
        const nomeArq = `${Date.now()}_${i}_${safe}`
        const path = modoStaging
          ? `${companyId}/tmp/${sessao.current}/${nomeArq}`
          : `${companyId}/${vinculoTipo}/${vinculoId}/${nomeArq}`
        const up = await supabase.storage.from('crm-anexos').upload(path, f, { upsert: false, contentType: f.type || undefined })
        if (up.error) throw up.error
        if (modoStaging) {
          setStaging((s) => [...s, { key: novaChave(), tipo: 'arquivo', categoria: categoriaDe(f.name, f.type), descricao: null, nome: f.name, path, mime: f.type || null, tamanho: f.size, url: null }])
          ok++
        } else {
          const { data, error } = await supabase.rpc('fn_crm_anexo_adicionar', {
            p_company_id: companyId, p_vinculo_tipo: vinculoTipo, p_vinculo_id: vinculoId,
            p_tipo: 'arquivo', p_categoria: categoriaDe(f.name, f.type), p_descricao: null,
            p_nome: f.name, p_path: path, p_mime: f.type || null, p_tamanho: f.size, p_url: null,
          })
          const j = data as { ok?: boolean } | null
          if (error || !j?.ok) throw new Error('não registrou')
          ok++
        }
      } catch {
        setErro(`Não consegui enviar "${f.name}". Tente de novo ou envie como link.`)
      }
    }
    setProg(null)
    if (ok > 0 && !modoStaging) void carregar()
    if (inputRef.current) inputRef.current.value = ''
  }

  async function adicionarLink() {
    const u = linkUrl.trim()
    if (!u) return
    setErro(null)
    if (modoStaging) {
      setStaging((s) => [...s, { key: novaChave(), tipo: 'link', categoria: 'outro', descricao: linkDesc.trim() || null, nome: null, path: null, mime: null, tamanho: null, url: u }])
      setLinkOpen(false); setLinkUrl(''); setLinkDesc('')
      return
    }
    const { data, error } = await supabase.rpc('fn_crm_anexo_adicionar', {
      p_company_id: companyId, p_vinculo_tipo: vinculoTipo, p_vinculo_id: vinculoId,
      p_tipo: 'link', p_categoria: 'outro', p_descricao: linkDesc.trim() || null, p_url: u,
    })
    const j = data as { ok?: boolean } | null
    if (error || !j?.ok) { setErro('Não consegui salvar o link.'); return }
    setLinkOpen(false); setLinkUrl(''); setLinkDesc(''); void carregar()
  }

  // ── descrição / excluir — funcionam nos dois modos ──────────────────────────────────────────────
  async function salvarDescricaoSalvo(id: string, descricao: string) {
    await supabase.rpc('fn_crm_anexo_editar', { p_anexo_id: id, p_descricao: descricao })
  }
  function salvarDescricaoStaging(key: string, descricao: string) {
    setStaging((s) => s.map((x) => (x.key === key ? { ...x, descricao: descricao.trim() || null } : x)))
  }
  async function excluirSalvo(id: string) {
    if (!window.confirm('Remover este anexo? Ele sai da lista (exclusão reversível).')) return
    const { data } = await supabase.rpc('fn_crm_anexo_excluir', { p_anexo_id: id })
    if ((data as { ok?: boolean } | null)?.ok) setAnexos((a) => a.filter((x) => x.id !== id))
  }
  async function excluirStaging(item: Staging) {
    setStaging((s) => s.filter((x) => x.key !== item.key))
    if (item.path) { try { await supabase.storage.from('crm-anexos').remove([item.path]) } catch { /* silencioso */ } }
  }
  async function abrirSalvo(a: Anexo) {
    if (a.tipo === 'link' && a.url) { window.open(a.url, '_blank', 'noopener'); return }
    if (!a.storage_path) return
    const { data } = await supabase.storage.from('crm-anexos').createSignedUrl(a.storage_path, 3600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener')
  }
  async function abrirStaging(item: Staging) {
    if (item.tipo === 'link' && item.url) { window.open(item.url, '_blank', 'noopener'); return }
    if (!item.path) return
    const { data } = await supabase.storage.from('crm-anexos').createSignedUrl(item.path, 3600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener')
  }

  // ── ref: o pai confirma (move tmp → destino + fn_crm_anexo_confirmar_lote) ou limpa no Cancelar ──
  useImperativeHandle(ref, () => ({
    temPendentes: () => staging.length > 0,
    async confirmar(novoVinculoId: string) {
      const itens = staging
      if (itens.length === 0) return { confirmados: 0, erros: [] }
      const erros: { nome: string; erro: string }[] = []
      const payload: Record<string, unknown>[] = []
      const base = `${companyId}/${vinculoTipo}/${novoVinculoId}/`
      let ordem = 0
      for (const it of itens) {
        ordem++
        if (it.tipo === 'link') { payload.push({ ...it, ordem }); continue }
        // arquivo: move de tmp/ para o destino definitivo (sem tmp/ no caminho final)
        const nomeArq = (it.path ?? '').split('/').pop() || `${Date.now()}_${ordem}`
        const destino = base + nomeArq
        const mv = await supabase.storage.from('crm-anexos').move(it.path!, destino)
        if (mv.error) { erros.push({ nome: it.nome ?? 'arquivo', erro: 'mover' }); continue }
        payload.push({ tipo: 'arquivo', categoria: it.categoria, descricao: it.descricao, nome: it.nome, path: destino, mime: it.mime, tamanho: it.tamanho, url: null, ordem })
      }
      let confirmados = 0
      if (payload.length > 0) {
        const { data, error } = await supabase.rpc('fn_crm_anexo_confirmar_lote', {
          p_company_id: companyId, p_vinculo_tipo: vinculoTipo, p_vinculo_id: novoVinculoId, p_anexos: payload,
        })
        const r = data as { ok?: boolean; confirmados?: number; erros?: { nome: string; erro: string }[] } | null
        if (error || !r?.ok) {
          for (const p of payload) erros.push({ nome: String(p.nome ?? 'anexo'), erro: 'salvar' })
        } else {
          confirmados = r.confirmados ?? 0
          for (const e of (r.erros ?? [])) erros.push(e)
        }
      }
      setStaging([])
      return { confirmados, erros }
    },
    async limpar() {
      const paths = staging.filter((x) => x.path).map((x) => x.path!) as string[]
      setStaging([])
      if (paths.length > 0) { try { await supabase.storage.from('crm-anexos').remove(paths) } catch { /* rede da §5 cobre */ } }
    },
  }), [companyId, vinculoTipo, staging])

  const total = modoStaging ? staging.length : anexos.length

  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={titulo}>📎 Anexos {total > 0 && <span style={{ color: MUT, fontWeight: 400 }}>({total})</span>}</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" onClick={() => inputRef.current?.click()} style={btn}>+ Arquivo</button>
          <button type="button" onClick={() => setLinkOpen((v) => !v)} style={btn}>+ Link</button>
        </div>
      </div>
      <input ref={inputRef} type="file" multiple style={{ display: 'none' }} onChange={(e) => { if (e.target.files?.length) void enviar(e.target.files) }} />

      {linkOpen && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8, background: '#FBF6EA', border: `1px solid ${LINE}`, borderRadius: 8, padding: 8 }}>
          <input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://drive.google.com/…" style={{ ...inp, flex: '1 1 220px' }} />
          <input value={linkDesc} onChange={(e) => setLinkDesc(e.target.value)} placeholder="Descrição (opcional)" style={{ ...inp, flex: '1 1 160px' }} />
          <button type="button" onClick={() => void adicionarLink()} disabled={!linkUrl.trim()} style={{ ...btnPrim, opacity: linkUrl.trim() ? 1 : 0.5 }}>Adicionar</button>
        </div>
      )}

      {/* área de drop */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files?.length) void enviar(e.dataTransfer.files) }}
        onClick={() => inputRef.current?.click()}
        style={{ border: `1.5px dashed ${drag ? GOLD : LINE}`, borderRadius: 8, padding: '10px 12px', textAlign: 'center', fontSize: 11.5, color: MUT, cursor: 'pointer', background: drag ? '#FFF8E7' : 'transparent', marginBottom: 8 }}
      >
        {prog ?? 'Arraste arquivos aqui ou clique para enviar (até 50 MB cada)'}
      </div>

      {/* ANEXO-2 · aviso honesto do staging (nada preso à proposta ainda) */}
      {modoStaging && staging.length > 0 && (
        <div style={{ fontSize: 11.5, color: GOLD, fontWeight: 700, marginBottom: 8 }}>
          {staging.length} {staging.length === 1 ? 'anexo será salvo' : 'anexos serão salvos'} junto com a proposta.
        </div>
      )}

      {erro && <div style={{ fontSize: 12, color: VERM, background: '#FBEAEA', border: `1px solid ${LINE}`, borderRadius: 8, padding: '6px 10px', marginBottom: 8 }}>{erro}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {modoStaging
          ? staging.map((item) => (
            <div key={item.key} style={linhaStyle}>
              <button type="button" onClick={() => void abrirStaging(item)} title="Abrir" style={iconeBtn}>{icone(item.tipo, item.categoria)}</button>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <button type="button" onClick={() => void abrirStaging(item)} style={nomeBtn}>
                    {item.tipo === 'link' ? (item.url ?? 'link') : (item.nome ?? 'arquivo')}
                  </button>
                  {item.tamanho ? <span style={{ fontSize: 10.5, color: MUT, flexShrink: 0 }}>{fmtTam(item.tamanho)}</span> : null}
                  <span title="Ainda não preso à proposta — será salvo no CRIAR" style={{ fontSize: 10, fontWeight: 700, color: GOLD, background: '#FFF3D6', borderRadius: 999, padding: '1px 7px', flexShrink: 0 }}>⏳ aguardando</span>
                </div>
                <textarea
                  defaultValue={item.descricao ?? ''}
                  onBlur={(e) => salvarDescricaoStaging(item.key, e.target.value)}
                  placeholder="Descreva o que tem aqui…" rows={1} style={descStyle}
                />
              </div>
              <button type="button" onClick={() => void excluirStaging(item)} title="Remover" style={xBtn}>✖</button>
            </div>
          ))
          : anexos.map((a) => (
            <div key={a.id} style={linhaStyle}>
              <button type="button" onClick={() => void abrirSalvo(a)} title="Abrir" style={iconeBtn}>{icone(a.tipo, a.categoria)}</button>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                  <button type="button" onClick={() => void abrirSalvo(a)} style={nomeBtn}>
                    {a.tipo === 'link' ? (a.url ?? 'link') : (a.nome_arquivo ?? 'arquivo')}
                  </button>
                  {a.tamanho_bytes ? <span style={{ fontSize: 10.5, color: MUT, flexShrink: 0 }}>{fmtTam(a.tamanho_bytes)}</span> : null}
                </div>
                <textarea
                  defaultValue={a.descricao ?? ''}
                  onBlur={(e) => void salvarDescricaoSalvo(a.id, e.target.value)}
                  placeholder="Descreva o que tem aqui…" rows={1} style={descStyle}
                />
              </div>
              <button type="button" onClick={() => void excluirSalvo(a.id)} title="Remover" style={xBtn}>✖</button>
            </div>
          ))}
      </div>
    </div>
  )
})

export default AnexosCard

const card: React.CSSProperties = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, padding: 12, marginTop: 12 }
const titulo: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: ESP }
const inp: React.CSSProperties = { fontSize: 12.5, padding: '7px 9px', border: `1px solid ${LINE}`, borderRadius: 7, color: ESP, background: '#fff', fontFamily: 'inherit' }
const btn: React.CSSProperties = { fontSize: 11.5, fontWeight: 700, padding: '5px 10px', borderRadius: 7, cursor: 'pointer', border: `1px solid ${LINE}`, background: '#fff', color: ESP }
const btnPrim: React.CSSProperties = { fontSize: 11.5, fontWeight: 700, padding: '6px 12px', borderRadius: 7, cursor: 'pointer', border: 'none', background: GOLD, color: ESP }
const linhaStyle: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'flex-start', border: `1px solid ${LINE}`, borderRadius: 8, padding: '8px 10px' }
const iconeBtn: React.CSSProperties = { background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', lineHeight: 1, padding: 0 }
const nomeBtn: React.CSSProperties = { background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: ESP, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }
const descStyle: React.CSSProperties = { width: '100%', marginTop: 4, fontSize: 11.5, color: ESP, border: `1px solid ${LINE}`, borderRadius: 6, padding: '4px 6px', resize: 'vertical', background: '#fff', fontFamily: 'inherit', boxSizing: 'border-box' }
const xBtn: React.CSSProperties = { background: 'none', border: 'none', color: VERM, cursor: 'pointer', fontSize: 13, flexShrink: 0 }
