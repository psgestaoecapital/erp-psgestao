'use client'
import { type CSSProperties } from 'react'
import { SECTIONS, fmt, brl } from './fields'

type Row = Record<string, unknown> & {
  banco?: string | null
  contrato?: string | null
  tipo_operacao?: string | null
  saldo_devedor?: number | null
  saldo_total_parcelas?: number | null
}

interface Props {
  row: Row
  onEdit: () => void
  onClose: () => void
  onGerarPagar: () => void
}

export default function FinanciamentoDetalhe({ row, onEdit, onClose, onGerarPagar }: Props) {
  const isConsorcio = row.tipo_operacao === 'consorcio'
  const juros = Math.max(
    (Number(row.saldo_total_parcelas) || 0) - (Number(row.saldo_devedor) || 0),
    0
  )

  return (
    <div style={overlay}>
      <div style={card}>
        <div style={head}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#3D2314', margin: 0 }}>
            {row.banco ?? '—'} · {row.contrato ?? 's/ nº'}
          </h2>
          <button onClick={onClose} style={closeBtn} aria-label="Fechar">✕</button>
        </div>
        <p style={{ fontSize: 12, color: '#8a8178', marginBottom: 12 }}>
          Juros embutidos a pagar: <b>{brl(juros)}</b>
        </p>
        {SECTIONS.filter((s) => !s.soConsorcio || isConsorcio).map((sec) => (
          <div key={sec.id} style={{ marginBottom: 14 }}>
            <div style={secHead}>{sec.label}</div>
            <div style={grid}>
              {sec.fields.map((fd) => (
                <div key={fd.key} style={{ fontSize: 13 }}>
                  <span style={{ color: '#8a8178', fontSize: 11, display: 'block' }}>{fd.label}</span>
                  <span style={{ color: '#3a352f' }}>{fmt(fd, row[fd.key])}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
        <div style={hint}>Garantias alocáveis chegam na próxima entrega (F2b).</div>
        <div style={actions}>
          <button onClick={onGerarPagar} style={btnGhost}>Gerar contas a pagar</button>
          <button onClick={onEdit} style={btnPrimary}>Editar</button>
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
  marginBottom: 4,
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
  marginBottom: 6,
  borderBottom: '1px solid #efe9e2',
  paddingBottom: 4,
}
const grid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: 8,
}
const hint: CSSProperties = {
  fontSize: 12,
  color: '#8a8178',
  padding: '8px 0',
  borderTop: '1px dashed #E7DED3',
  marginTop: 8,
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
