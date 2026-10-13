// RD-78 · Aceitação da PR "jornada vistoria: itens do modelo pela região" (jornada vistoria vermelha em produção).
// Causa (RD-81): vistoria.spec.ts consultava insp_item?modelo_id=… — insp_item NUNCA teve modelo_id
// (20260906210000_inspecao_motor.sql: o item pertence à região, a região ao modelo). O PostgREST devolvia
// 400 "column insp_item.modelo_id does not exist" antes de qualquer passo de tela.
// Aqui: a MESMA consulta corrigida (modelo → regiões → itens), pela mesma API REST, no modelo rápido da
// Demonstração Revenda, dá os 9 itens que a tela promete ("Vistoria rápida (9 itens)"). Somente leitura.

import { test, expect } from '../../support/fixtures'
import { dbSelect, registrarJornada, DEMO_REVENDA } from '../../support/api'

test.describe('Aceitação — itens do modelo de vistoria pela região (jornada vistoria)', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-vistoria-itens-modelo', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('modelo rápido da demo: 9 itens pela região (a consulta antiga por modelo_id não existe)', async () => {
    const modelos = await dbSelect<{ id: string }>('insp_modelo', `company_id=eq.${DEMO_REVENDA}&modo=eq.rapida&ativo=eq.true&select=id`)
    expect(modelos.length, 'a demo tem o modelo rápido').toBe(1)
    const regioes = await dbSelect<{ id: string }>('insp_regiao', `modelo_id=eq.${modelos[0].id}&select=id`)
    const itens = await dbSelect('insp_item', `regiao_id=in.(${regioes.map((r) => r.id).join(',')})&select=id`)
    expect(itens.length, 'a rápida tem 9 itens').toBe(9)

    // a consulta antiga do spec falha no próprio PostgREST — prova de que a causa era a consulta, não a tela
    await expect(dbSelect('insp_item', `modelo_id=eq.${modelos[0].id}&select=id`)).rejects.toThrow(/modelo_id does not exist/)
  })
})
