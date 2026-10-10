'use client'

import { useState } from 'react'
import { useCompanyIds } from '@/lib/useCompanyIds'
import PessoasList from '@/components/cadastros/PessoasList'
import SolicitarContratoModal from '@/components/ge/SolicitarContratoModal'
import UnificarDuplicadosModal from '@/components/cadastros/UnificarDuplicadosModal'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

export default function Page() {
  const { companyIds, selInfo } = useCompanyIds()
  const empresaUnica =
    selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : null
  // #59 PDOIS parte 2: entrada "Solicitar elaboração de contrato" a partir do cadastro de clientes
  const [solicitar, setSolicitar] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  // caixa jordana-code 3352399e (item 3): unificar cadastros com o mesmo CNPJ/CPF; a lista recarrega depois (key)
  const [unificar, setUnificar] = useState(false)
  const [versaoLista, setVersaoLista] = useState(0)

  if (!empresaUnica) {
    return <div style={{ padding: 32, color: '#A32D2D', background: '#FAF7F2', minHeight: '100vh' }}>Selecione uma empresa para gerenciar clientes.</div>
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap', padding: '12px 16px 0' }}>
        <a href="/modelos/MODELO_importacao_cadastros_PS_clientes.xlsx" download
          style={{ border: '1px solid #C8941A', color: '#C8941A', background: '#fff', padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700, textDecoration: 'none' }}>
          ⬇ Baixar planilha modelo
        </a>
        <a href="/dashboard/cadastros/clientes/importar"
          style={{ border: '1px solid #3D2314', color: '#3D2314', background: '#fff', padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700, textDecoration: 'none' }}>
          ⬆ Importar planilha
        </a>
        <button type="button" onClick={() => setSolicitar(true)}
          style={{ background: '#C8941A', color: '#fff', border: 'none', padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
          🧾 Solicitar elaboração de contrato
        </button>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <button type="button" onClick={() => setUnificar(true)} data-testid="abrir-unificar-duplicados"
            style={{ border: '1px solid #3D2314', color: '#3D2314', background: '#fff', padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            🔗 CNPJ/CPF repetido
          </button>
          <AjudaCampo chave="cadastros.clientes.duplicados" rota="/dashboard/cadastros/clientes" />
        </span>
      </div>
      <PessoasList key={versaoLista} companyId={empresaUnica} tipo="cliente" />
      {solicitar && (
        <SolicitarContratoModal companyId={empresaUnica} onClose={() => setSolicitar(false)}
          onSolicitado={(r) => { setSolicitar(false); setToast(`Contrato solicitado${r.numero ? ` (nº ${r.numero})` : ''}. Veja em Contratos → Solicitações & Fee.`) }} />
      )}
      {unificar && (
        <UnificarDuplicadosModal companyId={empresaUnica} onClose={() => setUnificar(false)} onUnificado={() => setVersaoLista((v) => v + 1)} />
      )}
      {toast && (
        <div style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: '#3D2314', color: '#fff', padding: '10px 18px', borderRadius: 8, fontSize: 13, zIndex: 2000 }} onClick={() => setToast(null)}>{toast}</div>
      )}
    </>
  )
}
