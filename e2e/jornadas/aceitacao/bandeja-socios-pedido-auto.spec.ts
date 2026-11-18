// Bandeja dos sócios (CEO 18/11, Rodrigo+Jordana): mensagem requer_ok_ceo=true nasce com PEDIDO
// (ok_ceo_pedido_em) → aparece APROVÁVEL em fn_pr_bandeja_listar, sem pingar o CEO. O trigger NÃO aprova
// (ok_ceo_em continua null — OK só do clique do sócio/CEO). @pos-migration: o trigger só existe após o deploy.
// Fixture crua no agente de teste (ligarAgenteTeste cria a rotina p/ a FK de 'para'; teardown auto-limpa).
import { test, expect } from '../../support/fixtures'
import { dbInsert, registrarJornada } from '../../support/api'
import { ligarAgenteTeste, AGENTE_TESTE } from '../../support/agente-teste'

test.describe('Bandeja dos sócios · requer_ok_ceo nasce com pedido @pos-migration', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-bandeja-socios-pedido-auto', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('requer_ok_ceo=true nasce com ok_ceo_pedido_em (aprovável) e sem ok_ceo_em (não aprovado)', async () => {
    const limpar = await ligarAgenteTeste()
    try {
      const msg = await dbInsert<{ id: string; ok_ceo_pedido_em: string | null; ok_ceo_em: string | null; requer_ok_ceo: boolean }>(
        'erp_agente_mensagem',
        { de: 'eng_chefe', para: AGENTE_TESTE, tipo: 'tarefa', assunto: 'bandeja pedido auto',
          corpo: 'teste bandeja pedido auto', enviado_por: 'teste-aceitacao', requer_ok_ceo: true, status: 'recebida' })
      expect(msg.requer_ok_ceo).toBe(true)
      expect(msg.ok_ceo_pedido_em, 'o trigger registrou o pedido → aprovável na bandeja').not.toBeNull()
      expect(msg.ok_ceo_em, 'não aprova nada (OK vem só do clique do sócio/CEO)').toBeNull()
    } finally {
      await limpar()
    }
  })
})
