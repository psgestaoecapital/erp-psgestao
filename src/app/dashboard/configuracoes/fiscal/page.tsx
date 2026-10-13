import FiscalConfigClient from './FiscalConfigClient'

export const dynamic = 'force-dynamic'

export default function FiscalConfigPage() {
  return (
    <div className="min-h-screen bg-[#FAF7F2]">
      <div className="max-w-5xl mx-auto px-4 py-6 sm:py-8">
        <header className="mb-6">
          <div className="text-[11px] text-[#3D2314]/60 tracking-[1px] uppercase font-medium mb-1">
            Configurações · Gestão Empresarial
          </div>
          <h1 className="text-[24px] sm:text-[28px] font-medium text-[#3D2314] leading-tight">
            Configuração Fiscal
          </h1>
          <p className="text-[13px] text-[#3D2314]/70 mt-1.5 max-w-3xl">
            Configure o certificado digital A1 e o emissor de notas (NFSe Nacional gov.br ou
            Focus NFe) pra emitir NFSe / NFe e receber notas por Manifestação do Destinatário.
          </p>
        </header>
        <FiscalConfigClient />
      </div>
    </div>
  )
}
