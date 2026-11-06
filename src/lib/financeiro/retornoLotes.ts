// #4909 (Gean) · baixa do RETORNO de pagamentos em LOTES. A RPC fn_remessa_retorno_conciliar_auto baixa item a
// item na mesma transação, e cada baixa custa ~0,5–1,5 s no banco (gatilhos do erp_pagar, sobretudo a fila do
// Omie). Com o limite de 8 s por chamada, um retorno de 10 pagamentos estourava ("statement timeout") e NADA
// era baixado. A tela agora confirma em fatias pequenas — cada fatia é uma chamada (transação) própria — e
// soma os resultados. Reimportar continua idempotente: título já pago volta como "já baixado".

/** Pagamentos por chamada na confirmação: 3 × ~1,5 s no pior caso medido fica bem abaixo dos 8 s. */
export const TAMANHO_LOTE_RETORNO = 3

/**
 * Fatia os pagamentos do retorno em lotes de até `tamanho`, mantendo JUNTAS as linhas com o mesmo código de
 * barras (a RPC só evita casar duas linhas com o mesmo título dentro da mesma chamada). Ordem preservada.
 */
export function fatiarRetorno<T extends { codigo_barras?: string | null }>(itens: T[], tamanho = TAMANHO_LOTE_RETORNO): T[][] {
  const n = Math.max(1, Math.floor(tamanho))
  const grupos: T[][] = []
  const porBarra = new Map<string, T[]>()
  for (const it of itens) {
    const k = (it.codigo_barras || '').replace(/\D/g, '')
    if (k) {
      const g = porBarra.get(k)
      if (g) { g.push(it); continue }
      const novo = [it]; porBarra.set(k, novo); grupos.push(novo)
    } else grupos.push([it])
  }
  const lotes: T[][] = []
  let atual: T[] = []
  for (const g of grupos) {
    if (atual.length && atual.length + g.length > n) { lotes.push(atual); atual = [] }
    atual = atual.concat(g)
  }
  if (atual.length) lotes.push(atual)
  return lotes
}

type Resumo = { total: number; pagos: number; agendados?: number; rejeitados: number; ja_pagos: number; erros: number; nao_casados: number; nao_reconhecidos?: number }
export type RespostaRetorno = {
  ok: boolean; erro?: string; confirmado?: boolean
  casados?: unknown[]; agendados?: unknown[]; nao_casados?: unknown[]; rejeitados?: unknown[]; ja_pagos?: unknown[]; nao_reconhecidos?: unknown[]
  qtd_casados?: number; qtd_agendados?: number; qtd_nao_casados?: number; qtd_nao_reconhecidos?: number
  resumo?: Resumo
}

const LISTAS = ['casados', 'agendados', 'nao_casados', 'rejeitados', 'ja_pagos', 'nao_reconhecidos'] as const
const CAMPOS_RESUMO = ['total', 'pagos', 'agendados', 'rejeitados', 'ja_pagos', 'erros', 'nao_casados', 'nao_reconhecidos'] as const

/** Junta as respostas dos lotes numa resposta só, no mesmo formato da RPC (listas concatenadas, resumo somado). */
export function somarRespostasRetorno<R extends RespostaRetorno>(resps: R[]): R {
  const out: Record<string, unknown> = { ok: resps.length > 0 && resps.every((r) => r.ok), confirmado: resps.some((r) => r.confirmado) }
  const erros = [...new Set(resps.map((r) => r.erro).filter(Boolean))]
  if (erros.length) out.erro = erros.join(' · ')
  for (const l of LISTAS) out[l] = resps.flatMap((r) => (r[l] as unknown[] | undefined) ?? [])
  out.qtd_casados = (out.casados as unknown[]).length
  out.qtd_agendados = (out.agendados as unknown[]).length
  out.qtd_nao_casados = (out.nao_casados as unknown[]).length
  out.qtd_nao_reconhecidos = (out.nao_reconhecidos as unknown[]).length
  const resumo: Record<string, number> = {}
  for (const c of CAMPOS_RESUMO) resumo[c] = resps.reduce((s, r) => s + Number((r.resumo as Record<string, number> | undefined)?.[c] ?? 0), 0)
  out.resumo = resumo
  return out as R
}

/** Mensagem compreensível para a pessoa no lugar do texto técnico do banco. */
export function mensagemErroRetorno(msg: string | null | undefined): string {
  const m = (msg || '').toLowerCase()
  if (m.includes('statement timeout') || m.includes('canceling statement')) {
    return 'O banco demorou demais para gravar estas baixas e nada deste trecho foi gravado. Importe o mesmo arquivo de novo: o que já foi baixado aparece como "já baixado" e não duplica.'
  }
  if (m.includes('sem acesso') || m.includes('sem_acesso') || m.includes('42501')) return 'Você não tem acesso para baixar pagamentos desta empresa.'
  if (m.includes('failed to fetch') || m.includes('network')) return 'Sem conexão com o servidor. Confira a internet e importe o arquivo de novo (o que já foi baixado não duplica).'
  return msg || 'Não foi possível concluir a baixa.'
}
