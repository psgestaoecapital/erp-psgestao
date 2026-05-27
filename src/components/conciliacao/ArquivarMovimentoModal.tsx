'use client'

// ArquivarMovimentoModal · Sub-frente 4.2 Onda 4 (CEO 27/05/2026)
// Chama fn_conciliacao_arquivar_movimento(movimento_id, motivo).

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface Props {
  open: boolean
  onClose: () => void
  onSucesso: () => void
  movimentoId: string
  descricao?: string
}

const SUGESTOES = [
  'Transferência interna',
  'Estorno',
  'Erro do banco',
  'Movimento não precisa conciliar',
  'Outro',
] as const

export default function ArquivarMovimentoModal({ open, onClose, onSucesso, movimentoId, descricao }: Props) {
  const [escolha, setEscolha] = useState<string>(SUGESTOES[3])
  const [motivoLivre, setMotivoLivre] = useState('')
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    if (open) { setEscolha(SUGESTOES[3]); setMotivoLivre(''); setErro(null) }
  }, [open])

  async function confirmar() {
    const motivoFinal = escolha === 'Outro' ? motivoLivre.trim() : escolha
    if (!motivoFinal) { setErro('Descreva o motivo'); return }
    setLoading(true)
    const { error } = await supabase.rpc('fn_conciliacao_arquivar_movimento', {
      p_movimento_id: movimentoId,
      p_motivo: motivoFinal,
    })
    setLoading(false)
    if (error) { setErro(error.message); return }
    onSucesso()
    onClose()
  }

  if (!open) return null

  return (
    <div onClick={onClose} style={overlay}>
      <div onClick={(e) => e.stopPropagation()} style={modal}>
        <h2 style={h2}>Arquivar movimento</h2>
        {descricao && <p style={{ fontSize: 12, color: 'rgba(61,35,20,0.65)', marginTop: 4, marginBottom: 14 }}>{descricao}</p>}

        <div style={{ fontSize: 10, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 600, marginBottom: 6 }}>
          Por que arquivar?
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
          {SUGESTOES.map((s) => (
            <label key={s} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#3D2314', cursor: 'pointer' }}>
              <input type="radio" name="motivo" value={s} checked={escolha === s} onChange={() => setEscolha(s)} />
              {s}
            </label>
          ))}
        </div>

        {escolha === 'Outro' && (
          <textarea
            value={motivoLivre}
            onChange={(e) => setMotivoLivre(e.target.value)}
            placeholder="Descreva o motivo do arquivamento"
            rows={3}
            style={input}
          />
        )}

        {erro && <div style={erroBox}>{erro}</div>}

        <div style={{ display: 'flex', gap: 8, marginTop: 18, justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={loading} style={secondaryBtn(loading)}>Cancelar</button>
          <button onClick={confirmar} disabled={loading} style={primaryBtn(loading)}>
            {loading ? 'Arquivando…' : 'Arquivar movimento'}
          </button>
        </div>
      </div>
    </div>
  )
}

const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }
const modal: React.CSSProperties = { background: '#FFFFFF', borderRadius: 12, padding: 24, maxWidth: 440, width: '100%' }
const h2: React.CSSProperties = { fontFamily: 'Fraunces, Georgia, serif', fontSize: 20, fontWeight: 400, color: '#3D2314', margin: 0 }
const input: React.CSSProperties = { width: '100%', background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.2)', borderRadius: 6, padding: '8px 10px', fontSize: 13, color: '#3D2314', fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical' as const }
const erroBox: React.CSSProperties = { background: '#FCEBEB', color: '#A32D2D', padding: '8px 12px', borderRadius: 6, fontSize: 12, marginTop: 8 }
function primaryBtn(loading: boolean): React.CSSProperties {
  return { background: loading ? 'rgba(200,148,26,0.5)' : '#C8941A', color: '#3D2314', border: 'none', padding: '10px 18px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: loading ? 'wait' : 'pointer' }
}
function secondaryBtn(disabled: boolean): React.CSSProperties {
  return { background: 'transparent', color: '#3D2314', border: '0.5px solid rgba(61,35,20,0.2)', padding: '10px 18px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer' }
}
