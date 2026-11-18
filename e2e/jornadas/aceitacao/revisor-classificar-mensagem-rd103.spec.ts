// RD-103 (CEO 18/11, gargalo do #9800): o revisor reclassifica requer_ok_ceo PÓS-AUDITORIA.
// fn_revisor_classificar_mensagem (só service_role): LIBERAR (false) → pode_executar=true sem OK do CEO;
// ESCALAR (true) → continua travado até o CEO; NUNCA toca ok_ceo_em (exclusivo do CEO). @pos-migration: a função
// só existe após o deploy. Usa o agente de teste (fixture crua + teardown que apaga por para=AGENTE_TESTE),
// NÃO cria mensagem via fn_agente_mensagem_enviar.
import { test, expect } from '../../support/fixtures'
import { rpc, dbSelect, dbInsert, registrarJornada } from '../../support/api'
import { ligarAgenteTeste, AGENTE_TESTE } from '../../support/agente-teste'

test.describe('Revisor · classificar requer_ok_ceo (RD-103) @pos-migration', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-revisor-classificar-rd103', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('libera spec gravado (false) e escala decisão nova (true), sem tocar ok_ceo_em', async () => {
    const limpar = await ligarAgenteTeste()
    try {
      // mensagem PROTEGIDA (requer_ok_ceo=true) — fixture crua, não via fn_agente_mensagem_enviar
      const msg = await dbInsert<{ id: string }>('erp_agente_mensagem', {
        de: 'eng_chefe', para: AGENTE_TESTE, tipo: 'tarefa',
        assunto: 'RD-103 aceitação', corpo: 'teste reclassificação RD-103',
        enviado_por: 'teste-aceitacao', requer_ok_ceo: true, status: 'recebida',
      })

      // LIBERAR: implementa spec gravado → requer_ok_ceo=false, pode_executar=true
      const lib = await rpc<{ ok: boolean; requer_ok_ceo: boolean; pode_executar: boolean; ok_ceo_origem: string }>(
        'fn_revisor_classificar_mensagem',
        { p_mensagem_id: msg.id, p_requer_ok_ceo: false, p_motivo: 'implementa spec gravado; sem conta nova nem mudança de movimento de dinheiro', p_spec_ref: 'contexto:#teste' })
      expect(lib.ok, 'rpc ok').toBe(true)
      expect(lib.requer_ok_ceo).toBe(false)
      expect(lib.pode_executar, 'liberado flui sem OK do CEO').toBe(true)
      expect(lib.ok_ceo_origem?.startsWith('revisor:'), 'origem marcada como decisão do revisor').toBe(true)

      // ok_ceo_em continua NULL (a função nunca grava OK do CEO)
      const [apos] = await dbSelect<{ ok_ceo_em: string | null }>('erp_agente_mensagem', `id=eq.${msg.id}&select=ok_ceo_em`)
      expect(apos.ok_ceo_em, 'ok_ceo_em intacto (exclusivo do CEO)').toBeNull()

      // ESCALAR: decisão nova protegida → requer_ok_ceo=true, pode_executar=false (sem ok_ceo_em)
      const esc = await rpc<{ requer_ok_ceo: boolean; pode_executar: boolean }>(
        'fn_revisor_classificar_mensagem',
        { p_mensagem_id: msg.id, p_requer_ok_ceo: true, p_motivo: 'cria conta bancária nova — decisão protegida', p_spec_ref: null })
      expect(esc.requer_ok_ceo).toBe(true)
      expect(esc.pode_executar, 'escalado continua travado até o CEO').toBe(false)

      // guardas: id inexistente e motivo vazio não têm efeito
      const semMsg = await rpc<{ ok: boolean; erro: string }>('fn_revisor_classificar_mensagem',
        { p_mensagem_id: '00000000-0000-4000-a000-000000000000', p_requer_ok_ceo: false, p_motivo: 'x' })
      expect(semMsg.ok).toBe(false)
      expect(semMsg.erro).toBe('mensagem_nao_encontrada')
      const semMotivo = await rpc<{ ok: boolean; erro: string }>('fn_revisor_classificar_mensagem',
        { p_mensagem_id: msg.id, p_requer_ok_ceo: false, p_motivo: '  ' })
      expect(semMotivo.ok).toBe(false)
      expect(semMotivo.erro).toBe('motivo_obrigatorio')
    } finally {
      await limpar()
    }
  })
})
