'use client'

// R5+R6 · Modal do MECÂNICO: solicitar peça ao dono (SEM preço). Busca peça (fn_oficina_pecas_buscar),
// quantidade, FOTO da peça antiga (câmera) + observação → fn_oficina_peca_solicitar (dispara alerta pro dono).
// Foto reusa o bucket privado oficina-recepcao, caminho {companyId}/pecas/{osId}/{uuid}.jpg (passa na RLS).
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { X, Camera, Search, Loader2, Package } from 'lucide-react'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', ESP60 = 'rgba(61,35,20,0.55)', OK = '#166534'
const BUCKET = 'oficina-recepcao'

type PecaOpt = { id: string; codigo: string | null; nome: string; estoque_atual: number | null; unidade: string | null }

// compressão leve (canvas) — mesma ideia da Recepção, mobile-first
async function comprimir(file: File): Promise<Blob> {
  try {
    const img = document.createElement('img')
    const url = URL.createObjectURL(file)
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url })
    const max = 1280
    const escala = Math.min(1, max / Math.max(img.width, img.height))
    const cv = document.createElement('canvas')
    cv.width = Math.round(img.width * escala); cv.height = Math.round(img.height * escala)
    cv.getContext('2d')!.drawImage(img, 0, 0, cv.width, cv.height)
    URL.revokeObjectURL(url)
    const blob: Blob | null = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.7))
    return blob ?? file
  } catch { return file }
}

