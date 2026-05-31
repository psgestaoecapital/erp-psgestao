export type FiscalErrorCode =
  | 'CONFIG_NAO_ENCONTRADA'
  | 'CERTIFICADO_AUSENTE'
  | 'CERTIFICADO_EXPIRADO'
  | 'CERTIFICADO_INVALIDO'
  | 'API_KEY_INVALIDA'
  | 'API_INACESSIVEL'
  | 'TIMEOUT'
  | 'NFE_REJEITADA'
  | 'NFSE_REJEITADA'
  | 'CHAVE_NAO_ENCONTRADA'
  | 'PROVIDER_ERRO_INTERNO'
  | 'PROVIDER_RATE_LIMIT'
  | 'PAYLOAD_INVALIDO'
  | 'NAO_AUTORIZADO'

export class FiscalError extends Error {
  constructor(
    public readonly code: FiscalErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
    public readonly retryable: boolean = false
  ) {
    super(message)
    this.name = 'FiscalError'
  }

  toJSON() {
    return {
      ok: false,
      code: this.code,
      mensagem: this.message,
      retryable: this.retryable,
      details: this.details,
    }
  }
}

export function isFiscalError(err: unknown): err is FiscalError {
  return err instanceof FiscalError
}
