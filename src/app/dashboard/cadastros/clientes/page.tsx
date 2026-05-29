'use client'

import { useCompanyIds } from '@/lib/useCompanyIds'
import PessoasList from '@/components/cadastros/PessoasList'

export default function Page() {
  const { companyIds, selInfo } = useCompanyIds()
  const empresaUnica =
    selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : null

  if (!empresaUnica) {
    return <div style={{ padding: 32, color: '#A32D2D', background: '#FAF7F2', minHeight: '100vh' }}>Selecione uma empresa para gerenciar clientes.</div>
  }

  return <PessoasList companyId={empresaUnica} tipo="cliente" />
}
