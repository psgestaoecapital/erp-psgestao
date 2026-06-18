'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'

type Field = {
  key: string
  label: string
  type: 'text' | 'number' | 'date' | 'bool' | 'select'
  opts?: string[]
}

const FIELDS: Field[] = [
  { key: 'banco', label: 'Banco', type: 'text' },
  { key: 'contrato', label: 'Contrato', type: 'text' },
  { key: 'modalidade', label: 'Modalidade', type: 'text' },
  { key: 'tipo', label: 'Tipo', type: 'text' },
  { key: 'valor_original', label: 'Valor de origem', type: 'number' },
  { key: 'valor_liquido', label: 'Valor líquido', type: 'number' },
  { key: 'saldo_devedor', label: 'Saldo de quitação', type: 'number' },
  { key: 'saldo_total_parcelas', label: 'Saldo total em parcelas', type: 'number' },
  { key: 'valor_parcela', label: 'Parcela atual', type: 'number' },
  { key: 'parcela_futura', label: 'Parcela futura (pós-carência)', type: 'number' },
  { key: 'parcelas', label: 'Parcelas totais', type: 'number' },
  { key: 'parcelas_restantes', label: 'Parcelas restantes', type: 'number' },
  { key: 'taxa_mensal', label: 'Taxa a.m. (%)', type: 'number' },
  { key: 'taxa_anual', label: 'Taxa a.a. (%)', type: 'number' },
  { key: 'data_origem', label: 'Data de origem', type: 'date' },
  { key: 'data_posicao', label: 'Data da posição', type: 'date' },
  { key: 'vencimento', label: 'Vencimento final', type: 'text' },
  { key: 'em_carencia', label: 'Em carência', type: 'bool' },
  { key: 'garantia', label: 'Garantia', type: 'text' },
  { key: 'status', label: 'Status', type: 'select', opts: ['ativo', 'quitado', 'encerrado'] },
  { key: 'situacao', label: 'Situação', type: 'text' },
  { key: 'fonte_verificacao', label: 'Fonte / verificação', type: 'text' },
  { key: 'observacao', label: 'Observação', type: 'text' },
]

type FormState = Record<string, string | number | boolean | null>

interface Props {
  companyId: string
  initial?: Partial<FormState> & { id?: string }
  onClose: () => void
  onSaved: () => void
}

export default function FinanciamentoFormModal({ companyId, initial, onClose, onSaved }: Props) {
  const [form, setForm] = useState<FormState>(
    (initial as FormState) ?? { status: 'ativo', em_carencia: false }
  )
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const isEdit = !!initial?.id

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

  return (
    <div style={overlay}>
      <div style={card}>
        <div style={head}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#3D2314', margin: 0 }}>
            {isEdit ? 'Editar contrato' : 'Novo contrato'}
          </h2>
          <button onClick={onClose} style={closeBtn} aria-label="Fechar">✕</button>
        </div>
        <div style={grid}>
          {FIELDS.map((fd) => {
            const value = form[fd.key]
            return (
              <label key={fd.key} style={lbl}>
                {fd.label}
                {fd.type === 'bool' ? (
                  <input
                    type="checkbox"
                    checked={!!value}
                    onChange={(e) => set(fd.key, e.target.checked)}
                  />
                ) : fd.type === 'select' ? (
                  <select
                    value={(value as string) ?? ''}
                    onChange={(e) => set(fd.key, e.target.value)}
                    style={inp}
                  >
                    {fd.opts!.map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={fd.type === 'number' ? 'number' : fd.type === 'date' ? 'date' : 'text'}
                    value={(value as string | number | null) ?? ''}
                    onChange={(e) =>
                      set(
                        fd.key,
                        fd.type === 'number'
                          ? e.target.value === '' ? null : Number(e.target.value)
                          : e.target.value
                      )
                    }
                    style={inp}
                  />
                )}
              </label>
            )
          })}
        </div>
        {err && <p style={{ color: '#b00', fontSize: 13, marginTop: 12 }}>Erro: {err}</p>}
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

const overlay: React.CSSProperties = {
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
const card: React.CSSProperties = {
  background: '#fff',
  borderRadius: 16,
  padding: 20,
  width: '100%',
  maxWidth: 720,
}
const head: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 16,
}
const closeBtn: React.CSSProperties = {
  border: 'none',
  background: 'none',
  fontSize: 20,
  cursor: 'pointer',
  minWidth: 44,
  minHeight: 44,
}
const grid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
  gap: 12,
}
const lbl: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 12,
  color: '#6b6b6b',
}
const inp: React.CSSProperties = {
  border: '1px solid #E7DED3',
  borderRadius: 8,
  padding: '8px 10px',
  fontSize: 13,
  minHeight: 40,
}
const actions: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  justifyContent: 'flex-end',
  marginTop: 20,
}
const btnGhost: React.CSSProperties = {
  border: '1px solid #E7DED3',
  background: '#fff',
  borderRadius: 10,
  padding: '10px 16px',
  cursor: 'pointer',
  minHeight: 44,
}
const btnPrimary: React.CSSProperties = {
  border: 'none',
  background: '#C8941A',
  color: '#fff',
  borderRadius: 10,
  padding: '10px 16px',
  cursor: 'pointer',
  fontWeight: 600,
  minHeight: 44,
}
