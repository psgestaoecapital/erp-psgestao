'use client'

// RD-41 · Modal reutilizável de assinatura tipada da OS (checklist_ciente / entrega).
// Reusa AssinaturaCanvas (captura) + fn_os_assinar(os, base64, tipo). Operacional puro.
// Mobile/tablet-first: o cliente assina na tela. Rótulos claros por tipo.
import { useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { X } from 'lucide-react'
import AssinaturaCanvas, { type AssinaturaCanvasHandle } from '@/components/comum/AssinaturaCanvas'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', ESP60 = 'rgba(61,35,20,0.55)'

export default function AssinaturaModal({ osId, tipo, titulo, subtitulo, aberto, onFechar, onAssinado }: {
  osId: string
  tipo: 'checklist_ciente' | 'entrega'
  titulo: string
  subtitulo: string
  aberto: boolean
  onFechar: () => void
  onAssinado?: () => void
}) {
  const ref = useRef<AssinaturaCanvasHandle | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  if (!aberto) return null

  const confirmar = async () => {
    const c = ref.current
    if (!c || c.isEmpty()) { setErro('Peça para o cliente assinar na tela.'); return }
    setSalvando(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_os_assinar', { p_os_id: osId, p_assinatura_base64: c.toDataURL(), p_tipo: tipo })
    setSalvando(false)
    const j = data as { ok?: boolean; erro?: string } | null
    if (error || !j?.ok) { setErro(error?.message || j?.erro || 'Falha ao salvar a assinatura'); return }
    onAssinado?.(); onFechar()
  }

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onFechar() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.45)', zIndex: 130, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div style={{ background: BG, borderRadius: '16px 16px 0 0', padding: 16, width: '100%', maxWidth: 560 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 800, color: ESP }}>{titulo}</div>
            <div style={{ fontSize: 13, color: ESP60, marginTop: 2 }}>{subtitulo}</div>
          </div>
          <button onClick={onFechar} style={{ background: 'none', border: 'none', cursor: 'pointer', color: ESP60 }}><X size={22} /></button>
        </div>

        <div style={{ marginTop: 12, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: 8 }}>
          <AssinaturaCanvas ref={ref} height={170} />
        </div>

        {erro && <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, background: '#FCEBEB', color: '#791F1F', fontSize: 13 }}>{erro}</div>}

        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button onClick={() => ref.current?.clear()} style={{ flex: 1, padding: '12px', borderRadius: 10, border: `1px solid ${LINE}`, background: '#fff', color: ESP, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Limpar</button>
          <button onClick={() => void confirmar()} disabled={salvando}
            style={{ flex: 2, padding: '12px', borderRadius: 10, border: 'none', background: GOLD, color: '#1A1410', fontWeight: 700, cursor: salvando ? 'default' : 'pointer', opacity: salvando ? 0.6 : 1 }}>
            {salvando ? 'Salvando…' : 'Confirmar assinatura'}
          </button>
        </div>
        <button onClick={onFechar} style={{ width: '100%', marginTop: 8, padding: '10px', fontSize: 13, color: ESP60, background: 'transparent', border: 'none', cursor: 'pointer' }}>Agora não</button>
      </div>
    </div>
  )
}
