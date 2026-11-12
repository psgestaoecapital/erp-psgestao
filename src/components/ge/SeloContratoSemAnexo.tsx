'use client'

// P2/Pdois (CEO 11/11) · parte visível do item 2 do pedido de contrato:
// quando a empresa NÃO exige o anexo para ativar (erp_contratos_config.exigir_contrato_anexado = false),
// o contrato pode ficar ATIVO sem o contrato assinado anexado. Para não perder de vista, mostramos um
// selo/aviso permanente "Contrato não anexado" — no contrato, na lista e no financeiro — com atalho para anexar,
// até que alguém anexe. É só um lembrete: não bloqueia nada.
//
// Condição de exibição (decidida por quem usa): contrato ATIVO e sem anexo assinado
// (erp_contratos_arquivos com tipo 'contrato'/'contrato_assinado'). Design system PS (RD-96): âmbar discreto, próprio.

const COR = { bg: '#FCF4E6', borda: '#E8C784', texto: '#8A5A12', textoForte: '#6B4410' }

/** Banner (contrato e financeiro): linha de aviso com botão opcional "Anexar". */
export function SeloContratoSemAnexoBanner({ onAnexar }: { onAnexar?: () => void }) {
  return (
    <div
      role="status"
      title="Este contrato está ativo sem o contrato assinado anexado. Anexe o PDF/imagem assinado para manter o histórico completo. O aviso some quando o anexo for adicionado."
      style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        background: COR.bg, border: `1px solid ${COR.borda}`, borderRadius: 8,
        padding: '10px 14px', fontSize: 12.5, color: COR.textoForte,
      }}
    >
      <span aria-hidden style={{ fontSize: 15, lineHeight: 1 }}>⚠️</span>
      <span style={{ fontWeight: 700 }}>Contrato não anexado</span>
      <span style={{ color: COR.texto }}>— este contrato foi ativado sem o contrato assinado.</span>
      {onAnexar && (
        <button
          type="button"
          onClick={onAnexar}
          style={{
            marginLeft: 'auto', background: '#C8941A', color: '#FFFFFF', border: 'none',
            padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer',
          }}
        >
          Anexar
        </button>
      )}
    </div>
  )
}

/** Chip compacto (linhas de lista): pílula âmbar. */
export function SeloContratoSemAnexoChip() {
  return (
    <span
      title="Contrato ativo sem o contrato assinado anexado. Abra o contrato para anexar."
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        background: COR.bg, border: `1px solid ${COR.borda}`, color: COR.textoForte,
        borderRadius: 999, padding: '2px 9px', fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap',
      }}
    >
      <span aria-hidden>⚠️</span> Sem anexo
    </span>
  )
}
