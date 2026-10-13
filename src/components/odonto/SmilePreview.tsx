'use client'
// IA-2.2 Fase 2 · Prévia ILUSTRATIVA gerada (Gemini). É simulação motivacional, NÃO resultado real
// (Pilar 1). Atrás de aviso + consentimento do paciente (LGPD). A imagem gerada recebe MARCA D'ÁGUA no
// canvas (client) e só é salva se o dentista escolher "Manter" — marcada ilustrativo=true (nunca é foto
// clínica). Se distorcer o rosto/ficar ruim → Descartar. Feature 'ia_smile_preview' (visão, OFF por padrão).
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { TOK } from './ui'
import type { ImagemOdonto } from './ImagensFicha'
import { Sparkles, X, ShieldAlert, Check, Trash2 } from 'lucide-react'

const BUCKET = 'odonto-imagens'
const uuid = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.round(Math.random() * 1e9)}`)

async function marcaDagua(base64: string, mime: string): Promise<{ blob: Blob; dataUrl: string }> {
  const img = new Image()
  img.src = `data:${mime};base64,${base64}`
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth || 512; canvas.height = img.naturalHeight || 512
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  // marca d'água diagonal repetida
  ctx.save()
  ctx.globalAlpha = 0.16; ctx.fillStyle = '#000'
  ctx.font = `${Math.max(14, Math.round(canvas.width / 20))}px sans-serif`
  ctx.textAlign = 'center'
  ctx.translate(canvas.width / 2, canvas.height / 2); ctx.rotate(-Math.PI / 8)
  const passo = Math.max(40, Math.round(canvas.height / 5))
  for (let y = -canvas.height; y < canvas.height; y += passo) ctx.fillText('SIMULAÇÃO ILUSTRATIVA', 0, y)
  ctx.restore()
  // faixa inferior
  const bh = Math.max(26, Math.round(canvas.height * 0.09))
  ctx.fillStyle = 'rgba(163,45,45,0.88)'; ctx.fillRect(0, canvas.height - bh, canvas.width, bh)
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.font = `bold ${Math.max(11, Math.round(bh * 0.38))}px sans-serif`
  ctx.fillText('Simulação ilustrativa — não é o resultado real', canvas.width / 2, canvas.height - bh / 2)
  const dataUrl = canvas.toDataURL('image/png')
  const blob = await (await fetch(dataUrl)).blob()
  return { blob, dataUrl }
}

export function SmilePreview({ companyId, pacienteId, imagem, imagemUrl, onClose, onSalvo }: {
  companyId: string; pacienteId: string; imagem: ImagemOdonto; imagemUrl?: string; onClose: () => void; onSalvo: () => void
}) {
  const [consent, setConsent] = useState(false)
  const [gerando, setGerando] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [blob, setBlob] = useState<Blob | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  const gerar = async () => {
    if (!consent) return
    setGerando(true); setAviso(null); setOk(null); setPreviewUrl(null); setBlob(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) { setAviso('sessão'); return }
      const res = await fetch('/api/odonto/smile-gerar', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ company_id: companyId, imagem_id: imagem.id, consentimento: true }),
      })
      const j = await res.json() as { ok?: boolean; imagem_base64?: string; mime?: string; aviso?: string; error?: string }
      if (!j.ok || !j.imagem_base64) { setAviso(j.aviso || j.error || 'Não foi possível gerar agora.'); return }
      const { blob: b, dataUrl } = await marcaDagua(j.imagem_base64, j.mime || 'image/png')
      setBlob(b); setPreviewUrl(dataUrl)
    } catch { setAviso('falha ao gerar') } finally { setGerando(false) }
  }

  const manter = async () => {
    if (!blob) return
    setSalvando(true); setAviso(null)
    try {
      const path = `${companyId}/${pacienteId}/${uuid()}_smile_preview.png`
      const up = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/png', upsert: false })
      if (up.error) { setAviso('Falha ao salvar: ' + up.error.message); return }
      const { data, error } = await supabase.rpc('fn_odonto_imagem_salvar', {
        p_company_id: companyId, p_paciente_id: pacienteId,
        p_dados: { arquivo_path: path, arquivo_nome: 'Prévia ilustrativa (IA).png', mime: 'image/png', tamanho_bytes: blob.size,
          tipo: 'smile_preview', data_imagem: new Date().toISOString().slice(0, 10), tags: ['IA', 'simulação'],
          observacao: 'Simulação ilustrativa gerada por IA — não é o resultado real.', ilustrativo: true },
      })
      if (error || (data as { ok?: boolean })?.ok === false) { setAviso('Falha ao registrar a prévia.'); return }
      setOk('Prévia salva na galeria (marcada como ilustrativa). Ela não é foto clínica.')
      onSalvo()
    } finally { setSalvando(false) }
  }

  const descartar = () => { setPreviewUrl(null); setBlob(null); setOk(null); setAviso(null) }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(61,35,20,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 760, maxHeight: '92vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderBottom: `0.5px solid ${TOK.line}` }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 800, color: TOK.gold }}><Sparkles size={16} /> Prévia ilustrativa do sorriso</span>
          <span style={{ flex: 1 }} />
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: TOK.mut }}><X size={20} /></button>
        </div>

        <div style={{ padding: 14, overflowY: 'auto' }}>
          {/* aviso crítico */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: '#FBEBEB', border: `0.5px solid ${TOK.red}`, borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>
            <ShieldAlert size={16} style={{ color: TOK.red, flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: 11.5, color: '#7A2020', lineHeight: 1.45 }}>
              <strong>Simulação ilustrativa — NÃO é o resultado real.</strong> É uma prévia motivacional gerada por IA (experimental). A imagem pode não ficar fiel; você avalia e decide se mostra. O resultado real depende da avaliação e do tratamento clínico. A imagem sai com marca d&apos;água e nunca vira registro clínico.
            </div>
          </div>

          {!previewUrl ? (
            <>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: 12, background: '#fff', border: `1px solid ${TOK.line}`, borderRadius: 8, marginBottom: 12, cursor: 'pointer' }}>
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 2, accentColor: TOK.gold }} />
                <span style={{ fontSize: 12.5, color: TOK.esp, lineHeight: 1.5 }}>Confirmo o <strong>consentimento do paciente</strong> para gerar uma simulação a partir da foto dele (LGPD), ciente de que é ilustrativa.</span>
              </label>
              {imagemUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imagemUrl} alt={imagem.arquivo_nome} style={{ width: '100%', maxHeight: 240, objectFit: 'contain', background: '#000', borderRadius: 10, marginBottom: 12 }} />
              )}
              {aviso && <div style={{ fontSize: 12.5, color: TOK.mut, marginBottom: 10 }}>{aviso}</div>}
              <button onClick={() => void gerar()} disabled={!consent || gerando}
                style={{ width: '100%', minHeight: 48, borderRadius: 12, border: 'none', background: (consent && !gerando) ? TOK.gold : TOK.line, color: '#fff', fontSize: 14.5, fontWeight: 700, cursor: (consent && !gerando) ? 'pointer' : 'not-allowed' }}>
                {gerando ? 'Gerando a prévia… (pode levar alguns segundos)' : '✨ Gerar prévia ilustrativa'}
              </button>
            </>
          ) : (
            <>
              {/* antes | prévia */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <div style={{ fontSize: 10.5, fontWeight: 800, color: TOK.mut, textTransform: 'uppercase', marginBottom: 4 }}>Antes (real)</div>
                  {imagemUrl
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={imagemUrl} alt="antes" style={{ width: '100%', borderRadius: 10, background: '#000', maxHeight: 300, objectFit: 'contain' }} />
                    : <div style={{ fontSize: 12, color: TOK.mut }}>—</div>}
                </div>
                <div>
                  <div style={{ fontSize: 10.5, fontWeight: 800, color: TOK.gold, textTransform: 'uppercase', marginBottom: 4 }}>Prévia (ilustrativa)</div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={previewUrl} alt="prévia ilustrativa" style={{ width: '100%', borderRadius: 10, background: '#000', maxHeight: 300, objectFit: 'contain' }} />
                </div>
              </div>
              {aviso && <div style={{ fontSize: 12.5, color: TOK.red, marginTop: 10 }}>{aviso}</div>}
              {ok && <div style={{ fontSize: 12.5, color: TOK.green, fontWeight: 600, marginTop: 10 }}>{ok}</div>}
            </>
          )}
        </div>

        {previewUrl && !ok && (
          <div style={{ display: 'flex', gap: 8, padding: 12, borderTop: `0.5px solid ${TOK.line}`, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={descartar} disabled={salvando} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff', border: `0.5px solid ${TOK.line}`, borderRadius: 999, padding: '8px 14px', fontSize: 12.5, fontWeight: 600, color: TOK.red, cursor: 'pointer' }}>
              <Trash2 size={14} /> Descartar (ficou ruim)
            </button>
            <button onClick={() => void manter()} disabled={salvando}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: TOK.gold, color: '#fff', border: 'none', borderRadius: 999, padding: '9px 18px', fontSize: 13.5, fontWeight: 700, cursor: salvando ? 'not-allowed' : 'pointer', opacity: salvando ? 0.6 : 1 }}>
              <Check size={16} /> {salvando ? 'Salvando…' : 'Manter na galeria'}
            </button>
          </div>
        )}
        {ok && (
          <div style={{ padding: 12, borderTop: `0.5px solid ${TOK.line}`, display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={onClose} style={{ background: TOK.gold, color: '#fff', border: 'none', borderRadius: 999, padding: '9px 18px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}>Fechar</button>
          </div>
        )}
      </div>
    </div>
  )
}
