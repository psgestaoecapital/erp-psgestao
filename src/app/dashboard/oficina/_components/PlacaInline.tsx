'use client'
// Placa na lista da Oficina: mostra a placa em destaque OU "Sem placa" + informar a placa ali mesmo.
// OS antiga sem placa aparecia como "—" (indistinguível) e não gerava veículo. RD-26: um só componente.
import React, { useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'

const ESP = '#3D2314'; const GOLD = '#C8941A'; const LINE = '#E7DECF'; const ESP60 = 'rgba(61,35,20,0.55)'

export function PlacaInline({ companyId, osId, placa, onSaved }: {
  companyId: string; osId: string; placa: string | null; onSaved: (nova: string) => void
}) {
  const [editando, setEditando] = useState(false)
  const [valor, setValor] = useState('')
  const [salvando, setSalvando] = useState(false)

  if (placa && placa.trim()) {
    return <span style={{ fontWeight: 800, fontSize: 16, letterSpacing: 1 }}>{placa}</span>
  }

  if (!editando) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontWeight: 700, fontSize: 13, color: ESP60 }}>Sem placa</span>
        <button
          onClick={(e) => { e.stopPropagation(); setEditando(true) }}
          style={{ border: `1px solid ${LINE}`, background: '#fff', borderRadius: 999, padding: '2px 8px', fontSize: 11, fontWeight: 700, color: GOLD, cursor: 'pointer' }}
        >informar</button>
      </span>
    )
  }

  const salvar = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (valor.replace(/[^A-Za-z0-9]/g, '').length < 5) return
    setSalvando(true)
    const { data } = await supabase.rpc('fn_oficina_os_set_placa', { p_company_id: companyId, p_os_id: osId, p_placa: valor })
    setSalvando(false)
    const j = data as { ok?: boolean; placa?: string } | null
    if (j?.ok && j.placa) { setEditando(false); onSaved(j.placa) }
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={(e) => e.stopPropagation()}>
      <input
        value={valor}
        onChange={(e) => setValor(e.target.value.toUpperCase())}
        placeholder="ABC1D23" autoFocus
        style={{ width: 96, padding: '4px 8px', border: `1px solid ${GOLD}`, borderRadius: 8, fontSize: 14, fontWeight: 700, letterSpacing: 1, textAlign: 'center', color: ESP, outline: 'none', fontFamily: 'inherit' }}
      />
      <button onClick={salvar} disabled={salvando} style={{ border: 'none', background: GOLD, color: ESP, borderRadius: 8, padding: '5px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{salvando ? '…' : 'OK'}</button>
    </span>
  )
}

export const placaSec: CSSProperties = { fontSize: 12, color: ESP60, marginTop: 2 }
