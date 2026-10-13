'use client'

import { useState } from 'react'
import { FileText, Download, FileCode, XCircle } from 'lucide-react'
import NFSePreviewModal from '@/components/fiscal/NFSePreviewModal'
import { supabase } from '@/lib/supabase'

interface Props {
  companyId: string
  erpReceberId: string
  descricao?: string
  valor?: number
  jaEmitida?: boolean
  processando?: boolean
  pdfUrl?: string
  xmlUrl?: string
  notaId?: string
  onSucesso?: () => void
}

export default function EmitirNFSeButton(props: Props) {
  const [open, setOpen] = useState(false)
  // cancelamento-nfse-v1: modal de justificativa obrigatória (>=15 chars)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [justificativa, setJustificativa] = useState('')
  const [cancelBusy, setCancelBusy] = useState(false)
  const [cancelErro, setCancelErro] = useState<string | null>(null)

  async function confirmarCancelamento() {
    if (!props.notaId) return
    if (justificativa.trim().length < 15) {
      setCancelErro('A justificativa precisa ter no mínimo 15 caracteres.')
      return
    }
    setCancelBusy(true)
    setCancelErro(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const r = await fetch('/api/fiscal/nfse/cancelar', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          authorization: session ? `Bearer ${session.access_token}` : '',
        },
        body: JSON.stringify({ notaId: props.notaId, justificativa: justificativa.trim() }),
      })
      const j = await r.json()
      if (!r.ok || !j.ok) {
        setCancelErro(j.mensagem || 'Não foi possível cancelar a NFS-e.')
        return
      }
      setCancelOpen(false)
      setJustificativa('')
      props.onSucesso?.()
    } catch (e) {
      setCancelErro((e as Error)?.message ?? 'Erro ao cancelar.')
    } finally {
      setCancelBusy(false)
    }
  }

  if (props.jaEmitida) {
    // Autorizada: chip + segunda via (PDF/XML) + cancelamento — só expõe o que já está no banco.
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
        {props.notaId && (
          <button
            type="button"
            onClick={() => { setCancelOpen(true); setCancelErro(null) }}
            data-testid="ar-cancelar-nfse"
            className="inline-flex items-center gap-1 text-[10.5px] font-medium px-2 py-0.5 rounded-md border border-[#A32D2D]/35 text-[#A32D2D] hover:bg-[#A32D2D]/8 transition-colors"
            title="Cancelar NFSe">
            <XCircle size={10} /> Cancelar
          </button>
        )}
        {cancelOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
            <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
              <div className="text-[15px] font-semibold text-[#3D2314] mb-1">Cancelar NFS-e</div>
              <div className="text-[12px] text-[#3D2314]/60 mb-3">
                O cancelamento é enviado à prefeitura e não pode ser desfeito. A justificativa é obrigatória (mínimo 15 caracteres).
              </div>
              <textarea
                value={justificativa}
                onChange={(e) => setJustificativa(e.target.value)}
                rows={3}
                placeholder="Descreva o motivo do cancelamento…"
                data-testid="ar-cancelar-justificativa"
                className="w-full rounded-md border border-[#3D2314]/20 p-2 text-[13px] text-[#3D2314] outline-none focus:border-[#C8941A]"
              />
              <div className="mt-1 text-[10.5px] text-[#3D2314]/45">{justificativa.trim().length}/15</div>
              {cancelErro && <div className="mt-2 text-[12px] text-[#A32D2D]">{cancelErro}</div>}
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { setCancelOpen(false); setCancelErro(null) }}
                  disabled={cancelBusy}
                  className="px-3 py-1.5 text-[12.5px] rounded-md border border-[#3D2314]/20 text-[#3D2314]/70 hover:bg-[#3D2314]/5">
                  Voltar
                </button>
                <button
                  type="button"
                  onClick={() => void confirmarCancelamento()}
                  disabled={cancelBusy || justificativa.trim().length < 15}
                  data-testid="ar-cancelar-confirmar"
                  className="px-3 py-1.5 text-[12.5px] font-medium rounded-md bg-[#A32D2D] text-white disabled:opacity-50 hover:bg-[#8f2727]">
                  {cancelBusy ? 'Cancelando…' : 'Confirmar cancelamento'}
                </button>
              </div>
            </div>
          </div>
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
