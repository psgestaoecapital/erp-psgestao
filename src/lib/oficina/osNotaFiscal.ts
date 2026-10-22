// Chamado #3242 (Gean): situação da nota fiscal de cada OS, a partir das notas ligadas à OS
// (erp_nfe_emitidas.os_id = peças, erp_nfse_emitidas.os_id = serviços).
// "emitida" = ao menos uma nota AUTORIZADA; "processando" = só nota na SEFAZ/prefeitura;
// "rejeitada" = só tentativas rejeitadas (conta como falta emitir); "sem_nota" = nenhuma tentativa.
// Nota cancelada não conta como emitida.

export type NotaOSLinha = { os_id: string | null; status: string | null; numero: string | number | null }

export type SituacaoNotaOS = 'emitida' | 'processando' | 'rejeitada' | 'sem_nota'

export type NotaOSResumo = {
  situacao: SituacaoNotaOS
  nfe: string[]   // números das NF-e autorizadas
  nfse: string[]  // números das NFS-e autorizadas
}

export const FILTROS_NOTA_OS = ['todas', 'com_nota', 'falta_emitir'] as const
export type FiltroNotaOS = typeof FILTROS_NOTA_OS[number]

function acumular(mapa: Map<string, { aut: { nfe: string[]; nfse: string[] }; proc: boolean; rej: boolean }>, linhas: NotaOSLinha[], tipo: 'nfe' | 'nfse') {
  for (const l of linhas) {
    if (!l.os_id) continue
    const st = (l.status ?? '').toLowerCase()
    let r = mapa.get(l.os_id)
    if (!r) { r = { aut: { nfe: [], nfse: [] }, proc: false, rej: false }; mapa.set(l.os_id, r) }
    if (st === 'autorizada') r.aut[tipo].push(l.numero != null && String(l.numero) !== '' ? String(l.numero) : 's/ nº')
    else if (st === 'processando' || st === 'pendente' || st === 'enviada') r.proc = true
    else if (st === 'rejeitada' || st === 'denegada' || st === 'erro') r.rej = true
  }
}

export function resumirNotasPorOS(nfe: NotaOSLinha[], nfse: NotaOSLinha[]): Map<string, NotaOSResumo> {
  const bruto = new Map<string, { aut: { nfe: string[]; nfse: string[] }; proc: boolean; rej: boolean }>()
  acumular(bruto, nfe, 'nfe')
  acumular(bruto, nfse, 'nfse')
  const out = new Map<string, NotaOSResumo>()
  for (const [osId, r] of bruto) {
    const temAut = r.aut.nfe.length + r.aut.nfse.length > 0
    const situacao: SituacaoNotaOS = temAut ? 'emitida' : r.proc ? 'processando' : r.rej ? 'rejeitada' : 'sem_nota'
    out.set(osId, { situacao, nfe: r.aut.nfe, nfse: r.aut.nfse })
  }
  return out
}

export function situacaoNotaOS(mapa: Map<string, NotaOSResumo>, osId: string): NotaOSResumo {
  return mapa.get(osId) ?? { situacao: 'sem_nota', nfe: [], nfse: [] }
}

export function passaFiltroNotaOS(resumo: NotaOSResumo, filtro: FiltroNotaOS): boolean {
  if (filtro === 'todas') return true
  if (filtro === 'com_nota') return resumo.situacao === 'emitida'
  return resumo.situacao !== 'emitida'
}

export function rotuloNotaOS(resumo: NotaOSResumo): string {
  if (resumo.situacao === 'emitida') {
    const partes: string[] = []
    if (resumo.nfe.length) partes.push(`NF-e ${resumo.nfe.join(', ')}`)
    if (resumo.nfse.length) partes.push(`NFS-e ${resumo.nfse.join(', ')}`)
    return `🧾 ${partes.join(' · ')}`
  }
  if (resumo.situacao === 'processando') return '⏳ NF processando'
  if (resumo.situacao === 'rejeitada') return '⚠ NF rejeitada — falta emitir'
  return 'Sem NF emitida'
}
