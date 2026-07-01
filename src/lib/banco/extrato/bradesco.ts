// Stub Bradesco — mesma interface do sicoobExtratoAdapter.
// A rota /api/banco/extrato/sync ja aceita provider='bradesco', mas ate
// o endpoint estar validado no portal Bradesco, esse adapter retorna
// erro amigavel. Assim a extensao futura e' 1-arquivo.

import type { ExtratoAdapter } from './types'

export const bradescoExtratoAdapter: ExtratoAdapter = {
  async listarMovimentos() {
    throw new Error('bradesco_extrato_nao_implementado')
  },
}
