'use client'

import { useState, useEffect } from 'react'
import { Package } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import NFePreviewModal from '@/components/fiscal/NFePreviewModal'

interface Props {
  companyId: string
  erpReceberId: string
  valor?: number
  jaEmitida?: boolean
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

  // Foundational: nao mostra se a empresa nao vende produto fisico
  if (temProdutos === null || temProdutos === false) return null

  if (props.jaEmitida) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10.5px] text-[#3F7012] font-medium px-2 py-0.5 rounded-full bg-[#E8F4DC]"
        title="NFe ja emitida"
      >
        <Package size={11} /> NFe OK
      </span>
    )
  }

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
