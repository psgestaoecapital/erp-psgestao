'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'

type Props = { receberId: string; jaTemBoleto: boolean; linhaDigitavel: string | null; onSucesso?: () => void }

export default function GerarBoletoButton({ receberId, jaTemBoleto, linhaDigitavel, onSucesso }: Props) {
  const [busy, setBusy] = useState(false)
  const [linha, setLinha] = useState<string | null>(linhaDigitavel)
  const [copiou, setCopiou] = useState(false)
  // Erro na TELA, não em alert() — depois de alguns alerts o navegador some com o diálogo e o
  // botão parece travar sem dizer nada. Inline, a mensagem do banco fica visível.
  const [erro, setErro] = useState<string | null>(null)

  if (jaTemBoleto || linha) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span title="Boleto registrado" style={{ fontSize: 10, color: '#3F8D3F', fontWeight: 600 }}>✓ Boleto</span>
        {linha && (
          <button
            type="button"
            onClick={() => { navigator.clipboard.writeText(linha); setCopiou(true); setTimeout(() => setCopiou(false), 1500) }}
            title={linha}
            style={{ background: '#FAF7F2', color: '#3D2314', border: '0.5px solid rgba(61,35,20,0.18)', padding: '3px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            {copiou ? 'Copiado!' : 'Linha digitavel'}
          </button>
        )}
      </div>
    )
  }

  const gerar = async () => {
    setBusy(true)
    setErro(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const r = await fetch('/api/banco/bradesco/registrar-boleto', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': session ? `Bearer ${session.access_token}` : '',
        },
        body: JSON.stringify({ receber_id: receberId }),
      })
      const j = await r.json()
      if (!j.ok) { setErro(j.erro || 'Falha ao gerar boleto'); return }
      setLinha(j.linha_digitavel as string)
      onSucesso?.()
    } catch (e) {
      setErro((e as Error).message || 'Erro ao gerar boleto')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <button
        type="button"
        onClick={gerar}
        disabled={busy}
        style={{ background: '#C8941A', color: '#3D2314', border: 'none', padding: '4px 10px', borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: busy ? 'wait' : 'pointer', whiteSpace: 'nowrap', opacity: busy ? 0.6 : 1 }}>
        {busy ? 'Gerando…' : erro ? 'Tentar de novo' : 'Gerar boleto'}
      </button>
      {erro && (
        <div role="alert" style={{ fontSize: 10.5, lineHeight: 1.4, color: '#991B1B', background: '#FEF2F2', border: '0.5px solid rgba(153,27,27,0.25)', borderRadius: 4, padding: '5px 7px', maxWidth: 340, whiteSpace: 'normal' }}>
          {erro}
        </div>
      )}
    </div>
  )
}
