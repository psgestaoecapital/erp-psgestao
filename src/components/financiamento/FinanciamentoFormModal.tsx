'use client'
import { useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'
import { SECTIONS, type Field } from './fields'

type FormState = Record<string, string | number | boolean | null>

interface Props {
  companyId: string
  initial?: (Record<string, unknown> & { id?: string }) | null
  onClose: () => void
  onSaved: () => void
}

export default function FinanciamentoFormModal({ companyId, initial, onClose, onSaved }: Props) {
  const [form, setForm] = useState<FormState>(
    (initial as FormState | null | undefined) ?? {
      status: 'ativo',
      tipo_operacao: 'financiamento',
      periodicidade: 'mensal',
      em_carencia: false,
      contemplado: false,
    }
  )
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const isEdit = !!initial?.id
  const isConsorcio = form.tipo_operacao === 'consorcio'

  const set = (k: string, v: string | number | boolean | null) =>
    setForm((f) => ({ ...f, [k]: v }))

  async function save() {
    setSaving(true)
    setErr(null)
    const payload: FormState = { ...form, company_id: companyId }
    const res = isEdit
      ? await supabase.from('financiamentos').update(payload).eq('id', initial!.id!)
      : await supabase.from('financiamentos').insert(payload)
    setSaving(false)
    if (res.error) {
      setErr(res.error.message)
      return
    }
    onSaved()
  }

  const renderInput = (fd: Field) => {
    const value = form[fd.key]
    if (fd.type === 'bool') {
      return (
        <input
          type="checkbox"
          checked={!!value}
          disabled={fd.readOnly}
          onChange={(e) => set(fd.key, e.target.checked)}
        />
      )
    }
    if (fd.type === 'select') {
      return (
        <select
          value={(value as string) ?? ''}
          disabled={fd.readOnly}
          onChange={(e) => set(fd.key, e.target.value)}
          style={inp}
        >
          <option value="">—</option>
          {fd.opts!.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      )
    }
    const t =
      fd.type === 'date' ? 'date' :
      (fd.type === 'number' || fd.type === 'money' || fd.type === 'percent') ? 'number' : 'text'
    const isNum = t === 'number'
    return (
      <input
        type={t}
        value={(value as string | number | null) ?? ''}
        disabled={fd.readOnly}
        onChange={(e) =>
          set(
            fd.key,
            isNum
              ? e.target.value === '' ? null : Number(e.target.value)
              : e.target.value
          )
        }
        style={inp}
      />
    )
  }

  return (
    <div style={overlay}>
      <div style={card}>
        <div style={head}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#3D2314', margin: 0 }}>
            {isEdit ? 'Editar contrato' : 'Novo contrato'}
          </h2>
          <button onClick={onClose} style={closeBtn} aria-label="Fechar">✕</button>
        </div>
        {SECTIONS.filter((s) => !s.soConsorcio || isConsorcio).map((sec) => (
          <div key={sec.id} style={{ marginBottom: 16 }}>
            <div style={secHead}>{sec.label}</div>
            <div style={grid}>
              {sec.fields.map((fd) => (
                <label key={fd.key} style={lbl}>
                  {fd.label}{fd.readOnly ? ' (auto)' : ''}
                  {renderInput(fd)}
                </label>
              ))}
            </div>
          </div>
        ))}
        {err && <p style={{ color: '#b00', fontSize: 13 }}>Erro: {err}</p>}
        <div style={actions}>
          <button onClick={onClose} style={btnGhost}>Cancelar</button>
          <button onClick={save} disabled={saving} style={btnPrimary}>
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  )
}

const overlay: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,.45)',
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'center',
  padding: 16,
  zIndex: 50,
  overflow: 'auto',
}
const card: CSSProperties = {
  background: '#fff',
  borderRadius: 16,
  padding: 20,
  width: '100%',
  maxWidth: 760,
}
const head: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 12,
}
const closeBtn: CSSProperties = {
  border: 'none',
  background: 'none',
  fontSize: 20,
  cursor: 'pointer',
  minWidth: 44,
  minHeight: 44,
}
const secHead: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: '#C8941A',
  marginBottom: 8,
  borderBottom: '1px solid #efe9e2',
  paddingBottom: 4,
}
const grid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: 10,
}
const lbl: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 12,
  color: '#6b6b6b',
}
const inp: CSSProperties = {
  border: '1px solid #E7DED3',
  borderRadius: 8,
  padding: '8px 10px',
  fontSize: 13,
  minHeight: 40,
}
const actions: CSSProperties = {
  display: 'flex',
  gap: 8,
  justifyContent: 'flex-end',
  marginTop: 8,
}
const btnGhost: CSSProperties = {
  border: '1px solid #E7DED3',
  background: '#fff',
  borderRadius: 10,
  padding: '10px 16px',
  cursor: 'pointer',
  minHeight: 44,
}
const btnPrimary: CSSProperties = {
  border: 'none',
  background: '#C8941A',
  color: '#fff',
  borderRadius: 10,
  padding: '10px 16px',
  cursor: 'pointer',
  fontWeight: 600,
  minHeight: 44,
}
