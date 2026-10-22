'use client'
// Chamado #3242 (Gean): na ficha da OS, mostra se a NF-e (peças) / NFS-e (serviços) já foi emitida.
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { resumirNotasPorOS, situacaoNotaOS, rotuloNotaOS, type NotaOSResumo } from '@/lib/oficina/osNotaFiscal'

export default function OSNotasFiscaisSelo({ osId, companyId, recarregar }: { osId: string; companyId: string; recarregar?: number }) {
  const [resumo, setResumo] = useState<NotaOSResumo | null>(null)

  useEffect(() => {
    let vivo = true
    void Promise.all([
      supabase.from('erp_nfe_emitidas').select('os_id, status, numero').eq('company_id', companyId).eq('os_id', osId),
      supabase.from('erp_nfse_emitidas').select('os_id, status, numero').eq('company_id', companyId).eq('os_id', osId),
    ]).then(([a, b]) => {
      if (!vivo) return
      setResumo(situacaoNotaOS(resumirNotasPorOS(a.data ?? [], b.data ?? []), osId))
    })
    return () => { vivo = false }
  }, [osId, companyId, recarregar])

  if (!resumo) return null
  const emitida = resumo.situacao === 'emitida'
  const cor = emitida ? '#2D6A2D' : resumo.situacao === 'processando' ? '#8A5A00' : '#791F1F'
  const bg = emitida ? '#E8F3E8' : resumo.situacao === 'processando' ? '#FFF4DE' : '#FBEAEA'
  return (
    <span data-testid="os-nota-selo" data-situacao={resumo.situacao}
      style={{ fontSize: 12, fontWeight: 700, color: cor, background: bg, borderRadius: 8, padding: '10px 14px', minHeight: 44, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {rotuloNotaOS(resumo)}
      <AjudaCampo chave="os.nota_fiscal.situacao" rota="/dashboard/os" />
    </span>
  )
}
