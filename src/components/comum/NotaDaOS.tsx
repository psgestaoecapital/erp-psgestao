'use client'

// Chamado #2167 (Gean, item 1): a OS mostra quando a nota JÁ foi emitida — o botão fica verde (como o
// "✓ Faturada") e, tocado, abre o PDF da nota (DANFE da NF-e de peças / PDF da NFS-e de serviços), sem ir a
// Notas Fiscais. Lê a última nota da OS pelo os_id (o mesmo vínculo que a emissão grava). Nota em
// processamento mostra o estado; nota recusada mostra o motivo e mantém o botão de emitir (reenvio).
// "Emitir outra" continua possível (NF-e parcial de peças), escondido atrás de um toque.

import { useEffect, useState, type CSSProperties } from 'react'
import { Hourglass } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import EmitirNFeOSButton from '@/components/comum/EmitirNFeOSButton'
import EmitirNFSeOSButton from '@/components/comum/EmitirNFSeOSButton'
import { estadoNotaOS, type EstadoNotaOS, type LinhaNotaOS, type TipoNotaOS } from '@/lib/fiscal/notaDaOS'


const ROTA_AJUDA = '/dashboard/os'
const C = { green: '#047857', greenBg: '#ECFDF5', amber: '#B45309', amberBg: '#FAEEDA', red: '#791F1F', redBg: '#FCEBEB', espressoM: '#6B5D4F' }

export default function NotaDaOS({
  tipo, osId, companyId, buttonStyle, onEmitida,
}: { tipo: TipoNotaOS; osId: string; companyId: string; buttonStyle?: CSSProperties; onEmitida?: () => void }) {
  const [nota, setNota] = useState<EstadoNotaOS>({ fase: 'emitir', recusa: null })
  const [outra, setOutra] = useState(false)
  const rotulo = tipo === 'nfe' ? 'NF-e' : 'NFS-e'

  const [versao, setVersao] = useState(0)

  useEffect(() => {
    let vivo = true
    const consulta = tipo === 'nfe'
      ? supabase.from('erp_nfe_emitidas').select('numero, status, danfe_url, motivo_rejeicao, criado_em')
      : supabase.from('erp_nfse_emitidas').select('numero, status, pdf_url, motivo_rejeicao, criado_em')
    void consulta.eq('os_id', osId).neq('status', 'cancelada').order('criado_em', { ascending: false }).limit(1)
      .then(({ data }) => { if (vivo) setNota(estadoNotaOS(tipo, (data ?? [])[0] as LinhaNotaOS | undefined)) })
    return () => { vivo = false }
  }, [tipo, osId, versao])

  const emitida = () => { onEmitida?.(); setOutra(false); setVersao((v) => v + 1) }
  const botaoEmitir = tipo === 'nfe'
    ? <EmitirNFeOSButton osId={osId} companyId={companyId} buttonStyle={buttonStyle} onEmitida={emitida} />
    : <EmitirNFSeOSButton osId={osId} companyId={companyId} buttonStyle={buttonStyle} onEmitida={emitida} />

  const chip: CSSProperties = { fontSize: 12, fontWeight: 700, borderRadius: 8, padding: '10px 14px', minHeight: 44,
    display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }

  if (nota.fase === 'emitida') {
    const texto = `✓ ${rotulo}${nota.numero ? ` nº ${nota.numero}` : ''} emitida`
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {nota.pdf ? (
          <a href={nota.pdf} target="_blank" rel="noopener noreferrer" data-testid={`os-${tipo}-pdf`}
            title={`Abre o PDF da ${rotulo} desta OS`} style={{ ...chip, color: C.green, background: C.greenBg }}>
            {texto} · abrir PDF
          </a>
        ) : (
          <span data-testid={`os-${tipo}-pdf-gerando`} title="A nota foi autorizada; o PDF ainda está sendo gerado. Recarregue em instantes."
            style={{ ...chip, color: C.green, background: C.greenBg }}>
            {texto} · PDF sendo gerado
          </span>
        )}
        <AjudaCampo chave={`os.${tipo}.emitida`} rota={ROTA_AJUDA} />
        {outra ? botaoEmitir : (
          <button type="button" onClick={() => setOutra(true)} data-testid={`os-${tipo}-emitir-outra`}
            style={{ fontSize: 11, color: C.espressoM, background: 'none', border: 'none', textDecoration: 'underline', cursor: 'pointer', minHeight: 44 }}>
            emitir outra
          </button>
        )}
      </span>
    )
  }

  if (nota.fase === 'processando') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span data-testid={`os-${tipo}-processando`} style={{ ...chip, color: C.amber, background: C.amberBg }}>
          <Hourglass size={14} aria-hidden /> {rotulo} em processamento
        </span>
        <AjudaCampo chave={`os.${tipo}.processando`} rota={ROTA_AJUDA} />
      </span>
    )
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      {botaoEmitir}
      {nota.recusa && (
        <span data-testid={`os-${tipo}-recusada`} title={nota.recusa}
          style={{ fontSize: 11, color: C.red, background: C.redBg, borderRadius: 6, padding: '4px 8px', maxWidth: 320 }}>
          Última {rotulo} recusada: {nota.recusa.slice(0, 140)} — corrija e emita de novo.
        </span>
      )}
    </span>
  )
}
