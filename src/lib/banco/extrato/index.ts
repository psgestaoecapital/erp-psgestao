// Registry de adapters de extrato. Adicionar novos providers aqui.
import type { ExtratoAdapter, ExtratoProvider } from './types'
import { sicoobExtratoAdapter } from './sicoob'
import { bradescoExtratoAdapter } from './bradesco'

const ADAPTERS: Partial<Record<ExtratoProvider, ExtratoAdapter>> = {
  sicoob: sicoobExtratoAdapter,
  bradesco: bradescoExtratoAdapter,
}

export function getExtratoAdapter(provider: string): ExtratoAdapter {
  const a = ADAPTERS[provider as ExtratoProvider]
  if (!a) throw new Error(`provider de extrato nao suportado: ${provider}`)
  return a
}

export * from './types'
