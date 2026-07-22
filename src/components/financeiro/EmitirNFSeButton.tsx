'use client'

import { useState } from 'react'
import { FileText, Download, FileCode } from 'lucide-react'
import NFSePreviewModal from '@/components/fiscal/NFSePreviewModal'

interface Props {
  companyId: string
  erpReceberId: string
  descricao?: string
  valor?: number
  jaEmitida?: boolean
  processando?: boolean
  pdfUrl?: string
  xmlUrl?: string
  onSucesso?: () => void
}

export default function EmitirNFSeButton(props: Props) {
  const [open, setOpen] = useState(false)

  if (props.jaEmitida) {
    // Autorizada: chip + segunda via (PDF/XML) — só expõe o que já está no banco.
    return (
      <span className="inline-flex items-center gap-1.5 flex-wrap">
        <span
          className="inline-flex items-center gap-1 text-[10.5px] text-[#3F7012] font-medium px-2 py-0.5 rounded-full bg-[#E8F4DC]"
          title="NFSe ja emitida"
        >
          <FileText size={11} /> NFSe OK
        </span>
        {props.pdfUrl && (
          <a href={props.pdfUrl} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[10.5px] font-medium px-2 py-0.5 rounded-md border border-[#C8941A]/40 text-[#633806] bg-[#C8941A]/8 hover:bg-[#C8941A]/15 transition-colors"
            title="Baixar PDF da NFSe">
            <Download size={10} /> PDF
          </a>
        )}
        {props.xmlUrl && (
          <a href={props.xmlUrl} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[10.5px] font-medium px-2 py-0.5 rounded-md border border-[#3D2314]/20 text-[#3D2314]/70 hover:bg-[#3D2314]/5 transition-colors"
            title="Baixar XML da NFSe">
            <FileCode size={10} /> XML
          </a>
        )}
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
