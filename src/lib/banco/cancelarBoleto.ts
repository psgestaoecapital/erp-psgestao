// Cancelar boleto (Receitas a Receber): baixa SÓ o boleto no banco; o título (erp_receber) continua ativo.
// Regras puras aqui (testáveis sem rede); a rota /api/banco/cancelar-boleto faz a chamada ao banco.
export type ProviderCancelavel = 'sicoob' | 'sicredi' | 'bradesco'

export const BANCO_PROVIDER: Record<string, ProviderCancelavel> = { '756': 'sicoob', '748': 'sicredi', '237': 'bradesco' }

/** Provedores cuja API de baixa o ERP chama. Bradesco: endpoint de baixa não confirmado — avisa o usuário (nunca omite). */
export const CANCELAMENTO_API: Record<ProviderCancelavel, boolean> = { sicoob: true, sicredi: true, bradesco: false }

export const MSG_SEM_API: Record<ProviderCancelavel, string> = {
  sicoob: '',
  sicredi: '',
  bradesco: 'O cancelamento pelo sistema ainda não está disponível para o Bradesco. Cancele (baixe) o boleto no Internet Banking do Bradesco; o título continua ativo aqui.',
}

const ABERTOS = ['aberto', 'vencido', 'parcial']

export type TituloBoleto = { boleto_status: string | null; boleto_nosso_numero: string | null; boleto_banco_codigo: string | null; status: string | null }

/** null = pode cancelar; senão o motivo em linguagem do usuário. */
export function motivoNaoCancelavel(t: TituloBoleto): string | null {
  if (t.boleto_status !== 'registrado' || !t.boleto_nosso_numero) return 'Este título não tem boleto registrado no banco.'
  if (!t.status || !ABERTOS.includes(t.status)) return 'O título já foi pago ou encerrado; o boleto não pode mais ser cancelado.'
  if (!t.boleto_banco_codigo || !BANCO_PROVIDER[t.boleto_banco_codigo]) return 'Banco do boleto não reconhecido.'
  return null
}

/** Campos do título após o cancelamento: invalida só o boleto, não mexe em valor/vencimento/status do título. */
export const CAMPOS_BOLETO_CANCELADO = {
  boleto_status: 'cancelado',
  boleto_nosso_numero: null,
  boleto_linha_digitavel: null,
  boleto_codigo_barras: null,
  boleto_qr_code: null,
  boleto_url: null,
  boleto_id_externo: null,
} as const

/** Banco respondeu que o boleto já estava baixado/cancelado: tratamos como sucesso (idempotente). */
export function jaBaixadoNoBanco(raw: unknown): boolean {
  const t = (typeof raw === 'string' ? raw : JSON.stringify(raw ?? '')).toLowerCase()
  return /j[aá] (est[aá] )?(baixad|cancelad)|boleto baixado|situacao.{0,8}baixad/.test(t)
}
