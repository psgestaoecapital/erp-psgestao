// #2946 · Consulta do retorno da nota logo depois de emitir (NF-e e NFS-e via Focus). Em vez de 10 consultas a cada
// 3 s (30 s no total), espera em degraus: o normal é a SEFAZ/prefeitura responder em segundos; a nota lenta ainda é
// pega no próprio modal em até ~2 min. Depois disso a rotina automática (a cada 2 min) segue cobrindo.

export const ESPERAS_CONSULTA_MS = [3000, 3000, 5000, 10000, 15000, 30000, 60000] as const

/** Espera antes da consulta `tentativa` (0, 1, 2…); null = parar de consultar no modal. */
export function esperaConsulta(tentativa: number): number | null {
  return tentativa >= 0 && tentativa < ESPERAS_CONSULTA_MS.length ? ESPERAS_CONSULTA_MS[tentativa] : null
}

export const AVISO_PROCESSANDO =
  'Nota enviada e aguardando o retorno da SEFAZ/prefeitura. Não emita de novo enquanto estiver processando (gera nota em duplicidade): use "Consultar agora".'

/** Texto curto do resultado do "Consultar agora" na lista de notas. */
export function resumoConsulta(r: { status?: string; numero?: string | number | null; motivoRejeicao?: string | null; mensagem?: string }): string {
  if (r.status === 'autorizada') return r.numero != null ? `Nota autorizada: nº ${r.numero}.` : 'Nota autorizada.'
  if (r.status === 'rejeitada' || r.status === 'denegada') return `Nota ${r.status}: ${r.motivoRejeicao ?? 'motivo não informado'}.`
  if (r.status === 'processando') return 'Ainda processando na SEFAZ. Não emita de novo; consulte em alguns instantes.'
  return `Não foi possível consultar agora${r.mensagem ? `: ${r.mensagem}` : ''}. Tente de novo em instantes.`
}
