'use client'

import { useState, useEffect } from 'react'
import { Package, Download, FileCode, AlertTriangle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import NFePreviewModal from '@/components/fiscal/NFePreviewModal'

interface Props {
  companyId: string
  erpReceberId: string
  valor?: number
  jaEmitida?: boolean
  // RECEBER-DANFE: estado/documento da NF-e vinculada (vem sempre do banco, RD-58)
  processando?: boolean
  rejeitada?: boolean
  numero?: string | null
  danfeUrl?: string | null
  xmlUrl?: string | null
  motivo?: string | null
  onSucesso?: () => void
}

export default function EmitirNFeButton(props: Props) {
  const [open, setOpen] = useState(false)
  const [temProdutos, setTemProdutos] = useState<boolean | null>(null)

  useEffect(() => {
    let alive = true
    supabase
      .from('erp_produtos')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', props.companyId)
      .eq('ativo', true)
      .then(({ count }) => {
        if (alive) setTemProdutos((count ?? 0) > 0)
      })
    return () => {
      alive = false
    }
  }, [props.companyId])

  // ── Estados de NF-e JÁ existente (independem de ter produto ativo agora) ──────────────
  // RECEBER-DANFE: autorizada → pílula "NF-e nº X ✓" clicável que abre a DANFE + XML secundário.
  if (props.jaEmitida) {
    return (
      <span className="inline-flex items-center gap-1.5 flex-wrap">
        {props.danfeUrl ? (
          <a
            href={props.danfeUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="ar-baixar-danfe"
            className="inline-flex items-center gap-1 text-[10.5px] text-[#3F7012] font-medium px-2 py-0.5 rounded-full bg-[#E8F4DC] hover:bg-[#DCEFCB] transition-colors"
            title="Baixar/abrir DANFE (PDF)"
          >
            <Download size={11} /> NF-e nº {props.numero ?? '—'} ✓
          </a>
        ) : (
          <span
            className="inline-flex items-center gap-1 text-[10.5px] text-[#3F7012] font-medium px-2 py-0.5 rounded-full bg-[#E8F4DC]"
            title="NF-e autorizada"
          >
            <Package size={11} /> NF-e nº {props.numero ?? '—'} ✓
          </span>
        )}
        {props.xmlUrl && (
          <a
            href={props.xmlUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="ar-baixar-xml-nfe"
            className="inline-flex items-center gap-1 text-[10.5px] font-medium px-2 py-0.5 rounded-md border border-[#3D2314]/20 text-[#3D2314]/70 hover:bg-[#3D2314]/5 transition-colors"
            title="Baixar XML da NF-e"
          >
            <FileCode size={10} /> XML
          </a>
        )}
      </span>
    )
  }

  // RECEBER-DANFE / alinhado ao #1132: processando NÃO é rejeição — sem download ainda.
  if (props.processando) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10.5px] text-[#8A5A00] font-medium px-2 py-0.5 rounded-full bg-[#FBEED2]"
        title="⏳ Processando autorização na SEFAZ. A DANFE fica disponível quando autorizar."
      >
        <Package size={11} /> ⏳ NF-e processando na SEFAZ
      </span>
    )
  }

  // rejeitada/denegada: motivo real do banco (RD-51/RD-58), sem download.
  if (props.rejeitada) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10.5px] text-[#A32D2D] font-medium px-2 py-0.5 rounded-full bg-[#FCEBEB]"
        title={props.motivo ?? 'NF-e rejeitada pela SEFAZ'}
      >
        <AlertTriangle size={11} /> NF-e rejeitada{props.motivo ? ` · ${props.motivo}` : ''}
      </span>
    )
  }

  // ── Botão de EMITIR: só se a empresa vende produto físico ─────────────────────────────
  if (temProdutos === null || temProdutos === false) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="ar-emitir-nfe"
        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11.5px] font-medium rounded-md border border-[#7B5C2D]/45 text-[#3D2314] bg-[#FAEEDA] hover:bg-[#F5E0BC] transition-colors"
        title="Emitir NFe Produto"
      >
        <Package size={12} /> NFe
      </button>
      <NFePreviewModal
        open={open}
        onClose={() => setOpen(false)}
        companyId={props.companyId}
        erpReceberId={props.erpReceberId}
        valor={props.valor}
        onSucesso={() => {
          setOpen(false)
          props.onSucesso?.()
        }}
      />
    </>
  )
}
