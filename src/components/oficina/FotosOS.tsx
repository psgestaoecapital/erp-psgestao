'use client'

// #135 item 6 · fotos da Ordem de Serviço: várias de uma vez (galeria ou câmera), em paralelo, com progresso,
// miniaturas, legenda opcional e excluir. Lista TODAS as fotos da OS (recepção, diagnóstico e serviço); as novas
// entram como etapa 'servico' (fn_oficina_registro_salvar). Excluir usa fn_os_foto_excluir (guarda de empresa) e
// remove o arquivo do bucket. Uma foto que falha não derruba as outras: o aviso diz qual não subiu.
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import AjudaCampo from '@/components/ajuda/AjudaCampo'
import FotosMultiplas from '@/components/oficina/FotosMultiplas'
import { BUCKET_OFICINA, avisoFalhas, enviarFotos, type ProgressoFoto } from '@/lib/oficina/envioFotos'

type FotoOS = { id: string; foto_path: string; descricao: string | null; etapa: string | null; _url?: string | null }

const ESP = '#3D2314', ESP60 = '#6B5D4F', LINE = '#E0D8CC', RED = '#B23A3A'
const ETAPA: Record<string, string> = { recepcao: 'Recepção', diagnostico: 'Diagnóstico', servico: 'Serviço' }

export default function FotosOS({ osId, companyId, onFlash }: { osId: string; companyId: string; onFlash?: (m: string) => void }) {
  const [fotos, setFotos] = useState<FotoOS[]>([])
  const [legenda, setLegenda] = useState('')
  const [progresso, setProgresso] = useState<ProgressoFoto[]>([])
  const [enviando, setEnviando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    const { data } = await supabase.rpc('fn_oficina_registro_listar', { p_company_id: companyId, p_os_id: osId, p_etapa: null })
    const regs = (data as FotoOS[] | null) ?? []
    const comUrl = await Promise.all(regs.map(async (r) => {
      const { data: s } = await supabase.storage.from(BUCKET_OFICINA).createSignedUrl(r.foto_path, 3600)
      return { ...r, _url: s?.signedUrl ?? null }
    }))
    setFotos(comUrl)
  }, [companyId, osId])
  useEffect(() => { void carregar() }, [carregar])

  const enviar = async (files: File[]) => {
    setEnviando(true); setAviso(null)
    setProgresso(files.map((f, idx) => ({ idx, nome: f.name, estado: 'fila', pct: 10 })))
    const desc = legenda.trim() || 'Foto da OS'
    const r = await enviarFotos(files, {
      pasta: `${companyId}/os/${osId}`,
      onProgresso: (p) => setProgresso((prev) => prev.map((x) => (x.idx === p.idx ? p : x))),
      registrar: async (path) => {
        const { data, error } = await supabase.rpc('fn_oficina_registro_salvar', {
          p_company_id: companyId, p_os_id: osId, p_foto_path: path, p_descricao: desc, p_etapa: 'servico',
        })
        const res = data as { ok?: boolean; erro?: string; id?: string } | null
        if (error || !res?.ok) throw new Error(error?.message ?? res?.erro ?? 'falha ao salvar a foto')
        return res.id ?? null
      },
    })
    setEnviando(false); setLegenda('')
    const a = avisoFalhas(r)
    setAviso(a)
    if (!a) onFlash?.(`📷 ${r.enviadas.length} foto(s) salvas na OS`)
    void carregar()
  }

  const excluir = async (f: FotoOS) => {
    if (!confirm('Excluir esta foto?\n\nEla sai do histórico fotográfico da OS (some também da impressão).')) return
    const { data, error } = await supabase.rpc('fn_os_foto_excluir', { p_id: f.id })
    const r = data as { sucesso?: boolean; erro?: string; foto_path?: string } | null
    if (error || !r?.sucesso) {
      setAviso(r?.erro === 'sem_acesso' ? 'Sem permissão para excluir esta foto.' : (error?.message ?? r?.erro ?? 'Falha ao excluir a foto'))
      return
    }
    setFotos((prev) => prev.filter((x) => x.id !== f.id))
    if (r.foto_path) await supabase.storage.from(BUCKET_OFICINA).remove([r.foto_path])
    onFlash?.('🗑 Foto excluída')
  }

  return (
    <div data-testid="os-fotos" style={{ border: `1px solid ${LINE}`, borderRadius: 12, padding: 14, background: '#fff', marginTop: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: ESP, marginBottom: 8 }}>
        Fotos da OS {fotos.length > 0 && <span style={{ color: ESP60, fontWeight: 400 }}>· {fotos.length}</span>}
      </div>
      <label style={{ display: 'block', fontSize: 12, color: ESP60, marginBottom: 8 }}>
        Legenda (opcional) <AjudaCampo chave="oficina.fotos.legenda" rota="/dashboard/os" />
        <input data-testid="os-fotos-legenda" value={legenda} onChange={(e) => setLegenda(e.target.value)} placeholder="Ex.: peça trocada, antes do serviço"
          style={{ display: 'block', width: '100%', marginTop: 4, minHeight: 40, padding: '8px 10px', border: `1px solid ${LINE}`, borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }} />
      </label>
      <FotosMultiplas onArquivos={enviar} progresso={progresso} enviando={enviando} rotaAjuda="/dashboard/os" testid="os-fotos-envio" />
      {aviso && <div data-testid="os-fotos-aviso" style={{ marginTop: 8, fontSize: 12, color: RED, fontWeight: 700 }}>{aviso}</div>}
      {fotos.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 8, marginTop: 12 }}>
          {fotos.map((f) => (
            <div key={f.id} data-testid="os-foto-miniatura" style={{ border: `1px solid ${LINE}`, borderRadius: 8, overflow: 'hidden', background: '#FAF7F2' }}>
              {f._url
                ? <a href={f._url} target="_blank" rel="noreferrer"><img src={f._url} alt={f.descricao || 'foto'} style={{ width: '100%', height: 80, objectFit: 'cover', display: 'block' }} /></a>
                : <div style={{ height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: ESP60 }}>sem prévia</div>}
              <div style={{ padding: '4px 6px', fontSize: 11, color: ESP, lineHeight: 1.3 }}>
                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.descricao ?? ''}>{f.descricao}</div>
                <div style={{ color: ESP60 }}>{ETAPA[f.etapa ?? ''] ?? f.etapa}</div>
              </div>
              <button type="button" onClick={() => void excluir(f)} data-ajuda="oficina.fotos.excluir"
                style={{ width: '100%', border: 'none', borderTop: `1px solid ${LINE}`, background: '#fff', color: RED, fontSize: 11, fontWeight: 700, padding: '8px 0', cursor: 'pointer' }}>excluir</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
