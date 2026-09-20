// Revenda R1b · global setup: login do bot UMA vez (mesmo caminho da tela) e grava o storageState
// (localStorage sb-<ref>-auth-token + ps_empresa_sel = Demonstração Revenda). Todas as jornadas herdam.

import { mkdirSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { BASE_URL, DEMO_REVENDA, exigirEnv, obterSessionPayload, storageKey } from './support/api'

export const STORAGE_STATE = 'e2e/.auth/state.json'

export default async function globalSetup(): Promise<void> {
  exigirEnv()
  const session = await obterSessionPayload()
  const origem = new URL(BASE_URL).origin
  const state = {
    cookies: [],
    origins: [{
      origin: origem,
      localStorage: [
        { name: storageKey(), value: session },
        { name: 'ps_empresa_sel', value: DEMO_REVENDA },
      ],
    }],
  }
  mkdirSync(dirname(STORAGE_STATE), { recursive: true })
  writeFileSync(STORAGE_STATE, JSON.stringify(state, null, 2))
  console.log(`[jornadas-revenda] storageState gravado (empresa demo ${DEMO_REVENDA}) para ${origem}`)
}
