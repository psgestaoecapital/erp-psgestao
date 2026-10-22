// Cancelar SÓ o boleto (baixa no banco) — o título (erp_receber) continua ativo.
// Regras puras, compartilhadas pela rota e pela tela (e cobertas por scripts/gates/check-cancelar-boleto.ts).

// Provedores com baixa por API implementada. Os demais avisam claramente em vez de falhar em silêncio.
export const PROVIDERS_CANCELA_BOLETO = ['sicoob'] as const
export type ProviderCancelaBoleto = (typeof PROVIDERS_CANCELA_BOLETO)[number]

export const suportaCancelarBoleto = (provider: string): provider is ProviderCancelaBoleto =>
  (PROVIDERS_CANCELA_BOLETO as readonly string[]).includes(provider)

export function motivoSemSuporte(nomeBanco: string): string {
  return `O cancelamento de boleto pela API ainda não está disponível para o ${nomeBanco}. Cancele o boleto no internet banking do ${nomeBanco}; o título continua ativo.`
}

const STATUS_TITULO_ABERTO = ['aberto', 'vencido', 'parcial']

// Elegível: boleto registrado no banco (com nosso número) e título ainda não pago/cancelado.
export function boletoElegivelParaCancelar(r: { boleto_status: string | null; boleto_nosso_numero: string | null; status: string | null }): boolean {
  return r.boleto_status === 'registrado' && !!r.boleto_nosso_numero && STATUS_TITULO_ABERTO.includes(String(r.status ?? '').toLowerCase())
}

// Campos do título que a baixa limpa. O título em si (status, valor, vencimento…) NUNCA entra aqui.
export function camposAposCancelarBoleto(): Record<string, string | null> {
  return {
    boleto_status: 'cancelado',
    boleto_linha_digitavel: null,
    boleto_codigo_barras: null,
    boleto_qr_code: null,
    boleto_url: null,
    boleto_nosso_numero: null,
    boleto_id_externo: null,
  }
}
