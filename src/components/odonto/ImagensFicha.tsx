'use client'
// OD-5 · Imagens do paciente: galeria por data + upload (tipo/data/dente/tags) + visualizar + seleção
// múltipla (soft-delete). Reusa o padrão de storage dos buckets existentes (bucket privado odonto-imagens,
// path {company}/{paciente}/{uuid}_{nome}, RLS por foldername[1]) + signed URLs pra exibir.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { EmptyStateOdonto, TOK } from './ui'
import { RaioxAnalise } from './RaioxAnalise'
import { Camera, FileText, Trash2, X, UploadCloud, Search, Sparkles } from 'lucide-react'

export const BUCKET_ODONTO_IMG = 'odonto-imagens'
export type ImagemOdonto = { id: string; arquivo_path: string; arquivo_nome: string; mime: string | null; tipo: string | null; dente_fdi: string | null; data_imagem: string; tags: string[] | null; observacao: string | null; created_at: string | null }

const TIPOS = [{ id: 'raio_x', l: 'Raio-X' }, { id: 'foto', l: 'Foto' }, { id: 'exame', l: 'Exame' }, { id: 'pdf', l: 'PDF/Doc' }, { id: 'outro', l: 'Outro' }]
const tipoLabel = (t: string | null) => TIPOS.find((x) => x.id === t)?.l ?? (t || '—')
const fmtData = (s: string | null | undefined) => { if (!s) return '—'; try { return new Date(String(s).slice(0, 10) + 'T00:00:00').toLocaleDateString('pt-BR') } catch { return '—' } }
const isImg = (m: string | null) => !!m && m.startsWith('image/')
const uuid = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.round(Math.random() * 1e9)}`)

const inp: React.CSSProperties = { width: '100%', padding: '8px 10px', border: `0.5px solid ${TOK.line}`, borderRadius: 8, fontSize: 13, color: TOK.esp, background: '#fff', boxSizing: 'border-box' }
const btnGold: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: TOK.gold, color: '#fff', border: 'none', borderRadius: TOK.rCtrl, padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }
const btnLine: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff', color: TOK.esp, border: `0.5px solid ${TOK.line}`, borderRadius: TOK.rCtrl, padding: '7px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }

export function ImagensFicha({ companyId, pacienteId }: { companyId: string; pacienteId: string }) {
  const [imgs, setImgs] = useState<ImagemOdonto[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState('')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [upOpen, setUpOpen] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [analisar, setAnalisar] = useState<ImagemOdonto | null>(null)   // IA-2.1 · raio-x em análise
  const [iaRaioxOn, setIaRaioxOn] = useState(false)                     // feature ia_raiox ligada? (default ON)
  const flash = (t: string) => { setMsg(t); setTimeout(() => setMsg(null), 3500) }

  // IA-2.1 + Addendum · a feature ia_raiox está ligada? Visão é OPT-IN (default OFF) — fonte única
  // fn_ia_empresa_features (habilitado efetivo = config ?? default do catálogo). RD-52.
  useEffect(() => {
    let alive = true
    void supabase.rpc('fn_ia_empresa_features', { p_company_id: companyId }).then(({ data }) => {
      if (!alive) return
      const rows = (data as { feature: string; habilitado: boolean }[] | null) ?? []
      const row = rows.find((r) => r.feature === 'ia_raiox')
      setIaRaioxOn(!!row?.habilitado)   // sem catálogo/linha → desligado (opt-in)
    })
    return () => { alive = false }
  }, [companyId])

  const carregar = useCallback(async () => {
    const { data } = await supabase.rpc('fn_odonto_imagem_paciente', { p_company_id: companyId, p_paciente_id: pacienteId })
    const lista = (data as ImagemOdonto[] | null) ?? []
    setImgs(lista); setLoading(false); setSel(new Set())
    const paths = lista.filter((i) => isImg(i.mime)).map((i) => i.arquivo_path)
    if (paths.length) {
      const { data: signed } = await supabase.storage.from(BUCKET_ODONTO_IMG).createSignedUrls(paths, 3600)
      const map: Record<string, string> = {}
      for (const s of (signed ?? [])) { if (s.signedUrl && s.path) map[s.path] = s.signedUrl }
      setUrls(map)
    }
  }, [companyId, pacienteId])
  useEffect(() => { void carregar() }, [carregar])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return imgs.filter((i) =>
      (!filtro || i.tipo === filtro) &&
      (!q || i.arquivo_nome.toLowerCase().includes(q) || (i.tags ?? []).some((t) => t.toLowerCase().includes(q)) || (i.dente_fdi ?? '').includes(q)))
  }, [imgs, busca, filtro])

  const porData = useMemo(() => {
    const g: Record<string, ImagemOdonto[]> = {}
    for (const i of filtrados) { const k = String(i.data_imagem).slice(0, 10); (g[k] ??= []).push(i) }
    return Object.entries(g).sort((a, b) => b[0].localeCompare(a[0]))
  }, [filtrados])

  const abrir = async (i: ImagemOdonto) => {
    const url = urls[i.arquivo_path] ?? (await supabase.storage.from(BUCKET_ODONTO_IMG).createSignedUrl(i.arquivo_path, 3600)).data?.signedUrl
    if (url) window.open(url, '_blank', 'noopener')
  }
  const toggleSel = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const excluir = async () => {
    if (sel.size === 0) return
    if (!confirm(`Excluir ${sel.size} imagem(ns)? Vai pra lixeira (recuperável).`)) return
    const { data, error } = await supabase.rpc('fn_odonto_imagem_excluir', { p_company_id: companyId, p_ids: Array.from(sel) })
    if (error || (data as { ok?: boolean })?.ok === false) { flash('Falha ao excluir.'); return }
    flash('Imagens movidas pra lixeira.'); void carregar()
  }

  if (loading) return <div style={{ color: TOK.mut, fontSize: 13 }}>Carregando imagens…</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 180, border: `0.5px solid ${TOK.line}`, borderRadius: 8, padding: '6px 10px', background: '#fff' }}>
          <Search size={15} style={{ color: TOK.mut }} />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome, tag ou dente" style={{ flex: 1, border: 'none', outline: 'none', fontSize: 13, color: TOK.esp, background: 'transparent' }} />
        </div>
        <select value={filtro} onChange={(e) => setFiltro(e.target.value)} style={{ ...inp, width: 'auto' }}>
          <option value="">Todos os tipos</option>{TIPOS.map((t) => <option key={t.id} value={t.id}>{t.l}</option>)}
        </select>
        {sel.size > 0 && <button onClick={() => void excluir()} style={{ ...btnLine, color: TOK.red }}><Trash2 size={14} /> Excluir ({sel.size})</button>}
        <button onClick={() => setUpOpen(true)} style={btnGold}><UploadCloud size={15} /> Novo</button>
      </div>
      {msg && <div style={{ fontSize: 12.5, color: TOK.green, fontWeight: 600 }}>{msg}</div>}

      {porData.length === 0 ? (
        <EmptyStateOdonto titulo="Sem imagens" linha="Suba raio-x, fotos intraorais e exames — pelo computador ou pela câmera do celular." acao={<button onClick={() => setUpOpen(true)} style={btnGold}>+ Nova imagem</button>} />
      ) : porData.map(([data, lista]) => (
        <div key={data}>
          <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6, color: TOK.mut, margin: '4px 0 8px' }}>{fmtData(data)}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 10 }}>
            {lista.map((i) => {
              const marcado = sel.has(i.id)
              return (
                <div key={i.id} style={{ position: 'relative', border: `1px solid ${marcado ? TOK.gold : TOK.line}`, borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
                  <div onClick={() => void abrir(i)} style={{ height: 100, background: TOK.bg, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                    {isImg(i.mime) && urls[i.arquivo_path]
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={urls[i.arquivo_path]} alt={i.arquivo_nome} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <FileText size={30} style={{ color: TOK.mut }} />}
                  </div>
                  <label style={{ position: 'absolute', top: 6, left: 6, background: 'rgba(255,255,255,0.9)', borderRadius: 6, padding: 2, cursor: 'pointer', display: 'inline-flex' }}>
                    <input type="checkbox" checked={marcado} onChange={() => toggleSel(i.id)} />
                  </label>
                  {i.dente_fdi && <span style={{ position: 'absolute', top: 6, right: 6, background: TOK.esp, color: '#fff', fontSize: 10, fontWeight: 800, padding: '1px 6px', borderRadius: 999 }}>D{i.dente_fdi}</span>}
                  <div style={{ padding: '6px 8px' }}>
                    <div style={{ fontSize: 11.5, color: TOK.esp, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={i.arquivo_nome}>{i.arquivo_nome}</div>
                    <div style={{ fontSize: 10.5, color: TOK.mut }}>{tipoLabel(i.tipo)}{(i.tags ?? []).length ? ` · ${(i.tags ?? []).join(', ')}` : ''}</div>
                    {iaRaioxOn && i.tipo === 'raio_x' && isImg(i.mime) && (
                      <button onClick={() => setAnalisar(i)} style={{ marginTop: 6, width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5, background: 'linear-gradient(180deg,#FFFDF8,#fff)', border: `0.5px solid ${TOK.gold}`, borderRadius: 8, padding: '5px 8px', fontSize: 11, fontWeight: 700, color: TOK.gold, cursor: 'pointer' }}>
                        <Sparkles size={12} /> Analisar com IA
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {upOpen && <UploadModal companyId={companyId} pacienteId={pacienteId} onClose={() => setUpOpen(false)} onOk={() => { setUpOpen(false); flash('Imagem enviada.'); void carregar() }} />}
      {analisar && <RaioxAnalise companyId={companyId} pacienteId={pacienteId} imagem={analisar} imagemUrl={urls[analisar.arquivo_path]} onClose={() => setAnalisar(null)} onMarcado={() => flash('Odontograma atualizado com o que você confirmou.')} />}
    </div>
  )
}

function UploadModal({ companyId, pacienteId, onClose, onOk }: { companyId: string; pacienteId: string; onClose: () => void; onOk: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [tipo, setTipo] = useState('foto')
  const [data, setData] = useState(new Date().toISOString().slice(0, 10))
  const [dente, setDente] = useState('')
  const [tags, setTags] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const enviar = async () => {
    if (!file) { setErro('Escolha um arquivo.'); return }
    if (file.size > 25 * 1024 * 1024) { setErro('Arquivo acima de 25 MB. Reduza antes de subir.'); return }
    setEnviando(true); setErro(null)
    const safe = file.name.replace(/[^\w.\-]+/g, '_').slice(-80)
    const path = `${companyId}/${pacienteId}/${uuid()}_${safe}`
    const up = await supabase.storage.from(BUCKET_ODONTO_IMG).upload(path, file, { contentType: file.type || undefined, upsert: false })
    if (up.error) { setEnviando(false); setErro('Falha no upload: ' + up.error.message); return }
    const { data: res, error } = await supabase.rpc('fn_odonto_imagem_salvar', {
      p_company_id: companyId, p_paciente_id: pacienteId,
      p_dados: {
        arquivo_path: path, arquivo_nome: file.name, mime: file.type || null, tamanho_bytes: file.size,
        tipo, dente_fdi: dente.trim() || null, data_imagem: data,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean), observacao: null,
      },
    })
    setEnviando(false)
    if (error || (res as { ok?: boolean })?.ok === false) { setErro('Enviado, mas falhou ao registrar. Tente de novo.'); return }
    onOk()
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.45)', zIndex: 60, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} className="sm:items-center sm:p-4">
      <div onClick={(e) => e.stopPropagation()} className="w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl" style={{ background: '#fff', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 -20px 50px rgba(61,35,20,0.3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: `0.5px solid ${TOK.line}` }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: TOK.esp }}>Nova imagem</div>
          <button onClick={onClose} style={{ color: TOK.mut, background: 'none', border: 'none', cursor: 'pointer' }}><X size={20} /></button>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label style={{ ...btnLine, justifyContent: 'center', padding: '20px', flexDirection: 'column', cursor: 'pointer', borderStyle: 'dashed' }}>
            <Camera size={22} style={{ color: TOK.gold }} />
            <span style={{ fontSize: 12.5 }}>{file ? file.name : 'Escolher arquivo ou usar a câmera'}</span>
            <input type="file" accept="image/*,application/pdf" capture="environment" onChange={(e) => setFile(e.target.files?.[0] ?? null)} style={{ display: 'none' }} />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label><span style={{ fontSize: 11, color: TOK.mut, display: 'block', marginBottom: 4 }}>Tipo</span>
              <select value={tipo} onChange={(e) => setTipo(e.target.value)} style={inp}>{TIPOS.map((t) => <option key={t.id} value={t.id}>{t.l}</option>)}</select></label>
            <label><span style={{ fontSize: 11, color: TOK.mut, display: 'block', marginBottom: 4 }}>Data</span>
              <input type="date" value={data} onChange={(e) => setData(e.target.value)} style={inp} /></label>
            <label><span style={{ fontSize: 11, color: TOK.mut, display: 'block', marginBottom: 4 }}>Dente (FDI · opcional)</span>
              <input value={dente} onChange={(e) => setDente(e.target.value.replace(/[^\d]/g, '').slice(0, 2))} placeholder="ex.: 11" style={inp} /></label>
            <label><span style={{ fontSize: 11, color: TOK.mut, display: 'block', marginBottom: 4 }}>Tags (vírgula)</span>
              <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="panorâmica, inicial" style={inp} /></label>
          </div>
          {erro && <div style={{ fontSize: 12.5, color: TOK.red }}>{erro}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={onClose} style={btnLine}>Cancelar</button>
            <button onClick={() => void enviar()} disabled={enviando || !file} style={{ ...btnGold, opacity: (enviando || !file) ? 0.6 : 1 }}>{enviando ? 'Enviando…' : 'Enviar'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