export default function SolicitarPecaModal({ companyId, osId, mecanicoNome, aberto, onFechar, onEnviada }: {
  companyId: string; osId: string; mecanicoNome?: string | null
  aberto: boolean; onFechar: () => void; onEnviada?: () => void
}) {
  const [busca, setBusca] = useState('')
  const [sugestoes, setSugestoes] = useState<PecaOpt[]>([])
  const [pecaSel, setPecaSel] = useState<PecaOpt | null>(null)
  const [descLivre, setDescLivre] = useState('')
  const [qtd, setQtd] = useState('1')
  const [obs, setObs] = useState('')
  const [fotoPath, setFotoPath] = useState<string | null>(null)
  const [fotoUrl, setFotoUrl] = useState<string | null>(null)
  const [subindo, setSubindo] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    if (busca.trim().length < 2) { setSugestoes([]); return }
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc('fn_oficina_pecas_buscar', { p_company_id: companyId, p_termo: busca.trim() })
      setSugestoes((Array.isArray(data) ? data : []) as PecaOpt[])
    }, 300)
    return () => clearTimeout(t)
  }, [busca, companyId])

  const onFoto = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return
    setSubindo(true); setErro(null)
    const blob = await comprimir(f)
    const path = `${companyId}/pecas/${osId}/${crypto.randomUUID()}.jpg`
    const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false })
    if (error) { setErro('Falha ao enviar a foto: ' + error.message); setSubindo(false); return }
    const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600)
    setFotoPath(path); setFotoUrl(signed?.signedUrl ?? null); setSubindo(false)
  }, [companyId, osId])

  const descricao = pecaSel?.nome ?? descLivre.trim()

  const enviar = async () => {
    if (!descricao) { setErro('Escolha a peça (ou escreva o nome).'); return }
    const q = Number(qtd.replace(',', '.'))
    if (!isFinite(q) || q <= 0) { setErro('Quantidade inválida.'); return }
    setSalvando(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_oficina_peca_solicitar', {
      p_company_id: companyId, p_os_id: osId, p_descricao: descricao, p_quantidade: q,
      p_produto_id: pecaSel?.id ?? null, p_foto_path: fotoPath, p_observacao: obs.trim() || null,
      p_solicitado_por_nome: mecanicoNome ?? null,
    })
    setSalvando(false)
    const res = data as { ok?: boolean; erro?: string } | null
    if (error || !res?.ok) { setErro(error?.message || res?.erro || 'Falha ao enviar'); return }
    // reset + fecha
    setBusca(''); setSugestoes([]); setPecaSel(null); setDescLivre(''); setQtd('1'); setObs(''); setFotoPath(null); setFotoUrl(null)
    onEnviada?.(); onFechar()
  }

  if (!aberto) return null
  const inp: React.CSSProperties = { width: '100%', padding: '10px 12px', fontSize: 14, borderRadius: 10, border: `1px solid ${LINE}`, background: '#fff', color: ESP }

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onFechar() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.45)', zIndex: 120, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div style={{ background: BG, borderRadius: '16px 16px 0 0', padding: 16, width: '100%', maxWidth: 520, maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: ESP }}>Solicitar peça ao dono</div>
          <button onClick={onFechar} style={{ background: 'none', border: 'none', cursor: 'pointer', color: ESP60 }}><X size={20} /></button>
        </div>

        {/* Peça (SEM preço) */}
        <label style={{ fontSize: 12, color: ESP60 }}>Peça</label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', border: `1px solid ${LINE}`, borderRadius: 10, padding: '0 10px', background: '#fff', marginTop: 4 }}>
          <Search size={16} color={ESP60} />
          <input value={pecaSel ? pecaSel.nome : busca} onChange={(e) => { setPecaSel(null); setBusca(e.target.value) }}
            placeholder="Buscar no estoque (código/nome)…" style={{ ...inp, border: 'none', padding: '10px 0' }} />
        </div>
        {!pecaSel && sugestoes.length > 0 && (
          <div style={{ border: `1px solid ${LINE}`, borderRadius: 10, marginTop: 4, background: '#fff', maxHeight: 180, overflowY: 'auto' }}>
            {sugestoes.map((p) => (
              <button key={p.id} onClick={() => { setPecaSel(p); setSugestoes([]) }}
                style={{ width: '100%', textAlign: 'left', padding: '9px 12px', background: 'none', border: 'none', borderBottom: `1px solid ${LINE}`, cursor: 'pointer' }}>
                <div style={{ fontSize: 14, color: ESP }}>{p.nome}</div>
                <div style={{ fontSize: 11, color: ESP60 }}>{p.codigo ? `${p.codigo} · ` : ''}estoque {p.estoque_atual != null ? Number(p.estoque_atual) : '—'} {p.unidade ?? ''}</div>
              </button>
            ))}
          </div>
        )}
        {!pecaSel && busca.trim().length >= 2 && sugestoes.length === 0 && (
          <input value={descLivre} onChange={(e) => setDescLivre(e.target.value)} placeholder="Não achou? Escreva o nome da peça" style={{ ...inp, marginTop: 6 }} />
        )}

        {/* Quantidade */}
        <div style={{ marginTop: 12 }}>
          <label style={{ fontSize: 12, color: ESP60 }}>Quantidade</label>
          <input type="text" inputMode="decimal" value={qtd} onChange={(e) => setQtd(e.target.value)} style={{ ...inp, marginTop: 4, width: 120 }} />
        </div>

        {/* Foto da peça antiga */}
        <div style={{ marginTop: 12 }}>
          <label style={{ fontSize: 12, color: ESP60 }}>Foto da peça (opcional)</label>
          <div style={{ marginTop: 4 }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 14px', borderRadius: 10, background: '#fff', border: `1px solid ${LINE}`, cursor: 'pointer', color: ESP, fontSize: 13, fontWeight: 600 }}>
              {subindo ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />} {subindo ? 'Enviando…' : (fotoPath ? 'Trocar foto' : 'Tirar / anexar foto')}
              <input type="file" accept="image/*" capture="environment" onChange={onFoto} style={{ display: 'none' }} />
            </label>
            {fotoUrl && <img src={fotoUrl} alt="peça" style={{ display: 'block', marginTop: 8, maxWidth: 160, borderRadius: 8, border: `1px solid ${LINE}` }} />}
          </div>
        </div>

        {/* Observação */}
        <div style={{ marginTop: 12 }}>
          <label style={{ fontSize: 12, color: ESP60 }}>Observação</label>
          <textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={2} placeholder="Ex.: peça antiga muito gasta" style={{ ...inp, marginTop: 4, resize: 'vertical' }} />
        </div>

        {erro && <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, background: '#FCEBEB', color: '#791F1F', fontSize: 12 }}>{erro}</div>}

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button onClick={onFechar} style={{ flex: 1, padding: '12px', borderRadius: 10, border: `1px solid ${LINE}`, background: '#fff', color: ESP, cursor: 'pointer', fontSize: 13 }}>Cancelar</button>
          <button onClick={enviar} disabled={salvando || subindo}
            style={{ flex: 2, padding: '12px', borderRadius: 10, border: 'none', background: GOLD, color: '#1A1410', fontWeight: 700, cursor: salvando ? 'default' : 'pointer', opacity: salvando || subindo ? 0.6 : 1 }}>
            {salvando ? 'Enviando…' : 'Enviar solicitação'}
          </button>
        </div>
        <div style={{ marginTop: 8, textAlign: 'center', fontSize: 11, color: OK }}>🚫 Sem preço aqui — o dono decide a compra.</div>
      </div>
    </div>
  )
}
