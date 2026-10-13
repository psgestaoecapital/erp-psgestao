// Registry de adapters de ponto. Adicionar novos providers aqui (henry,
// control_id, secullum) — a rota /api/industrial/ponto/sync usa o
// adapter retornado por getAdapter(provider).

import type { PontoAdapter, PontoProvider } from './types'
import { iopointAdapter } from './iopoint'

const ADAPTERS: Partial<Record<PontoProvider, PontoAdapter>> = {
  iopoint: iopointAdapter,
}

export function getPontoAdapter(provider: string): PontoAdapter {
  const a = ADAPTERS[provider as PontoProvider]
  if (!a) throw new Error(`provider de ponto nao suportado: ${provider}`)
  return a
}

export * from './types'
