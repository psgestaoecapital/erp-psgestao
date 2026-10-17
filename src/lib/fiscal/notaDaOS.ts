// Chamado #2167 (Gean): estado da nota da OS a partir da última linha de erp_nfe_emitidas/erp_nfse_emitidas
// (pelo os_id). Puro, sem rede — a tela (NotaDaOS) e o gate check-os-nota-emitida-2167 usam a mesma regra.
export type TipoNotaOS = 'nfe' | 'nfse'
export type LinhaNotaOS = { numero: string | null; status: string; danfe_url?: string | null; pdf_url?: string | null; motivo_rejeicao: string | null }
export type EstadoNotaOS =
  | { fase: 'emitida'; numero: string | null; pdf: string | null }
  | { fase: 'processando' }
  | { fase: 'emitir'; recusa: string | null }   // sem nota, ou a última foi recusada (reenvio)

const RECUSADA = ['rejeitada', 'denegada', 'erro']

export function estadoNotaOS(tipo: TipoNotaOS, linha: LinhaNotaOS | null | undefined): EstadoNotaOS {
  if (!linha) return { fase: 'emitir', recusa: null }
  if (linha.status === 'autorizada') {
    const pdf = (tipo === 'nfe' ? linha.danfe_url : linha.pdf_url) ?? null
    return { fase: 'emitida', numero: linha.numero, pdf: pdf && /^https?:\/\//.test(pdf) ? pdf : null }
  }
  if (linha.status === 'processando') return { fase: 'processando' }
  return { fase: 'emitir', recusa: RECUSADA.includes(linha.status) ? (linha.motivo_rejeicao ?? 'motivo não informado') : null }
}
