// Adapter de EXTRATO Sicredi — FASE 2 (stub).
// O boleto/cobrança já está no ar; o extrato (conta corrente) do Sicredi usa uma API
// diferente da de cobrança e precisa de confirmação de escopo/endpoint na doc autenticada.
// Por ora lança 'extrato_nao_habilitado' — a rota /api/banco/extrato/sync trata esse erro
// graciosamente (marca ultimo_sync_status e não quebra). Registrar aqui garante que o
// dispatch por provider reconheça 'sicredi'.
// TODO(fase2): implementar listarMovimentos contra a API de conta/extrato do Sicredi.
import type { ExtratoAdapter } from './types'

export const sicrediExtratoAdapter: ExtratoAdapter = {
  async listarMovimentos() {
    throw new Error('extrato_nao_habilitado: extrato Sicredi é fase 2 (boleto/cobrança já disponível)')
  },
}
