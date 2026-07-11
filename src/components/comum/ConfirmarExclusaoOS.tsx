'use client'

// CRUD-OS · Modal de confirmação ELEGANTE (paleta PS) — nunca confirm() do browser.
// Decide sozinho entre EXCLUIR (soft-delete) e CANCELAR (OS já faturada):
//   • faturada=true  → CANCELA (exige motivo). Não fura o financeiro.
//   • faturada=false → EXCLUI  (motivo opcional). Soft-delete, dá pra auditar.
// A decisão real é do servidor (fn_os_excluir); aqui é só a UX correspondente.

import { useState } from 'react'

const C = {
  espresso: '#3D2314', espressoM: '#6B5D4F', espressoL: '#9C8E80',
  white: '#FFFFFF', cream: '#F0ECE3', border: '#E0D8CC',
  red: '#DC2626', redBg: '#FEE2E2', amber: '#C8941A', amberBg: '#FFF8E1',
}

const inp: React.CSSProperties = {
  width: '100%', minHeight: 44, padding: '10px 12px',
  border: `1px solid ${C.border}`, borderRadius: 8,
  fontSize: 13, color: C.espresso, background: C.white, outline: 'none',
}

export default function ConfirmarExclusaoOS({
  numero, faturada, busy, erro, onConfirm, onClose,
}: {
  numero: string | null
  faturada: boolean
  busy?: boolean
  erro?: string | null
  onConfirm: (motivo: string) => void
  onClose: () => void
}) {
  const [motivo, setMotivo] = useState('')
  const num = numero ?? 'OS'
  const podeConfirmar = !busy && (!faturada || motivo.trim().length > 0)

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: C.white, borderRadius: 14, width: '100%', maxWidth: 440, padding: 20, border: `1px solid ${C.border}`, boxShadow: '0 20px 60px rgba(61,35,20,0.28)' }}
        data-testid="os-excluir-modal"
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <span style={{ fontSize: 26 }}>{faturada ? '🚫' : '🗑️'}</span>
          <div style={{ fontSize: 17, fontWeight: 800, color: C.espresso }}>
            {faturada ? `Cancelar a ${num}?` : `Excluir a ${num}?`}
          </div>
        </div>

        {faturada ? (
          <div style={{ background: C.amberBg, border: `1px solid ${C.amber}33`, borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>
            <div style={{ fontSize: 12.5, color: C.espresso, fontWeight: 600, lineHeight: 1.5 }}>
              Esta OS já foi faturada (tem título / lançamento no financeiro).
            </div>
            <div style={{ fontSize: 12, color: C.espressoM, marginTop: 4, lineHeight: 1.5 }}>
              Não dá pra excluir sem furar a contabilidade — em vez disso ela será <strong style={{ color: C.amber }}>CANCELADA</strong> e o histórico fica registrado.
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 13, color: C.espressoM, marginBottom: 12, lineHeight: 1.5 }}>
            A OS sai da lista e some das telas operacionais. <strong style={{ color: C.espresso }}>Não dá pra desfazer.</strong> O registro fiscal é preservado (soft-delete) e a ação fica na trilha de auditoria.
          </div>
        )}

        <label style={{ display: 'block', marginBottom: 14 }}>
          <span style={{ display: 'block', fontSize: 11, color: C.espressoM, fontWeight: 600, marginBottom: 4 }}>
            {faturada ? 'Motivo do cancelamento *' : 'Motivo (opcional)'}
          </span>
          <textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder={faturada ? 'Ex.: cliente desistiu, faturado por engano…' : 'Ex.: OS duplicada, aberta por engano…'}
            style={{ ...inp, minHeight: 60, resize: 'vertical' }}
            data-testid="os-excluir-motivo"
            autoFocus
          />
        </label>

        {erro && (
          <div style={{ background: C.redBg, color: C.red, padding: '8px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, marginBottom: 12 }}>
            ❌ {erro}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            style={{ minHeight: 44, padding: '10px 16px', borderRadius: 10, border: `1px solid ${C.border}`, background: C.white, color: C.espressoM, fontSize: 13, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer' }}
          >
            Voltar
          </button>
          <button
            type="button"
            onClick={() => onConfirm(motivo.trim())}
            disabled={!podeConfirmar}
            data-testid="os-excluir-confirmar"
            style={{
              minHeight: 44, padding: '10px 18px', borderRadius: 10, border: 'none',
              background: podeConfirmar ? C.red : C.cream,
              color: podeConfirmar ? C.white : C.espressoL,
              fontSize: 13, fontWeight: 800, cursor: podeConfirmar ? 'pointer' : 'not-allowed',
            }}
          >
            {busy ? 'Processando…' : faturada ? 'Cancelar OS' : 'Excluir OS'}
          </button>
        </div>
      </div>
    </div>
  )
}
