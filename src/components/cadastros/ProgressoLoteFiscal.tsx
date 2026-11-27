'use client'

// Chamado #11065 — barra de andamento da aplicação fiscal em lotes (Edição fiscal em massa e Padrão fiscal por NCM).
import { Loader2, Square, Play, X } from 'lucide-react'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { emAndamento, textoAndamento, type LoteFiscal } from '@/lib/produtos/fiscalMassaLotes'

const ROTA = '/dashboard/cadastros/produtos'

type Props = {
  job: LoteFiscal
  rodando: boolean
  erro: string | null
  onCancelar: () => void
  onContinuar: () => void
  onDispensar: () => void
}

export default function ProgressoLoteFiscal({ job, rodando, erro, onCancelar, onContinuar, onDispensar }: Props) {
  const ativo = emAndamento(job)
  const cor = job.status === 'concluido' ? '#2F5A1F' : job.status === 'erro' ? '#A32D2D' : '#C8941A'
  return (
    <section data-testid="fm-progresso" data-status={job.status} aria-live="polite"
      className="rounded-lg border border-[#C8941A]/40 bg-[#FBF4E4] p-4 text-[12.5px] text-[#3D2314]">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="font-semibold flex items-center gap-1.5">
          {ativo && rodando && <Loader2 size={14} className="animate-spin" />}
          Aplicação em lotes<AjudaCampo chave="cadastros.produtos.fiscal_massa.progresso" rota={ROTA} />
        </div>
        {!ativo && (
          <button type="button" onClick={onDispensar} aria-label="Fechar aviso" data-testid="fm-progresso-fechar" className="p-1 text-[#3D2314]/60"><X size={14} /></button>
        )}
      </div>
      <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={job.percentual}
        className="h-2.5 w-full rounded-full bg-[#3D2314]/10 overflow-hidden">
        <div data-testid="fm-progresso-barra" style={{ width: `${job.percentual}%`, background: cor }} className="h-full transition-all" />
      </div>
      <div data-testid="fm-progresso-texto" className="mt-2">{textoAndamento(job)}</div>
      {ativo && !rodando && (
        <div className="mt-1 text-[11.5px] text-[#3D2314]/65">
          A aplicação continua no servidor mesmo com esta tela fechada. Toque em Continuar para acompanhar daqui.
        </div>
      )}
      {erro && <div data-testid="fm-progresso-erro" className="mt-2 text-[#791F1F]">{erro}</div>}
      <div className="mt-3 flex flex-wrap gap-2">
        {ativo && (
          <button type="button" onClick={onCancelar} data-testid="fm-cancelar"
            className="px-3 py-1.5 text-[12.5px] rounded-lg border border-[#A32D2D] text-[#A32D2D] hover:bg-[#FCEBEB] flex items-center gap-1.5">
            <Square size={12} /> Cancelar
          </button>
        )}
        {((ativo && !rodando) || job.status === 'erro') && (
          <button type="button" onClick={onContinuar} data-testid="fm-continuar"
            className="px-3 py-1.5 text-[12.5px] rounded-lg bg-[#C8941A] text-white hover:bg-[#A87810] flex items-center gap-1.5">
            <Play size={12} /> Continuar
          </button>
        )}
      </div>
    </section>
  )
}
