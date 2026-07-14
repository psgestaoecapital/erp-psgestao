'use client'

import { useState } from 'react'
import { FileText } from 'lucide-react'
import NFSePreviewModal from '@/components/fiscal/NFSePreviewModal'

interface Props {
  companyId: string
  erpReceberId: string
  descricao?: string
  valor?: number
  jaEmitida?: boolean
  processando?: boolean
  onSucesso?: () => void
}

export default function EmitirNFSeButton(props: Props) {
  const [open, setOpen] = useState(false)

  if (props.jaEmitida) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10.5px] text-[#3F7012] font-medium px-2 py-0.5 rounded-full bg-[#E8F4DC]"
        title="NFSe ja emitida"
      >
        <FileText size={11} /> NFSe OK
      </span>
    )
  }

  // (b)+(c) RD-51: emissão é assíncrona. Enquanto a prefeitura processa, o botão NÃO
  // pode convidar ao reenvio (foi assim que 1 serviço virou 4 notas). Estado honesto,
  // travado: nem "erro" nem "ok" — "processando, não reemita".
  if (props.processando) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10.5px] text-[#8A5A00] font-medium px-2 py-0.5 rounded-full bg-[#FBEED2]"
        title="⏳ Processando na prefeitura. NÃO reemita — pode levar alguns minutos. Avisamos quando autorizar."
      >
        <FileText size={11} /> ⏳ Processando
      </span>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="ar-emitir-nfse"
        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11.5px] font-medium rounded-md border border-[#C8941A]/45 text-[#633806] bg-[#C8941A]/8 hover:bg-[#C8941A]/15 transition-colors"
        title="Emitir NFSe"
      >
        <FileText size={12} /> NFSe
      </button>
      <NFSePreviewModal
        open={open}
        onClose={() => setOpen(false)}
        companyId={props.companyId}
        erpReceberId={props.erpReceberId}
        descricaoSugerida={props.descricao}
        valor={props.valor}
        onSucesso={() => {
          setOpen(false)
          props.onSucesso?.()
        }}
      />
    </>
  )
}
