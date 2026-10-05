// CEO 05/10 · ids gilberto-automotivo e gilberto-industria na rotina, desligados (aciona=false).
// Migration 20261005230000 (@pos-migration). Só leitura.

import { test, expect } from '../../support/fixtures'
import { dbSelect, registrarJornada } from '../../support/api'

test.describe('Agentes automotivo e indústria', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-agente-automotivo-industria', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('existem em erp_agente_rotina com aciona=false', { tag: '@pos-migration' }, async () => {
    const r = await dbSelect<{ agente: string; aciona: boolean }>('erp_agente_rotina', 'agente=in.(gilberto-automotivo,gilberto-industria)&select=agente,aciona')
    expect(r.map((x) => x.agente).sort()).toEqual(['gilberto-automotivo', 'gilberto-industria'])
    expect(r.every((x) => x.aciona === false)).toBe(true)
  })

  test('os demais agentes seguem intactos', { tag: '@pos-migration' }, async () => {
    const r = await dbSelect<{ agente: string }>('erp_agente_rotina', 'agente=in.(gilberto-desenv,gilberto-produto,gilberto-chamados)&select=agente')
    expect(r).toHaveLength(3)
  })
})
