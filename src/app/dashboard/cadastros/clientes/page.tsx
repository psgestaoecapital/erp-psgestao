'use client'

import { useState } from 'react'
import { useCompanyIds } from '@/lib/useCompanyIds'
import PessoasList from '@/components/cadastros/PessoasList'
import SolicitarContratoModal from '@/components/ge/SolicitarContratoModal'

export default function Page() {
  const { companyIds, selInfo } = useCompanyIds()
  const empresaUnica =
    selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : null
  // #59 PDOIS parte 2: entrada "Solicitar elaboração de contrato" a partir do cadastro de clientes
  const [solicitar, setSolicitar] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  if (!empresaUnica) {
    return <div style={{ padding: 32, color: '#A32D2D', background: '#FAF7F2', minHeight: '100vh' }}>Selecione uma empresa para gerenciar clientes.</div>
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '12px 16px 0' }}>
        <button type="button" onClick={() => setSolicitar(true)}
          style={{ background: '#C8941A', color: '#fff', border: 'none', padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
          🧾 Solicitar elaboração de contrato
        </button>
      </div>
      <PessoasList companyId={empresaUnica} tipo="cliente" />
      {solicitar && (
        <SolicitarContratoModal companyId={empresaUnica} onClose={() => setSolicitar(false)}
          onSolicitado={(r) => { setSolicitar(false); setToast(`Contrato solicitado${r.numero ? ` (nº ${r.numero})` : ''}. Veja em Contratos → Solicitações & Fee.`) }} />
      )}
      {toast && (
        <div style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: '#3D2314', color: '#fff', padding: '10px 18px', borderRadius: 8, fontSize: 13, zIndex: 2000 }} onClick={() => setToast(null)}>{toast}</div>
      )}
    </>
  )
}
