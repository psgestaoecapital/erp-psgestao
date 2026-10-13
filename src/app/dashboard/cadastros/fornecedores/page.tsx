'use client'

import { useCompanyIds } from '@/lib/useCompanyIds'
import PessoasList from '@/components/cadastros/PessoasList'

export default function Page() {
  const { companyIds, selInfo } = useCompanyIds()
  const empresaUnica =
    selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : null

  if (!empresaUnica) {
    return <div style={{ padding: 32, color: '#A32D2D', background: '#FAF7F2', minHeight: '100vh' }}>Selecione uma empresa para gerenciar fornecedores.</div>
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap', padding: '12px 16px 0' }}>
        <a href="/modelos/MODELO_importacao_cadastros_PS_fornecedores.xlsx" download
          style={{ border: '1px solid #C8941A', color: '#C8941A', background: '#fff', padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700, textDecoration: 'none' }}>
          ⬇ Baixar planilha modelo
        </a>
        <a href="/dashboard/cadastros/fornecedores/importar"
          style={{ border: '1px solid #3D2314', color: '#3D2314', background: '#fff', padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700, textDecoration: 'none' }}>
          ⬆ Importar planilha
        </a>
      </div>
      <PessoasList companyId={empresaUnica} tipo="fornecedor" />
    </>
  )
}
