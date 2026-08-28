'use client'

// SPEC ANEXO-1 · componente ÚNICO de anexos COM DESCRIÇÃO. Um componente, três telas (proposta ·
// oportunidade · visita) — recebe vinculoTipo + vinculoId. Molde: ClienteArquivos (RD-26).
// Bucket crm-anexos (privado, 50MB, policy FOR ALL com SELECT). Excluir = soft-delete (RD-30).
// Nunca mostra erro cru de storage/RLS — mensagem em linguagem de usuário.

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'

const ESP = '#3D2314', GOLD = '#C8941A', LINE = '#E7DED3', MUT = '#6b5444', VERM = '#B91C1C'
const MAX = 50 * 1024 * 1024

export type VinculoTipo = 'proposta' | 'oportunidade' | 'visita'
type Anexo = {
  id: string; tipo: string; categoria: string | null; descricao: string | null; ordem: number
  nome_arquivo: string | null; storage_path: string | null; mime_type: string | null
  tamanho_bytes: number | null; url: string | null; enviado_em: string
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
function iconeDe(a: Anexo): string {
  if (a.tipo === 'link') return '🔗'
  switch (a.categoria) {
    case 'foto': return '🖼️'
    case 'video': return '🎬'
    case 'planta': return '📐'
    case 'documento': return '📄'
    default: return '📎'
  }
}

export default function AnexosCard({ companyId, vinculoTipo, vinculoId }: { companyId: string; vinculoTipo: VinculoTipo; vinculoId: string | null }) {
  const [anexos, setAnexos] = useState<Anexo[]>([])
  const [prog, setProg] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkDesc, setLinkDesc] = useState('')
  const [drag, setDrag] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const carregar = useCallback(async () => {
    if (!vinculoId) { setAnexos([]); return }
    const { data } = await supabase.rpc('fn_crm_anexos_listar', { p_vinculo_tipo: vinculoTipo, p_vinculo_id: vinculoId })
    const r = data as { ok?: boolean; anexos?: Anexo[] } | null
    setAnexos(r?.anexos ?? [])
  }, [vinculoTipo, vinculoId])
  useEffect(() => { void carregar() }, [carregar])

  async function enviar(files: FileList | File[]) {
    if (!vinculoId) return
    setErro(null)
    const arr = Array.from(files)
    let ok = 0
    for (let i = 0; i < arr.length; i++) {
      const f = arr[i]
      if (f.size > MAX) { setErro(`"${f.name}" tem mais de 50 MB. Reduza ou envie como link.`); continue }
      setProg(`Enviando ${i + 1}/${arr.length}: ${f.name}…`)
      try {
        const safe = f.name.replace(/[^a-zA-Z0-9._-]/g, '_')
        const path = `${companyId}/${vinculoTipo}/${vinculoId}/${Date.now()}_${i}_${safe}`
        const up = await supabase.storage.from('crm-anexos').upload(path, f, { upsert: false, contentType: f.type || undefined })
        if (up.error) throw up.error
        const { data, error } = await supabase.rpc('fn_crm_anexo_adicionar', {
          p_company_id: companyId, p_vinculo_tipo: vinculoTipo, p_vinculo_id: vinculoId,
          p_tipo: 'arquivo', p_categoria: categoriaDe(f.name, f.type), p_descricao: null,
          p_nome: f.name, p_path: path, p_mime: f.type || null, p_tamanho: f.size, p_url: null,
        })
        const j = data as { ok?: boolean } | null
        if (error || !j?.ok) { throw new Error('não registrou') }
        ok++
      } catch {
        setErro(`Não consegui enviar "${f.name}". Tente de novo ou envie como link.`)
      }
    }
    setProg(null)
    if (ok > 0) void carregar()
    if (inputRef.current) inputRef.current.value = ''
  }

  async function adicionarLink() {
    if (!vinculoId) return
    const u = linkUrl.trim()
    if (!u) return
    setErro(null)
    const { data, error } = await supabase.rpc('fn_crm_anexo_adicionar', {
      p_company_id: companyId, p_vinculo_tipo: vinculoTipo, p_vinculo_id: vinculoId,
      p_tipo: 'link', p_categoria: 'outro', p_descricao: linkDesc.trim() || null, p_url: u,
    })
    const j = data as { ok?: boolean } | null
    if (error || !j?.ok) { setErro('Não consegui salvar o link.'); return }
    setLinkOpen(false); setLinkUrl(''); setLinkDesc(''); void carregar()
  }

  async function salvarDescricao(id: string, descricao: string) {
    await supabase.rpc('fn_crm_anexo_editar', { p_anexo_id: id, p_descricao: descricao })
  }
  async function excluir(id: string) {
    if (!window.confirm('Remover este anexo? Ele sai da lista (exclusão reversível).')) return
    const { data } = await supabase.rpc('fn_crm_anexo_excluir', { p_anexo_id: id })
    if ((data as { ok?: boolean } | null)?.ok) setAnexos((a) => a.filter((x) => x.id !== id))
  }
  async function abrir(a: Anexo) {
    if (a.tipo === 'link' && a.url) { window.open(a.url, '_blank', 'noopener'); return }
    if (!a.storage_path) return
    const { data } = await supabase.storage.from('crm-anexos').createSignedUrl(a.storage_path, 3600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener')
  }

  if (!vinculoId) {
    return (
      <div style={card}>
        <div style={titulo}>📎 Anexos</div>
        <div style={{ fontSize: 12, color: MUT }}>Salve primeiro para anexar arquivos e links.</div>
      </div>
    )
  }

  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={titulo}>📎 Anexos {anexos.length > 0 && <span style={{ color: MUT, fontWeight: 400 }}>({anexos.length})</span>}</div>
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

      {erro && <div style={{ fontSize: 12, color: VERM, background: '#FBEAEA', border: `1px solid ${LINE}`, borderRadius: 8, padding: '6px 10px', marginBottom: 8 }}>{erro}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {anexos.map((a) => (
          <div key={a.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', border: `1px solid ${LINE}`, borderRadius: 8, padding: '8px 10px' }}>
            <button type="button" onClick={() => void abrir(a)} title="Abrir" style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', lineHeight: 1, padding: 0 }}>{iconeDe(a)}</button>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <button type="button" onClick={() => void abrir(a)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: ESP, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {a.tipo === 'link' ? (a.url ?? 'link') : (a.nome_arquivo ?? 'arquivo')}
                </button>
                {a.tamanho_bytes ? <span style={{ fontSize: 10.5, color: MUT, flexShrink: 0 }}>{fmtTam(a.tamanho_bytes)}</span> : null}
              </div>
              <textarea
                defaultValue={a.descricao ?? ''}
                onBlur={(e) => void salvarDescricao(a.id, e.target.value)}
                placeholder="Descreva o que tem aqui…"
                rows={1}
                style={{ width: '100%', marginTop: 4, fontSize: 11.5, color: ESP, border: `1px solid ${LINE}`, borderRadius: 6, padding: '4px 6px', resize: 'vertical', background: '#fff', fontFamily: 'inherit', boxSizing: 'border-box' }}
              />
            </div>
            <button type="button" onClick={() => void excluir(a.id)} title="Remover" style={{ background: 'none', border: 'none', color: VERM, cursor: 'pointer', fontSize: 13, flexShrink: 0 }}>✖</button>
          </div>
        ))}
      </div>
    </div>
  )
}

const card: React.CSSProperties = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, padding: 12, marginTop: 12 }
const titulo: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: ESP }
const inp: React.CSSProperties = { fontSize: 12.5, padding: '7px 9px', border: `1px solid ${LINE}`, borderRadius: 7, color: ESP, background: '#fff', fontFamily: 'inherit' }
const btn: React.CSSProperties = { fontSize: 11.5, fontWeight: 700, padding: '5px 10px', borderRadius: 7, cursor: 'pointer', border: `1px solid ${LINE}`, background: '#fff', color: ESP }
const btnPrim: React.CSSProperties = { fontSize: 11.5, fontWeight: 700, padding: '6px 12px', borderRadius: 7, cursor: 'pointer', border: 'none', background: GOLD, color: ESP }
