'use client'
// Modal "Capacidade ideal" do piquete — fonte única da lotação (erp_pec_area · RD-52).
// Reusado na Pasto & Lotação e na aba Piquetes (Rebanho & Cadastro): mesma lógica, zero duplicação.
// Forrageira → pré-preenche o UA/ha (ua_ha_sugerido) e recalcula a UA total; a sugestão não trava.
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

const ESP = '#3D2314', GOLD = '#C8941A', LINE = '#E7DECF', ESP60 = 'rgba(61,35,20,0.6)'
const r2 = (n: number) => Math.round(n * 100) / 100

export type Forrageira = { id: string; nome: string; ua_ha_sugerido: number | null; observacao?: string | null }
export type CapArea = { id: string; nome: string; area_ha: number | null; capacidade_ua: number | null; forrageira_id?: string | null }

export default function CapacidadeIdealModal({
  companyId, area, forrageiras: forrProp, onClose, onSaved,
}: {
  companyId: string
  area: CapArea
  forrageiras?: Forrageira[] // se não vier, o modal busca sozinho (fn_pec_forrageira_listar)
  onClose: () => void
  onSaved: (msg: string) => void
}) {
  const ha = Number(area.area_ha) || 0
  const ua0 = Number(area.capacidade_ua) || 0
  const [forrageiras, setForrageiras] = useState<Forrageira[]>(forrProp ?? [])
  const [uaHa, setUaHa] = useState(ua0 && ha > 0 ? String(r2(ua0 / ha)) : '')
  const [uaTotal, setUaTotal] = useState(ua0 ? String(ua0) : '')
  const [forr, setForr] = useState(area.forrageira_id ?? '')
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    if (forrProp) { setForrageiras(forrProp); return }
    let alive = true
    void supabase.rpc('fn_pec_forrageira_listar', { p_company_id: companyId }).then(({ data }) => {
      if (alive) setForrageiras(((data as { forrageiras?: Forrageira[] } | null)?.forrageiras) ?? [])
    })
    return () => { alive = false }
  }, [companyId, forrProp])

  const onUaHa = (v: string) => { setUaHa(v); const n = parseFloat(v.replace(',', '.')); setUaTotal(!isNaN(n) && ha > 0 ? String(r2(n * ha)) : '') }
  const onUaTotal = (v: string) => { setUaTotal(v); const n = parseFloat(v.replace(',', '.')); setUaHa(!isNaN(n) && ha > 0 ? String(r2(n / ha)) : '') }
  const onForr = (fid: string) => {
    setForr(fid)
    const f = forrageiras.find((x) => x.id === fid)
    if (f?.ua_ha_sugerido != null) { setUaHa(String(f.ua_ha_sugerido)); setUaTotal(ha > 0 ? String(r2(Number(f.ua_ha_sugerido) * ha)) : '') }
  }
  const salvar = async () => {
    const ua = parseFloat(String(uaTotal).replace(',', '.'))
    if (isNaN(ua) || ua < 0) { setErro('Informe a capacidade (UA/ha ou UA total).'); return }
    setBusy(true); setErro(null)
    try {
      const { data } = await supabase.rpc('fn_pec_area_capacidade_salvar', { p_company_id: companyId, p_area_id: area.id, p_capacidade_ua: ua, p_forrageira_id: forr || null })
      const r = data as { ok?: boolean; erro?: string; ua_ha?: number }
      if (r?.ok === false) throw new Error(r.erro || 'falha')
      onSaved(`Capacidade ALTERADA — ${area.nome}: ${ua} UA${r?.ua_ha != null ? ` (${r.ua_ha} UA/ha)` : ''}.`)
    } catch (e) { setErro((e as Error).message) } finally { setBusy(false) }
  }

  const inpStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box', marginTop: 3, padding: '8px 10px', border: `1px solid ${LINE}`, borderRadius: 8, fontSize: 14, color: ESP, background: '#fff' }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 70 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: 18, width: '100%', maxWidth: 380 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: ESP }}>Capacidade ideal — {area.nome}</div>
        <div style={{ fontSize: 12, color: ESP60, margin: '2px 0 12px' }}>Área {area.area_ha ?? '—'} ha · fonte da lotação (muda aqui, muda em todo lugar).</div>
        <label style={{ fontSize: 11, color: ESP60, display: 'block', marginBottom: 10 }}>Forrageira (define o UA/ha de referência)
          <select value={forr} onChange={(e) => onForr(e.target.value)} style={inpStyle}>
            <option value="">— não informada —</option>
            {forrageiras.map((f) => <option key={f.id} value={f.id}>{f.nome}{f.ua_ha_sugerido != null ? ` (${f.ua_ha_sugerido} UA/ha)` : ''}</option>)}
          </select>
          {forrageiras.length === 0 && <span style={{ fontSize: 10, color: ESP60 }}>Nenhuma forrageira cadastrada — cadastre em Pasto &amp; Lotação.</span>}
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label style={{ fontSize: 11, color: ESP60 }}>UA/ha
            <input type="number" step="0.1" value={uaHa} onChange={(e) => onUaHa(e.target.value)} placeholder="ex.: 2,0" style={inpStyle} /></label>
          <label style={{ fontSize: 11, color: ESP60 }}>UA total
            <input type="number" step="0.1" value={uaTotal} onChange={(e) => onUaTotal(e.target.value)} placeholder="ex.: 10" style={inpStyle} /></label>
        </div>
        <div style={{ fontSize: 10.5, color: ESP60, marginTop: 8 }}>Digite um — o outro é calculado pela área. A forrageira sugere o UA/ha; você pode ajustar (a sugestão não trava).</div>
        {erro && <div style={{ fontSize: 12, color: '#B91C1C', marginTop: 8 }}>❌ {erro}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ background: 'transparent', color: ESP60, border: `1px solid ${LINE}`, borderRadius: 8, padding: '8px 14px', fontSize: 13, cursor: 'pointer' }}>Cancelar</button>
          <button onClick={salvar} disabled={busy} style={{ background: GOLD, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: busy ? 'wait' : 'pointer' }}>{busy ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </div>
    </div>
  )
}
